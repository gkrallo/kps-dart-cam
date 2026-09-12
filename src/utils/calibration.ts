import type { Point } from '../types';
import { CANONICAL_CALIBRATION_MM, computeCalibration } from './boardProjection';

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
 * Vrider kalibreringen så att 20:an hamnar i den riktning användaren pekar.
 *
 * Den gamla versionen kunde bara rotera punkternas ORDNING i kvartssteg: den
 * valde vilken av de fyra befintliga punkterna som skulle räknas som "Topp
 * (20)". Det hjälper när autodetekteringen lagt punkterna ett kvarts varv
 * fel, men inte mot det fel som faktiskt uppstår: `autoDetectBoardEllipse`
 * lägger punkterna vid ELLIPSENS topp, höger, botten och vänster, medan de
 * ska ligga vid mitten av 20:ans, 6:ans, 3:ans och 11:ans dubbelfält. Det är
 * samma sak bara om tavlan sitter med 20:an exakt rakt upp och kameran inte
 * lutar i sidled. Är tavlan monterad några grader snett hamnar alla fyra
 * punkterna bredvid sina fält och hela sektorhjulet vrids - wireframets FORM
 * ser perfekt ut medan sektorerna läser fel. Uppmätt på Kristians tavla
 * 2026-09-12; rättades då genom att dra alla fyra punkterna för hand.
 *
 * Rotationen sker i TAVLANS plan, inte i bilden: ser man tavlan snett är en
 * vridning på tavlan ingen vridning i bilden. Därför tas kalibreringen fram
 * ur nuvarande punkter, de kanoniska mm-punkterna roteras, och resultatet
 * projiceras tillbaka till bildkoordinater. Bara tryckets RIKTNING används,
 * inte avståndet - peka var som helst längs 20:ans mittlinje.
 */
export function rotateCalibrationToAnchor(points: Point[], anchorTap: Point): Point[] {
  if (points.length !== 4) return points;

  const calib = computeCalibration([...CANONICAL_CALIBRATION_MM], points);
  if (!calib) return points;

  const tapBoard = calib.unproject(anchorTap.x, anchorTap.y);
  // dartMath-konventionen: 0 grader rakt upp, positivt medurs, y nedåt.
  const angleOf = (p: Point) => Math.atan2(p.x, -p.y);
  const tapAngle = angleOf(tapBoard);
  if (!Number.isFinite(tapAngle)) return points;

  // Appen tror att 20:an ligger i 0 grader. Användaren säger att den i
  // själva verket ligger i `tapAngle`, så hela hjulet ska vridas dit.
  const rotated = CANONICAL_CALIBRATION_MM.map((p) => {
    const a = angleOf(p) + tapAngle;
    const r = Math.hypot(p.x, p.y);
    return { x: r * Math.sin(a), y: -r * Math.cos(a) };
  });

  return rotated.map((p) => calib.project(p.x, p.y));
}
