import { describeFetchError } from '../../src/utils/errors';

describe('describeFetchError', () => {
  const URL = 'https://www.noforeignland.com/home/api/v1/boat/tracking/track';

  function fetchError(reason: string, extras: Record<string, unknown> = {}): Error {
    const err = new Error(`request to ${URL} failed, reason: ${reason}`);
    return Object.assign(err, extras);
  }

  it('substitutes the .code when the reason is blank (issue #44 signature)', () => {
    const err = fetchError('', { code: 'ECONNRESET', errno: 'ECONNRESET', type: 'system' });
    expect(describeFetchError(err)).toBe(`request to ${URL} failed, reason: ECONNRESET`);
  });

  it('falls back to .errno when .code is absent', () => {
    const err = fetchError('', { errno: 'ETIMEDOUT' });
    expect(describeFetchError(err)).toBe(`request to ${URL} failed, reason: ETIMEDOUT`);
  });

  it('falls back to .type when neither .code nor .errno is present', () => {
    const err = fetchError('', { type: 'system' });
    expect(describeFetchError(err)).toBe(`request to ${URL} failed, reason: system`);
  });

  it('emits a generic detail when no diagnostic field is available', () => {
    const err = fetchError('');
    expect(describeFetchError(err)).toBe(
      `request to ${URL} failed, reason: connection error (no further detail from the network layer)`
    );
  });

  it('leaves a non-blank reason untouched', () => {
    const err = fetchError('getaddrinfo ENOTFOUND www.noforeignland.com', { code: 'ENOTFOUND' });
    expect(describeFetchError(err)).toBe(
      `request to ${URL} failed, reason: getaddrinfo ENOTFOUND www.noforeignland.com`
    );
  });

  it('passes through ordinary error messages', () => {
    expect(describeFetchError(new Error('HTTP 503 Service Unavailable'))).toBe(
      'HTTP 503 Service Unavailable'
    );
  });

  it('returns a generic label for an empty, non-fetch message', () => {
    expect(describeFetchError(new Error(''))).toBe('Unknown error');
  });

  it('handles non-error inputs gracefully', () => {
    expect(describeFetchError(null)).toBe('Unknown error');
    expect(describeFetchError(undefined)).toBe('Unknown error');
    expect(describeFetchError('a string')).toBe('Unknown error');
  });

  it('ignores non-string diagnostic fields', () => {
    const err = fetchError('', { code: 42, errno: -4077, type: 'system' });
    expect(describeFetchError(err)).toBe(`request to ${URL} failed, reason: system`);
  });
});
