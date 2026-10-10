import {
  endTurn,
  insertThrow,
  removeThrow,
  replaceThrow,
  serializeMatch,
  throwDart,
  undo,
  matchState,
} from '../game/match';
import type { Match, MatchAction, MatchState } from '../game/types';
import {
  PROTOCOL_VERSION,
  isHostCommand,
  type HostCommand,
  type MatchOp,
  type ProposeMessage,
  type RemoteOp,
  type SnapshotMessage,
  type WireMessage,
} from './protocol';
import type { Transport } from './transport';

/** Visas på fjärrskärmen. Samma ordalydelse överallt, så den känns igen. */
export const REASON_STALE = 'Matchen ändrades - försök igen';
export const REASON_WRONG_MATCH = 'Det är en annan match nu - synkar om';
export const REASON_NO_MATCH = 'Ingen match pågår';
export const REASON_NO_SUCH_DART = 'Pilen finns inte längre';
export const REASON_NOT_ACCEPTED = 'Det gick inte just nu';

/** Ett accepterat förslag, för appens rättningslogg och historik. */
export interface AppliedOp {
  op: MatchOp;
  /** Fjärrskärmen som föreslog ändringen. */
  clientId: string;
  /**
   * Kastlistan FÖRE ändringen (grund kopia). Rättningsloggen behöver det
   * gamla kastet och dess detektionsdata, som är borta efteråt - samma skäl
   * som `logCorrection` i useMatch körs före ändringen.
   */
  before: readonly MatchAction[];
  after: MatchState;
  version: number;
}

export interface RemoteHostOptions {
  /**
   * Första versionsnumret. Standard är `Date.now()`, så att en host som
   * laddats om fortsätter UPPÅT från förra sessionens versioner: en
   * fjärrskärm som återansluter med ett gammalt `baseVersion` kan då aldrig
   * av en slump matcha den nya sessionens version och få ett index-förslag
   * tillämpat på fel kastlista. Ett tal per millisekund räcker gott - en
   * match ändras inte tusen gånger i sekunden.
   */
  initialVersion?: number;
  /**
   * Anropas efter att ett förslag från en fjärrskärm tillämpats på matchen.
   * Appen sparar och ritar om här, och loggar rättningar. Det rena lagret
   * importerar med flit inte rättningsloggen.
   */
  onApplied?: (applied: AppliedOp) => void;
  /** Hur många accepterade förslags-id som följer med varje ögonblicksbild. */
  ackedWindow?: number;
  /** En fjärrskärm har hälsat eller försvunnit. För indikatorn "fjärr ansluten (n)". */
  onPeersChanged?: (clients: string[]) => void;
  /**
   * Kommandon till kameraappen (ny match). Returnerar null om det utfördes,
   * annars skälet att visa på fjärrskärmen. Synkront: kvittensen skickas
   * direkt efteråt.
   */
  onCommand?: (cmd: HostCommand, clientId: string) => string | null;
}

interface Peer {
  transport: Transport;
  clientId: string | null;
  open: boolean;
  unsubscribe: () => void;
}

/** Index-förslag på en gammal version kan peka på fel pil. Se applyProposal. */
const INDEX_OPS: ReadonlySet<RemoteOp['kind']> = new Set(['replace', 'insert', 'remove', 'undo']);

/**
 * Kameraenhetens sida. Äger INTE matchen - den pekar på samma `Match`-objekt
 * som useMatch, så det finns bara en sanning. Ändringar från appen meddelas
 * med `notifyChanged`; förslag från fjärrskärmar körs genom precis samma
 * funktioner i game/match.ts som hosts egna knappar.
 */
export class RemoteHost {
  private match: Match | null;
  private _version: number;
  private peers = new Set<Peer>();
  private acked: string[] = [];
  private readonly ackedWindow: number;
  private readonly onApplied?: (applied: AppliedOp) => void;
  private readonly onPeersChanged?: (clients: string[]) => void;
  private readonly onCommand?: (cmd: HostCommand, clientId: string) => string | null;
  /** Vad som senast skickades, så att ett notifyChanged utan ändring inte ger en ny version. */
  private lastSentJson: string;

  constructor(match: Match | null, opts: RemoteHostOptions = {}) {
    this.match = match;
    this._version = opts.initialVersion ?? Date.now();
    this.ackedWindow = opts.ackedWindow ?? 16;
    this.onApplied = opts.onApplied;
    this.onPeersChanged = opts.onPeersChanged;
    this.onCommand = opts.onCommand;
    this.lastSentJson = this.matchJson();
  }

  get version(): number {
    return this._version;
  }

  get currentMatch(): Match | null {
    return this.match;
  }

  /** Fjärrskärmar med öppen kanal som har hälsat. För indikatorn "fjärr ansluten (n)". */
  get connectedClients(): string[] {
    return [...this.peers].filter((p) => p.open && p.clientId).map((p) => p.clientId as string);
  }

  /** Kopplar in en fjärrskärm. Returnerar en funktion som kopplar ur den. */
  attach(transport: Transport): () => void {
    const peer: Peer = { transport, clientId: null, open: false, unsubscribe: () => {} };
    const offMsg = transport.onMessage((msg) => this.handle(peer, msg));
    const offState = transport.onStateChange((s) => {
      peer.open = s === 'open';
      // En fjärrskärm som försvinner får inte påverka spelet: bara glöm den.
      if (s === 'closed' && this.peers.delete(peer)) this.peersChanged();
    });
    peer.unsubscribe = () => {
      offMsg();
      offState();
    };
    this.peers.add(peer);
    return () => {
      peer.unsubscribe();
      if (this.peers.delete(peer)) this.peersChanged();
    };
  }

  private peersChanged(): void {
    this.onPeersChanged?.(this.connectedClients);
  }

  /**
   * Appen anropar detta efter varje egen ändring (kast från detektorn,
   * rättning på hosts skärm, ny match, avslutad match). Anrop utan faktisk
   * ändring - t.ex. en omritning efter att ett förslag redan tillämpats här -
   * ger ingen ny version.
   */
  notifyChanged(match: Match | null): void {
    this.match = match;
    if (this.matchJson() === this.lastSentJson) return;
    this._version++;
    this.broadcast();
  }

  private matchJson(): string {
    return this.match ? JSON.stringify(serializeMatch(this.match)) : '';
  }

  private snapshot(): SnapshotMessage {
    return {
      v: PROTOCOL_VERSION,
      type: 'snapshot',
      matchId: this.match?.id ?? '',
      version: this._version,
      match: this.match ? serializeMatch(this.match) : null,
      acked: [...this.acked],
    };
  }

  private broadcast(): void {
    this.lastSentJson = this.matchJson();
    const snap = this.snapshot();
    for (const p of this.peers) {
      if (p.open) p.transport.send(snap);
    }
  }

  private handle(peer: Peer, msg: WireMessage): void {
    switch (msg.type) {
      case 'hello':
        if (peer.clientId !== msg.clientId) {
          peer.clientId = msg.clientId;
          this.peersChanged();
        }
        // Alltid aktuell bild, oavsett knownVersion: den är några kB och
        // bekräftar samtidigt att kanalen fungerar åt båda håll.
        peer.transport.send(this.snapshot());
        return;
      case 'propose':
        this.applyProposal(peer, msg);
        return;
      case 'ping':
        peer.transport.send({ v: PROTOCOL_VERSION, type: 'pong', matchId: msg.matchId, t: msg.t });
        return;
      default:
        // snapshot/reject/frame går bara host → remote; pong behöver inget svar.
        return;
    }
  }

  private ack(proposalId: string): void {
    this.acked.push(proposalId);
    if (this.acked.length > this.ackedWindow) this.acked.splice(0, this.acked.length - this.ackedWindow);
  }

  private reject(peer: Peer, msg: ProposeMessage, reason: string): void {
    peer.transport.send({
      v: PROTOCOL_VERSION,
      type: 'reject',
      matchId: this.match?.id ?? '',
      proposalId: msg.proposalId,
      reason,
    });
  }

  private applyProposal(peer: Peer, msg: ProposeMessage): void {
    // Kommandon (ny match m.m.) gäller kameraappen, inte en viss match: de
    // kontrolleras inte mot matchId - "starta en match" måste gå även när
    // ingen finns - och App avgör om de går att utföra.
    if (isHostCommand(msg.op)) {
      const reason = this.onCommand ? this.onCommand(msg.op, peer.clientId ?? '') : REASON_NOT_ACCEPTED;
      if (reason) return this.reject(peer, msg, reason);
      this.ack(msg.proposalId);
      // Bara kvittensen: en ny match når fjärrskärmarna när App anropat
      // notifyChanged, med ny version. Samma version här - fjärrskärmen
      // läser kvittensen men behåller sin bild.
      const snap = this.snapshot();
      for (const p of this.peers) if (p.open) p.transport.send(snap);
      return;
    }
    const match = this.match;
    if (!match) return this.reject(peer, msg, REASON_NO_MATCH);
    if (msg.matchId !== match.id) {
      this.reject(peer, msg, REASON_WRONG_MATCH);
      // Fjärrskärmen har en gammal match: ge den den nya direkt.
      peer.transport.send(this.snapshot());
      return;
    }
    const op = msg.op;
    // En pil som landade, eller en dold pil som sattes in, medan någon
    // rättade kan flytta index och ändrar vad "senaste" är. Ett
    // index-förslag på en gammal version kan alltså rätta, ta bort eller
    // ångra fel pil. Hellre "försök igen" än en tyst felrättning. `undo` hör
    // hit trots att det saknar index: det pekar på "det senaste", och det
    // senaste kan vara en pil fjärrskärmen ännu inte sett.
    if (msg.baseVersion !== this._version && INDEX_OPS.has(op.kind)) {
      return this.reject(peer, msg, REASON_STALE);
    }
    if (op.kind === 'replace' || op.kind === 'remove') {
      // replaceThrow skulle annars glatt göra ett turbyte ('E') till ett kast.
      const target = match.actions[op.actionIndex];
      if (!Number.isInteger(op.actionIndex) || !target || target.t !== 'T') {
        return this.reject(peer, msg, REASON_NO_SUCH_DART);
      }
    }
    if (op.kind === 'insert' && (op.actionIndex < 0 || op.actionIndex > match.actions.length)) {
      return this.reject(peer, msg, REASON_NO_SUCH_DART);
    }

    const before = match.actions.slice();
    const beforeJson = JSON.stringify(match.actions);
    switch (op.kind) {
      case 'throw':
        throwDart(match, op.seg);
        break;
      case 'replace':
        replaceThrow(match, op.actionIndex, op.seg);
        break;
      case 'insert':
        insertThrow(match, op.actionIndex, op.seg);
        break;
      case 'remove':
        removeThrow(match, op.actionIndex);
        break;
      case 'undo':
        undo(match);
        break;
      case 'endTurn':
        endTurn(match);
        break;
    }
    // Motorn säger inte nej, den låter bli: ett kast i en full tur, ett
    // turbyte i Farfar eller en ångra på en tom match lämnar kastlistan som
    // den var. Det är alltså jämförelsen som är svaret.
    if (JSON.stringify(match.actions) === beforeJson) {
      return this.reject(peer, msg, REASON_NOT_ACCEPTED);
    }

    this.ack(msg.proposalId);
    this._version++;
    this.broadcast();
    this.onApplied?.({
      op,
      clientId: peer.clientId ?? '',
      before,
      after: matchState(match),
      version: this._version,
    });
  }
}
