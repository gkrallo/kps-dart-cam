import { matchState, restoreMatch } from '../game/match';
import type { Match, MatchState } from '../game/types';
import {
  PROTOCOL_VERSION,
  randomId,
  type RemoteOp,
  type SerializedMatch,
  type SnapshotMessage,
  type WireMessage,
} from './protocol';
import type { Transport } from './transport';

/** Egen nyckel: fjärrskärmens kopia får aldrig blandas ihop med hosts egen sparade match. */
export const REMOTE_STORAGE_KEY = 'kps-dart-cam:remote:v1';

export const REASON_NOT_CONNECTED = 'Inte ansluten till kameran';
export const REASON_DISCONNECTED = 'Frånkopplad';
export const REASON_TIMEOUT = 'Inget svar från kameran';

export type MiniStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

interface KnownSnapshot {
  matchId: string;
  version: number;
  match: SerializedMatch | null;
  /** När bilden togs emot (ms). För "visar senast kända läge" i fas 3. */
  receivedAt: number;
}

interface Stored {
  v: 1;
  clientId: string;
  snapshot: KnownSnapshot | null;
}

export interface RemoteReplicaOptions {
  /** Standard: localStorage om den finns. null = spara inget. */
  storage?: MiniStorage | null;
  clientId?: string;
  /** Hur länge ett förslag får vänta på svar. */
  proposeTimeoutMs?: number;
  now?: () => number;
}

interface Pending {
  resolve: () => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

function defaultStorage(): MiniStorage | null {
  try {
    const ls = (globalThis as { localStorage?: MiniStorage }).localStorage;
    return ls ?? null;
  } catch {
    // Åtkomsten i sig kan kasta (blockerad webbplatsdata).
    return null;
  }
}

/**
 * Fjärrskärmens kopia av matchen. Räknar fram ställningen med SAMMA
 * regelmotor som host (`matchState(restoreMatch(...))`) - ingen egen
 * tillståndsmodell. Ändrar aldrig matchen själv: förslag skickas till host
 * och syns först när host skickat en ny bild.
 */
export class RemoteReplica {
  readonly clientId: string;
  private snap: KnownSnapshot | null = null;
  private restored: Match | null = null;
  private transport: Transport | null = null;
  private detachTransport: (() => void) | null = null;
  private open = false;
  /**
   * Har vi fått en bild på den NUVARANDE kanalen? Den första bilden efter en
   * (åter)anslutning tas alltid, oavsett version: den kommer från hosten som
   * är sanningen nu, och en host på en annan enhet - eller med en klocka som
   * gått bakåt - kan ha lägre versioner än det vi sparat. Därefter vinner
   * högsta version, för inom en kanal räknar host bara uppåt.
   */
  private synced = false;
  private pending = new Map<string, Pending>();
  private listeners = new Set<() => void>();
  private readonly storage: MiniStorage | null;
  private readonly timeoutMs: number;
  private readonly now: () => number;
  /** Senaste meddelandet från host (ms), för frånkopplad-status. */
  lastHeardAt: number | null = null;

  constructor(opts: RemoteReplicaOptions = {}) {
    this.storage = opts.storage === undefined ? defaultStorage() : opts.storage;
    this.timeoutMs = opts.proposeTimeoutMs ?? 5000;
    this.now = opts.now ?? Date.now;
    const stored = this.load();
    this.clientId = opts.clientId ?? stored?.clientId ?? randomId();
    if (stored?.snapshot) this.take(stored.snapshot, false);
    this.save();
  }

  get matchId(): string | null {
    return this.snap?.matchId ?? null;
  }

  /** -1 = ingen bild alls. */
  get version(): number {
    return this.snap?.version ?? -1;
  }

  get receivedAt(): number | null {
    return this.snap?.receivedAt ?? null;
  }

  get match(): Match | null {
    return this.restored;
  }

  get state(): MatchState | null {
    return this.restored ? matchState(this.restored) : null;
  }

  /** Kanalen är öppen OCH vi har hostens aktuella läge - först då får man rätta. */
  get connected(): boolean {
    return this.open && this.synced;
  }

  /** För React (useSyncExternalStore) i fas 3. */
  subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  attach(transport: Transport): () => void {
    this.detachTransport?.();
    this.transport = transport;
    this.synced = false;
    const offMsg = transport.onMessage((msg) => this.handle(msg));
    const offState = transport.onStateChange((s) => {
      const wasOpen = this.open;
      this.open = s === 'open';
      if (this.open && !wasOpen) this.sendHello();
      if (s === 'closed') {
        this.synced = false;
        this.rejectAll(REASON_DISCONNECTED);
      }
      this.emit();
    });
    const detach = () => {
      offMsg();
      offState();
      if (this.transport === transport) {
        this.transport = null;
        this.open = false;
        this.synced = false;
        this.rejectAll(REASON_DISCONNECTED);
        this.emit();
      }
    };
    this.detachTransport = detach;
    return detach;
  }

  /** Be host om aktuellt läge igen (t.ex. om ett livstecken uteblivit). */
  resync(): void {
    this.sendHello();
  }

  /**
   * Livstecken. Datakanalen stängs inte vid ett wifiglapp - den blir bara
   * tyst - så det enda sättet att se att kameran inte hörs är att fråga.
   * Svaret (pong) uppdaterar `lastHeardAt`.
   */
  ping(): void {
    if (!this.transport || !this.open) return;
    this.transport.send({ v: PROTOCOL_VERSION, type: 'ping', matchId: this.snap?.matchId ?? '', t: this.now() });
  }

  /** Har kameran hörts av inom `maxAgeMs`? Falskt om kanalen inte är öppen. */
  isFresh(maxAgeMs: number): boolean {
    return this.connected && this.lastHeardAt !== null && this.now() - this.lastHeardAt <= maxAgeMs;
  }

  /**
   * Skickar ett förslag. Löses när en bild från host bekräftar att det
   * tillämpats; avvisas med hostens skäl (`Error.message`, på svenska), eller
   * vid timeout eller frånkoppling.
   *
   * `baseVersion`: versionen spelaren SÅG när hen valde pilen. Standard är den
   * aktuella, men en rättningsvy som stått öppen medan en pil landade ska
   * skicka versionen från när den öppnades - annars godtar kameran ett index
   * som nu kan peka på en annan pil.
   */
  propose(op: RemoteOp, baseVersion?: number): Promise<void> {
    const t = this.transport;
    if (!t || !this.connected || !this.snap) {
      return Promise.reject(new Error(REASON_NOT_CONNECTED));
    }
    const proposalId = randomId();
    const promise = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(proposalId);
        reject(new Error(REASON_TIMEOUT));
      }, this.timeoutMs);
      this.pending.set(proposalId, { resolve, reject, timer });
    });
    t.send({
      v: PROTOCOL_VERSION,
      type: 'propose',
      matchId: this.snap.matchId,
      proposalId,
      baseVersion: baseVersion ?? this.snap.version,
      op,
    });
    return promise;
  }

  private sendHello(): void {
    if (!this.transport || !this.open) return;
    this.transport.send({
      v: PROTOCOL_VERSION,
      type: 'hello',
      matchId: this.snap?.matchId ?? '',
      clientId: this.clientId,
      knownVersion: this.version,
    });
  }

  private handle(msg: WireMessage): void {
    this.lastHeardAt = this.now();
    switch (msg.type) {
      case 'snapshot':
        this.onSnapshot(msg);
        return;
      case 'reject': {
        const p = this.pending.get(msg.proposalId);
        if (!p) return;
        clearTimeout(p.timer);
        this.pending.delete(msg.proposalId);
        p.reject(new Error(msg.reason));
        return;
      }
      case 'ping':
        this.transport?.send({ v: PROTOCOL_VERSION, type: 'pong', matchId: msg.matchId, t: msg.t });
        return;
      default:
        return;
    }
  }

  private onSnapshot(msg: SnapshotMessage): void {
    const newer = !this.synced || msg.version > this.version;
    if (newer) {
      const ok = this.take(
        { matchId: msg.matchId, version: msg.version, match: msg.match, receivedAt: this.now() },
        true,
      );
      if (ok) this.synced = true;
    }
    // Även en gammal bild kan bekräfta förslag: `acked` är de senast
    // accepterade, och vår kopia är då redan minst lika ny.
    for (const id of msg.acked) {
      const p = this.pending.get(id);
      if (!p) continue;
      clearTimeout(p.timer);
      this.pending.delete(id);
      p.resolve();
    }
    if (newer) this.emit();
  }

  /**
   * Byter till en ny bild. Ett annat matchId betyder att den gamla kopian
   * kastas helt - den ersätts, inget slås ihop.
   */
  private take(s: KnownSnapshot, persist: boolean): boolean {
    let restored: Match | null = null;
    if (s.match) {
      restored = restoreMatch(s.match);
      // En trasig bild ska inte ersätta en hel: behåll det vi har.
      if (!restored) return false;
    }
    this.snap = s;
    this.restored = restored;
    if (persist) this.save();
    return true;
  }

  private rejectAll(reason: string): void {
    for (const [id, p] of this.pending) {
      clearTimeout(p.timer);
      this.pending.delete(id);
      p.reject(new Error(reason));
    }
  }

  private emit(): void {
    this.listeners.forEach((cb) => cb());
  }

  private load(): Stored | null {
    try {
      const raw = this.storage?.getItem(REMOTE_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Stored;
      return parsed && parsed.v === 1 && typeof parsed.clientId === 'string' ? parsed : null;
    } catch {
      return null;
    }
  }

  private save(): void {
    try {
      const data: Stored = { v: 1, clientId: this.clientId, snapshot: this.snap };
      this.storage?.setItem(REMOTE_STORAGE_KEY, JSON.stringify(data));
    } catch {
      /* privat surfning, full lagring - kopian finns ändå i minnet */
    }
  }
}
