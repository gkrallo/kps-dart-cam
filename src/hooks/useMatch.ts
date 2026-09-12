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

function load(): Match | null {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
    return raw ? restoreMatch(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function save(match: Match | null): void {
  try {
    if (typeof localStorage === 'undefined') return;
    if (match) localStorage.setItem(KEY, JSON.stringify(serializeMatch(match)));
    else localStorage.removeItem(KEY);
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
  const ref = useRef<Match | null>(load());
  const [, force] = useState(0);
  const bump = useCallback(() => {
    save(ref.current);
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

  return { match, state, start, quit, throwSeg, finishTurn, undoLast, editThrow, deleteThrow, insertMissingThrow };
}
