/**
 * Trådformatet mellan kameraenheten (host) och fjärrskärmar (remote).
 *
 * AVSTEG FRÅN SPECIFIKATIONEN (se PLAN_FJARRSKARM.md): hela den serialiserade
 * matchen skickas med ett versionsnummer, inte enskilda event med
 * sekvensnummer. `match.actions` är ingen logg som bara växer - rättningar
 * (`replaceThrow`, `insertThrow`, `removeThrow`, `undo`) ändrar den på plats,
 * så ett sekvensnummer per post skulle förskjutas vid varje insättning. En
 * match är några kB; att skicka om den efter varje ändring är försumbart på
 * LAN, och luckor och dubbletter slutar vara ett problem: remote tar alltid
 * den högsta versionen den sett.
 *
 * Allt är ren data (JSON). Inga beroenden till React, WebRTC eller OpenCV.
 */
import type { GameMode, MatchAction, MatchConfig, Seg } from '../game/types';

export const PROTOCOL_VERSION = 1;

/** Det `serializeMatch` ger - utan motorns interna cache. */
export interface SerializedMatch {
  id: string;
  createdAt: string;
  config: MatchConfig;
  actions: MatchAction[];
}

/** Det GameSetup ger: spelläge, regelval och spelarnas namn. */
export interface StartMatchConfig {
  mode: GameMode;
  doubleOut: boolean;
  farfarCap: boolean;
  players: { name: string }[];
}

export type CalibrateAction = 'open' | 'auto' | 'save' | 'cancel';

/**
 * Ändringar i matchen: samma operationer som useMatch exponerar, inga fler.
 * Index är index i `match.actions` (samma `ai` som i `ThrowLogEntry`).
 */
export type MatchOp =
  | { kind: 'throw'; seg: Seg }
  | { kind: 'replace'; actionIndex: number; seg: Seg }
  | { kind: 'insert'; actionIndex: number; seg: Seg }
  | { kind: 'remove'; actionIndex: number }
  | { kind: 'undo' }
  | { kind: 'endTurn' };

/**
 * Kommandon till kameraappen själv, inte till matchen: ny match (och senare
 * kalibrering). De rör sånt som bor i App - uppstartsflödet, detektorn - så
 * RemoteHost lämnar dem vidare via `onCommand` i stället för att tillämpa
 * dem själv. Tillagda efter första enhetstestet 2026-10-09: varje tryck på
 * telefonen i stativet riskerar att rubba bilden.
 */
export type HostCommand = { kind: 'startMatch'; config: StartMatchConfig };

export type RemoteOp = MatchOp | HostCommand;

export const isHostCommand = (op: RemoteOp): op is HostCommand => op.kind === 'startMatch';

const MODES: readonly GameMode[] = ['301', '501', 'FARFAR'];
/** Samma tak som GameSetup. */
export const MAX_PLAYERS = 8;
const MAX_NAME = 30;

interface Envelope {
  v: typeof PROTOCOL_VERSION;
  /** `match.id`, eller '' när host inte har någon match. */
  matchId: string;
}

/** remote → host: anslut, eller be om det aktuella läget igen. */
export interface HelloMessage extends Envelope {
  type: 'hello';
  clientId: string;
  /** Högsta version remote har; -1 om den inte har någon. Bara informativ. */
  knownVersion: number;
}

/** host → remote: hela matchen i en viss version. */
export interface SnapshotMessage extends Envelope {
  type: 'snapshot';
  version: number;
  match: SerializedMatch | null;
  /**
   * De senast accepterade förslagens id. Följer med VARJE ögonblicksbild, inte
   * bara den som förslaget gav upphov till: tappas eller kastas den om i
   * ordningen räcker nästa bild för att remote ska veta att förslaget gick
   * igenom.
   */
  acked: string[];
}

/** remote → host: förslag på ändring. Tillämpas aldrig lokalt i förväg. */
export interface ProposeMessage extends Envelope {
  type: 'propose';
  proposalId: string;
  /** Versionen remote såg när förslaget gjordes. */
  baseVersion: number;
  op: RemoteOp;
}

/** host → remote: förslaget avvisades. `reason` visas för spelaren. */
export interface RejectMessage extends Envelope {
  type: 'reject';
  proposalId: string;
  reason: string;
}

export interface PingMessage extends Envelope {
  type: 'ping';
  t: number;
}

export interface PongMessage extends Envelope {
  type: 'pong';
  t: number;
}

/**
 * host → remote: beskuren bild av ett kast (fas 4). Hålls utanför matchen -
 * bilder är diagnostik, inte speltillstånd. Bara typen finns ännu.
 */
export interface FrameMessage extends Envelope {
  type: 'frame';
  /** Stabil nyckel för bilden (kastets index flyttas vid insättningar). */
  frameId: string;
  /** Versionen då kastet registrerades, och kastets index i just den. */
  version: number;
  actionIndex: number;
  jpegBase64: string;
  /** Utsnittet i råbildskoordinater. */
  crop: { x: number; y: number; w: number; h: number };
  /** Spetsen i det beskurna utsnittets koordinater. */
  tipPx: { x: number; y: number };
}

export type WireMessage =
  | HelloMessage
  | SnapshotMessage
  | ProposeMessage
  | RejectMessage
  | PingMessage
  | PongMessage
  | FrameMessage;

/* --- validering ---------------------------------------------------------- */

const isInt = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x);
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isStr = (x: unknown): x is string => typeof x === 'string';
const isObj = (x: unknown): x is Record<string, unknown> =>
  !!x && typeof x === 'object' && !Array.isArray(x);

/**
 * Ett fält som går att träffa: 0 (miss, m=1), 1-20 (m 1-3), 25 (m 1-2).
 * Host litar inte på remote - ett påhittat fält som `{v: 19, m: 7}` skulle
 * annars gå rakt in i kastlistan.
 */
export function isValidSeg(s: unknown): s is Seg {
  if (!isObj(s) || !isInt(s.v) || !isInt(s.m)) return false;
  if (s.v === 0) return s.m === 1;
  if (s.v === 25) return s.m === 1 || s.m === 2;
  return s.v >= 1 && s.v <= 20 && s.m >= 1 && s.m <= 3;
}

function isValidOp(op: unknown): op is RemoteOp {
  if (!isObj(op)) return false;
  switch (op.kind) {
    case 'throw':
      return isValidSeg(op.seg);
    case 'replace':
    case 'insert':
      return isInt(op.actionIndex) && isValidSeg(op.seg);
    case 'remove':
      return isInt(op.actionIndex);
    case 'undo':
    case 'endTurn':
      return true;
    case 'startMatch':
      return isValidStartConfig(op.config);
    default:
      return false;
  }
}

/** Host litar inte på remote: okänt spelläge eller en tom spelarlista ska inte bli en match. */
export function isValidStartConfig(c: unknown): c is StartMatchConfig {
  if (!isObj(c) || !MODES.includes(c.mode as GameMode)) return false;
  if (typeof c.doubleOut !== 'boolean' || typeof c.farfarCap !== 'boolean') return false;
  if (!Array.isArray(c.players) || c.players.length < 1 || c.players.length > MAX_PLAYERS) return false;
  return c.players.every((p) => isObj(p) && isStr(p.name) && p.name.trim().length > 0 && p.name.length <= MAX_NAME);
}

/**
 * Bara formen kontrolleras här; om matchen själv är giltig avgör
 * `restoreMatch` på remote-sidan, precis som för den sparade matchen.
 */
function isSerializedMatch(m: unknown): m is SerializedMatch {
  return isObj(m) && isStr(m.id) && isObj(m.config) && Array.isArray(m.actions);
}

/**
 * Tar emot vad som helst som kommit över tråden och ger tillbaka ett
 * meddelande - eller null om det inte är ett vi förstår. En okänd typ eller
 * fel protokollversion är inget fel att krascha på: den andra enheten kan
 * köra en annan build.
 */
export function parseWireMessage(raw: unknown): WireMessage | null {
  if (!isObj(raw) || raw.v !== PROTOCOL_VERSION || !isStr(raw.matchId)) return null;
  const m = raw;
  switch (m.type) {
    case 'hello':
      return isStr(m.clientId) && isInt(m.knownVersion) ? (m as unknown as HelloMessage) : null;
    case 'snapshot':
      return isInt(m.version) &&
        (m.match === null || isSerializedMatch(m.match)) &&
        Array.isArray(m.acked) &&
        m.acked.every(isStr)
        ? (m as unknown as SnapshotMessage)
        : null;
    case 'propose':
      return isStr(m.proposalId) && isInt(m.baseVersion) && isValidOp(m.op)
        ? (m as unknown as ProposeMessage)
        : null;
    case 'reject':
      return isStr(m.proposalId) && isStr(m.reason) ? (m as unknown as RejectMessage) : null;
    case 'ping':
    case 'pong':
      return isNum(m.t) ? (m as unknown as PingMessage | PongMessage) : null;
    case 'frame':
      return isStr(m.frameId) &&
        isInt(m.version) &&
        isInt(m.actionIndex) &&
        isStr(m.jpegBase64) &&
        isObj(m.crop) &&
        isObj(m.tipPx)
        ? (m as unknown as FrameMessage)
        : null;
    default:
      return null;
  }
}

export function encodeMessage(msg: WireMessage): string {
  return JSON.stringify(msg);
}

export function decodeMessage(text: string): WireMessage | null {
  try {
    return parseWireMessage(JSON.parse(text));
  } catch {
    return null;
  }
}

/** Slumpat id utan beroenden; `crypto.randomUUID` saknas i äldre Safari och utanför secure context. */
export function randomId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
