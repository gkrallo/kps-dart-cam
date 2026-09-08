import type { Seg } from './types';

/**
 * En pil beskrivs som `{ v, m }`. Poängen är alltid `v * m`. Ingenting annat i
 * spelmotorn räknar poäng själv. Portad från scorecard/js/engine/segments.js.
 *
 *   v = 0        -> miss
 *   v = 1..20    -> vanligt fält, m = 1 / 2 / 3
 *   v = 25, m=1  -> grön bull (25 p)
 *   v = 25, m=2  -> röd bull (50 p) - räknas som dubbel vid dubbel utgång
 */

export const seg = (v: number, m = 1): Seg => ({ v, m });

export const score = (d: Seg): number => d.v * d.m;

export const isDouble = (d: Seg): boolean => d.m === 2 && d.v > 0;

export const sum = (darts: Seg[]): number => darts.reduce((a, d) => a + score(d), 0);

export function label(d: Seg | null | undefined): string {
  if (!d || d.v === 0) return 'Miss';
  if (d.v === 25) return d.m === 2 ? 'Röd' : 'Grön';
  if (d.m === 3) return 'T' + d.v;
  if (d.m === 2) return 'D' + d.v;
  return String(d.v);
}

export const BULL25: Seg = seg(25, 1);
export const BULL50: Seg = seg(25, 2);

/* ---- Utgångsförslag ------------------------------------------------------
   Byggs genom att söka igenom fälten i "så här kastar folk"-ordning i stället
   för en handskriven tabell. Bull undviks som mellanpil om det finns en annan
   väg (första sökningen görs utan bull).
   -------------------------------------------------------------------- */

interface Finish {
  seg: Seg;
  score: number;
}
const build = (list: Seg[]): Finish[] => list.map((d) => ({ seg: d, score: score(d) }));

const TRIPLES: Seg[] = [];
const SINGLES: Seg[] = [];
const DOUBLES: Seg[] = [];
for (let v = 20; v >= 1; v--) {
  TRIPLES.push(seg(v, 3));
  SINGLES.push(seg(v, 1));
  DOUBLES.push(seg(v, 2));
}

const SETUP_NO_BULL = build([...TRIPLES, ...SINGLES, ...DOUBLES]);
const SETUP_ALL = build([...TRIPLES, ...SINGLES, ...DOUBLES, BULL50, BULL25]);

const FINISH_DOUBLE_ORDER = [20, 16, 8, 4, 2, 12, 10, 18, 6, 14, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
const FINISH_DOUBLES = build([...FINISH_DOUBLE_ORDER.map((n) => seg(n, 2)), BULL50]);
const FINISH_ANY = build([BULL50, ...TRIPLES, ...DOUBLES, ...SINGLES, BULL25]);

function findIn(list: Finish[], target: number): Seg | null {
  for (const f of list) if (f.score === target) return f.seg;
  return null;
}

function search(
  remaining: number,
  dartsLeft: number,
  finishes: Finish[],
  setups: Finish[],
): Seg[] | null {
  for (const f of finishes) if (f.score === remaining) return [f.seg];
  if (dartsLeft < 2) return null;

  for (const f of finishes) {
    const rem = remaining - f.score;
    if (rem <= 0) continue;
    const first = findIn(setups, rem);
    if (first) return [first, f.seg];
  }
  if (dartsLeft < 3) return null;

  for (const f of finishes) {
    const rem = remaining - f.score;
    if (rem <= 0) continue;
    for (const s of setups) {
      const r2 = rem - s.score;
      if (r2 <= 0) continue;
      const second = findIn(setups, r2);
      if (second) return [s.seg, second, f.seg];
    }
  }
  return null;
}

/** Föreslår en väg ut, eller null om det inte går. */
export function checkout(
  remaining: number,
  dartsLeft: number,
  doubleOut: boolean,
): Seg[] | null {
  if (!(remaining > 0) || dartsLeft < 1) return null;
  if (doubleOut && remaining < 2) return null;
  if (remaining > 170) return null;
  const finishes = doubleOut ? FINISH_DOUBLES : FINISH_ANY;
  return (
    search(remaining, dartsLeft, finishes, SETUP_NO_BULL) ||
    search(remaining, dartsLeft, finishes, SETUP_ALL)
  );
}
