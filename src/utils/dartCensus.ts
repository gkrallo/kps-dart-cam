import type { Point } from '../types';

/**
 * Positionsbaserad avstämning: vilka pilar sitter faktiskt i tavlan?
 *
 * Det som fanns förut var en ren pixelräkning (`dBase < dTop` i
 * `useDartDetector`): skiljer sig bilden mindre mot nivån UNDER toppen än mot
 * toppen själv, så drogs något ut, annars kastades något. Den fungerar när
 * pilarna är olika stora i bild, men när de är ungefär lika stora är den nära
 * ett myntkast - och `absdiff` är symmetriskt, så "en pil tillkom" och "en pil
 * försvann" ser likadana ut för den.
 *
 * Den här modulen svarar på frågan direkt i stället: jämför de pilspetsar
 * appen TROR sitter i tavlan med de pilformade blobbar som faktiskt syns mot
 * den tomma tavlan. Då blir svaret en räkning, inte en gissning:
 *
 *   blobb utan känd spets  -> oregistrerad pil (nytt kast, eller en dold pil
 *                             som blev synlig när pilen framför drogs ut)
 *   känd spets utan blobb  -> pilen är uttagen
 *
 * Ren funktion, inga bilder och ingen OpenCV: bara punkter in och en
 * hopparning ut. Bildanalysen som tar fram `seen` bor kvar i detektorn.
 */

export interface DartCensusInput {
  /** Spetsar appen redan registrerat, i RÅ kamerakoordinater. */
  known: Point[];
  /** Spetsar för alla pilformade blobbar mot den TOMMA tavlan, i samma koordinater. */
  seen: Point[];
  /**
   * Hur nära en blobb måste ligga en känd spets för att vara samma pil.
   * Måste vara större än detekteringens egen spridning mellan bildrutor men
   * mindre än avståndet mellan två pilar man vill kunna skilja åt.
   */
  maxMatchPx?: number;
}

export interface DartCensusResult {
  /** Par som hör ihop: index i `known` respektive `seen`. */
  matched: { knownIndex: number; seenIndex: number; distancePx: number }[];
  /** Index i `seen` utan motsvarande känd pil - oregistrerade pilar. */
  unregistered: number[];
  /** Index i `known` som inte syns längre - uttagna pilar. */
  removed: number[];
}

/**
 * Standardavstånd för att para ihop en blobb med en känd pil.
 *
 * Satt till 40 px (~17 mm vid 2,4 px/mm), alltså något mer än
 * `MIN_DART_SPACING_PX` (30). Skälet: samma pil kan mätas några pixlar isär
 * mellan två analyser (den svänger in sig, ljuset ändras, masken växer eller
 * krymper), och en hopparning som missas blir BÅDE en falsk uttagning och ett
 * falskt nytt kast - det dyraste felet den här funktionen kan göra.
 */
export const DEFAULT_MATCH_PX = 40;

export function reconcileDarts({
  known,
  seen,
  maxMatchPx = DEFAULT_MATCH_PX,
}: DartCensusInput): DartCensusResult {
  // Girig hopparning i avståndsordning. Med som mest en handfull pilar är det
  // samma svar som en optimal tilldelning skulle ge, och det är lätt att läsa:
  // närmaste par först, sedan är båda upptagna.
  const pairs: { knownIndex: number; seenIndex: number; distancePx: number }[] = [];
  for (let k = 0; k < known.length; k++) {
    for (let s = 0; s < seen.length; s++) {
      const d = Math.hypot(known[k].x - seen[s].x, known[k].y - seen[s].y);
      if (d <= maxMatchPx) pairs.push({ knownIndex: k, seenIndex: s, distancePx: d });
    }
  }
  pairs.sort((a, b) => a.distancePx - b.distancePx);

  const knownTaken = new Set<number>();
  const seenTaken = new Set<number>();
  const matched: DartCensusResult['matched'] = [];
  for (const p of pairs) {
    if (knownTaken.has(p.knownIndex) || seenTaken.has(p.seenIndex)) continue;
    knownTaken.add(p.knownIndex);
    seenTaken.add(p.seenIndex);
    matched.push(p);
  }

  const unregistered: number[] = [];
  for (let s = 0; s < seen.length; s++) if (!seenTaken.has(s)) unregistered.push(s);
  const removed: number[] = [];
  for (let k = 0; k < known.length; k++) if (!knownTaken.has(k)) removed.push(k);

  return { matched, unregistered, removed };
}

/** Vad avstämningen säger att som hänt sedan förra stabila bilden. */
export type CensusVerdict =
  | { kind: 'oförändrat' }
  | { kind: 'nytt kast'; seenIndex: number }
  | { kind: 'uttagning'; knownIndexes: number[] }
  | { kind: 'uttagning med dold pil'; knownIndexes: number[]; seenIndex: number }
  | { kind: 'osäker'; why: string };

/**
 * Blev det mer eller mindre material i tavlan sedan förra analysen?
 *
 * Räknas på antalet skilda pixlar mot den TOMMA tavlan, inte mot förra
 * bildrutan: den tomma tavlan är en fast referens, så en pil som tillkommer
 * höjer talet och en som dras ut sänker det. `unknown` när ändringen är för
 * liten för att betyda något.
 */
export type MaterialDelta = 'more' | 'less' | 'unknown';

/**
 * Tolkar avstämningen. Skild från `reconcileDarts` så att hopparningen går att
 * testa för sig och tolkningen för sig.
 *
 * `sawAnything` säger om bildanalysen över huvud taget kunde köras; kunde den
 * inte det ska svaret bli "osäker" i stället för att en tom `seen` läses som
 * att alla pilar plockats bort.
 *
 * `materialDelta` är en oberoende riktningskontroll och finns för ETT konkret
 * fel: tappas en redan registrerad pil ur masken (den blir otydlig, ljuset
 * ändras) samtidigt som en ny pil kastas, ser hopparningen "en känd borta, en
 * ny sedd" - alltså exakt samma mönster som en uttagning som blottar en dold
 * pil. Skillnaden är att det blev MER material i tavlan, inte mindre. Utan
 * den kontrollen skulle ett vanligt kast kunna radera föregående pil.
 */
export function interpretCensus(
  result: DartCensusResult,
  opts: { knownCount: number; sawAnything: boolean; materialDelta?: MaterialDelta },
): CensusVerdict {
  const { unregistered, removed } = result;
  const delta = opts.materialDelta ?? 'unknown';

  if (!opts.sawAnything && opts.knownCount > 0) {
    return { kind: 'osäker', why: 'ingen blobbanalys att stämma av mot' };
  }
  if (unregistered.length === 0 && removed.length === 0) return { kind: 'oförändrat' };

  if (unregistered.length > 0 && removed.length === 0) {
    if (delta === 'less') {
      return { kind: 'osäker', why: 'ny blobb men mindre material i tavlan' };
    }
    // Flera oregistrerade samtidigt betyder att analysen tappat bort sig -
    // pilar kastas en i taget. Hellre avstå än registrera två kast på en gång.
    if (unregistered.length > 1) {
      return { kind: 'osäker', why: `${unregistered.length} oregistrerade blobbar på en gång` };
    }
    return { kind: 'nytt kast', seenIndex: unregistered[0] };
  }

  if (removed.length > 0 && unregistered.length === 0) {
    if (delta === 'more') {
      return { kind: 'osäker', why: 'pil saknas i masken men mer material i tavlan' };
    }
    return { kind: 'uttagning', knownIndexes: removed };
  }

  // Både något borta och något nytt. Två helt olika händelser ser likadana ut
  // här, och riktningen skiljer dem åt:
  if (delta === 'more') {
    // Mer material: ett vanligt kast, där en redan registrerad pil samtidigt
    // föll ur masken. Registrera kastet, rör inte den kända pilen.
    if (unregistered.length === 1) return { kind: 'nytt kast', seenIndex: unregistered[0] };
    return { kind: 'osäker', why: 'mer material men flera nya blobbar' };
  }

  // Mindre (eller okänt) material: pilen framför drogs ut och blottade en pil
  // som satt dold bakom den. Det är hela poängen med att dra ur pilarna i
  // omvänd ordning - se `correction-and-readout-wishlist`.
  if (unregistered.length === 1) {
    return { kind: 'uttagning med dold pil', knownIndexes: removed, seenIndex: unregistered[0] };
  }
  return {
    kind: 'osäker',
    why: `${removed.length} borta och ${unregistered.length} nya samtidigt`,
  };
}
