/**
 * Geographic utility functions
 */

import type { Position } from '../types';

const EARTH_RADIUS_METERS = 6371e3;
const DEG_TO_RAD = Math.PI / 180;

/**
 * Calculate distance between two positions using equirectangular approximation
 * This is faster than haversine and accurate enough for short distances
 *
 * @param from Starting position
 * @param to Ending position
 * @returns Distance in meters
 */
export function equirectangularDistance(from: Position, to: Position): number {
  const phi1 = from.latitude * DEG_TO_RAD;
  const phi2 = to.latitude * DEG_TO_RAD;
  const deltaLambda = (to.longitude - from.longitude) * DEG_TO_RAD;

  const x = deltaLambda * Math.cos((phi1 + phi2) / 2);
  const y = phi2 - phi1;

  return Math.sqrt(x * x + y * y) * EARTH_RADIUS_METERS;
}

/**
 * Convert meters per second to knots
 */
export function msToKnots(ms: number): number {
  return ms * 1.94384;
}

/**
 * Convert knots to meters per second
 */
export function knotsToMs(knots: number): number {
  return knots / 1.94384;
}
