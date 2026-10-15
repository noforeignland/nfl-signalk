/**
 * Position validation utilities
 */

/**
 * Result of a validation check
 */
export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

/**
 * Threshold for near-zero position check (degrees)
 * Positions within this distance from (0,0) are likely GPS initialization values
 */
export const ZERO_THRESHOLD = 0.01;

/**
 * Validate a position for basic sanity
 * Checks for:
 * - Near (0,0) positions (likely GPS init values)
 * - Out of WGS84 range values
 * - Non-numeric values
 *
 * @param position Position to validate
 * @returns Validation result with reason if invalid
 */
export function validatePosition(position: unknown): ValidationResult {
  // Check for null/undefined/non-object
  if (position === null || position === undefined || typeof position !== 'object') {
    return { valid: false, reason: 'Position is null or not an object' };
  }

  const posObj = position as Record<string, unknown>;
  const latitude = posObj.latitude;
  const longitude = posObj.longitude;

  // Check for non-numeric values
  if (typeof latitude !== 'number' || typeof longitude !== 'number') {
    return { valid: false, reason: 'Latitude or longitude is not a number' };
  }

  // Check for NaN or Infinity
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return { valid: false, reason: 'Latitude or longitude is NaN or Infinity' };
  }

  // Near (0,0) check - likely GPS initialization value
  if (Math.abs(latitude) <= ZERO_THRESHOLD && Math.abs(longitude) <= ZERO_THRESHOLD) {
    return { valid: false, reason: 'Position near (0,0) - likely GPS initialization value' };
  }

  // WGS84 range check
  if (latitude <= -90 || latitude >= 90) {
    return {
      valid: false,
      reason: `Invalid latitude: ${String(latitude)} (must be between -90 and 90)`,
    };
  }

  if (longitude <= -180 || longitude >= 180) {
    return {
      valid: false,
      reason: `Invalid longitude: ${String(longitude)} (must be between -180 and 180)`,
    };
  }

  return { valid: true };
}

/**
 * Check if a value is a valid latitude
 */
export function isValidLatitude(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > -90 && value < 90;
}

/**
 * Check if a value is a valid longitude
 */
export function isValidLongitude(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > -180 && value < 180;
}

/**
 * Check if a value is a defined number
 */
export function isDefinedNumber(value: unknown): value is number {
  return (
    value !== undefined && value !== null && typeof value === 'number' && Number.isFinite(value)
  );
}
