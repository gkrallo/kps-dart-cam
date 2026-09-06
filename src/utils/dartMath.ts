import { DartScore } from '../types';

/**
 * Sektorernas ordning medurs, med start på 20 rakt upp.
 */
const SECTORS = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];

/**
 * Officiella måtten på en darttavla, i millimeter från centrum.
 * Källa: WDF/BDO-standard. Ändra aldrig dessa utan att uppdatera testerna.
 */
export const BOARD_MM = {
  innerBull: 6.35,   // dubbel bull, 50p
  outerBull: 15.9,   // enkel bull, 25p
  tripleInner: 99,
  tripleOuter: 107,
  doubleInner: 162,
  doubleOuter: 170,  // tavlans yttre spelbara kant
} as const;

/**
 * Kalibreringen mappar de fyra punkterna (som sitter på dubbelringens ytterkant,
 * alltså 170 mm) till kanterna av en kvadrat med sidan BOARD_PX.
 * Radien BOARD_PX/2 motsvarar därför exakt BOARD_MM.doubleOuter.
 */
export const BOARD_PX = 800;
export const MM_PER_PX = BOARD_MM.doubleOuter / (BOARD_PX / 2); // 0.425
export const PX_PER_MM = 1 / MM_PER_PX;                          // 2.3529

/** Konverterar en punkt i den warpade 800x800-bilden till mm med bullseye i origo. */
export function pixelToCanonical(x: number, y: number): { X: number; Y: number } {
  return {
    X: (x - BOARD_PX / 2) * MM_PER_PX,
    Y: (y - BOARD_PX / 2) * MM_PER_PX,
  };
}

/** Konverterar mm-koordinater tillbaka till den warpade 800x800-bilden. */
export function canonicalToPixel(X: number, Y: number): { x: number; y: number } {
  return {
    x: X * PX_PER_MM + BOARD_PX / 2,
    y: Y * PX_PER_MM + BOARD_PX / 2,
  };
}

/**
 * Räknar ut poängen från kanoniska millimeterkoordinater, där bullseye är (0,0)
 * och dubbelringens ytterkant ligger på radie 170 mm. Y växer nedåt, precis som
 * i bildkoordinater, så sektor 20 ligger vid negativ Y.
 *
 * Detta är den enda poängfunktionen i appen. Räkna aldrig i pixlar.
 */
export function getScoreFromCanonicalCoordinates(X: number, Y: number): DartScore {
  const radius = Math.hypot(X, Y);
  const at = (baseScore: number, multiplier: number, label: string): DartScore => ({
    baseScore,
    multiplier,
    totalPoints: baseScore * multiplier,
    label,
    coordinates: { x: X, y: Y },
  });

  if (radius <= BOARD_MM.innerBull) return at(25, 2, 'DB');
  if (radius <= BOARD_MM.outerBull) return at(25, 1, '25');
  if (radius > BOARD_MM.doubleOuter) return at(0, 0, 'MISS');

  // Vinkel: 0 grader rakt upp (sektor 20), växande medurs.
  const deg = Math.atan2(Y, X) * (180 / Math.PI);
  const normDeg = (deg + 90 + 360) % 360;
  const sectorIdx = Math.floor(((normDeg + 9) % 360) / 18);
  const baseScore = SECTORS[sectorIdx];

  if (radius >= BOARD_MM.tripleInner && radius <= BOARD_MM.tripleOuter) {
    return at(baseScore, 3, `T${baseScore}`);
  }
  if (radius >= BOARD_MM.doubleInner) {
    return at(baseScore, 2, `D${baseScore}`);
  }
  return at(baseScore, 1, `S${baseScore}`);
}

/**
 * Bekvämlighetsfunktion: poäng direkt från en punkt i den warpade 800x800-bilden.
 */
export function getScoreFromPixel(x: number, y: number): DartScore {
  const { X, Y } = pixelToCanonical(x, y);
  return getScoreFromCanonicalCoordinates(X, Y);
}
