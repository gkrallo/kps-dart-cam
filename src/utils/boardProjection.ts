import { Point } from '../types';
import { applyHomography, estimateHomography, invertMat3, type Mat3 } from './homography';

/**
 * Kanoniska kalibreringspunkter i mm: dubbelringens ytterkant (170 mm) vid
 * sektor 20 (topp), 6 (höger), 3 (botten), 11 (vänster) - i den ordningen.
 * Ordningen är hårdkodad överallt i appen; ändra den inte utan att ändra allt.
 */
export const CANONICAL_CALIBRATION_MM: readonly Point[] = [
  { x: 0, y: -170 },
  { x: 170, y: 0 },
  { x: 0, y: 170 },
  { x: -170, y: 0 },
];

/**
 * Homografi som mappar kanoniska mm-koordinater (bullseye i origo) till
 * skärmpixlar, given de fyra kalibreringspunkterna. Fyra punkter ger en exakt
 * lösning, så ingen refinement behövs här. Använd `computeCalibration` när du
 * har fler punkter och vill ha utjämning.
 */
export function computeHomography(pts: Point[]): ((X: number, Y: number) => Point) | null {
  if (pts.length !== 4) return null;
  const est = estimateHomography([...CANONICAL_CALIBRATION_MM], pts, { refine: false });
  if (!est) return null;
  const { H } = est;
  return (X: number, Y: number) => applyHomography(H, X, Y);
}

/**
 * Invers av `computeHomography`: skärmpixlar -> kanoniska mm.
 */
export function computeInverseHomography(
  pts: Point[],
): ((x: number, y: number) => { X: number; Y: number }) | null {
  if (pts.length !== 4) return null;
  const est = estimateHomography([...CANONICAL_CALIBRATION_MM], pts, { refine: false });
  if (!est) return null;
  const Hinv = invertMat3(est.H);
  if (!Hinv) return null;
  return (x: number, y: number) => {
    const p = applyHomography(Hinv, x, y);
    return { X: p.x, Y: p.y };
  };
}

export interface BoardCalibration {
  /** mm på tavlan -> pixel i bilden. */
  project: (X: number, Y: number) => Point;
  /** pixel i bilden -> mm på tavlan. */
  unproject: (x: number, y: number) => Point;
  /** Kvadratiskt medel av reprojektionsfelet för kalibreringspunkterna (px). */
  residualPx: number;
  /** Största enskilda reprojektionsfelet (px). En stor topp = en dålig punkt. */
  maxResidualPx: number;
  H: Mat3;
}

/**
 * Överbestämd kalibrering. `boardPointsMM` och `imagePoints` är par (samma
 * längd, minst fyra). Med fler än fyra par körs LM-refinement som minimerar
 * reprojektionsfelet, och `residualPx` säger hur bra passningen blev - det är
 * måttet UI:t kan visa som "kalibrering: bra / sådär / dålig".
 */
export function computeCalibration(
  boardPointsMM: Point[],
  imagePoints: Point[],
  opts: { refine?: boolean } = {},
): BoardCalibration | null {
  if (boardPointsMM.length !== imagePoints.length || boardPointsMM.length < 4) return null;

  const est = estimateHomography(boardPointsMM, imagePoints, opts);
  if (!est) return null;
  const Hinv = invertMat3(est.H);
  if (!Hinv) return null;

  return {
    project: (X, Y) => applyHomography(est.H, X, Y),
    unproject: (x, y) => applyHomography(Hinv, x, y),
    residualPx: est.rms,
    maxResidualPx: est.max,
    H: est.H,
  };
}

/**
 * Genererar SVG-path för en projicerad cirkel med kanonisk radie R (mm).
 */
export function generateProjectedCircleSVG(R: number, project: (X: number, Y: number) => Point, steps = 40): string {
  const points: Point[] = [];
  for (let i = 0; i < steps; i++) {
    const angle = (i / steps) * 2 * Math.PI;
    const X = R * Math.cos(angle);
    const Y = R * Math.sin(angle);
    points.push(project(X, Y));
  }
  return 'M ' + points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' L ') + ' Z';
}

/**
 * Sector angles in standard dartboard order, starting with 20 at top (-90 degrees)
 */
export const DARTBOARD_SECTOR_ANGLES = [
  -90, -72, -54, -36, -18, 0, 18, 36, 54, 72,
  90, 108, 126, 144, 162, 180, 198, 216, 234, 252
];

/**
 * Sector boundary angles (midway between sectors)
 */
export function getSectorBoundaryAngles(): number[] {
  return DARTBOARD_SECTOR_ANGLES.map((angle) => angle - 9);
}
