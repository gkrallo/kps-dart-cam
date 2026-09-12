import type { Point } from '../types';
import { BOARD_MM } from './dartMath';
import type { BoardCalibration } from './boardProjection';

/**
 * Rotationen: vilken sektor är 20?
 *
 * Ringarna är rotationssymmetriska, så ellipsanpassningen kan inte se
 * rotationen - `calibrationFromRingEllipses` följer dubbelringen perfekt medan
 * hela sektorhjulet kan vara vridet. `orientToImageUp` antar bara att 20 sitter
 * rakt upp. Uppmätt på Kristians tavla 2026-09-12: den sitter några grader
 * snett, och då hamnar alla fyra kalibreringspunkterna bredvid sina fält -
 * wireframets FORM ser perfekt ut medan varje sektor läses fel.
 *
 * Men tavlan bär svaret själv. Dubbel- och trippelringen växlar röd/grön varje
 * sektor, och sektor 20 (index 0) är en "mörk" sektor med RÖD ring - samma
 * konvention som `boardColorAt` i syntheticBoard.ts. Läser vi av färgen längs
 * ringarna genom den kalibrering vi har får vi en fyrkantsvåg vars fas talar om
 * hur mycket hjulet är vridet.
 *
 * Färgen ensam räcker inte hela vägen: mönstret upprepar sig var 36:e grad (två
 * sektorer), så det finns tio lika bra svar. Det sista steget är antagandet att
 * 20 sitter NÄRA toppen - vilket är sant för en tavla som är upphängd på
 * normalt sätt och en kamera som står rakt framför. Vi väljer alltså den
 * kandidat som ligger inom ±18° från nuvarande gauge. Det som fanns förut var
 * samma antagande men utan färgsteget, alltså utan någon korrigering alls.
 */

export type RGB = [number, number, number];

/** Läser bildens färg i en punkt. Returnera null utanför bilden. */
export type ColourSampler = (x: number, y: number) => RGB | null;

export type BoardColourClass = 'red' | 'green' | 'other';

/**
 * Klassar en pixel som röd, grön eller varken-eller.
 *
 * Samma trösklar som ring-färgmasken i `boardDetector` (H 0-180 som i OpenCV),
 * avsiktligt tillåtande: Kristians tavla är sliten och står i skugga, och ett
 * prov som hamnar på en tråd eller i en nött fläck ska bara bli "other" och
 * falla bort ur rösträkningen, inte dra iväg svaret.
 */
export function classifyBoardColour(rgb: RGB): BoardColourClass {
  const [r, g, b] = rgb;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const v = max;
  const s = max === 0 ? 0 : ((max - min) / max) * 255;
  if (v < 55 || s < 55) return 'other';

  let h: number;
  const d = max - min;
  if (d === 0) h = 0;
  else if (max === r) h = 60 * (((g - b) / d + 6) % 6);
  else if (max === g) h = 60 * ((b - r) / d + 2);
  else h = 60 * ((r - g) / d + 4);
  h /= 2; // 0-180, OpenCV-skala

  if (h <= 13 || h >= 167) return s >= 70 ? 'red' : 'other';
  if (h >= 36 && h <= 92) return 'green';
  return 'other';
}

export interface SectorRotationResult {
  /**
   * Rotationen att lägga på kalibreringen, radianer, alltid inom ±18°.
   * Positiv = hjulet vrids medurs i tavlans plan.
   */
  offsetRad: number;
  /**
   * -1 till 1. Andelen röst-vikt som stämmer med mönstret efter rotationen.
   * Under ~0.3 betyder det att färgerna inte gick att läsa (mörker, kraftig
   * slitning, fel ring) - då ska svaret inte användas.
   */
  confidence: number;
  /** Antal prover som klassades som röd eller grön. */
  votes: number;
}

export interface SectorRotationOptions {
  /** Antal vinkelsteg runt varvet. */
  angleSteps?: number;
  /** Radier i mm att prova. Standard: tre i dubbelringen, tre i trippeln. */
  radiiMM?: number[];
  /** Upplösning på fassökningen, i grader. */
  searchStepDeg?: number;
}

const DEFAULT_RADII = [
  // Mitt i ringarna, med marginal till trådarna i båda kanterna.
  (BOARD_MM.doubleInner + BOARD_MM.doubleOuter) / 2 - 2,
  (BOARD_MM.doubleInner + BOARD_MM.doubleOuter) / 2,
  (BOARD_MM.doubleInner + BOARD_MM.doubleOuter) / 2 + 2,
  (BOARD_MM.tripleInner + BOARD_MM.tripleOuter) / 2 - 2,
  (BOARD_MM.tripleInner + BOARD_MM.tripleOuter) / 2,
  (BOARD_MM.tripleInner + BOARD_MM.tripleOuter) / 2 + 2,
];

/** Board-punkt på radie r och vinkel a, där a = 0 är rakt upp (sektor 20). */
const polar = (r: number, a: number): Point => ({ x: r * Math.sin(a), y: -r * Math.cos(a) });

/** +1 om sektorn vid vinkeln är en "mörk" sektor (röd ring), annars -1. */
const expectedSign = (angleRad: number): number => {
  const deg = ((angleRad * 180) / Math.PI + 360 * 10) % 360;
  const sectorIndex = Math.floor(((deg + 9) % 360) / 18);
  return sectorIndex % 2 === 0 ? 1 : -1;
};

/** En avläsning: board-vinkeln provet togs vid, och +1 röd / -1 grön. */
export interface RingVotes {
  /** Board-vinklar i radianer, 0 = rakt upp i kalibreringens gauge. */
  angles: number[];
  /** +1 för röd, -1 för grön. Samma längd som `angles`. */
  votes: number[];
  /** Hur många prover som togs totalt, inklusive de som inte gick att färgbestämma. */
  sampled: number;
}

/**
 * Läser av röd/grön längs dubbel- och trippelringen genom kalibreringen.
 * `sample` läser bildens färg och ska vara samma bild som kalibreringen gjordes
 * mot. Prover som hamnar på tråd, i en nött fläck eller utanför bilden faller
 * bort - de blir inga röster alls.
 */
export function sampleRingVotes(
  calib: BoardCalibration,
  sample: ColourSampler,
  opts: SectorRotationOptions = {},
): RingVotes {
  const steps = opts.angleSteps ?? 720;
  const radii = opts.radiiMM ?? DEFAULT_RADII;
  const angles: number[] = [];
  const votes: number[] = [];
  let sampled = 0;
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * 2 * Math.PI;
    for (const r of radii) {
      const p = polar(r, a);
      const img = calib.project(p.x, p.y);
      const rgb = sample(img.x, img.y);
      sampled++;
      if (!rgb) continue;
      const cls = classifyBoardColour(rgb);
      if (cls === 'other') continue;
      angles.push(a);
      votes.push(cls === 'red' ? 1 : -1);
    }
  }
  return { angles, votes, sampled };
}

/**
 * Fasen ur färdiga röster. Ren funktion - det är den här som går att köra mot
 * en fixtur av VERKLIGA avläsningar från Kristians tavla, utan bildavkodning.
 *
 * Söker bara över 36°, för mönstret upprepar sig där, och vecklar in svaret
 * till ±18°. Det är samma sak som att välja den av de tio möjliga lösningarna
 * som ligger närmast "20 rakt upp".
 */
export function sectorRotationFromVotes(
  { angles, votes, sampled }: RingVotes,
  opts: SectorRotationOptions = {},
): SectorRotationResult | null {
  const searchStepDeg = opts.searchStepDeg ?? 0.25;
  const minVotes = Math.max(64, sampled / 12);
  if (votes.length < minVotes) return null;

  let bestOffset = 0;
  let bestScore = -Infinity;
  const halfSector = Math.PI / 20; // 9°
  for (let d = -2 * halfSector; d < 2 * halfSector; d += (searchStepDeg * Math.PI) / 180) {
    let score = 0;
    for (let k = 0; k < votes.length; k++) score += votes[k] * expectedSign(angles[k] - d);
    if (score > bestScore) {
      bestScore = score;
      bestOffset = d;
    }
  }

  return {
    offsetRad: bestOffset,
    confidence: bestScore / votes.length,
    votes: votes.length,
  };
}

/**
 * Uppskattar hur mycket kalibreringens sektorhjul är vridet mot den verkliga
 * tavlan. Returnerar null om för få prover gick att färgbestämma.
 */
export function estimateSectorRotation(
  calib: BoardCalibration,
  sample: ColourSampler,
  opts: SectorRotationOptions = {},
): SectorRotationResult | null {
  return sectorRotationFromVotes(sampleRingVotes(calib, sample, opts), opts);
}
