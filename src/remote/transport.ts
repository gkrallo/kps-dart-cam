import { decodeMessage, encodeMessage, type WireMessage } from './protocol';

export type TransportState = 'connecting' | 'open' | 'closed';

/**
 * Det enda synk-lagret vet om förbindelsen. WebRTC (fas 2) och loopback
 * (tester) implementerar samma yta.
 *
 * Två krav som implementationerna MÅSTE uppfylla, för synk-lagret räknar med
 * dem:
 * - `send` serialiserar meddelandet direkt. Host skickar `serializeMatch`,
 *   som pekar på den levande kastlistan; serialiseras den först vid
 *   leveransen kan bilden hinna ändras och bära fel innehåll för sin version.
 * - `onStateChange` anropar `cb` direkt med det nuvarande tillståndet. Annars
 *   går det inte att veta om en kanal som redan hunnit öppnas är öppen.
 */
export interface Transport {
  send(msg: WireMessage): void;
  onMessage(cb: (msg: WireMessage) => void): () => void;
  onStateChange(cb: (s: TransportState) => void): () => void;
  close(): void;
}

export interface LoopbackOptions {
  /**
   * Fördröjning per meddelande i ms. Slumpad fördröjning per meddelande ger
   * omkastad ordning. 0 levereras i en mikrotask - aldrig synkront, för en
   * riktig kanal är aldrig synkron och synkron leverans döljer reentrans-fel.
   */
  delayMs?: number | ((msg: WireMessage) => number);
  /** Returnerar true för meddelanden som ska tappas. */
  drop?: (msg: WireMessage) => boolean;
}

/** Ett par sammankopplade transporter i samma process, för tester. */
export interface LoopbackPair {
  /** Kameraenhetens ände. */
  host: Transport;
  /** Fjärrskärmens ände. */
  remote: Transport;
  /** Väntar tills inga meddelanden är på väg (inklusive svar som skickas under väntan). */
  idle(): Promise<void>;
}

class LoopbackEnd implements Transport {
  peer: LoopbackEnd | null = null;
  state: TransportState = 'open';
  private messageCbs = new Set<(msg: WireMessage) => void>();
  private stateCbs = new Set<(s: TransportState) => void>();

  constructor(
    private readonly opts: LoopbackOptions,
    private readonly inFlight: { n: number; waiters: (() => void)[] },
  ) {}

  send(msg: WireMessage): void {
    const peer = this.peer;
    if (this.state !== 'open' || !peer) return;
    // Serialisera NU, se kravet i Transport.
    const text = encodeMessage(msg);
    if (this.opts.drop?.(msg)) return;
    const d = this.opts.delayMs;
    const delay = typeof d === 'function' ? d(msg) : (d ?? 0);
    this.inFlight.n++;
    const deliver = () => {
      try {
        if (peer.state !== 'open') return;
        const decoded = decodeMessage(text);
        if (decoded) peer.messageCbs.forEach((cb) => cb(decoded));
      } finally {
        this.inFlight.n--;
        if (this.inFlight.n === 0) this.inFlight.waiters.splice(0).forEach((w) => w());
      }
    };
    if (delay > 0) setTimeout(deliver, delay);
    else queueMicrotask(deliver);
  }

  onMessage(cb: (msg: WireMessage) => void): () => void {
    this.messageCbs.add(cb);
    return () => this.messageCbs.delete(cb);
  }

  onStateChange(cb: (s: TransportState) => void): () => void {
    this.stateCbs.add(cb);
    cb(this.state);
    return () => this.stateCbs.delete(cb);
  }

  setState(s: TransportState): void {
    if (this.state === s) return;
    this.state = s;
    this.stateCbs.forEach((cb) => cb(s));
  }

  close(): void {
    // Som en datakanal: stängs ena änden stängs båda.
    this.setState('closed');
    this.peer?.setState('closed');
  }
}

export function createLoopbackPair(opts: LoopbackOptions = {}): LoopbackPair {
  const inFlight = { n: 0, waiters: [] as (() => void)[] };
  const host = new LoopbackEnd(opts, inFlight);
  const remote = new LoopbackEnd(opts, inFlight);
  host.peer = remote;
  remote.peer = host;
  return {
    host,
    remote,
    idle: () =>
      inFlight.n === 0 ? Promise.resolve() : new Promise<void>((r) => inFlight.waiters.push(r)),
  };
}
