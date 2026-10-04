/**
 * Skriver ut detektorns `[analyse]`-rader ur Chromes konsolBUFFERT - alltså
 * historik, det som hände innan `det-stream.mjs` kopplades upp.
 *
 *   node tools/history.mjs            # bara [analyse] och CLEARED
 *   node tools/history.mjs all        # även [det]-heartbeaten
 *
 * Chrome spelar upp ~1000 buffrade rader när Runtime.enable slås på;
 * det-stream.mjs filtrerar bort dem med flit. Det här verktyget gör tvärtom,
 * för det fall någon kastade medan ingen lyssnade (hände 2026-10-04).
 */
import { connect, main } from './cdp.mjs';

const all = process.argv[2] === 'all';

await main(async () => {
  const { session } = await connect();
  const clock = (ts) =>
    new Date(ts).toLocaleTimeString('sv-SE', { hour12: false }) +
    '.' +
    String(Math.floor(ts % 1000)).padStart(3, '0');
  const lines = [];
  session.on((msg) => {
    if (msg.method !== 'Runtime.consoleAPICalled') return;
    const { args = [], timestamp } = msg.params;
    const text = args
      .map((a) => (a.value !== undefined ? a.value : (a.description ?? JSON.stringify(a.preview ?? {}))))
      .join(' ');
    if (!/^\[(det|analyse)\]/.test(text)) return;
    if (!all && !/^\[analyse\]|\[det\] CLEARED|baseline uppdaterad/.test(text)) return;
    lines.push(`${clock(timestamp)}  ${text}`);
  });
  await session.send('Runtime.enable');
  await new Promise((r) => setTimeout(r, 2500));
  for (const l of lines) console.log(l);
  console.log(`# ${lines.length} rader ur bufferten`);
  session.close();
  process.exit(0);
});
