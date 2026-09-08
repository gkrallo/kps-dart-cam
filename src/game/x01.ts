import type { Engine, MatchConfig, MatchState, MatchView, Seg } from './types';
import { checkout, isDouble, sum } from './segments';

/**
 * Reglerna för 301 och 501. Rena funktioner: samma pilar in ger alltid samma
 * ställning ut. Portad från scorecard/js/engine/x01.js.
 */

function init(cfg: MatchConfig): MatchState {
  const state: MatchState = {
    mode: cfg.mode,
    finished: false,
    winners: [],
    turnNo: 1,
    currentIndex: 0,
    currentDarts: [],
    lastEvent: null,
    players: cfg.players.map((p) => ({
      id: p.id,
      name: p.name,
      score: cfg.start,
      lastTurnScore: null,
      dartsThrown: 0,
      pointsScored: 0,
      turns: [],
      checkout: null,
    })),
    // fylls i av match.compute()
    log: [],
    view: { total: 0, available: 3, dartsLeft: 3 },
    active: null as unknown as MatchState['active'],
    config: cfg,
  };
  state.active = state.players[0];
  return state;
}

interface Pending {
  total: number;
  remaining: number;
  bust: boolean;
  win: boolean;
}

/** Hur turen ligger till just nu, innan den bekräftas. */
function pending(st: MatchState, cfg: MatchConfig): Pending {
  const p = st.players[st.currentIndex];
  const total = sum(st.currentDarts);
  const remaining = p ? (p.score ?? 0) - total : 0;
  let bust = false;
  let win = false;

  if (remaining < 0) {
    bust = true;
  } else if (remaining === 0) {
    if (cfg.doubleOut) {
      const last = st.currentDarts[st.currentDarts.length - 1];
      if (last && isDouble(last)) win = true;
      else bust = true;
    } else {
      win = true;
    }
  } else if (remaining === 1 && cfg.doubleOut) {
    bust = true; // 1 kvar går inte att gå ut på med dubbel
  }

  return { total, remaining, bust, win };
}

function canThrow(st: MatchState, cfg: MatchConfig): boolean {
  if (st.finished) return false;
  if (st.currentDarts.length >= 3) return false;
  const p = pending(st, cfg);
  return !p.bust && !p.win;
}

function throwDart(st: MatchState, cfg: MatchConfig, dart: Seg): boolean {
  if (!canThrow(st, cfg)) return false;
  st.currentDarts.push(dart);
  st.lastEvent = null;
  const p = pending(st, cfg);
  if (p.bust) st.lastEvent = { type: 'BUST', name: st.players[st.currentIndex].name };
  if (p.win) st.lastEvent = { type: 'WIN', name: st.players[st.currentIndex].name };
  return true;
}

function endTurn(st: MatchState, cfg: MatchConfig): boolean {
  if (st.finished) return false;
  const p = st.players[st.currentIndex];
  const res = pending(st, cfg);

  p.dartsThrown += st.currentDarts.length;

  if (res.win) {
    p.pointsScored += res.total;
    p.turns.push(res.total);
    p.lastTurnScore = res.total;
    p.checkout = res.total;
    p.score = 0;
    st.finished = true;
    st.winners = [p.name];
  } else if (res.bust) {
    p.turns.push(0); // tjock: turen räknas som 0, poängen står kvar
    p.lastTurnScore = 0;
  } else {
    p.score = res.remaining;
    p.pointsScored += res.total;
    p.turns.push(res.total);
    p.lastTurnScore = res.total;
  }

  st.currentDarts = [];
  st.lastEvent = null;
  if (!st.finished) {
    st.currentIndex = (st.currentIndex + 1) % st.players.length;
    if (st.currentIndex === 0) st.turnNo = (st.turnNo ?? 1) + 1;
  }
  return true;
}

function view(st: MatchState, cfg: MatchConfig): MatchView {
  const res = pending(st, cfg);
  const dartsLeft = 3 - st.currentDarts.length;
  let suggestion: Seg[] | null = null;
  if (!res.bust && !res.win && dartsLeft > 0) {
    suggestion = checkout(res.remaining, dartsLeft, cfg.doubleOut);
  }
  return {
    total: res.total,
    remaining: res.remaining,
    bust: res.bust,
    win: res.win,
    dartsLeft,
    available: 3,
    checkout: suggestion,
  };
}

export const x01Engine: Engine = { init, throwDart, endTurn, view, hasEndTurn: true };
export { pending as x01Pending };
