/**
 * Configuration management for the plugin
 */

import path from 'node:path';
import type { SignalKApp, PluginConfig, FlatConfig, ConfigSchema } from '../types';
import { CONFIG_DEFAULTS, configSchema } from './configSchema';

interface MigrationResult {
  options: PluginConfig;
  migrated: boolean;
}

export class ConfigManager {
  private app: SignalKApp;

  constructor(app: SignalKApp) {
    this.app = app;
  }

  /**
   * Migrate old flat config structure to new grouped structure
   */
  async migrateOldConfig(options: PluginConfig): Promise<MigrationResult> {
    if (options.boatApiKey && !options.mandatory) {
      this.app.debug('Migrating old configuration to new grouped structure');

      const migratedOptions: PluginConfig = {
        mandatory: {
          boatApiKey: options.boatApiKey,
        },
        advanced: {
          minMove: options.minMove !== undefined ? options.minMove : 50,
          minSpeed: options.minSpeed !== undefined ? options.minSpeed : 1.5,
          sendWhileMoving: options.sendWhileMoving !== undefined ? options.sendWhileMoving : true,
          ping_api_every_24h:
            options.ping_api_every_24h !== undefined ? options.ping_api_every_24h : true,
        },
        expert: {
          filterSource: options.filterSource,
          trackDir: options.trackDir,
          keepFiles: options.keepFiles !== undefined ? options.keepFiles : false,
          trackFrequency: options.trackFrequency !== undefined ? options.trackFrequency : 60,
          apiCron: options.apiCron || '*/10 * * * *',
          apiTimeout: options.apiTimeout !== undefined ? options.apiTimeout : 30,
        },
      };

      try {
        this.app.debug('Saving migrated configuration...');
        await new Promise<void>((resolve, reject) => {
          this.app.savePluginOptions(migratedOptions, (err?: Error) => {
            if (err) {
              reject(err);
            } else {
              this.app.debug('Configuration successfully migrated and saved');
              resolve();
            }
          });
        });
        return { options: migratedOptions, migrated: true };
      } catch (err) {
        const error = err as Error;
        this.app.debug('Failed to save migrated configuration:', error.message);
        return { options: migratedOptions, migrated: true };
      }
    }

    return { options, migrated: false };
  }

  /**
   * Flatten nested config structure and apply defaults
   */
  flattenConfig(options: PluginConfig): FlatConfig {
    return {
      boatApiKey: options.mandatory?.boatApiKey ?? '',
      minMove: options.advanced?.minMove ?? CONFIG_DEFAULTS.minMove,
      minSpeed: options.advanced?.minSpeed ?? CONFIG_DEFAULTS.minSpeed,
      sendWhileMoving: options.advanced?.sendWhileMoving ?? CONFIG_DEFAULTS.sendWhileMoving,
      ping_api_every_24h:
        options.advanced?.ping_api_every_24h ?? CONFIG_DEFAULTS.ping_api_every_24h,
      filterSource: options.expert?.filterSource,
      trackDir: options.expert?.trackDir || CONFIG_DEFAULTS.trackDir,
      keepFiles: options.expert?.keepFiles ?? CONFIG_DEFAULTS.keepFiles,
      trackFrequency: options.expert?.trackFrequency ?? CONFIG_DEFAULTS.trackFrequency,
      apiCron: options.expert?.apiCron || CONFIG_DEFAULTS.apiCron,
      apiTimeout: options.expert?.apiTimeout ?? CONFIG_DEFAULTS.apiTimeout,
      maxVelocity: options.expert?.maxVelocity ?? CONFIG_DEFAULTS.maxVelocity,
    };
  }

  /**
   * Validate boat API key
   */
  validateApiKey(config: FlatConfig): void {
    if (!config.boatApiKey || config.boatApiKey.trim() === '') {
      throw new Error(
        'No boat API key configured. Please set your API key in plugin settings ' +
          '(Mandatory Settings > Boat API key). You can find your API key at ' +
          'noforeignland.com under Account > Settings > Boat tracking > API Key.'
      );
    }
  }

  /**
   * Resolve track directory path (absolute or relative to data dir)
   */
  resolveTrackDir(config: FlatConfig, dataDirPath: string): string {
    if (!path.isAbsolute(config.trackDir)) {
      return path.join(dataDirPath, config.trackDir);
    }
    return config.trackDir;
  }

  /**
   * Randomize CRON schedule to avoid all instances running at same time
   */
  randomizeCron(config: FlatConfig): FlatConfig {
    if (!config.apiCron || config.apiCron === CONFIG_DEFAULTS.apiCron) {
      const startMinute = Math.floor(Math.random() * 10);
      const startSecond = Math.floor(Math.random() * 60);
      config.apiCron = `${String(startSecond)} ${String(startMinute)}/10 * * * *`;
    }
    return config;
  }

  /**
   * Get the full schema for plugin configuration
   */
  static getSchema(pluginName: string): ConfigSchema {
    return configSchema(pluginName);
  }
}

export default ConfigManager;
