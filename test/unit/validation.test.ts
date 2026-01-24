/**
 * Tests for position validation and velocity filter
 * These tests are critical - they verify the fix for Bruce's GPS anomalies
 */

import {
  validatePosition,
  validateVelocity,
  isValidLatitude,
  isValidLongitude,
  isDefinedNumber,
  DEFAULT_MAX_VELOCITY,
  ZERO_THRESHOLD,
} from '../../src/utils/validation';
import { equirectangularDistance, msToKnots, knotsToMs } from '../../src/utils/geo';
import type { Position } from '../../src/types';

describe('validatePosition', () => {
  describe('valid positions', () => {
    it('accepts a normal position', () => {
      const result = validatePosition({ latitude: 8.17, longitude: 98.341 });
      expect(result.valid).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it('accepts positions near poles', () => {
      expect(validatePosition({ latitude: 89.9, longitude: 0 }).valid).toBe(true);
      expect(validatePosition({ latitude: -89.9, longitude: 0 }).valid).toBe(true);
    });

    it('accepts positions near date line', () => {
      expect(validatePosition({ latitude: 0, longitude: 179.9 }).valid).toBe(true);
      expect(validatePosition({ latitude: 0, longitude: -179.9 }).valid).toBe(true);
    });
  });

  describe('near zero filter', () => {
    it('rejects position at exactly (0,0)', () => {
      const result = validatePosition({ latitude: 0, longitude: 0 });
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('(0,0)');
    });

    it('rejects positions within threshold of (0,0)', () => {
      expect(validatePosition({ latitude: 0.005, longitude: 0.005 }).valid).toBe(false);
      expect(validatePosition({ latitude: -0.005, longitude: -0.005 }).valid).toBe(false);
      expect(validatePosition({ latitude: 0.009, longitude: 0.009 }).valid).toBe(false);
    });

    it('accepts positions just outside threshold', () => {
      // Just outside the 0.01 degree threshold
      expect(validatePosition({ latitude: 0.02, longitude: 0 }).valid).toBe(true);
      expect(validatePosition({ latitude: 0, longitude: 0.02 }).valid).toBe(true);
    });

    it('confirms threshold constant is 0.01', () => {
      expect(ZERO_THRESHOLD).toBe(0.01);
    });
  });

  describe('WGS84 range validation', () => {
    it('rejects latitude at or beyond ±90', () => {
      expect(validatePosition({ latitude: 90, longitude: 0 }).valid).toBe(false);
      expect(validatePosition({ latitude: -90, longitude: 0 }).valid).toBe(false);
      expect(validatePosition({ latitude: 91, longitude: 0 }).valid).toBe(false);
      expect(validatePosition({ latitude: -91, longitude: 0 }).valid).toBe(false);
    });

    it('rejects longitude at or beyond ±180', () => {
      expect(validatePosition({ latitude: 0, longitude: 180 }).valid).toBe(false);
      expect(validatePosition({ latitude: 0, longitude: -180 }).valid).toBe(false);
      expect(validatePosition({ latitude: 0, longitude: 181 }).valid).toBe(false);
      expect(validatePosition({ latitude: 0, longitude: -181 }).valid).toBe(false);
    });
  });

  describe('invalid input handling', () => {
    it('rejects null position', () => {
      expect(validatePosition(null as unknown as Position).valid).toBe(false);
    });

    it('rejects undefined position', () => {
      expect(validatePosition(undefined as unknown as Position).valid).toBe(false);
    });

    it('rejects non-object position', () => {
      expect(validatePosition('invalid' as unknown as Position).valid).toBe(false);
    });

    it('rejects non-numeric coordinates', () => {
      expect(validatePosition({ latitude: 'foo', longitude: 0 } as unknown as Position).valid).toBe(
        false
      );
      expect(validatePosition({ latitude: 0, longitude: 'bar' } as unknown as Position).valid).toBe(
        false
      );
    });

    it('rejects NaN coordinates', () => {
      expect(validatePosition({ latitude: NaN, longitude: 0 }).valid).toBe(false);
      expect(validatePosition({ latitude: 0, longitude: NaN }).valid).toBe(false);
    });

    it('rejects Infinity coordinates', () => {
      expect(validatePosition({ latitude: Infinity, longitude: 0 }).valid).toBe(false);
      expect(validatePosition({ latitude: 0, longitude: -Infinity }).valid).toBe(false);
    });
  });
});

describe('validateVelocity', () => {
  // Helper to create timestamps
  const baseTime = new Date('2026-01-20T10:00:00.000Z');
  const t0 = baseTime.toISOString();
  const t1 = new Date(baseTime.getTime() + 1000).toISOString(); // +1 second
  const t60 = new Date(baseTime.getTime() + 60000).toISOString(); // +60 seconds
  const t3600 = new Date(baseTime.getTime() + 3600000).toISOString(); // +1 hour

  describe('normal sailing speeds', () => {
    it('accepts stationary position', () => {
      const pos = { latitude: 8.17, longitude: 98.341 };
      const result = validateVelocity(pos, pos, t0, t60);
      expect(result.valid).toBe(true);
    });

    it('accepts 5 knot sailing (common cruising speed)', () => {
      // 5 knots ≈ 2.57 m/s, over 60 seconds = ~154m
      const from = { latitude: 8.17, longitude: 98.341 };
      const to = { latitude: 8.1714, longitude: 98.341 }; // ~155m north
      const result = validateVelocity(from, to, t0, t60);
      expect(result.valid).toBe(true);
    });

    it('accepts 10 knot sailing (fast cruising)', () => {
      // 10 knots ≈ 5.14 m/s, over 60 seconds = ~309m
      const from = { latitude: 8.17, longitude: 98.341 };
      const to = { latitude: 8.17278, longitude: 98.341 }; // ~309m north
      const result = validateVelocity(from, to, t0, t60);
      expect(result.valid).toBe(true);
    });

    it('accepts 20 knot sailing (racing or motoring)', () => {
      // 20 knots ≈ 10.29 m/s, over 60 seconds = ~617m
      const from = { latitude: 8.17, longitude: 98.341 };
      const to = { latitude: 8.17556, longitude: 98.341 }; // ~617m north
      const result = validateVelocity(from, to, t0, t60);
      expect(result.valid).toBe(true);
    });
  });

  describe("velocity filter - Bruce's actual bad data", () => {
    // Bruce's real position in Thailand (Andaman Sea)
    const validPosition = { latitude: 8.170624, longitude: 98.341481 };

    it('rejects jump to Antarctic latitude (-55°)', () => {
      // This was in Bruce's actual bad data
      const badPosition = { latitude: -55.8038922, longitude: -164.8813052 };
      const result = validateVelocity(validPosition, badPosition, t0, t1);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('GPS outlier');
      expect(result.reason).toContain('exceeds maximum');
    });

    it('rejects jump to -57° latitude', () => {
      const badPosition = { latitude: -57.0376771, longitude: -164.8722172 };
      const result = validateVelocity(validPosition, badPosition, t0, t1);
      expect(result.valid).toBe(false);
    });

    it('rejects longitude jump from 98°E to 1°E', () => {
      // Another anomaly from Bruce's data
      const badPosition = { latitude: 8.1706501, longitude: 1.0336443 };
      const result = validateVelocity(validPosition, badPosition, t0, t1);
      expect(result.valid).toBe(false);
    });

    it('rejects longitude jump from 98°E to -164°W', () => {
      const badPosition = { latitude: 8.170656, longitude: -164.8754564 };
      const result = validateVelocity(validPosition, badPosition, t0, t1);
      expect(result.valid).toBe(false);
    });

    it("calculates implied velocity for Bruce's worst case", () => {
      // From Thailand to Antarctic in 1 second
      const from = { latitude: 8.170624, longitude: 98.341481 };
      const to = { latitude: -55.8038922, longitude: -164.8813052 };
      const distance = equirectangularDistance(from, to);

      // Distance should be roughly 10,000+ km
      expect(distance).toBeGreaterThan(10_000_000); // 10,000 km in meters

      // At 1 second, velocity would be > 10,000,000 m/s
      // That's about 20,000,000 knots - obviously impossible
      const velocityMs = distance / 1; // 1 second
      expect(velocityMs).toBeGreaterThan(10_000_000);
      expect(msToKnots(velocityMs)).toBeGreaterThan(19_000_000);
    });
  });

  describe('edge cases', () => {
    it('rejects timestamps in wrong order', () => {
      const pos = { latitude: 8.17, longitude: 98.341 };
      const result = validateVelocity(pos, pos, t60, t0); // t0 is before t60
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('timestamp sequence');
    });

    it('rejects identical timestamps', () => {
      const pos = { latitude: 8.17, longitude: 98.341 };
      const result = validateVelocity(pos, pos, t0, t0);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('timestamp sequence');
    });

    it('rejects invalid timestamp format', () => {
      const pos = { latitude: 8.17, longitude: 98.341 };
      const result = validateVelocity(pos, pos, 'invalid', t60);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Invalid timestamp');
    });

    it('handles long time periods correctly', () => {
      // Even a large distance is OK if enough time has passed
      // 1000km in 1 hour = 277 m/s ≈ 540 knots - still too fast
      // 1000km in 10 hours = 27.7 m/s ≈ 54 knots - acceptable
      const from = { latitude: 8.0, longitude: 98.0 };
      const to = { latitude: 17.0, longitude: 98.0 }; // ~1000km north

      // 1 hour - too fast
      const result1h = validateVelocity(from, to, t0, t3600);
      expect(result1h.valid).toBe(false);

      // 10 hours - acceptable
      const t10h = new Date(baseTime.getTime() + 36000000).toISOString();
      const result10h = validateVelocity(from, to, t0, t10h);
      expect(result10h.valid).toBe(true);
    });
  });

  describe('custom maxVelocity', () => {
    it('uses default maxVelocity of 50 m/s', () => {
      expect(DEFAULT_MAX_VELOCITY).toBe(50);
    });

    it('accepts custom lower maxVelocity', () => {
      // 10 m/s ≈ 19.4 knots
      const from = { latitude: 8.17, longitude: 98.341 };
      const to = { latitude: 8.171, longitude: 98.341 }; // ~111m

      // At 60 seconds, velocity is ~1.85 m/s - should pass with low limit
      const result = validateVelocity(from, to, t0, t60, 10);
      expect(result.valid).toBe(true);
    });

    it('rejects with custom lower maxVelocity', () => {
      // Same positions but with 1 second - velocity ~111 m/s
      const from = { latitude: 8.17, longitude: 98.341 };
      const to = { latitude: 8.171, longitude: 98.341 };

      const result = validateVelocity(from, to, t0, t1, 10);
      expect(result.valid).toBe(false);
    });

    it('accepts custom higher maxVelocity', () => {
      // Allow up to 100 m/s (≈194 knots) - maybe for aircraft?
      const from = { latitude: 8.17, longitude: 98.341 };
      const to = { latitude: 8.18, longitude: 98.341 }; // ~1.1km

      // At 60 seconds, velocity is ~18.5 m/s - should pass
      const result = validateVelocity(from, to, t0, t60, 100);
      expect(result.valid).toBe(true);
    });
  });
});

describe('helper functions', () => {
  describe('isValidLatitude', () => {
    it('accepts valid latitudes', () => {
      expect(isValidLatitude(0)).toBe(true);
      expect(isValidLatitude(45.5)).toBe(true);
      expect(isValidLatitude(-89.9)).toBe(true);
    });

    it('rejects invalid latitudes', () => {
      expect(isValidLatitude(90)).toBe(false);
      expect(isValidLatitude(-90)).toBe(false);
      expect(isValidLatitude(91)).toBe(false);
      expect(isValidLatitude(NaN)).toBe(false);
      expect(isValidLatitude('45')).toBe(false);
      expect(isValidLatitude(null)).toBe(false);
      expect(isValidLatitude(undefined)).toBe(false);
    });
  });

  describe('isValidLongitude', () => {
    it('accepts valid longitudes', () => {
      expect(isValidLongitude(0)).toBe(true);
      expect(isValidLongitude(98.341)).toBe(true);
      expect(isValidLongitude(-179.9)).toBe(true);
    });

    it('rejects invalid longitudes', () => {
      expect(isValidLongitude(180)).toBe(false);
      expect(isValidLongitude(-180)).toBe(false);
      expect(isValidLongitude(181)).toBe(false);
      expect(isValidLongitude(NaN)).toBe(false);
      expect(isValidLongitude('98')).toBe(false);
    });
  });

  describe('isDefinedNumber', () => {
    it('accepts defined numbers', () => {
      expect(isDefinedNumber(0)).toBe(true);
      expect(isDefinedNumber(42)).toBe(true);
      expect(isDefinedNumber(-3.14)).toBe(true);
    });

    it('rejects non-numbers', () => {
      expect(isDefinedNumber(null)).toBe(false);
      expect(isDefinedNumber(undefined)).toBe(false);
      expect(isDefinedNumber('42')).toBe(false);
      expect(isDefinedNumber(NaN)).toBe(false);
      expect(isDefinedNumber(Infinity)).toBe(false);
    });
  });
});

describe('geo utilities', () => {
  describe('equirectangularDistance', () => {
    it('calculates distance between same point as 0', () => {
      const pos = { latitude: 8.17, longitude: 98.341 };
      expect(equirectangularDistance(pos, pos)).toBe(0);
    });

    it('calculates ~111km for 1 degree of latitude', () => {
      const from = { latitude: 8.0, longitude: 98.0 };
      const to = { latitude: 9.0, longitude: 98.0 };
      const distance = equirectangularDistance(from, to);
      // 1 degree of latitude ≈ 111km
      expect(distance).toBeGreaterThan(110000);
      expect(distance).toBeLessThan(112000);
    });

    it('calculates reasonable distance for longitude at equator', () => {
      const from = { latitude: 0, longitude: 0 };
      const to = { latitude: 0, longitude: 1 };
      const distance = equirectangularDistance(from, to);
      // 1 degree of longitude at equator ≈ 111km
      expect(distance).toBeGreaterThan(110000);
      expect(distance).toBeLessThan(112000);
    });
  });

  describe('unit conversions', () => {
    it('converts m/s to knots correctly', () => {
      expect(msToKnots(1)).toBeCloseTo(1.94384, 4);
      expect(msToKnots(10)).toBeCloseTo(19.4384, 3);
    });

    it('converts knots to m/s correctly', () => {
      expect(knotsToMs(1.94384)).toBeCloseTo(1, 4);
      expect(knotsToMs(10)).toBeCloseTo(5.14444, 4);
    });

    it('round-trips conversions', () => {
      const original = 42.5;
      expect(knotsToMs(msToKnots(original))).toBeCloseTo(original, 10);
    });
  });
});
