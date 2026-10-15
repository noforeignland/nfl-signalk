/**
 * Tests for position validation and velocity filter
 * These tests are critical - they verify the fix for Bruce's GPS anomalies
 */

import { describe, expect, it } from 'vitest';
import {
  validatePosition,
  isValidLatitude,
  isValidLongitude,
  isDefinedNumber,
  ZERO_THRESHOLD,
} from '../../src/utils/validation';
import { equirectangularDistance, msToKnots, knotsToMs } from '../../src/utils/geo';
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
      expect(validatePosition(null).valid).toBe(false);
    });

    it('rejects undefined position', () => {
      expect(validatePosition(undefined).valid).toBe(false);
    });

    it('rejects non-object position', () => {
      expect(validatePosition('invalid').valid).toBe(false);
    });

    it('rejects non-numeric coordinates', () => {
      expect(validatePosition({ latitude: 'foo', longitude: 0 }).valid).toBe(false);
      expect(validatePosition({ latitude: 0, longitude: 'bar' }).valid).toBe(false);
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
