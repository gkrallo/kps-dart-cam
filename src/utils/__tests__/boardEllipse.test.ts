import { describe, it, expect } from 'vitest';
import {
  calibrationFromRingEllipses,
  cardinalCalibrationPoints,
  ellipsePoint,
  fitEllipse,
  orientToImageUp,
  type Ellipse,
  type RingEllipse,
} from '../boardEllipse';
import { mulberry32, syntheticCamera } from '../syntheticBoard';
import { getScoreFromCanonicalCoordinates } from '../dartMath';
import type { Point } from '../../types';

const polar = (r: number, deg: number): Point => {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: r * Math.cos(rad), y: r * Math.sin(rad) };
};

/** Sampla en cirkel med radie r mm och projicera genom kameran. */
const projectedRing = (cam: ReturnType<typeof syntheticCamera>, r: number, n = 72): Point[] =>
  Array.from({ length: n }, (_, i) => {
    const a = (i / n) * 2 * Math.PI;
    return cam.project(r * Math.cos(a), r * Math.sin(a));
  });

const ringsFor = (cam: ReturnType<typeof syntheticCamera>): RingEllipse[] => [
  { ellipse: fitEllipse(projectedRing(cam, 170))!, radiusMM: 170 },
  { ellipse: fitEllipse(projectedRing(cam, 107))!, radiusMM: 107 },
];

/** Största radiella och vinkelfel när kända träffpunkter körs genom kalibreringen. */
function recoveryError(
  cam: ReturnType<typeof syntheticCamera>,
  calib: { unproject: (x: number, y: number) => Point },
) {
  let maxRadialMM = 0;
  let maxAngleDeg = 0;
  for (const [r, deg] of [
    [50, 0],
    [103, 0],
    [166, 0],
    [103, 90],
    [103, 180],
    [103, 270],
    [140, 45],
    [166, 135],
  ] as const) {
    const p = polar(r, deg);
    const px = cam.project(p.x, p.y);
    const b = calib.unproject(px.x, px.y);
    maxRadialMM = Math.max(maxRadialMM, Math.abs(Math.hypot(b.x, b.y) - r));
    let da = (Math.atan2(b.y, b.x) - Math.atan2(p.y, p.x)) * (180 / Math.PI);
    while (da > 180) da -= 360;
    while (da < -180) da += 360;
    maxAngleDeg = Math.max(maxAngleDeg, Math.abs(da));
  }
  return { maxRadialMM, maxAngleDeg };
}

describe('fitEllipse', () => {
  it('återskapar en känd ellips', () => {
    const truth: Ellipse = { cx: 320, cy: 240, rx: 150, ry: 90, theta: 0.4 };
    const pts = Array.from({ length: 40 }, (_, i) => ellipsePoint(truth, (i / 40) * 2 * Math.PI));
    const e = fitEllipse(pts)!;
    expect(e.cx).toBeCloseTo(truth.cx, 3);
    expect(e.cy).toBeCloseTo(truth.cy, 3);
    expect(Math.max(e.rx, e.ry)).toBeCloseTo(150, 3);
    expect(Math.min(e.rx, e.ry)).toBeCloseTo(90, 3);
    const dTheta = Math.abs(((e.theta - truth.theta + Math.PI / 2) % Math.PI) - Math.PI / 2);
    expect(dTheta).toBeLessThan(0.02);
  });

  it('anpassar exakt till en projicerad cirkel (perspektiv ger en exakt ellips)', () => {
    const cam = syntheticCamera({ pitch: 0.45, roll: 0.1, principalPoint: { x: 640, y: 360 } });
    const truthPts = projectedRing(cam, 170, 180);
    const e = fitEllipse(projectedRing(cam, 170, 48))!;
    // Varje sann punkt ska ligga mycket nära den anpassade ellipsen.
    let maxDev = 0;
    for (const tp of truthPts) {
      let best = Infinity;
      for (let j = 0; j < 2000; j++) {
        const ep = ellipsePoint(e, (j / 2000) * 2 * Math.PI);
        best = Math.min(best, Math.hypot(ep.x - tp.x, ep.y - tp.y));
      }
      maxDev = Math.max(maxDev, best);
    }
    expect(maxDev).toBeLessThan(0.3);
  });

  it('klarar brus på punkterna', () => {
    const truth: Ellipse = { cx: 100, cy: 100, rx: 120, ry: 80, theta: -0.3 };
    const rng = mulberry32(9);
    const pts = Array.from({ length: 60 }, (_, i) => {
      const p = ellipsePoint(truth, (i / 60) * 2 * Math.PI);
      return { x: p.x + (rng() - 0.5) * 3, y: p.y + (rng() - 0.5) * 3 };
    });
    const e = fitEllipse(pts)!;
    expect(e.cx).toBeCloseTo(100, 0);
    expect(e.cy).toBeCloseTo(100, 0);
    expect(Math.max(e.rx, e.ry)).toBeCloseTo(120, -1);
  });

  it('returnerar null för < 5 punkter och för en linje', () => {
    expect(fitEllipse([{ x: 0, y: 0 }])).toBeNull();
    const line = Array.from({ length: 10 }, (_, i) => ({ x: i, y: 2 * i }));
    expect(fitEllipse(line)).toBeNull();
  });
});

describe('en ring: kardinalpunkter fångar lutningen men inte perspektivet', () => {
  const cam = syntheticCamera({
    distanceMM: 2400,
    focalPx: 1500,
    pitch: 0.45,
    principalPoint: { x: 640, y: 360 },
  });
  const e = fitEllipse(projectedRing(cam, 170))!;

  it('ellipsen är märkbart hoptryckt av kameravinkeln', () => {
    expect(Math.min(e.rx, e.ry) / Math.max(e.rx, e.ry)).toBeLessThan(0.94);
  });

  it('en enda ring lämnar ett radiellt fel som en andra ring rättar', () => {
    const single = calibrationFromRingEllipses([{ ellipse: e, radiusMM: 170 }])!;
    const two = calibrationFromRingEllipses(ringsFor(cam))!;
    const singleErr = recoveryError(cam, single).maxRadialMM;
    const twoErr = recoveryError(cam, two).maxRadialMM;
    expect(singleErr).toBeGreaterThan(3); // affin approximation missar perspektivet
    expect(twoErr).toBeLessThan(1.5); // två ringar pinnar det
    expect(twoErr).toBeLessThan(singleErr / 3);
  });
});

describe('två ringar: perspektiv och skala återställs, rotation som startgissning', () => {
  it.each([
    ['lätt lutning', { pitch: 0.15 }],
    ['brant lutning', { pitch: 0.55, yaw: 0.1 }],
    ['lutning + roll', { pitch: 0.4, roll: 0.12 }],
    ['lutning + gir + roll', { pitch: 0.6, yaw: 0.2, roll: 0.15 }],
  ] as const)('%s: radiellt < 1.5 mm, rotation < 8°', (_name, pose) => {
    const cam = syntheticCamera({
      distanceMM: 2400,
      focalPx: 1500,
      principalPoint: { x: 640, y: 360 },
      ...pose,
    });
    const calib = orientToImageUp(calibrationFromRingEllipses(ringsFor(cam))!);
    const { maxRadialMM, maxAngleDeg } = recoveryError(cam, calib);
    expect(maxRadialMM).toBeLessThan(1.5);
    expect(maxAngleDeg).toBeLessThan(8);
    expect(calib.residualPx).toBeLessThan(0.6);
  });

  it('poängen räknas rätt mitt i sektorer och band', () => {
    const cam = syntheticCamera({
      distanceMM: 2400,
      focalPx: 1500,
      pitch: 0.4,
      yaw: -0.1,
      roll: 0.08,
      principalPoint: { x: 640, y: 360 },
    });
    const calib = orientToImageUp(calibrationFromRingEllipses(ringsFor(cam))!);
    for (const [r, deg, sector, ring] of [
      [103, 0, 20, 'T'],
      [140, 90, 6, 'S'],
      [166, 180, 3, 'D'],
      [140, 270, 11, 'S'],
      [0, 0, 25, 'DB'],
    ] as const) {
      const bp = polar(r, deg);
      const px = cam.project(bp.x, bp.y);
      const back = calib.unproject(px.x, px.y);
      const s = getScoreFromCanonicalCoordinates(back.x, back.y);
      if (ring === 'DB') {
        expect(s.label).toBe('DB');
      } else {
        expect(s.baseScore).toBe(sector);
        expect(s.label.startsWith(ring)).toBe(true);
      }
    }
  });

  it('klarar brus på de samplade ringpunkterna', () => {
    const cam = syntheticCamera({ pitch: 0.35, principalPoint: { x: 640, y: 360 } });
    const rng = mulberry32(123);
    const noisy = (r: number) =>
      projectedRing(cam, r).map((p) => ({ x: p.x + (rng() - 0.5) * 2, y: p.y + (rng() - 0.5) * 2 }));
    const noisyRings: RingEllipse[] = [
      { ellipse: fitEllipse(noisy(170))!, radiusMM: 170 },
      { ellipse: fitEllipse(noisy(107))!, radiusMM: 107 },
    ];
    const calib = orientToImageUp(calibrationFromRingEllipses(noisyRings)!);
    expect(recoveryError(cam, calib).maxRadialMM).toBeLessThan(3);
  });
});

describe('orientToImageUp', () => {
  it('sätter 20 uppåt även när tavlan är rullad i bild', () => {
    const cam = syntheticCamera({
      distanceMM: 2400,
      focalPx: 1500,
      pitch: 0.25,
      roll: 0.3,
      principalPoint: { x: 640, y: 360 },
    });
    const calib = orientToImageUp(calibrationFromRingEllipses(ringsFor(cam))!);
    const [top, right, bottom, left] = cardinalCalibrationPoints(calib);
    expect(top.y).toBeLessThan(bottom.y);
    expect(left.x).toBeLessThan(right.x);
  });
});
