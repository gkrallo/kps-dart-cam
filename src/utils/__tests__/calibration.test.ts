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
import { CANONICAL_CALIBRATION_MM, computeCalibration } from '../boardProjection';

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
  const SKEW: Point[] = [
    { x: 210, y: 60 },
    { x: 360, y: 190 },
    { x: 220, y: 330 },
    { x: 40, y: 210 },
  ];

  /** Vilken riktning på TAVLAN pekar en bildpunkt ut, givet kalibreringen? */
  const boardAngleOf = (pts: Point[], tap: Point): number => {
    const calib = computeCalibration([...CANONICAL_CALIBRATION_MM], pts)!;
    const b = calib.unproject(tap.x, tap.y);
    return ((Math.atan2(b.x, -b.y) * 180) / Math.PI + 360) % 360;
  };

  const near = (a: Point, b: Point) => {
    expect(a.x).toBeCloseTo(b.x, 4);
    expect(a.y).toBeCloseTo(b.y, 4);
  };

  it('pekar man rakt upp ändras ingenting (20:an satt redan rätt)', () => {
    const r = rotateCalibrationToAnchor(QUAD, { x: 200, y: 0 });
    r.forEach((p, i) => near(p, QUAD[i]));
  });

  it('pekar man åt höger vrids hjulet ett kvarts varv', () => {
    const r = rotateCalibrationToAnchor(QUAD, { x: 390, y: 200 });
    near(r[0], QUAD[1]); // höger blir "Topp (20)"
    near(r[1], QUAD[2]);
    near(r[2], QUAD[3]);
    near(r[3], QUAD[0]);
  });

  it('vrider till en GODTYCKLIG vinkel, inte bara kvartssteg', () => {
    // Det här är hela poängen med omskrivningen: ellipsmetoden lägger
    // punkterna vid ellipsens extrempunkter, och sitter tavlan några grader
    // snett måste hjulet kunna vridas just de graderna.
    const tap = { x: 240, y: 25 }; // en bit höger om toppen
    const before = boardAngleOf(QUAD, tap);
    expect(before).toBeGreaterThan(5); // 20:an låg inte där förut
    expect(before).toBeLessThan(40);

    const r = rotateCalibrationToAnchor(QUAD, tap);
    // Efter vridningen SKA den riktningen vara 20:ans riktning, dvs 0 grader.
    expect(boardAngleOf(r, tap)).toBeCloseTo(0, 3);
  });

  it('bara riktningen spelar roll, inte hur långt ut man trycker', () => {
    // Båda längs riktningen (1,-2) från mitten (200,200), på olika avstånd.
    const nearCentre = rotateCalibrationToAnchor(QUAD, { x: 230, y: 140 });
    const farOut = rotateCalibrationToAnchor(QUAD, { x: 260, y: 80 });
    nearCentre.forEach((p, i) => near(p, farOut[i]));
  });

  it('vrider i TAVLANS plan även när tavlan ses snett', () => {
    // Under perspektiv är en vridning på tavlan ingen vridning i bilden.
    // Ett kvarts varv måste ändå landa exakt på nästa kalibreringspunkt.
    const r = rotateCalibrationToAnchor(SKEW, { x: SKEW[1].x, y: SKEW[1].y });
    near(r[0], SKEW[1]);
    near(r[1], SKEW[2]);
    near(r[2], SKEW[3]);
    near(r[3], SKEW[0]);
  });

  it('en andra vridning mot den nya 20:an ändrar ingenting', () => {
    const once = rotateCalibrationToAnchor(SKEW, { x: 300, y: 80 });
    const twice = rotateCalibrationToAnchor(once, once[0]);
    twice.forEach((p, i) => near(p, once[i]));
  });

  it('lämnar punkterna orörda om de inte är fyra', () => {
    const three = QUAD.slice(0, 3);
    expect(rotateCalibrationToAnchor(three, { x: 200, y: 0 })).toBe(three);
  });
});
