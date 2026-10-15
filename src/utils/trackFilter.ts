/**
 * Chooses which recorded fixes are worth uploading. Tracks records the own
 * vessel every minute whether it is sailing or swinging at anchor; NFL wants
 * the passage, not the swinging.
 */

import type { Fix } from '../types';
import { equirectangularDistance, msToKnots } from './geo';
import { validatePosition } from './validation';

export interface FilterOptions {
  /** Minimum time between uploaded fixes, ms. 0 disables. */
  minIntervalMs: number;
  /** Minimum distance from the last uploaded fix, metres. 0 disables. */
  minMoveMeters: number;
  /** Minimum speed from the fix recorded before, knots. 0 disables. */
  minSpeedKnots: number;
}

export interface FilterReference {
  /** The last fix uploaded. Spacing and distance are measured from it. */
  uploaded?: Fix;
  /** The last fix looked at, uploaded or not. Speed is measured from it. */
  previous?: Fix;
}

export interface FilterResult {
  kept: Fix[];
  /** The last valid fix looked at, to carry into the next batch as `previous`. */
  previous?: Fix;
}

/**
 * Speed is taken between consecutive recorded fixes rather than from the last
 * uploaded one: after a week at anchor, the average speed since the anchorage
 * stays below any threshold long after the boat has left.
 *
 * `fixes` must be in time order.
 */
export function selectFixes(
  fixes: readonly Fix[],
  reference: FilterReference,
  options: FilterOptions
): FilterResult {
  const kept: Fix[] = [];
  let uploaded = reference.uploaded;
  let previous = reference.previous;

  for (const fix of fixes) {
    if (!validatePosition(fix).valid) {
      continue;
    }

    const fastEnough =
      options.minSpeedKnots <= 0 ||
      previous === undefined ||
      speedKnots(previous, fix) >= options.minSpeedKnots;
    const spacedEnough =
      uploaded === undefined || fix.time - uploaded.time >= options.minIntervalMs;
    const movedEnough =
      options.minMoveMeters <= 0 ||
      uploaded === undefined ||
      equirectangularDistance(uploaded, fix) >= options.minMoveMeters;

    if (fastEnough && spacedEnough && movedEnough) {
      kept.push(fix);
      uploaded = fix;
    }
    previous = fix;
  }

  return { kept, previous };
}

function speedKnots(from: Fix, to: Fix): number {
  const seconds = (to.time - from.time) / 1000;
  if (seconds <= 0) {
    return 0;
  }
  return msToKnots(equirectangularDistance(from, to) / seconds);
}
