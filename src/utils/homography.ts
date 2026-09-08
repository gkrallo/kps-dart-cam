import type { Point } from '../types';

/**
 * Homografilösare för kalibreringen.
 *
 * Den gamla `computeHomography` löste ett 8x8-system för hand med exakt fyra
 * punkter - noll redundans, ingen utjämning. Varje fel användaren gjorde när
 * hen drog en punkt gick rakt in i matrisen. Den här modulen är kärnan i en
 * överbestämd lösare:
 *
 *   1. Hartley-normalisera punkterna (annars är A illa konditionerad).
 *   2. DLT: bygg 2N x 9-systemet och ta nollrummet via egenvektorn till
 *      minsta egenvärdet av AtA (Jacobi-rotation, robust för 9x9).
 *   3. Levenberg-Marquardt som minimerar den geometriska reprojektionsfelet
 *      (DLT minimerar ett algebraiskt fel som inte är samma sak).
 *
 * Allt är ren aritmetik utan OpenCV: lösaren körs i React-render för
 * wireframe-överlägget och i tester i Node utan WASM.
 */

// Radmajor 3x3.
export type Mat3 = [number, number, number, number, number, number, number, number, number];

export function applyHomography(H: Mat3, x: number, y: number): Point {
  const w = H[6] * x + H[7] * y + H[8];
  return {
    x: (H[0] * x + H[1] * y + H[2]) / w,
    y: (H[3] * x + H[4] * y + H[5]) / w,
  };
}

export function multiplyMat3(A: Mat3, B: Mat3): Mat3 {
  const C: Mat3 = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      let s = 0;
      for (let k = 0; k < 3; k++) s += A[r * 3 + k] * B[k * 3 + c];
      C[r * 3 + c] = s;
    }
  }
  return C;
}

export function invertMat3(H: Mat3): Mat3 | null {
  const [a, b, c, d, e, f, g, h, i] = H;
  const A = e * i - f * h;
  const B = f * g - d * i;
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (!isFinite(det) || Math.abs(det) < 1e-18) return null;
  const inv = 1 / det;
  return [
    A * inv, (c * h - b * i) * inv, (b * f - c * e) * inv,
    B * inv, (a * i - c * g) * inv, (c * d - a * f) * inv,
    C * inv, (b * g - a * h) * inv, (a * e - b * d) * inv,
  ];
}

/**
 * Löser A x = b för kvadratiska A med Gauss-Jordan och partiell pivotering.
 * Returnerar null om systemet är singulärt.
 */
export function solveLinearSystem(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    }
    if (Math.abs(M[pivot][col]) < 1e-15) return null;
    [M[col], M[pivot]] = [M[pivot], M[col]];

    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = M[r][col] / M[col][col];
      for (let k = col; k <= n; k++) M[r][k] -= factor * M[col][k];
    }
  }

  return M.map((row, i) => row[n] / row[i]);
}

/**
 * Jacobi-egenvärdesalgoritm för en symmetrisk n x n-matris.
 * `vectors[k]` är egenvektorn som hör till `values[k]`.
 */
export function jacobiEigenSymmetric(
  input: number[][],
  maxSweeps = 80,
): { values: number[]; vectors: number[][] } {
  const n = input.length;
  const a = input.map((row) => row.slice());
  const v: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
  );

  for (let sweep = 0; sweep < maxSweeps; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) off += a[p][q] * a[p][q];
    }
    if (off < 1e-24) break;

    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = a[p][q];
        if (Math.abs(apq) < 1e-300) continue;

        const theta = (a[q][q] - a[p][p]) / (2 * apq);
        const t =
          theta === 0 ? 1 : Math.sign(theta) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        const tau = s / (1 + c);

        a[p][p] -= t * apq;
        a[q][q] += t * apq;
        a[p][q] = 0;
        a[q][p] = 0;

        for (let i = 0; i < n; i++) {
          if (i !== p && i !== q) {
            const aip = a[i][p];
            const aiq = a[i][q];
            a[i][p] = aip - s * (aiq + tau * aip);
            a[p][i] = a[i][p];
            a[i][q] = aiq + s * (aip - tau * aiq);
            a[q][i] = a[i][q];
          }
          const vip = v[i][p];
          const viq = v[i][q];
          v[i][p] = vip - s * (viq + tau * vip);
          v[i][q] = viq + s * (vip - tau * viq);
        }
      }
    }
  }

  const values = a.map((row, i) => row[i]);
  const vectors = Array.from({ length: n }, (_, col) => v.map((row) => row[col]));
  return { values, vectors };
}

function normalize(pts: Point[]): { T: Mat3; pts: Point[] } | null {
  const n = pts.length;
  let cx = 0;
  let cy = 0;
  for (const p of pts) {
    cx += p.x;
    cy += p.y;
  }
  cx /= n;
  cy /= n;

  let meanDist = 0;
  for (const p of pts) meanDist += Math.hypot(p.x - cx, p.y - cy);
  meanDist /= n;
  if (meanDist < 1e-12) return null;

  const s = Math.SQRT2 / meanDist;
  const T: Mat3 = [s, 0, -s * cx, 0, s, -s * cy, 0, 0, 1];
  return { T, pts: pts.map((p) => ({ x: s * (p.x - cx), y: s * (p.y - cy) })) };
}

/**
 * Direkt linjär transform. `src` mappas till `dst`. Kräver minst fyra par;
 * fler par ger en minsta-kvadrat-lösning.
 */
export function solveHomographyDLT(src: Point[], dst: Point[]): Mat3 | null {
  if (src.length !== dst.length || src.length < 4) return null;

  const ns = normalize(src);
  const nd = normalize(dst);
  if (!ns || !nd) return null;

  const rows: number[][] = [];
  for (let i = 0; i < ns.pts.length; i++) {
    const { x: X, y: Y } = ns.pts[i];
    const { x, y } = nd.pts[i];
    rows.push([-X, -Y, -1, 0, 0, 0, x * X, x * Y, x]);
    rows.push([0, 0, 0, -X, -Y, -1, y * X, y * Y, y]);
  }

  const AtA: number[][] = Array.from({ length: 9 }, () => new Array(9).fill(0));
  for (const row of rows) {
    for (let i = 0; i < 9; i++) {
      for (let j = 0; j < 9; j++) AtA[i][j] += row[i] * row[j];
    }
  }

  const { values, vectors } = jacobiEigenSymmetric(AtA);
  let minIdx = 0;
  for (let i = 1; i < 9; i++) if (values[i] < values[minIdx]) minIdx = i;
  const h = vectors[minIdx];

  const Hn: Mat3 = [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], h[8]];
  const TdstInv = invertMat3(nd.T);
  if (!TdstInv) return null;

  const H = multiplyMat3(multiplyMat3(TdstInv, Hn), ns.T);
  if (Math.abs(H[8]) > 1e-12) {
    for (let i = 0; i < 9; i++) H[i] /= H[8];
  }
  return H;
}

export interface ReprojectionError {
  /** Kvadratiskt medelvärde av avståndet mellan projicerad och uppmätt punkt (px). */
  rms: number;
  /** Största enskilda avståndet (px). */
  max: number;
  /** Avstånd per punkt (px). */
  perPoint: number[];
}

export function homographyReprojectionError(H: Mat3, src: Point[], dst: Point[]): ReprojectionError {
  const perPoint: number[] = [];
  let sumSq = 0;
  let max = 0;
  for (let i = 0; i < src.length; i++) {
    const p = applyHomography(H, src[i].x, src[i].y);
    const d = Math.hypot(p.x - dst[i].x, p.y - dst[i].y);
    perPoint.push(d);
    sumSq += d * d;
    if (d > max) max = d;
  }
  return { rms: Math.sqrt(sumSq / src.length), max, perPoint };
}

/**
 * Levenberg-Marquardt som minimerar reprojektionsfelet. Parametriserar med
 * H[8] = 1 (åtta frihetsgrader), så en homografi där H[8] ligger nära noll
 * lämnas orörd - det inträffar bara vid orimliga kameravinklar.
 */
export function refineHomography(
  H0: Mat3,
  src: Point[],
  dst: Point[],
  opts: { iterations?: number } = {},
): Mat3 {
  const iterations = opts.iterations ?? 40;
  if (Math.abs(H0[8]) < 1e-12) return H0;

  let h = H0.map((val) => val / H0[8]) as Mat3;
  let lambda = 1e-3;
  let prevErr = homographyReprojectionError(h, src, dst).rms;

  for (let iter = 0; iter < iterations; iter++) {
    const JtJ: number[][] = Array.from({ length: 8 }, () => new Array(8).fill(0));
    const Jtr: number[] = new Array(8).fill(0);

    for (let i = 0; i < src.length; i++) {
      const X = src[i].x;
      const Y = src[i].y;
      const u = h[0] * X + h[1] * Y + h[2];
      const vv = h[3] * X + h[4] * Y + h[5];
      const w = h[6] * X + h[7] * Y + 1;
      const px = u / w;
      const py = vv / w;
      const rx = px - dst[i].x;
      const ry = py - dst[i].y;

      const jx = [X / w, Y / w, 1 / w, 0, 0, 0, (-px * X) / w, (-px * Y) / w];
      const jy = [0, 0, 0, X / w, Y / w, 1 / w, (-py * X) / w, (-py * Y) / w];

      for (let a = 0; a < 8; a++) {
        Jtr[a] += jx[a] * rx + jy[a] * ry;
        for (let b = 0; b < 8; b++) JtJ[a][b] += jx[a] * jx[b] + jy[a] * jy[b];
      }
    }

    const damped = JtJ.map((row, a) => row.map((val, b) => (a === b ? val * (1 + lambda) : val)));
    const delta = solveLinearSystem(
      damped,
      Jtr.map((val) => -val),
    );
    if (!delta) {
      lambda *= 4;
      if (lambda > 1e9) break;
      continue;
    }

    const candidate = h.slice() as Mat3;
    for (let a = 0; a < 8; a++) candidate[a] += delta[a];
    const err = homographyReprojectionError(candidate, src, dst).rms;

    if (err < prevErr) {
      h = candidate;
      prevErr = err;
      lambda = Math.max(lambda / 3, 1e-9);
      if (delta.every((d) => Math.abs(d) < 1e-10)) break;
    } else {
      lambda *= 4;
      if (lambda > 1e9) break;
    }
  }

  return h;
}

export interface HomographyEstimate {
  H: Mat3;
  rms: number;
  max: number;
}

/**
 * Hela kedjan: DLT-startgissning, sedan LM-refinement. `refine` är på som
 * standard när det finns fler än fyra par (fyra par ger en exakt DLT-lösning
 * där refinement inte tillför något).
 */
export function estimateHomography(
  src: Point[],
  dst: Point[],
  opts: { refine?: boolean } = {},
): HomographyEstimate | null {
  const dlt = solveHomographyDLT(src, dst);
  if (!dlt) return null;

  const refine = opts.refine ?? src.length > 4;
  const H = refine ? refineHomography(dlt, src, dst) : dlt;
  const { rms, max } = homographyReprojectionError(H, src, dst);
  return { H, rms, max };
}
