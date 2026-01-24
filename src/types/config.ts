/**
 * Plugin configuration as stored (nested structure)
 */
export interface PluginConfig {
  mandatory?: {
    boatApiKey?: string;
  };
  advanced?: {
    minMove?: number;
    minSpeed?: number;
    sendWhileMoving?: boolean;
    ping_api_every_24h?: boolean;
  };
  expert?: {
    filterSource?: string;
    trackDir?: string;
    keepFiles?: boolean;
    trackFrequency?: number;
    apiCron?: string;
    apiTimeout?: number;
    maxVelocity?: number;
  };
  // Legacy flat config fields (for migration)
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
  filterSource?: string;
  trackDir: string;
  keepFiles: boolean;
  trackFrequency: number;
  apiCron: string;
  apiTimeout: number;
  maxVelocity: number;
}

/**
 * JSON Schema for plugin configuration UI
 */
export interface ConfigSchema {
  title: string;
  description: string;
  type: 'object';
  properties: Record<string, unknown>;
}
