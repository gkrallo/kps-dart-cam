import { Point } from '../types';

function dist(p1: Point, p2: Point): number {
  return Math.hypot(p1.x - p2.x, p1.y - p2.y);
}

function lineIntersection(p1: Point, p2: Point, p3: Point, p4: Point): Point | null {
  const denom = (p1.x - p2.x) * (p3.y - p4.y) - (p1.y - p2.y) * (p3.x - p4.x);
  if (Math.abs(denom) < 1e-5) return null;
  const t = ((p1.x - p3.x) * (p3.y - p4.y) - (p1.y - p3.y) * (p3.x - p4.x)) / denom;
  return {
    x: p1.x + t * (p2.x - p1.x),
    y: p1.y + t * (p2.y - p1.y),
  };
}

/**
 * Sanitizes and enforces geometric symmetry on dartboard landmark points.
 * If one or more points (like Top, Right, Bottom, Left) are detected off-center,
 * it uses Bullseye center and opposite points to auto-correct the skewed points.
 */
export function sanitizeDartboardPoints(pts: Point[], bullseye?: Point | null): Point[] {
  if (pts.length !== 4) return pts;

  const B: Point = bullseye || lineIntersection(pts[0], pts[2], pts[1], pts[3]) || {
    x: (pts[0].x + pts[1].x + pts[2].x + pts[3].x) / 4,
    y: (pts[0].y + pts[1].y + pts[2].y + pts[3].y) / 4,
  };

  const d = pts.map((p) => dist(p, B));
  const sortedD = [...d].sort((a, b) => a - b);
  const dMed = (sortedD[1] + sortedD[2]) / 2;

  if (dMed <= 5) return pts;

  const result = [...pts];

  const isPointValid = (i: number): boolean => {
    const p = pts[i];
    const distance = d[i];
    if (distance < 0.60 * dMed || distance > 1.40 * dMed) return false;
    if (i === 0 && p.y >= B.y) return false; // Top must be above Bullseye
    if (i === 1 && p.x <= B.x) return false; // Right must be to right of Bullseye
    if (i === 2 && p.y <= B.y) return false; // Bottom must be below Bullseye
    if (i === 3 && p.x >= B.x) return false; // Left must be to left of Bullseye
    return true;
  };

  for (let i = 0; i < 4; i++) {
    if (!isPointValid(i)) {
      const opp = (i + 2) % 4;
      if (isPointValid(opp)) {
        // Reflect valid opposite point through Bullseye B
        result[i] = {
          x: 2 * B.x - pts[opp].x,
          y: 2 * B.y - pts[opp].y,
        };
      } else {
        // Fallback to cardinal direction at distance dMed
        if (i === 0) result[i] = { x: B.x, y: B.y - dMed };
        else if (i === 1) result[i] = { x: B.x + dMed, y: B.y };
        else if (i === 2) result[i] = { x: B.x, y: B.y + dMed };
        else if (i === 3) result[i] = { x: B.x - dMed, y: B.y };
      }
    }
  }

  return result;
}

/**
 * Attempts to automatically detect the dartboard using OpenCV HoughCircles / Contours.
 */
export function autoDetectBoardOpenCV(
  cv: any,
  videoElement: HTMLVideoElement,
  containerWidth: number,
  containerHeight: number,
  zoomLevel: number = 1.0
): Point[] | null {
  if (!cv || !videoElement || videoElement.videoWidth === 0) return null;

  try {
    const vw = videoElement.videoWidth;
    const vh = videoElement.videoHeight;
    const scale = Math.max(containerWidth / vw, containerHeight / vh);
    const videoDisplayWidth = vw * scale;
    const videoDisplayHeight = vh * scale;
    const offsetX = (containerWidth - videoDisplayWidth) / 2;
    const offsetY = (containerHeight - videoDisplayHeight) / 2;

    const src = new cv.Mat(vh, vw, cv.CV_8UC4);
    const gray = new cv.Mat();
    const blurred = new cv.Mat();
    const circles = new cv.Mat();

    // Capture current frame into canvas
    const canvas = document.createElement('canvas');
    canvas.width = vw;
    canvas.height = vh;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.drawImage(videoElement, 0, 0, vw, vh);
    const imgData = ctx.getImageData(0, 0, vw, vh);
    src.data.set(imgData.data);

    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blurred, new cv.Size(9, 9), 2, 2);

    // HoughCircles targeting double ring radius
    const minRadius = Math.round(Math.min(vw, vh) * 0.12);
    const maxRadius = Math.round(Math.min(vw, vh) * 0.40);
    cv.HoughCircles(blurred, circles, cv.HOUGH_GRADIENT, 1, minRadius, 100, 30, minRadius, maxRadius);

    let bestCircle = null;

    if (circles.cols > 0) {
      let minDistToCenter = Infinity;
      const imgCenterX = vw / 2;
      const imgCenterY = vh / 2;

      for (let i = 0; i < circles.cols; i++) {
        const x = circles.data32F[i * 3];
        const y = circles.data32F[i * 3 + 1];
        let r = circles.data32F[i * 3 + 2];

        // Check if ROI around circle has sufficient texture/contrast (dartboards have high variance)
        const rx = Math.max(0, Math.round(x - r));
        const ry = Math.max(0, Math.round(y - r));
        const rw = Math.min(vw - rx, Math.round(r * 2));
        const rh = Math.min(vh - ry, Math.round(r * 2));

        if (rw > 10 && rh > 10) {
          const rect = new cv.Rect(rx, ry, rw, rh);
          const roi = gray.roi(rect);
          const mean = new cv.Mat();
          const stddev = new cv.Mat();
          cv.meanStdDev(roi, mean, stddev);
          const stdval = stddev.data64F[0] || stddev.data32F?.[0] || 0;
          roi.delete();
          mean.delete();
          stddev.delete();

          // Smooth fabrics, walls, or plain skin have stddev < 30. Real dartboards have stddev > 45.
          if (stdval < 38) {
            continue; // Skip smooth false positives like towels or clothes
          }
        }

        // Keep authentic outer double ring radius detected by HoughCircles

        const distCenter = Math.hypot(x - imgCenterX, y - imgCenterY);
        if (distCenter < minDistToCenter) {
          minDistToCenter = distCenter;
          bestCircle = { x, y, r };
        }
      }
    }

    src.delete();
    gray.delete();
    blurred.delete();
    circles.delete();

    if (!bestCircle) return null;

    const cx = containerWidth / 2;
    const cy = containerHeight / 2;

    const videoToContainer = (vx: number, vy: number): Point => {
      const unzoomedX = vx * scale + offsetX;
      const unzoomedY = vy * scale + offsetY;
      return {
        x: (unzoomedX - cx) * zoomLevel + cx,
        y: (unzoomedY - cy) * zoomLevel + cy,
      };
    };

    const { x, y, r } = bestCircle;

    const rawPoints = [
      videoToContainer(x, y - r), // Top (20)
      videoToContainer(x + r, y), // Right (6)
      videoToContainer(x, y + r), // Bottom (3)
      videoToContainer(x - r, y), // Left (11)
    ];

    const bullseyePoint = videoToContainer(x, y);

    return sanitizeDartboardPoints(rawPoints, bullseyePoint);
  } catch (err) {
    console.error('Error in autoDetectBoardOpenCV:', err);
    return null;
  }
}

/**
 * Sends a snapshot to the Gemini AI API server endpoint to detect the board.
 */
export async function analyzeBoardWithGemini(
  videoElement: HTMLVideoElement,
  containerWidth: number,
  containerHeight: number,
  zoomLevel: number = 1.0
): Promise<Point[] | null> {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = Math.round((640 * videoElement.videoHeight) / videoElement.videoWidth);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
    const imageBase64 = canvas.toDataURL('image/jpeg', 0.85);

    const res = await fetch('/api/analyze-board', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageBase64 }),
    });

    if (!res.ok) return null;

    const data = await res.json();
    if (!data.success || data.isDartboardPresent === false || !data.landmarks) {
      console.log('Gemini reported no dartboard present in frame.');
      return null;
    }

    const { top20, right6, bottom3, left11, bullseye } = data.landmarks;
    if (!top20 || !right6 || !bottom3 || !left11) return null;

    const vw = videoElement.videoWidth;
    const vh = videoElement.videoHeight;
    const scale = Math.max(containerWidth / vw, containerHeight / vh);
    const videoDisplayWidth = vw * scale;
    const videoDisplayHeight = vh * scale;
    const offsetX = (containerWidth - videoDisplayWidth) / 2;
    const offsetY = (containerHeight - videoDisplayHeight) / 2;

    const cx = containerWidth / 2;
    const cy = containerHeight / 2;

    const normToContainer = (norm: { x: number; y: number }): Point => {
      const unzoomedX = norm.x * vw * scale + offsetX;
      const unzoomedY = norm.y * vh * scale + offsetY;
      return {
        x: (unzoomedX - cx) * zoomLevel + cx,
        y: (unzoomedY - cy) * zoomLevel + cy,
      };
    };

    const rawPoints = [
      normToContainer(top20),
      normToContainer(right6),
      normToContainer(bottom3),
      normToContainer(left11),
    ];

    const bullseyePoint = bullseye ? normToContainer(bullseye) : null;

    return sanitizeDartboardPoints(rawPoints, bullseyePoint);
  } catch (err) {
    console.error('Error analyzing board with Gemini:', err);
    return null;
  }
}

