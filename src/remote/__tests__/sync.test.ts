import { describe, it, expect } from 'vitest';
import {
  createMatch,
  endTurn,
  insertThrow,
  matchState,
  replaceThrow,
  serializeMatch,
  throwDart,
} from '../../game/match';
import type { GameMode, Match } from '../../game/types';
import {
  RemoteHost,
  REASON_NO_SUCH_DART,
  REASON_NOT_ACCEPTED,
  REASON_STALE,
  REASON_WRONG_MATCH,
  type AppliedOp,
} from '../host';
import {
  RemoteReplica,
  REMOTE_STORAGE_KEY,
  REASON_NOT_CONNECTED,
  type MiniStorage,
} from '../replica';
import { createLoopbackPair, type LoopbackOptions, type LoopbackPair } from '../transport';
import { PROTOCOL_VERSION, type SnapshotMessage } from '../protocol';

/* --- hjälpare ------------------------------------------------------------ */

function memStorage(): MiniStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

/** Seedad slump (mulberry32), så att ett fel med omkastad ordning går att återskapa. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const mk = (mode: GameMode = '501', id = 'm-test'): Match => {
  const m = createMatch({ mode, players: [{ name: 'Anna' }, { name: 'Bo' }] });
  // createMatch tar id ur Date.now(); två matcher samma millisekund får samma id.
  m.id = id;
  return m;
};

/** Väntar tills alla par är tysta - även svar som skickas medan vi väntar. */
async function settle(...pairs: LoopbackPair[]): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await Promise.all(pairs.map((p) => p.idle()));
    await new Promise((r) => setTimeout(r, 0));
  }
}

interface Rig {
  match: Match;
  host: RemoteHost;
  applied: AppliedOp[];
}

function rig(match: Match = mk()): Rig {
  const applied: AppliedOp[] = [];
  const host = new RemoteHost(match, { initialVersion: 100, onApplied: (a) => applied.push(a) });
  return { match, host, applied };
}

function connect(r: Rig, opts: LoopbackOptions = {}, replica?: RemoteReplica) {
  const pair = createLoopbackPair(opts);
  r.host.attach(pair.host);
  const rep = replica ?? new RemoteReplica({ storage: memStorage(), proposeTimeoutMs: 2000 });
  rep.attach(pair.remote);
  return { pair, rep };
}

/** En ändring på hosts egen skärm/detektor, följd av det appen gör efteråt. */
function local(r: Rig, fn: (m: Match) => void): void {
  fn(r.match);
  r.host.notifyChanged(r.match);
}

const failure = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: Error) => e.message,
  );

/* --- tester -------------------------------------------------------------- */

describe('synk: host och fjärrskärm', () => {
  it('hello ger aktuell bild direkt', async () => {
    const r = rig();
    local(r, (m) => throwDart(m, { v: 20, m: 3 }));
    const { pair, rep } = connect(r);
    await settle(pair);
    expect(rep.connected).toBe(true);
    expect(rep.version).toBe(r.host.version);
    expect(rep.matchId).toBe('m-test');
    expect(rep.state).toEqual(matchState(r.match));
    expect(r.host.connectedClients).toEqual([rep.clientId]);
  });

  it('konvergerar efter kast och rättningar från båda sidor', async () => {
    const r = rig();
    const { pair, rep } = connect(r);
    await settle(pair);

    local(r, (m) => throwDart(m, { v: 20, m: 1 }));
    local(r, (m) => throwDart(m, { v: 19, m: 1 }));
    await settle(pair);
    // Fjärrskärmen rättar pil 2 och lägger till en missad tredje.
    await rep.propose({ kind: 'replace', actionIndex: 1, seg: { v: 19, m: 3 } });
    await rep.propose({ kind: 'throw', seg: { v: 5, m: 1 } });
    await rep.propose({ kind: 'endTurn' });
    // Host: Bo kastar, en dold pil hittas och sätts in, och Anna rättas på hosts skärm.
    local(r, (m) => throwDart(m, { v: 25, m: 2 }));
    local(r, (m) => insertThrow(m, 4, { v: 1, m: 1 }));
    local(r, (m) => replaceThrow(m, 0, { v: 20, m: 3 }));
    await settle(pair);
    // Fjärrskärmen tar bort den insatta och ångrar sedan senaste.
    await rep.propose({ kind: 'remove', actionIndex: 4 });
    await rep.propose({ kind: 'undo' });
    await settle(pair);

    expect(rep.version).toBe(r.host.version);
    expect(rep.state).toEqual(matchState(r.match));
    expect(matchState(r.match).players[0].score).toBe(501 - 60 - 57 - 5);
    expect(r.applied.map((a) => a.op.kind)).toEqual(['replace', 'throw', 'endTurn', 'remove', 'undo']);
  });

  it('onApplied får förslagsställaren och kastlistan före ändringen', async () => {
    const r = rig();
    const { pair, rep } = connect(r);
    local(r, (m) =>
      throwDart(m, { v: 1, m: 1 }, { label: 'S1', rMM: 120, deg: 18, how: 'axel', alt: ['S20'] }),
    );
    await settle(pair);
    await rep.propose({ kind: 'replace', actionIndex: 0, seg: { v: 20, m: 1 } });
    expect(r.applied).toHaveLength(1);
    const a = r.applied[0];
    expect(a.clientId).toBe(rep.clientId);
    // Detektionsdatan finns bara kvar i `before` - det är den rättningsloggen behöver.
    expect(a.before[0]).toMatchObject({ t: 'T', v: 1, m: 1, d: { label: 'S1' } });
    expect(a.after.log[0].dart).toEqual({ v: 20, m: 1 });
    expect(a.version).toBe(r.host.version);
  });

  it('en fjärrskärm som återansluter med gammal version får det aktuella läget', async () => {
    const r = rig();
    const storage = memStorage();
    const first = connect(r, {}, new RemoteReplica({ storage }));
    await settle(first.pair);
    const oldVersion = first.rep.version;
    first.pair.remote.close();
    expect(r.host.connectedClients).toEqual([]);

    // Spelet går vidare utan fjärrskärm.
    local(r, (m) => throwDart(m, { v: 20, m: 1 }));
    local(r, (m) => throwDart(m, { v: 20, m: 1 }));
    local(r, (m) => endTurn(m));

    // Omladdad fjärrskärm: samma lagring, ny instans, visar senast kända läge direkt.
    const reloaded = new RemoteReplica({ storage });
    expect(reloaded.version).toBe(oldVersion);
    expect(reloaded.clientId).toBe(first.rep.clientId);
    expect(reloaded.state?.log).toHaveLength(0);
    expect(reloaded.connected).toBe(false);
    expect(await failure(reloaded.propose({ kind: 'undo' }))).toBe(REASON_NOT_CONNECTED);

    const second = connect(r, {}, reloaded);
    await settle(second.pair);
    expect(reloaded.version).toBe(r.host.version);
    expect(reloaded.state).toEqual(matchState(r.match));
  });

  it('dubblerade och gamla bilder ignoreras', async () => {
    const pair = createLoopbackPair();
    const rep = new RemoteReplica({ storage: memStorage() });
    rep.attach(pair.remote);
    const m = mk();
    const snap = (version: number): SnapshotMessage => ({
      v: PROTOCOL_VERSION,
      type: 'snapshot',
      matchId: m.id,
      version,
      match: serializeMatch(m),
      acked: [],
    });

    pair.host.send(snap(10));
    throwDart(m, { v: 20, m: 1 });
    pair.host.send(snap(12));
    await settle(pair);
    expect(rep.version).toBe(12);
    expect(rep.state?.log).toHaveLength(1);

    let changes = 0;
    rep.subscribe(() => changes++);
    throwDart(m, { v: 20, m: 1 }); // syns bara om en gammal bild felaktigt tas
    pair.host.send(snap(11));
    pair.host.send(snap(12));
    await settle(pair);
    expect(rep.version).toBe(12);
    expect(rep.state?.log).toHaveLength(1);
    expect(changes).toBe(0);
  });

  it('rättning av en pil som inte finns ger reject och lämnar matchen orörd', async () => {
    const r = rig();
    const { pair, rep } = connect(r);
    local(r, (m) => throwDart(m, { v: 20, m: 1 }));
    local(r, (m) => endTurn(m));
    await settle(pair);
    const before = JSON.stringify(r.match.actions);
    const version = r.host.version;

    expect(await failure(rep.propose({ kind: 'replace', actionIndex: 7, seg: { v: 1, m: 1 } }))).toBe(
      REASON_NO_SUCH_DART,
    );
    // Index 1 är turbytet - det får inte bli ett kast.
    expect(await failure(rep.propose({ kind: 'replace', actionIndex: 1, seg: { v: 1, m: 1 } }))).toBe(
      REASON_NO_SUCH_DART,
    );
    expect(await failure(rep.propose({ kind: 'remove', actionIndex: -1 }))).toBe(REASON_NO_SUCH_DART);
    expect(await failure(rep.propose({ kind: 'insert', actionIndex: 99, seg: { v: 1, m: 1 } }))).toBe(
      REASON_NO_SUCH_DART,
    );

    expect(JSON.stringify(r.match.actions)).toBe(before);
    expect(r.host.version).toBe(version);
    expect(r.applied).toHaveLength(0);
  });

  it('det motorn inte tar emot avvisas: fjärde pilen, turbyte i Farfar', async () => {
    const r = rig();
    const { pair, rep } = connect(r);
    await settle(pair);
    for (let i = 0; i < 3; i++) await rep.propose({ kind: 'throw', seg: { v: 1, m: 1 } });
    expect(await failure(rep.propose({ kind: 'throw', seg: { v: 1, m: 1 } }))).toBe(REASON_NOT_ACCEPTED);
    expect(r.match.actions).toHaveLength(3);

    const f = rig(mk('FARFAR', 'm-farfar'));
    const c = connect(f);
    await settle(c.pair);
    expect(await failure(c.rep.propose({ kind: 'endTurn' }))).toBe(REASON_NOT_ACCEPTED);
    expect(await failure(c.rep.propose({ kind: 'undo' }))).toBe(REASON_NOT_ACCEPTED);
    expect(f.match.actions).toHaveLength(0);
  });

  it('ett index-förslag på en gammal version avvisas, ett nytt kast gör det inte', async () => {
    const r = rig();
    const { pair, rep } = connect(r, { delayMs: 15 });
    local(r, (m) => throwDart(m, { v: 20, m: 1 }));
    await settle(pair);

    // En pil landar på host medan någon rättar på fjärrskärmen.
    local(r, (m) => throwDart(m, { v: 3, m: 1 }));
    const stale = [
      rep.propose({ kind: 'replace', actionIndex: 0, seg: { v: 1, m: 1 } }),
      rep.propose({ kind: 'insert', actionIndex: 0, seg: { v: 1, m: 1 } }),
      rep.propose({ kind: 'remove', actionIndex: 0 }),
      rep.propose({ kind: 'undo' }),
    ].map(failure);
    const throwOk = failure(rep.propose({ kind: 'throw', seg: { v: 7, m: 1 } }));
    expect(await Promise.all(stale)).toEqual([REASON_STALE, REASON_STALE, REASON_STALE, REASON_STALE]);
    expect(await throwOk).toBeNull();
    await settle(pair);
    expect(matchState(r.match).log.map((l) => l.dart.v)).toEqual([20, 3, 7]);
    expect(rep.state).toEqual(matchState(r.match));
  });

  it('nytt matchId: fjärrskärmen kastar sin kopia och tar den nya', async () => {
    const r = rig();
    const storage = memStorage();
    const { pair, rep } = connect(r, {}, new RemoteReplica({ storage }));
    local(r, (m) => throwDart(m, { v: 20, m: 1 }));
    await settle(pair);
    const oldId = rep.matchId;

    const next = mk('301', 'm-ny');
    r.match = next;
    r.host.notifyChanged(next);
    await settle(pair);
    expect(oldId).toBe('m-test');
    expect(rep.matchId).toBe('m-ny');
    expect(rep.state?.config.mode).toBe('301');
    expect(rep.state?.log).toHaveLength(0);
    expect(JSON.parse(storage.data.get(REMOTE_STORAGE_KEY)!).snapshot.matchId).toBe('m-ny');

    // Avslutad match: ingen match alls.
    r.host.notifyChanged(null);
    await settle(pair);
    expect(rep.matchId).toBe('');
    expect(rep.state).toBeNull();
  });

  it('förslag om en gammal match avvisas och fjärrskärmen synkas om', async () => {
    const r = rig();
    const pair = createLoopbackPair();
    r.host.attach(pair.host);
    const rep = new RemoteReplica({ storage: memStorage() });
    rep.attach(pair.remote);
    await settle(pair);

    const replies: string[] = [];
    pair.remote.onMessage((msg) => replies.push(msg.type === 'reject' ? msg.reason : msg.type));
    pair.remote.send({
      v: PROTOCOL_VERSION,
      type: 'propose',
      matchId: 'm-gammal',
      proposalId: 'x',
      baseVersion: r.host.version,
      op: { kind: 'throw', seg: { v: 20, m: 1 } },
    });
    await settle(pair);
    expect(replies).toEqual([REASON_WRONG_MATCH, 'snapshot']);
    expect(r.match.actions).toHaveLength(0);
  });

  it('host som laddats om med lägre versioner tas ändå emot vid ny anslutning', async () => {
    const r = rig();
    const storage = memStorage();
    const first = connect(r, {}, new RemoteReplica({ storage }));
    local(r, (m) => throwDart(m, { v: 20, m: 1 }));
    await settle(first.pair);
    first.pair.host.close();

    // Ny host-session, samma sparade match, klocka som gått bakåt.
    local(r, (m) => throwDart(m, { v: 20, m: 1 }));
    const reborn = new RemoteHost(r.match, { initialVersion: 5 });
    const pair = createLoopbackPair();
    reborn.attach(pair.host);
    first.rep.attach(pair.remote);
    await settle(pair);
    expect(first.rep.version).toBe(5);
    expect(first.rep.state).toEqual(matchState(r.match));
  });

  it('notifyChanged utan ändring ger ingen ny version', async () => {
    const r = rig();
    const v = r.host.version;
    r.host.notifyChanged(r.match);
    r.host.notifyChanged(r.match);
    expect(r.host.version).toBe(v);
    local(r, (m) => throwDart(m, { v: 1, m: 1 }));
    expect(r.host.version).toBe(v + 1);
  });

  it('konvergerar med fördröjning och omkastad ordning, två fjärrskärmar', async () => {
    for (const seed of [1, 2, 3, 42]) {
      const rand = rng(seed);
      const r = rig();
      const opts: LoopbackOptions = { delayMs: () => Math.floor(rand() * 30) };
      const a = connect(r, opts);
      const b = connect(r, opts);
      await settle(a.pair, b.pair);

      const outcomes: Promise<string | null>[] = [];
      for (let i = 0; i < 24; i++) {
        const x = rand();
        if (x < 0.4) local(r, (m) => throwDart(m, { v: 1 + Math.floor(rand() * 20), m: 1 }));
        else if (x < 0.5) local(r, (m) => endTurn(m));
        else {
          const rep = rand() < 0.5 ? a.rep : b.rep;
          const n = rep.match?.actions.length ?? 0;
          const op =
            x < 0.65
              ? ({ kind: 'throw', seg: { v: 20, m: 3 } } as const)
              : x < 0.8 && n > 0
                ? ({ kind: 'replace', actionIndex: Math.floor(rand() * n), seg: { v: 5, m: 1 } } as const)
                : x < 0.9
                  ? ({ kind: 'endTurn' } as const)
                  : ({ kind: 'undo' } as const);
          outcomes.push(failure(rep.propose(op)));
        }
        if (rand() < 0.3) await new Promise((res) => setTimeout(res, Math.floor(rand() * 20)));
      }
      const results = await Promise.all(outcomes);
      await settle(a.pair, b.pair);
      // Testet ska pröva båda vägarna, inte bara avvisningar.
      expect(r.applied.length, `seed ${seed}`).toBeGreaterThan(0);
      expect(results.some((x) => x !== null), `seed ${seed}`).toBe(true);

      const truth = matchState(r.match);
      expect(a.rep.version, `seed ${seed}`).toBe(r.host.version);
      expect(b.rep.version, `seed ${seed}`).toBe(r.host.version);
      expect(a.rep.state, `seed ${seed}`).toEqual(truth);
      expect(b.rep.state, `seed ${seed}`).toEqual(truth);
    }
  });

  it('tappade bilder repareras av nästa bild eller av resync', async () => {
    const r = rig();
    let dropSnapshots = true;
    const { pair, rep } = connect(r, { drop: (m) => dropSnapshots && m.type === 'snapshot' && m.version > 100 });
    await settle(pair);
    local(r, (m) => throwDart(m, { v: 20, m: 1 }));
    local(r, (m) => throwDart(m, { v: 20, m: 1 }));
    await settle(pair);
    expect(rep.version).toBe(100);

    dropSnapshots = false;
    rep.resync();
    await settle(pair);
    expect(rep.version).toBe(r.host.version);
    expect(rep.state).toEqual(matchState(r.match));
  });

  it('ett förslag bekräftas även om just dess bild tappades', async () => {
    const r = rig();
    let dropNext = false;
    const { pair, rep } = connect(r, {
      drop: (m) => {
        if (dropNext && m.type === 'snapshot') {
          dropNext = false;
          return true;
        }
        return false;
      },
    });
    await settle(pair);
    dropNext = true;
    const p = failure(rep.propose({ kind: 'throw', seg: { v: 20, m: 1 } }));
    await settle(pair);
    local(r, (m) => throwDart(m, { v: 1, m: 1 }));
    expect(await p).toBeNull();
    await settle(pair);
    expect(rep.state).toEqual(matchState(r.match));
  });

  it('host påverkas inte när en fjärrskärm försvinner', async () => {
    const r = rig();
    const { pair, rep } = connect(r);
    await settle(pair);
    const pending = failure(rep.propose({ kind: 'throw', seg: { v: 20, m: 1 } }));
    pair.remote.close();
    expect(await pending).toBe('Frånkopplad');
    expect(rep.connected).toBe(false);
    expect(r.host.connectedClients).toEqual([]);
    expect(() => local(r, (m) => throwDart(m, { v: 20, m: 1 }))).not.toThrow();
    expect(matchState(r.match).log).toHaveLength(1);
  });

  it('host svarar på ping', async () => {
    const r = rig();
    const pair = createLoopbackPair();
    r.host.attach(pair.host);
    const got: number[] = [];
    pair.remote.onMessage((m) => m.type === 'pong' && got.push(m.t));
    pair.remote.send({ v: PROTOCOL_VERSION, type: 'ping', matchId: '', t: 42 });
    await settle(pair);
    expect(got).toEqual([42]);
  });
  it('livstecken: ping ger pong, och en tyst kanal syns som ej färsk', async () => {
    const r = rig();
    let now = 1_000_000;
    let mute = false;
    const pair = createLoopbackPair({ drop: () => mute });
    r.host.attach(pair.host);
    const rep = new RemoteReplica({ storage: memStorage(), now: () => now });
    rep.attach(pair.remote);
    await settle(pair);
    expect(rep.isFresh(15000)).toBe(true);

    now += 20000;
    expect(rep.isFresh(15000)).toBe(false);
    rep.ping();
    await settle(pair);
    expect(rep.isFresh(15000)).toBe(true);

    // Wifiglapp: kanalen står öppen men inget kommer fram.
    mute = true;
    now += 20000;
    rep.ping();
    await settle(pair);
    expect(rep.connected).toBe(true);
    expect(rep.isFresh(15000)).toBe(false);
  });

  it('en rättningsvy som stått öppen medan en pil landade avvisas', async () => {
    const r = rig();
    const { pair, rep } = connect(r);
    local(r, (m) => throwDart(m, { v: 1, m: 1 }));
    await settle(pair);
    const seenWhenOpened = rep.version;
    // Pilen landar och fjärrskärmen hinner få den nya bilden innan knappen trycks.
    local(r, (m) => throwDart(m, { v: 2, m: 1 }));
    await settle(pair);
    expect(rep.version).toBeGreaterThan(seenWhenOpened);
    expect(
      await failure(rep.propose({ kind: 'replace', actionIndex: 0, seg: { v: 20, m: 1 } }, seenWhenOpened)),
    ).toBe(REASON_STALE);
    expect(matchState(r.match).log.map((l) => l.dart.v)).toEqual([1, 2]);
  });

  it('värden säger till när fjärrskärmar hälsar och försvinner', async () => {
    const seen: number[] = [];
    const host = new RemoteHost(mk(), { onPeersChanged: (c) => seen.push(c.length) });
    const a = createLoopbackPair();
    const b = createLoopbackPair();
    host.attach(a.host);
    host.attach(b.host);
    new RemoteReplica({ storage: memStorage() }).attach(a.remote);
    new RemoteReplica({ storage: memStorage() }).attach(b.remote);
    await settle(a, b);
    expect(host.connectedClients).toHaveLength(2);
    a.remote.close();
    expect(seen).toEqual([1, 2, 1]);
  });
  it('ny match från fjärrskärmen går via onCommand, även när ingen match finns', async () => {
    let match: Match | null = null;
    const commands: string[] = [];
    const host = new RemoteHost(null, {
      initialVersion: 1,
      onCommand: (cmd, clientId) => {
        commands.push(cmd.kind + ':' + clientId.length);
        if (cmd.kind !== 'startMatch') return 'nej';
        match = createMatch({ mode: cmd.config.mode, players: cmd.config.players });
        match.id = 'm-fjarr';
        // Som App: den nya matchen meddelas via notifyChanged.
        queueMicrotask(() => host.notifyChanged(match));
        return null;
      },
    });
    const pair = createLoopbackPair();
    host.attach(pair.host);
    const rep = new RemoteReplica({ storage: memStorage() });
    rep.attach(pair.remote);
    await settle(pair);
    expect(rep.state).toBeNull();

    await rep.propose({ kind: 'startMatch', config: { mode: '301', doubleOut: false, farfarCap: false, players: [{ name: 'Anna' }, { name: 'Bo' }] } });
    await settle(pair);
    expect(commands).toEqual(['startMatch:' + rep.clientId.length]);
    expect(rep.matchId).toBe('m-fjarr');
    expect(rep.state?.players.map((p) => p.name)).toEqual(['Anna', 'Bo']);
    expect(rep.state?.view.remaining).toBe(301);
  });

  it('ett kommando som appen vägrar avvisas med appens skäl', async () => {
    const host = new RemoteHost(mk(), { onCommand: () => 'Kalibrera först' });
    const pair = createLoopbackPair();
    host.attach(pair.host);
    const rep = new RemoteReplica({ storage: memStorage() });
    rep.attach(pair.remote);
    await settle(pair);
    expect(
      await failure(rep.propose({ kind: 'startMatch', config: { mode: '501', doubleOut: false, farfarCap: false, players: [{ name: 'A' }] } })),
    ).toBe('Kalibrera först');
    const noHandler = rig();
    const c = connect(noHandler);
    await settle(c.pair);
    expect(
      await failure(c.rep.propose({ kind: 'startMatch', config: { mode: '501', doubleOut: false, farfarCap: false, players: [{ name: 'A' }] } })),
    ).toBe(REASON_NOT_ACCEPTED);
  });
  it('kalibreringsläget och förhandsbilden når fjärrskärmen, även en som ansluter sent', async () => {
    const host = new RemoteHost(mk(), {
      onCommand: (cmd) => (cmd.kind === 'calibrate' && cmd.action === 'save' ? 'Tryck Auto först' : null),
    });
    const calState = { calibrating: true, calStep: 'sikte' as const, calStatus: null, calBusy: false, confirmEmpty: false, canCancel: true };
    host.setHostState(calState);
    host.sendPreview('AAAA', false, 123);

    const pair = createLoopbackPair();
    host.attach(pair.host);
    const rep = new RemoteReplica({ storage: memStorage() });
    rep.attach(pair.remote);
    await settle(pair);
    expect(rep.hostState).toEqual(calState);
    expect(rep.preview).toEqual({ jpegBase64: 'AAAA', at: 123, wireframe: false });

    await rep.propose({ kind: 'calibrate', action: 'auto' });
    expect(await failure(rep.propose({ kind: 'calibrate', action: 'save' }))).toBe('Tryck Auto först');

    host.setHostState({ ...calState, calStep: 'punkter', calStatus: 'Tavlan hittad.' });
    host.sendPreview('BBBB', true, 456);
    await settle(pair);
    expect(rep.hostState?.calStatus).toBe('Tavlan hittad.');
    expect(rep.preview?.wireframe).toBe(true);

    // Sparad: kalibreringen stängs, den gamla bilden hör inte till nästa gång.
    host.setHostState({ ...calState, calibrating: false, calStep: null, confirmEmpty: true });
    await settle(pair);
    expect(rep.hostState?.confirmEmpty).toBe(true);
    expect(rep.preview).toBeNull();
  });

  it('oförändrat kameraläge skickas inte om', async () => {
    const host = new RemoteHost(mk());
    const pair = createLoopbackPair();
    host.attach(pair.host);
    new RemoteReplica({ storage: memStorage() }).attach(pair.remote);
    await settle(pair);
    let n = 0;
    pair.remote.onMessage((m) => m.type === 'hostState' && n++);
    const st = { calibrating: false, calStep: null, calStatus: null, calBusy: false, confirmEmpty: false, canCancel: false };
    host.setHostState(st);
    host.setHostState({ ...st });
    await settle(pair);
    expect(n).toBe(1);
  });
});
