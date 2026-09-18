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
  const before = matchState(match);
  match.actions.push({ t: 'E' });
  const st = bump(match);
  // Ett 'E' som inte gav effekt (Farfar avslutar turen själv och vägrar; en
  // avgjord match tar inte emot något) ska inte ligga kvar i listan. Annars
  // fastnar 'undo' på det döda 'E':t - första "Ångra" tar bara bort det och
  // ingenting syns hända - och vinst-effekten i App, som körs två gånger under
  // StrictMode, lämnade två 'E' efter sig.
  const noEffect =
    st.finished === before.finished &&
    st.currentIndex === before.currentIndex &&
    st.currentDarts.length === before.currentDarts.length &&
    st.turnNo === before.turnNo &&
    st.round === before.round;
  if (noEffect) {
    match.actions.pop();
    return bump(match);
  }
  return st;
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
 * bakom en annan och först hittades när den framförvarande drogs ut -
 * se `onHiddenDartRevealed` i `useDartDetector`). Till skillnad från
 * `throwDart` går kastet in på en given plats i listan, inte sist, så
 * turordningen blir rätt även om den avslöjade pilen egentligen kastades
 * före ett redan registrerat kast.
 */
export function insertThrow(match: Match, actionIndex: number, dart: Seg): MatchState {
  const at = Math.max(0, Math.min(actionIndex, match.actions.length));
  const before = matchState(match).log.length;
  match.actions.splice(at, 0, { t: 'T', v: dart.v, m: dart.m });
  const st = bump(match);
  // Samma regel som throwDart: fick pilen ingen effekt (turen var redan full
  // i 301/501) ska den inte ligga kvar som ett dött kast som tyst dyker upp
  // igen när någon annan pil i turen tas bort.
  if (st.log.length === before) {
    match.actions.splice(at, 1);
    return bump(match);
  }
  return st;
}

/**
 * Var en pil som avslöjats vid uttagning sätts in i kastlistan.
 *
 * Sist i den pågående turen. Det är en GISSNING, och det är värt att veta
 * varför det ändå är den bästa:
 *
 * En pil blir oläst för att den i landningsögonblicket inte gav tillräckligt
 * med ny synlig yta - alltså skymdes den av något som redan satt i tavlan,
 * och det kan bara vara en TIDIGARE pil. Pil 1 kan därför aldrig skymmas, och
 * risken växer med kastnumret. Sist i turen är alltså den enskilt troligaste
 * platsen, och den ligger garanterat efter den pil som skymde.
 *
 * Tidigare räknades platsen fram ur hur många pilar som dragits ut hittills
 * (`insertIndexForMissedThrow`), på antagandet att pilarna alltid drogs ut i
 * omvänd kastordning. Det antagandet är borta: uttagningen är numera
 * positionsbaserad (`dartCensus.ts`) och spelaren uppmanas dra ut de pilar som
 * räknats rätt, i vilken ordning som helst - bland annat för att man i
 * praktiken inte minns kastordningen.
 *
 * Eventuella avslutande 'E' hoppas över, så pilen inte hamnar i NÄSTA spelares
 * tur om turen redan hunnit avslutas.
 */
export function insertIndexForRevealedThrow(actions: MatchAction[], state?: MatchState): number {
  // Farfar har inga 'E' i listan: motorn stänger turen själv så fort målet
  // (eller röd bull) nås. Är turen redan stängd när den dolda pilen hittas -
  // vilket är precis läget när en pil saknas, för då nåddes målet med FÄRRE
  // pilar än som kastades - skulle "sist i listan" lägga pilen som NÄSTA
  // spelares första kast. Sätt den då in FÖRE pilen som stängde turen, så
  // den stängande pilen förblir sist och spelaren får rätt antal sparade.
  if (
    state &&
    state.currentDarts.length === 0 &&
    state.log.length > 0 &&
    actions.length > 0 &&
    actions[actions.length - 1].t === 'T'
  ) {
    return state.log[state.log.length - 1].ai;
  }
  let i = actions.length;
  while (i > 0 && actions[i - 1].t === 'E') i--;
  return i;
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
  // Trasig lagring ska ge "ingen match", inte en x01-motor med start=undefined
  // som tror att matchen är vunnen innan första pilen.
  if (!(d.config.mode in START)) return null;
  const validAction = (a: unknown): a is MatchAction => {
    const x = a as { t?: unknown; v?: unknown; m?: unknown } | null;
    if (!x || typeof x !== 'object') return false;
    if (x.t === 'E') return true;
    return x.t === 'T' && typeof x.v === 'number' && typeof x.m === 'number';
  };
  if (!d.actions.every(validAction)) return null;
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
