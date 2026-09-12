import { describe, it, expect } from 'vitest';
import fixture from './fixtures/silver-shaft-blobs.json';
import { groupFragments, minAreaRect, pcaElongation, convexHull } from '../blobGroups';
import { detectDartAxisTip, chooseDartTip } from '../dartTip';
import { projectDartSilhouette, syntheticCamera } from '../syntheticBoard';
import { computeCalibration } from '../boardProjection';
import type { Point } from '../../types';

/**
 * Verkliga maskblobbar ur Kristians tavla (2026-09-12, belysningsring).
 *
 * Det här är felfallet "silvrigt skaft mot gräddvitt fält": pilen faller isär i
 * två blobbar eftersom mellanstycket saknar luminanskontrast, detektorn väljer
 * den STÖRSTA (vingen), och vingens tyngdpunkt ligger ~40 mm från spetsen.
 * Kontrollfallet är samma pil med skaftet över tavlans svarta ram, där hela
 * pilen kommer med i en enda blobb och läses rätt.
 *
 * Testet kör INTE OpenCV - blobbarna är extraherade offline ur fotona med
 * samma kedja som appen kör (se fixturens `note`). Det som testas är det som
 * går att testa i Node: grupperingen och spetsvalet.
 */

type Case = (typeof fixture.cases)['cream'];

const toPoints = (arr: number[][]): Point[] => arr.map(([x, y]) => ({ x, y }));
const frags = (c: Case) => c.blobs.map((b) => ({ points: toPoints(b.contour), area: b.area }));
const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** Samma beslutskedja som `evaluateCandidate` i useDartDetector, utan OpenCV. */
const tipOf = (points: Point[]): Point | null => {
  const rect = minAreaRect(points);
  const long = Math.max(rect.width, rect.height);
  const short = Math.max(Math.min(rect.width, rect.height), 1);
  return chooseDartTip({
    points,
    elongation: long / short,
    axis: detectDartAxisTip(points, { minElongation: 2 }),
    isLightingOnly: false,
    // Skuggtestet frikände blobben i båda fallen på riktig hårdvara
    // (r = -0.44...0.36, långt under 0.75).
    lightingDecided: true,
    lightingReason: '',
  }).tip;
};

describe('silvrigt skaft mot gräddvitt fält: pilen faller isär i två blobbar', () => {
  const cream = fixture.cases.cream as Case;
  const truth: Point = { x: cream.truth_tip_px[0], y: cream.truth_tip_px[1] };

  it('fotot ger tre blobbar: vinge, pipa och en brusstrimma', () => {
    expect(cream.blobs).toHaveLength(3);
    // Vingen är mer än 3x så stor som pipan - därför vann den alltid.
    expect(cream.blobs[0].area).toBeGreaterThan(cream.blobs[1].area * 3);
  });

  it('REGRESSION: största blobben ensam ger en spets långt från pilens spets', () => {
    const tip = tipOf(toPoints(cream.blobs[0].contour));
    expect(tip).not.toBeNull();
    // Det här är felet appen gjorde: ~190 px (~77 mm) fel, vilket blev S18@143mm.
    expect(dist(tip!, truth)).toBeGreaterThan(150);
  });

  it('grupperingen sätter ihop pipan och vingen, men inte brusstrimman', () => {
    const groups = groupFragments(frags(cream));
    expect(groups[0].members).toHaveLength(2);
    expect(groups[0].area).toBe(cream.blobs[0].area + cream.blobs[1].area);
    // Strimman (area 424, box [371,360,502,368]) ligger för långt bort.
    expect(groups).toHaveLength(2);
  });

  it('den hopsatta pilen ger en spets vid pilens spets', () => {
    const tip = tipOf(groupFragments(frags(cream))[0].points);
    expect(tip).not.toBeNull();
    expect(dist(tip!, truth)).toBeLessThan(25);
  });

  it('sammanslagningen gör blobben mer avlång - det är villkoret som styr den', () => {
    const wing = toPoints(cream.blobs[0].contour);
    const barrel = toPoints(cream.blobs[1].contour);
    expect(pcaElongation(wing)).toBeLessThan(2);
    expect(pcaElongation([...wing, ...barrel])).toBeGreaterThan(pcaElongation(wing));
  });
});

describe('samma pil mot svart ram: kontrollfallet som redan fungerade', () => {
  const black = fixture.cases.black as Case;
  const truth: Point = { x: black.truth_tip_px[0], y: black.truth_tip_px[1] };

  it('grupperingen förstör inte fallet som redan läste rätt', () => {
    const tip = tipOf(groupFragments(frags(black))[0].points);
    expect(tip).not.toBeNull();
    expect(dist(tip!, truth)).toBeLessThan(25);
  });
});

describe('en skugga bredvid pilen slås inte ihop med den', () => {
  // Pilen: en avlång remsa. Skuggan: lika lång, parallell, 20 px vid SIDAN.
  // Unionen blir bredare i stället för längre, alltså rundare - och då ska
  // avlånghetsvillkoret säga nej.
  const strip = (x0: number, y0: number, len: number, wide: number): Point[] => {
    const pts: Point[] = [];
    for (let i = 0; i <= len; i++) {
      pts.push({ x: x0 + i, y: y0 });
      pts.push({ x: x0 + i, y: y0 + wide });
    }
    for (let j = 0; j <= wide; j++) {
      pts.push({ x: x0, y: y0 + j });
      pts.push({ x: x0 + len, y: y0 + j });
    }
    return pts;
  };

  it('parallell skugga vid sidan: två grupper', () => {
    const dart = strip(100, 100, 200, 30);
    const shadow = strip(100, 150, 200, 30);
    const groups = groupFragments([
      { points: dart, area: 200 * 30 },
      { points: shadow, area: 200 * 30 },
    ]);
    expect(groups).toHaveLength(2);
  });

  it('fragment i linje ände mot ände: en grupp', () => {
    const a = strip(100, 100, 120, 30);
    const b = strip(250, 100, 120, 30); // 30 px glapp, samma linje
    const groups = groupFragments([
      { points: a, area: 120 * 30 },
      { points: b, area: 120 * 30 },
    ]);
    expect(groups).toHaveLength(1);
  });

  it('en tråd-/kantstrimma intill pilen slås inte ihop med den', () => {
    // Strimman ligger 10 px från pilens ände och i linje med den, så både
    // glappet och avlånghetsvillkoret skulle säga ja. Det som stoppar den är
    // att den själv mäter ~40:1 - ingen pil ser ut så.
    const dart = strip(100, 100, 200, 30);
    const wire = strip(330, 110, 400, 8);
    const groups = groupFragments([
      { points: dart, area: 200 * 30 },
      { points: wire, area: 400 * 8 },
    ]);
    expect(groups).toHaveLength(2);
  });

  it('för stort glapp slås inte ihop', () => {
    const a = strip(100, 100, 120, 30);
    const b = strip(320, 100, 120, 30); // 100 px glapp
    expect(
      groupFragments([
        { points: a, area: 120 * 30 },
        { points: b, area: 120 * 30 },
      ]),
    ).toHaveLength(2);
  });
});

describe('syntetisk pil med bortfallet skaft: exakt facit', () => {
  // Samma fel som i fotot, men genom en KÄND kamera så sanningen är exakt:
  // pilens mask innehåller spets+pipa och fena, men inte det tunna skaftet
  // mellan dem. Kristians geometri: ~1,2 m, ~2,4 px/mm.
  type Vec3 = [number, number, number];
  const polar = (r: number, deg: number): Point => {
    const rad = ((deg - 90) * Math.PI) / 180;
    return { x: r * Math.cos(rad), y: r * Math.sin(rad) };
  };
  const norm3 = (v: Vec3): Vec3 => {
    const n = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / n, v[1] / n, v[2] / n];
  };
  const cross3 = (a: Vec3, b: Vec3): Vec3 => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  const rotateAbout = (v: Vec3, a: Vec3, ang: number): Vec3 => {
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    const d = a[0] * v[0] + a[1] * v[1] + a[2] * v[2];
    const cr = cross3(a, v);
    return norm3([
      v[0] * c + cr[0] * s + a[0] * d * (1 - c),
      v[1] * c + cr[1] * s + a[1] * d * (1 - c),
      v[2] * c + cr[2] * s + a[2] * d * (1 - c),
    ]);
  };
  const CANON: Point[] = [
    { x: 0, y: -170 },
    { x: 170, y: 0 },
    { x: 0, y: 170 },
    { x: -170, y: 0 },
  ];

  const distanceMM = 1200;
  const pitch = 0.18;
  const cam = syntheticCamera({
    distanceMM,
    pitch,
    focalPx: 2900,
    principalPoint: { x: 540, y: 960 },
  });
  const calib = computeCalibration(
    CANON,
    CANON.map((p) => cam.project(p.x, p.y)),
  )!;
  const cameraCentre: Vec3 = [0, -distanceMM * Math.sin(pitch), -distanceMM * Math.cos(pitch)];

  const dirTo = (entry: Point, tiltDeg: number, azimuth: number): Vec3 => {
    const toCam = norm3([cameraCentre[0] - entry.x, cameraCentre[1] - entry.y, cameraCentre[2]]);
    const inPlane: Vec3 = [Math.cos(azimuth), Math.sin(azimuth), 0];
    return rotateAbout(toCam, norm3(cross3(toCam, inPlane)), (tiltDeg * Math.PI) / 180);
  };

  /**
   * Spets+pipa som ett fragment, fenan som ett annat - skaftet saknas.
   * Delningen görs på den FÄRDIGA siluetten, längs pilens axel i bilden:
   * det är precis vad som händer när mellanstycket saknar kontrast mot
   * underlaget och faller ur masken.
   */
  const TOTAL_MM = 25 + 45 + 30 + 35;
  const splitDart = (entry: Point, dir: Vec3) => {
    const all = projectDartSilhouette(cam, { entry, direction: dir });
    const p0 = cam.project3D(entry.x, entry.y, 0);
    const p1 = cam.project3D(
      entry.x + dir[0] * TOTAL_MM,
      entry.y + dir[1] * TOTAL_MM,
      dir[2] * TOTAL_MM,
    );
    const ax = p1.x - p0.x;
    const ay = p1.y - p0.y;
    const len2 = ax * ax + ay * ay;
    const along = (p: Point) => ((p.x - p0.x) * ax + (p.y - p0.y) * ay) / len2;
    const front = all.filter((p) => along(p) < 70 / TOTAL_MM);
    const flight = all.filter((p) => along(p) > 100 / TOTAL_MM);
    expect(front.length).toBeGreaterThan(20);
    expect(flight.length).toBeGreaterThan(20);
    return { front, flight };
  };

  const errorMM = (tip: Point, entry: Point) => {
    const b = calib.unproject(tip.x, tip.y);
    return Math.hypot(b.x - entry.x, b.y - entry.y);
  };

  for (const [name, entry, azimuth] of [
    ['inre singel 20', polar(60, 0), Math.PI / 2],
    ['T20', polar(103, 0), Math.PI / 2],
    ['grön 25', polar(12, 200), Math.PI],
  ] as [string, Point, number][]) {
    it(`${name}: fenan ensam ger fel, hopsatt pil ger rätt`, () => {
      const dir = dirTo(entry, 24, azimuth);
      const { front, flight } = splitDart(entry, dir);
      // Fenan är den största blobben - det är den detektorn valde förut.
      const wingOnly = tipOf(flight);
      expect(wingOnly).not.toBeNull();
      expect(errorMM(wingOnly!, entry)).toBeGreaterThan(25);

      const groups = groupFragments([
        { points: flight, area: 6800 },
        { points: front, area: 2100 },
      ]);
      expect(groups).toHaveLength(1);
      const tip = tipOf(groups[0].points);
      expect(tip).not.toBeNull();
      // Uppmätt: 0,1 mm - lika bra som om masken aldrig tappat skaftet.
      expect(errorMM(tip!, entry)).toBeLessThan(3);
    });
  }
});

describe('minAreaRect / convexHull (JS-ersättning för OpenCV i testerna)', () => {
  it('en axelparallell rektangel ger sina egna mått', () => {
    const pts: Point[] = [
      { x: 10, y: 20 },
      { x: 110, y: 20 },
      { x: 110, y: 60 },
      { x: 10, y: 60 },
    ];
    const r = minAreaRect(pts);
    expect(Math.max(r.width, r.height)).toBeCloseTo(100, 6);
    expect(Math.min(r.width, r.height)).toBeCloseTo(40, 6);
    expect(r.center.x).toBeCloseTo(60, 6);
    expect(r.center.y).toBeCloseTo(40, 6);
  });

  it('en 45-graders rektangel mäts längs sin egen riktning, inte bildens', () => {
    const pts: Point[] = [];
    const c = Math.SQRT1_2;
    for (let i = 0; i <= 100; i++) {
      for (const t of [-15, 15]) {
        pts.push({ x: i * c - t * c, y: i * c + t * c });
      }
    }
    const r = minAreaRect(pts);
    expect(Math.max(r.width, r.height)).toBeCloseTo(100, 1);
    expect(Math.min(r.width, r.height)).toBeCloseTo(30, 1);
  });

  it('höljet av en fylld kvadrat är dess fyra hörn', () => {
    const pts: Point[] = [];
    for (let x = 0; x <= 10; x++) for (let y = 0; y <= 10; y++) pts.push({ x, y });
    expect(convexHull(pts)).toHaveLength(4);
  });
});
