/**
 * Tests for the version telemetry added to the track POST.
 *
 * NFL stores plugin/SK/Node versions per track to tell which plugin and release
 * a boat is uploading from. These must travel in the POST *body* (so the server
 * can persist them per track), not in headers. See the version-telemetry change.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import fetch, { Headers } from 'node-fetch';
import { TrackSender } from '../../src/lib/TrackSender';
import { NFL_PLUGIN_API_KEY } from '../../src/types/api';
import { createMockApp } from '../mocks/signalk-app';
import type { FlatConfig, Fix } from '../../src/types';

vi.mock('node-fetch', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node-fetch')>();
  return {
    default: vi.fn(),
    Headers: actual.Headers,
  };
});

const mockFetch = vi.mocked(fetch);

const PKG_VERSION = (
  JSON.parse(
    fs.readFileSync(path.join(import.meta.dirname, '..', '..', 'package.json'), 'utf8')
  ) as {
    version: string;
  }
).version;

function makeConfig(overrides: Partial<FlatConfig> = {}): FlatConfig {
  return {
    boatApiKey: 'test-boat-key',
    minMove: 50,
    minSpeed: 0,
    sendWhileMoving: true,
    ping_api_every_24h: true,
    trackFrequency: 60,
    apiCron: '*/10 * * * *',
    apiTimeout: 30,
    ...overrides,
  };
}

const FIXES: Fix[] = [
  { time: Date.parse('2026-06-23T10:00:00.000Z'), latitude: 52.1, longitude: 4.3 },
  { time: Date.parse('2026-06-23T10:01:00.000Z'), latitude: 52.2, longitude: 4.4 },
];

function okResponse(): Awaited<ReturnType<typeof fetch>> {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: () => Promise.resolve({ status: 'ok' }),
  } as unknown as Awaited<ReturnType<typeof fetch>>;
}

function errorResponse(status: number, statusText: string): Awaited<ReturnType<typeof fetch>> {
  return {
    ok: false,
    status,
    statusText,
    json: () => Promise.resolve({ status: 'error' }),
  } as unknown as Awaited<ReturnType<typeof fetch>>;
}

/** Pull the URLSearchParams body out of the single fetch call. */
function sentBody(): URLSearchParams {
  expect(mockFetch).toHaveBeenCalledTimes(1);
  const init = mockFetch.mock.calls[0][1];
  return init?.body as URLSearchParams;
}

describe('TrackSender version telemetry', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue(okResponse());
  });

  it('puts pluginVersion, skVersion and nodeVersion in the POST body', async () => {
    const app = createMockApp({ serverVersion: '2.14.0' });
    await new TrackSender(app, makeConfig()).sendFixes(FIXES);

    const body = sentBody();
    expect(body.get('pluginVersion')).toBe(PKG_VERSION);
    expect(body.get('skVersion')).toBe('2.14.0');
    expect(body.get('nodeVersion')).toBe(process.version);
  });

  it('sends the fixes as [time, latitude, longitude] stamped with the newest time', async () => {
    const app = createMockApp({ serverVersion: '2.14.0' });
    await new TrackSender(app, makeConfig()).sendFixes(FIXES);

    const body = sentBody();
    expect(body.get('boatApiKey')).toBe('test-boat-key');
    expect(body.get('timestamp')).toBe(String(FIXES[1].time));
    expect(JSON.parse(body.get('track') ?? '')).toEqual([
      [FIXES[0].time, 52.1, 4.3],
      [FIXES[1].time, 52.2, 4.4],
    ]);
  });

  it('falls back to "unknown" skVersion when the server exposes no version', async () => {
    await new TrackSender(createMockApp(), makeConfig()).sendFixes(FIXES);

    expect(sentBody().get('skVersion')).toBe('unknown');
  });

  it('keeps version fields out of the request headers (body-only contract)', async () => {
    const app = createMockApp({ serverVersion: '2.14.0' });
    await new TrackSender(app, makeConfig()).sendFixes(FIXES);

    const init = mockFetch.mock.calls[0][1];
    const headers = new Headers(init?.headers);
    expect(headers.get('X-NFL-API-Key')).toBe(NFL_PLUGIN_API_KEY);
    expect(headers.get('pluginVersion')).toBeNull();
    expect(headers.get('skVersion')).toBeNull();
    expect(headers.get('nodeVersion')).toBeNull();
  });
});

describe('TrackSender send behaviour', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('throws when no boat API key is configured', async () => {
    const sender = new TrackSender(createMockApp(), makeConfig({ boatApiKey: '' }));
    await expect(sender.sendFixes(FIXES)).rejects.toThrow('No boat API key');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('sends nothing for no fixes', async () => {
    await new TrackSender(createMockApp(), makeConfig()).sendFixes([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('does not retry a 4xx response and surfaces the error', async () => {
    mockFetch.mockResolvedValue(errorResponse(401, 'Unauthorized'));
    const sender = new TrackSender(createMockApp(), makeConfig());
    await expect(sender.sendFixes(FIXES)).rejects.toThrow('401');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('retries a 5xx response up to the retry limit', async () => {
    // sendWithRetry backs off 2000ms * attempt between tries (~6s total), so this
    // test needs a longer timeout than the 5s vitest default to see all 3 attempts.
    mockFetch.mockResolvedValue(errorResponse(503, 'Service Unavailable'));
    const sender = new TrackSender(createMockApp(), makeConfig());
    await expect(sender.sendFixes(FIXES)).rejects.toThrow('503');
    expect(mockFetch).toHaveBeenCalledTimes(3);
  }, 15000);

  it('requests the response uncompressed (compress: false)', async () => {
    mockFetch.mockResolvedValue(okResponse());
    await new TrackSender(createMockApp(), makeConfig()).sendFixes(FIXES);

    const init = mockFetch.mock.calls[0][1];
    expect(init?.compress).toBe(false);
  });

  it('treats HTTP 200 with an unreadable body as sent', async () => {
    // node-fetch shape of the Gunzip "Premature close" failure: the request was
    // delivered and the server answered 200, but reading the body throws.
    const prematureClose = Object.assign(
      new Error(
        'Invalid response body while trying to fetch https://example.invalid: Premature close'
      ),
      { name: 'FetchError', type: 'system', code: 'ERR_STREAM_PREMATURE_CLOSE' }
    );
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      json: () => Promise.reject(prematureClose),
    } as unknown as Awaited<ReturnType<typeof fetch>>);

    await expect(
      new TrackSender(createMockApp(), makeConfig()).sendFixes(FIXES)
    ).resolves.toBeUndefined();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('aborts a hanging body read via the attempt timeout and treats the 200 as sent', async () => {
    // The abort timer must stay armed until the body is read; if it is cleared
    // as soon as fetch() resolves, a body that never arrives leaves the upload
    // pending forever and the send cron never fires again.
    mockFetch.mockImplementation((_url, init) =>
      Promise.resolve({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => {
              reject(
                Object.assign(new Error('The user aborted a request.'), { name: 'AbortError' })
              );
            });
          }),
      } as unknown as Awaited<ReturnType<typeof fetch>>)
    );

    const sender = new TrackSender(createMockApp(), makeConfig({ apiTimeout: 1 }));
    await expect(sender.sendFixes(FIXES)).resolves.toBeUndefined();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  }, 10000);
});
