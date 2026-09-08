import { describe, it, expect } from 'vitest';
import { detectDartAxisTip } from '../dartTip';
import {
  mulberry32,
  projectDartSilhouette,
  syntheticCamera,
  type SyntheticDart,
} from '../syntheticBoard';
import { computeCalibration } from '../boardProjection';
import type { Point } from '../../types';

type Vec3 = [number, number, number];
const polar = (r: number, deg: number): Point => {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: r * Math.cos(rad), y: r * Math.sin(rad) };
};
const norm3 = (v: Vec3): Vec3 => {
  const n = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / n, v[1] / n, v[2] / n];
};
const cross3 = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const rotateAbout = (v: Vec3, a: Vec3, ang: number): Vec3 => {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const d = a[0] * v[0] + a[1] * v[1] + a[2] * v[2];
  const cr = cross3(a, v);
  return norm3([
    v[0] * c + cr[0] * s + a[0] * d * (1 - c),
    v[1] * c + cr[1] * s + a[1] * d * (1 - c),
    v[2] * c + cr[2] * s + a[2] * d * (1 - c),
  ]);
};

const CANON: Point[] = [
  { x: 0, y: -170 },
  { x: 170, y: 0 },
  { x: 0, y: 170 },
  { x: -170, y: 0 },
];

function rig(pose: Parameters<typeof syntheticCamera>[0] = {}) {
  const distanceMM = pose.distanceMM ?? 2400;
  const pitch = pose.pitch ?? 0;
  const cam = syntheticCamera({
    distanceMM,
    focalPx: 1500,
    principalPoint: { x: 640, y: 360 },
    ...pose,
  });
  const calib = computeCalibration(
    CANON,
    CANON.map((p) => cam.project(p.x, p.y)),
  )!;
  // Kamerans centrum i board-systemet (R = rotX(pitch), t = [0,0,dist]).
  const cameraCentre: Vec3 = [0, -distanceMM * Math.sin(pitch), -distanceMM * Math.cos(pitch)];
  return { cam, calib, cameraCentre };
}

/** Pilriktning: mot kameran, lutad `tiltDeg` grader (kastbåge/vinkel). */
function dartDir(
  cameraCentre: Vec3,
  entry: Point,
  tiltDeg: number,
  azimuth: number,
): Vec3 {
  const toCam = norm3([cameraCentre[0] - entry.x, cameraCentre[1] - entry.y, cameraCentre[2]]);
  const inPlane: Vec3 = [Math.cos(azimuth), Math.sin(azimuth), 0];
  const axis = norm3(cross3(toCam, inPlane));
  return rotateAbout(toCam, axis, (tiltDeg * Math.PI) / 180);
}

describe('detectDartAxisTip', () => {
  it('hittar spetsen på en pil med normal kastvinkel', () => {
    const { cam, calib, cameraCentre } = rig({ pitch: 0.2 });
    const entry = polar(103, 0); // T20
    const dart: SyntheticDart = { entry, direction: dartDir(cameraCentre, entry, 25, Math.PI / 2) };
    const res = detectDartAxisTip(projectDartSilhouette(cam, dart))!;
    expect(res).not.toBeNull();
    const tipBoard = calib.unproject(res.tip.x, res.tip.y);
    expect(Math.hypot(tipBoard.x - entry.x, tipBoard.y - entry.y)).toBeLessThan(8);
  });

  it('väljer den smala änden även när fenan ligger närmare tavlans mitt', () => {
    const { cam, calib, cameraCentre } = rig({ pitch: 0.15 });
    const entry = polar(150, 90); // ytterkant, 3 o'clock
    // Lutar in mot centrum (azimuth mot -X).
    const dart: SyntheticDart = { entry, direction: dartDir(cameraCentre, entry, 28, Math.PI) };
    const pts = projectDartSilhouette(cam, dart);

    const res = detectDartAxisTip(pts)!;
    const tipBoard = calib.unproject(res.tip.x, res.tip.y);
    expect(Math.hypot(tipBoard.x - entry.x, tipBoard.y - entry.y)).toBeLessThan(10);

    // Gamla metoden ("närmast mitten") skulle plocka en punkt långt in.
    let nearest = pts[0];
    let best = Infinity;
    for (const p of pts) {
      const d = Math.hypot(p.x - 640, p.y - 360);
      if (d < best) {
        best = d;
        nearest = p;
      }
    }
    const nearestBoard = calib.unproject(nearest.x, nearest.y);
    expect(Math.hypot(nearestBoard.x - entry.x, nearestBoard.y - entry.y)).toBeGreaterThan(25);
  });

  it('fungerar för en pil nära bullen med tydlig kastvinkel', () => {
    const { cam, calib, cameraCentre } = rig({ pitch: 0.25, yaw: 0.1 });
    const entry = polar(14, 200);
    const dart: SyntheticDart = { entry, direction: dartDir(cameraCentre, entry, 32, 0) };
    const res = detectDartAxisTip(projectDartSilhouette(cam, dart))!;
    const tipBoard = calib.unproject(res.tip.x, res.tip.y);
    expect(Math.hypot(tipBoard.x - entry.x, tipBoard.y - entry.y)).toBeLessThan(7);
  });

  it('returnerar null för en nästan frontal pil (blir en rund blob)', () => {
    // Nära bullen, riktad nästan rakt mot linsen -> kraftigt förkortad.
    // Anroparen faller tillbaka på blobbens tyngdpunkt, som duger nära centrum.
    const { cam, cameraCentre } = rig({ pitch: 0.1 });
    const entry = polar(8, 0);
    const dart: SyntheticDart = { entry, direction: dartDir(cameraCentre, entry, 6, 0) };
    expect(detectDartAxisTip(projectDartSilhouette(cam, dart))).toBeNull();
  });

  it('ger en axel som pekar från fenan mot spetsen', () => {
    const { cam, cameraCentre } = rig({ pitch: 0.2 });
    const entry = polar(103, 0);
    const dart: SyntheticDart = { entry, direction: dartDir(cameraCentre, entry, 24, Math.PI / 3) };
    const res = detectDartAxisTip(projectDartSilhouette(cam, dart))!;
    const toTip = { x: res.tip.x - res.tail.x, y: res.tip.y - res.tail.y };
    expect(toTip.x * res.axis.x + toTip.y * res.axis.y).toBeGreaterThan(0);
    expect(res.confidence).toBeGreaterThan(0.4);
    expect(res.tailWidthPx).toBeGreaterThan(res.tipWidthPx * 1.8);
  });

  it('förkastar en rund blob (pil rakt mot linsen, eller skugga)', () => {
    const round: Point[] = [];
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * 2 * Math.PI;
      round.push({ x: 100 + 20 * Math.cos(a), y: 100 + 20 * Math.sin(a) });
    }
    expect(detectDartAxisTip(round)).toBeNull();
  });

  it('förkastar för få punkter', () => {
    expect(
      detectDartAxisTip([
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ]),
    ).toBeNull();
  });

  it('klarar brus på maskpunkterna', () => {
    const { cam, calib, cameraCentre } = rig({ pitch: 0.3, roll: 0.05 });
    const entry = polar(140, 315);
    const dart: SyntheticDart = { entry, direction: dartDir(cameraCentre, entry, 26, Math.PI / 4) };
    const rng = mulberry32(4);
    const pts = projectDartSilhouette(cam, dart).map((p) => ({
      x: p.x + (rng() - 0.5) * 3,
      y: p.y + (rng() - 0.5) * 3,
    }));
    const res = detectDartAxisTip(pts)!;
    const tipBoard = calib.unproject(res.tip.x, res.tip.y);
    expect(Math.hypot(tipBoard.x - entry.x, tipBoard.y - entry.y)).toBeLessThan(12);
  });
});

describe('råbild vs warpad bild', () => {
  /**
   * I den warpade bilden är pilkroppen utsmetad eftersom den sticker ut ur
   * tavlans plan. Spetspunkten (som ligger i planet) hamnar rätt i båda fallen,
   * men den utsmetade kroppen gör att avlångheten och breddtestet oftare inte
   * går att lita på - så fler giltiga pilar förkastas. Råbilden är alltså inte
   * noggrannare men mer robust.
   */
  it('råbilden förkastar färre giltiga pilar än den warpade', () => {
    let rawFail = 0;
    let warpedFail = 0;
    let rawWorstMM = 0;
    let cases = 0;

    for (const pose of [{ pitch: 0.2 }, { pitch: 0.4, yaw: 0.15 }, { pitch: 0.55 }]) {
      const { cam, calib, cameraCentre } = rig(pose);
      for (const [r, deg] of [
        [103, 0],
        [155, 45],
        [150, 90],
        [166, 135],
        [140, 225],
      ] as const) {
        const entry = polar(r, deg);
        for (const tilt of [18, 26, 34]) {
          for (const azi of [0, Math.PI / 2, Math.PI]) {
            cases++;
            const dir = dartDir(cameraCentre, entry, tilt, azi);
            const imgPts = projectDartSilhouette(cam, { entry, direction: dir });

            const raw = detectDartAxisTip(imgPts);
            if (!raw) {
              rawFail++;
            } else {
              const b = calib.unproject(raw.tip.x, raw.tip.y);
              rawWorstMM = Math.max(rawWorstMM, Math.hypot(b.x - entry.x, b.y - entry.y));
            }

            const warped = detectDartAxisTip(imgPts.map((p) => calib.unproject(p.x, p.y)));
            if (!warped) warpedFail++;
          }
        }
      }
    }

    expect(rawFail).toBeLessThan(warpedFail * 0.75);
    expect(rawWorstMM).toBeLessThan(3);
    expect(rawFail / cases).toBeLessThan(0.2);
  });
});
