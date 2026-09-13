/**
 * Fångar ett komplett underlag för analys, utan att röra telefonen.
 *
 *   node tools/grab.mjs tom-tavla
 *   node tools/grab.mjs "pil-i-20-las-som-18"
 *
 * Sparar i `capture/<datum>/<NN>-<etikett>/`:
 *   frame.jpg   videobildrutan som appen just nu ser (samma kamera, samma zoom)
 *   mask.png    tröskelmasken, om fliken kördes med ?debug&mask
 *   state.json  bygge, videoläge, kalibrering, matchläge, detektorns status
 *
 * Poängen: bilderna behöver aldrig gå via mobilens galleri. `frame.jpg` är
 * exakt vad appen matar in i sin egen kedja, i samma format som fixturerna
 * under `src/utils/__tests__/fixtures/` (JPEG 0,92) - så ett intressant fall
 * kan flyttas rakt in som testfixtur efteråt.
 *
 * Den viktigaste enskilda användningen är FOTOPARET: kör en gång med tom
 * tavla, och en gång med felfallet, UTAN att flytta stativet emellan. Då går
 * hela diffkedjan att köra om offline, vilket är precis vad som gjorde att en
 * hel dags arbete kunde göras utan tavla.
 */
import { mkdirSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { connect, loadedBundle, main } from './cdp.mjs';
import { sessionDir } from './capture-dir.mjs';

const label = (process.argv.slice(2).join('-') || 'grab')
  .replace(/[^A-Za-z0-9åäöÅÄÖ_-]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .toLowerCase();

const day = sessionDir();
mkdirSync(day, { recursive: true });
const seq = String(
  readdirSync(day, { withFileTypes: true }).filter((e) => e.isDirectory()).length + 1,
).padStart(2, '0');
const dir = `${day}/${seq}-${label}`;
mkdirSync(dir, { recursive: true });

await main(async () => {
  const { session, target } = await connect();
  try {
    const bundle = await loadedBundle(session);

    // Videobildrutan. Ritas i sidan, för kameraströmmen finns bara där.
    const frame = await session.evaluate(`
      (() => {
        const v = document.querySelector('video');
        if (!v || !v.videoWidth) return null;
        const c = document.createElement('canvas');
        c.width = v.videoWidth; c.height = v.videoHeight;
        c.getContext('2d').drawImage(v, 0, 0);
        return c.toDataURL('image/jpeg', 0.92);
      })()
    `);
    if (frame) {
      writeFileSync(`${dir}/frame.jpg`, Buffer.from(frame.split(',')[1], 'base64'));
    } else {
      console.warn('VARNING: ingen videobildruta. Är kameran igång i just den här fliken?');
    }

    const mask = await session.evaluate('window.__lastMask ?? null');
    if (mask) writeFileSync(`${dir}/mask.png`, Buffer.from(mask.split(',')[1], 'base64'));

    const state = await session.evaluate(`
      (() => {
        const v = document.querySelector('video');
        const track = v?.srcObject?.getVideoTracks?.()[0];
        const ls = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
        return {
          url: location.href,
          time: new Date().toISOString(),
          video: v ? {
            videoWidth: v.videoWidth, videoHeight: v.videoHeight,
            currentTime: v.currentTime, paused: v.paused, readyState: v.readyState,
          } : null,
          track: track ? { readyState: track.readyState, settings: track.getSettings() } : null,
          maskAt: window.__lastMaskAt ?? null,
          calibration: ls('kps-dart-cam:calibration:v1'),
          match: ls('kps-dart-cam:match:v1'),
          screen: document.body.innerText.replace(/\\n{2,}/g, '\\n').slice(0, 1200),
        };
      })()
    `);
    state.bundle = bundle;
    state.label = label;
    writeFileSync(`${dir}/state.json`, JSON.stringify(state, null, 2));

    // `currentTime` mot en andra avläsning är det ENDA pålitliga sättet att se
    // att videon lever. Debug-panelens siffror fryser på sina sista värden när
    // Android pausat strömmen, och en frusen bild ser precis ut som en lugn tavla.
    const t1 = state.video?.currentTime ?? 0;
    await new Promise((r) => setTimeout(r, 600));
    const t2 = await session.evaluate("document.querySelector('video')?.currentTime ?? 0");
    const live = t2 > t1;

    console.log(`Sparat i ${dir}`);
    console.log(`  bygge      ${bundle}`);
    console.log(`  video      ${state.video ? `${state.video.videoWidth}x${state.video.videoHeight}` : '-'}` +
      `  ${live ? 'rullar' : 'RULLAR INTE (frusen bildruta!)'}`);
    console.log(`  mask       ${mask ? 'ja' : 'nej (kör med ?debug&mask för att få den)'}`);
    console.log(`  kalibrering ${state.calibration ? 'sparad' : 'saknas'}`);
    if (!live) {
      console.log('\n  Videon står still. Vanligaste orsaken: en annan Chrome-flik');
      console.log('  har tagit kameran, eller Android pausade strömmen vid appbyte.');
    }
    if (existsSync(`${dir}/frame.jpg`)) {
      console.log(`\n  Bli fixtur? Flytta frame.jpg till src/utils/__tests__/fixtures/`);
    }
  } finally {
    session.close();
  }
});
