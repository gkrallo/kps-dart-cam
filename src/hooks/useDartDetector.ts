import { RefObject, useEffect, useRef } from 'react';
import { Point } from '../types';
import { BOARD_MM, BOARD_PX, PX_PER_MM } from '../utils/dartMath';
import { detectDartAxisTip } from '../utils/dartTip';

/** Ringradier i den warpade bilden, härledda ur de officiella mm-måtten. */
const RING_PX = {
  innerBull: BOARD_MM.innerBull * PX_PER_MM,
  outerBull: BOARD_MM.outerBull * PX_PER_MM,
  tripleInner: BOARD_MM.tripleInner * PX_PER_MM,
  tripleOuter: BOARD_MM.tripleOuter * PX_PER_MM,
  doubleInner: BOARD_MM.doubleInner * PX_PER_MM,
  doubleOuter: BOARD_MM.doubleOuter * PX_PER_MM,
};

export const useDartDetector = (
  cv: any,
  videoElement: HTMLVideoElement | null,
  transformMatrix: any | null,
  isActive: boolean,
  motionThreshold: number,
  debugCanvasRef: RefObject<HTMLCanvasElement | null>,
  onDartDetected: (tip: Point) => void,
  onDebugState?: (state: string, noise: number) => void,
) => {
  // Callbacks i refs: annars byggs hela effekten om vid varje kast, eftersom
  // onDartDetected får ny identitet när poängen ändras. Det allokerade om alla
  // Mat:er, läste om baseline och avbröt rAF-loopen mitt i spelet.
  const onDartDetectedRef = useRef(onDartDetected);
  const onDebugStateRef = useRef(onDebugState);
  const motionThresholdRef = useRef(motionThreshold);
  useEffect(() => {
    onDartDetectedRef.current = onDartDetected;
    onDebugStateRef.current = onDebugState;
    motionThresholdRef.current = motionThreshold;
  });

  const detectedDartsRef = useRef<Point[]>([]);

  useEffect(() => {
    if (!isActive) detectedDartsRef.current = [];
  }, [isActive]);

  useEffect(() => {
    if (!cv || !videoElement || !transformMatrix || !isActive) return;

    const hiddenCanvas = document.createElement('canvas');
    const ctx = hiddenCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    const dsize = new cv.Size(BOARD_PX, BOARD_PX);
    const border = new cv.Scalar(0, 0, 0, 255);

    // Alla Mat:er allokeras en gång och raderas i cleanup. Inga undantag -
    // OpenCV.js kör mot en WASM-heap som inte städas av garbage collectorn.
    const warped = new cv.Mat();
    const gray = new cv.Mat();
    const diff = new cv.Mat();
    const thresh = new cv.Mat();
    const diffPrev = new cv.Mat();
    const threshPrev = new cv.Mat();
    // Rå (owarpad) gråskala: spetsdetekteringen körs här, för i den warpade
    // bilden är pilkroppen utsmetad eftersom den sticker ut ur tavlans plan.
    const rawGray = new cv.Mat();
    const rawDiff = new cv.Mat();
    const rawThresh = new cv.Mat();
    const kernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(3, 3));
    let baseline: any = null;
    let previous: any = null;
    let rawBaseline: any = null;

    let rafId = 0;
    let stopped = false;
    let isStabilizing = false;
    let lastMotionTime = 0;

    const grabFrame = () => {
      hiddenCanvas.width = videoElement.videoWidth;
      hiddenCanvas.height = videoElement.videoHeight;
      ctx.drawImage(videoElement, 0, 0, hiddenCanvas.width, hiddenCanvas.height);
      const frame = cv.imread(hiddenCanvas);
      cv.warpPerspective(frame, warped, transformMatrix, dsize, cv.INTER_LINEAR, cv.BORDER_CONSTANT, border);
      cv.cvtColor(warped, gray, cv.COLOR_RGBA2GRAY);
      // Sudda i GRÅSKALA, före tröskling. Den gamla koden suddade den binära
      // bilden efteråt, vilket i praktiken bara vidgade blobben och lyfte brus.
      cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0);
      cv.cvtColor(frame, rawGray, cv.COLOR_RGBA2GRAY);
      cv.GaussianBlur(rawGray, rawGray, new cv.Size(5, 5), 0);
      frame.delete();
    };

    if (videoElement.videoWidth === 0) return;
    grabFrame();
    baseline = gray.clone();
    previous = gray.clone();
    rawBaseline = rawGray.clone();

    // Warpar en punkt från rå videokoordinat till 800x800-rummet.
    const warpPoint = (p: Point): Point => {
      const src = cv.matFromArray(1, 1, cv.CV_32FC2, [p.x, p.y]);
      const dst = new cv.Mat();
      try {
        cv.perspectiveTransform(src, dst, transformMatrix);
        return { x: dst.data32F[0], y: dst.data32F[1] };
      } finally {
        src.delete();
        dst.delete();
      }
    };

    const analyseNewBlob = () => {
      // Bildsubtraktion i RÅ bild - se rawGray ovan.
      cv.absdiff(rawGray, rawBaseline, rawDiff);
      cv.threshold(rawDiff, rawThresh, 15, 255, cv.THRESH_BINARY);
      cv.morphologyEx(rawThresh, rawThresh, cv.MORPH_OPEN, kernel);
      cv.morphologyEx(rawThresh, rawThresh, cv.MORPH_CLOSE, kernel);

      const contours = new cv.MatVector();
      const hierarchy = new cv.Mat();
      cv.findContours(rawThresh, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_NONE);

      let bestIdx = -1;
      let bestArea = 0;
      for (let i = 0; i < contours.size(); i++) {
        const area = cv.contourArea(contours.get(i));
        if (area > bestArea) {
          bestArea = area;
          bestIdx = i;
        }
      }

      // Arean är relativ bildstorleken nu (rå bild, inte den fasta 800x800:an).
      const frameArea = rawGray.rows * rawGray.cols || 1;
      const minArea = frameArea * 0.0002;
      const maxArea = frameArea * 0.05;

      if (bestIdx !== -1 && bestArea > minArea && bestArea < maxArea) {
        const contour = contours.get(bestIdx);

        const points: Point[] = [];
        for (let i = 0; i < contour.rows; i++) {
          points.push({ x: contour.data32S[i * 2], y: contour.data32S[i * 2 + 1] });
        }

        // Formkontroll: en pil är avlång. Runda blobbar är skuggor eller brus.
        const rect = cv.minAreaRect(contour);
        const long = Math.max(rect.size.width, rect.size.height);
        const short = Math.max(Math.min(rect.size.width, rect.size.height), 1);
        const elongation = long / short;

        let tipRaw: Point | null = null;
        try {
          const axis = detectDartAxisTip(points, { minElongation: 2 });
          if (axis && axis.confidence > 0.15) {
            // Axelanpassning + breddtest: fenan är bredare än spetsen.
            tipRaw = axis.tip;
          } else if (elongation >= 2.5) {
            // Nästan frontal pil: axeln går inte att lita på. Blobbens
            // tyngdpunkt duger - parallaxen är liten när pilen pekar mot linsen.
            let mx = 0;
            let my = 0;
            for (const p of points) {
              mx += p.x;
              my += p.y;
            }
            tipRaw = { x: mx / points.length, y: my / points.length };
          }
        } catch (err) {
          console.error('Spetsdetektering misslyckades:', err);
        }

        if (tipRaw) {
          const tip = warpPoint(tipRaw);
          detectedDartsRef.current.push(tip);
          onDartDetectedRef.current(tip);
        }
      }

      contours.delete();
      hierarchy.delete();
    };

    const drawOverlay = (state: string) => {
      const center = new cv.Point(BOARD_PX / 2, BOARD_PX / 2);
      const ring = (r: number, color: number[], thickness: number) =>
        cv.circle(warped, center, Math.round(r), new cv.Scalar(...color), thickness);

      ring(RING_PX.doubleOuter, [59, 130, 246, 255], 2);
      ring(RING_PX.doubleInner, [96, 165, 250, 255], 1);
      ring(RING_PX.tripleOuter, [239, 68, 68, 255], 2);
      ring(RING_PX.tripleInner, [248, 113, 113, 255], 1);
      ring(RING_PX.outerBull, [34, 197, 94, 255], 2);
      ring(RING_PX.innerBull, [239, 68, 68, 255], -1);

      for (let i = 0; i < 20; i++) {
        const rad = ((i * 18 - 9 - 90) * Math.PI) / 180;
        cv.line(
          warped,
          new cv.Point(
            BOARD_PX / 2 + RING_PX.outerBull * Math.cos(rad),
            BOARD_PX / 2 + RING_PX.outerBull * Math.sin(rad),
          ),
          new cv.Point(
            BOARD_PX / 2 + RING_PX.doubleOuter * Math.cos(rad),
            BOARD_PX / 2 + RING_PX.doubleOuter * Math.sin(rad),
          ),
          new cv.Scalar(148, 163, 184, 180),
          1,
        );
      }

      detectedDartsRef.current.forEach((pt, idx) => {
        const p = new cv.Point(pt.x, pt.y);
        cv.circle(warped, p, 16, new cv.Scalar(239, 68, 68, 255), 2);
        cv.circle(warped, p, 6, new cv.Scalar(34, 197, 94, 255), -1);
        cv.line(warped, new cv.Point(pt.x - 22, pt.y), new cv.Point(pt.x + 22, pt.y), new cv.Scalar(255, 255, 255, 255), 1);
        cv.line(warped, new cv.Point(pt.x, pt.y - 22), new cv.Point(pt.x, pt.y + 22), new cv.Scalar(255, 255, 255, 255), 1);
        cv.putText(warped, `P${idx + 1}`, new cv.Point(pt.x + 10, pt.y - 10), cv.FONT_HERSHEY_SIMPLEX, 0.7, new cv.Scalar(255, 255, 0, 255), 2);
      });

      if (state === 'MOTION' || state === 'STABILIZING') {
        cv.rectangle(warped, new cv.Point(5, 5), new cv.Point(BOARD_PX - 5, BOARD_PX - 5), new cv.Scalar(0, 0, 255, 255), 10);
      }

      if (debugCanvasRef.current) cv.imshow(debugCanvasRef.current, warped);
    };

    const processFrame = () => {
      if (stopped) return;
      rafId = requestAnimationFrame(processFrame);

      if (videoElement.paused || videoElement.ended || videoElement.videoWidth === 0) return;

      grabFrame();

      cv.absdiff(gray, baseline, diff);
      cv.threshold(diff, thresh, 30, 255, cv.THRESH_BINARY);
      const baselineNoise = cv.countNonZero(thresh);

      cv.absdiff(gray, previous, diffPrev);
      cv.threshold(diffPrev, threshPrev, 30, 255, cv.THRESH_BINARY);
      const movementNoise = cv.countNonZero(threshPrev);

      previous.delete();
      previous = gray.clone();

      const now = performance.now();
      let state = 'STABLE';

      if (movementNoise > motionThresholdRef.current) {
        lastMotionTime = now;
        isStabilizing = true;
        state = 'MOTION';
      } else if (baselineNoise > 500) {
        if (!isStabilizing) {
          isStabilizing = true;
          lastMotionTime = now;
        }
        if (now - lastMotionTime > 500) {
          isStabilizing = false;
          state = 'ANALYZING';
          analyseNewBlob();
          baseline.delete();
          baseline = gray.clone();
          rawBaseline.delete();
          rawBaseline = rawGray.clone();
        } else {
          state = 'STABILIZING';
        }
      } else {
        isStabilizing = false;
      }

      onDebugStateRef.current?.(state, movementNoise);
      drawOverlay(state);
    };

    rafId = requestAnimationFrame(processFrame);

    return () => {
      stopped = true;
      cancelAnimationFrame(rafId);
      // Varenda Mat måste raderas, inklusive baseline och previous - de
      // saknades i den gamla cleanupen och läckte två 800x800-bilder per kast.
      [
        warped, gray, diff, thresh, diffPrev, threshPrev,
        rawGray, rawDiff, rawThresh, kernel, baseline, previous, rawBaseline,
      ].forEach((m) => m?.delete());
      baseline = null;
      previous = null;
      rawBaseline = null;
    };
  }, [cv, videoElement, transformMatrix, isActive, debugCanvasRef]);
};
