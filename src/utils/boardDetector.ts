import { Point } from '../types';
import {
  calibrationFromRingEllipses,
  cardinalCalibrationPoints,
  orientToImageUp,
  rotateCalibration,
  type Ellipse,
  type RingEllipse,
} from './boardEllipse';
import { CANONICAL_CALIBRATION_MM, computeCalibration } from './boardProjection';
import { estimateSectorRotation, type ColourSampler, type RGB } from './sectorPhase';

/**
 * Under den här konfidensen används inte färgmetodens rotation alls.
 * Uppmätt på Kristians slitna utomhustavla i skugga plus belysningsring:
 * 0,93 med 72 % av proverna färgbestämda. Syntetiskt: över 0,99. En bild där
 * ringarna inte går att färgbestämma ska falla tillbaka på "20 rakt upp"
 * hellre än att vrida hjulet åt fel håll.
 */
const MIN_SECTOR_CONFIDENCE = 0.6;

function dist(p1: Point, p2: Point): number {
  return Math.hypot(p1.x - p2.x, p1.y - p2.y);
}

function lineIntersection(p1: Point, p2: Point, p3: Point, p4: Point): Point | null {
  const denom = (p1.x - p2.x) * (p3.y - p4.y) - (p1.y - p2.y) * (p3.x - p4.x);
  if (Math.abs(denom) < 1e-5) return null;
  const t = ((p1.x - p3.x) * (p3.y - p4.y) - (p1.y - p3.y) * (p3.x - p4.x)) / denom;
  return { x: p1.x + t * (p2.x - p1.x), y: p1.y + t * (p2.y - p1.y) };
}

/**
 * Rimlighetskontroll av fyra detekterade kalibreringspunkter.
 *
 * OBS: funktionen FÖRKASTAR trasiga detektioner, den "rättar" dem inte.
 * Den tidigare versionen speglade punkter genom bullseye för att tvinga fram
 * symmetri, vilket förstörde perspektivinformationen: en tavla sedd snett SKA
 * vara osymmetrisk, och speglingen gjorde fyrhörningen till ett parallellogram
 * så homografin blev affin.
 */
export function validateDartboardPoints(pts: Point[], bullseye?: Point | null): boolean {
  if (pts.length !== 4) return false;

  const B: Point =
    bullseye ||
    lineIntersection(pts[0], pts[2], pts[1], pts[3]) || {
      x: (pts[0].x + pts[1].x + pts[2].x + pts[3].x) / 4,
      y: (pts[0].y + pts[1].y + pts[2].y + pts[3].y) / 4,
    };

  const d = pts.map((p) => dist(p, B));
  if (d.some((v) => v <= 5)) return false;

  const sorted = [...d].sort((a, b) => a - b);
  const dMed = (sorted[1] + sorted[2]) / 2;

  // Perspektiv får förkorta en sida, men inte hur mycket som helst.
  // 0.5-1.5 svarar mot en ganska brant kameravinkel och är avsiktligt tillåtande.
  if (d.some((v) => v < 0.5 * dMed || v > 1.5 * dMed)) return false;

  // Punkterna måste ligga åt rätt håll om bullseye.
  if (pts[0].y >= B.y) return false; // Topp (20) ovanför
  if (pts[1].x <= B.x) return false; // Höger (6)
  if (pts[2].y <= B.y) return false; // Botten (3) nedanför
  if (pts[3].x >= B.x) return false; // Vänster (11)

  return true;
}

/**
 * Grov automatisk detektering av tavlan med HoughCircles.
 *
 * Detta är en TILLFÄLLIG lösning som bara ger ett startläge för de fyra
 * punkterna - den antar att tavlan är en cirkel (den är en ellips så fort
 * kameran står snett) och den kan inte avgöra tavlans rotation. Ersätts i
 * nästa steg av ellipsanpassning + polär utveckling + sparat rotationsankare.
 */
export function autoDetectBoardOpenCV(
  cv: any,
  videoElement: HTMLVideoElement,
  containerWidth: number,
  containerHeight: number,
): Point[] | null {
  if (!cv || !videoElement || videoElement.videoWidth === 0) return null;

  const vw = videoElement.videoWidth;
  const vh = videoElement.videoHeight;

  let src: any, gray: any, blurred: any, circles: any;

  try {
    const canvas = document.createElement('canvas');
    canvas.width = vw;
    canvas.height = vh;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(videoElement, 0, 0, vw, vh);

    src = cv.imread(canvas);
    gray = new cv.Mat();
    blurred = new cv.Mat();
    circles = new cv.Mat();

    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blurred, new cv.Size(9, 9), 2, 2);

    const minRadius = Math.round(Math.min(vw, vh) * 0.12);
    const maxRadius = Math.round(Math.min(vw, vh) * 0.45);
    cv.HoughCircles(blurred, circles, cv.HOUGH_GRADIENT, 1, minRadius, 100, 30, minRadius, maxRadius);

    let best: { x: number; y: number; r: number } | null = null;
    let bestScore = -Infinity;

    for (let i = 0; i < circles.cols; i++) {
      const x = circles.data32F[i * 3];
      const y = circles.data32F[i * 3 + 1];
      const r = circles.data32F[i * 3 + 2];

      const rx = Math.max(0, Math.round(x - r));
      const ry = Math.max(0, Math.round(y - r));
      const rw = Math.min(vw - rx, Math.round(r * 2));
      const rh = Math.min(vh - ry, Math.round(r * 2));
      if (rw < 20 || rh < 20) continue;

      // En darttavla har hög kontrast. Släta ytor (väggar, tyg, hud) har låg.
      const roi = gray.roi(new cv.Rect(rx, ry, rw, rh));
      const mean = new cv.Mat();
      const stddev = new cv.Mat();
      cv.meanStdDev(roi, mean, stddev);
      const texture = stddev.data64F[0] ?? 0;
      roi.delete();
      mean.delete();
      stddev.delete();

      if (texture < 38) continue;

      // Poängsätt kandidaterna istället för att bara ta den närmast bildmitten.
      // Den gamla varianten låste ofta på bullseye eller trippelringen, som är
      // koncentriska med dubbelringen och alltså exakt lika nära mitten.
      const centerPenalty = Math.hypot(x - vw / 2, y - vh / 2) / Math.min(vw, vh);
      const sizeBonus = r / maxRadius; // föredra den STÖRSTA rimliga cirkeln
      const score = texture / 100 + sizeBonus * 2 - centerPenalty;

      if (score > bestScore) {
        bestScore = score;
        best = { x, y, r };
      }
    }

    if (!best) return null;

    // Videon visas med object-cover, alltså skalad med max() och centrerad.
    const scale = Math.max(containerWidth / vw, containerHeight / vh);
    const offsetX = (containerWidth - vw * scale) / 2;
    const offsetY = (containerHeight - vh * scale) / 2;
    const toContainer = (px: number, py: number): Point => ({
      x: px * scale + offsetX,
      y: py * scale + offsetY,
    });

    const { x, y, r } = best;
    const pts = [
      toContainer(x, y - r), // Topp (20)
      toContainer(x + r, y), // Höger (6)
      toContainer(x, y + r), // Botten (3)
      toContainer(x - r, y), // Vänster (11)
    ];

    return validateDartboardPoints(pts, toContainer(x, y)) ? pts : null;
  } catch (err) {
    console.error('autoDetectBoardOpenCV misslyckades:', err);
    return null;
  } finally {
    src?.delete();
    gray?.delete();
    blurred?.delete();
    circles?.delete();
  }
}

/** Läser färgen ur en CV_8UC3-Mat i RGB-ordning. Null utanför bilden. */
function matSampler(rgb: any, vw: number, vh: number): ColourSampler {
  return (x: number, y: number): RGB | null => {
    const xi = Math.round(x);
    const yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= vw || yi >= vh) return null;
    const p = rgb.ucharPtr(yi, xi);
    return [p[0], p[1], p[2]];
  };
}

export interface SectorAlignment {
  /** De fyra kalibreringspunkterna, rättade, i containerkoordinater. */
  points: Point[];
  /** Hur mycket hjulet vreds, i grader. Positivt = medurs. */
  offsetDeg: number;
  /** 0-1, se MIN_SECTOR_CONFIDENCE. */
  confidence: number;
}

/**
 * Riktar in sektorhjulet mot tavlans verkliga trådar, utifrån de fyra
 * kalibreringspunkter som redan finns - manuellt placerade eller
 * autodetekterade.
 *
 * Det här är rättningen Kristian fick göra för hand 2026-09-12 genom att dra
 * punkterna längs ringen. Den ändrar BARA rotationen: ringarnas storlek och
 * perspektivet lämnas orörda, så en kalibrering som redan följer dubbelringen
 * fortsätter göra det.
 *
 * Returnerar null om färgerna inte gick att läsa tillräckligt säkert - då är
 * det bättre att låta användaren rätta för hand än att gissa.
 */
export function alignSectorsToBoard(
  cv: any,
  videoElement: HTMLVideoElement,
  points: Point[],
  containerWidth: number,
  containerHeight: number,
): SectorAlignment | null {
  if (!cv || !videoElement || videoElement.videoWidth === 0) return null;
  if (points.length !== 4) return null;

  const vw = videoElement.videoWidth;
  const vh = videoElement.videoHeight;
  const mats: any[] = [];
  try {
    const canvas = document.createElement('canvas');
    canvas.width = vw;
    canvas.height = vh;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(videoElement, 0, 0, vw, vh);
    const src = cv.imread(canvas);
    mats.push(src);
    const rgb = new cv.Mat();
    mats.push(rgb);
    cv.cvtColor(src, rgb, cv.COLOR_RGBA2RGB);

    // Kalibreringen byggs i CONTAINER-koordinater, för det är där punkterna
    // bor och där de ska tillbaka. Bara färgavläsningen behöver gå till
    // videokoordinater - object-cover, samma formel som överallt annars.
    const calib = computeCalibration([...CANONICAL_CALIBRATION_MM], points, { refine: false });
    if (!calib) return null;

    const scale = Math.max(containerWidth / vw, containerHeight / vh);
    const offsetX = (containerWidth - vw * scale) / 2;
    const offsetY = (containerHeight - vh * scale) / 2;
    const videoSampler = matSampler(rgb, vw, vh);
    const sample: ColourSampler = (x, y) =>
      videoSampler((x - offsetX) / scale, (y - offsetY) / scale);

    const rotation = estimateSectorRotation(calib, sample);
    if (!rotation || rotation.confidence < MIN_SECTOR_CONFIDENCE) return null;

    const [top, right, bottom, left] = cardinalCalibrationPoints(
      rotateCalibration(calib, rotation.offsetRad),
    );
    return {
      points: [top, right, bottom, left],
      offsetDeg: (rotation.offsetRad * 180) / Math.PI,
      confidence: rotation.confidence,
    };
  } catch (err) {
    console.error('alignSectorsToBoard misslyckades:', err);
    return null;
  } finally {
    for (const m of mats) {
      try {
        m.delete();
      } catch {
        /* redan raderad */
      }
    }
  }
}

/**
 * Ellipsbaserad autodetektering.
 *
 * Färgsegmenterar dubbel- och trippelringen (rött + grönt), anpassar en ellips
 * till var sin ring med `cv.fitEllipse`, och lämnar geometrin till
 * `calibrationFromRingEllipses` som återställer perspektivet. Klarar sneda
 * kameravinklar som `HoughCircles` inte kan (den hittar bara cirklar).
 *
 * Färgtrösklarna nedan är rimliga startvärden, inte intrimmade mot en riktig
 * tavla i verklig belysning - det steget kräver hårdvara. Hittas bara en ring
 * används den ensam (mindre exakt radiellt men fortfarande lutningsmedveten).
 *
 * Rotationen kommer inte ur ringarna (de är rotationssymmetriska) utan ur
 * röd/grön-växlingen längs dem - se `sectorPhase.ts`. Går färgerna inte att
 * läsa faller den tillbaka på gissningen "20 i toppen", som användaren då
 * får bekräfta med "Peka ut 20:an".
 */
export function autoDetectBoardEllipse(
  cv: any,
  videoElement: HTMLVideoElement,
  containerWidth: number,
  containerHeight: number,
): Point[] | null {
  if (!cv || !videoElement || videoElement.videoWidth === 0) return null;

  const vw = videoElement.videoWidth;
  const vh = videoElement.videoHeight;
  const mats: any[] = [];
  const track = <T,>(m: T): T => {
    mats.push(m);
    return m;
  };

  try {
    const canvas = document.createElement('canvas');
    canvas.width = vw;
    canvas.height = vh;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(videoElement, 0, 0, vw, vh);

    const src = track(cv.imread(canvas));
    const rgb = track(new cv.Mat());
    cv.cvtColor(src, rgb, cv.COLOR_RGBA2RGB);
    const hsv = track(new cv.Mat());
    cv.cvtColor(rgb, hsv, cv.COLOR_RGB2HSV);

    // inRange i opencv.js vill ha gränserna som Mat:er i full storlek.
    const bound = (h: number, s: number, v: number) =>
      track(new cv.Mat(vh, vw, hsv.type(), [h, s, v, 0]));

    // Röd ligger vid båda ändarna av H-skalan (0-180 i OpenCV). Trösklarna är
    // avsiktligt tillåtande: på ett verkligt foto (utomhus, en strålkastare) är
    // ringens färg sliten och delvis i skugga.
    const redA = track(new cv.Mat());
    const redB = track(new cv.Mat());
    const green = track(new cv.Mat());
    cv.inRange(hsv, bound(0, 70, 55), bound(13, 255, 255), redA);
    cv.inRange(hsv, bound(167, 70, 55), bound(180, 255, 255), redB);
    cv.inRange(hsv, bound(36, 55, 45), bound(92, 255, 255), green);

    const mask = track(new cv.Mat());
    cv.bitwise_or(redA, redB, mask);
    cv.bitwise_or(mask, green, mask);

    const kernel = track(cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(5, 5)));
    // Kraftig close: den slitna, trådbrutna ringen blir en sammanhängande kontur.
    const bigKernel = track(cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(11, 11)));
    cv.morphologyEx(mask, mask, cv.MORPH_CLOSE, bigKernel);
    cv.morphologyEx(mask, mask, cv.MORPH_OPEN, kernel);

    const contours = track(new cv.MatVector());
    const hierarchy = track(new cv.Mat());
    cv.findContours(mask, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_NONE);

    // Kandidatellipser. En darttavlas ring är rund och ungefär centrerad i
    // bilden (användaren siktar kameran mot den). Rödbrunt trädäck och
    // pilfenor bildar däremot avlånga fläckar ute i kanterna - därför
    // fyrkantighets- och centrumfiltren nedan.
    const minDim = Math.min(vw, vh);
    const frameCx = vw / 2;
    const frameCy = vh / 2;
    const candidates: { ellipse: Ellipse; area: number; r: number }[] = [];
    for (let i = 0; i < contours.size(); i++) {
      const c = contours.get(i);
      if (c.rows < 15) continue;
      const area = cv.contourArea(c);
      if (area < 0.01 * vw * vh) continue;
      const rr = cv.fitEllipse(c);
      const w = rr.size.width;
      const h = rr.size.height;
      if (w < 10 || h < 10) continue;

      const aspect = Math.min(w, h) / Math.max(w, h);
      if (aspect < 0.55) continue; // en ring är fortfarande ganska rund sedd snett

      const r = Math.max(w, h) / 2;
      if (r < 0.08 * minDim || r > 0.7 * minDim) continue;

      // Förkasta ellipser vars centrum ligger i bildens ytterkant.
      if (Math.hypot(rr.center.x - frameCx, rr.center.y - frameCy) > 0.42 * minDim) continue;

      candidates.push({
        ellipse: {
          cx: rr.center.x,
          cy: rr.center.y,
          rx: w / 2,
          ry: h / 2,
          theta: (rr.angle * Math.PI) / 180,
        },
        area,
        r,
      });
    }

    if (candidates.length === 0) return null;
    candidates.sort((a, b) => b.r - a.r); // störst radie = dubbelringen

    const outer = candidates[0].ellipse;
    const outerR = candidates[0].r;
    // Trippelringen: en mindre, ungefär koncentrisk ellips (~0.63 × dubbelringen).
    const inner = candidates
      .slice(1)
      .find((cand) => {
        const centreOffset = Math.hypot(cand.ellipse.cx - outer.cx, cand.ellipse.cy - outer.cy);
        return cand.r > 0.45 * outerR && cand.r < 0.82 * outerR && centreOffset < 0.25 * outerR;
      })?.ellipse;

    const rings: RingEllipse[] = [{ ellipse: outer, radiusMM: 170 }];
    if (inner) rings.push({ ellipse: inner, radiusMM: 107 });

    const calib = calibrationFromRingEllipses(rings);
    if (!calib) return null;

    // Ringarna är rotationssymmetriska, så de kan inte säga vilken sektor som
    // är 20 - `orientToImageUp` antar bara att den sitter rakt upp. Sitter
    // tavlan några grader snett (Kristians gör det) hamnar hela sektorhjulet
    // vridet medan wireframets FORM ser perfekt ut. Röd/grön-växlingen i
    // ringarna avslöjar vridningen; se sectorPhase.ts.
    const upright = orientToImageUp(calib);
    const rotation = estimateSectorRotation(upright, matSampler(rgb, vw, vh));
    const oriented =
      rotation && rotation.confidence >= MIN_SECTOR_CONFIDENCE
        ? rotateCalibration(upright, rotation.offsetRad)
        : upright;
    const [top, right, bottom, left] = cardinalCalibrationPoints(oriented);

    // Videon visas med object-cover: skalad med max() och centrerad.
    const scale = Math.max(containerWidth / vw, containerHeight / vh);
    const offsetX = (containerWidth - vw * scale) / 2;
    const offsetY = (containerHeight - vh * scale) / 2;
    const toContainer = (p: Point): Point => ({
      x: p.x * scale + offsetX,
      y: p.y * scale + offsetY,
    });

    const pts = [toContainer(top), toContainer(right), toContainer(bottom), toContainer(left)];
    const bull = oriented.project(0, 0);
    return validateDartboardPoints(pts, toContainer(bull)) ? pts : null;
  } catch (err) {
    console.error('autoDetectBoardEllipse misslyckades:', err);
    return null;
  } finally {
    for (const m of mats) {
      try {
        m.delete();
      } catch {
        /* redan raderad */
      }
    }
  }
}
