import type { Point } from '../types';
import { BOARD_MM } from './dartMath';

/**
 * Syntetisk darttavla för test och felsökning.
 *
 * Datorseendet kan i praktiken bara verifieras mot en riktig tavla - utom den
 * delen som är ren geometri. Den här modulen renderar en geometriskt exakt
 * tavla (samma mått som `BOARD_MM`) genom en känd kamera, med valfri
 * linsdistorsion och brus. Då kan kalibrering, ellipsanpassning och
 * poänggeometri testas offline mot en känd sanning.
 *
 * Renderaren är en enkel programvaru-rasterizer: för varje bildpixel går den
 * baklänges genom kameran till mm på tavlan och slår upp färgen. Ingen canvas,
 * inget beroende - och exakt, eftersom den inte kantutjämnar.
 */

export type RGB = [number, number, number];

/** Ungefärliga färger på en riktig tavla. */
export const BOARD_COLORS = {
  black: [28, 28, 26] as RGB,
  cream: [235, 222, 178] as RGB,
  red: [196, 48, 43] as RGB,
  green: [38, 138, 71] as RGB,
  wire: [176, 178, 183] as RGB,
  outside: [92, 92, 98] as RGB,
};

export interface BoardColorOptions {
  /** Trådarnas bredd i mm (sektorgränser och ringgränser). */
  wireWidthMM?: number;
  /** Färg utanför dubbelringen (vägg/bakgrund). */
  outside?: RGB;
}

/**
 * Färgen på tavlan i en given mm-punkt (bullseye i origo, Y nedåt - samma
 * konvention som `getScoreFromCanonicalCoordinates`).
 *
 * Sektor 20 (index 0) är en "mörk" sektor: svart enkelfält, röd dubbel/trippel.
 * Sektorerna växlar mörkt/ljust medurs, och eftersom de är 20 (jämnt) går det
 * jämnt ut hela varvet.
 */
export function boardColorAt(X: number, Y: number, opts: BoardColorOptions = {}): RGB {
  const wire = opts.wireWidthMM ?? 1.2;
  const half = wire / 2;
  const r = Math.hypot(X, Y);
  const M = BOARD_MM;

  if (r > M.doubleOuter + half) return opts.outside ?? BOARD_COLORS.outside;

  const nearEdge = (edge: number) => Math.abs(r - edge) <= half;
  if (
    nearEdge(M.doubleOuter) ||
    nearEdge(M.doubleInner) ||
    nearEdge(M.tripleOuter) ||
    nearEdge(M.tripleInner) ||
    nearEdge(M.outerBull)
  ) {
    return BOARD_COLORS.wire;
  }

  if (r <= M.innerBull) return BOARD_COLORS.red; // 50
  if (r <= M.outerBull) return BOARD_COLORS.green; // 25

  const deg = (Math.atan2(Y, X) * 180) / Math.PI;
  const normDeg = (deg + 90 + 360) % 360;

  // Radiella trådar var 18:e grad, mitt mellan sektorcentrumen (offset 9 grader).
  const withinSector = (normDeg + 9) % 18;
  const distToBoundaryDeg = Math.min(withinSector, 18 - withinSector);
  if (((distToBoundaryDeg * Math.PI) / 180) * r <= half) return BOARD_COLORS.wire;

  const sectorIndex = Math.floor(((normDeg + 9) % 360) / 18);
  const dark = sectorIndex % 2 === 0;
  const inRing =
    (r >= M.tripleInner && r <= M.tripleOuter) || (r >= M.doubleInner && r <= M.doubleOuter);

  if (inRing) return dark ? BOARD_COLORS.red : BOARD_COLORS.green;
  return dark ? BOARD_COLORS.black : BOARD_COLORS.cream;
}

/** Deterministisk PRNG för reproducerbara tester. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Mat33 = [Vec3, Vec3, Vec3];
type Vec3 = [number, number, number];

function rotX(t: number): Mat33 {
  const c = Math.cos(t);
  const s = Math.sin(t);
  return [
    [1, 0, 0],
    [0, c, -s],
    [0, s, c],
  ];
}
function rotY(t: number): Mat33 {
  const c = Math.cos(t);
  const s = Math.sin(t);
  return [
    [c, 0, s],
    [0, 1, 0],
    [-s, 0, c],
  ];
}
function rotZ(t: number): Mat33 {
  const c = Math.cos(t);
  const s = Math.sin(t);
  return [
    [c, -s, 0],
    [s, c, 0],
    [0, 0, 1],
  ];
}
function matMul(A: Mat33, B: Mat33): Mat33 {
  const C: Mat33 = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      let s = 0;
      for (let k = 0; k < 3; k++) s += A[i][k] * B[k][j];
      C[i][j] = s;
    }
  }
  return C;
}
function matVec(A: Mat33, v: Vec3): Vec3 {
  return [
    A[0][0] * v[0] + A[0][1] * v[1] + A[0][2] * v[2],
    A[1][0] * v[0] + A[1][1] * v[1] + A[1][2] * v[2],
    A[2][0] * v[0] + A[2][1] * v[1] + A[2][2] * v[2],
  ];
}
function transpose(A: Mat33): Mat33 {
  return [
    [A[0][0], A[1][0], A[2][0]],
    [A[0][1], A[1][1], A[2][1]],
    [A[0][2], A[1][2], A[2][2]],
  ];
}

export interface SyntheticCameraPose {
  /** Avstånd kamera - tavlans centrum, mm. */
  distanceMM?: number;
  /** Brännvidd i pixlar. */
  focalPx?: number;
  /** Kameran lutad nedåt (nick), radianer. Positivt = tittar nedåt. */
  pitch?: number;
  /** Kameran vriden i sidled (gir), radianer. */
  yaw?: number;
  /** Tavlan roterad i bilden (roll), radianer. */
  roll?: number;
  /** Bildens principalpunkt (mittpunkt), px. */
  principalPoint?: Point;
}

export interface SyntheticCamera {
  /** mm på tavlan -> pixel i bilden. */
  project: (X: number, Y: number) => Point;
  /** mm i tavlans referenssystem (Z ut ur tavlan mot betraktaren) -> pixel. */
  project3D: (X: number, Y: number, Z: number) => Point;
  /** pixel i bilden -> mm på tavlan (tavlans plan Z = 0). */
  unproject: (x: number, y: number) => Point;
}

/**
 * Pinhole-kamera som tittar på tavlans plan. Tavlan ligger i Z = 0 med Y nedåt;
 * kameran sitter på +Z-axeln `distanceMM` bort och roteras med gir/nick/roll.
 * Detta är en riktig perspektivprojektion, inte bara en homografi - så den
 * duger även när vi vill modellera pilar som sticker ut ur planet (parallax).
 */
export function syntheticCamera(pose: SyntheticCameraPose = {}): SyntheticCamera {
  const dist = pose.distanceMM ?? 2500;
  const f = pose.focalPx ?? 1400;
  const pitch = pose.pitch ?? 0;
  const yaw = pose.yaw ?? 0;
  const roll = pose.roll ?? 0;
  const pp = pose.principalPoint ?? { x: 0, y: 0 };

  const R = matMul(matMul(rotY(yaw), rotX(pitch)), rotZ(roll));
  const Rt = transpose(R);
  const t: Vec3 = [0, 0, dist];

  const project3D = (X: number, Y: number, Z: number): Point => {
    const pc = matVec(R, [X, Y, Z]);
    const z = pc[2] + t[2];
    return { x: pp.x + (f * (pc[0] + t[0])) / z, y: pp.y + (f * (pc[1] + t[1])) / z };
  };
  const project = (X: number, Y: number): Point => project3D(X, Y, 0);

  const unproject = (x: number, y: number): Point => {
    const dir: Vec3 = [(x - pp.x) / f, (y - pp.y) / f, 1];
    const dirBoard = matVec(Rt, dir);
    const tBoard = matVec(Rt, t);
    // Lös lambda så att (Rt (lambda*dir - t)).z = 0.
    const lambda = tBoard[2] / dirBoard[2];
    const pBoard: Vec3 = [
      dirBoard[0] * lambda - tBoard[0],
      dirBoard[1] * lambda - tBoard[1],
      dirBoard[2] * lambda - tBoard[2],
    ];
    return { x: pBoard[0], y: pBoard[1] };
  };

  return { project, project3D, unproject };
}

export interface RenderOptions {
  width: number;
  height: number;
  /** pixel i bilden -> mm på tavlan, t.ex. `syntheticCamera().unproject`. */
  unproject: (x: number, y: number) => Point;
  colorOptions?: BoardColorOptions;
  /** Radiell linsdistorsion (Brown) kring principalpunkten. */
  distortion?: { k1?: number; k2?: number; cx?: number; cy?: number; focalPx?: number };
  /** Additivt gaussiskt pixelbrus, standardavvikelse i skalan 0-255. */
  noiseStdDev?: number;
  rng?: () => number;
}

export interface SyntheticImage {
  width: number;
  height: number;
  /** RGBA, radmajor, längd = width * height * 4. */
  data: Uint8ClampedArray;
}

export function renderSyntheticBoard(opts: RenderOptions): SyntheticImage {
  const { width, height, unproject } = opts;
  const data = new Uint8ClampedArray(width * height * 4);
  const rng = opts.rng ?? Math.random;
  const noise = opts.noiseStdDev ?? 0;

  const d = opts.distortion;
  const cx = d?.cx ?? width / 2;
  const cy = d?.cy ?? height / 2;
  const focal = d?.focalPx ?? Math.max(width, height);
  const k1 = d?.k1 ?? 0;
  const k2 = d?.k2 ?? 0;
  const distorted = k1 !== 0 || k2 !== 0;

  // Observerad (distorderad) pixel -> ideal pixel. Brown-modellen är enkel att
  // applicera framåt men måste inverteras iterativt.
  const undistort = (px: number, py: number): Point => {
    if (!distorted) return { x: px, y: py };
    const xd = (px - cx) / focal;
    const yd = (py - cy) / focal;
    let xu = xd;
    let yu = yd;
    for (let it = 0; it < 8; it++) {
      const r2 = xu * xu + yu * yu;
      const factor = 1 + k1 * r2 + k2 * r2 * r2;
      xu = xd / factor;
      yu = yd / factor;
    }
    return { x: xu * focal + cx, y: yu * focal + cy };
  };

  let gaussSpare: number | null = null;
  const gauss = (): number => {
    if (gaussSpare !== null) {
      const v = gaussSpare;
      gaussSpare = null;
      return v;
    }
    let u = 0;
    let v = 0;
    while (u === 0) u = rng();
    while (v === 0) v = rng();
    const mag = Math.sqrt(-2 * Math.log(u));
    gaussSpare = mag * Math.sin(2 * Math.PI * v);
    return mag * Math.cos(2 * Math.PI * v);
  };

  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const ideal = undistort(px + 0.5, py + 0.5);
      const board = unproject(ideal.x, ideal.y);
      const [r, g, b] = boardColorAt(board.x, board.y, opts.colorOptions);
      const idx = (py * width + px) * 4;
      if (noise > 0) {
        data[idx] = r + gauss() * noise;
        data[idx + 1] = g + gauss() * noise;
        data[idx + 2] = b + gauss() * noise;
      } else {
        data[idx] = r;
        data[idx + 1] = g;
        data[idx + 2] = b;
      }
      data[idx + 3] = 255;
    }
  }

  return { width, height, data };
}

/** Färgen i en bildpunkt (närmaste pixel, klippt till bildens kanter). */
export function sampleImage(img: SyntheticImage, x: number, y: number): RGB {
  const px = Math.min(img.width - 1, Math.max(0, Math.round(x)));
  const py = Math.min(img.height - 1, Math.max(0, Math.round(y)));
  const idx = (py * img.width + px) * 4;
  return [img.data[idx], img.data[idx + 1], img.data[idx + 2]];
}
