import type { Point } from '../types';

/**
 * Gruppering av maskfragment som hör till SAMMA pil.
 *
 * Bakgrund (uppmätt 2026-09-12 mot `dart-silver-shaft-on-cream.jpg`): en pil
 * blir inte alltid en enda kontur. Kristians pilar har silvrigt skaft och svart
 * vinge, och den smala delen mellan pipan och vingen har nästan ingen
 * luminanskontrast mot tavlans gräddvita fält. Efter GaussianBlur + MORPH_OPEN
 * är den borta ur masken, och pilen faller isär i två blobbar:
 *
 *   pipa+spets  area 2068, box 538,702-645,737   (avlång, spetsen i ena änden)
 *   vinge       area 6803, box 679,637-790,749   (kompakt, ~40 mm från spetsen)
 *
 * Detektorn prövade kandidaterna i STORLEKSORDNING, så vingen vann alltid -
 * och en vinges tyngdpunkt gav `S18@143mm` där sanningen var 20. Samma pil med
 * skaftet över tavlans svarta ram blev en enda blobb och lästes rätt.
 *
 * Tröskeln är alltså inte problemet (prövat: 10 -> 6 gav 1778 konturer utan att
 * skaftet dök upp) och morfologi kan inte återskapa det som aldrig kom med i
 * masken. Det som går att göra är att sätta ihop bitarna igen.
 *
 * Regeln: två fragment hör ihop om de ligger nära varandra OCH unionen blir
 * MER avlång än det största fragmentet var för sig. Det är skillnaden mellan
 * bitar av samma pil (de ligger i linje, ände mot ände -> avlångheten växer)
 * och en pil med en skugga bredvid sig (skuggan ligger vid SIDAN -> unionen
 * blir rundare, och sammanslagningen förkastas).
 */

export interface BlobFragment {
  /** Konturpunkter i RÅ kamerabild. */
  points: Point[];
  /** Konturens area i pixlar (cv.contourArea eller antal maskpixlar). */
  area: number;
}

export interface BlobGroup {
  /** Alla ingående fragments konturpunkter. */
  points: Point[];
  /** Summan av fragmentens areor. */
  area: number;
  /** Index i indatalistan, i den ordning de slogs ihop. */
  members: number[];
}

/**
 * Uppmätt glapp mellan pipa och vinge i felfallet: 34 px (~14 mm vid 2,4 px/mm).
 * 45 px ger marginal utan att nå ett rimligt avstånd till något annat föremål.
 * Att två OLIKA pilar skulle slås ihop är inte en risk här: varje analys diffar
 * mot en referensbild som redan innehåller de tidigare pilarna, så bara den
 * nya pilens material finns i masken.
 */
export const MAX_FRAGMENT_GAP_PX = 45;

/**
 * Fragment som är extremt avlånga slås aldrig ihop med något. En spindeltråd,
 * en tavelkant eller en skuggrand mäter 20-25:1 (uppmätt; riktiga kast 2,6-4,4),
 * och de kan ligga precis intill pilen. Slogs de ihop skulle unionen bli längre,
 * alltså passera avlånghetsvillkoret, och sedan förkastas av taket elong > 12 i
 * chooseDartTip - pilen skulle MISSAS i stället för att bara läsas fel. Var för
 * sig förkastas strimman och pilen prövas som egen kandidat.
 */
export const MAX_MERGE_ELONGATION = 12;

/** sqrt(större egenvärde / mindre) för punktmängden - samma mått som `detectDartAxisTip`. */
export function pcaElongation(points: Point[]): number {
  const n = points.length;
  if (n < 2) return 1;
  let cx = 0;
  let cy = 0;
  for (const p of points) {
    cx += p.x;
    cy += p.y;
  }
  cx /= n;
  cy /= n;
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
  sxx /= n;
  sxy /= n;
  syy /= n;
  const tr = sxx + syy;
  const det = sxx * syy - sxy * sxy;
  const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - det));
  const lambdaMax = tr / 2 + disc;
  const lambdaMin = tr / 2 - disc;
  if (lambdaMax <= 1e-9) return 1;
  return Math.sqrt(lambdaMax / Math.max(lambdaMin, 1e-9));
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Axelparallell omskrivande rektangel - motsvarar `cv.boundingRect`. */
export function boundingRect(points: Point[]): Rect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, width: 0, height: 0 };
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/** Konvext hölje, monotone chain. Returnerar moturs i bildkoordinater. */
export function convexHull(points: Point[]): Point[] {
  if (points.length < 3) return [...points];
  const pts = [...points].sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
  const cross = (o: Point, a: Point, b: Point) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const build = (src: Point[]): Point[] => {
    const out: Point[] = [];
    for (const p of src) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };
  return [...build(pts), ...build([...pts].reverse())];
}

export interface OrientedRect {
  width: number;
  height: number;
  /** Rotation i radianer för den sida `width` mäter. */
  angle: number;
  center: Point;
}

/**
 * Minsta omskrivande roterade rektangel - motsvarar `cv.minAreaRect`.
 *
 * Finns i JS för att kandidatbedömningen ska gå att köra i Node-testerna; i
 * detektorn används den på grupper av fragment, som inte längre är en enda
 * OpenCV-kontur. Rotating calipers över det konvexa höljet: den minsta
 * rektangeln delar alltid en sida med höljet.
 */
export function minAreaRect(points: Point[]): OrientedRect {
  const hull = convexHull(points);
  if (hull.length === 0) return { width: 0, height: 0, angle: 0, center: { x: 0, y: 0 } };
  if (hull.length < 3) {
    const r = boundingRect(hull);
    return {
      width: r.width,
      height: r.height,
      angle: 0,
      center: { x: r.x + r.width / 2, y: r.y + r.height / 2 },
    };
  }
  let best: OrientedRect | null = null;
  let bestArea = Infinity;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const len = Math.hypot(ex, ey);
    if (len < 1e-9) continue;
    const ux = ex / len;
    const uy = ey / len;
    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    for (const p of hull) {
      const u = p.x * ux + p.y * uy;
      const v = -p.x * uy + p.y * ux;
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }
    const w = maxU - minU;
    const h = maxV - minV;
    const area = w * h;
    if (area < bestArea) {
      bestArea = area;
      const cu = (minU + maxU) / 2;
      const cv = (minV + maxV) / 2;
      best = {
        width: w,
        height: h,
        angle: Math.atan2(uy, ux),
        center: { x: cu * ux - cv * uy, y: cu * uy + cv * ux },
      };
    }
  }
  return best ?? { width: 0, height: 0, angle: 0, center: { x: 0, y: 0 } };
}

/** Kortaste avståndet mellan två rektanglar (0 om de överlappar). */
function rectGap(a: Rect, b: Rect): number {
  const dx = Math.max(0, Math.max(a.x - (b.x + b.width), b.x - (a.x + a.width)));
  const dy = Math.max(0, Math.max(a.y - (b.y + b.height), b.y - (a.y + a.height)));
  return Math.hypot(dx, dy);
}

/**
 * Kortaste avståndet mellan två punktmängder.
 *
 * Glesas ut vid stora konturer: jämförelsen är O(n*m) och en arm i bild kan ge
 * ett par tusen konturpunkter. Punkterna ligger i ordning längs konturen, så
 * ett steg på k hoppar över k intilliggande randpixlar och kan överskatta
 * avståndet med ~k/2 px - försumbart mot glappet på 45 px.
 */
const GAP_SAMPLE_CAP = 300;
function pointGap(a: Point[], b: Point[]): number {
  const strideA = Math.max(1, Math.ceil(a.length / GAP_SAMPLE_CAP));
  const strideB = Math.max(1, Math.ceil(b.length / GAP_SAMPLE_CAP));
  let best = Infinity;
  for (let i = 0; i < a.length; i += strideA) {
    const p = a[i];
    for (let j = 0; j < b.length; j += strideB) {
      const q = b[j];
      const d = (p.x - q.x) ** 2 + (p.y - q.y) ** 2;
      if (d < best) best = d;
    }
  }
  return Math.sqrt(best);
}

export interface GroupOptions {
  maxGapPx?: number;
}

/**
 * Slår ihop fragment som hör till samma pil. Fragment som inte hör ihop med
 * något annat kommer tillbaka som egna grupper, så anroparen kan behandla
 * resultatet precis som den gamla kandidatlistan. Sorteras på total area,
 * största först - samma ordning som förut.
 */
export function groupFragments(frags: BlobFragment[], opts: GroupOptions = {}): BlobGroup[] {
  const maxGap = opts.maxGapPx ?? MAX_FRAGMENT_GAP_PX;
  const n = frags.length;
  if (n === 0) return [];

  const rects = frags.map((f) => boundingRect(f.points));
  const parent = frags.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  // Punkterna för varje rot, så avlångheten mäts på gruppen som den ser ut nu.
  const points: Point[][] = frags.map((f) => [...f.points]);
  const areas = frags.map((f) => f.area);

  // Närmast först: bitar av samma pil ligger tätare än allt annat i bilden.
  const streak = frags.map((f) => pcaElongation(f.points) > MAX_MERGE_ELONGATION);
  const pairs: { i: number; j: number; gap: number }[] = [];
  for (let i = 0; i < n; i++) {
    if (streak[i]) continue;
    for (let j = i + 1; j < n; j++) {
      if (streak[j]) continue;
      if (rectGap(rects[i], rects[j]) > maxGap) continue;
      const gap = pointGap(frags[i].points, frags[j].points);
      if (gap <= maxGap) pairs.push({ i, j, gap });
    }
  }
  pairs.sort((a, b) => a.gap - b.gap);

  for (const { i, j } of pairs) {
    const ri = find(i);
    const rj = find(j);
    if (ri === rj) continue;
    // Avlånghetsvillkoret: bitar av samma pil ligger i linje, ände mot ände.
    // En skugga eller reflex bredvid pilen gör unionen RUNDARE, och då är det
    // inte samma föremål.
    const merged = [...points[ri], ...points[rj]];
    const bigger = areas[ri] >= areas[rj] ? ri : rj;
    if (pcaElongation(merged) <= pcaElongation(points[bigger])) continue;
    const keep = areas[ri] >= areas[rj] ? ri : rj;
    const drop = keep === ri ? rj : ri;
    parent[drop] = keep;
    points[keep] = merged;
    areas[keep] = areas[ri] + areas[rj];
  }

  const byRoot = new Map<number, BlobGroup>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    const g = byRoot.get(r);
    if (g) g.members.push(i);
    else byRoot.set(r, { points: points[r], area: areas[r], members: [i] });
  }
  return [...byRoot.values()].sort((a, b) => b.area - a.area);
}
