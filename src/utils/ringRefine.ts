import type { Point } from '../types';
import { BOARD_MM } from './dartMath';
import { computeCalibration, type BoardCalibration } from './boardProjection';
import { classifyBoardColour, type ColourSampler } from './sectorPhase';

/**
 * Finjustering av kalibreringen mot ringkanterna i den faktiska bilden.
 *
 * Bakgrund (uppmätt 2026-10-04 på Kristians Winmau Blade X): efter
 * autokalibrering låg dubbelringens ytterkant på 170,0 mm uppe, till höger
 * och till vänster - men på 167,0 mm nertill. Bottenpunkten satt alltså ~3 mm
 * (7 px) för långt ut, och det syntes för blotta ögat på wireframet. Fyra
 * punkter har ingen redundans: ett fel i en av dem går rakt in i matrisen.
 *
 * Idén är den som de mest träffsäkra öppna lösningarna använder (darts_vader:
 * 0,58 mm medianresidual): leta ringkanten längs många strålar och lös
 * homografin överbestämt. Vi tar den nuvarande kalibreringen som gauge, går
 * längs varje stråle genom den och hittar var dubbelringens färg (röd/grön)
 * slutar utåt - det är 170 mm - och var trippelringens färg slutar utåt - det
 * är 107 mm. Varje sådant kantfynd ger ett par (board-punkt, bildpunkt), och
 * `computeCalibration` löser med Levenberg-Marquardt över alla par. Några
 * varv, för strålarna själva flyttar sig när kalibreringen ändras.
 *
 * Bara YTTERkanterna används. Innerkanterna läste 3-7 mm för lågt på samma
 * bild (färgen "läcker" inåt över tråden i JPEG och blur), medan ytterkanterna
 * låg på ±0,5 mm där kalibreringen var rätt.
 *
 * Rotationen rörs inte: kantpunkten på en stråle har per definition samma
 * board-vinkel som strålen. Den sköts av sectorPhase.ts.
 *
 * Ren geometri + en färgsamplare, ingen OpenCV: körs i Node-testerna och mot
 * verkliga bildrutor via scripts/measure-rings.ts.
 */

export interface RingRefineOptions {
  /** Antal strålar runt varvet. */
  angleSteps?: number;
  /** Så långt in och ut från nominella radien letas kanten (mm). */
  searchMM?: number;
  /** Steg längs strålen (mm). */
  stepMM?: number;
  /** Antal omlösningar. */
  iterations?: number;
  /** Kantfynd längre än så här från medianen för ringen förkastas (mm). */
  outlierMM?: number;
  /**
   * Hur långt innanför den nominella radien färgen slutar (mm). Tråden ligger
   * ovanpå gränsen, så den synliga färgkanten är nominell radie minus ungefär
   * en halv trådbredd plus lite oskärpa. Samma absoluta mått för båda
   * ringarna - utan det får dubbel (0,75/170) och trippel (0,75/107) olika
   * relativa fel och passningen kompromissar till ~1,4 mm (syntetiskt mätt).
   */
  wireMM?: number;
}

export interface RingRefineResult {
  calib: BoardCalibration;
  /** Antal kantpar som gick in i sista lösningen. */
  samples: number;
  /** Reprojektionsfel i px från sista lösningen. */
  residualPx: number;
  maxResidualPx: number;
  /**
   * Uppmätt ytterkant per ring FÖRE finjusteringen, medianradie i mm per
   * kvadrant [topp, höger, botten, vänster]. Säger hur fel det var.
   */
  before: { double: number[]; triple: number[] };
}

const DEFAULTS: Required<RingRefineOptions> = {
  angleSteps: 360,
  searchMM: 12,
  stepMM: 0.25,
  iterations: 3,
  outlierMM: 4,
  wireMM: 0.6,
};

const polar = (r: number, a: number): Point => ({ x: r * Math.sin(a), y: -r * Math.cos(a) });

/** Ligger vinkeln inom ±2° från en sektortråd (i kalibreringens gauge)? */
export function nearSectorWire(angleRad: number, marginDeg = 2): boolean {
  const deg = ((angleRad * 180) / Math.PI + 3600) % 360;
  const m = (deg + 9) % 18;
  return m < marginDeg || m > 18 - marginDeg;
}

/**
 * Ytterkanten (mm) av en färgad ring längs strålen `angleRad`, sökt från
 * utsidan och inåt: första radien där två intilliggande prov båda är
 * röd/grön. Null om ringen inte hittas i sökfönstret.
 */
export function findRingOuterEdge(
  calib: BoardCalibration,
  sample: ColourSampler,
  angleRad: number,
  nominalMM: number,
  opts: Pick<Required<RingRefineOptions>, 'searchMM' | 'stepMM'>,
): number | null {
  const isRing = (r: number): boolean => {
    const p = polar(r, angleRad);
    const q = calib.project(p.x, p.y);
    const rgb = sample(q.x, q.y);
    return !!rgb && classifyBoardColour(rgb) !== 'other';
  };
  for (let r = nominalMM + opts.searchMM; r >= nominalMM - opts.searchMM; r -= opts.stepMM) {
    // Kanten ligger mellan sista icke-ring-provet (r + steg) och första
    // ring-provet (r): mittemellan är väntevärdesriktigt.
    if (isRing(r) && isRing(r - opts.stepMM)) return r + opts.stepMM / 2;
  }
  return null;
}

function median(xs: number[]): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

const quadrantOf = (angleRad: number): number => {
  const deg = ((angleRad * 180) / Math.PI + 3600) % 360;
  return deg < 45 || deg >= 315 ? 0 : deg < 135 ? 1 : deg < 225 ? 2 : 3;
};

/** Mäter ytterkanten för en ring runt varvet; returnerar fynd per stråle. */
function measureRing(
  calib: BoardCalibration,
  sample: ColourSampler,
  nominalMM: number,
  o: Required<RingRefineOptions>,
): { angle: number; edgeMM: number }[] {
  const found: { angle: number; edgeMM: number }[] = [];
  for (let i = 0; i < o.angleSteps; i++) {
    const a = (i / o.angleSteps) * 2 * Math.PI;
    if (nearSectorWire(a)) continue;
    const e = findRingOuterEdge(calib, sample, a, nominalMM, o);
    if (e !== null) found.push({ angle: a, edgeMM: e });
  }
  // Förkasta det som ligger långt från medianen: nummerringen, slitage,
  // en pil som råkar sitta i, en skugga.
  const med = median(found.map((f) => f.edgeMM));
  return found.filter((f) => Math.abs(f.edgeMM - med) <= o.outlierMM);
}

function quadrantMedians(found: { angle: number; edgeMM: number }[]): number[] {
  const q: number[][] = [[], [], [], []];
  for (const f of found) q[quadrantOf(f.angle)].push(f.edgeMM);
  return q.map(median);
}

/**
 * Finjusterar `calib` mot dubbelringens och trippelringens ytterkanter.
 * Returnerar null om för få kanter hittades (mörkt, fel ring, tavlan utanför
 * bild) - då är den gamla kalibreringen bättre än en gissning.
 */
export function refineCalibrationOnRings(
  calib: BoardCalibration,
  sample: ColourSampler,
  opts: RingRefineOptions = {},
): RingRefineResult | null {
  const o = { ...DEFAULTS, ...opts };
  let current = calib;
  let before: RingRefineResult['before'] | null = null;
  let last: { samples: number; residualPx: number; maxResidualPx: number } | null = null;

  for (let it = 0; it < o.iterations; it++) {
    const dbl = measureRing(current, sample, BOARD_MM.doubleOuter, o);
    const tri = measureRing(current, sample, BOARD_MM.tripleOuter, o);
    if (!before) before = { double: quadrantMedians(dbl), triple: quadrantMedians(tri) };
    // Minst en fjärdedel av strålarna måste ha hittat dubbelringen, annars
    // är det inte tavlan vi tittar på.
    if (dbl.length < o.angleSteps / 4) return null;

    const boardPts: Point[] = [];
    const imgPts: Point[] = [];
    const push = (found: { angle: number; edgeMM: number }[], nominal: number) => {
      for (const f of found) {
        // Bildpunkten är där FÄRGkanten faktiskt sågs (på radien edgeMM genom
        // den nuvarande kalibreringen); den SKA ligga på nominell radie minus
        // trådbredden, för tråden täcker gränsen.
        const seen = polar(f.edgeMM, f.angle);
        imgPts.push(current.project(seen.x, seen.y));
        boardPts.push(polar(nominal - o.wireMM, f.angle));
      }
    };
    push(dbl, BOARD_MM.doubleOuter);
    push(tri, BOARD_MM.tripleOuter);

    const next = computeCalibration(boardPts, imgPts, { refine: true });
    if (!next) break;
    current = next;
    last = { samples: boardPts.length, residualPx: next.residualPx, maxResidualPx: next.maxResidualPx };
  }
  if (!last || !before) return null;
  return { calib: current, ...last, before };
}
