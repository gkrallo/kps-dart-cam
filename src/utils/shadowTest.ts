/**
 * Skiljer "en pil har tillkommit" från "samma yta, annat ljus".
 *
 * Bildsubtraktionen i `useDartDetector` är blind för skillnaden: `absdiff`
 * lyser upp lika mycket av en skugga som av en pil, och en skugga som råkar
 * bli avlång klarar både elongations- och konfidenstestet. Det som faktiskt
 * skiljer dem åt är vad som händer med tavlans EGEN struktur inuti fläcken:
 *
 * - En skugga (eller en reflex) släcker/lyfter ytan men låter mönstret vara.
 *   Vita fält är fortfarande ljusare än röda, spindeltråden syns fortfarande.
 *   Nya bilden är alltså ungefär referensbilden gånger en konstant:
 *   `cur ≈ k · base`. Korrelationen mellan dem är hög och lutningen ≠ 1.
 * - En pil ERSÄTTER ytan. Pixlarna styrs av pilens eget material, inte av vad
 *   som råkade ligga bakom, så korrelationen med referensbilden kollapsar.
 *
 * Testet kräver att referensen har struktur att korrelera mot. Ligger fläcken
 * mitt i ett enfärgat fält går det inte att avgöra - då svarar funktionen
 * "vet inte" (`isLightingOnly: false`), vilket är den säkra riktningen: en pil
 * förkastas hellre aldrig av det här testet än av misstag.
 */

export interface BlobSample {
  /** Gråvärde (0-255) i den nya bilden. */
  cur: number;
  /** Gråvärde (0-255) i referensbilden, samma pixel. */
  base: number;
}

export interface ShadowVerdict {
  /** true = bara ljuset ändrades, ytan är densamma. Alltså ingen pil. */
  isLightingOnly: boolean;
  /**
   * Kunde testet alls avgöra saken? false betyder "vet inte" - för få punkter
   * eller enfärgat underlag utan mönster att korrelera mot. Anropare som vill
   * släppa igenom en svagare pilform (t.ex. en rund, frontal pil) bör kräva
   * `decided` - då vet vi att blobben aktivt frikänts, inte bara sluppit undan.
   */
  decided: boolean;
  /** Pearsons korrelation mellan referens och ny bild. */
  correlation: number;
  /** Lutningen i `cur ≈ slope · base + m`. < 1 = mörkare (skugga). */
  slope: number;
  sampleCount: number;
  reason: string;
}

export interface ShadowOptions {
  /** Under så här många punkter går det inte att säga något. */
  minSamples?: number;
  /** Referensen måste variera minst så här mycket (gråvärden) att korrelera mot. */
  minBaseStdDev?: number;
  /** Hur väl nya bilden måste följa referensen för att räknas som ljusändring. */
  minCorrelation?: number;
  /** Lutningsintervall som räknas som "samma yta, annat ljus". */
  minSlope?: number;
  maxSlope?: number;
}

const DEFAULTS: Required<ShadowOptions> = {
  minSamples: 40,
  minBaseStdDev: 6,
  minCorrelation: 0.75,
  // Under 0.15: ytan har blivit nästan svart oavsett vad som låg där - det är
  // ett föremål, inte en skugga. Mellan 0.95 och 1.05: ingen ljusändring värd
  // namnet, låt de vanliga formtesterna avgöra.
  minSlope: 0.15,
  maxSlope: 0.95,
};

export function classifyShadow(samples: BlobSample[], options: ShadowOptions = {}): ShadowVerdict {
  const opts = { ...DEFAULTS, ...options };
  const n = samples.length;

  // `decided` skiljer "vi kunde mäta och det är inget ljusskifte" från
  // "vi kunde inte mäta alls".
  const no = (reason: string, decided: boolean, correlation = 0, slope = 0): ShadowVerdict => ({
    isLightingOnly: false,
    decided,
    correlation,
    slope,
    sampleCount: n,
    reason,
  });

  if (n < opts.minSamples) return no(`för få punkter (${n} < ${opts.minSamples})`, false);

  let sumBase = 0;
  let sumCur = 0;
  for (const s of samples) {
    sumBase += s.base;
    sumCur += s.cur;
  }
  const meanBase = sumBase / n;
  const meanCur = sumCur / n;

  let varBase = 0;
  let varCur = 0;
  let cov = 0;
  for (const s of samples) {
    const db = s.base - meanBase;
    const dc = s.cur - meanCur;
    varBase += db * db;
    varCur += dc * dc;
    cov += db * dc;
  }
  varBase /= n;
  varCur /= n;
  cov /= n;

  const sdBase = Math.sqrt(varBase);
  if (sdBase < opts.minBaseStdDev) {
    // Enfärgad bakgrund: inget mönster att känna igen på andra sidan.
    return no(`referensen saknar struktur (sd ${sdBase.toFixed(1)})`, false);
  }

  const sdCur = Math.sqrt(varCur);
  const correlation = sdCur > 0 ? cov / (sdBase * sdCur) : 0;
  const slope = cov / varBase;

  if (correlation < opts.minCorrelation) {
    return no(`ytan följer inte referensen (r ${correlation.toFixed(2)})`, true, correlation, slope);
  }
  if (slope > opts.maxSlope && slope < 1 / opts.maxSlope) {
    return no(`ingen tydlig ljusändring (lutning ${slope.toFixed(2)})`, true, correlation, slope);
  }
  if (slope < opts.minSlope) {
    return no(`nästan svart oavsett underlag (lutning ${slope.toFixed(2)}) - föremål`, true, correlation, slope);
  }

  return {
    isLightingOnly: true,
    decided: true,
    correlation,
    slope,
    sampleCount: n,
    reason:
      slope < 1
        ? `skugga: samma mönster, ${Math.round((1 - slope) * 100)} % mörkare (r ${correlation.toFixed(2)})`
        : `reflex/ljusskifte: samma mönster, ${Math.round((slope - 1) * 100)} % ljusare (r ${correlation.toFixed(2)})`,
  };
}
