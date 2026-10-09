/** Sätts av `define` i vite.config.ts vid bygge (och av Vitest, som läser samma config). */
declare const __BUILD_VERSION__: string;

/**
 * Kort git-hash + byggtid, t.ex. "3b85d3e · 2026-10-09 18:56 UTC".
 * `typeof`-vakten finns för att en modul som körs utanför Vite (vite-node-
 * skript i scripts/) inte ska krascha på en odefinierad global.
 */
export const BUILD_VERSION: string =
  typeof __BUILD_VERSION__ !== 'undefined' ? __BUILD_VERSION__ : 'okänd';
