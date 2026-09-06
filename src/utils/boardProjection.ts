import { Point } from '../types';

/**
 * Computes a 3x3 homography matrix H mapping canonical board coordinates (X, Y)
 * where (0, -170) is top 20, (170, 0) is right 6, (0, 170) is bottom 3, (-170, 0) is left 11,
 * to screen pixels (x, y).
 */
export function computeHomography(pts: Point[]): ((X: number, Y: number) => Point) | null {
  if (pts.length !== 4) return null;

  // Canonical points corresponding to top 20, right 6, bottom 3, left 11 at R = 170
  const src = [
    { x: 0, y: -170 },
    { x: 170, y: 0 },
    { x: 0, y: 170 },
    { x: -170, y: 0 },
  ];

  const dst = pts;

  // Build matrix equation A * h = b for homography h
  // For each pair (X, Y) -> (x, y):
  // X*h11 + Y*h12 + h13 - x*X*h31 - x*Y*h32 = x
  // X*h21 + Y*h22 + h23 - y*X*h31 - y*Y*h32 = y
  const A: number[][] = [];
  const B: number[] = [];

  for (let i = 0; i < 4; i++) {
    const { x: X, y: Y } = src[i];
    const { x, y } = dst[i];

    A.push([X, Y, 1, 0, 0, 0, -x * X, -x * Y]);
    B.push(x);

    A.push([0, 0, 0, X, Y, 1, -y * X, -y * Y]);
    B.push(y);
  }

  // Gaussian elimination for 8x8 system
  const solve8x8 = (mat: number[][], rhs: number[]): number[] | null => {
    const N = 8;
    const M = mat.map((row, i) => [...row, rhs[i]]);

    for (let i = 0; i < N; i++) {
      // Pivot
      let maxRow = i;
      for (let k = i + 1; k < N; k++) {
        if (Math.abs(M[k][i]) > Math.abs(M[maxRow][i])) maxRow = k;
      }
      [M[i], M[maxRow]] = [M[maxRow], M[i]];

      if (Math.abs(M[i][i]) < 1e-9) return null;

      for (let k = i + 1; k < N; k++) {
        const c = -M[k][i] / M[i][i];
        for (let j = i; j <= N; j++) {
          if (i === j) M[k][j] = 0;
          else M[k][j] += c * M[i][j];
        }
      }
    }

    const x = new Array(N).fill(0);
    for (let i = N - 1; i >= 0; i--) {
      x[i] = M[i][N] / M[i][i];
      for (let k = i - 1; k >= 0; k--) {
        M[k][N] -= M[k][i] * x[i];
      }
    }
    return x;
  };

  const h = solve8x8(A, B);
  if (!h) return null;

  const H = [
    [h[0], h[1], h[2]],
    [h[3], h[4], h[5]],
    [h[6], h[7], 1],
  ];

  return (X: number, Y: number): Point => {
    const w = H[2][0] * X + H[2][1] * Y + 1;
    const px = (H[0][0] * X + H[0][1] * Y + H[0][2]) / w;
    const py = (H[1][0] * X + H[1][1] * Y + H[1][2]) / w;
    return { x: px, y: py };
  };
}

/**
 * Computes inverse homography mapping screen pixels (x, y) to canonical board plane (X, Y) in mm.
 * Canonical board: Bullseye is (0,0), Outer double ring is radius R = 170mm.
 */
export function computeInverseHomography(pts: Point[]): ((x: number, y: number) => { X: number; Y: number }) | null {
  if (pts.length !== 4) return null;

  const dst = [
    { x: 0, y: -170 },
    { x: 170, y: 0 },
    { x: 0, y: 170 },
    { x: -170, y: 0 },
  ];
  const src = pts;

  const A: number[][] = [];
  const B: number[] = [];

  for (let i = 0; i < 4; i++) {
    const { x: X, y: Y } = dst[i];
    const { x, y } = src[i];

    A.push([x, y, 1, 0, 0, 0, -X * x, -X * y]);
    B.push(X);

    A.push([0, 0, 0, x, y, 1, -Y * x, -Y * y]);
    B.push(Y);
  }

  const solve8x8 = (mat: number[][], rhs: number[]): number[] | null => {
    const N = 8;
    const M = mat.map((row, i) => [...row, rhs[i]]);
    for (let i = 0; i < N; i++) {
      let maxRow = i;
      for (let k = i + 1; k < N; k++) {
        if (Math.abs(M[k][i]) > Math.abs(M[maxRow][i])) maxRow = k;
      }
      [M[i], M[maxRow]] = [M[maxRow], M[i]];
      if (Math.abs(M[i][i]) < 1e-9) return null;
      for (let k = i + 1; k < N; k++) {
        const c = -M[k][i] / M[i][i];
        for (let j = i; j <= N; j++) {
          if (i === j) M[k][j] = 0;
          else M[k][j] += c * M[i][j];
        }
      }
    }
    const x = new Array(N).fill(0);
    for (let i = N - 1; i >= 0; i--) {
      x[i] = M[i][N] / M[i][i];
      for (let k = i - 1; k >= 0; k--) {
        M[k][N] -= M[k][i] * x[i];
      }
    }
    return x;
  };

  const h = solve8x8(A, B);
  if (!h) return null;

  const Hinv = [
    [h[0], h[1], h[2]],
    [h[3], h[4], h[5]],
    [h[6], h[7], 1],
  ];

  return (x: number, y: number) => {
    const w = Hinv[2][0] * x + Hinv[2][1] * y + 1;
    const X = (Hinv[0][0] * x + Hinv[0][1] * y + Hinv[0][2]) / w;
    const Y = (Hinv[1][0] * x + Hinv[1][1] * y + Hinv[1][2]) / w;
    return { X, Y };
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
