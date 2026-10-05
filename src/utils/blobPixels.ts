/**
 * Tre mått på EN blobbs egna pixlar, mot den tomma tavlan.
 *
 * Detektorn ser förändringar som skillnaden mot förra bilden, och `absdiff`
 * är symmetriskt: en ny pil, hålet efter en uttagen pil och en pil som
 * skakat till ser likadana ut där. Det som skiljer dem åt är vad som fanns
 * på varje pixel FÖRE och vad som finns NU, jämfört med den tomma tavlan:
 *
 *                       före (toppen)   nu (aktuell bild)
 *   ny pil              tom             material        -> material hög, före låg
 *   hål efter uttag     material        tom             -> material låg
 *   pil som skakat      material        hälften tom     -> före hög, lämnat > 0
 *   ny pil över gammal  delvis material material        -> före hög, lämnat ~0
 *
 * Bara pixlar där masken är satt räknas, så en grannpil i samma rektangel
 * påverkar inte svaret. Gles provtagning (~4000 prov per blobb) räcker för
 * andelar och håller det snabbt i rAF-loopen.
 *
 * Bryts ut ur useDartDetector 2026-10-05 för att kunna testas; där fanns tre
 * nästan identiska slingor.
 */

export interface BlobPixelInput {
  /** Bildens bredd (raddelning) i pixlar. */
  cols: number;
  rows: number;
  /** Blobbens omskrivande rektangel. */
  rect: { x: number; y: number; width: number; height: number };
  /** Maskbild (≠ 0 = blobbens pixel), samma storlek som bilden. */
  mask: ArrayLike<number>;
  /** Aktuell gråskalebild. */
  cur: ArrayLike<number>;
  /** Bilden före förändringen (toppen av stacken). Null om den ÄR den tomma tavlan. */
  before: ArrayLike<number> | null;
  /** Den tomma tavlan. */
  empty: ArrayLike<number>;
  /** Gråvärdesskillnad som räknas som "skiljer sig" (RAW_DIFF_THRESHOLD). */
  threshold: number;
  /** Ungefärligt antal prov. */
  samples?: number;
}

export interface BlobPixelStats {
  /** Andel där NU skiljer sig från tom tavla. Låg = hål efter uttagen pil. */
  material: number;
  /** Andel där FÖRE skilde sig från tom tavla. Hög = det fanns redan något här. */
  prior: number;
  /** Andel där FÖRE hade material men NU är tom tavla. > 0 = något lämnade platsen. */
  vacated: number;
  /** Antal prov som räknades. 0 = tom mask (då är andelarna meningslösa). */
  n: number;
}

export function blobPixelStats(input: BlobPixelInput): BlobPixelStats {
  const { cols, rows, rect, mask, cur, before, empty, threshold } = input;
  const x0 = Math.max(0, Math.floor(rect.x));
  const y0 = Math.max(0, Math.floor(rect.y));
  const x1 = Math.min(cols, Math.ceil(rect.x + rect.width));
  const y1 = Math.min(rows, Math.ceil(rect.y + rect.height));
  // Tom rektangel eller tom mask: "material" 1 är den säkra riktningen (ett
  // kast avvisas inte som hål på för lite underlag), "före"/"lämnat" 0 likaså.
  if (x1 <= x0 || y1 <= y0) return { material: 1, prior: 0, vacated: 0, n: 0 };
  const step = Math.max(1, Math.floor(Math.sqrt(((x1 - x0) * (y1 - y0)) / (input.samples ?? 4000))));
  let n = 0;
  let mat = 0;
  let pri = 0;
  let vac = 0;
  for (let y = y0; y < y1; y += step) {
    const off = y * cols;
    for (let x = x0; x < x1; x += step) {
      const i = off + x;
      if (!mask[i]) continue;
      n++;
      const nowMaterial = Math.abs(cur[i] - empty[i]) > threshold;
      const hadMaterial = before ? Math.abs(before[i] - empty[i]) > threshold : false;
      if (nowMaterial) mat++;
      if (hadMaterial) pri++;
      if (hadMaterial && !nowMaterial) vac++;
    }
  }
  if (n === 0) return { material: 1, prior: 0, vacated: 0, n: 0 };
  return { material: mat / n, prior: pri / n, vacated: vac / n, n };
}
