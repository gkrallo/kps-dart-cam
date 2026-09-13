/**
 * Steg 0 i TESTPLAN.md, automatiserat: är riggen redo att testa mot?
 *
 *   node tools/check.mjs
 *
 * Kontrollerar det som två separata timmar tidigare gått förlorade på att
 * felsöka i efterhand - att appen kör rätt bygge, att videon faktiskt rullar,
 * att bara en flik håller kameran, och att tavlan är stor nog i bild.
 */
import { connect, loadedBundle, adb, main } from './cdp.mjs';

const LIVE_URL = 'https://gkrallo.github.io/kps-dart-cam/';
const ok = (s) => `  OK    ${s}`;
const warn = (s) => `  OBS   ${s}`;
const bad = (s) => `  FEL   ${s}`;
const lines = [];
let problems = 0;
const say = (fn, s) => {
  if (fn === bad) problems++;
  lines.push(fn(s));
};

console.log('Kontrollerar riggen...\n');

// 1. Telefonen
try {
  const model = adb('shell', 'getprop', 'ro.product.model');
  say(ok, `telefon ansluten (${model})`);
} catch {
  console.log(bad('ingen telefon ansluten.'));
  console.log('        Kontrollera USB-felsökning på telefonen, och att du godkänt datorn.');
  console.log('        Trådlöst i stället: adb tcpip 5555 && adb connect <telefonens-ip>:5555');
  process.exit(1);
}

await main(async () => {
  const { session, target } = await connect();
  try {
    // 2. Bygget - jämfört med vad som faktiskt ligger publicerat
    const loaded = await loadedBundle(session);
    let deployed = null;
    try {
      const html = await fetch(LIVE_URL, { cache: 'no-store' }).then((r) => r.text());
      deployed = html.match(/index-[A-Za-z0-9_-]+\.js/)?.[0] ?? null;
    } catch {
      /* offline - hoppa över jämförelsen */
    }
    if (target.url.includes('localhost')) {
      say(warn, `kör lokalt bygge (${target.url}) - localStorage är TOMT här, ingen sparad kalibrering`);
    } else if (deployed && loaded !== deployed) {
      say(bad, `gammalt bygge laddat: ${loaded}, publicerat är ${deployed}\n        → node tools/reload.mjs "?debug"`);
    } else {
      say(ok, `bygge ${loaded}${deployed ? ' (= publicerat)' : ''}`);
    }

    // 3. ?debug
    const search = await session.evaluate('location.search');
    if (!search.includes('debug')) {
      say(bad, 'fliken kör UTAN ?debug - detektorn loggar ingenting\n        → node tools/reload.mjs "?debug"');
    } else {
      say(ok, `parametrar ${search}${search.includes('mask') ? '' : '  (lägg till &mask för maskbilder)'}`);
    }

    // 4. Videon - currentTime är det enda som avslöjar en frusen ström
    const v1 = await session.evaluate(`
      (() => {
        const v = document.querySelector('video');
        const t = v?.srcObject?.getVideoTracks?.()[0];
        return v ? { w: v.videoWidth, h: v.videoHeight, t: v.currentTime, paused: v.paused,
                     track: t?.readyState ?? null, zoom: t?.getSettings?.().zoom ?? null } : null;
      })()
    `);
    if (!v1) {
      say(bad, 'inget videoelement - är appen på kalibreringsvyn?');
    } else {
      await new Promise((r) => setTimeout(r, 800));
      const t2 = await session.evaluate("document.querySelector('video').currentTime");
      if (t2 > v1.t) {
        say(ok, `video ${v1.w}x${v1.h} rullar${v1.zoom ? `, zoom ${v1.zoom}x` : ''}`);
      } else {
        say(bad, `videon står still (currentTime ${v1.t} → ${t2}, paused=${v1.paused}, track=${v1.track})\n        → annan flik har tagit kameran, eller Android pausade vid appbyte`);
      }
    }

    // 5. Skalan: hur stor är tavlan i videopixlar? Vid 1x var den 365 px och
    // pilblobbarna låg precis på gränsen att sållas bort som för små.
    const scale = await session.evaluate(`
      (() => {
        const raw = localStorage.getItem('kps-dart-cam:calibration:v1');
        const v = document.querySelector('video');
        if (!raw || !v || !v.videoWidth) return null;
        const st = JSON.parse(raw);
        const cw = v.clientWidth, ch = v.clientHeight;
        const pts = st.points.map(p => ({ x: p.fx * cw, y: p.fy * ch }));
        // object-cover: skalad med max() och centrerad
        const s = Math.max(cw / v.videoWidth, ch / v.videoHeight);
        const d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) / s;
        // 20 <-> 3 och 6 <-> 11 spänner båda 340 mm över dubbelringen
        return { vert: d(pts[0], pts[2]), horiz: d(pts[1], pts[3]), zoom: st.zoom ?? null };
      })()
    `);
    if (!scale) {
      say(warn, 'ingen sparad kalibrering att mäta skalan på - kör kalibreringen först');
    } else {
      const pxPerMm = (scale.vert + scale.horiz) / 2 / 340;
      const width = pxPerMm * 340;
      if (pxPerMm < 1.8) {
        say(bad, `tavlan bara ${width | 0} px bred (${pxPerMm.toFixed(2)} px/mm) - zooma in, pilarna riskerar att sållas bort som för små`);
      } else {
        say(ok, `tavlan ${width | 0} px bred (${pxPerMm.toFixed(2)} px/mm)${scale.zoom ? `, sparad zoom ${scale.zoom}x` : ''}`);
      }
    }

    // 6. Vad står på skärmen just nu
    const screen = await session.evaluate(
      "document.body.innerText.replace(/\\n{2,}/g,'\\n').split('\\n').slice(0,6).join(' | ')",
    );
    lines.push(`\n  Skärmen: ${screen}`);
  } finally {
    session.close();
  }

  console.log(lines.join('\n'));
  console.log(
    problems === 0
      ? '\nRiggen är redo. Kör: node tools/det-stream.mjs\n'
      : `\n${problems} sak(er) måste åtgärdas innan det är någon idé att kasta.\n`,
  );
  process.exit(problems === 0 ? 0 : 1);
});
