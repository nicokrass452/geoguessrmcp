import type { MoveDirection } from './types.js';

const EARTH_RADIUS_KM = 6371;

export function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Great-circle Haversine distance in kilometers between two WGS84 points.
 */
export function haversineDistanceKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const rLat1 = toRadians(lat1);
  const rLat2 = toRadians(lat2);

  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const a =
    sinLat * sinLat + Math.cos(rLat1) * Math.cos(rLat2) * sinLng * sinLng;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
  return EARTH_RADIUS_KM * c;
}

/**
 * GeoGuessr-style exponential distance score on [0, 5000].
 * Formula: 5000 * e^(-distance_km / 2000)
 */
export function calculateScore(distanceKm: number): number {
  const raw = 5000 * Math.exp(-Math.max(0, distanceKm) / 2000);
  return Math.max(0, Math.min(5000, Math.round(raw)));
}

/**
 * Normalizes a compass heading into [0, 360).
 */
export function normalizeHeading(deg: number): number {
  const normalized = ((deg % 360) + 360) % 360;
  return normalized === 360 ? 0 : normalized;
}

const COMPASS_8 = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;

export function headingToCompass(deg: number): string {
  const norm = normalizeHeading(deg);
  const idx = Math.round(norm / 45) % 8;
  return COMPASS_8[idx];
}

/**
 * Signed angular difference (target - source) in (-180, 180].
 */
export function angularDifference(sourceDeg: number, targetDeg: number): number {
  let diff = ((targetDeg - sourceDeg + 180) % 360 + 360) % 360 - 180;
  if (diff <= -180) diff += 360;
  return diff;
}

export function classifyRelativeDirection(
  cameraHeading: number,
  linkBearing: number
): MoveDirection {
  const delta = angularDifference(cameraHeading, linkBearing);
  if (delta >= -45 && delta <= 45) return 'forward';
  if (delta > 45 && delta <= 135) return 'right';
  if (delta < -45 && delta >= -135) return 'left';
  return 'backward';
}

const DIRECTION_OFFSETS: Record<MoveDirection, number> = {
  forward: 0,
  right: 90,
  backward: 180,
  left: -90,
};

export function resolveMoveByDirection<
  T extends { nodeId: string; bearingDeg: number },
>(
  cameraHeading: number,
  links: T[],
  direction: MoveDirection
): T | null {
  if (links.length === 0) return null;

  const desiredBearing = normalizeHeading(
    cameraHeading + DIRECTION_OFFSETS[direction]
  );

  let best: T | null = null;
  let bestDelta = Infinity;

  for (const link of links) {
    const absDelta = Math.abs(angularDifference(desiredBearing, link.bearingDeg));
    if (absDelta < bestDelta) {
      bestDelta = absDelta;
      best = link;
    }
  }

  const maxAcceptableDelta = links.length <= 2 ? 110 : 75;
  if (best && bestDelta <= maxAcceptableDelta) {
    return best;
  }

  return null;
}
