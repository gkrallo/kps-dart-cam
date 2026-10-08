/**
 * Hur många kast hade osäkerhetsflaggan (nearbyScores) markerat, och hur många
 * av de rättade fanns bland dem? Läser en localStorage-dump från telefonen
 * (en JSON-rad med alla nycklar, se tools/ev.mjs), t.ex.
 * capture/2026-10-06/localstorage-localhost.json.
 *
 *   npx vite-node scripts/boundary-analysis.ts <dump.json>
 *
 * Rättade kast tappar sin DetectionMeta i matchen, så de hämtas ur
 * rättningsloggen i stället; okorrigerade kast ur matchen.
 */
import fs from 'fs';
import { getScoreFromCanonicalCoordinates } from '../src/utils/dartMath';

const raw = fs.readFileSync(process.argv[2] ?? 'capture/2026-10-06/localstorage-localhost.json', 'utf8');
const ls = JSON.parse(raw.slice(raw.indexOf('{')));

/** Avstånd till närmaste gräns (mm) och fältet på andra sidan. */
function boundary(rMM: number, deg: number) {
  const rad = (deg * Math.PI) / 180;
  const X = rMM * Math.sin(rad);
  const Y = -rMM * Math.cos(rad);
  const base = getScoreFromCanonicalCoordinates(X, Y).label;
  for (let d = 0.05; d <= 3; d += 0.05) {
    for (let k = 0; k < 72; k++) {
      const a = (k / 72) * 2 * Math.PI;
      const l = getScoreFromCanonicalCoordinates(X + d * Math.cos(a), Y + d * Math.sin(a)).label;
      if (l !== base) return { d, alt: l };
    }
  }
  return { d: Infinity, alt: '' };
}

interface Row { seen: string; truth: string | null; d: number; alt: string }
const rows: Row[] = [];

const env = JSON.parse(ls['kps-dart-cam:match:v1']);
for (const a of env.match.actions) {
  if (a.t !== 'T' || !a.d) continue;
  rows.push({ seen: a.d.label, truth: null, ...boundary(a.d.rMM, a.d.deg) });
}
const corr = JSON.parse(ls['kps-dart-cam:corrections:v1'] ?? '[]');
for (const c of corr) {
  if ((c.kind !== 'edit' && c.kind !== 'confirm') || !c.detected) continue;
  // En bekräftelse är ett flaggat kast som var rätt: med i räkningen, men inte som rättning.
  if (c.kind === 'confirm') {
    rows.push({ seen: c.detected.label, truth: null, ...boundary(c.detected.rMM, c.detected.deg) });
    continue;
  }
  const to = c.to ?? c.corrected;
  rows.push({ seen: c.detected.label, truth: to ? JSON.stringify(to) : '?', ...boundary(c.detected.rMM, c.detected.deg) });
}

for (const r of rows.filter((r) => r.truth)) {
  console.log(`rättad: ${r.seen.padEnd(5)} -> ${r.truth}  gräns ${r.d === Infinity ? '-' : r.d.toFixed(2) + ' mm'}  granne ${r.alt}`);
}
const fixedTotal = rows.filter((r) => r.truth).length;
console.log(`\n${rows.length} avläsningar, ${fixedTotal} rättade`);
for (const m of [0.5, 0.75, 1, 1.25, 1.5, 2]) {
  const flagged = rows.filter((r) => r.d <= m);
  console.log(`marginal ${m} mm: flaggade ${flagged.length}, varav rättade ${flagged.filter((r) => r.truth).length}/${fixedTotal}`);
}
