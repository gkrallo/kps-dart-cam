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

/* ------------------------------------------------------------------ *
 * Valet av spets: vilken metod ska tro på, och när ska vi avstå?
 * ------------------------------------------------------------------ */

export interface TipChoiceInput {
  /** Maskens konturpunkter i RÅ kamerabild. */
  points: Point[];
  /** `minAreaRect`-avlånghet för blobben (lång sida / kort sida). */
  elongation: number;
  /** Axelanpassningens resultat, eller null om den inte gick att göra. */
  axis: DartAxisResult | null;
  /** Var förändringen bara en ljusändring? Då finns ingen pil alls. */
  isLightingOnly: boolean;
  /** Kunde skuggtestet AKTIVT avgöra saken? Se shadowTest.ts. */
  lightingDecided: boolean;
  /** Skuggtestets motivering, för loggen. */
  lightingReason?: string;
}

export interface TipChoice {
  /** Spetsen i samma koordinater som `points`, eller null = avstå. */
  tip: Point | null;
  /** Vilken metod som valdes, eller varför vi avstod. */
  how: string;
}

/**
 * Övre gräns för axelmetoden: en pil sedd från stativet mäter elong ~2-5.
 * Över 12 är det en LINJE - spindeltråd, tavelkant, skuggrand, kabel.
 */
export const MAX_AXIS_ELONGATION = 12;

/**
 * Konfidensgräns för att lita på axelns spets-vs-fena-bedömning.
 *
 * Var 0.4, satt när riktiga kast mätte 0.55-0.75 och artefakter 0.20-0.23.
 * Sänkt till 0.33 efter 2026-09-12: en kraftigt lutad pil i bullen mätte
 * 0.43 - alltså betydligt lägre än det tidigare intervallet - medan dagens
 * artefakter (arm i bildkanten) låg på 0.09, 0.10, 0.15 och 0.23. Gapet går
 * numera mellan 0.23 och 0.43, och 0.33 ligger mitt i det.
 */
export const MIN_AXIS_CONFIDENCE = 0.33;

/**
 * Tyngdpunktsmetoden får bara användas på KOMPAKTA blobbar.
 *
 * Var 5. Uppmätt 2026-09-12 att det var för tillåtande: dagens artefakter
 * hade minAreaRect-elong 3.3, 3.8 och 4.3 med konfidens 0.09-0.15, och
 * släpptes alltså igenom som "frontal pil" - de räddades bara av att spetsen
 * hamnade utanför tavlan och fångades av radiespärren. Och tyngdpunkten är
 * garanterat fel i en lång blob: den sitter mitt på pilkroppen, flera
 * centimeter från spetsen. Den är bara försvarbar när blobben verkligen är en
 * kompakt klump, alltså en pil som pekar mot linsen.
 */
export const MAX_CENTROID_ELONGATION = 3;

/**
 * Avgör vilken spets vi ska tro på - eller om vi ska avstå helt.
 *
 * Att avstå är ett fullgott svar: appen varnar vid turslut när färre pilar
 * lästs av än kastats, och då går pilen att fylla i för hand. Det är bättre
 * än att gissa fram en poäng som tyst blir fel.
 */
export function chooseDartTip(input: TipChoiceInput): TipChoice {
  const { points, elongation, axis, isLightingOnly, lightingDecided, lightingReason } = input;

  if (isLightingOnly) {
    return { tip: null, how: lightingReason ?? 'bara en ljusändring, ingen pil' };
  }

  if (axis && axis.elongation > MAX_AXIS_ELONGATION) {
    return {
      tip: null,
      how: `för avlång: elong ${axis.elongation.toFixed(1)} > ${MAX_AXIS_ELONGATION} (kant/tråd/skugga, inte pil)`,
    };
  }

  if (axis && axis.confidence > MIN_AXIS_CONFIDENCE) {
    return {
      tip: axis.tip,
      how: `axel (conf ${axis.confidence.toFixed(2)}, elong ${axis.elongation.toFixed(1)})`,
    };
  }

  // Nästan frontal pil: axeln går inte att lita på, men blobben är en kompakt
  // klump och då ligger tyngdpunkten nära spetsen - parallaxen är liten när
  // pilen pekar mot linsen (uppmätt: tyngdpunkten läser radien inom ~1 mm).
  // Kravet på `lightingDecided` för de riktigt runda: en rund fläck som vi
  // inte kunde mäta på är för svag grund för ett kast.
  if (elongation <= MAX_CENTROID_ELONGATION && (elongation >= 2.5 || lightingDecided)) {
    if (points.length === 0) return { tip: null, how: 'inga konturpunkter' };
    let mx = 0;
    let my = 0;
    for (const p of points) {
      mx += p.x;
      my += p.y;
    }
    return {
      tip: { x: mx / points.length, y: my / points.length },
      how: `tyngdpunkt (elong ${elongation.toFixed(1)})`,
    };
  }

  const axisNote = axis
    ? `conf ${axis.confidence.toFixed(2)} elong ${axis.elongation.toFixed(1)}`
    : 'null';
  return {
    tip: null,
    how:
      `avstår: axel ${axisNote}, blob-elong ${elongation.toFixed(1)}` +
      (elongation > MAX_CENTROID_ELONGATION
        ? ' (för lång för tyngdpunkt - vet inte vilken ände som är spetsen)'
        : ' (rund men skuggtestet kunde inte frikänna den)'),
  };
}

/* ------------------------------------------------------------------ *
 * Skuggan vid spetsen
 * ------------------------------------------------------------------ */

export interface GreyPair {
  /** Gråvärde i den aktuella bilden. */
  cur: number;
  /** Gråvärde i referensbilden (tavlan utan den här pilen). */
  ref: number;
}

export interface ShadowTrimOptions {
  /** Längsta sträcka som får trimmas (px). Mer än så är inte en skugga. */
  maxPx?: number;
  /** Så mycket mörkare än referensen måste en pixel vara för att räknas som skugga. */
  minDarker?: number;
  /** Mörkare än så är det ett föremål (stålspetsen, pilkroppen), inte skugga. */
  maxDarker?: number;
}

export interface ShadowTrimResult {
  tip: Point;
  /** Antal pixlar spetsen flyttades bakåt längs axeln. */
  trimmedPx: number;
}

/**
 * Drar tillbaka spetsen förbi pilens skugga.
 *
 * Uppmätt 2026-10-04 (T15 läst som S15 på 98,5 mm): med ringlampa runt tavlan
 * faller pilens skugga INÅT mot bullen, och vid spetsänden fortsätter den
 * 10-15 px bortom stålspetsen. Skuggan är 13-34 gråvärden mörkare än den
 * tomma tavlan men bär tavlans mönster, så den kommer med i masken (tröskel
 * 10) och binds ihop med pilen av morfologin. Axelmetodens extrempunkt hamnar
 * då i skuggans ände, 6 mm för långt in. Pilkroppen själv är däremot antingen
 * mycket ljusare (silver mot svart fält, +100) eller mycket mörkare än tavlan.
 *
 * Gå från spetsen bakåt längs axeln så länge pixeln INTE är pilmaterial:
 * neutral (maskens kant efter morfologin ligger en pixel utanför skuggan) eller
 * måttligt mörkare än referensen (skugga). Första pixel som är tydligt
 * ljusare eller mycket mörkare än referensen är pilen - där stannar vi.
 * `sample` läser gråvärdena; medelvärde över en liten tvärbredd är anroparens
 * sak. Trimmas inget returneras spetsen oförändrad.
 *
 * Verifierat offline mot bildparet från 2026-10-04 (scripts/tip-profile.ts):
 * appens spets 98,5 mm (S15) -> trimmad 104-105 mm (T15, facit).
 */
export function trimShadowAtTip(
  tip: Point,
  axisTowardTip: Point,
  sample: (x: number, y: number) => GreyPair | null,
  opts: ShadowTrimOptions = {},
): ShadowTrimResult {
  const maxPx = opts.maxPx ?? 20;
  const minDarker = opts.minDarker ?? 6;
  const maxDarker = opts.maxDarker ?? 45;
  const n = Math.hypot(axisTowardTip.x, axisTowardTip.y) || 1;
  const ux = axisTowardTip.x / n;
  const uy = axisTowardTip.y / n;
  let trimmed = 0;
  for (let s = 0; s < maxPx; s++) {
    const g = sample(tip.x - ux * s, tip.y - uy * s);
    if (!g) break;
    const darker = g.ref - g.cur;
    // Ljusare än referensen med marginal, eller mycket mörkare: material.
    if (darker < -minDarker || darker > maxDarker) break;
    trimmed = s + 1;
  }
  if (trimmed === 0) return { tip, trimmedPx: 0 };
  return { tip: { x: tip.x - ux * trimmed, y: tip.y - uy * trimmed }, trimmedPx: trimmed };
}
