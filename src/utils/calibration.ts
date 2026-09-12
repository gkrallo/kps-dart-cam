import type { Point } from '../types';

/**
 * Kalibreringens livscykel: spara en gång, återanvänd nästa gång, och låt
 * användaren peka ut var 20:an sitter i stället för att pricka in punkter på
 * mm-nivå.
 *
 * Punkterna sparas som andelar (0-1) av containerns storlek så att de överlever
 * en omladdning på samma telefon i samma orientering. Ändrar sig bildförhållandet
 * (annan telefon, landskap) blir tavlan skev - `aspect` sparas så gränssnittet
 * kan varna, och användaren kan alltid nudga eller kalibrera om.
 */

const STORAGE_KEY = 'kps-dart-cam:calibration:v1';

export interface ContainerSize {
  width: number;
  height: number;
}

export interface StoredCalibration {
  /** [topp 20, höger 6, botten 3, vänster 11] som andelar av containern. */
  points: { fx: number; fy: number }[];
  savedAt: number;
  aspect: number;
  /**
   * Hårdvaruzoomen punkterna mättes vid. MÅSTE återställas tillsammans med
   * punkterna: zoomen beskär kamerabilden, så samma punkt på skärmen svarar
   * mot helt olika ställen på tavlan vid 1x och 2x. Utan detta återställdes
   * punkterna från en inzoomad kalibrering medan kameran gick tillbaka till
   * 1x, och kalibreringen blev tyst helt fel (uppmätt på Kristians telefon
   * 2026-09-12: Sikte-steget valde 2.07x, en omladdning gav 1x).
   * Optionell - kalibreringar sparade före det här fältet saknar den.
   */
  zoom?: number;
}

/** Punkter i container-pixlar -> lagringsform. */
export function toStored(
  points: Point[],
  container: ContainerSize,
  zoom?: number,
): StoredCalibration | null {
  if (points.length !== 4 || container.width <= 0 || container.height <= 0) return null;
  return {
    points: points.map((p) => ({ fx: p.x / container.width, fy: p.y / container.height })),
    savedAt: Date.now(),
    aspect: container.width / container.height,
    ...(zoom !== undefined ? { zoom } : {}),
  };
}

/** Lagringsform -> punkter i container-pixlar. */
export function fromStored(stored: StoredCalibration, container: ContainerSize): Point[] | null {
  if (
    !stored ||
    !Array.isArray(stored.points) ||
    stored.points.length !== 4 ||
    container.width <= 0 ||
    container.height <= 0
  ) {
    return null;
  }
  return stored.points.map((f) => ({ x: f.fx * container.width, y: f.fy * container.height }));
}

function storage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    // Vissa lägen (privat surfning, blockerade cookies) kastar redan vid åtkomst.
    return null;
  }
}

export function saveCalibration(points: Point[], container: ContainerSize, zoom?: number): void {
  const s = storage();
  const data = toStored(points, container, zoom);
  if (!s || !data) return;
  try {
    s.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Full eller blockerad - strunt i det, kalibreringen fungerar ändå.
  }
}

export function loadCalibration(): StoredCalibration | null {
  const s = storage();
  if (!s) return null;
  try {
    const raw = s.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.points) || parsed.points.length !== 4) return null;
    return parsed as StoredCalibration;
  } catch {
    return null;
  }
}

export function clearCalibration(): void {
  const s = storage();
  if (!s) return;
  try {
    s.removeItem(STORAGE_KEY);
  } catch {
    // ignorera
  }
}

/**
 * Roterar kalibreringspunkternas ordning så att den punkt som ligger närmast
 * riktningen mot `anchorTap` (från tavlans mitt) hamnar först - alltså blir
 * "Topp (20)". Ett grovt tryck räcker: den snäppar till närmaste 90 grader.
 */
export function rotateCalibrationToAnchor(points: Point[], anchorTap: Point): Point[] {
  if (points.length !== 4) return points;

  const cx = (points[0].x + points[1].x + points[2].x + points[3].x) / 4;
  const cy = (points[0].y + points[1].y + points[2].y + points[3].y) / 4;
  const tapAngle = Math.atan2(anchorTap.y - cy, anchorTap.x - cx);

  let bestK = 0;
  let bestDiff = Infinity;
  for (let k = 0; k < 4; k++) {
    const a = Math.atan2(points[k].y - cy, points[k].x - cx);
    const diff = Math.abs(Math.atan2(Math.sin(a - tapAngle), Math.cos(a - tapAngle)));
    if (diff < bestDiff) {
      bestDiff = diff;
      bestK = k;
    }
  }

  return bestK === 0 ? points : [...points.slice(bestK), ...points.slice(0, bestK)];
}
