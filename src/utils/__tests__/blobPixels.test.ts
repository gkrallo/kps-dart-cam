import { describe, it, expect } from 'vitest';
import { blobPixelStats } from '../blobPixels';

/**
 * Fyra fall som detektorn måste skilja åt, byggda i en liten konstgjord bild:
 * tom tavla = 100 överallt, pil = 30 (mörk). Masken är det som skiljer sig
 * mot förra bilden, precis som i appen.
 */
const W = 40;
const H = 20;
const EMPTY = 100;
const DART = 30;

function img(fill: (x: number, y: number) => number): Uint8Array {
  const a = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) a[y * W + x] = fill(x, y);
  return a;
}
const empty = img(() => EMPTY);
/** En "pil" som en rektangel x0..x1, rad 8..11. */
const dartAt = (x0: number, x1: number) => (x: number, y: number) => x >= x0 && x <= x1 && y >= 8 && y <= 11;
/** Mask = där cur skiljer sig från before. */
function maskOf(cur: Uint8Array, before: Uint8Array): Uint8Array {
  return cur.map((v, i) => (Math.abs(v - before[i]) > 10 ? 255 : 0));
}
const run = (cur: Uint8Array, before: Uint8Array | null, mask: Uint8Array) =>
  blobPixelStats({
    cols: W,
    rows: H,
    rect: { x: 0, y: 0, width: W, height: H },
    mask,
    cur,
    before,
    empty,
    threshold: 10,
    samples: 100000, // varje pixel
  });

describe('blobPixelStats', () => {
  it('ny pil på tom yta: material, inget före, inget lämnat', () => {
    const before = empty;
    const cur = img((x, y) => (dartAt(10, 20)(x, y) ? DART : EMPTY));
    const s = run(cur, before, maskOf(cur, before));
    expect(s.material).toBe(1);
    expect(s.prior).toBe(0);
    expect(s.vacated).toBe(0);
  });

  it('hål efter uttagen pil: inget material nu, allt fanns före och lämnades', () => {
    const before = img((x, y) => (dartAt(10, 20)(x, y) ? DART : EMPTY));
    const cur = empty;
    const s = run(cur, before, maskOf(cur, before));
    expect(s.material).toBe(0);
    expect(s.prior).toBe(1);
    expect(s.vacated).toBe(1);
  });

  it('pil som skakat 3 px åt sidan: mycket före, och något lämnades', () => {
    const before = img((x, y) => (dartAt(10, 20)(x, y) ? DART : EMPTY));
    const cur = img((x, y) => (dartAt(13, 23)(x, y) ? DART : EMPTY));
    const s = run(cur, before, maskOf(cur, before));
    // Masken är de två remsorna: 10-12 (lämnad) och 21-23 (ny).
    expect(s.prior).toBeCloseTo(0.5, 5);
    expect(s.vacated).toBeCloseTo(0.5, 5);
  });

  it('ny pil som landar över en gammal pils vinge: före hög men inget lämnat', () => {
    // Uppmätt fall 2026-10-05: två missar med vingarna över en registrerad
    // pils vinge fick 51-52 % "fanns före" och togs för vibration.
    const before = img((x, y) => (dartAt(10, 20)(x, y) ? DART : EMPTY));
    // Ny pil 15..30 ovanpå: där de överlappar blir det ännu mörkare (20).
    const cur = img((x, y) => (dartAt(15, 30)(x, y) ? (dartAt(10, 20)(x, y) ? 15 : DART) : dartAt(10, 20)(x, y) ? DART : EMPTY));
    const s = run(cur, before, maskOf(cur, before));
    expect(s.prior).toBeGreaterThan(0.3);
    expect(s.vacated).toBe(0);
    expect(s.material).toBe(1);
  });

  it('utan bild före (toppen ÄR tom tavla) blir före och lämnat noll', () => {
    const cur = img((x, y) => (dartAt(10, 20)(x, y) ? DART : EMPTY));
    const s = run(cur, null, maskOf(cur, empty));
    expect(s.prior).toBe(0);
    expect(s.vacated).toBe(0);
  });

  it('tom mask ger säkra standardvärden', () => {
    const s = run(empty, empty, new Uint8Array(W * H));
    expect(s).toEqual({ material: 1, prior: 0, vacated: 0, n: 0 });
  });
});
