import { describe, it, expect } from 'vitest';
import * as S from '../segments';
import {
  createMatch,
  matchState,
  throwDart,
  endTurn,
  undo,
  removeThrow,
  replaceThrow,
} from '../match';
import { farfarEngine, targetFor } from '../farfar';
import type { GameMode, Match } from '../types';

/* Portat från kps-dart-scorecard/tools/test-engine.js. */

const mk = (mode: GameMode, names: string[], opts: { doubleOut?: boolean; farfarCap?: boolean } = {}): Match =>
  createMatch({ mode, ...opts, players: names.map((name) => ({ name })) });
const t = (m: Match, v: number, mult = 1) => throwDart(m, { v, m: mult });
const player = (m: Match, name: string) => matchState(m).players.find((p) => p.name === name)!;
const co = (score: number, darts = 3, doubleOut = true) => {
  const r = S.checkout(score, darts, doubleOut);
  return r ? r.map(S.label).join(' ') : null;
};

describe('pilar och poäng', () => {
  it('poäng', () => {
    expect(S.score({ v: 20, m: 3 })).toBe(60);
    expect(S.score({ v: 25, m: 2 })).toBe(50);
    expect(S.score({ v: 25, m: 1 })).toBe(25);
    expect(S.score({ v: 0, m: 1 })).toBe(0);
  });
  it('röd bull räknas som dubbel', () => expect(S.isDouble({ v: 25, m: 2 })).toBe(true));
  it('etiketter', () => {
    expect(S.label({ v: 20, m: 3 })).toBe('T20');
    expect(S.label({ v: 25, m: 2 })).toBe('Röd');
  });
});

describe('utgångsförslag', () => {
  it.each([
    [170, 'T20 T20 Röd'],
    [167, 'T20 T19 Röd'],
    [100, 'T20 D20'],
    [40, 'D20'],
    [2, 'D1'],
    [50, 'Röd'],
    [81, 'T19 D12'],
  ])('%i -> %s', (s, expected) => expect(co(s)).toBe(expected));

  it('går inte ut', () => {
    expect(co(169)).toBeNull();
    expect(co(171)).toBeNull();
    expect(co(3, 1)).toBeNull();
  });
  it('med färre pilar', () => {
    expect(co(32, 1)).toBe('D16');
    expect(co(61, 2)).toBe('T7 D20');
  });
  it('aldrig mer än 3 pilar', () => expect(S.checkout(167, 3, true)!.length).toBe(3));
});

describe('301 / 501', () => {
  it('poäng sparas och tur byts', () => {
    const m = mk('301', ['A', 'B']);
    t(m, 20, 3);
    t(m, 20, 3);
    t(m, 20, 3);
    expect(matchState(m).view.remaining).toBe(121);
    endTurn(m);
    expect(player(m, 'A').score).toBe(121);
    expect(player(m, 'A').turns).toEqual([180]);
    expect(matchState(m).active.name).toBe('B');
  });

  it('dubbel utgång: 20 enkel blir tjock, D20 vinner', () => {
    const m = mk('301', ['A'], { doubleOut: true });
    [0, 1, 2].forEach(() => t(m, 20, 3));
    endTurn(m); // 121 kvar
    t(m, 20, 3);
    t(m, 7, 3);
    expect(matchState(m).view.remaining).toBe(40);
    endTurn(m);
    t(m, 20, 1);
    t(m, 20, 1);
    expect(matchState(m).view.bust).toBe(true);
    endTurn(m);
    expect(player(m, 'A').score).toBe(40); // tjock behåller 40
    t(m, 20, 2);
    expect(matchState(m).view.win).toBe(true);
    endTurn(m);
    expect(matchState(m).finished).toBe(true);
    expect(matchState(m).winners).toEqual(['A']);
    expect(player(m, 'A').checkout).toBe(40);
  });

  it('1 kvar med dubbel utgång blir tjock', () => {
    const m = mk('301', ['A'], { doubleOut: true });
    [0, 1, 2].forEach(() => t(m, 20, 3));
    endTurn(m); // 121
    t(m, 20, 3);
    t(m, 20, 3); // skulle ge 1 kvar
    expect(matchState(m).view.bust).toBe(true);
    endTurn(m);
    expect(player(m, 'A').score).toBe(121);
  });

  it('rätta ett gammalt kast när nästa spelare redan kastat', () => {
    const m = mk('501', ['A', 'B']);
    t(m, 20, 3);
    t(m, 20, 3);
    t(m, 20, 3);
    endTurn(m);
    t(m, 20, 3);
    endTurn(m);
    expect(player(m, 'A').score).toBe(321);
    const first = matchState(m).log[0];
    replaceThrow(m, first.ai, { v: 1, m: 1 }); // T20 var egentligen en 1:a
    expect(player(m, 'A').score).toBe(380);
    expect(player(m, 'B').score).toBe(441);
    expect(matchState(m).active.name).toBe('A');

    removeThrow(m, first.ai);
    expect(player(m, 'A').score).toBe(381);
    expect(player(m, 'A').dartsThrown).toBe(2);
  });

  it('ångra tar tillbaka turen', () => {
    const m = mk('301', ['A']);
    t(m, 20, 3);
    t(m, 20, 3);
    t(m, 20, 3);
    endTurn(m);
    undo(m);
    undo(m);
    expect(player(m, 'A').score).toBe(301);
  });
});

describe('Farfar - grunder', () => {
  it('mål per runda', () => {
    expect(targetFor(1)).toBe(15);
    expect(targetFor(2)).toBe(20);
    expect(targetFor(18)).toBe(100);
  });

  it('klarar målet, sparar pilar, ny runda', () => {
    const m = mk('FARFAR', ['A', 'B']);
    t(m, 20, 3); // 60 >= 15
    expect(player(m, 'A').savedDarts).toBe(2);
    expect(matchState(m).active.name).toBe('B');
    t(m, 20, 1); // B: 20 >= 15
    expect(player(m, 'B').savedDarts).toBe(2);
    expect(matchState(m).round).toBe(2);
    expect(matchState(m).active.name).toBe('A');
    expect(matchState(m).view.available).toBe(5);
  });

  it('grön 25 under målet avslutar inte, röd bull gör det', () => {
    const green = mk('FARFAR', ['A', 'B']);
    const gs = matchState(green);
    gs.round = 4;
    farfarEngine.throwDart(gs, green.config, { v: 25, m: 1 });
    expect(gs.currentDarts.length).toBe(1);
    expect(gs.lastEvent).toBeNull();

    const red = mk('FARFAR', ['A', 'B']);
    const rs = matchState(red);
    rs.round = 9;
    farfarEngine.throwDart(rs, red.config, { v: 25, m: 2 });
    expect(rs.lastEvent!.type).toBe('BULL');
    expect(rs.players[0].savedDarts).toBe(2);
  });

  it('utslagning: rundan spelas färdigt innan den avgörs', () => {
    const m = mk('FARFAR', ['A', 'B']);
    t(m, 0);
    t(m, 0);
    t(m, 0);
    expect(player(m, 'A').eliminated).toBe(true);
    expect(player(m, 'A').eliminatedRound).toBe(1);
    expect(matchState(m).finished).toBe(false);
    expect(matchState(m).active.name).toBe('B');
    t(m, 20, 1);
    expect(matchState(m).finished).toBe(true);
    expect(matchState(m).winners).toEqual(['B']);
  });

  it('tre spelare: sista måste kasta klart', () => {
    const m = mk('FARFAR', ['A', 'B', 'C']);
    t(m, 20, 1);
    t(m, 0);
    t(m, 0);
    t(m, 0);
    expect(matchState(m).active.name).toBe('C');
    expect(matchState(m).finished).toBe(false);
    t(m, 0);
    t(m, 0);
    t(m, 0);
    expect(matchState(m).winners).toEqual(['A']);
  });

  it('alla ut samma runda -> högsta poäng vinner', () => {
    const m = mk('FARFAR', ['A', 'B']);
    t(m, 5);
    t(m, 5);
    t(m, 1); // A: 11, ut
    t(m, 5);
    t(m, 5);
    t(m, 4); // B: 14, ut
    expect(matchState(m).finished).toBe(true);
    expect(matchState(m).winners).toEqual(['B']);
  });

  it('delad vinst vid lika', () => {
    const m = mk('FARFAR', ['A', 'B']);
    [5, 5, 4].forEach((v) => t(m, v));
    [5, 5, 4].forEach((v) => t(m, v));
    expect(matchState(m).winners).toEqual(['A', 'B']);
  });
});
