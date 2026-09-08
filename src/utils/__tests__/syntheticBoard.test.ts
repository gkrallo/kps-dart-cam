import { describe, it, expect } from 'vitest';
import {
  BOARD_COLORS,
  boardColorAt,
  mulberry32,
  renderSyntheticBoard,
  sampleImage,
  syntheticCamera,
} from '../syntheticBoard';
import { computeCalibration } from '../boardProjection';
import { getScoreFromCanonicalCoordinates } from '../dartMath';
import type { Point } from '../../types';

/** Punkt på radie r mm, deg grader medurs från toppen. */
const polar = (r: number, deg: number): Point => {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: r * Math.cos(rad), y: r * Math.sin(rad) };
};

describe('boardColorAt', () => {
  it('mitten är röd dubbelbull', () => {
    expect(boardColorAt(0, 0)).toEqual(BOARD_COLORS.red);
  });

  it('yttre bull är grön', () => {
    expect(boardColorAt(0, -11)).toEqual(BOARD_COLORS.green);
  });

  it('utanför dubbelringen är bakgrund', () => {
    expect(boardColorAt(0, -200)).toEqual(BOARD_COLORS.outside);
  });

  it('20:ans band är röda (mörk sektor), 1:ans är gröna (ljus sektor)', () => {
    expect(boardColorAt(0, -103)).toEqual(BOARD_COLORS.red); // T20-bandet
    const s1 = polar(103, 18);
    expect(boardColorAt(s1.x, s1.y)).toEqual(BOARD_COLORS.green);
  });

  it('20:ans enkelfält är svart, 1:ans är gräddvitt', () => {
    expect(boardColorAt(0, -140)).toEqual(BOARD_COLORS.black);
    const s1 = polar(140, 18);
    expect(boardColorAt(s1.x, s1.y)).toEqual(BOARD_COLORS.cream);
  });

  it('ringgränserna ritas som tråd', () => {
    expect(boardColorAt(0, -170)).toEqual(BOARD_COLORS.wire); // doubleOuter
    expect(boardColorAt(0, -107)).toEqual(BOARD_COLORS.wire); // tripleOuter
  });
});

describe('syntheticCamera', () => {
  it('project och unproject är inverser', () => {
    const cam = syntheticCamera({
      pitch: 0.4,
      yaw: -0.2,
      roll: 0.1,
      principalPoint: { x: 320, y: 240 },
    });
    for (const p of [
      { x: 0, y: 0 },
      { x: 170, y: 0 },
      { x: -120, y: 90 },
      { x: 40, y: -160 },
    ]) {
      const img = cam.project(p.x, p.y);
      const back = cam.unproject(img.x, img.y);
      expect(back.x).toBeCloseTo(p.x, 6);
      expect(back.y).toBeCloseTo(p.y, 6);
    }
  });

  it('en frontal kamera projicerar rakt av', () => {
    const cam = syntheticCamera({ distanceMM: 2000, focalPx: 2000, principalPoint: { x: 0, y: 0 } });
    expect(cam.project(0, 0)).toEqual({ x: 0, y: 0 });
    expect(cam.project(100, 0).x).toBeCloseTo(100, 6); // f/dist = 1 px/mm
  });
});

describe('renderSyntheticBoard', () => {
  const cam = syntheticCamera({
    distanceMM: 2200,
    focalPx: 1500,
    pitch: 0.25,
    roll: 0.03,
    principalPoint: { x: 320, y: 240 },
  });

  it('mitten är bull, hörnet är bakgrund', () => {
    const img = renderSyntheticBoard({ width: 640, height: 480, unproject: cam.unproject });
    const bull = cam.project(0, 0);
    expect(sampleImage(img, bull.x, bull.y)).toEqual(BOARD_COLORS.red);
    expect(sampleImage(img, 2, 2)).toEqual(BOARD_COLORS.outside);
  });

  it('dubbel- och trippelringen syns där geometrin säger', () => {
    const img = renderSyntheticBoard({ width: 640, height: 480, unproject: cam.unproject });
    const found = new Set<string>();
    for (let r = 0; r <= 175; r += 0.5) {
      const px = cam.project(0, -r); // utåt längs sektor 20
      const [rr, gg] = sampleImage(img, px.x, px.y);
      const isRed = rr > 150 && gg < 90;
      if (r > 99 && r < 107 && isRed) found.add('triple');
      if (r > 162 && r < 170 && isRed) found.add('double');
    }
    expect(found).toContain('triple');
    expect(found).toContain('double');
  });

  it('är deterministisk med seedad rng', () => {
    const base = { width: 64, height: 64, unproject: cam.unproject, noiseStdDev: 8 };
    const a = renderSyntheticBoard({ ...base, rng: mulberry32(7) });
    const b = renderSyntheticBoard({ ...base, rng: mulberry32(7) });
    expect(Array.from(a.data)).toEqual(Array.from(b.data));
  });

  it('linsdistorsion böjer bilden men behåller mitten', () => {
    const size = 240;
    const straight = renderSyntheticBoard({ width: size, height: size, unproject: cam.unproject });
    const bent = renderSyntheticBoard({
      width: size,
      height: size,
      unproject: cam.unproject,
      distortion: { k1: 0.3 },
    });

    const centre = cam.project(0, 0);
    expect(sampleImage(bent, centre.x, centre.y)).toEqual(sampleImage(straight, centre.x, centre.y));

    let diffCentre = 0;
    let diffEdge = 0;
    for (let py = 0; py < size; py += 3) {
      for (let px = 0; px < size; px += 3) {
        const s = sampleImage(straight, px, py);
        const d = sampleImage(bent, px, py);
        if (s[0] !== d[0] || s[1] !== d[1] || s[2] !== d[2]) {
          const rEdge = Math.hypot(px - centre.x, py - centre.y);
          if (rEdge < 30) diffCentre++;
          else diffEdge++;
        }
      }
    }
    // Distorsionen syns tydligt en bit ut, men nästan inte alls i mitten.
    expect(diffEdge).toBeGreaterThan(20);
    expect(diffCentre).toBe(0);
  });
});

describe('syntetisk kamera -> kalibrering -> poäng', () => {
  const cam = syntheticCamera({
    distanceMM: 2200,
    focalPx: 1500,
    pitch: 0.32,
    yaw: 0.1,
    roll: -0.04,
    principalPoint: { x: 640, y: 360 },
  });

  const boardPts: Point[] = [
    { x: 0, y: -170 },
    { x: 170, y: 0 },
    { x: 0, y: 170 },
    { x: -170, y: 0 },
  ];
  const calib = computeCalibration(
    boardPts,
    boardPts.map((p) => cam.project(p.x, p.y)),
  )!;

  it('exakt utpekade punkter ger noll residual', () => {
    expect(calib.residualPx).toBeLessThan(1e-6);
  });

  it.each([
    [103, 0, 'T20'],
    [166, 90, 'D6'],
    [140, 180, 'S3'],
    [10, 0, '25'],
    [0, 0, 'DB'],
    [200, 45, 'MISS'],
  ] as const)('r=%i mm, %i° projiceras och räknas tillbaka till %s', (r, deg, label) => {
    const bp = polar(r, deg);
    const px = cam.project(bp.x, bp.y);
    const back = calib.unproject(px.x, px.y);
    expect(getScoreFromCanonicalCoordinates(back.x, back.y).label).toBe(label);
  });
});
