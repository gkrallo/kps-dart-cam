import { describe, it, expect } from 'vitest';
import fixture from './fixtures/outdoor-board.json';
import {
  calibrationFromRingEllipses,
  fitEllipse,
  orientCalibrationToward,
  type RingEllipse,
} from '../boardEllipse';
import { getScoreFromCanonicalCoordinates } from '../dartMath';
import type { Point } from '../../types';

/**
 * Ett riktigt foto av Kristians utomhustavla (2026-07-22, kväll, en enda
 * strålkastare nära kameran). Tavlan är sliten, snett sedd, delvis i skugga -
 * det svåraste fallet.
 *
 * Testet kör INTE OpenCV (finns inte i Node-testmiljön). I stället är
 * `double_ring_px` / `triple_ring_px` faktiska pixlar ur röd/grön-HSV-masken
 * (extraherade offline), och testet kör den rena geometrikedjan på dem:
 * `fitEllipse` -> `calibrationFromRingEllipses` -> poäng. Det verifierar att
 * geometrin håller mot en verklig kamera, verklig optik och en trött tavla -
 * gapet som `syntheticBoard`-testerna inte kan täcka.
 *
 * Vad fotot dessutom visade (och som är åtgärdat): den rödbruna altanen matchar
 * "röd" bättre än den slitna ringen, så "största konturen" i `autoDetectBoardEllipse`
 * låste på altanen. Nu filtreras konturerna på fyrkantighet - se boardDetector.
 */

const toPoints = (arr: number[][]): Point[] => arr.map(([x, y]) => ({ x, y }));

const doublePx = toPoints(fixture.double_ring_px);
const triplePx = toPoints(fixture.triple_ring_px);

describe('riktig utomhustavla: ellipsanpassning', () => {
  const doubleEllipse = fitEllipse(doublePx)!;
  const tripleEllipse = fitEllipse(triplePx)!;

  it('anpassar en ellips till var ring', () => {
    expect(doubleEllipse).not.toBeNull();
    expect(tripleEllipse).not.toBeNull();
  });

  it('ringarna är ungefär koncentriska', () => {
    const offset = Math.hypot(
      doubleEllipse.cx - tripleEllipse.cx,
      doubleEllipse.cy - tripleEllipse.cy,
    );
    expect(offset).toBeLessThan(35);
  });

  it('storleksförhållandet matchar 107/170 mm', () => {
    const ratio =
      Math.max(tripleEllipse.rx, tripleEllipse.ry) / Math.max(doubleEllipse.rx, doubleEllipse.ry);
    expect(ratio).toBeCloseTo(fixture.expected.double_ring_ratio, 1); // inom ~0.05
  });

  it('kameravinkeln syns i ellipsen (inte en cirkel)', () => {
    const aspect = Math.min(doubleEllipse.rx, doubleEllipse.ry) / Math.max(doubleEllipse.rx, doubleEllipse.ry);
    expect(aspect).toBeLessThan(0.95);
    expect(aspect).toBeGreaterThan(0.6);
  });
});

describe('riktig utomhustavla: kalibrering', () => {
  const rings: RingEllipse[] = [
    { ellipse: fitEllipse(doublePx)!, radiusMM: 170 },
    { ellipse: fitEllipse(triplePx)!, radiusMM: 107 },
  ];
  const calib = calibrationFromRingEllipses(rings)!;

  it('ger en låg reprojektionsresidual', () => {
    expect(calib).not.toBeNull();
    expect(calib.residualPx).toBeLessThan(5);
  });

  it('dubbelringens pixlar hamnar på radie ~170 mm', () => {
    const radii = doublePx.map((p) => {
      const b = calib.unproject(p.x, p.y);
      return Math.hypot(b.x, b.y);
    });
    const mean = radii.reduce((s, v) => s + v, 0) / radii.length;
    expect(mean).toBeGreaterThan(160);
    expect(mean).toBeLessThan(180);
  });

  it('trippelringens pixlar hamnar på radie ~107 mm', () => {
    const radii = triplePx.map((p) => {
      const b = calib.unproject(p.x, p.y);
      return Math.hypot(b.x, b.y);
    });
    const mean = radii.reduce((s, v) => s + v, 0) / radii.length;
    const std = Math.sqrt(
      radii.map((v) => (v - mean) ** 2).reduce((s, v) => s + v, 0) / radii.length,
    );
    expect(mean).toBeGreaterThan(102);
    expect(mean).toBeLessThan(114);
    expect(std).toBeLessThan(10);
  });
});

describe('riktig utomhustavla: pilpoäng', () => {
  const rings: RingEllipse[] = [
    { ellipse: fitEllipse(doublePx)!, radiusMM: 170 },
    { ellipse: fitEllipse(triplePx)!, radiusMM: 107 },
  ];
  // Tavlan är roterad ~90 grader (20:an sitter till vänster i bild). Ankra
  // rotationen mot den visuellt avlästa 20-positionen.
  const twenty = { x: fixture.twenty_img[0], y: fixture.twenty_img[1] };
  const calib = orientCalibrationToward(calibrationFromRingEllipses(rings)!, twenty);

  const byName = (name: string) => fixture.darts.find((d) => d.name === name)!;
  const boardOf = (tip: number[]) => calib.unproject(tip[0], tip[1]);

  it('topp-pilen: sektor 10, enkelfält', () => {
    const b = boardOf(byName('top').tip);
    const s = getScoreFromCanonicalCoordinates(b.x, b.y);
    expect(s.baseScore).toBe(10);
    expect(s.multiplier).toBe(1);
  });

  it('höger-pilen: sektor 3, enkelfält (3 sitter mitt emot 20)', () => {
    const b = boardOf(byName('right').tip);
    const s = getScoreFromCanonicalCoordinates(b.x, b.y);
    expect(s.baseScore).toBe(3);
    expect(s.multiplier).toBe(1);
  });

  it('vänster-pilen: sektor 20, vid trippelringen', () => {
    const b = boardOf(byName('left').tip);
    const s = getScoreFromCanonicalCoordinates(b.x, b.y);
    const r = Math.hypot(b.x, b.y);
    expect(s.baseScore).toBe(20);
    expect(r).toBeGreaterThan(95);
    expect(r).toBeLessThan(115);
  });
});
