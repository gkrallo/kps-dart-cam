import { describe, it, expect } from 'vitest';
import { findRingOuterEdge, nearSectorWire, refineCalibrationOnRings } from '../ringRefine';
import { computeCalibration } from '../boardProjection';
import { mulberry32, renderSyntheticBoard, sampleImage, syntheticCamera } from '../syntheticBoard';
import type { RGB } from '../sectorPhase';
import type { Point } from '../../types';

/**
 * Finjustering mot ringkanterna. Facit är exakt: tavlan renderas genom en
 * känd kamera, kalibreringen störs medvetet (bottenpunkten 7 px för långt ut,
 * precis felet som mättes på Kristians tavla 2026-10-04), och finjusteringen
 * ska hitta tillbaka.
 */

const CANON: Point[] = [
  { x: 0, y: -170 },
  { x: 170, y: 0 },
  { x: 0, y: 170 },
  { x: -170, y: 0 },
];

function scene(opts: { pitch?: number; yaw?: number; noise?: number } = {}) {
  const cam = syntheticCamera({
    distanceMM: 1300,
    focalPx: 2300,
    pitch: opts.pitch ?? 0.1,
    yaw: opts.yaw ?? 0.05,
    principalPoint: { x: 400, y: 400 },
  });
  const truth = computeCalibration(
    CANON,
    CANON.map((p) => cam.project(p.x, p.y)),
  )!;
  const img = renderSyntheticBoard({
    width: 800,
    height: 800,
    unproject: (x, y) => cam.unproject(x, y),
    noiseStdDev: opts.noise ?? 4,
    rng: mulberry32(11),
  });
  const sample = (x: number, y: number): RGB | null =>
    x < 0 || y < 0 || x >= 800 || y >= 800 ? null : sampleImage(img, x, y);
  return { cam, truth, sample };
}

/** Största radiella felet (mm) för punkter på 170 mm, mätt genom `calib` mot sanningen. */
function radialErrorMM(calib: ReturnType<typeof computeCalibration>, cam: ReturnType<typeof syntheticCamera>): number {
  let worst = 0;
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * 2 * Math.PI;
    const img = cam.project(170 * Math.sin(a), -170 * Math.cos(a));
    const b = calib!.unproject(img.x, img.y);
    worst = Math.max(worst, Math.abs(Math.hypot(b.x, b.y) - 170));
  }
  return worst;
}

describe('ringRefine', () => {
  it('nearSectorWire pekar ut trådarna och lämnar fältmitten', () => {
    expect(nearSectorWire(0)).toBe(false); // mitt i 20
    expect(nearSectorWire((9 * Math.PI) / 180)).toBe(true); // tråden 20|1
    expect(nearSectorWire((27 * Math.PI) / 180)).toBe(true);
    expect(nearSectorWire((18 * Math.PI) / 180)).toBe(false); // mitt i 1
  });

  it('hittar dubbelringens ytterkant på 170 mm genom en korrekt kalibrering', () => {
    const { truth, sample } = scene({ noise: 0 });
    for (const deg of [0, 54, 126, 198, 270]) {
      const e = findRingOuterEdge(truth, sample, (deg * Math.PI) / 180, 170, { searchMM: 12, stepMM: 0.25 });
      expect(e).not.toBeNull();
      expect(Math.abs(e! - 169.25)).toBeLessThan(0.6); // färgen slutar under tråden
    }
  });

  it('rättar en bottenpunkt som sitter 7 px för långt ut', () => {
    const { cam, truth, sample } = scene();
    const pts = CANON.map((p) => cam.project(p.x, p.y));
    // Störningen: bottenpunkten ut från bullen, 7 px (uppmätt fel 2026-10-04).
    const bull = cam.project(0, 0);
    const d = Math.hypot(pts[2].x - bull.x, pts[2].y - bull.y);
    pts[2] = { x: bull.x + ((pts[2].x - bull.x) * (d + 7)) / d, y: bull.y + ((pts[2].y - bull.y) * (d + 7)) / d };
    const wrong = computeCalibration(CANON, pts, { refine: false })!;
    const errBefore = radialErrorMM(wrong, cam);
    expect(errBefore).toBeGreaterThan(2); // felet finns

    const res = refineCalibrationOnRings(wrong, sample);
    expect(res).not.toBeNull();
    // Mätningen FÖRE ska ha sett att botten låg fel (för lågt mätt värde:
    // kanten hamnar innanför 170 när punkten sitter för långt ut).
    expect(res!.before.double[2]).toBeLessThan(168.5);
    expect(res!.before.double[0]).toBeGreaterThan(168.8);

    // Testbilden har 1,77 px/mm, alltså 0,56 mm per pixel - under det går
    // det inte att komma med närmaste-granne-sampling.
    const errAfter = radialErrorMM(res!.calib, cam);
    expect(errAfter).toBeLessThan(0.8);
    expect(res!.samples).toBeGreaterThan(300);
    expect(res!.residualPx).toBeLessThan(1.5);
    expect(truth).toBeDefined();
  });

  it('lämnar en redan korrekt kalibrering i stort sett orörd', () => {
    const { cam, truth, sample } = scene();
    const res = refineCalibrationOnRings(truth, sample);
    expect(res).not.toBeNull();
    expect(radialErrorMM(res!.calib, cam)).toBeLessThan(0.8);
  });

  it('ger upp när ringen inte finns i bild', () => {
    const { truth } = scene();
    const grey: RGB = [120, 120, 120];
    const res = refineCalibrationOnRings(truth, () => grey);
    expect(res).toBeNull();
  });
});
