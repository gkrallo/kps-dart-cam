import type { DetectionMeta, Seg } from '../game/types';

/**
 * Rättningsloggen: varje gång ett avläst kast rättas, tas bort eller läggs
 * till för hand sparas vad detektorn såg och vad det borde ha varit.
 *
 * Varför: varje rättning är ett färdigt etiketterat testfall, och det enda
 * sättet att få egna siffror på träffsäkerheten (fältet publicerar inga
 * oberoende mätningar, se GRANSKNING.md avsnitt 6). Inget lämnar telefonen -
 * loggen ligger i localStorage och hämtas över USB med tools/corrections.mjs.
 *
 * Bara rättningar loggas, inte varje kast: det är avvikelserna som är
 * intressanta, och kasten själva finns redan i matchens kastlista (med
 * detektionsdata i \`d\`).
 */

const KEY = 'kps-dart-cam:corrections:v1';
/** Tak så att loggen aldrig äter upp localStorage. Äldsta rader faller bort. */
export const MAX_ENTRIES = 1000;

export type CorrectionKind =
  /** Avläst kast ändrat till ett annat fält. */
  | 'edit'
  /** Avläst kast borttaget (spökkast). */
  | 'delete'
  /** Kast som aldrig lästes av, inlagt för hand. */
  | 'missed'
  /**
   * Osäkert kast (nära en gräns, `DetectionMeta.alt`) som spelaren öppnade
   * och valde SAMMA värde för: avläsningen var rätt. Behövs för att kunna
   * räkna hur ofta flaggan pratar i onödan - utan dem syns bara felen.
   */
  | 'confirm';

export interface CorrectionEntry {
  /** ms sedan epoch. */
  at: number;
  kind: CorrectionKind;
  /** Vem som rättade: spelaren, eller appen själv (ensam pil omläst). */
  source: 'manual' | 'auto';
  matchId: string;
  mode: string;
  /** Vad detektorn såg, om kastet kom från detektorn. Null för inmatade kast. */
  detected: DetectionMeta | null;
  /** Det registrerade värdet före rättningen (null för 'missed'). */
  from: Seg | null;
  /** Det rättade värdet (null för 'delete'). */
  to: Seg | null;
}

interface StorageLike {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

function store(): StorageLike | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export function loadCorrections(s: StorageLike | null = store()): CorrectionEntry[] {
  if (!s) return [];
  try {
    const raw = s.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CorrectionEntry[]) : [];
  } catch {
    return [];
  }
}

export function appendCorrection(entry: CorrectionEntry, s: StorageLike | null = store()): void {
  if (!s) return;
  try {
    const all = loadCorrections(s);
    all.push(entry);
    const trimmed = all.length > MAX_ENTRIES ? all.slice(all.length - MAX_ENTRIES) : all;
    s.setItem(KEY, JSON.stringify(trimmed));
  } catch {
    // Full eller blockerad lagring - rättningen i matchen gäller ändå.
  }
}

export function clearCorrections(s: StorageLike | null = store()): void {
  if (!s) return;
  try {
    s.removeItem(KEY);
  } catch {
    /* ignorera */
  }
}
