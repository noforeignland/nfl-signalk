import { describe, expect, it, vi } from 'vitest';
import {
  TRACKS_PROVIDER_ID,
  TrackApiUnsupportedError,
  TrackSource,
  TracksNotRunningError,
  toFixes,
  type TracksResponse,
} from '../../src/lib/TrackSource';
import type { TrackApi } from '../../src/types';
import { createMockApp } from '../mocks/signalk-app';

const t = (iso: string): number => Date.parse(iso);

function feature(coordinates: [number, number][][], coordTimes?: string[][]): TracksResponse {
  return {
    features: [{ geometry: { coordinates }, properties: coordTimes ? { coordTimes } : {} }],
  };
}

describe('toFixes', () => {
  it('reads GeoJSON [longitude, latitude] pairs across segments, oldest first', () => {
    const response = feature(
      [
        [
          [4.3, 52.1],
          [4.4, 52.2],
        ],
        [[4.5, 52.3]],
      ],
      [['2026-10-01T12:00:00Z', '2026-10-01T12:01:00Z'], ['2026-10-01T13:00:00Z']]
    );
    expect(toFixes(response, 0)).toEqual([
      { time: t('2026-10-01T12:00:00Z'), latitude: 52.1, longitude: 4.3 },
      { time: t('2026-10-01T12:01:00Z'), latitude: 52.2, longitude: 4.4 },
      { time: t('2026-10-01T13:00:00Z'), latitude: 52.3, longitude: 4.5 },
    ]);
  });

  it('keeps only fixes after the given time, once per timestamp, sorted', () => {
    const response: TracksResponse = {
      features: [
        {
          geometry: {
            coordinates: [
              [
                [4.4, 52.2],
                [4.3, 52.1],
              ],
            ],
          },
          properties: { coordTimes: [['2026-10-01T12:02:00Z', '2026-10-01T12:01:00Z']] },
        },
        {
          geometry: {
            coordinates: [
              [
                [9, 9],
                [4.4, 52.2],
              ],
            ],
          },
          properties: { coordTimes: [['2026-10-01T12:00:00Z', '2026-10-01T12:02:00Z']] },
        },
      ],
    };
    expect(toFixes(response, t('2026-10-01T12:00:00Z'))).toEqual([
      { time: t('2026-10-01T12:01:00Z'), latitude: 52.1, longitude: 4.3 },
      { time: t('2026-10-01T12:02:00Z'), latitude: 52.2, longitude: 4.4 },
    ]);
  });

  it('skips a segment whose times do not line up with its positions', () => {
    const response = feature(
      [
        [
          [4.3, 52.1],
          [4.4, 52.2],
        ],
        [[4.5, 52.3]],
      ],
      [['2026-10-01T12:00:00Z']]
    );
    expect(toFixes(response, 0)).toEqual([]);
  });

  it('returns nothing for a feature without geometry or times', () => {
    expect(toFixes({ features: [{ geometry: null, properties: {} }] }, 0)).toEqual([]);
    expect(toFixes(feature([[[4.3, 52.1]]]), 0)).toEqual([]);
  });
});

describe('TrackSource.fixesAfter', () => {
  it('asks the Tracks provider for the own vessel, with times, from just after the cursor', async () => {
    const getTracks = vi.fn<TrackApi['getTracks']>(() => Promise.resolve({ features: [] }));
    const app = createMockApp({ trackApi: { getTracks } });
    const getTrackApi = vi.spyOn(app, 'getTrackApi');

    await new TrackSource(app).fixesAfter(1_000);

    expect(getTrackApi).toHaveBeenCalledWith(TRACKS_PROVIDER_ID);
    const query = getTracks.mock.calls[0][0];
    expect(query.contexts).toEqual(['vessels.self']);
    expect(query.times).toBe(true);
    expect(query.from?.epochMilliseconds).toBe(1_001);
  });

  it('reports a server without the Track API', async () => {
    const source = new TrackSource(createMockApp());
    await expect(source.fixesAfter(0)).rejects.toBeInstanceOf(TrackApiUnsupportedError);
  });

  it('reports a missing Tracks provider', async () => {
    const app = createMockApp();
    app.getTrackApi = (): Promise<TrackApi> =>
      Promise.reject(new Error("Track api provider 'tracks' not found"));
    await expect(new TrackSource(app).fixesAfter(0)).rejects.toBeInstanceOf(TracksNotRunningError);
  });

  it('refuses an answer in an unexpected shape', async () => {
    const app = createMockApp({
      trackApi: { getTracks: () => Promise.resolve({ type: 'FeatureCollection' }) },
    });
    await expect(new TrackSource(app).fixesAfter(0)).rejects.toThrow('unexpected shape');
  });
});
