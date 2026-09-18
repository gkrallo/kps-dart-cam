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
  insertThrow,
  insertIndexForRevealedThrow,
  restoreMatch,
  serializeMatch,
} from '../match';
import { segFromDartScore } from '../index';
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

  it('sätter in en pil som saknades (dold bakom en annan, hittad vid uttagning)', () => {
    const m = mk('501', ['A', 'B']);
    t(m, 20, 3); // dart 1 - egentligen dolde den en 5:a bakom sig
    t(m, 1, 1); // dart 3, registrerad som index 1
    // dart 2 (en 5:a) saknas helt - upptäcks vid omvänd uttagning och sätts
    // in FÖRE den sist kastade pilen (index 1), inte sist i listan.
    insertThrow(m, 1, { v: 5, m: 1 });
    expect(matchState(m).view.remaining).toBe(501 - 60 - 5 - 1);
    expect(matchState(m).currentDarts.map((d) => d.v)).toEqual([20, 5, 1]);
  });

  describe('plats för en pil som avslöjas vid uttagning', () => {
    const T = { t: 'T' as const, v: 20, m: 1 };
    const E = { t: 'E' as const };

    it('sist i den pågående turen', () => {
      expect(insertIndexForRevealedThrow([T, T])).toBe(2);
      expect(insertIndexForRevealedThrow([T, T, T])).toBe(3);
    });

    it('hamnar inte i nästa spelares tur om turen redan avslutats', () => {
      // Ett avslutande 'E' hoppas över, annars skulle pilen räknas för fel
      // spelare - det dyraste felet insättningen kan göra.
      expect(insertIndexForRevealedThrow([T, T, T, E])).toBe(3);
      expect(insertIndexForRevealedThrow([T, T, E, E])).toBe(2);
    });

    it('tidigare turer lämnas orörda', () => {
      expect(insertIndexForRevealedThrow([T, T, T, E, T, T])).toBe(6);
    });

    it('tom kastlista ger noll', () => {
      expect(insertIndexForRevealedThrow([])).toBe(0);
      expect(insertIndexForRevealedThrow([E])).toBe(0);
    });
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

describe('granskning 2026-09-18: hål mellan event-sourcingen och motorerna', () => {
  it('Farfar: en dold pil som hittas efter att turen stängts hamnar hos rätt spelare', () => {
    // A kastar 5, 5 (dold), 10. Appen ser [5, 10] = 15 -> turen stängs, A
    // sparar 1 pil, B står på tur. Vid uttagningen avslöjas 5:an.
    const m = mk('FARFAR', ['A', 'B']);
    t(m, 5);
    t(m, 10);
    expect(matchState(m).active.name).toBe('B');
    expect(player(m, 'A').savedDarts).toBe(1);

    const idx = insertIndexForRevealedThrow(m.actions, matchState(m));
    expect(idx).toBe(1); // före pilen som stängde turen, inte sist i listan
    insertThrow(m, idx, { v: 5, m: 1 });

    expect(player(m, 'A').savedDarts).toBe(0);
    expect(player(m, 'A').dartsThrown).toBe(3);
    expect(matchState(m).active.name).toBe('B');
    expect(matchState(m).currentDarts).toEqual([]); // B har inte kastat
  });

  it('Farfar: samma sak när röd bull stängde turen', () => {
    const m = mk('FARFAR', ['A', 'B']);
    t(m, 5);
    t(m, 25, 2); // röd bull stänger, 1 sparad
    expect(player(m, 'A').savedDarts).toBe(1);
    insertThrow(m, insertIndexForRevealedThrow(m.actions, matchState(m)), { v: 1, m: 1 });
    expect(player(m, 'A').savedDarts).toBe(0);
    expect(matchState(m).active.name).toBe('B');
  });

  it('301/501: en öppen tur sätter fortfarande in sist', () => {
    const m = mk('501', ['A', 'B']);
    t(m, 20, 3);
    t(m, 1);
    expect(insertIndexForRevealedThrow(m.actions, matchState(m))).toBe(2);
    endTurn(m);
    expect(insertIndexForRevealedThrow(m.actions, matchState(m))).toBe(2);
  });

  it('insertThrow i en redan full 301/501-tur lämnar inget dött kast', () => {
    const m = mk('501', ['A', 'B']);
    [0, 1, 2].forEach(() => t(m, 20, 3));
    endTurn(m);
    t(m, 1);
    const before = m.actions.length;
    insertThrow(m, 3, { v: 5, m: 1 }); // "+" efter A:s tredje pil
    expect(m.actions.length).toBe(before);
    expect(player(m, 'A').score).toBe(321);
    expect(matchState(m).currentDarts).toEqual([{ v: 1, m: 1 }]); // B:s tur orörd
  });

  it('endTurn som inte ger effekt lämnar inget dött E, så ångra fungerar', () => {
    const farfar = mk('FARFAR', ['A', 'B']);
    t(farfar, 5);
    endTurn(farfar); // Farfar vägrar
    expect(farfar.actions.length).toBe(1);

    const m = mk('301', ['A']);
    t(m, 20, 3);
    t(m, 20, 3);
    t(m, 20, 3); // 121 kvar
    endTurn(m);
    t(m, 20, 3);
    t(m, 20, 3);
    t(m, 1); // 0 -> vinst (rak utgång)
    endTurn(m);
    expect(matchState(m).finished).toBe(true);
    endTurn(m); // App-effekten körs två gånger under StrictMode
    endTurn(m);
    expect(m.actions.filter((a) => a.t === 'E').length).toBe(2);
    undo(m);
    expect(matchState(m).finished).toBe(false);
    expect(matchState(m).currentDarts.length).toBe(3);
  });

  it('utgångsförslag: rak utgång får ta 171-180', () => {
    expect(co(180, 3, false)).toBe('T20 T20 T20');
    expect(co(171, 3, false)).not.toBeNull();
    expect(co(171, 3, true)).toBeNull();
    expect(co(170, 3, true)).toBe('T20 T20 Röd');
  });

  it('Farfar med en spelare: den utslagne utropas inte till vinnare', () => {
    const m = mk('FARFAR', ['A']);
    [0, 0, 0].forEach((v) => t(m, v));
    expect(matchState(m).finished).toBe(true);
    expect(matchState(m).winners).toEqual([]);
  });

  it('Farfar-taket: efter runda 18 vinner flest sparade pilar', () => {
    const m = mk('FARFAR', ['A', 'B'], { farfarCap: true });
    // Röd bull stänger turen direkt oavsett mål, så varje spelare sparar
    // available-1 pilar per runda. A missar en gång i runda 1.
    t(m, 0);
    t(m, 25, 2);
    t(m, 25, 2);
    for (let r = 2; r <= 18; r++) {
      t(m, 25, 2);
      t(m, 25, 2);
    }
    expect(matchState(m).finished).toBe(true);
    expect(matchState(m).winners).toEqual(['B']);
    expect(player(m, 'B').savedDarts).toBe((player(m, 'A').savedDarts ?? 0) + 1);
  });

  it('Farfar: sparade pilar staplas över rundor', () => {
    const m = mk('FARFAR', ['A', 'B']);
    t(m, 20, 3); // A: 60, sparar 2
    t(m, 20, 3); // B
    expect(matchState(m).view.available).toBe(5);
    t(m, 20, 3); // A runda 2: sparar 4 -> 7 nästa runda
    t(m, 20, 3);
    expect(matchState(m).view.available).toBe(7);
  });

  it('restoreMatch förkastar trasig lagring', () => {
    const m = mk('501', ['A', 'B']);
    t(m, 20, 3);
    endTurn(m);
    const ok = restoreMatch(JSON.parse(JSON.stringify(serializeMatch(m))));
    expect(ok).not.toBeNull();
    expect(matchState(ok!).players[0].score).toBe(441);

    const badMode = { ...serializeMatch(m), config: { ...m.config, mode: 'CRICKET' } };
    expect(restoreMatch(badMode)).toBeNull();
    const badAction = { ...serializeMatch(m), actions: [{ t: 'T', v: 'x', m: 1 }] };
    expect(restoreMatch(badAction)).toBeNull();
  });

  it('segFromDartScore: bryggan från datorseendet', () => {
    const mk2 = (label: string, baseScore: number, multiplier: number) => ({
      label, baseScore, multiplier, totalPoints: baseScore * multiplier, coordinates: { x: 0, y: 0 },
    });
    expect(segFromDartScore(mk2('DB', 25, 2))).toEqual({ v: 25, m: 2 });
    expect(segFromDartScore(mk2('25', 25, 1))).toEqual({ v: 25, m: 1 });
    expect(segFromDartScore(mk2('MISS', 0, 0))).toEqual({ v: 0, m: 1 });
    expect(segFromDartScore(mk2('T20', 20, 3))).toEqual({ v: 20, m: 3 });
  });
});
