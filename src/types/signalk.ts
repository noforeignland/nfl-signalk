/**
 * Signal K types for plugin development
 * Based on @signalk/server-api but simplified for this plugin's needs
 */

import { FlatConfig, PluginConfig, ConfigSchema } from './config';

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
  source?: Source;
  $source?: string;
  values?: PathValue[];
}

/**
 * Source information
 */
export interface Source {
  label?: string;
  type?: string;
  src?: string;
}

/**
 * Path-value pair
 */
export interface PathValue {
  path: string;
  value: unknown;
}

/**
 * Subscription options
 */
export interface SubscribeOption {
  path: string;
  format?: 'delta';
  policy?: 'fixed' | 'instant';
  period?: number;
  minPeriod?: number;
}

/**
 * Subscription command
 */
export interface SubscribeCommand {
  context: string;
  subscribe: SubscribeOption[];
}

/**
 * Unsubscribe function type
 */
export type Unsubscribe = () => void;

/**
 * Subscription manager interface
 */
export interface SubscriptionManager {
  subscribe(
    command: SubscribeCommand,
    unsubscribes: Unsubscribe[],
    errorCallback: (err: unknown) => void,
    callback: (delta: Delta) => void
  ): void;
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
  subscriptionmanager: SubscriptionManager;
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
 * Plugin constructor function
 */
export type PluginConstructor = (app: SignalKApp) => Plugin;

/**
 * Position value from navigation.position path
 */
export interface PositionValue {
  latitude: number;
  longitude: number;
  altitude?: number;
}

/**
 * Callback types
 */
export type RestartPlugin = (newConfig: PluginConfig) => void;
export type OnSavePointCallback = (position: import('./position').SavedPosition) => void;
export type OnErrorCallback = (errorMsg: string) => void;
export type OnHealthyCallback = () => void;
export type GetLastPositionReceived = () => number | null;
export type GetAutoSelectedSource = () => string | null;

/**
 * Extended app interface for internal use
 */
export interface PluginApp extends SignalKApp {
  options?: FlatConfig;
}
