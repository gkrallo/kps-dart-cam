import type {
  Engine,
  GameMode,
  Match,
  MatchAction,
  MatchConfig,
  MatchState,
  Seg,
} from './types';
import { x01Engine } from './x01';
import { farfarEngine } from './farfar';

/**
 * En match = inställningar + en lista med kast. Ställningen sparas aldrig, den
 * räknas alltid fram från kastlistan. Det gör att man kan ångra, ta bort eller
 * ändra vilket kast som helst, även flera spelare tillbaka, och få en korrekt
 * ställning igen. Portad från scorecard/js/engine/match.js.
 */

const START: Record<GameMode, number> = { '301': 301, '501': 501, FARFAR: 0 };

export function engineFor(cfg: MatchConfig): Engine {
  return cfg.mode === 'FARFAR' ? farfarEngine : x01Engine;
}

export interface CreateMatchOptions {
  mode: GameMode;
  doubleOut?: boolean;
  farfarCap?: boolean;
  players: { id?: string; name: string }[];
}

export function createMatch(opts: CreateMatchOptions): Match {
  const cfg: MatchConfig = {
    mode: opts.mode,
    start: START[opts.mode] ?? 0,
    doubleOut: !!opts.doubleOut,
    farfarCap: !!opts.farfarCap,
    players: opts.players.map((p, i) => ({
      id: p.id || `p${i}-${Date.now()}`,
      name: p.name,
    })),
  };
  return {
    id: 'm' + Date.now(),
    createdAt: new Date().toISOString(),
    config: cfg,
    actions: [],
    _rev: 0,
    _stateRev: -1,
    _state: null,
  };
}

/**
 * Räknar fram ställningen från kastlistan. Kast som inte är giltiga längre
 * hoppas över men ligger kvar i listan så att de kommer tillbaka om en
 * rättning ångras.
 */
function compute(match: Match): MatchState {
  const cfg = match.config;
  const engine = engineFor(cfg);
  const st = engine.init(cfg);
  st.log = [];
  st.config = cfg;

  for (let i = 0; i < match.actions.length; i++) {
    const a = match.actions[i];
    if (a.t === 'T') {
      const player = st.players[st.currentIndex];
      const round = st.round ?? st.turnNo ?? 1;
      const dartNo = st.currentDarts.length + 1;
      if (engine.throwDart(st, cfg, { v: a.v, m: a.m })) {
        st.log.push({
          ai: i,
          playerId: player.id,
          playerName: player.name,
          round,
          dartNo,
          dart: { v: a.v, m: a.m },
        });
      }
    } else if (a.t === 'E') {
      engine.endTurn(st, cfg);
    }
  }

  st.view = engine.view(st, cfg);
  st.active = st.players[st.currentIndex];
  return st;
}

export function matchState(match: Match): MatchState {
  if (match._stateRev !== match._rev || !match._state) {
    match._state = compute(match);
    match._stateRev = match._rev;
  }
  return match._state;
}

function bump(match: Match): MatchState {
  match._rev++;
  return matchState(match);
}

/* --- handlingar ------------------------------------------------------- */

export function throwDart(match: Match, dart: Seg): MatchState {
  const before = matchState(match).log.length;
  match.actions.push({ t: 'T', v: dart.v, m: dart.m });
  const st = bump(match);
  if (st.log.length === before) {
    // kastet var inte tillåtet just nu - ta bort det igen
    match.actions.pop();
    return bump(match);
  }
  return st;
}

export function endTurn(match: Match): MatchState {
  match.actions.push({ t: 'E' });
  return bump(match);
}

/**
 * Ångra: tar bort det senaste kastet/turbytet som faktiskt gav effekt, plus
 * eventuella döda kast efter det.
 */
export function undo(match: Match): MatchState {
  const st = matchState(match);
  let lastIndex = -1;
  for (let i = match.actions.length - 1; i >= 0; i--) {
    if (match.actions[i].t === 'E') {
      lastIndex = i;
      break;
    }
    if (st.log.some((l) => l.ai === i)) {
      lastIndex = i;
      break;
    }
  }
  if (lastIndex < 0) return st;
  match.actions.length = lastIndex;
  return bump(match);
}

export function canUndo(match: Match): boolean {
  return match.actions.length > 0;
}

export function removeThrow(match: Match, actionIndex: number): MatchState {
  if (actionIndex < 0 || actionIndex >= match.actions.length) return matchState(match);
  match.actions.splice(actionIndex, 1);
  return bump(match);
}

export function replaceThrow(match: Match, actionIndex: number, dart: Seg): MatchState {
  if (actionIndex < 0 || actionIndex >= match.actions.length) return matchState(match);
  match.actions[actionIndex] = { t: 'T', v: dart.v, m: dart.m };
  return bump(match);
}

/**
 * Sätter in ett kast som saknades i kastlistan (t.ex. en pil som satt dold
 * bakom en annan och först hittades när pilarna drogs ut i omvänd ordning -
 * se `onHiddenDartRevealed` i `useDartDetector`). Till skillnad från
 * `throwDart` går kastet in på en given plats i listan, inte sist, så
 * turordningen blir rätt även om den avslöjade pilen egentligen kastades
 * före ett redan registrerat kast.
 */
export function insertThrow(match: Match, actionIndex: number, dart: Seg): MatchState {
  const at = Math.max(0, Math.min(actionIndex, match.actions.length));
  match.actions.splice(at, 0, { t: 'T', v: dart.v, m: dart.m });
  return bump(match);
}

/**
 * Var ska en pil som hittades vid uttagning sättas in? Pilar dras sist-först,
 * så när `removedCount` pilar redan dragits ur är den vi just tog bort kast
 * nummer `removedCount + 1` bakifrån - den dolda pilen kastades precis före
 * det, alltså på samma index.
 *
 * Räknar bara 'T'-poster: avslutas turen manuellt med "Nästa" lägger motorn
 * en 'E' sist i listan, och räknas den som ett kast hamnar insättningen ett
 * steg fel (och därmed i fel tur).
 */
export function insertIndexForMissedThrow(actions: MatchAction[], removedCount: number): number {
  let seen = 0;
  for (let i = actions.length - 1; i >= 0; i--) {
    if (actions[i].t !== 'T') continue;
    if (seen === removedCount) return i;
    seen++;
  }
  return 0;
}

export function serializeMatch(match: Match) {
  return {
    id: match.id,
    createdAt: match.createdAt,
    config: match.config,
    actions: match.actions,
  };
}

export function restoreMatch(data: unknown): Match | null {
  const d = data as Partial<Match> | null;
  if (!d || !d.config || !Array.isArray(d.actions)) return null;
  if (!d.config.players || !d.config.players.length) return null;
  return {
    id: d.id ?? 'm' + Date.now(),
    createdAt: d.createdAt ?? new Date().toISOString(),
    config: d.config,
    actions: d.actions,
    _rev: 0,
    _stateRev: -1,
    _state: null,
  };
}
