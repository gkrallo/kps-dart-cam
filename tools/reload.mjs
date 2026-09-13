/**
 * Laddar om appens flik på telefonen utan cache, och rapporterar vilket bygge
 * som faktiskt kom upp.
 *
 *   node tools/reload.mjs                 # ladda om som den är
 *   node tools/reload.mjs ?debug          # ladda om med parametrar
 *   node tools/reload.mjs "?debug&mask"
 *
 * Att verifiera hashen är inte överdrivet noggrant: GitHub Pages CDN ligger
 * 1-2 minuter efter att Actions blivit klart, och att testa mot ett gammalt
 * bygge i tron att det är det nya har hänt förut.
 */
import { connect, loadedBundle, main } from './cdp.mjs';

const search = process.argv[2];

await main(async () => {
  const { session, target } = await connect();
  try {
    const before = await loadedBundle(session);
    console.log(`Före:  ${before}  ${target.url}`);

    if (search) {
      const base = target.url.split('?')[0].split('#')[0];
      const url = base + (search.startsWith('?') ? search : `?${search}`);
      await session.send('Page.enable');
      await session.send('Page.navigate', { url });
    } else {
      await session.send('Page.enable');
      await session.send('Page.reload', { ignoreCache: true });
    }

    // Vänta tills sidan har ett bygge laddat igen. Telefonen behöver en stund:
    // opencv.js är 10 MB.
    let after = null;
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 500));
      try {
        after = await loadedBundle(session);
        if (after && after !== 'okänt') break;
      } catch {
        /* sidan byter dokument mitt i - försök igen */
      }
    }
    console.log(`Efter: ${after ?? 'okänt'}`);
    if (after && before && after === before) {
      console.log('(samma hash - antingen inget nytt deployat, eller CDN ligger efter)');
    }
    const url = await session.evaluate('location.href');
    console.log(`URL:   ${url}`);
  } finally {
    session.close();
  }
});
