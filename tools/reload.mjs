/**
 * Tar appens flik på telefonen till det senast publicerade bygget, och
 * rapporterar vilket bygge som faktiskt kom upp.
 *
 *   node tools/reload.mjs                 # ladda om som den är
 *   node tools/reload.mjs ?debug          # ladda om med parametrar
 *   node tools/reload.mjs "?debug&mask"
 *
 * Med service workern (sedan fas 0 av fjärrskärmen) räcker inte en vanlig
 * omladdning: sidan serveras ur cachen, och ett nytt bygge laddas ner i
 * bakgrunden men väntar bakom raden "Ny version finns – ladda om?" tills
 * någon trycker - på telefonen i stativet, alltså precis det vi vill slippa.
 * Därför gör skriptet samma sak som knappen, fast från datorn: be service
 * workern leta efter ny version, vänta tills den installerats (opencv.js är
 * 10 MB), skicka SKIP_WAITING (det meddelande vite-plugin-pwa:s genererade
 * sw.js lyssnar på), vänta på `controllerchange` och ladda om.
 *
 * Utan service worker (äldre bygge) görs en omladdning förbi cachen som förut.
 *
 * Att verifiera hashen är inte överdrivet noggrant: CDN:en ligger ibland
 * efter, och att testa mot ett gammalt bygge i tron att det är det nya har
 * hänt förut.
 */
import { connect, loadedBundle, main } from './cdp.mjs';

const search = process.argv[2];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Startar uppdateringen i sidan och lägger förloppet på window.__swUpdate.
 * Den pollas härifrån i stället för att awaitas i en enda evaluate: att
 * ladda ner opencv.js över wifi kan ta längre än CDP-anropets timeout.
 */
const START_UPDATE = `
(() => {
  const st = { phase: 'start', error: null };
  window.__swUpdate = st;
  (async () => {
    if (!('serviceWorker' in navigator)) { st.phase = 'no-sw'; return; }
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) { st.phase = 'no-sw'; return; }
    st.phase = 'checking';
    try { await reg.update(); } catch (e) { st.error = String(e); }
    // update() löser upp när sw.js hämtats; installationen (precachen) pågår
    // sedan i reg.installing tills den blir 'installed' och hamnar i waiting.
    const t0 = Date.now();
    while (reg.installing && Date.now() - t0 < 180000) {
      st.phase = 'installing';
      await new Promise((r) => setTimeout(r, 500));
    }
    if (!reg.waiting) { st.phase = 'current'; return; }
    st.phase = 'activating';
    const changed = new Promise((r) =>
      navigator.serviceWorker.addEventListener('controllerchange', r, { once: true }));
    reg.waiting.postMessage({ type: 'SKIP_WAITING' });
    await Promise.race([changed, new Promise((r) => setTimeout(r, 15000))]);
    st.phase = navigator.serviceWorker.controller ? 'activated' : 'activate-timeout';
  })().catch((e) => { st.phase = 'failed'; st.error = String(e); });
  return st.phase;
})()
`;

async function updateServiceWorker(session) {
  await session.evaluate(START_UPDATE);
  let last = null;
  for (let i = 0; i < 400; i++) {
    let st;
    try {
      st = await session.evaluate('window.__swUpdate');
    } catch {
      // Workbox-window laddar själv om sidan vid controllerchange - då
      // försvinner window.__swUpdate med dokumentet. Det är ett lyckat byte.
      return { phase: 'activated' };
    }
    if (!st) return { phase: 'activated' };
    if (st.phase !== last) {
      if (st.phase === 'installing') {
        console.log('       nytt bygge laddas ner till telefonen (opencv.js tar en stund)...');
      }
      last = st.phase;
    }
    if (['no-sw', 'current', 'activated', 'activate-timeout', 'failed'].includes(st.phase)) return st;
    await sleep(500);
  }
  return { phase: 'timeout' };
}

await main(async () => {
  const { session, target } = await connect();
  try {
    const before = await loadedBundle(session);
    console.log(`Före:  ${before}  ${target.url}`);
    await session.send('Page.enable');

    const sw = await updateServiceWorker(session);
    const hasSw = sw.phase !== 'no-sw';
    const swText =
      {
        'no-sw': 'ingen service worker - omladdning förbi cachen',
        current: 'service workern har redan senaste bygget',
        activated: 'nytt bygge installerat och aktiverat',
        'activate-timeout': 'nytt bygge installerat men tog inte över inom 15 s - laddar om ändå',
        failed: `uppdateringen misslyckades (${sw.error}) - laddar om ändå`,
        timeout: 'ingen uppdatering klar inom 3 min - laddar om ändå',
      }[sw.phase] ?? sw.phase;
    console.log(`SW:    ${swText}${sw.error && sw.phase !== 'failed' ? ` (${sw.error})` : ''}`);

    if (search) {
      const base = target.url.split('?')[0].split('#')[0];
      const url = base + (search.startsWith('?') ? search : `?${search}`);
      await session.send('Page.navigate', { url });
    } else {
      // ignoreCache är en "hård" omladdning, och den går FÖRBI service
      // workern - sidan blir då okontrollerad tills nästa omladdning. Med
      // service worker är cachen redan uppdaterad ovan, så en vanlig räcker.
      await session.send('Page.reload', { ignoreCache: !hasSw });
    }

    // Vänta tills sidan har ett bygge laddat igen. Telefonen behöver en stund:
    // opencv.js är 10 MB.
    let after = null;
    for (let i = 0; i < 40; i++) {
      await sleep(500);
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
    const version = await session.evaluate('window.__buildVersion ?? null').catch(() => null);
    if (version) console.log(`Build: ${version}`);
    const url = await session.evaluate('location.href');
    console.log(`URL:   ${url}`);
  } finally {
    session.close();
  }
});
