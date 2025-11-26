const CronJob = require('cron').CronJob;

// Import all modules
const ConfigManager = require('./lib/ConfigManager');
const PluginCleanup = require('./lib/PluginCleanup');
const TrackMigration = require('./lib/TrackMigration');
const TrackLogger = require('./lib/TrackLogger');
const TrackSender = require('./lib/TrackSender');
const HealthMonitor = require('./lib/HealthMonitor');
const DataPathEmitter = require('./lib/DataPathEmitter');
const DirectoryUtils = require('./lib/DirectoryUtils');

class SignalkToNoforeignland {
  constructor(app) {
    this.app = app;
    this.pluginId = 'signalk-to-noforeignland';
    this.pluginName = 'Signal K to Noforeignland';

    // Runtime state
    this.options = {};
    this.upSince = null;
    this.cron = null;
    this.lastSuccessfulTransfer = null;
    
    // Module instances
    this.configManager = new ConfigManager(app);
    this.pluginCleanup = new PluginCleanup(app);
    this.dataPathEmitter = new DataPathEmitter(app, this.pluginId);
    this.trackLogger = null;
    this.trackSender = null;
    this.healthMonitor = null;
    this.trackMigration = null;
  }

  /**
   * Get plugin schema
   */
  getSchema() {
    return ConfigManager.getSchema(this.pluginName);
  }

  /**
   * Get plugin object for SignalK
   */
  getPluginObject() {
    return {
      id: this.pluginId,
      name: this.pluginName,
      description: 'SignalK track logger to noforeignland.com',
      schema: this.getSchema(),
      start: this.start.bind(this),
      stop: this.stop.bind(this)
    };
  }

  /**
   * Start the plugin
   */
  async start(options = {}, restartPlugin) {
    try {
      // 1. Migrate old config structure if needed
      const { options: migratedOptions, migrated } = await this.configManager.migrateOldConfig(options);
      options = migratedOptions;
      
      // 2. Flatten config and apply defaults
      this.options = this.configManager.flattenConfig(options);
      
      // 3. Validate API key
      try {
        this.configManager.validateApiKey(this.options);
      } catch (err) {
        this.app.debug(err.message);
        this.setPluginError(err.message);
        this.stop();
        return;
      }
      
      // 4. Resolve track directory path
      const dataDirPath = this.app.getDataDirPath();
      this.options.trackDir = this.configManager.resolveTrackDir(this.options, dataDirPath);
      
      // 5. Create track directory
      try {
        DirectoryUtils.createDir(this.options.trackDir, this.app);
      } catch (err) {
        this.setPluginError(err.message);
        this.stop();
        return;
      }
      
      // 6. Cleanup old plugin versions (with callback handling)
      this.pluginCleanup.cleanup()
        .then((result) => {
          if (result === 'all_removed') {
            this.app.debug('Old plugins successfully cleaned up');
            // Update status if plugin started successfully
            if (this.options.boatApiKey) {
              this.setPluginStatus('Started (old plugins cleaned up)');
            }
          }
        })
        .catch(err => {
          this.app.debug('Error in cleanupOldPlugin:', err.message);
        });
      
      // 7. Migrate old track files
      this.trackMigration = new TrackMigration(this.app, this.options.trackDir);
      await this.trackMigration.migrate();
      
      // 8. Initialize modules
      this.trackLogger = new TrackLogger(this.app, this.options, this.options.trackDir);
      this.trackSender = new TrackSender(this.app, this.options, this.options.trackDir);
      this.healthMonitor = new HealthMonitor(this.app, this.options);
      
      // 9. Update startup time and randomize CRON
      this.upSince = new Date().getTime();
      this.options = this.configManager.randomizeCron(this.options);
      
      this.app.debug('Setting CRON to', this.options.apiCron);
      this.app.debug('trackFrequency is set to', this.options.trackFrequency, 'seconds');
      this.app.debug('track logger started, now logging to', this.options.trackDir);
      
      // 10. Start logging
      this.trackLogger.startLogging((lastPosition) => {
        this.handleSavePoint(lastPosition);
      });
      
      // 11. Start CRON job for sending data
      this.cron = new CronJob(this.options.apiCron, this.interval.bind(this));
      this.cron.start();
      
      // 12. Start health monitoring
      this.healthMonitor.start(
        () => this.trackLogger.getLastPositionReceived(),
        () => this.trackLogger.getAutoSelectedSource(),
        (errorMsg) => this.setPluginError(errorMsg),
        () => this.handleHealthy()
      );
      
      // 13. Set plugin status
      this.setPluginStatus(`Started${migrated ? ' (config migrated)' : ''}`);
      
    } catch (err) {
      this.app.debug('Error during plugin start:', err.message);
      this.setPluginError(`Failed to start: ${err.message}`);
      this.stop();
    }
  }

  /**
   * Handle savepoint event
   */
  handleSavePoint(lastPosition) {
    const now = new Date();
    this.dataPathEmitter.emitSavepoint();
    
    // Update plugin status
    const activeSource = this.options.filterSource || this.trackLogger.getAutoSelectedSource() || '';
    const sourcePrefix = activeSource ? `${activeSource} | ` : '';
    const saveTime = now.toISOString();
    const transferTime = this.lastSuccessfulTransfer 
      ? this.lastSuccessfulTransfer.toISOString() 
      : 'None since start';
    
    this.setPluginStatus(`Save: ${saveTime} | Transfer: ${transferTime} | ${sourcePrefix}`);
  }

  /**
   * Handle healthy status from health monitor
   */
  handleHealthy() {
    // Clear error if position health is OK
    if (this.dataPathEmitter.getError()) {
      const lastPosition = this.trackLogger.getLastPosition();
      const activeSource = this.options.filterSource || this.trackLogger.getAutoSelectedSource() || '';
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
  async interval() {
    try {
      // Check if boat is moving
      const lastPosition = this.trackLogger.getLastPosition();
      const boatMoving = this.trackSender.isBoatMoving(lastPosition, this.upSince);
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
        const activeSource = this.options.filterSource || this.trackLogger.getAutoSelectedSource() || '';
        const sourcePrefix = activeSource ? `${activeSource} | ` : '';
        const saveTime = lastPosition 
          ? new Date(lastPosition.currentTime).toISOString() 
          : 'None since start';
        const transferTime = this.lastSuccessfulTransfer.toISOString();
        
        this.setPluginStatus(`Save: ${saveTime} | Transfer: ${transferTime} | ${sourcePrefix}`);
      }
      
    } catch (err) {
      this.app.debug('Error during send interval:', err.message);
      this.setPluginError(`Failed to send track - ${err.message}`);
    }
  }

  /**
   * Stop the plugin
   */
  stop() {
    this.app.debug('plugin stopped');
    
    // Stop CRON job
    if (this.cron) {
      this.cron.stop();
      this.cron = undefined;
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
  setPluginStatus(status) {
    this.dataPathEmitter.clearError();
    this.app.setPluginStatus(status);
    
    const lastPosition = this.trackLogger ? this.trackLogger.getLastPosition() : null;
    const autoSelectedSource = this.trackLogger ? this.trackLogger.getAutoSelectedSource() : null;
    
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
  setPluginError(error) {
    this.dataPathEmitter.setError(error);
    this.app.setPluginError(error);
    
    const lastPosition = this.trackLogger ? this.trackLogger.getLastPosition() : null;
    const autoSelectedSource = this.trackLogger ? this.trackLogger.getAutoSelectedSource() : null;
    
    this.dataPathEmitter.updateStatusPaths(
      this.options,
      lastPosition,
      this.lastSuccessfulTransfer,
      autoSelectedSource
    );
  }
}

module.exports = function (app) {
  const instance = new SignalkToNoforeignland(app);
  return instance.getPluginObject();
};