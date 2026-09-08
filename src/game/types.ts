/**
 * Delad regelmodell för 301 / 501 / Farfar.
 *
 * Portad från `kps-dart-scorecard` (js/engine/*). Kärnidén är oförändrad: en
 * match sparar aldrig ställningen, bara en lista med kast, och ställningen
 * räknas alltid fram från listan. Därför går vilket kast som helst att ångra
 * eller rätta i efterhand - allt räknas om.
 */

export type GameMode = '301' | '501' | 'FARFAR';

/** En pil: fält `v` (0 = miss, 1-20, 25 = bull) och multiplikator `m` (1/2/3). */
export interface Seg {
  v: number;
  m: number;
}

export interface MatchPlayerConfig {
  id: string;
  name: string;
}

export interface MatchConfig {
  mode: GameMode;
  /** Startpoäng (301/501); 0 för Farfar. */
  start: number;
  doubleOut: boolean;
  farfarCap: boolean;
  players: MatchPlayerConfig[];
}

export type MatchEventType = 'BUST' | 'WIN' | 'BULL' | 'CLEARED' | 'ELIMINATED';

export interface MatchEvent {
  type: MatchEventType;
  name: string;
  saved?: number;
  total?: number;
  round?: number;
}

export interface PlayerState {
  id: string;
  name: string;
  dartsThrown: number;
  pointsScored: number;
  turns: number[];
  lastTurnScore: number | null;

  /* 301 / 501 */
  score?: number;
  checkout?: number | null;

  /* Farfar */
  savedDarts?: number;
  eliminated?: boolean;
  eliminatedRound?: number | null;
  roundScore?: number | null;
}

export interface ThrowLogEntry {
  /** Index i `match.actions`. */
  ai: number;
  playerId: string;
  playerName: string;
  round: number;
  dartNo: number;
  dart: Seg;
}

export interface MatchView {
  total: number;
  available: number;
  dartsLeft: number;

  /* 301 / 501 */
  remaining?: number;
  bust?: boolean;
  win?: boolean;
  checkout?: Seg[] | null;

  /* Farfar */
  target?: number;
  round?: number;
}

export interface MatchState {
  mode: GameMode;
  finished: boolean;
  winners: string[];
  currentIndex: number;
  currentDarts: Seg[];
  lastEvent: MatchEvent | null;
  players: PlayerState[];

  /* 301 / 501 */
  turnNo?: number;

  /* Farfar */
  round?: number;
  order?: number[];
  pos?: number;
  finalRound?: number | null;

  /* Fylls i av match.compute(): */
  log: ThrowLogEntry[];
  view: MatchView;
  active: PlayerState;
  config: MatchConfig;
}

export type MatchAction = { t: 'T'; v: number; m: number } | { t: 'E' };

export interface Match {
  id: string;
  createdAt: string;
  config: MatchConfig;
  actions: MatchAction[];
  /** Intern cache — rör inte. */
  _rev: number;
  _stateRev: number;
  _state: MatchState | null;
}

/** Regelmotor. x01 och farfar implementerar samma yta. */
export interface Engine {
  init(cfg: MatchConfig): MatchState;
  throwDart(st: MatchState, cfg: MatchConfig, dart: Seg): boolean;
  endTurn(st: MatchState, cfg: MatchConfig): boolean;
  view(st: MatchState, cfg: MatchConfig): MatchView;
  /** Har spelläget en manuell "tur klar"-knapp? (Farfar avslutar automatiskt.) */
  readonly hasEndTurn: boolean;
}
