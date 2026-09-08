import { describe, it, expect } from 'vitest';
import { syntheticCamera } from '../syntheticBoard';
import { computeCalibration } from '../boardProjection';
import type { Point } from '../../types';

/**
 * Parallaxfelet från en enda kamera.
 *
 * En pil sticker ut ur tavlans plan mot kameran. Homografin gäller bara i
 * planet (Z = 0), så så fort detektorn tar en punkt på pilkroppen i stället för
 * exakt där spetsen gick in, hamnar av-projektionen fel. Det är inte ett
 * kalibreringsfel utan ett detekteringsfel, och det är taket för en kamera.
 *
 * Modell: pilen är ett 3D-segment från ingångspunkten E och 90 mm utåt. En pil
 * som fastnar pekar ungefär mot kastaren - alltså mot kameran - men inte exakt:
 * kastbågen gör att pilen i tavlan lutar 0-20 grader från linjen till linsen.
 * "Nuvarande detektor" tar punkten på pilkroppens projektion vars av-projektion
 * ligger närmast tavlans mitt (heuristiken i `useDartDetector`).
 *
 * Uppmätt (avstånd 2500 mm, brännvidd 1500 px, utstick 90 mm, kamera rakt på):
 *
 *   pil-lutning från linsen   medelfel   värsta fall (dubbelringen, D20)
 *   -----------------------   --------   ------------------------------
 *   0 grader (rakt mot lins)   ~0 mm      ~0 mm
 *   5 grader                    2.2 mm     8 mm
 *   10 grader                   4.1 mm     16 mm
 *   15 grader                   6.1 mm     24 mm
 *
 * Felet är systematiskt inåt. Att vinkla kameran brant nedåt (43 grader) hjälper
 * **inte** - medelfelet blir snarare något större (2.6 / 4.7 / 7.1 mm). Med
 * idealisk spetsdetektering är felet ~0 oavsett vinkel. Slutsats: lägg inte tid
 * på kameraplacering - lös spetsdetekteringen i råbilden (AGENT.md punkt 1),
 * eller använd två kameror.
 */

const polar = (r: number, deg: number): Point => {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: r * Math.cos(rad), y: r * Math.sin(rad) };
};

const CANON: Point[] = [
  { x: 0, y: -170 },
  { x: 170, y: 0 },
  { x: 0, y: 170 },
  { x: -170, y: 0 },
];

type Vec3 = [number, number, number];
const norm = (v: Vec3): Vec3 => {
  const n = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / n, v[1] / n, v[2] / n];
};
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
/** Rodrigues: rotera v runt enhetsaxeln a med vinkeln ang. */
const rotateAbout = (v: Vec3, a: Vec3, ang: number): Vec3 => {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const d = a[0] * v[0] + a[1] * v[1] + a[2] * v[2];
  const cr = cross(a, v);
  return [
    v[0] * c + cr[0] * s + a[0] * d * (1 - c),
    v[1] * c + cr[1] * s + a[1] * d * (1 - c),
    v[2] * c + cr[2] * s + a[2] * d * (1 - c),
  ];
};

interface Rig {
  cam: ReturnType<typeof syntheticCamera>;
  calib: NonNullable<ReturnType<typeof computeCalibration>>;
  cameraCentreBoard: Vec3;
}

function rig(pitch: number): Rig {
  const distanceMM = 2500;
  const cam = syntheticCamera({
    distanceMM,
    focalPx: 1500,
    pitch,
    principalPoint: { x: 640, y: 360 },
  });
  const calib = computeCalibration(
    CANON,
    CANON.map((p) => cam.project(p.x, p.y)),
  )!;
  // Kamerans centrum i board-systemet: R^T (-t), R = rotX(pitch), t = [0,0,dist].
  const c = Math.cos(pitch);
  const s = Math.sin(pitch);
  const cameraCentreBoard: Vec3 = [0, -distanceMM * s, -distanceMM * c];
  return { cam, calib, cameraCentreBoard };
}

/** Pilens riktning: mot kameran, sedan lutad `arcRad` runt en axel i planet. */
function dartDirection(r: Rig, E: Point, arcRad: number, azimuth: number): Vec3 {
  const toCam = norm([
    r.cameraCentreBoard[0] - E.x,
    r.cameraCentreBoard[1] - E.y,
    r.cameraCentreBoard[2],
  ]);
  if (arcRad === 0) return toCam;
  const inPlane: Vec3 = [Math.cos(azimuth), Math.sin(azimuth), 0];
  const axis = norm(cross(toCam, inPlane));
  return norm(rotateAbout(toCam, axis, arcRad));
}

/** Av-projicerad board-punkt om spetsen detekteras exakt. */
function idealTip(r: Rig, E: Point): Point {
  const img = r.cam.project3D(E.x, E.y, 0);
  return r.calib.unproject(img.x, img.y);
}

/** "Punkten närmast tavlans mitt" längs pilkroppens projektion (nuvarande metod). */
function nearestToCentreTip(r: Rig, E: Point, dir: Vec3, lengthMM = 90): Point {
  let best: Point = E;
  let bestR = Infinity;
  for (let i = 0; i <= 60; i++) {
    const t = (i / 60) * lengthMM;
    const img = r.cam.project3D(E.x + dir[0] * t, E.y + dir[1] * t, dir[2] * t);
    const b = r.calib.unproject(img.x, img.y);
    const rad = Math.hypot(b.x, b.y);
    if (rad < bestR) {
      bestR = rad;
      best = b;
    }
  }
  return best;
}

const ENTRIES: [string, Point][] = [
  ['bull', polar(3, 0)],
  ['T20', polar(103, 0)],
  ['D20', polar(166, 0)],
  ['T6', polar(103, 90)],
  ['S11', polar(140, 270)],
  ['D13', polar(166, 315)],
];
const AZIMUTHS = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2];

function meanError(pitch: number, arcRad: number): number {
  const r = rig(pitch);
  let sum = 0;
  let n = 0;
  for (const [, E] of ENTRIES) {
    for (const azi of AZIMUTHS) {
      const d = dartDirection(r, E, arcRad, azi);
      const got = nearestToCentreTip(r, E, d);
      sum += Math.hypot(got.x - E.x, got.y - E.y);
      n++;
    }
  }
  return sum / n;
}

describe('parallax: homografin är inte problemet', () => {
  it.each([0, 0.25, 0.5, 0.75])('idealisk spetsdetektering ger ~0 fel (kameravinkel %f)', (pitch) => {
    const r = rig(pitch);
    for (const [, E] of ENTRIES) {
      const got = idealTip(r, E);
      expect(Math.hypot(got.x - E.x, got.y - E.y)).toBeLessThan(0.02);
    }
  });

  it('en pil som pekar rakt mot linsen ger nästan inget fel', () => {
    expect(meanError(0, 0)).toBeLessThan(0.5);
    expect(meanError(0.5, 0)).toBeLessThan(0.5);
  });
});

describe('parallax: "närmast mitten"-heuristiken under kastbåge', () => {
  it('~10 graders lutning ger flera mm fel, värre nära kanten', () => {
    const r = rig(0);
    let worst = 0;
    for (const [, E] of ENTRIES) {
      for (const azi of AZIMUTHS) {
        const d = dartDirection(r, E, 0.17, azi);
        const got = nearestToCentreTip(r, E, d);
        worst = Math.max(worst, Math.hypot(got.x - E.x, got.y - E.y));
      }
    }
    expect(meanError(0, 0.17)).toBeGreaterThan(2);
    expect(worst).toBeGreaterThan(10);
  });

  it('felet växer med lutningen', () => {
    expect(meanError(0, 0.09)).toBeGreaterThan(meanError(0, 0));
    expect(meanError(0, 0.17)).toBeGreaterThan(meanError(0, 0.09));
  });

  it('biaset är systematiskt inåt', () => {
    const r = rig(0);
    for (const [name, E] of ENTRIES) {
      if (name === 'bull') continue;
      const trueR = Math.hypot(E.x, E.y);
      for (const azi of AZIMUTHS) {
        const d = dartDirection(r, E, 0.17, azi);
        const got = nearestToCentreTip(r, E, d);
        expect(Math.hypot(got.x, got.y)).toBeLessThanOrEqual(trueR + 0.01);
      }
    }
  });

  it('att vinkla kameran brant nedåt hjälper inte', () => {
    const level = meanError(0, 0.17);
    const steep = meanError(0.75, 0.17);
    // Inte en förbättring värd namnet - inom ~40 % av varandra åt något håll.
    expect(steep).toBeGreaterThan(level * 0.6);
  });
});
