import { describe, it, expect } from 'vitest';
import {
  classifyBoardColour,
  estimateSectorRotation,
  sectorRotationFromVotes,
  type RGB,
  type RingVotes,
} from '../sectorPhase';
import fixture from './fixtures/ringlight-sector-colours.json';
import { rotateCalibration } from '../boardEllipse';
import {
  BOARD_COLORS,
  mulberry32,
  renderSyntheticBoard,
  sampleImage,
  syntheticCamera,
} from '../syntheticBoard';
import { computeCalibration } from '../boardProjection';
import { getScoreFromCanonicalCoordinates } from '../dartMath';
import type { Point } from '../../types';

/**
 * Rotationsbestämning ur röd/grön-växlingen. Facit är exakt: tavlan renderas
 * genom en känd kamera med en känd vridning, och uppskattningen ska ge tillbaka
 * just den vridningen.
 */

const CANON: Point[] = [
  { x: 0, y: -170 },
  { x: 170, y: 0 },
  { x: 0, y: 170 },
  { x: -170, y: 0 },
];

const rot = (p: Point, rad: number): Point => {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
};

const deg = (rad: number) => (rad * 180) / Math.PI;
const rad = (d: number) => (d * Math.PI) / 180;

/**
 * Bygger en scen där tavlan sitter vriden `tiltRad` mot kalibreringens gauge -
 * exakt det fel `orientToImageUp` lämnar kvar när tavlan inte är upphängd med
 * 20:an rakt upp.
 */
function scene(tiltRad: number, opts: { pitch?: number; yaw?: number; noise?: number } = {}) {
  const cam = syntheticCamera({
    distanceMM: 1400,
    focalPx: 2400,
    pitch: opts.pitch ?? 0.12,
    yaw: opts.yaw ?? 0,
    principalPoint: { x: 400, y: 400 },
  });
  const calib = computeCalibration(
    CANON,
    CANON.map((p) => cam.project(p.x, p.y)),
  )!;
  const img = renderSyntheticBoard({
    width: 800,
    height: 800,
    // Tavlan vriden `tiltRad`: bildpunkt -> världspunkt -> tillbaka till
    // tavlans eget koordinatsystem.
    unproject: (x, y) => rot(cam.unproject(x, y), -tiltRad),
    noiseStdDev: opts.noise ?? 0,
    rng: mulberry32(7),
  });
  const sample = (x: number, y: number): RGB | null => {
    if (x < 0 || y < 0 || x >= img.width || y >= img.height) return null;
    return sampleImage(img, x, y);
  };
  return { cam, calib, sample };
}

describe('classifyBoardColour', () => {
  it('känner igen tavlans röda och gröna', () => {
    expect(classifyBoardColour(BOARD_COLORS.red)).toBe('red');
    expect(classifyBoardColour(BOARD_COLORS.green)).toBe('green');
  });

  it('svart, gräddvitt och tråd blir varken-eller', () => {
    expect(classifyBoardColour(BOARD_COLORS.black)).toBe('other');
    expect(classifyBoardColour(BOARD_COLORS.cream)).toBe('other');
    expect(classifyBoardColour(BOARD_COLORS.wire)).toBe('other');
    expect(classifyBoardColour(BOARD_COLORS.outside)).toBe('other');
  });

  it('en mörk, urblekt röd ring räknas fortfarande som röd', () => {
    expect(classifyBoardColour([120, 30, 28])).toBe('red');
  });
});

describe('estimateSectorRotation', () => {
  for (const trueDeg of [0, 3, -4.5, 8, -12, 16]) {
    it(`hittar en vridning på ${trueDeg}°`, () => {
      const { calib, sample } = scene(rad(trueDeg));
      const res = estimateSectorRotation(calib, sample)!;
      expect(res).not.toBeNull();
      expect(deg(res.offsetRad)).toBeCloseTo(trueDeg, 0);
      expect(res.confidence).toBeGreaterThan(0.9);
    });
  }

  it('håller sig inom ±18° - mönstret kan inte skilja tio lösningar åt', () => {
    // 40° verklig vridning ser ut som 4°: fyrkantsvågen upprepar sig var 36:e
    // grad. Antagandet "20 nära toppen" är det som avgör, och det är
    // dokumenterat i sectorPhase.ts.
    const { calib, sample } = scene(rad(40));
    const res = estimateSectorRotation(calib, sample)!;
    expect(Math.abs(deg(res.offsetRad))).toBeLessThan(18);
    expect(deg(res.offsetRad)).toBeCloseTo(4, 0);
  });

  it('klarar brus och en snedare kameravinkel', () => {
    const { calib, sample } = scene(rad(-6), { pitch: 0.3, yaw: 0.25, noise: 12 });
    const res = estimateSectorRotation(calib, sample)!;
    expect(deg(res.offsetRad)).toBeCloseTo(-6, 0);
    expect(res.confidence).toBeGreaterThan(0.8);
  });

  it('svarar null när det inte finns någon färg att läsa', () => {
    const { calib } = scene(0);
    expect(estimateSectorRotation(calib, () => [90, 90, 90])).toBeNull();
  });
});

describe('rotateCalibration rättar poängen', () => {
  it('en tavla vriden 8° läser fel sektor före rättning och rätt efter', () => {
    const trueTilt = rad(8);
    const { cam, calib, sample } = scene(trueTilt);

    // En pil i 20:ans yttre enkelfält, 7° från mitten - alltså med god
    // marginal innanför fältet, som är 18° brett. Ett gauge-fel på 8° räcker
    // för att flytta den över tråden till grannsektorn. (Mitt i fältet hade
    // 8° inte synts alls - det är därför felet är så lömskt: de flesta kasten
    // ser rätt ut och bara de nära trådarna blir fel.)
    const boardPoint = { x: 140 * Math.sin(rad(7)), y: -140 * Math.cos(rad(7)) };
    const world = rot(boardPoint, trueTilt);
    const imgPt = cam.project(world.x, world.y);

    const scoreWith = (c: typeof calib) => {
      const b = c.unproject(imgPt.x, imgPt.y);
      return getScoreFromCanonicalCoordinates(b.x, b.y);
    };

    // Före: sektorhjulet är vridet, så 20 läses som grannen.
    expect(scoreWith(calib).baseScore).not.toBe(20);

    const res = estimateSectorRotation(calib, sample)!;
    const fixed = rotateCalibration(calib, res.offsetRad);
    expect(scoreWith(fixed).baseScore).toBe(20);
    expect(scoreWith(fixed).label).toBe('S20');
  });

  it('rotationen ändrar inte ringen, bara sektorn', () => {
    const trueTilt = rad(-11);
    const { cam, calib, sample } = scene(trueTilt);
    const boardPoint = { x: 0, y: -103 }; // T20
    const world = rot(boardPoint, trueTilt);
    const imgPt = cam.project(world.x, world.y);

    const res = estimateSectorRotation(calib, sample)!;
    const fixed = rotateCalibration(calib, res.offsetRad);
    const b = fixed.unproject(imgPt.x, imgPt.y);
    const s = getScoreFromCanonicalCoordinates(b.x, b.y);
    expect(s.totalPoints).toBe(60);
    expect(s.label).toBe('T20');
  });
});

describe('verklig tavla: röd/grön-avläsningar ur belysningsringsfotot', () => {
  // 3118 faktiska avläsningar (72 % av proverna gick att färgbestämma) från
  // Kristians slitna utomhustavla. Se fixturens `note` för hur de togs fram.
  const fx = fixture as {
    grid: string;
    angle_steps: number;
    radii_mm: number[];
    expected: { offset_deg: number; tolerance_deg: number; min_confidence: number };
  };

  const parse = (): RingVotes => {
    const angles: number[] = [];
    const votes: number[] = [];
    const nr = fx.radii_mm.length;
    for (let i = 0; i < fx.angle_steps; i++) {
      const a = (i / fx.angle_steps) * 2 * Math.PI;
      for (let r = 0; r < nr; r++) {
        const c = fx.grid[i * nr + r];
        if (c === '1') {
          angles.push(a);
          votes.push(1);
        } else if (c === '2') {
          angles.push(a);
          votes.push(-1);
        }
      }
    }
    return { angles, votes, sampled: fx.grid.length };
  };

  it('en sliten tavla i skugga ger tillräckligt med läsbar färg', () => {
    const v = parse();
    expect(v.votes.length / v.sampled).toBeGreaterThan(0.6);
  });

  it('hittar tavlans verkliga vridning', () => {
    const res = sectorRotationFromVotes(parse())!;
    expect(res).not.toBeNull();
    expect(deg(res.offsetRad)).toBeCloseTo(fx.expected.offset_deg, 0);
    expect(Math.abs(deg(res.offsetRad) - fx.expected.offset_deg)).toBeLessThan(
      fx.expected.tolerance_deg,
    );
    expect(res.confidence).toBeGreaterThan(fx.expected.min_confidence);
  });

  it('svaret är inte bara "ingen rättning" - felet är värt att rätta', () => {
    // 2,5° vid dubbelringens ytterkant är 7,4 mm i sidled. Det syns inte på
    // wireframets form men flyttar varje kast nära en tråd till fel sektor.
    const res = sectorRotationFromVotes(parse())!;
    expect(Math.abs(deg(res.offsetRad))).toBeGreaterThan(1.5);
    const lateralMM = 170 * Math.abs(res.offsetRad);
    expect(lateralMM).toBeGreaterThan(5);
  });
});
