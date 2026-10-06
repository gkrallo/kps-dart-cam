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
 * Så nära en gräns (tråd eller ringkant) får spetsen ligga innan avläsningen
 * räknas som osäker och grannfältet nämns.
 *
 * Uppmätt i spel 2026-10-06, 64 avläsningar: tre av fem rättningar var
 * gränsfall på 0,35, 0,45 och 0,85 mm från tråden (S15/S10, hörnet
 * S14/T9, S16/S7) - kalibreringens rotation mättes samtidigt till -0,25°,
 * så det är precisionsgränsen och inget som går att kalibrera bort. De två
 * andra var blobbfel långt från gränser. Vid 1,0 mm flaggades 10 av 64 kast,
 * och alla tre gränsfel fanns bland dem; vid 0,75 mm föll S16/S7 bort.
 */
export const BOUNDARY_MARGIN_MM = 1.0;

/**
 * Fälten som ligger inom `marginMm` från spetsen men skiljer sig från det
 * avlästa, närmast först. Tom lista = spetsen sitter tryggt inne i sitt fält.
 *
 * Provar punkter i ringar runt spetsen i stället för att räkna avstånd till
 * varje tråd och ringkant var för sig: då kommer hörnen med av sig själva.
 * I hörnfallet ovan var närmaste granne T14 (0,35 mm) men sanningen T9,
 * diagonalt - därför returneras alla grannar, inte bara den närmaste.
 */
export function nearbyScores(
  X: number,
  Y: number,
  marginMm: number = BOUNDARY_MARGIN_MM,
): { score: DartScore; distMm: number }[] {
  const base = getScoreFromCanonicalCoordinates(X, Y).label;
  const found = new Map<string, { score: DartScore; distMm: number }>();
  const STEPS = 10;
  const DIRS = 72;
  for (let s = 1; s <= STEPS; s++) {
    const d = (marginMm * s) / STEPS;
    for (let k = 0; k < DIRS; k++) {
      const a = (k / DIRS) * 2 * Math.PI;
      const sc = getScoreFromCanonicalCoordinates(X + d * Math.cos(a), Y + d * Math.sin(a));
      if (sc.label !== base && !found.has(sc.label)) found.set(sc.label, { score: sc, distMm: d });
    }
  }
  return [...found.values()].sort((p, q) => p.distMm - q.distMm);
}

/**
 * Bekvämlighetsfunktion: poäng direkt från en punkt i den warpade 800x800-bilden.
 */
export function getScoreFromPixel(x: number, y: number): DartScore {
  const { X, Y } = pixelToCanonical(x, y);
  return getScoreFromCanonicalCoordinates(X, Y);
}
