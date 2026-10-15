/**
 * Reads the own vessel's recorded track from the Tracks plugin through the
 * server's Track API.
 */

import { Temporal } from '@js-temporal/polyfill';
import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';
import type { Fix, SignalKApp, TrackApi } from '../types';

/** The Tracks plugin's id, under which it registers as a Track API provider. */
export const TRACKS_PROVIDER_ID = 'tracks';

/** The server predates the Track API (signalk-server < 2.33). */
export class TrackApiUnsupportedError extends Error {
  constructor() {
    super(
      'This version needs Signal K server 2.33 or later and the Tracks plugin. ' +
        'On an older server, use version 1.4 of this plugin.'
    );
    this.name = 'TrackApiUnsupportedError';
  }
}

/** The Tracks plugin is not installed, not enabled, or not started yet. */
export class TracksNotRunningError extends Error {
  constructor(cause: unknown) {
    super('The Tracks plugin is not running. Install it from the App Store and enable it.', {
      cause,
    });
    this.name = 'TracksNotRunningError';
  }
}

const TracksResponseSchema = Type.Object({
  features: Type.Array(
    Type.Object({
      geometry: Type.Union([
        Type.Null(),
        Type.Object({
          // [longitude, latitude] per position, one array per segment
          coordinates: Type.Array(Type.Array(Type.Array(Type.Number(), { minItems: 2 }))),
        }),
      ]),
      properties: Type.Object({
        coordTimes: Type.Optional(Type.Array(Type.Array(Type.String()))),
      }),
    })
  ),
});

export type TracksResponse = Static<typeof TracksResponseSchema>;

export class TrackSource {
  constructor(private readonly app: SignalKApp) {}

  /** The own vessel's fixes recorded after `afterMs`, oldest first. */
  async fixesAfter(afterMs: number): Promise<Fix[]> {
    if (!this.app.getTrackApi) {
      throw new TrackApiUnsupportedError();
    }

    let api: TrackApi;
    try {
      api = await this.app.getTrackApi(TRACKS_PROVIDER_ID);
    } catch (err) {
      throw new TracksNotRunningError(err);
    }

    // Without `to`, the window runs to now and includes the newest fix.
    const response = await api.getTracks({
      contexts: ['vessels.self'],
      from: Temporal.Instant.fromEpochMilliseconds(afterMs + 1),
      times: true,
    });
    if (!Value.Check(TracksResponseSchema, response)) {
      throw new Error('The Tracks plugin answered with a track in an unexpected shape');
    }
    return toFixes(response, afterMs);
  }
}

/**
 * Flattens the segments of every returned feature into one time-ordered list.
 * A segment boundary is a gap in recording; NFL draws the track from the
 * points alone, so the boundaries carry nothing it uses.
 */
export function toFixes(response: TracksResponse, afterMs: number): Fix[] {
  const byTime = new Map<number, Fix>();

  for (const feature of response.features) {
    const segments = feature.geometry?.coordinates ?? [];
    const times = feature.properties.coordTimes ?? [];

    segments.forEach((segment, i) => {
      if (i >= times.length || times[i].length !== segment.length) {
        return;
      }
      const segmentTimes = times[i];
      segment.forEach(([longitude, latitude], j) => {
        const time = Date.parse(segmentTimes[j]);
        if (time > afterMs && !byTime.has(time)) {
          byTime.set(time, { time, latitude, longitude });
        }
      });
    });
  }

  return [...byTime.values()].sort((a, b) => a.time - b.time);
}
