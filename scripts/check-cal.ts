/**
 * Kontrollerar en sparad kalibrering mot en riktig bildruta: rotation (ur
 * röd/grön-fasen) och var en given rå pixel hamnar på tavlan.
 *
 *   npx vite-node scripts/check-cal.ts <bild.bgr> <bild.meta> <cal-context.json> [rawX rawY]
 */
import fs from 'node:fs';
import { CANONICAL_CALIBRATION_MM, computeCalibration } from '../src/utils/boardProjection';
import { estimateSectorRotation } from '../src/utils/sectorPhase';
import { getScoreFromCanonicalCoordinates } from '../src/utils/dartMath';

const [bgrPath, metaPath, ctxPath, rxS, ryS] = process.argv.slice(2);
const [w, h, stride] = fs.readFileSync(metaPath, 'ascii').trim().split(' ').map(Number);
const bgr = fs.readFileSync(bgrPath);
const ctx = JSON.parse(fs.readFileSync(ctxPath, 'utf8'));

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
console.log('container', cw.toFixed(1), 'x', ch.toFixed(1), ' punkter (video-px):', imgPts.map((p: any) => `${p.x.toFixed(0)},${p.y.toFixed(0)}`).join('  '));
const calib = computeCalibration([...CANONICAL_CALIBRATION_MM], imgPts, { refine: false })!;

const sample = (x: number, y: number): [number, number, number] | null => {
  const xi = Math.round(x);
  const yi = Math.round(y);
  if (xi < 0 || yi < 0 || xi >= w || yi >= h) return null;
  const o = yi * stride + xi * 3;
  return [bgr[o + 2], bgr[o + 1], bgr[o]];
};
const rot = estimateSectorRotation(calib, sample);
console.log('sektorrotation:', rot ? `${((rot.offsetRad * 180) / Math.PI).toFixed(2)}° (konfidens ${rot.confidence.toFixed(2)}, ${rot.votes} röster)` : 'kunde inte läsas');

if (rxS) {
  const b = calib.unproject(Number(rxS), Number(ryS));
  const s = getScoreFromCanonicalCoordinates(b.x, b.y);
  const r = Math.hypot(b.x, b.y);
  const deg = ((Math.atan2(b.x, -b.y) * 180) / Math.PI + 360) % 360;
  console.log(`rå ${rxS},${ryS} -> ${s.label} @ ${r.toFixed(1)} mm / ${deg.toFixed(1)}°`);
}
// Var mitten av T15 (103 mm, 135°) hamnar i bilden
const a = (135 * Math.PI) / 180;
const p = calib.project(103 * Math.sin(a), -103 * Math.cos(a));
console.log(`mitt i T15 (103 mm/135°) projiceras till rå ${p.x.toFixed(0)},${p.y.toFixed(0)}`);
const bull = calib.project(0, 0);
console.log(`bull projiceras till rå ${bull.x.toFixed(0)},${bull.y.toFixed(0)}`);

// Färgerna längs trippelringen (103 mm) genom kalibreringen, 90-180°
import { classifyBoardColour } from '../src/utils/sectorPhase';
let line = '';
for (let d = 90; d <= 180; d += 1) {
  const aa = (d * Math.PI) / 180;
  const q = calib.project(103 * Math.sin(aa), -103 * Math.cos(aa));
  const c = sample(q.x, q.y);
  const k = c ? classifyBoardColour(c) : 'other';
  line += k === 'red' ? 'R' : k === 'green' ? 'G' : '.';
}
console.log('trippel 103 mm, 90..180°:');
console.log(line);
console.log('|90       |100      |110      |120      |130      |140      |150      |160      |170      |180');
