import type { MatchState, Seg } from '../game/types';

/**
 * Pilarna i en spelares senaste tur, för fjärrskärmens spelarlista (Kristian
 * 2026-10-09: "vad kastade han nyss?" ska gå att se utan att öppna Turer).
 *
 * Den som står på tur visar den pågående turen - tom direkt efter ett
 * spelarbyte, med flit: att visa förra turen där läser som att pilarna redan
 * kastats. Övriga visar sin senaste tur ur kastloggen. En tur är en följd av
 * loggrader med samma spelare och samma runda/tur, samma gruppering som
 * TurnHistory.
 */
export function lastTurnDarts(state: MatchState, playerIndex: number): Seg[] {
  if (!state.finished && playerIndex === state.currentIndex) return state.currentDarts.slice();
  const player = state.players[playerIndex];
  if (!player) return [];
  const log = state.log;
  let end = log.length - 1;
  while (end >= 0 && log[end].playerId !== player.id) end--;
  if (end < 0) return [];
  const round = log[end].round;
  let start = end;
  while (start > 0 && log[start - 1].playerId === player.id && log[start - 1].round === round) start--;
  return log.slice(start, end + 1).map((e) => e.dart);
}
