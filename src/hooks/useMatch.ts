import { useCallback, useRef, useState } from 'react';
import {
  createMatch,
  matchState,
  throwDart,
  endTurn,
  undo,
  removeThrow,
  replaceThrow,
  insertThrow,
  serializeMatch,
  restoreMatch,
  type CreateMatchOptions,
} from '../game/match';
import type { Match, MatchState, Seg } from '../game/types';

const KEY = 'kps-dart-cam:match:v1';

/**
 * Sparformatet har en kuvertnivå sedan 2026-09-12: matchen själv är
 * event-sourcad och har ingen tidsstämpel per kast (med flit - kastlistan ska
 * vara kompakt), men uppstartsflödet behöver veta hur GAMMAL den sparade
 * matchen är för att kunna avgöra om den ska återupptas tyst eller med en
 * fråga. Äldre sparningar utan kuvert läses fortfarande.
 */
interface Envelope {
  v: 2;
  /** ISO-tid för senaste ändringen. */
  at: string;
  match: ReturnType<typeof serializeMatch>;
}

function load(): { match: Match | null; lastPlayedAt: number | null } {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
    if (!raw) return { match: null, lastPlayedAt: null };
    const parsed = JSON.parse(raw);
    if (parsed && parsed.v === 2) {
      const env = parsed as Envelope;
      const at = Date.parse(env.at);
      return {
        match: restoreMatch(env.match),
        lastPlayedAt: Number.isFinite(at) ? at : null,
      };
    }
    // Gammalt format: matchen rakt av, ingen tid känd.
    return { match: restoreMatch(parsed), lastPlayedAt: null };
  } catch {
    return { match: null, lastPlayedAt: null };
  }
}

function save(match: Match | null): void {
  try {
    if (typeof localStorage === 'undefined') return;
    if (!match) {
      localStorage.removeItem(KEY);
      return;
    }
    const env: Envelope = { v: 2, at: new Date().toISOString(), match: serializeMatch(match) };
    localStorage.setItem(KEY, JSON.stringify(env));
  } catch {
    /* privat surfning m.m. */
  }
}

/**
 * React-omslag för spelmotorn. Matchen är event-sourcad (bara en kastlista),
 * så alla ändringar - inklusive rättningar flera spelare bakåt - är bara
 * listredigeringar och en omräkning.
 */
export function useMatch() {
  const initial = useRef(load()).current;
  const ref = useRef<Match | null>(initial.match);
  /** Millisekunder sedan epoch för senaste ändringen av den SPARADE matchen. */
  const lastPlayedAtRef = useRef<number | null>(initial.lastPlayedAt);
  const [, force] = useState(0);
  const bump = useCallback(() => {
    save(ref.current);
    lastPlayedAtRef.current = ref.current ? Date.now() : null;
    force((n) => n + 1);
  }, []);

  const start = useCallback(
    (opts: CreateMatchOptions) => {
      ref.current = createMatch(opts);
      bump();
    },
    [bump],
  );

  const quit = useCallback(() => {
    ref.current = null;
    bump();
  }, [bump]);

  const throwSeg = useCallback(
    (seg: Seg): MatchState | null => {
      if (!ref.current) return null;
      const st = throwDart(ref.current, seg);
      bump();
      return st;
    },
    [bump],
  );

  const finishTurn = useCallback((): MatchState | null => {
    if (!ref.current) return null;
    const st = endTurn(ref.current);
    bump();
    return st;
  }, [bump]);

  const undoLast = useCallback(() => {
    if (!ref.current) return;
    undo(ref.current);
    bump();
  }, [bump]);

  const editThrow = useCallback(
    (actionIndex: number, seg: Seg) => {
      if (!ref.current) return;
      replaceThrow(ref.current, actionIndex, seg);
      bump();
    },
    [bump],
  );

  const deleteThrow = useCallback(
    (actionIndex: number) => {
      if (!ref.current) return;
      removeThrow(ref.current, actionIndex);
      bump();
    },
    [bump],
  );

  const insertMissingThrow = useCallback(
    (actionIndex: number, seg: Seg) => {
      if (!ref.current) return;
      insertThrow(ref.current, actionIndex, seg);
      bump();
    },
    [bump],
  );

  const match = ref.current;
  const state: MatchState | null = match ? matchState(match) : null;

  return {
    match,
    state,
    lastPlayedAt: lastPlayedAtRef.current,
    start,
    quit,
    throwSeg,
    finishTurn,
    undoLast,
    editThrow,
    deleteThrow,
    insertMissingThrow,
  };
}
