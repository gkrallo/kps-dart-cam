/**
 * Felsökning av en enskild pil mot ett fotopar (tom tavla + pil), offline.
 *
 *   npx vite-node scripts/tip-profile.ts <tom.bgr> <pil.bgr> <meta> <cal-context.json> <rawX> <rawY>
 *
 * Kör appens råkedja (gråskala, 5x5-blur, absdiff, tröskel 10) kring den
 * punkt appen rapporterade som spets, plockar ut den sammanhängande blobben,
 * anpassar axeln med detectDartAxisTip och skriver ut gråvärdesprofilen längs
 * axeln vid spetsänden - i båda bilderna - så man ser om maskens ände är
 * pilen (gråvärdet styrs av pilen) eller pilens skugga (tavlans mönster
 * lyser igenom, bara mörkare). Spetsen räknas om till mm genom kalibreringen.
 */
import fs from 'node:fs';
import { CANONICAL_CALIBRATION_MM, computeCalibration } from '../src/utils/boardProjection';
import { detectDartAxisTip, trimShadowAtTip } from '../src/utils/dartTip';
import { classifyShadow } from '../src/utils/shadowTest';
import { getScoreFromCanonicalCoordinates } from '../src/utils/dartMath';

const [emptyPath, dartPath, metaPath, ctxPath, rxS, ryS, maskPath] = process.argv.slice(2);
const [w, h, stride] = fs.readFileSync(metaPath, 'ascii').trim().split(' ').map(Number);
const rx = Number(rxS);
const ry = Number(ryS);

const grey = (buf: Buffer): Float32Array => {
  const g = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const o = y * stride + x * 3;
      g[y * w + x] = 0.114 * buf[o] + 0.587 * buf[o + 1] + 0.299 * buf[o + 2];
    }
  return g;
};
const K = [0.0625, 0.25, 0.375, 0.25, 0.0625];
const blur = (g: Float32Array): Float32Array => {
  const t = new Float32Array(w * h);
  const o = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let k = -2; k <= 2; k++) s += K[k + 2] * g[y * w + Math.min(w - 1, Math.max(0, x + k))];
      t[y * w + x] = s;
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let k = -2; k <= 2; k++) s += K[k + 2] * t[Math.min(h - 1, Math.max(0, y + k)) * w + x];
      o[y * w + x] = Math.round(s);
    }
  return o;
};
const empty = blur(grey(fs.readFileSync(emptyPath)));
const cur = blur(grey(fs.readFileSync(dartPath)));

// Mask + komponenten närmast den rapporterade spetsen
const mask = new Uint8Array(w * h);
if (maskPath) {
  // Appens egen maskbild (grab.mjs: mask.png avkodad till BGR, samma stride som bilden)
  const mb = fs.readFileSync(maskPath);
  const mstride = Number(fs.readFileSync(maskPath.replace(/.bgr$/, '.meta'), 'ascii').trim().split(' ')[2]);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mb[y * mstride + x * 3] > 127) mask[y * w + x] = 1;
  console.log('använder appens mask');
} else {
  for (let i = 0; i < w * h; i++) if (Math.abs(cur[i] - empty[i]) > 10) mask[i] = 1;
}
const lab = new Int32Array(w * h);
let best: { id: number; size: number; pts: number[] } | null = null;
let id = 0;
for (let sy = Math.max(0, ry - 60); sy < Math.min(h, ry + 60); sy++)
  for (let sx = Math.max(0, rx - 60); sx < Math.min(w, rx + 60); sx++) {
    const s0 = sy * w + sx;
    if (!mask[s0] || lab[s0]) continue;
    id++;
    const pts: number[] = [];
    const stack = [s0];
    lab[s0] = id;
    while (stack.length) {
      const p = stack.pop()!;
      pts.push(p);
      const px = p % w;
      for (const q of [p - 1, p + 1, p - w, p + w]) {
        if (q < 0 || q >= w * h || Math.abs((q % w) - px) > 1) continue;
        if (mask[q] && !lab[q]) {
          lab[q] = id;
          stack.push(q);
        }
      }
    }
    if (!best || pts.length > best.size) best = { id, size: pts.length, pts };
  }
if (!best) throw new Error('ingen blobb nära punkten');
// Konturpunkter = maskpixlar med minst en granne utanför
const contour = best.pts
  .filter((p) => [p - 1, p + 1, p - w, p + w].some((q) => q < 0 || q >= w * h || lab[q] !== best!.id))
  .map((p) => ({ x: p % w, y: Math.floor(p / w) }));
console.log(`blobb: ${best.size} px, ${contour.length} konturpunkter`);

const axis = detectDartAxisTip(contour, { minElongation: 2 })!;
console.log(
  `axel: conf ${axis.confidence.toFixed(2)} elong ${axis.elongation.toFixed(1)} spets ${axis.tip.x.toFixed(0)},${axis.tip.y.toFixed(0)} fena ${axis.tail.x.toFixed(0)},${axis.tail.y.toFixed(0)}`,
);

// Kalibrering (samma som appen: object-cover vid sparandet)
const ctx = JSON.parse(fs.readFileSync(ctxPath, 'utf8'));
const cw: number = ctx.inner[0];
const ch: number = cw / ctx.cal.aspect;
const scale = Math.max(cw / ctx.video.vw, ch / ctx.video.vh);
const offX = (cw - ctx.video.vw * scale) / 2;
const offY = (ch - ctx.video.vh * scale) / 2;
const imgPts = ctx.cal.points.map((p: { fx: number; fy: number }) => ({ x: (p.fx * cw - offX) / scale, y: (p.fy * ch - offY) / scale }));
const calib = computeCalibration([...CANONICAL_CALIBRATION_MM], imgPts, { refine: false })!;
const toMM = (p: { x: number; y: number }) => {
  const b = calib.unproject(p.x, p.y);
  const s = getScoreFromCanonicalCoordinates(b.x, b.y);
  const r = Math.hypot(b.x, b.y);
  const deg = ((Math.atan2(b.x, -b.y) * 180) / Math.PI + 360) % 360;
  return `${s.label} @ ${r.toFixed(1)} mm / ${deg.toFixed(1)}°`;
};
console.log('spets enligt axeln:', toMM(axis.tip), '   rapporterad av appen:', toMM({ x: rx, y: ry }));

{
  // Trimning av skuggan vid spetsen, utgående från APPENS spets (maskens ände)
  const appTip = { x: rx, y: ry };
  const sampleGrey = (x: number, y: number) => {
    const xi = Math.round(x);
    const yi = Math.round(y);
    if (xi < 1 || yi < 1 || xi >= w - 1 || yi >= h - 1) return null;
    // medel över 3 px tvärs axeln
    const px = -axis.axis.y;
    const py = axis.axis.x;
    let c = 0;
    let e = 0;
    for (const k of [-1, 0, 1]) {
      const i = Math.round(yi + py * k) * w + Math.round(xi + px * k);
      c += cur[i];
      e += empty[i];
    }
    return { cur: c / 3, ref: e / 3 };
  };
  const t = trimShadowAtTip(appTip, axis.axis, sampleGrey);
  console.log(`trimning: ${t.trimmedPx} px -> ${toMM(t.tip)}`);
}
// Profil längs axeln: från 12 px bakom spetsen (in i pilen) till 16 px bortom
const ax = axis.axis; // pekar från fena mot spets
console.log('\n  s(px)   cur  empty  diff  i mask   mm-position');
for (let s = -12; s <= 16; s += 2) {
  const x = Math.round(axis.tip.x + ax.x * s);
  const y = Math.round(axis.tip.y + ax.y * s);
  const i = y * w + x;
  const c = cur[i];
  const e = empty[i];
  console.log(
    `  ${String(s).padStart(4)}   ${String(Math.round(c)).padStart(3)}   ${String(Math.round(e)).padStart(3)}   ${String(Math.round(c - e)).padStart(4)}   ${mask[i] ? ' ja ' : ' -  '}    ${toMM({ x, y })}`,
  );
}

// Skuggtest på de sista 6 mm (≈14 px) av blobben vid spetsänden
const tipSamples: { cur: number; base: number }[] = [];
for (const p of best.pts) {
  const px = p % w;
  const py = Math.floor(p / w);
  const along = (px - axis.tip.x) * ax.x + (py - axis.tip.y) * ax.y; // negativt = bakåt in i pilen
  if (along > -14 && along <= 0) tipSamples.push({ cur: cur[p], base: empty[p] });
}
console.log('\nskuggtest på spetsändens sista 14 px:', JSON.stringify(classifyShadow(tipSamples)));
