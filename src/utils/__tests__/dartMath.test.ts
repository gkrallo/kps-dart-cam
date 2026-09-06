import { describe, expect, it } from 'vitest';
import {
  BOARD_MM,
  MM_PER_PX,
  canonicalToPixel,
  getScoreFromCanonicalCoordinates as score,
  getScoreFromPixel,
  pixelToCanonical,
} from '../dartMath';

/** Punkt på radie r mm i riktning deg, där 0 grader är rakt upp och medurs är positivt. */
const at = (r: number, deg: number) => {
  const rad = ((deg - 90) * Math.PI) / 180;
  return score(r * Math.cos(rad), r * Math.sin(rad));
};

/** Mitten av ett ringband, så testerna inte ligger och balanserar på en gräns. */
const mid = (a: number, b: number) => (a + b) / 2;
const TRIPLE = mid(BOARD_MM.tripleInner, BOARD_MM.tripleOuter);   // 103
const DOUBLE = mid(BOARD_MM.doubleInner, BOARD_MM.doubleOuter);   // 166
const SINGLE_INNER = mid(BOARD_MM.outerBull, BOARD_MM.tripleInner);
const SINGLE_OUTER = mid(BOARD_MM.tripleOuter, BOARD_MM.doubleInner);

describe('bullseye', () => {
  it('mitten är dubbel bull', () => {
    expect(score(0, 0)).toMatchObject({ label: 'DB', totalPoints: 50 });
  });
  it('strax innanför inre bull är fortfarande DB', () => {
    expect(at(6, 0).label).toBe('DB');
  });
  it('mellan inre och yttre bull är enkel bull', () => {
    expect(at(10, 0)).toMatchObject({ label: '25', totalPoints: 25 });
  });
  it('strax utanför yttre bull är inte längre bull', () => {
    expect(at(17, 0).label).not.toBe('25');
  });
});

describe('sektorer', () => {
  // Medurs från 20 i toppen.
  const CLOCKWISE = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];

  it.each(CLOCKWISE.map((s, i) => [i * 18, s] as const))(
    '%i grader medurs är sektor %i',
    (deg, expected) => {
      expect(at(SINGLE_OUTER, deg).baseScore).toBe(expected);
    },
  );

  it('de fyra kalibreringspunkterna hamnar på 20, 6, 3 och 11', () => {
    expect(at(DOUBLE, 0).label).toBe('D20');
    expect(at(DOUBLE, 90).label).toBe('D6');
    expect(at(DOUBLE, 180).label).toBe('D3');
    expect(at(DOUBLE, 270).label).toBe('D11');
  });

  it('sektorn är 18 grader bred och centrerad', () => {
    expect(at(SINGLE_OUTER, -8.9).baseScore).toBe(20);
    expect(at(SINGLE_OUTER, 8.9).baseScore).toBe(20);
    expect(at(SINGLE_OUTER, 9.1).baseScore).toBe(1);
    expect(at(SINGLE_OUTER, -9.1).baseScore).toBe(5);
  });
});

describe('ringar', () => {
  it('trippelbandet ger trippel', () => {
    expect(at(TRIPLE, 0)).toMatchObject({ label: 'T20', totalPoints: 60 });
  });
  it('dubbelbandet ger dubbel', () => {
    expect(at(DOUBLE, 0)).toMatchObject({ label: 'D20', totalPoints: 40 });
  });
  it('hela dubbelbandet räknas, ända ut till ytterkanten', () => {
    // Detta var buggen: 6.4 mm av dubbelringen klassades som MISS.
    for (let r = BOARD_MM.doubleInner + 0.1; r <= BOARD_MM.doubleOuter; r += 0.5) {
      expect(at(r, 0).label, `radie ${r} mm`).toBe('D20');
    }
  });
  it('hela trippelbandet räknas', () => {
    for (let r = BOARD_MM.tripleInner; r <= BOARD_MM.tripleOuter; r += 0.5) {
      expect(at(r, 0).label, `radie ${r} mm`).toBe('T20');
    }
  });
  it('innanför trippeln är enkel, inte trippel', () => {
    expect(at(BOARD_MM.tripleInner - 1, 0).label).toBe('S20');
  });
  it('mellan trippel och dubbel är enkel', () => {
    expect(at(SINGLE_OUTER, 0)).toMatchObject({ label: 'S20', totalPoints: 20 });
    expect(at(SINGLE_INNER, 0)).toMatchObject({ label: 'S20', totalPoints: 20 });
  });
  it('utanför dubbelringen är miss', () => {
    expect(at(BOARD_MM.doubleOuter + 0.5, 0)).toMatchObject({ label: 'MISS', totalPoints: 0 });
  });
});

describe('pixelkonvertering', () => {
  it('mitten av bilden är bullseye', () => {
    expect(getScoreFromPixel(400, 400).label).toBe('DB');
  });
  it('kalibreringspunkterna ligger på dubbelringens ytterkant', () => {
    // (400, 0) är toppunkten som kalibreringen mappar till.
    expect(pixelToCanonical(400, 0)).toEqual({ X: 0, Y: -BOARD_MM.doubleOuter });
    expect(pixelToCanonical(800, 400)).toEqual({ X: BOARD_MM.doubleOuter, Y: 0 });
  });
  it('skalan är 0.425 mm per pixel', () => {
    expect(MM_PER_PX).toBeCloseTo(0.425, 6);
  });
  it('fram och tillbaka ger samma punkt', () => {
    const p = canonicalToPixel(103, -42);
    expect(pixelToCanonical(p.x, p.y).X).toBeCloseTo(103, 9);
    expect(pixelToCanonical(p.x, p.y).Y).toBeCloseTo(-42, 9);
  });
});

describe('regressionsvakt mot de gamla felaktiga radierna', () => {
  // Gamla koden använde 360-385 px för dubbel och 216-242 px för trippel.
  it('en träff på 380 px radie är INTE dubbel (gamla koden sa dubbel)', () => {
    expect(getScoreFromPixel(400, 400 - 380).label).toBe('S20');
  });
  it('en träff på 395 px radie ÄR dubbel (gamla koden sa MISS)', () => {
    expect(getScoreFromPixel(400, 400 - 395).label).toBe('D20');
  });
  it('en träff på 220 px radie är INTE trippel (gamla koden sa trippel)', () => {
    expect(getScoreFromPixel(400, 400 - 220).label).toBe('S20');
  });
  it('en träff på 245 px radie ÄR trippel (gamla koden sa enkel)', () => {
    expect(getScoreFromPixel(400, 400 - 245).label).toBe('T20');
  });
});
