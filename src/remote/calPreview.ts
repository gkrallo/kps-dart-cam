import type { Point } from '../types';
import { computeHomography, generateProjectedCircleSVG, getSectorBoundaryAngles } from '../utils/boardProjection';

/**
 * Kamerabilden med tavlans wireframe, som JPEG för fjärrskärmen.
 *
 * Samma ringar och streckade sektorlinjer som CalibrationOverlay ritar, från
 * samma punkter och samma `computeHomography` - så att den som kalibrerar på
 * surfplattan dömer efter exakt det telefonen skulle visat. Ingen egen
 * geometri: bara en annan yta att rita på.
 *
 * Hela videobilden skickas, inte bara det beskurna utsnitt telefonen visar
 * (object-cover): tavlan kan ligga i kanten, och då ska det synas.
 */

/** Längsta sida. Räcker för att se trådarna, och JPEG:en håller sig under datakanalens 256 kB. */
const MAX_SIDE = 720;
/** Base64 över så här mycket kodas om med lägre kvalitet. */
const MAX_BASE64 = 200_000;

const RINGS: { r: number; color: string; dash: boolean }[] = [
  { r: 170, color: '#3b82f6', dash: false },
  { r: 162, color: '#60a5fa', dash: true },
  { r: 107, color: '#ef4444', dash: false },
  { r: 97, color: '#f87171', dash: true },
  { r: 15.9, color: '#22c55e', dash: false },
  { r: 6.35, color: '#ffffff', dash: false },
];

export function renderCalibrationPreview(
  video: HTMLVideoElement,
  points: Point[] | null,
  container: { width: number; height: number },
): string | null {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh || !container.width || !container.height) return null;
  const k = Math.min(1, MAX_SIDE / Math.max(vw, vh));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(vw * k);
  canvas.height = Math.round(vh * k);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  try {
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  } catch {
    return null;
  }

  const project = points && points.length === 4 ? computeHomography(points) : null;
  if (project) {
    // Punkterna är i skärmkoordinater (videon visas med object-cover:
    // skalad med max() och centrerad) - samma mappning som överallt annars.
    const s = Math.max(container.width / vw, container.height / vh);
    const offX = (container.width - vw * s) / 2;
    const offY = (container.height - vh * s) / 2;
    const f = k / s;
    ctx.setTransform(f, 0, 0, f, -offX * f, -offY * f);
    // Linjebredd och streck i skärmenheter: dela med skalan så att de blir
    // ungefär lika tjocka i bilden oavsett upplösning.
    const px = 1 / f;
    for (const ring of RINGS) {
      ctx.strokeStyle = ring.color;
      ctx.lineWidth = 1.6 * px;
      ctx.setLineDash(ring.dash ? [3 * px, 3 * px] : []);
      ctx.stroke(new Path2D(generateProjectedCircleSVG(ring.r, project)));
    }
    ctx.strokeStyle = 'rgba(226,232,240,0.9)';
    ctx.lineWidth = 1.2 * px;
    ctx.setLineDash([4 * px, 4 * px]);
    for (const deg of getSectorBoundaryAngles()) {
      const rad = (deg * Math.PI) / 180;
      const a = project(15.9 * Math.cos(rad), 15.9 * Math.sin(rad));
      const b = project(170 * Math.cos(rad), 170 * Math.sin(rad));
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  for (const q of [0.7, 0.5, 0.35]) {
    const b64 = canvas.toDataURL('image/jpeg', q).split(',')[1] ?? '';
    if (b64.length <= MAX_BASE64) return b64;
  }
  return null;
}
