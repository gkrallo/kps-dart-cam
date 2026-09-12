import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  clearCalibration,
  fromStored,
  loadCalibration,
  rotateCalibrationToAnchor,
  saveCalibration,
  toStored,
} from '../calibration';
import type { Point } from '../../types';

class FakeStorage {
  private m = new Map<string, string>();
  get length() {
    return this.m.size;
  }
  clear() {
    this.m.clear();
  }
  getItem(k: string) {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null;
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v));
  }
}

const QUAD: Point[] = [
  { x: 200, y: 40 }, // topp
  { x: 380, y: 200 }, // höger
  { x: 200, y: 360 }, // botten
  { x: 20, y: 200 }, // vänster
];
const CONTAINER = { width: 400, height: 400 };

describe('toStored / fromStored', () => {
  it('går fram och tillbaka', () => {
    const stored = toStored(QUAD, CONTAINER)!;
    const back = fromStored(stored, CONTAINER)!;
    for (let i = 0; i < 4; i++) {
      expect(back[i].x).toBeCloseTo(QUAD[i].x, 6);
      expect(back[i].y).toBeCloseTo(QUAD[i].y, 6);
    }
  });

  it('skalar om till en annan containerstorlek', () => {
    const stored = toStored(QUAD, CONTAINER)!;
    const back = fromStored(stored, { width: 800, height: 800 })!;
    expect(back[0].x).toBeCloseTo(400, 6);
    expect(back[1].x).toBeCloseTo(760, 6);
  });

  it('sparar bildförhållandet', () => {
    expect(toStored(QUAD, { width: 1920, height: 1080 })!.aspect).toBeCloseTo(16 / 9, 6);
  });

  it('sparar zoomen punkterna mättes vid', () => {
    // Utan zoomen blir en återställd kalibrering tyst helt fel: punkterna
    // mättes inzoomat men kameran startar på 1x. Se StoredCalibration.zoom.
    expect(toStored(QUAD, CONTAINER, 2.07)!.zoom).toBeCloseTo(2.07, 6);
    // Utan angiven zoom ska fältet inte finnas alls, så gamla sparade
    // kalibreringar går att skilja från "sparad vid 1x".
    expect('zoom' in toStored(QUAD, CONTAINER)!).toBe(false);
  });

  it('returnerar null för fel antal punkter eller tom container', () => {
    expect(toStored(QUAD.slice(0, 3), CONTAINER)).toBeNull();
    expect(toStored(QUAD, { width: 0, height: 400 })).toBeNull();
  });
});

describe('saveCalibration / loadCalibration / clearCalibration', () => {
  beforeEach(() => {
    (globalThis as unknown as { localStorage: Storage }).localStorage = new FakeStorage() as unknown as Storage;
  });
  afterEach(() => {
    delete (globalThis as unknown as { localStorage?: Storage }).localStorage;
  });

  it('sparar och läser tillbaka', () => {
    saveCalibration(QUAD, CONTAINER);
    const loaded = loadCalibration()!;
    expect(loaded.points).toHaveLength(4);
    const back = fromStored(loaded, CONTAINER)!;
    expect(back[2].y).toBeCloseTo(360, 6);
  });

  it('clear tar bort den', () => {
    saveCalibration(QUAD, CONTAINER);
    clearCalibration();
    expect(loadCalibration()).toBeNull();
  });

  it('tål trasig JSON i lagringen', () => {
    (globalThis as unknown as { localStorage: Storage }).localStorage.setItem(
      'kps-dart-cam:calibration:v1',
      '{ inte json',
    );
    expect(loadCalibration()).toBeNull();
  });

  it('är tyst när localStorage saknas', () => {
    delete (globalThis as unknown as { localStorage?: Storage }).localStorage;
    expect(() => saveCalibration(QUAD, CONTAINER)).not.toThrow();
    expect(loadCalibration()).toBeNull();
  });
});

describe('rotateCalibrationToAnchor', () => {
  // QUAD: index 0 topp, 1 höger, 2 botten, 3 vänster. Mitten ~ (200, 200).
  it('lämnar ordningen om man pekar uppåt (20 redan i toppen)', () => {
    expect(rotateCalibrationToAnchor(QUAD, { x: 200, y: 0 })).toBe(QUAD);
  });

  it('flyttar högerpunkten först om man pekar åt höger', () => {
    const r = rotateCalibrationToAnchor(QUAD, { x: 390, y: 205 });
    expect(r[0]).toEqual(QUAD[1]); // höger blir "Topp (20)"
    expect(r[1]).toEqual(QUAD[2]);
    expect(r[2]).toEqual(QUAD[3]);
    expect(r[3]).toEqual(QUAD[0]);
  });

  it('snäpper till närmaste 90 grader vid ett grovt tryck', () => {
    // Grovt nedåt-vänster, men närmast botten.
    const r = rotateCalibrationToAnchor(QUAD, { x: 170, y: 350 });
    expect(r[0]).toEqual(QUAD[2]);
  });

  it('hanterar en snett sedd (osymmetrisk) fyrhörning', () => {
    const skew: Point[] = [
      { x: 210, y: 60 },
      { x: 360, y: 190 },
      { x: 220, y: 330 },
      { x: 40, y: 210 },
    ];
    const r = rotateCalibrationToAnchor(skew, { x: 40, y: 210 });
    expect(r[0]).toEqual(skew[3]);
  });
});
