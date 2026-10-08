/**
 * Beskär en sparad analys (tools/grab.mjs, analys-N/) kring en punkt och
 * lägger fyra rutor sida vid sida: tom tavla | toppen av stacken | nu |
 * |nu - toppen| x4. För att se med egna ögon vad detektorn jämförde.
 *
 *   node scripts/crop-analysis.mjs <analys-katalog> <x> <y> [halvbredd=200] [ut.png]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const [dir, xs, ys, hs = '200', out = `${dir}/crop.png`] = process.argv.slice(2);
const info = JSON.parse(readFileSync(`${dir}/info.json`, 'utf8'));
const { w, h } = info;
const cx = Number(xs);
const cy = Number(ys);
const r = Number(hs);
const load = (k) => readFileSync(`${dir}/${k}.gray`);
const empty = load('empty');
const top = load('top');
const cur = load('cur');

const side = 2 * r;
const panels = 4;
const img = Buffer.alloc(side * panels * side);
for (let y = 0; y < side; y++) {
  for (let x = 0; x < side; x++) {
    const sx = Math.min(w - 1, Math.max(0, cx - r + x));
    const sy = Math.min(h - 1, Math.max(0, cy - r + y));
    const i = sy * w + sx;
    const row = y * side * panels;
    img[row + x] = empty[i];
    img[row + side + x] = top[i];
    img[row + 2 * side + x] = cur[i];
    img[row + 3 * side + x] = Math.min(255, Math.abs(cur[i] - top[i]) * 4);
  }
}
// Markera punkten med ett litet kors i alla rutor.
for (let p = 0; p < panels; p++) {
  for (let d = -6; d <= 6; d++) {
    img[r * side * panels + p * side + r + d] = 255;
    img[(r + d) * side * panels + p * side + r] = 255;
  }
}

function grayPng(gray, pw, ph) {
  const raw = Buffer.alloc((pw + 1) * ph);
  for (let y = 0; y < ph; y++) gray.copy(raw, y * (pw + 1) + 1, y * pw, (y + 1) * pw);
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
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
  ihdr.writeUInt32BE(pw, 0);
  ihdr.writeUInt32BE(ph, 4);
  ihdr[8] = 8;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

writeFileSync(out, grayPng(img, side * panels, side));
console.log(`${out}: ${info.line.slice(0, 160)}`);
