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
 *   analys-N/   (med ?debug) indata till de tre senaste analyserna:
 *               cur/top/empty.gray (rå w*h byte, redan blurrad gråskala -
 *               exakt det absdiff fick), samma som PNG, och info.json med
 *               analysraden och de registrerade spetsarna. Gör ett felfall
 *               körbart offline utan att man hann ta ett "tom tavla"-foto.
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
import { deflateSync } from 'node:zlib';
import { connect, loadedBundle, main } from './cdp.mjs';
import { sessionDir } from './capture-dir.mjs';

const label = (process.argv.slice(2).join('-') || 'grab')
  .replace(/[^A-Za-z0-9åäöÅÄÖ_-]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .toLowerCase();

/** Minimal PNG-kodare för en 8-bitars gråskalebild (repot har inga bildberoenden). */
function grayPng(gray, w, h) {
  const raw = Buffer.alloc((w + 1) * h);
  for (let y = 0; y < h; y++) gray.copy(raw, y * (w + 1) + 1, y * w, (y + 1) * w);
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bitdjup
  ihdr[9] = 0; // gråskala
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

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

    // Detektorns indata för de senaste analyserna (bara med ?debug): rå
    // gråskala NU, toppen av stacken och tom tavla - exakt det absdiff fick.
    // Utan dem går ett felfall inte att köra om; bildrutan visar bara läget
    // efteråt. Sparas som rå .gray (w*h byte) + en PNG att titta på.
    // Hämtas i bitar om 512 kB: allt i ett anrop (~25 MB base64) gick inte
    // igenom inom CDP:s tidsgräns 2026-10-08. Ringen fryses först, så att en
    // ny analys mitt i hämtningen inte blandar ihop bilderna.
    const analyses = await session.evaluate(`
      (() => {
        window.__grabRing = (window.__analysisFrames ?? []).slice();
        return window.__grabRing.map((r) => ({ at: r.at, w: r.w, h: r.h, line: r.line, tips: r.tips }));
      })()
    `);
    const CHUNK = 512 * 1024;
    const fetchImage = async (i, k) => {
      const parts = [];
      for (let off = 0; ; off += CHUNK) {
        const b64 = await session.evaluate(`
          (() => {
            const u8 = window.__grabRing[${i}].${k}.subarray(${off}, ${off + CHUNK});
            if (u8.length === 0) return null;
            let s = '';
            for (let j = 0; j < u8.length; j += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(j, j + 0x8000));
            return btoa(s);
          })()
        `);
        if (!b64) break;
        parts.push(Buffer.from(b64, 'base64'));
      }
      return Buffer.concat(parts);
    };
    let analysisCount = 0;
    // Senaste analysen först: det är nästan alltid den som gick fel.
    for (const [i, a] of [...(analyses ?? []).entries()].reverse()) {
      const sub = `${dir}/analys-${i + 1}`;
      mkdirSync(sub, { recursive: true });
      for (const k of ['cur', 'top', 'empty']) {
        const buf = await fetchImage(i, k);
        writeFileSync(`${sub}/${k}.gray`, buf);
        writeFileSync(`${sub}/${k}.png`, grayPng(buf, a.w, a.h));
      }
      writeFileSync(`${sub}/info.json`, JSON.stringify({ at: a.at, w: a.w, h: a.h, line: a.line, tips: a.tips }, null, 2));
      analysisCount++;
    }

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
    console.log(`  analyser   ${analysisCount ? `${analysisCount} med indata (analys-N/)` : 'inga (kräver ?debug och ett bygge från 2026-10-07)'}`);
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
