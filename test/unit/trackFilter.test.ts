import { describe, expect, it } from 'vitest';
import { selectFixes, type FilterOptions } from '../../src/utils/trackFilter';
import type { Fix } from '../../src/types';

const MINUTE = 60_000;
const T0 = Date.parse('2026-10-01T12:00:00Z');
// About 111 m per 0.001° of latitude
const fix = (minutes: number, latitude: number, longitude = 4.3): Fix => ({
  time: T0 + minutes * MINUTE,
  latitude,
  longitude,
});

const OFF: FilterOptions = { minIntervalMs: 0, minMoveMeters: 0, minSpeedKnots: 0 };

describe('selectFixes', () => {
  it('keeps every valid fix when all filters are off', () => {
    const fixes = [fix(0, 52.1), fix(1, 52.1), fix(2, 52.1)];
    expect(selectFixes(fixes, {}, OFF).kept).toEqual(fixes);
  });

  it('drops fixes the position check rejects and does not measure from them', () => {
    const nearZero = { time: T0 + MINUTE, latitude: 0.001, longitude: 0.001 };
    const result = selectFixes([fix(0, 52.1), nearZero, fix(2, 52.2)], {}, OFF);
    expect(result.kept).toEqual([fix(0, 52.1), fix(2, 52.2)]);
    expect(result.previous).toEqual(fix(2, 52.2));
  });

  it('spaces uploaded fixes by the minimum interval from the last uploaded one', () => {
    const fixes = [fix(1, 52.1), fix(2, 52.2), fix(3, 52.3), fix(4, 52.4)];
    const { kept } = selectFixes(
      fixes,
      { uploaded: fix(0, 52.0) },
      { ...OFF, minIntervalMs: 2 * MINUTE }
    );
    expect(kept).toEqual([fix(2, 52.2), fix(4, 52.4)]);
  });

  it('keeps the first fix when nothing has been uploaded yet', () => {
    const { kept } = selectFixes([fix(0, 52.1)], {}, { ...OFF, minIntervalMs: 10 * MINUTE });
    expect(kept).toEqual([fix(0, 52.1)]);
  });

  it('leaves out moves shorter than the minimum distance from the last uploaded fix', () => {
    // 0.0005° ≈ 56 m, 0.001° ≈ 111 m
    const fixes = [fix(1, 52.1005), fix(2, 52.101), fix(3, 52.1015)];
    const { kept } = selectFixes(fixes, { uploaded: fix(0, 52.1) }, { ...OFF, minMoveMeters: 80 });
    expect(kept).toEqual([fix(2, 52.101)]);
  });

  it('measures speed from the fix recorded before, not from the last uploaded one', () => {
    // A week at anchor, then 6 knots: about 185 m per minute, 0.00167° of latitude.
    const anchored = fix(-7 * 24 * 60, 52.1);
    const leaving = [fix(0, 52.1), fix(1, 52.10167), fix(2, 52.10334)];
    const { kept } = selectFixes(
      leaving,
      { uploaded: anchored, previous: anchored },
      { ...OFF, minSpeedKnots: 1.5 }
    );
    expect(kept).toEqual([fix(1, 52.10167), fix(2, 52.10334)]);
  });

  it('leaves out swinging at anchor below the minimum speed', () => {
    // 10 m back and forth per minute is about 0.3 knots.
    const swinging = [fix(1, 52.10009), fix(2, 52.1), fix(3, 52.10009)];
    const { kept, previous } = selectFixes(
      swinging,
      { previous: fix(0, 52.1) },
      { ...OFF, minSpeedKnots: 1.5 }
    );
    expect(kept).toEqual([]);
    expect(previous).toEqual(fix(3, 52.10009));
  });

  it('returns the previous fix it was given when the batch has no valid fix', () => {
    const before = fix(0, 52.1);
    const result = selectFixes(
      [{ time: T0 + MINUTE, latitude: 95, longitude: 4 }],
      { previous: before },
      OFF
    );
    expect(result).toEqual({ kept: [], previous: before });
  });
});
