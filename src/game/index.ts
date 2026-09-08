import type { DartScore } from '../types';
import type { Seg } from './types';

export * from './types';
export * as seg from './segments';
export {
  createMatch,
  matchState,
  throwDart,
  endTurn,
  undo,
  canUndo,
  removeThrow,
  replaceThrow,
  engineFor,
  serializeMatch,
  restoreMatch,
} from './match';
export { targetFor as farfarTargetFor } from './farfar';

export const GAME_MODES = ['301', '501', 'FARFAR'] as const;
export const GAME_MODE_LABEL: Record<(typeof GAME_MODES)[number], string> = {
  '301': '301',
  '501': '501',
  FARFAR: 'Farfar',
};

/** Bryggan från datorseendets `DartScore` till spelmotorns `Seg`. */
export function segFromDartScore(s: DartScore): Seg {
  if (s.label === 'MISS' || s.multiplier === 0) return { v: 0, m: 1 };
  return { v: s.baseScore, m: s.multiplier };
}
