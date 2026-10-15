import type { StoredConfig } from '../lib/configSchema';

/**
 * Plugin configuration as stored: the schema's nested groups, plus the flat
 * keys of configurations saved before the groups existed, which
 * ConfigManager.migrateOldConfig moves into them.
 */
export type PluginConfig = StoredConfig & LegacyFlatConfig;

interface LegacyFlatConfig {
  boatApiKey?: string;
  minMove?: number;
  minSpeed?: number;
  sendWhileMoving?: boolean;
  ping_api_every_24h?: boolean;
  filterSource?: string;
  trackDir?: string;
  keepFiles?: boolean;
  trackFrequency?: number;
  apiCron?: string;
  apiTimeout?: number;
  internetTestTimeout?: number;
}

/**
 * Flattened configuration with defaults applied
 */
export interface FlatConfig {
  boatApiKey: string;
  minMove: number;
  minSpeed: number;
  sendWhileMoving: boolean;
  ping_api_every_24h: boolean;
  trackFrequency: number;
  apiCron: string;
  apiTimeout: number;
}

export type { ConfigSchema } from '../lib/configSchema';
