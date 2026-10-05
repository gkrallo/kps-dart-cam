/**
 * Hämtar rättningsloggen från telefonen och sparar den i capture/<datum>/.
 *
 *   node tools/corrections.mjs          # hämta och sammanfatta
 *   node tools/corrections.mjs clear    # hämta, spara, och töm loggen på telefonen
 *
 * Loggen skrivs av appen varje gång ett avläst kast rättas, tas bort eller
 * läggs till för hand (src/utils/correctionLog.ts). Varje rad är ett färdigt
 * etiketterat testfall: vad detektorn såg, och vad det borde ha varit.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { connect, main } from './cdp.mjs';
import { sessionDir } from './capture-dir.mjs';

const KEY = 'kps-dart-cam:corrections:v1';
const clear = process.argv[2] === 'clear';

const segLabel = (s) =>
  !s ? '-' : s.v === 0 ? 'MISS' : s.v === 25 ? (s.m === 2 ? 'DB' : '25') : `${['', 'S', 'D', 'T'][s.m]}${s.v}`;

await main(async () => {
  const { session } = await connect();
  const raw = await session.evaluate(`localStorage.getItem(${JSON.stringify(KEY)})`);
  const entries = raw ? JSON.parse(raw) : [];
  const dir = sessionDir();
  mkdirSync(dir, { recursive: true });
  const file = `${dir}/corrections-${Date.now()}.json`;
  writeFileSync(file, JSON.stringify(entries, null, 2));

  console.log(`${entries.length} rättningar sparade i ${file}\n`);
  const byKind = {};
  for (const e of entries) byKind[e.kind] = (byKind[e.kind] ?? 0) + 1;
  console.log('per typ:', JSON.stringify(byKind));
  for (const e of entries.slice(-20)) {
    const t = new Date(e.at).toLocaleString('sv-SE');
    const d = e.detected ? `${e.detected.label} @ ${e.detected.rMM} mm / ${e.detected.deg}°` : 'ej avläst';
    console.log(`${t}  ${e.kind.padEnd(6)} ${e.source.padEnd(6)} såg ${d.padEnd(28)} ${segLabel(e.from)} -> ${segLabel(e.to)}`);
  }

  if (clear) {
    await session.evaluate(`localStorage.removeItem(${JSON.stringify(KEY)})`);
    console.log('\nloggen tömd på telefonen');
  }
  session.close();
  process.exit(0);
});
