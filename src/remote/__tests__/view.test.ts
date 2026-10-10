import { describe, it, expect } from 'vitest';
import { createMatch, endTurn, matchState, throwDart } from '../../game/match';
import { label } from '../../game/segments';
import { lastTurnDarts } from '../view';

const labels = (st: ReturnType<typeof matchState>, i: number) => lastTurnDarts(st, i).map(label).join(' · ');

describe('spelarlistans pilar', () => {
  it('övriga visar sin senaste tur, den som står på tur den pågående', () => {
    const m = createMatch({ mode: '501', players: [{ name: 'Anna' }, { name: 'Bo' }] });
    throwDart(m, { v: 20, m: 3 });
    throwDart(m, { v: 20, m: 3 });
    throwDart(m, { v: 0, m: 1 });
    endTurn(m);
    let st = matchState(m);
    expect(labels(st, 0)).toBe('T20 · T20 · Miss');
    // Bo har inte kastat än: tom, inte Annas pilar och inte "förra turen".
    expect(labels(st, 1)).toBe('');

    throwDart(m, { v: 25, m: 2 });
    st = matchState(m);
    expect(labels(st, 1)).toBe('Röd');
    expect(labels(st, 0)).toBe('T20 · T20 · Miss');
  });

  it('bara den SENASTE turen, inte äldre', () => {
    const m = createMatch({ mode: '301', players: [{ name: 'Anna' }, { name: 'Bo' }] });
    for (const v of [1, 2, 3]) throwDart(m, { v, m: 1 });
    endTurn(m);
    for (const v of [4, 5, 6]) throwDart(m, { v, m: 1 });
    endTurn(m);
    for (const v of [7, 8]) throwDart(m, { v, m: 1 });
    endTurn(m);
    const st = matchState(m);
    expect(labels(st, 0)).toBe('7 · 8');
    expect(labels(st, 1)).toBe('');
    expect(lastTurnDarts(st, 5)).toEqual([]);
  });

  it('Farfar: rundans pilar', () => {
    const m = createMatch({ mode: 'FARFAR', players: [{ name: 'Anna' }, { name: 'Bo' }] });
    // Runda 1, mål 15: Anna når målet med två pilar och turen stängs.
    throwDart(m, { v: 10, m: 1 });
    throwDart(m, { v: 5, m: 1 });
    const st = matchState(m);
    expect(st.currentIndex).toBe(1);
    expect(labels(st, 0)).toBe('10 · 5');
  });
});
