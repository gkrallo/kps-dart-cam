/**
 * Kör ett JS-uttryck i appens flik på telefonen och skriver ut resultatet.
 *
 *   node tools/ev.mjs "document.querySelector('video').videoWidth"
 *   node tools/ev.mjs "localStorage.getItem('kps-dart-cam:calibration:v1')"
 *
 * Oumbärlig för att läsa av läget utan att röra skärmen - och att inte röra
 * skärmen är hela poängen, för varje tryck är en chans att knuffa stativet.
 */
import { connect, loadedBundle, main } from './cdp.mjs';

const expr = process.argv.slice(2).join(' ');
if (!expr) {
  console.error('Användning: node tools/ev.mjs "<uttryck>"');
  process.exit(1);
}

await main(async () => {
  const { session, target } = await connect();
  try {
    if (process.env.QUIET !== '1') {
      console.error(`# ${target.url}  (${await loadedBundle(session)})`);
    }
    const value = await session.evaluate(expr);
    console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2));
  } finally {
    session.close();
  }
});
