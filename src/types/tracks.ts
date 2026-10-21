/**
 * The part of the Signal K Track API this plugin uses, as declared in
 * `@signalk/server-api/tracks` (server 2.33.0 and later). Declared here
 * because importing that module's types pulls in its express and ws typings,
 * which this plugin does not install. The response is checked at runtime in
 * TrackSource rather than trusted, since it comes from another plugin.
 */

import type { Temporal } from '@js-temporal/polyfill';

export interface TracksRequest {
  /** `vessels.self` is resolved by the provider. Without contexts it answers for every vessel. */
  contexts?: string[];
  from?: Temporal.Instant;
  times?: boolean;
}

export interface TrackApi {
  getTracks(query: TracksRequest): Promise<unknown>;
}
