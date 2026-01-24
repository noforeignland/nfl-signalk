/**
 * Signal K plugin to log track data to noforeignland.com
 * Version 1.2.0-beta.3 - TypeScript rewrite with velocity-based outlier filtering
 */

import { CronJob } from 'cron';
import type {
  SignalKApp,
  Plugin,
  PluginConfig,
  FlatConfig,
  ConfigSchema,
  SavedPosition,
} from './types';
import { ConfigManager } from './lib/ConfigManager';
import { PluginCleanup } from './lib/PluginCleanup';
import { TrackMigration } from './lib/TrackMigration';
import { TrackLogger } from './lib/TrackLogger';
import { TrackSender } from './lib/TrackSender';
import { HealthMonitor } from './lib/HealthMonitor';
import { DataPathEmitter } from './lib/DataPathEmitter';
import { createDir } from './lib/DirectoryUtils';

class SignalkToNoforeignland {
  private app: SignalKApp;
  private pluginId = 'signalk-to-noforeignland';
  private pluginName = 'Signal K to Noforeignland';

  // Runtime state
  private options: FlatConfig = {} as FlatConfig;
  private upSince: number | null = null;
  private cron: CronJob | null = null;
  private lastSuccessfulTransfer: Date | null = null;

  // Module instances
  private configManager: ConfigManager;
  private pluginCleanup: PluginCleanup;
  private dataPathEmitter: DataPathEmitter;
  private trackLogger: TrackLogger | null = null;
  private trackSender: TrackSender | null = null;
  private healthMonitor: HealthMonitor | null = null;
  private trackMigration: TrackMigration | null = null;

  constructor(app: SignalKApp) {
    this.app = app;
    this.configManager = new ConfigManager(app);
    this.pluginCleanup = new PluginCleanup(app);
    this.dataPathEmitter = new DataPathEmitter(app, this.pluginId);
  }

  /**
   * Get plugin schema
   */
  getSchema(): ConfigSchema {
    return ConfigManager.getSchema(this.pluginName);
  }

  /**
   * Get plugin object for SignalK
   */
  getPluginObject(): Plugin {
    return {
      id: this.pluginId,
      name: this.pluginName,
      description: 'SignalK track logger to noforeignland.com',
      schema: this.getSchema(),
      start: this.start.bind(this),
      stop: this.stop.bind(this),
    };
  }

  /**
   * Start the plugin
   */
  async start(config: PluginConfig = {}): Promise<void> {
    try {
      // 1. Migrate old config structure if needed
      const { options: migratedOptions, migrated } =
        await this.configManager.migrateOldConfig(config);

      // 2. Flatten config and apply defaults
      this.options = this.configManager.flattenConfig(migratedOptions);

      // 3. Validate API key
      try {
        this.configManager.validateApiKey(this.options);
      } catch (err) {
        const error = err as Error;
        this.app.debug(error.message);
        this.setPluginError(error.message);
        this.stop();
        return;
      }

      // 4. Resolve track directory path
      const dataDirPath = this.app.getDataDirPath();
      this.options.trackDir = this.configManager.resolveTrackDir(this.options, dataDirPath);

      // 5. Create track directory
      try {
        createDir(this.options.trackDir, this.app);
      } catch (err) {
        const error = err as Error;
        this.setPluginError(error.message);
        this.stop();
        return;
      }

      // 6. Cleanup old plugin versions (with callback handling)
      this.pluginCleanup
        .cleanup()
        .then((result) => {
          if (result === 'all_removed') {
            this.app.debug('Old plugins successfully cleaned up');
            // Update status if plugin started successfully
            if (this.options.boatApiKey) {
              this.setPluginStatus('Started (old plugins cleaned up)');
            }
          }
        })
        .catch((err: unknown) => {
          const error = err instanceof Error ? err : new Error(String(err));
          this.app.debug('Error in cleanupOldPlugin:', error.message);
        });

      // 7. Migrate old track files
      this.trackMigration = new TrackMigration(this.app, this.options.trackDir);
      await this.trackMigration.migrate();

      // 8. Initialize modules
      this.trackLogger = new TrackLogger(this.app, this.options, this.options.trackDir);
      this.trackSender = new TrackSender(this.app, this.options, this.options.trackDir);
      this.healthMonitor = new HealthMonitor(this.app, this.options);

      // 9. Update startup time and randomize CRON
      this.upSince = Date.now();
      this.options = this.configManager.randomizeCron(this.options);

      this.app.debug('Setting CRON to', this.options.apiCron);
      this.app.debug('trackFrequency is set to', this.options.trackFrequency, 'seconds');
      this.app.debug('track logger started, now logging to', this.options.trackDir);
      this.app.debug('maxVelocity filter set to', this.options.maxVelocity, 'm/s');

      // 10. Start logging
      this.trackLogger.startLogging((lastPosition: SavedPosition) => {
        this.handleSavePoint(lastPosition);
      });

      // 11. Start CRON job for sending data
      this.cron = new CronJob(this.options.apiCron, () => {
        void this.interval();
      });
      this.cron.start();

      // 12. Start health monitoring
      this.healthMonitor.start(
        () => this.trackLogger?.getLastPositionReceived() ?? null,
        () => this.trackLogger?.getAutoSelectedSource() ?? null,
        (errorMsg: string) => {
          this.setPluginError(errorMsg);
        },
        () => {
          this.handleHealthy();
        }
      );

      // 13. Set plugin status
      this.setPluginStatus(`Started${migrated ? ' (config migrated)' : ''}`);
    } catch (err) {
      const error = err as Error;
      this.app.debug('Error during plugin start:', error.message);
      this.setPluginError(`Failed to start: ${error.message}`);
      this.stop();
    }
  }

  /**
   * Handle savepoint event
   */
  handleSavePoint(lastPosition: SavedPosition): void {
    this.dataPathEmitter.emitSavepoint();

    // Update plugin status
    const activeSource =
      this.options.filterSource || this.trackLogger?.getAutoSelectedSource() || '';
    const sourcePrefix = activeSource ? `${activeSource} | ` : '';
    const saveTime = new Date(lastPosition.currentTime).toISOString();
    const transferTime = this.lastSuccessfulTransfer
      ? this.lastSuccessfulTransfer.toISOString()
      : 'None since start';

    this.setPluginStatus(`Save: ${saveTime} | Transfer: ${transferTime} | ${sourcePrefix}`);
  }

  /**
   * Handle healthy status from health monitor
   */
  handleHealthy(): void {
    // Clear error if position health is OK
    if (this.dataPathEmitter.getError()) {
      const lastPosition = this.trackLogger?.getLastPosition() ?? null;
      const activeSource =
        this.options.filterSource || this.trackLogger?.getAutoSelectedSource() || '';
      const sourcePrefix = activeSource ? `${activeSource} | ` : '';
      const saveTime = lastPosition
        ? new Date(lastPosition.currentTime).toISOString()
        : 'None since start';
      const transferTime = this.lastSuccessfulTransfer
        ? this.lastSuccessfulTransfer.toISOString()
        : 'None since start';

      this.setPluginStatus(`Save: ${saveTime} | Transfer: ${transferTime} | ${sourcePrefix}`);
    }
  }

  /**
   * CRON interval - check and send data
   */
  async interval(): Promise<void> {
    if (!this.trackSender || !this.trackLogger) return;

    try {
      // Check if boat is moving
      const lastPosition = this.trackLogger.getLastPosition();
      const boatMoving = this.trackSender.isBoatMoving(lastPosition, this.upSince ?? Date.now());
      if (!boatMoving) {
        return;
      }

      // Check if we have track data
      const hasTrack = await this.trackSender.hasTrackData();
      if (!hasTrack) {
        return;
      }

      // Send track data (has built-in retry logic)
      const success = await this.trackSender.sendTrack();

      if (success) {
        this.lastSuccessfulTransfer = new Date();
        this.dataPathEmitter.emitApiTransfer(this.lastSuccessfulTransfer);

        // Update status
        const activeSource =
          this.options.filterSource || this.trackLogger.getAutoSelectedSource() || '';
        const sourcePrefix = activeSource ? `${activeSource} | ` : '';
        const saveTime = lastPosition
          ? new Date(lastPosition.currentTime).toISOString()
          : 'None since start';
        const transferTime = this.lastSuccessfulTransfer.toISOString();

        this.setPluginStatus(`Save: ${saveTime} | Transfer: ${transferTime} | ${sourcePrefix}`);
      }
    } catch (err) {
      const error = err as Error;
      this.app.debug('Error during send interval:', error.message);
      this.setPluginError(`Failed to send track - ${error.message}`);
    }
  }

  /**
   * Stop the plugin
   */
  stop(): void {
    this.app.debug('plugin stopped');

    // Stop CRON job
    if (this.cron) {
      this.cron.stop();
      this.cron = null;
    }

    // Stop track logger
    if (this.trackLogger) {
      this.trackLogger.stop();
    }

    // Stop health monitor
    if (this.healthMonitor) {
      this.healthMonitor.stop();
    }

    this.app.setPluginStatus('Plugin stopped');
  }

  /**
   * Set plugin status and update data paths
   */
  setPluginStatus(status: string): void {
    this.dataPathEmitter.clearError();
    this.app.setPluginStatus(status);

    const lastPosition = this.trackLogger?.getLastPosition() ?? null;
    const autoSelectedSource = this.trackLogger?.getAutoSelectedSource() ?? null;

    this.dataPathEmitter.updateStatusPaths(
      this.options,
      lastPosition,
      this.lastSuccessfulTransfer,
      autoSelectedSource
    );
  }

  /**
   * Set plugin error and update data paths
   */
  setPluginError(error: string): void {
    this.dataPathEmitter.setError(error);
    this.app.setPluginError(error);

    const lastPosition = this.trackLogger?.getLastPosition() ?? null;
    const autoSelectedSource = this.trackLogger?.getAutoSelectedSource() ?? null;

    this.dataPathEmitter.updateStatusPaths(
      this.options,
      lastPosition,
      this.lastSuccessfulTransfer,
      autoSelectedSource
    );
  }
}

/**
 * Plugin factory function
 */
export default function (app: SignalKApp): Plugin {
  const instance = new SignalkToNoforeignland(app);
  return instance.getPluginObject();
}

// Also export as module.exports for CommonJS compatibility
module.exports = function (app: SignalKApp): Plugin {
  const instance = new SignalkToNoforeignland(app);
  return instance.getPluginObject();
};
