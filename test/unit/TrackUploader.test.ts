import { describe, expect, it, vi, type Mock } from 'vitest';
import {
  MAX_FIXES_PER_UPLOAD,
  TrackUploader,
  type UploaderDeps,
} from '../../src/lib/TrackUploader';
import type { UploadState } from '../../src/lib/UploadState';
import type { FlatConfig, Fix } from '../../src/types';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const NOW = Date.parse('2026-10-15T12:00:00Z');

/** A fix every minute heading north at about 6 knots, ending `endMinutesAgo` before NOW. */
function passage(count: number, endMinutesAgo = 0): Fix[] {
  const first = NOW - (endMinutesAgo + count - 1) * MINUTE;
  return Array.from({ length: count }, (_, i) => ({
    time: first + i * MINUTE,
    latitude: 52 + i * 0.00167,
    longitude: 4.3,
  }));
}

function makeConfig(overrides: Partial<FlatConfig> = {}): FlatConfig {
  return {
    boatApiKey: 'k',
    minMove: 0,
    minSpeed: 0,
    sendWhileMoving: true,
    ping_api_every_24h: true,
    trackFrequency: 0,
    apiCron: '* * * * *',
    apiTimeout: 30,
    ...overrides,
  };
}

interface Harness {
  deps: UploaderDeps & {
    fixesAfter: Mock<UploaderDeps['fixesAfter']>;
    saveState: Mock<UploaderDeps['saveState']>;
  };
  sent: Fix[][];
  state: () => UploadState | null;
  pending: () => Fix[];
}

function harness(options: {
  recorded?: Fix[];
  state?: UploadState | null;
  pending?: Fix[];
  current?: Fix | null;
  failOnSend?: number;
}): Harness {
  let state = options.state === undefined ? null : structuredClone(options.state);
  let pending = options.pending ?? [];
  const recorded = options.recorded ?? [];
  let sends = 0;
  const sent: Fix[][] = [];

  const deps = {
    fixesAfter: vi.fn((afterMs: number) =>
      Promise.resolve(recorded.filter((fix) => fix.time > afterMs))
    ),
    sendFixes: vi.fn((fixes: readonly Fix[]) => {
      sends += 1;
      if (sends === options.failOnSend) {
        return Promise.reject(new Error('HTTP 503 Service Unavailable'));
      }
      sent.push([...fixes]);
      return Promise.resolve();
    }),
    loadState: vi.fn(() => Promise.resolve(state === null ? null : structuredClone(state))),
    saveState: vi.fn((next: UploadState) => {
      state = structuredClone(next);
      return Promise.resolve();
    }),
    readPending: vi.fn(() => Promise.resolve(pending)),
    replacePending: vi.fn((remaining: readonly Fix[]) => {
      pending = [...remaining];
      return Promise.resolve();
    }),
    currentFix: vi.fn(() => options.current ?? null),
    debug: vi.fn(),
  };

  return {
    deps,
    sent,
    state: (): UploadState | null => state,
    pending: (): Fix[] => pending,
  };
}

describe('TrackUploader, first pass', () => {
  it('starts from now when 1.x left nothing pending, so recorded history is never resent', async () => {
    const h = harness({ recorded: passage(5, 60) });
    const result = await new TrackUploader(makeConfig({ ping_api_every_24h: false }), h.deps).run(
      NOW
    );

    expect(h.deps.fixesAfter).toHaveBeenCalledWith(NOW);
    expect(h.sent).toEqual([]);
    expect(result.uploaded).toBe(0);
    expect(h.state()).toEqual({ version: 1, cursor: NOW });
  });

  it('uploads what 1.x left pending, in chunks, then starts after its last fix', async () => {
    const pending = passage(MAX_FIXES_PER_UPLOAD + 500, 30);
    const h = harness({ pending });

    await new TrackUploader(makeConfig(), h.deps).run(NOW);

    expect(h.sent.map((chunk) => chunk.length)).toEqual([MAX_FIXES_PER_UPLOAD, 500]);
    expect(h.pending()).toEqual([]);
    const last = pending[pending.length - 1];
    expect(h.state()).toEqual({ version: 1, cursor: last.time, previous: last, uploaded: last });
    expect(h.deps.fixesAfter).toHaveBeenCalledWith(last.time);
  });

  it('keeps the unsent part of the pending file when an upload fails', async () => {
    const pending = passage(MAX_FIXES_PER_UPLOAD + 500, 30);
    const h = harness({ pending, failOnSend: 2 });

    await expect(new TrackUploader(makeConfig(), h.deps).run(NOW)).rejects.toThrow('503');

    expect(h.pending()).toEqual(pending.slice(MAX_FIXES_PER_UPLOAD));
    expect(h.state()).toBeNull();
  });
});

describe('TrackUploader, later passes', () => {
  const start: UploadState = { version: 1, cursor: NOW - 3 * HOUR };

  it('uploads what was recorded since the cursor and moves the cursor past it', async () => {
    const recorded = passage(10, 5);
    const h = harness({ recorded, state: start });

    const result = await new TrackUploader(makeConfig(), h.deps).run(NOW);

    expect(h.sent).toEqual([recorded]);
    expect(result).toEqual({ newestRecorded: recorded[9], uploaded: 10, deferred: false });
    expect(h.state()).toEqual({
      version: 1,
      cursor: recorded[9].time,
      previous: recorded[9],
      uploaded: recorded[9],
    });
  });

  it('does not resend anything after a restart', async () => {
    const recorded = passage(10, 5);
    const h = harness({ recorded, state: start });
    await new TrackUploader(makeConfig(), h.deps).run(NOW);
    await new TrackUploader(makeConfig(), h.deps).run(NOW + 10 * MINUTE);

    expect(h.sent).toEqual([recorded]);
  });

  it('resumes after the last chunk NFL accepted when a later one fails', async () => {
    const recorded = passage(MAX_FIXES_PER_UPLOAD * 2 + 10, 5);
    const before = { version: 1 as const, cursor: recorded[0].time - MINUTE };
    const h = harness({ recorded, state: before, failOnSend: 2 });

    await expect(new TrackUploader(makeConfig(), h.deps).run(NOW)).rejects.toThrow('503');
    const acceptedUpTo = recorded[MAX_FIXES_PER_UPLOAD - 1];
    expect(h.state()?.cursor).toBe(acceptedUpTo.time);
    expect(h.state()?.uploaded).toEqual(acceptedUpTo);

    await new TrackUploader(makeConfig(), h.deps).run(NOW);
    expect(h.sent.flat()).toEqual(recorded);
  });

  it('moves the cursor past fixes the filters left out', async () => {
    const anchored: Fix[] = Array.from({ length: 6 }, (_, i) => ({
      time: NOW - (6 - i) * MINUTE,
      latitude: 52 + (i % 2) * 0.00009,
      longitude: 4.3,
    }));
    const uploaded = { time: NOW - 2 * HOUR, latitude: 52, longitude: 4.3 };
    const h = harness({ recorded: anchored, state: { ...start, uploaded } });

    await new TrackUploader(makeConfig({ minMove: 80, minSpeed: 1.5 }), h.deps).run(NOW);

    expect(h.sent).toEqual([]);
    expect(h.state()).toEqual({
      ...start,
      cursor: anchored[5].time,
      previous: anchored[5],
      uploaded,
    });
  });

  it('holds the upload back while moving when sendWhileMoving is off, without losing it', async () => {
    const recorded = passage(10, 0);
    const h = harness({ recorded, state: start });
    const config = makeConfig({ sendWhileMoving: false, trackFrequency: 60 });

    const result = await new TrackUploader(config, h.deps).run(NOW);
    expect(result.deferred).toBe(true);
    expect(h.sent).toEqual([]);
    expect(h.deps.saveState).not.toHaveBeenCalled();

    await new TrackUploader(config, h.deps).run(NOW + HOUR);
    expect(h.sent).toEqual([recorded]);
  });
});

describe('TrackUploader, 24 hour keep-alive', () => {
  const longAgo = { time: NOW - 25 * HOUR, latitude: 52, longitude: 4.3 };
  const state: UploadState = {
    version: 1,
    cursor: NOW - HOUR,
    previous: longAgo,
    uploaded: longAgo,
  };
  const config = makeConfig({ minMove: 80 });

  it('sends the newest recorded fix when nothing passed the filters for a day', async () => {
    const atAnchor = [
      { time: NOW - 2 * MINUTE, latitude: 52.00001, longitude: 4.3 },
      { time: NOW - MINUTE, latitude: 52.00002, longitude: 4.3 },
    ];
    const h = harness({ recorded: atAnchor, state });

    await new TrackUploader(config, h.deps).run(NOW);

    expect(h.sent).toEqual([[atAnchor[1]]]);
    expect(h.state()?.uploaded).toEqual(atAnchor[1]);
    expect(h.state()?.cursor).toBe(atAnchor[1].time);
  });

  it('sends the live position when the Tracks plugin has recorded nothing new', async () => {
    const current = { time: NOW - 5_000, latitude: 52.00001, longitude: 4.3 };
    const h = harness({ state, current });

    await new TrackUploader(config, h.deps).run(NOW);

    expect(h.sent).toEqual([[current]]);
    expect(h.state()?.uploaded).toEqual(current);
    expect(h.state()?.cursor).toBe(state.cursor);
  });

  it('sends nothing within a day of the last upload, or when switched off', async () => {
    const current = { time: NOW - 5_000, latitude: 52.00001, longitude: 4.3 };
    const recent = { ...longAgo, time: NOW - 23 * HOUR };
    const h = harness({ state: { ...state, uploaded: recent }, current });
    await new TrackUploader(config, h.deps).run(NOW);
    expect(h.sent).toEqual([]);

    const off = harness({ state, current });
    await new TrackUploader({ ...config, ping_api_every_24h: false }, off.deps).run(NOW);
    expect(off.sent).toEqual([]);
  });

  it('does not send an invalid live position', async () => {
    const h = harness({ state, current: { time: NOW, latitude: 0, longitude: 0 } });
    await new TrackUploader(config, h.deps).run(NOW);
    expect(h.sent).toEqual([]);
  });
});
