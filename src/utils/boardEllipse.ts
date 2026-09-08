import type { Point } from '../types';
import { applyHomography, invertMat3, multiplyMat3, solveLinearSystem, type Mat3 } from './homography';
import { computeCalibration, type BoardCalibration } from './boardProjection';

/**
 * Ellipsbaserad autokalibrering.
 *
 * `HoughCircles` hittar bara cirklar - men tavlan är en ellips så fort kameran
 * står snett, vilket är normalfallet. Här anpassar vi i stället en ellips till
 * dubbel- (och trippel-)ringens färgmask.
 *
 * En ellips ensam räcker inte: alla punkter ligger på en cirkel i tavlans plan,
 * så homografin är obestämd i radiell led (perspektivförkortningen mot centrum).
 * Två koncentriska ringar med kända radier (170 och 107 mm) låser den. Med bara
 * en ring faller vi tillbaka på ellipsens fyra kardinalpunkter - ungefär samma
 * kvalitet som cirkelmetoden men med tavlans lutning inräknad.
 *
 * Rotationen (vilken sektor som är 20) går inte att få ur ringarna - de är
 * rotationssymmetriska. `orientToImageUp` antar att 20 sitter nära toppen,
 * precis som cirkelmetoden gör i dag. Steg 4 ersätter det med ett grovt
 * användartryck.
 *
 * Ren geometri, inget OpenCV: testbart mot `syntheticBoard`.
 */

export interface Ellipse {
  cx: number;
  cy: number;
  /** Halvaxel längs `theta`. */
  rx: number;
  /** Halvaxel vinkelrätt mot `theta`. */
  ry: number;
  /** Rotation i radianer. */
  theta: number;
}

export interface RingEllipse {
  ellipse: Ellipse;
  /** Kanonisk radie (mm) för ringen ellipsen anpassats till. */
  radiusMM: number;
}

/**
 * Anpassar en ellips till punkter. En ren algebraisk minsta-kvadrat (A x^2 +
 * B xy + C y^2 + D x + E y = 1) är partisk eftersom det algebraiska avståndet
 * inte är det geometriska. Vi kör därför några omgångar Sampson-omviktning:
 * varje punkt vägs med 1/|gradient|^2, vilket approximerar geometriskt avstånd
 * och tar bort det mesta av snedvridningen. Punkterna center-/skalnormaliseras
 * för kondition.
 */
export function fitEllipse(points: Point[]): Ellipse | null {
  if (points.length < 5) return null;

  let mx = 0;
  let my = 0;
  for (const p of points) {
    mx += p.x;
    my += p.y;
  }
  mx /= points.length;
  my /= points.length;

  let scale = 0;
  for (const p of points) scale += Math.hypot(p.x - mx, p.y - my);
  scale = scale / points.length || 1;

  const norm = points.map((p) => ({ x: (p.x - mx) / scale, y: (p.y - my) / scale }));

  let coef: number[] | null = null;
  for (let pass = 0; pass < 5; pass++) {
    const M: number[][] = Array.from({ length: 5 }, () => new Array(5).fill(0));
    const rhs = new Array(5).fill(0);
    for (const p of norm) {
      const row = [p.x * p.x, p.x * p.y, p.y * p.y, p.x, p.y];
      let w = 1;
      if (coef) {
        const [a, b, c, d, e] = coef;
        const gx = 2 * a * p.x + b * p.y + d;
        const gy = b * p.x + 2 * c * p.y + e;
        w = 1 / (gx * gx + gy * gy + 1e-9);
      }
      for (let i = 0; i < 5; i++) {
        rhs[i] += w * row[i];
        for (let j = 0; j < 5; j++) M[i][j] += w * row[i] * row[j];
      }
    }
    const sol = solveLinearSystem(M, rhs);
    if (!sol) break;
    coef = sol;
  }
  if (!coef) return null;

  const [A, B, C, D, E] = coef;
  const F = -1;

  const disc = B * B - 4 * A * C;
  if (disc >= 0 || !isFinite(disc)) return null; // inte en ellips

  const xc = (2 * C * D - B * E) / disc;
  const yc = (2 * A * E - B * D) / disc;
  const Fc = A * xc * xc + B * xc * yc + C * yc * yc + D * xc + E * yc + F;

  const common = Math.sqrt((A - C) * (A - C) + B * B);
  const lambda1 = (A + C + common) / 2;
  const lambda2 = (A + C - common) / 2;
  const lambdaMajor = Math.min(lambda1, lambda2); // mindre lambda -> större axel
  const lambdaMinor = Math.max(lambda1, lambda2);
  if (lambdaMajor * -Fc <= 0 || lambdaMinor * -Fc <= 0) return null;

  const major = Math.sqrt(-Fc / lambdaMajor);
  const minor = Math.sqrt(-Fc / lambdaMinor);

  // 0.5*atan2(B, A-C) pekar längs den axel som hör till det STÖRRE lambda
  // (dvs lillaxeln); storaxeln ligger vinkelrätt. pi-tvetydigheten spelar
  // ingen roll - ellipsen är densamma.
  const theta = 0.5 * Math.atan2(B, A - C) + Math.PI / 2;

  return {
    cx: xc * scale + mx,
    cy: yc * scale + my,
    rx: major * scale,
    ry: minor * scale,
    theta,
  };
}

/** Punkt på ellipsen vid parameter `t` (radianer). */
export function ellipsePoint(e: Ellipse, t: number): Point {
  const ct = Math.cos(e.theta);
  const st = Math.sin(e.theta);
  const ex = e.rx * Math.cos(t);
  const ey = e.ry * Math.sin(t);
  return { x: e.cx + ct * ex - st * ey, y: e.cy + st * ex + ct * ey };
}

/** Topp-, höger-, botten- och vänsterpunkten på ellipsen (i den ordningen). */
export function ellipseCardinalPoints(e: Ellipse): [Point, Point, Point, Point] {
  let top: Point | null = null;
  let right: Point | null = null;
  let bottom: Point | null = null;
  let left: Point | null = null;
  const STEPS = 1440;
  for (let i = 0; i < STEPS; i++) {
    const p = ellipsePoint(e, (i / STEPS) * 2 * Math.PI);
    if (!top || p.y < top.y) top = p;
    if (!bottom || p.y > bottom.y) bottom = p;
    if (!right || p.x > right.x) right = p;
    if (!left || p.x < left.x) left = p;
  }
  return [top!, right!, bottom!, left!];
}

function rotationMat3(rad: number): Mat3 {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return [c, -s, 0, s, c, 0, 0, 0, 1];
}

function calibrationFromH(H: Mat3, residualPx = 0, maxResidualPx = 0): BoardCalibration | null {
  const Hinv = invertMat3(H);
  if (!Hinv) return null;
  return {
    project: (X, Y) => applyHomography(H, X, Y),
    unproject: (x, y) => applyHomography(Hinv, x, y),
    residualPx,
    maxResidualPx,
    H,
  };
}

/**
 * Kalibrering ur en eller flera ringellipser.
 *
 * Med >= 2 ringar körs en iterativ metod: sampla varje ellips, gissa
 * board-vinklarna, lös homografin, härled board-vinklarna på nytt ur den, och
 * upprepa. Radieskillnaden mellan ringarna (t.ex. 170 mot 107) pinnar
 * perspektivet. Med bara en ring används ellipsens kardinalpunkter.
 */
export function calibrationFromRingEllipses(
  rings: RingEllipse[],
  opts: { samples?: number; iterations?: number } = {},
): BoardCalibration | null {
  const rs = rings.filter((r) => r.ellipse && r.radiusMM > 0);
  if (rs.length === 0) return null;

  if (rs.length === 1) {
    // Behandla ellipsens kardinalpunkter som bilderna av (0,-R),(R,0),(0,R),(-R,0).
    const R = rs[0].radiusMM;
    const [top, right, bottom, left] = ellipseCardinalPoints(rs[0].ellipse);
    return computeCalibration(
      [
        { x: 0, y: -R },
        { x: R, y: 0 },
        { x: 0, y: R },
        { x: -R, y: 0 },
      ],
      [top, right, bottom, left],
      { refine: false },
    );
  }

  const K = opts.samples ?? 64;
  const iters = opts.iterations ?? 16;

  const samplesPerRing = rs.map((r) =>
    Array.from({ length: K }, (_, k) => ellipsePoint(r.ellipse, (k / K) * 2 * Math.PI)),
  );

  // Startgissning: yttre ringens kardinalpunkter (affin approximation).
  const [t0, r0, b0, l0] = ellipseCardinalPoints(rs[0].ellipse);
  const R0 = rs[0].radiusMM;
  let calib = computeCalibration(
    [
      { x: 0, y: -R0 },
      { x: R0, y: 0 },
      { x: 0, y: R0 },
      { x: -R0, y: 0 },
    ],
    [t0, r0, b0, l0],
    { refine: false },
  );
  if (!calib) return null;

  // Iterera: av-projicera varje samplad punkt genom aktuell kalibrering, ta dess
  // board-vinkel, para den med den kända ringradien, lös om.
  for (let it = 0; it < iters; it++) {
    const boardPts: Point[] = [];
    const imgPts: Point[] = [];
    for (let ri = 0; ri < rs.length; ri++) {
      const radius = rs[ri].radiusMM;
      for (const p of samplesPerRing[ri]) {
        const b = calib.unproject(p.x, p.y);
        const a = Math.atan2(b.y, b.x);
        boardPts.push({ x: radius * Math.cos(a), y: radius * Math.sin(a) });
        imgPts.push(p);
      }
    }
    const next = computeCalibration(boardPts, imgPts, { refine: true });
    if (!next) break;
    calib = next;
  }

  return calib;
}

/**
 * Vrider kalibreringens rotationsgauge så att board-uppåt (0,-170) projiceras
 * så lodrätt uppåt som möjligt i bilden - antagandet "20 sitter nära toppen".
 * Robust mot kamerans roll: den letar efter den board-riktning som projiceras
 * närmast lodrätt, inte bara den högsta punkten (som flyttas av roll och gir).
 */
export function orientToImageUp(calib: BoardCalibration): BoardCalibration {
  const centre = calib.project(0, 0);
  let bestDelta = 0;
  let bestDeviation = Infinity;
  const STEPS = 3600;
  for (let i = 0; i < STEPS; i++) {
    const d = (i / STEPS) * 2 * Math.PI;
    // (0,-170) roterad med d: (170 sin d, -170 cos d)
    const p = calib.project(170 * Math.sin(d), -170 * Math.cos(d));
    const deviation = Math.abs(Math.atan2(p.x - centre.x, -(p.y - centre.y)));
    if (deviation < bestDeviation) {
      bestDeviation = deviation;
      bestDelta = d;
    }
  }

  const rotated = multiplyMat3(calib.H, rotationMat3(bestDelta));
  return calibrationFromH(rotated, calib.residualPx, calib.maxResidualPx) ?? calib;
}

/** De fyra kalibreringspunkterna [topp 20, höger 6, botten 3, vänster 11] i bilden. */
export function cardinalCalibrationPoints(calib: BoardCalibration): [Point, Point, Point, Point] {
  return [
    calib.project(0, -170),
    calib.project(170, 0),
    calib.project(0, 170),
    calib.project(-170, 0),
  ];
}
