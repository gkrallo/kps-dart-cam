/**
 * Strömmar detektorns `?debug`-loggar från telefonen till datorn.
 *
 *   node tools/det-stream.mjs            # tills du bryter med Ctrl+C
 *   node tools/det-stream.mjs 120000     # två minuter, sedan avslut
 *
 * Varje rad får en klocktid, och allt sparas samtidigt i
 * `capture/<datum>/det-log.txt`. Då behöver ingen kopiera loggrader för hand:
 * säg bara vad du gjorde, så finns raden redan här.
 *
 * Fallgrop som kostade tid förra gången: Chrome spelar upp hela sin
 * konsolbuffert (~1000 rader) när `Runtime.enable` slås på. Den floden ser ut
 * som realtid men är historik. Vi filtrerar på händelsens egen tidsstämpel i
 * stället för att blint vänta någon sekund.
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { connect, loadedBundle, main } from './cdp.mjs';
import { sessionDir } from './capture-dir.mjs';

const durationMs = Number(process.argv[2]) || 0;
const dir = sessionDir();
mkdirSync(dir, { recursive: true });
const logFile = `${dir}/det-log.txt`;

await main(async () => {
  const { session, target } = await connect();
  const bundle = await loadedBundle(session);
  const header = `\n=== ${new Date().toISOString()}  ${target.url}  ${bundle} ===`;
  console.log(header);
  console.log(`# loggas till ${logFile}`);
  appendFileSync(logFile, header + '\n');

  const debugOn = await session.evaluate('location.search.includes("debug")');
  if (!debugOn) {
    console.warn('VARNING: fliken kördes utan ?debug - detektorn loggar ingenting.');
    console.warn('         Lägg till ?debug i URL:en och ladda om (node tools/reload.mjs).');
  }

  const clock = (ts) =>
    new Date(ts).toLocaleTimeString('sv-SE', { hour12: false }) +
    '.' +
    String(Math.floor(ts % 1000)).padStart(3, '0');

  session.on((msg) => {
    if (msg.method !== 'Runtime.consoleAPICalled') return;
    const { args = [], timestamp } = msg.params;
    // Historik från konsolbufferten, inte något som händer nu.
    if (timestamp < session.connectedAt - 250) return;
    const text = args
      .map((a) => (a.value !== undefined ? a.value : (a.description ?? JSON.stringify(a.preview ?? {}))))
      .join(' ');
    if (!/^\[(det|analyse)\]/.test(text)) return;
    const line = `${clock(timestamp)}  ${text}`;
    console.log(line);
    appendFileSync(logFile, line + '\n');
  });

  await session.send('Runtime.enable');

  if (durationMs > 0) {
    setTimeout(() => {
      session.close();
      process.exit(0);
    }, durationMs);
  }
  process.on('SIGINT', () => {
    session.close();
    process.exit(0);
  });
});
