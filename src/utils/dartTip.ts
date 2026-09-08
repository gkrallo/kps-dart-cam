import type { Point } from '../types';

/**
 * Spetsdetektering med axelanpassning.
 *
 * Den gamla metoden tog "punkten närmast tavlans mitt". Den plockar fel ände så
 * fort pilen ligger på tvären eller sitter nära bullen, och den gjordes dessutom
 * i den warpade bilden - där pilkroppen är utsmetad eftersom den sticker ut ur
 * tavlans plan, så dess riktning i den bilden är inte pilens riktning.
 *
 * Den här metoden anpassar pilens axel med PCA (motsvarar `cv.fitLine`),
 * projicerar maskpunkterna på axeln för att hitta de två ändarna, och avgör
 * vilken ände som är spetsen genom att mäta bredden vinkelrätt mot axeln:
 * fenan är 3-5x bredare än spetsen. Den ska köras på maskpunkter från **rå
 * kamerabild**; bara den färdiga spetspunkten warpas sedan genom homografin.
 */

export interface DartAxisResult {
  /** Spetsen (den smala änden), i samma koordinater som indata. */
  tip: Point;
  /** Bakänden (fenan, den breda änden). */
  tail: Point;
  /** Enhetsvektor längs pilen, pekar från tail mot tip. */
  axis: Point;
  centroid: Point;
  /** sqrt(större egenvärde / mindre) - hur avlång masken är. */
  elongation: number;
  tipWidthPx: number;
  tailWidthPx: number;
  /** 0-1: hur tydligt breddtestet skiljer ändarna. Låg = osäker. */
  confidence: number;
}

export interface DartAxisOptions {
  /** Minsta antal maskpunkter för att ens försöka. */
  minPoints?: number;
  /** Minsta avlånghet - runda blobbar (skuggor, brus) förkastas. */
  minElongation?: number;
  /** Andel av axelns längd som räknas som "nära en ände" vid breddmätningen. */
  endFraction?: number;
}

export function detectDartAxisTip(
  points: Point[],
  opts: DartAxisOptions = {},
): DartAxisResult | null {
  const minPoints = opts.minPoints ?? 12;
  const minElongation = opts.minElongation ?? 2;
  const endFraction = opts.endFraction ?? 0.25;
  if (points.length < minPoints) return null;

  let cx = 0;
  let cy = 0;
  for (const p of points) {
    cx += p.x;
    cy += p.y;
  }
  cx /= points.length;
  cy /= points.length;

  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const p of points) {
    const dx = p.x - cx;
    const dy = p.y - cy;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  sxx /= points.length;
  sxy /= points.length;
  syy /= points.length;

  // 2x2 symmetrisk egenuppdelning, sluten form.
  const tr = sxx + syy;
  const det = sxx * syy - sxy * sxy;
  const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  const lambdaMax = tr / 2 + disc;
  const lambdaMin = tr / 2 - disc;
  if (lambdaMax < 1e-9) return null;

  let ux: number;
  let uy: number;
  if (Math.abs(sxy) > 1e-9) {
    ux = lambdaMax - syy;
    uy = sxy;
  } else {
    ux = sxx >= syy ? 1 : 0;
    uy = sxx >= syy ? 0 : 1;
  }
  const un = Math.hypot(ux, uy) || 1;
  ux /= un;
  uy /= un;
  const vx = -uy;
  const vy = ux;

  const elongation = Math.sqrt(lambdaMax / Math.max(lambdaMin, 1e-9));
  if (elongation < minElongation) return null;

  const proj = points.map((p) => {
    const dx = p.x - cx;
    const dy = p.y - cy;
    return { s: dx * ux + dy * uy, t: dx * vx + dy * vy };
  });
  let sMin = Infinity;
  let sMax = -Infinity;
  for (const q of proj) {
    if (q.s < sMin) sMin = q.s;
    if (q.s > sMax) sMax = q.s;
  }
  const L = sMax - sMin;
  if (L < 1e-6) return null;

  const widthNear = (lo: number, hi: number): number => {
    let tMin = Infinity;
    let tMax = -Infinity;
    let n = 0;
    for (const q of proj) {
      if (q.s >= lo && q.s <= hi) {
        if (q.t < tMin) tMin = q.t;
        if (q.t > tMax) tMax = q.t;
        n++;
      }
    }
    return n >= 2 ? tMax - tMin : 0;
  };
  const widthAtMin = widthNear(sMin, sMin + endFraction * L);
  const widthAtMax = widthNear(sMax - endFraction * L, sMax);

  // Punkt vid en ände: extremt s, men medelvärdes-t för stabilitet.
  const endPoint = (atMin: boolean): Point => {
    const lo = atMin ? sMin : sMax - 0.1 * L;
    const hi = atMin ? sMin + 0.1 * L : sMax;
    let mt = 0;
    let n = 0;
    for (const q of proj) {
      if (q.s >= lo && q.s <= hi) {
        mt += q.t;
        n++;
      }
    }
    mt = n > 0 ? mt / n : 0;
    const s = atMin ? sMin : sMax;
    return { x: cx + s * ux + mt * vx, y: cy + s * uy + mt * vy };
  };

  const tipAtMin = widthAtMin <= widthAtMax;
  const tip = endPoint(tipAtMin);
  const tail = endPoint(!tipAtMin);
  const tipWidthPx = Math.min(widthAtMin, widthAtMax);
  const tailWidthPx = Math.max(widthAtMin, widthAtMax);
  const confidence = tailWidthPx > 1e-6 ? Math.min(1, (tailWidthPx - tipWidthPx) / tailWidthPx) : 0;

  // Axeln pekar från tail mot tip.
  const axis: Point = tipAtMin ? { x: -ux, y: -uy } : { x: ux, y: uy };

  return { tip, tail, axis, centroid: { x: cx, y: cy }, elongation, tipWidthPx, tailWidthPx, confidence };
}
