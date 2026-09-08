import type { Engine, MatchConfig, MatchState, MatchView, PlayerState, Seg } from './types';
import { sum } from './segments';

/**
 * Farfar - husregler, bekräftade av Kristian. Portad från
 * scorecard/js/engine/farfar.js.
 *
 * - Runda 1 kräver 15 poäng, målet ökar med 5 per runda (runda 18 = 100).
 * - Du kastar med 3 grundpilar + alla pilar du sparat. Sparade pilar staplas
 *   utan tak.
 * - Så fort du nått målet är turen slut och resten av pilarna sparas.
 * - Röd bull (50) avslutar turen direkt och sparar resten, även om du inte nått
 *   målet. Grön bull (25) är bara 25 poäng.
 * - Når du inte målet innan pilarna tar slut är du utslagen.
 * - Rundan spelas alltid färdigt innan utslagningen avgörs.
 * - Sista kvarvarande spelaren vinner. Slås alla ut samma runda vinner den som
 *   fick högst poäng den rundan (delad vinst vid lika).
 * - Med "Tak på 100" avgörs matchen efter runda 18 - flest sparade pilar vinner.
 */

const FARFAR = { startTarget: 15, step: 5, capRound: 18 };

export function targetFor(round: number): number {
  return FARFAR.startTarget + (round - 1) * FARFAR.step;
}

function init(cfg: MatchConfig): MatchState {
  const state: MatchState = {
    mode: 'FARFAR',
    finished: false,
    winners: [],
    currentIndex: 0,
    round: 1,
    order: cfg.players.map((_, i) => i),
    pos: 0,
    currentDarts: [],
    lastEvent: null,
    finalRound: null,
    players: cfg.players.map((p) => ({
      id: p.id,
      name: p.name,
      savedDarts: 0,
      eliminated: false,
      eliminatedRound: null,
      roundScore: null,
      lastTurnScore: null,
      dartsThrown: 0,
      pointsScored: 0,
      turns: [],
    })),
    log: [],
    view: { total: 0, available: 3, dartsLeft: 3 },
    active: null as unknown as MatchState['active'],
    config: cfg,
  };
  state.active = state.players[0];
  return state;
}

function currentIndex(st: MatchState): number {
  const i = st.order?.[st.pos ?? 0];
  return i === undefined ? st.currentIndex || 0 : i;
}

/** Håller st.currentIndex i synk så resten av appen kan läsa den likadant. */
function sync(st: MatchState): void {
  const i = st.order?.[st.pos ?? 0];
  if (i !== undefined) st.currentIndex = i;
}

function availableFor(player: PlayerState): number {
  return 3 + (player.savedDarts ?? 0);
}

function canThrow(st: MatchState): boolean {
  if (st.finished) return false;
  const p = st.players[currentIndex(st)];
  if (!p) return false;
  return st.currentDarts.length < availableFor(p);
}

function throwDart(st: MatchState, cfg: MatchConfig, dart: Seg): boolean {
  if (!canThrow(st)) return false;

  const p = st.players[currentIndex(st)];
  const available = availableFor(p);
  st.currentDarts.push(dart);
  st.lastEvent = null;

  const total = sum(st.currentDarts);
  const target = targetFor(st.round ?? 1);
  const redBull = dart.v === 25 && dart.m === 2;

  let result: 'BULL' | 'CLEARED' | 'ELIMINATED' | null = null;
  if (redBull) result = 'BULL';
  else if (total >= target) result = 'CLEARED';
  else if (st.currentDarts.length >= available) result = 'ELIMINATED';

  if (result) finishTurn(st, cfg, result, total, available);
  sync(st);
  return true;
}

function finishTurn(
  st: MatchState,
  cfg: MatchConfig,
  result: 'BULL' | 'CLEARED' | 'ELIMINATED',
  total: number,
  available: number,
): void {
  const p = st.players[currentIndex(st)];

  p.dartsThrown += st.currentDarts.length;
  p.pointsScored += total;
  p.turns.push(total);
  p.roundScore = total;
  p.lastTurnScore = total;

  if (result === 'ELIMINATED') {
    p.eliminated = true;
    p.eliminatedRound = st.round ?? 1;
  } else {
    p.savedDarts = available - st.currentDarts.length;
  }

  st.lastEvent = {
    type: result,
    name: p.name,
    saved: p.savedDarts,
    total,
    round: st.round,
  };
  st.currentDarts = [];
  advance(st, cfg);
}

function advance(st: MatchState, cfg: MatchConfig): void {
  st.pos = (st.pos ?? 0) + 1;
  if (st.pos < (st.order?.length ?? 0)) return; // fler spelare kvar i rundan

  const round = st.round ?? 1;
  const alive = st.players.filter((p) => !p.eliminated);

  if (alive.length === 0) {
    const died = st.players.filter((p) => p.eliminatedRound === round);
    const best = died.reduce((m, p) => Math.max(m, p.roundScore ?? 0), -1);
    st.winners = died.filter((p) => (p.roundScore ?? 0) === best).map((p) => p.name);
    return end(st, round);
  }

  if (alive.length === 1 && st.players.length > 1) {
    st.winners = [alive[0].name];
    return end(st, round);
  }

  if (cfg.farfarCap && round >= FARFAR.capRound) {
    const mostDarts = alive.reduce((m, p) => Math.max(m, p.savedDarts ?? 0), -1);
    st.winners = alive.filter((p) => (p.savedDarts ?? 0) === mostDarts).map((p) => p.name);
    return end(st, round);
  }

  // Ny runda
  st.round = round + 1;
  st.order = [];
  st.players.forEach((p, i) => {
    if (!p.eliminated) {
      p.roundScore = null;
      st.order!.push(i);
    }
  });
  st.pos = 0;
  sync(st);
}

function end(st: MatchState, round: number): void {
  st.finished = true;
  st.finalRound = round;
}

function endTurn(): boolean {
  return false; // Farfar avslutar turen automatiskt - knappen finns inte
}

function view(st: MatchState): MatchView {
  const p = st.players[currentIndex(st)];
  const available = p ? availableFor(p) : 3;
  return {
    total: sum(st.currentDarts),
    target: targetFor(st.round ?? 1),
    available,
    dartsLeft: available - st.currentDarts.length,
    round: st.round,
  };
}

export const farfarEngine: Engine = { init, throwDart, endTurn, view, hasEndTurn: false };
export { availableFor as farfarAvailableFor, currentIndex as farfarCurrentIndex };
