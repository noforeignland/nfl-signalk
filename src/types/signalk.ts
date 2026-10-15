/**
 * Signal K types for plugin development
 * Based on @signalk/server-api but simplified for this plugin's needs
 */

import type { PluginConfig, ConfigSchema } from './config';
import type { TrackApi } from './tracks';

/**
 * Signal K delta message
 */
export interface Delta {
  context?: string;
  updates: Update[];
}

/**
 * Update within a delta
 */
export interface Update {
  timestamp?: string;
  $source?: string;
  values?: PathValue[];
}

/**
 * Path-value pair
 */
export interface PathValue {
  path: string;
  value: unknown;
}

/**
 * Signal K App interface (subset used by this plugin)
 */
export interface SignalKApp {
  debug: (...args: unknown[]) => void;
  error: (msg: string) => void;
  setPluginStatus: (msg: string) => void;
  setPluginError: (msg: string) => void;
  getDataDirPath: () => string;
  savePluginOptions: (options: PluginConfig, callback: (err?: Error) => void) => void;
  handleMessage: (pluginId: string, delta: Partial<Delta>) => void;
  /** The own vessel's data model node at a path; checked at runtime, never trusted. */
  getSelfPath: (path: string) => unknown;
  /**
   * The Track API, from signalk-server 2.33.0. Absent on older servers, and
   * rejects when no plugin has registered the requested provider.
   */
  getTrackApi?: (providerId?: string) => Promise<TrackApi>;
  // Set by signalk-server from its own package.json; absent in older servers
  // and not guaranteed by @signalk/server-api, so read it defensively.
  config?: { version?: string };
}

/**
 * Plugin interface required by Signal K
 */
export interface Plugin {
  id: string;
  name: string;
  description?: string;
  schema: ConfigSchema | (() => ConfigSchema);
  start: (config: PluginConfig, restart: (newConfig: PluginConfig) => void) => void | Promise<void>;
  stop: () => void | Promise<void>;
}

/**
 * Callback types
 */
export type OnErrorCallback = (errorMsg: string) => void;
export type OnHealthyCallback = () => void;
export type GetLastPositionReceived = () => number | null;
export type GetPositionSource = () => string | null;
