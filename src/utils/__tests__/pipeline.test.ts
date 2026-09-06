import { describe, expect, it } from 'vitest';
import { computeHomography, computeInverseHomography } from '../boardProjection';
import { BOARD_MM, getScoreFromCanonicalCoordinates } from '../dartMath';
import { validateDartboardPoints } from '../boardDetector';
import type { Point } from '../../types';

/**
 * Integrationstest av hela geometrikedjan:
 *   kanoniska mm  ->  homografi  ->  bildpixlar  ->  invers homografi  ->  poäng
 *
 * Testet simulerar en kamera som står snett framför tavlan, projicerar kända
 * träffpunkter till bildkoordinater, och kontrollerar att kedjan räknar tillbaka
 * till rätt poäng. Det fångar teckenfel, förväxlade axlar och radiefel.
 */

/** En tavla sedd snett: perspektiv-förkortad uppåt. */
function simulateCamera(): Point[] {
  const project = (X: number, Y: number): Point => {
    const tilt = 0.0016; // perspektivstyrka
    const w = 1 + tilt * Y;
    return {
      x: 640 + (X * 1.6) / w,
      y: 400 + (Y * 1.35) / w,
    };
  };
  const R = BOARD_MM.doubleOuter;
  return [project(0, -R), project(R, 0), project(0, R), project(-R, 0)];
}

const CALIB = simulateCamera();

/** Punkt på radie r mm, deg grader medurs från toppen. */
const polar = (r: number, deg: number) => {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { X: r * Math.cos(rad), Y: r * Math.sin(rad) };
};

describe('kalibreringspunkterna', () => {
  it('accepteras av rimlighetskontrollen trots perspektivet', () => {
    expect(validateDartboardPoints(CALIB)).toBe(true);
  });

  it('är osymmetriska - perspektivet får INTE plattas ut', () => {
    // Toppunkten ligger genuint närmare centrum än bottenpunkten. Den gamla
    // sanitizeDartboardPoints speglade bort just den informationen.
    const bull = { x: 640, y: 400 };
    const dTop = Math.hypot(CALIB[0].x - bull.x, CALIB[0].y - bull.y);
    const dBottom = Math.hypot(CALIB[2].x - bull.x, CALIB[2].y - bull.y);
    expect(dTop).not.toBeCloseTo(dBottom, 0);
  });

  it('förkastas om en punkt hamnar på fel sida om bullseye', () => {
    const broken = [...CALIB];
    broken[0] = { x: CALIB[0].x, y: 700 }; // "toppen" under mitten
    expect(validateDartboardPoints(broken)).toBe(false);
  });
});

describe('homografi fram och tillbaka', () => {
  const forward = computeHomography(CALIB)!;
  const inverse = computeInverseHomography(CALIB)!;

  it('går att beräkna', () => {
    expect(forward).toBeTypeOf('function');
    expect(inverse).toBeTypeOf('function');
  });

  it('bullseye hamnar mitt i tavlan', () => {
    const p = forward(0, 0);
    const back = inverse(p.x, p.y);
    expect(back.X).toBeCloseTo(0, 6);
    expect(back.Y).toBeCloseTo(0, 6);
  });

  it('en punkt överlever resan fram och tillbaka', () => {
    for (const [r, deg] of [
      [103, 0],
      [166, 90],
      [50, 234],
      [12, 300],
    ] as const) {
      const { X, Y } = polar(r, deg);
      const px = forward(X, Y);
      const back = inverse(px.x, px.y);
      expect(back.X).toBeCloseTo(X, 6);
      expect(back.Y).toBeCloseTo(Y, 6);
    }
  });
});

describe('hela kedjan: träffpunkt i bilden -> rätt poäng', () => {
  const forward = computeHomography(CALIB)!;
  const inverse = computeInverseHomography(CALIB)!;

  const scoreAt = (r: number, deg: number) => {
    const { X, Y } = polar(r, deg);
    const pixel = forward(X, Y); // var pilen syns i kamerabilden
    const canonical = inverse(pixel.x, pixel.y);
    return getScoreFromCanonicalCoordinates(canonical.X, canonical.Y).label;
  };

  it.each([
    [0, 0, 'DB'],
    [10, 0, '25'],
    [103, 0, 'T20'],
    [166, 0, 'D20'],
    [140, 0, 'S20'],
    [166, 90, 'D6'],
    [166, 180, 'D3'],
    [166, 270, 'D11'],
    [103, 54, 'T4'],
    [103, 72, 'T13'],
    [140, 342, 'S5'],
    [175, 0, 'MISS'],
  ])('radie %i mm, %i grader -> %s', (r, deg, expected) => {
    expect(scoreAt(r, deg)).toBe(expected);
  });

  it('hela dubbelringen räknas runt hela tavlan', () => {
    for (let deg = 0; deg < 360; deg += 18) {
      for (const r of [163, 166, 169.5]) {
        expect(scoreAt(r, deg).startsWith('D'), `${r} mm, ${deg} grader`).toBe(true);
      }
    }
  });
});
