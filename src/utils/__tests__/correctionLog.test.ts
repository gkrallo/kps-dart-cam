import { describe, it, expect } from 'vitest';
import { appendCorrection, clearCorrections, loadCorrections, MAX_ENTRIES, type CorrectionEntry } from '../correctionLog';
import { createMatch, throwDart, insertThrow, replaceThrow, matchState, serializeMatch, restoreMatch } from '../../game/match';

class FakeStorage {
  private m = new Map<string, string>();
  getItem(k: string) {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
}

const entry = (i: number): CorrectionEntry => ({
  at: i,
  kind: 'edit',
  source: 'manual',
  matchId: 'm1',
  mode: '501',
  detected: { label: 'S18', rMM: 27, deg: 46, how: 'axel' },
  from: { v: 18, m: 1 },
  to: { v: 4, m: 1 },
});

describe('rättningsloggen', () => {
  it('sparar och läser tillbaka i ordning', () => {
    const s = new FakeStorage();
    appendCorrection(entry(1), s);
    appendCorrection(entry(2), s);
    expect(loadCorrections(s).map((e) => e.at)).toEqual([1, 2]);
  });

  it('har ett tak: de äldsta raderna faller bort', () => {
    const s = new FakeStorage();
    for (let i = 0; i < MAX_ENTRIES + 5; i++) appendCorrection(entry(i), s);
    const all = loadCorrections(s);
    expect(all.length).toBe(MAX_ENTRIES);
    expect(all[0].at).toBe(5);
  });

  it('trasig lagring ger tom logg, inte krasch', () => {
    const s = new FakeStorage();
    s.setItem('kps-dart-cam:corrections:v1', '{inte json');
    expect(loadCorrections(s)).toEqual([]);
    appendCorrection(entry(1), s);
    expect(loadCorrections(s).length).toBe(1);
    clearCorrections(s);
    expect(loadCorrections(s)).toEqual([]);
  });

  it('utan lagring händer ingenting', () => {
    expect(() => appendCorrection(entry(1), null)).not.toThrow();
    expect(loadCorrections(null)).toEqual([]);
  });
});

describe('detektionsdata i kastlistan', () => {
  const meta = { label: 'T15', rMM: 106, deg: 127, how: 'axel (conf 0.78)' };

  it('följer med kastet, även efter insättning före det', () => {
    const m = createMatch({ mode: '501', players: [{ name: 'A' }, { name: 'B' }] });
    throwDart(m, { v: 15, m: 3 }, meta);
    insertThrow(m, 0, { v: 20, m: 1 });
    const a = m.actions[1];
    expect(a.t === 'T' && a.d).toEqual(meta);
    expect(matchState(m).view.remaining).toBe(501 - 20 - 45);
  });

  it('överlever sparning och återställning', () => {
    const m = createMatch({ mode: '501', players: [{ name: 'A' }] });
    throwDart(m, { v: 15, m: 3 }, meta);
    const back = restoreMatch(JSON.parse(JSON.stringify(serializeMatch(m))))!;
    const a = back.actions[0];
    expect(a.t === 'T' && a.d).toEqual(meta);
  });

  it('försvinner när kastet rättas - då är det inte längre detektorns värde', () => {
    const m = createMatch({ mode: '501', players: [{ name: 'A' }] });
    throwDart(m, { v: 15, m: 3 }, meta);
    replaceThrow(m, 0, { v: 10, m: 3 });
    const a = m.actions[0];
    expect(a.t === 'T' && a.d).toBeUndefined();
    expect(matchState(m).view.remaining).toBe(471);
  });
});
