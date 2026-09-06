import { DartScore } from '../types';

const SECTORS = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];

/**
 * Calculates dart score from (x, y) coordinates on a 800x800 target canvas with center at (400, 400).
 */
export function getScoreFromCoordinates(x: number, y: number): DartScore {
  const centerX = 400;
  const centerY = 400;

  const dx = x - centerX;
  const dy = y - centerY;

  const radius = Math.sqrt(dx * dx + dy * dy);

  // 1. Check Bullseye / Outer Bull
  if (radius <= 16) {
    return {
      baseScore: 25,
      multiplier: 2,
      totalPoints: 50,
      label: 'DB',
      coordinates: { x, y }
    };
  }

  if (radius <= 38) {
    return {
      baseScore: 25,
      multiplier: 1,
      totalPoints: 25,
      label: '25',
      coordinates: { x, y }
    };
  }

  // Outside board boundary
  if (radius > 385) {
    return {
      baseScore: 0,
      multiplier: 0,
      totalPoints: 0,
      label: 'MISS',
      coordinates: { x, y }
    };
  }

  // 2. Calculate Sector Angle
  let deg = Math.atan2(dy, dx) * (180 / Math.PI);
  if (deg < 0) deg += 360;

  // Sector 20 is centered at 12 o'clock (270 degrees)
  const normalized = (deg - 270 + 9 + 360) % 360;
  const sectorIndex = Math.floor(normalized / 18);
  const baseScore = SECTORS[sectorIndex] ?? 20;

  // 3. Determine Multiplier based on Radius Ring
  let multiplier = 1;
  let labelPrefix = 'S';

  if (radius >= 216 && radius <= 242) {
    multiplier = 3;
    labelPrefix = 'T';
  } else if (radius >= 360 && radius <= 385) {
    multiplier = 2;
    labelPrefix = 'D';
  }

  return {
    baseScore,
    multiplier,
    totalPoints: baseScore * multiplier,
    label: `${labelPrefix}${baseScore}`,
    coordinates: { x, y }
  };
}

/**
  * Calculates dart score directly from canonical millimeter coordinates (X, Y)
  * where Bullseye center is (0,0) and outer double ring radius is 170mm.
  */
export function getScoreFromCanonicalCoordinates(X: number, Y: number): DartScore {
  const radius = Math.hypot(X, Y);

  // 1. Bullseye / Single Bull
  if (radius <= 6.35) {
    return { baseScore: 25, multiplier: 2, totalPoints: 50, label: 'DB', coordinates: { x: X, y: Y } };
  }
  if (radius <= 15.9) {
    return { baseScore: 25, multiplier: 1, totalPoints: 25, label: '25', coordinates: { x: X, y: Y } };
  }

  // Outside board
  if (radius > 170) {
    return { baseScore: 0, multiplier: 0, totalPoints: 0, label: 'MISS', coordinates: { x: X, y: Y } };
  }

  // 2. Sector Angle (0 deg at 12 o'clock / Sector 20)
  let deg = Math.atan2(Y, X) * (180 / Math.PI);
  // Rotate so 12 o'clock (-90 deg) is 0
  let normDeg = (deg + 90 + 360) % 360;
  // Each sector is 18 degrees wide, offset by -9 deg
  const sectorIdx = Math.floor(((normDeg + 9) % 360) / 18);
  const baseScore = SECTORS[sectorIdx] ?? 20;

  // 3. Multiplier based on mm ring radii
  let multiplier = 1;
  let labelPrefix = 'S';

  if (radius >= 97 && radius <= 107) {
    multiplier = 3;
    labelPrefix = 'T';
  } else if (radius >= 162 && radius <= 170) {
    multiplier = 2;
    labelPrefix = 'D';
  }

  return {
    baseScore,
    multiplier,
    totalPoints: baseScore * multiplier,
    label: `${labelPrefix}${baseScore}`,
    coordinates: { x: X, y: Y }
  };
}
