/**
 * Offline-mätning av kalibreringens radiella fel mot en riktig bildruta.
 *
 *   npx vite-node scripts/measure-rings.ts <bgr-fil> <meta-fil> <cal-context.json>
 *
 * Bilden avkodas i förväg till rå BGR (se fixturernas `note` om System.Drawing).
 * `cal-context.json` är det `tools/ev.mjs` ger: sparad kalibrering (andelar av
 * containern) plus containerstorlek. Kalibreringen byggs exakt som appen gör
 * (object-cover), och sedan letas dubbelringens och trippelringens kanter
 * längs 360 strålar genom färgklassningen i sectorPhase.ts. Skillnaden mot
 * 170/162/107/99 mm per kvadrant är kalibreringens fel i mm, oberoende av
 * wireframets utseende.
 */
import fs from 'node:fs';
import { CANONICAL_CALIBRATION_MM, computeCalibration } from '../src/utils/boardProjection';
import { classifyBoardColour } from '../src/utils/sectorPhase';
import { BOARD_MM } from '../src/utils/dartMath';
import { refineCalibrationOnRings } from '../src/utils/ringRefine';

const [bgrPath, metaPath, ctxPath] = process.argv.slice(2);
const [w, h, stride] = fs.readFileSync(metaPath, 'ascii').trim().split(' ').map(Number);
const bgr = fs.readFileSync(bgrPath);
const ctx = JSON.parse(fs.readFileSync(ctxPath, 'utf8'));

// Containern vid SPARANDET: aspect sparas, bredden är fönsterbredden.
const cw: number = ctx.inner[0];
const ch: number = cw / ctx.cal.aspect;
const vw: number = ctx.video.vw;
const vh: number = ctx.video.vh;
const scale = Math.max(cw / vw, ch / vh);
const offX = (cw - vw * scale) / 2;
const offY = (ch - vh * scale) / 2;
const imgPts = ctx.cal.points.map((p: { fx: number; fy: number }) => ({
  x: (p.fx * cw - offX) / scale,
  y: (p.fy * ch - offY) / scale,
}));
console.log('container vid sparande', cw.toFixed(0), 'x', ch.toFixed(0), ' punkter i video-px:', imgPts.map((p: any) => `${p.x.toFixed(0)},${p.y.toFixed(0)}`).join('  '));

const calib0 = computeCalibration([...CANONICAL_CALIBRATION_MM], imgPts, { refine: false });
if (!calib0) throw new Error('ingen kalibrering');
const sampler = (x: number, y: number) => rgbAt0(x, y);
const refine = process.argv.includes('--refine');
let calib = calib0;
if (refine) {
  const res = refineCalibrationOnRings(calib0, sampler);
  if (!res) throw new Error('finjustering misslyckades');
  console.log('finjustering:', res.samples, 'kantpar, residual', res.residualPx.toFixed(2), 'px, max', res.maxResidualPx.toFixed(2), 'px; före: dubbel', res.before.double.map((v) => v.toFixed(1)).join('/'), 'trippel', res.before.triple.map((v) => v.toFixed(1)).join('/'));
  calib = res.calib;
}
const bull = calib.project(0, 0);
console.log('bull i bild', bull.x.toFixed(1), bull.y.toFixed(1));

const rgbAt = (x: number, y: number): [number, number, number] | null => rgbAt0(x, y);
function rgbAt0(x: number, y: number): [number, number, number] | null {
  const xi = Math.round(x);
  const yi = Math.round(y);
  if (xi < 0 || yi < 0 || xi >= w || yi >= h) return null;
  const o = yi * stride + xi * 3;
  return [bgr[o + 2], bgr[o + 1], bgr[o]];
}
const polar = (r: number, a: number) => ({ x: r * Math.sin(a), y: -r * Math.cos(a) });
const isRing = (r: number, a: number): boolean => {
  const p = polar(r, a);
  const q = calib.project(p.x, p.y);
  const c = rgbAt(q.x, q.y);
  return !!c && classifyBoardColour(c) !== 'other';
};

/** Yttersta/innersta radie (mm) där färgen är röd/grön inom [lo, hi]. */
function ringEdges(a: number, lo: number, hi: number): { inner: number; outer: number } | null {
  let inner = NaN;
  let outer = NaN;
  for (let r = lo; r <= hi; r += 0.25) {
    if (isRing(r, a)) {
      if (Number.isNaN(inner)) inner = r;
      outer = r;
    }
  }
  if (Number.isNaN(inner)) return null;
  return { inner, outer };
}

const quadrants: Record<string, { dOut: number[]; dIn: number[]; tOut: number[]; tIn: number[] }> = {
  'topp (20)': { dOut: [], dIn: [], tOut: [], tIn: [] },
  'höger (6)': { dOut: [], dIn: [], tOut: [], tIn: [] },
  'botten (3)': { dOut: [], dIn: [], tOut: [], tIn: [] },
  'vänster (11)': { dOut: [], dIn: [], tOut: [], tIn: [] },
};
const quadOf = (deg: number) =>
  deg < 45 || deg >= 315 ? 'topp (20)' : deg < 135 ? 'höger (6)' : deg < 225 ? 'botten (3)' : 'vänster (11)';

let n = 0;
for (let deg = 0; deg < 360; deg += 1) {
  // Undvik trådarna: hoppa över ±2° runt sektorgränserna (9°, 27°, ...).
  const m = ((deg + 9) % 18);
  if (m < 2 || m > 16) continue;
  const a = (deg * Math.PI) / 180;
  const d = ringEdges(a, 150, 190);
  const t = ringEdges(a, 88, 118);
  const q = quadrants[quadOf(deg)];
  if (d && d.outer - d.inner > 3 && d.outer - d.inner < 16) {
    q.dOut.push(d.outer);
    q.dIn.push(d.inner);
    n++;
  }
  if (t && t.outer - t.inner > 3 && t.outer - t.inner < 16) {
    q.tOut.push(t.outer);
    q.tIn.push(t.inner);
  }
}
const med = (xs: number[]) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};
console.log(`\n${n} strålar med dubbelring hittad\n`);
console.log('kvadrant        dubbel ytter  (170)   dubbel inner (162)   trippel ytter (107)   trippel inner (99)');
for (const [name, q] of Object.entries(quadrants)) {
  const f = (xs: number[], ref: number) => {
    const m = med(xs);
    return Number.isNaN(m) ? '      -       ' : `${m.toFixed(1).padStart(6)} (${(m - ref >= 0 ? '+' : '') + (m - ref).toFixed(1)} mm)`;
  };
  console.log(
    `${name.padEnd(14)}  ${f(q.dOut, BOARD_MM.doubleOuter)}   ${f(q.dIn, BOARD_MM.doubleInner)}   ${f(q.tOut, BOARD_MM.tripleOuter)}   ${f(q.tIn, BOARD_MM.tripleInner)}`,
  );
}
