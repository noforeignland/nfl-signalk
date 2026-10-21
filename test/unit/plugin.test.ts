import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import fetch, { Response } from 'node-fetch';
import createPlugin from '../../src/index';
import type { PluginConfig, TrackApi, TracksRequest } from '../../src/types';
import { createMockApp } from '../mocks/signalk-app';

vi.mock('node-fetch', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node-fetch')>();
  return { default: vi.fn(), Headers: actual.Headers, Response: actual.Response };
});
const mockFetch = vi.mocked(fetch);

const CONFIG: PluginConfig = {
  mandatory: { boatApiKey: 'key' },
  advanced: { ping_api_every_24h: false },
};
const FIRST_PASS_DELAY_MS = 2 * 60 * 1000;
const HEALTH_CHECK_MS = 5 * 60 * 1000;

const livePosition = (): object => ({
  value: { latitude: 52.1, longitude: 4.3 },
  timestamp: new Date().toISOString(),
  $source: 'gps',
});

/** A provider answering with one fix of the own vessel, just after the cursor it is asked for. */
const oneFixAfterCursor: TrackApi = {
  getTracks: (query: TracksRequest) => {
    const time = (query.from?.epochMilliseconds ?? 0) + 500;
    return Promise.resolve({
      features: [
        {
          geometry: { coordinates: [[[4.3, 52.1]]] },
          properties: { coordTimes: [[new Date(time).toISOString()]] },
        },
      ],
    });
  },
};

const deltaPaths = (calls: unknown[][]): string[] =>
  calls.flatMap((call) => {
    const delta = call[1] as { updates: { values: { path: string }[] }[] };
    return delta.updates.flatMap((update) => update.values.map((value) => value.path));
  });

let dataDir: string;

beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nfl-plugin-'));
});

afterEach(async () => {
  vi.useRealTimers();
  await fs.rm(dataDir, { recursive: true, force: true, maxRetries: 3 });
});

describe('plugin start', () => {
  it('refuses to start without a boat API key', async () => {
    const app = createMockApp({ dataDir, trackApi: { getTracks: vi.fn() } });
    await createPlugin(app).start({}, vi.fn());
    expect(app._mocks.setPluginError).toHaveBeenCalledWith(
      expect.stringContaining('No boat API key configured')
    );
  });

  it('refuses to start on a server without the Track API, naming the version to use instead', async () => {
    const app = createMockApp({ dataDir });
    await createPlugin(app).start(CONFIG, vi.fn());
    expect(app._mocks.setPluginError).toHaveBeenCalledWith(
      expect.stringContaining('Signal K server 2.33 or later')
    );
    expect(app._mocks.setPluginError).toHaveBeenCalledWith(expect.stringContaining('version 1.4'));
  });
});

describe('plugin stop', () => {
  it('leaves the status alone when a pass finishes after the plugin stopped', async () => {
    vi.useFakeTimers();
    let answer: (value: unknown) => void = () => undefined;
    const getTracks = vi.fn(
      () =>
        new Promise<unknown>((resolve) => {
          answer = resolve;
        })
    );
    const app = createMockApp({
      dataDir,
      trackApi: { getTracks },
      selfPath: {
        value: { latitude: 52.1, longitude: 4.3 },
        timestamp: new Date().toISOString(),
        $source: 'gps',
      },
    });
    const plugin = createPlugin(app);

    await plugin.start(CONFIG, vi.fn());
    await vi.advanceTimersByTimeAsync(FIRST_PASS_DELAY_MS);
    await vi.waitFor(() => {
      expect(getTracks).toHaveBeenCalled();
    });

    await plugin.stop();
    const deltasBeforeAnswer = app._mocks.handleMessage.mock.calls.length;
    answer({ features: [] });
    await vi.runOnlyPendingTimersAsync();

    expect(app._mocks.setPluginStatus).toHaveBeenLastCalledWith('Plugin stopped');
    expect(app._mocks.handleMessage.mock.calls.length).toBe(deltasBeforeAnswer);
  });
});

describe('plugin status', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockFetch.mockReset();
    // A body can be read once, so every call gets its own response.
    mockFetch.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ status: 'ok' }), { status: 200 }))
    );
  });

  it('reports the newest recorded fix and the upload after a pass', async () => {
    const app = createMockApp({ dataDir, trackApi: oneFixAfterCursor, selfPath: livePosition() });
    await createPlugin(app).start(CONFIG, vi.fn());
    await vi.advanceTimersByTimeAsync(FIRST_PASS_DELAY_MS);
    await vi.waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
    await vi.waitFor(() => {
      expect(app._mocks.setPluginStatus).toHaveBeenLastCalledWith(
        expect.stringMatching(/^Save: \S+Z \| Transfer: \S+Z \| gps$/)
      );
    });

    expect(deltaPaths(app._mocks.handleMessage.mock.calls)).toEqual(
      expect.arrayContaining([
        'noforeignland.savepoint',
        'noforeignland.sent_to_api',
        'noforeignland.status',
        'noforeignland.source',
        'noforeignland.status_boolean',
      ])
    );
  });

  it('keeps a Tracks error ahead of a healthy GNSS check', async () => {
    const app = createMockApp({ dataDir, selfPath: livePosition() });
    app.getTrackApi = (): Promise<TrackApi> => Promise.reject(new Error('not found'));
    await createPlugin(app).start(CONFIG, vi.fn());

    await vi.advanceTimersByTimeAsync(FIRST_PASS_DELAY_MS);
    await vi.waitFor(() => {
      expect(app._mocks.setPluginError).toHaveBeenCalledWith(
        expect.stringContaining('The Tracks plugin is not running')
      );
    });
    app._mocks.getSelfPath.mockImplementation(livePosition);
    const statusCalls = app._mocks.setPluginStatus.mock.calls.length;

    await vi.advanceTimersByTimeAsync(HEALTH_CHECK_MS);

    expect(app._mocks.setPluginStatus.mock.calls.length).toBe(statusCalls);
    expect(app._mocks.setPluginError).toHaveBeenLastCalledWith(
      expect.stringContaining('The Tracks plugin is not running')
    );
  });

  it('drops an error from the previous configuration when restarted', async () => {
    // The pass never gets an answer, so only the health check updates the status.
    const getTracks = vi.fn(() => new Promise<unknown>(() => undefined));
    const app = createMockApp({ dataDir, trackApi: { getTracks }, selfPath: livePosition() });
    const plugin = createPlugin(app);
    await plugin.start({}, vi.fn());
    expect(app._mocks.setPluginError).toHaveBeenCalledTimes(1);

    await plugin.stop();
    await plugin.start(CONFIG, vi.fn());
    app._mocks.getSelfPath.mockImplementation(livePosition);
    await vi.advanceTimersByTimeAsync(HEALTH_CHECK_MS);
    // By the time it asks the Tracks plugin, the pass has written its state.
    await vi.waitFor(() => {
      expect(getTracks).toHaveBeenCalled();
    });

    expect(app._mocks.setPluginError).toHaveBeenCalledTimes(1);
    expect(app._mocks.setPluginStatus).toHaveBeenLastCalledWith(
      expect.stringMatching(/^Save: None since start \| Transfer: None since start \| gps$/)
    );
  });
});
