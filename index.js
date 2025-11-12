const { EOL } = require('os');
const fs = require('fs-extra');
const path = require('path');
const CronJob = require('cron').CronJob;
const readline = require('readline');
const fetch = require('node-fetch');

const apiUrl = 'https://www.noforeignland.com/home/api/v1/boat/tracking/track';
const pluginApiKey = '0ede6cb6-5213-45f5-8ab4-b4836b236f97';
const defaultTracksDir = 'nfl-track';
const routeSaveName = 'pending.jsonl';
const routeSentName = 'sent.jsonl';

class SignalkToNoforeignland {
  constructor(app) {
    this.app = app;
    this.pluginId = 'signalk-to-noforeignland';
    this.pluginName = 'Signal K to Noforeignland';
    this.creator = 'signalk-track-logger';

    // runtime state
    this.unsubscribes = [];
    this.unsubscribesControl = [];
    this.lastPosition = null;
    this.upSince = null;
    this.cron = null;
    this.options = {};
    this.lastSuccessfulTransfer = null;
    
    // Track status for data path updates
    this.currentStatus = '';
    this.currentError = null;
    
    // Track auto-selected source
    this.autoSelectedSource = null;
  }

  // Emit SignalK deltas for data paths
  emitDelta(path, value) {
    try {
      const delta = {
        context: 'vessels.self',
        updates: [{
          timestamp: new Date().toISOString(),
          values: [{
            path: path,
            value: value
          }]
        }]
      };
      this.app.handleMessage(this.pluginId, delta);
    } catch (err) {
      this.app.debug(`Failed to emit delta for ${path}:`, err.message);
    }
  }

  updateStatusPaths() {
    const hasError = this.currentError !== null;
  
    // SHORT format for data path
    if (!hasError) {
      const activeSource = this.options.filterSource || this.autoSelectedSource || '';
      const saveTime = this.lastPosition ? new Date(this.lastPosition.currentTime).toLocaleTimeString() : 'None since start';
      const transferTime = this.lastSuccessfulTransfer ? this.lastSuccessfulTransfer.toLocaleTimeString() : 'None since start';
      const shortStatus = `Save: ${saveTime} | Transfer: ${transferTime}`;
      this.emitDelta('noforeignland.status', shortStatus);
      this.emitDelta('noforeignland.source', activeSource);
    } else {
      this.emitDelta('noforeignland.status', `ERROR: ${this.currentError}`);
    }
    this.emitDelta('noforeignland.status_boolean', hasError ? 1 : 0);
  }

  // Override setPluginStatus to also emit data path
  setPluginStatus(status) {
    this.currentStatus = status;
    this.currentError = null;
    this.app.setPluginStatus(status);
    this.updateStatusPaths();
  }

  // Override setPluginError to also emit data path
  setPluginError(error) {
    this.currentError = error;
    this.app.setPluginError(error);
    this.updateStatusPaths();
  }

  getSchema() {
    return {
      title: this.pluginName,
      description: 'Some parameters need for use',
      type: 'object',
      properties: {
        // Mandatory Settings Group
        mandatory: {
          type: 'object',
          title: 'Mandatory Settings',
          properties: {
            boatApiKey: {
              type: 'string',
              title: 'Boat API Key',
              description: 'Boat API Key from noforeignland.com. Can be found in Account > Settings > Boat tracking > API Key.'
            }
          }
        },
        
        // Advanced Settings Group
        advanced: {
          type: 'object',
          title: 'Advanced Settings',
          properties: {
            minMove: {
              type: 'number',
              title: 'Minimum boat move to log in meters',
              description: 'To keep file sizes small we only log positions if a move larger than this size (if set to 0 will log every move)',
              default: 80
            },
            minSpeed: {
              type: 'number',
              title: 'Minimum boat speed to log in knots',
              description: 'To keep file sizes small we only log positions if boat speed goes above this value to minimize recording position on anchor or mooring (if set to 0 will log every move)',
              default: 1.5
            },
            sendWhileMoving: {
              type: 'boolean',
              title: 'Attempt sending location while moving',
              description: 'Should the plugin attempt to send tracking data to NFL while detecting the vessel is moving or only when stopped?',
              default: true
            },
            ping_api_every_24h: {
              type: 'boolean',
              title: 'Force a send every 24 hours',
              description: 'Keeps your boat active on NFL in your current location even if you do not move',
              default: true
            }
          }
        },
        
        // Expert Settings Group
        expert: {
          type: 'object',
          title: 'Expert Settings',
          properties: {
            filterSource: {
              type: 'string',
              title: 'Position source device',
              description: 'EMPTY DEFAULT IS FINE - Set this value to the name of a source if you want to only use the position given by that source.'
            },
            trackDir: {
              type: 'string',
              title: 'Directory to cache tracks',
              description: 'EMPTY DEFAULT IS FINE - Path to store track data. Relative paths are stored in plugin data directory. Absolute paths can point anywhere.\nDefault: nfl-track'
            },
            keepFiles: {
              type: 'boolean',
              title: 'Keep track files on disk',
              description: 'If you have a lot of hard drive space you can keep the track files for logging purposes.',
              default: false
            },
            trackFrequency: {
              type: 'integer',
              title: 'Position tracking frequency in seconds',
              description: 'To keep file sizes small we only log positions once in a while (unless you set this value to 0)',
              default: 60
            },
            apiCron: {
              type: 'string',
              title: 'Send attempt CRON',
              description: 'We send the tracking data to NFL once in a while, you can set the schedule with this setting.\nCRON format: https://crontab.guru/',
              default: '*/10 * * * *'
            },
            internetTestTimeout: {
              type: 'number',
              title: 'Timeout for testing internet connection in ms',
              description: 'Set this number higher for slower computers and internet connections',
              default: 2000
            },
            apiTimeout: {
              type: 'integer',
              title: 'API request timeout in seconds',
              description: 'Timeout for sending data to NFL API. Increase for slow connections.',
              default: 30,
              minimum: 10,
              maximum: 180
            }
          }
        }
      }
    };
  }

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

  async start(options = {}, restartPlugin) {
    // Position data health check
    this.positionCheckInterval = null;
    this.lastPositionReceived = null;
    
    // Backward compatibility: migrate old flat structure to new nested structure
    let needsSave = false;
    if (options.boatApiKey && !options.mandatory) {
      this.app.debug('Migrating old configuration to new grouped structure');
      needsSave = true;
      
      options = {
        mandatory: {
          boatApiKey: options.boatApiKey
        },
        advanced: {
          minMove: options.minMove !== undefined ? options.minMove : 50,
          minSpeed: options.minSpeed !== undefined ? options.minSpeed : 1.5,
          sendWhileMoving: options.sendWhileMoving !== undefined ? options.sendWhileMoving : true,
          ping_api_every_24h: options.ping_api_every_24h !== undefined ? options.ping_api_every_24h : true
        },
        expert: {
          filterSource: options.filterSource,
          trackDir: options.trackDir,
          keepFiles: options.keepFiles !== undefined ? options.keepFiles : false,
          trackFrequency: options.trackFrequency !== undefined ? options.trackFrequency : 60,
          internetTestTimeout: options.internetTestTimeout !== undefined ? options.internetTestTimeout : 2000,
          apiCron: options.apiCron || '*/10 * * * *',
          apiTimeout: options.apiTimeout !== undefined ? options.apiTimeout : 30
        }
      };
      
      try {
        this.app.debug('Saving migrated configuration...');
        await this.app.savePluginOptions(options, () => {
          this.app.debug('Configuration successfully migrated and saved');
        });
      } catch (err) {
        this.app.debug('Failed to save migrated configuration:', err.message);
      }
    }

    // Flatten the nested structure for easier access and apply defaults
    this.options = {
      boatApiKey: options.mandatory?.boatApiKey,
      minMove: options.advanced?.minMove !== undefined ? options.advanced.minMove : 80,
      minSpeed: options.advanced?.minSpeed !== undefined ? options.advanced.minSpeed : 1.5,
      sendWhileMoving: options.advanced?.sendWhileMoving !== undefined ? options.advanced.sendWhileMoving : true,
      ping_api_every_24h: options.advanced?.ping_api_every_24h !== undefined ? options.advanced.ping_api_every_24h : true,
      filterSource: options.expert?.filterSource,
      trackDir: options.expert?.trackDir || defaultTracksDir,
      keepFiles: options.expert?.keepFiles !== undefined ? options.expert.keepFiles : false,
      trackFrequency: options.expert?.trackFrequency !== undefined ? options.expert.trackFrequency : 60,
      internetTestTimeout: options.expert?.internetTestTimeout !== undefined ? options.expert.internetTestTimeout : 2000,
      apiCron: options.expert?.apiCron || '*/10 * * * *',
      apiTimeout: options.expert?.apiTimeout !== undefined ? options.expert.apiTimeout : 30
    };
    
    // Validate that boatApiKey is set
    if (!this.options.boatApiKey || this.options.boatApiKey.trim() === '') {
      const errorMsg = 'No boat API key configured. Please set your API key in plugin settings (Mandatory Settings > Boat API key). You can find your API key at noforeignland.com under Account > Settings > Boat tracking > API Key.';
      this.app.debug(errorMsg);
      this.setPluginError(errorMsg);
      this.stop();
      return;
    }
    
    // Resolve track directory path
    if (!path.isAbsolute(this.options.trackDir)) {
      const dataDirPath = this.app.getDataDirPath();
      this.options.trackDir = path.join(dataDirPath, this.options.trackDir);
    }

    if (!this.createDir(this.options.trackDir)) {
      this.stop();
      return;
    }

    // Migrate old track files
    await this.migrateOldTrackFile();

    this.app.debug('track logger started, now logging to', this.options.trackDir);
    this.setPluginStatus(`Started${needsSave ? ' (config migrated)' : ''}`);
    this.upSince = new Date().getTime();

    // Adjust default CRON if unchanged
    if (!this.options.apiCron || this.options.apiCron === '*/10 * * * *') {
      const startMinute = Math.floor(Math.random() * 10);
      const startSecond = Math.floor(Math.random() * 60);
      this.options.apiCron = `${startSecond} ${startMinute}/10 * * * *`;
    }

    this.app.debug('Setting CRON to', this.options.apiCron);
    this.app.debug('trackFrequency is set to', this.options.trackFrequency, 'seconds');

    // Subscribe and start logging
    this.doLogging();

    // Start cron job
    this.cron = new CronJob(this.options.apiCron, this.interval.bind(this));
    this.cron.start();
    
    // Start position health check
    this.startPositionHealthCheck();
  }

  async migrateOldTrackFile() {
    const oldTrackFile = path.join(this.options.trackDir, 'nfl-track.jsonl');
    const oldPendingFile = path.join(this.options.trackDir, 'nfl-track-pending.jsonl');
    const oldSentFile = path.join(this.options.trackDir, 'nfl-track-sent.jsonl');
    const newPendingFile = path.join(this.options.trackDir, routeSaveName);
    const newSentFile = path.join(this.options.trackDir, routeSentName);
    
    try {
      // Migrate old track file
      if (await fs.pathExists(oldTrackFile) && !(await fs.pathExists(newPendingFile))) {
        this.app.debug('Migrating old track file to new naming scheme...');
        await fs.move(oldTrackFile, newPendingFile);
        this.app.debug('Successfully migrated old track file to:', routeSaveName);
      }
      
      // Migrate old pending file
      if (await fs.pathExists(oldPendingFile) && !(await fs.pathExists(newPendingFile))) {
        this.app.debug('Migrating old pending file to new naming scheme...');
        await fs.move(oldPendingFile, newPendingFile);
        this.app.debug('Successfully migrated old pending file to:', routeSaveName);
      }
      
      // Migrate old sent file
      if (await fs.pathExists(oldSentFile) && !(await fs.pathExists(newSentFile))) {
        this.app.debug('Migrating old sent file to new naming scheme...');
        await fs.move(oldSentFile, newSentFile);
        this.app.debug('Successfully migrated old sent file to:', routeSentName);
      }
      
      // Check old plugin directory location
      const oldPluginTrackDir = path.join(__dirname, 'track');
      if (await fs.pathExists(oldPluginTrackDir)) {
        this.app.debug('Found old track directory in plugin folder, migrating to new location...');
        
        const oldFiles = [
          'nfl-track.jsonl',
          'nfl-track-pending.jsonl',
          routeSaveName
        ];
        
        for (const oldFile of oldFiles) {
          const oldPath = path.join(oldPluginTrackDir, oldFile);
          if (await fs.pathExists(oldPath) && !(await fs.pathExists(newPendingFile))) {
            await fs.move(oldPath, newPendingFile);
            this.app.debug('Migrated pending track file from old plugin location');
            break;
          }
        }
        
        // Migrate sent archive
        const oldSentFiles = [routeSentName, 'nfl-track-sent.jsonl'];
        for (const oldFile of oldSentFiles) {
          const oldPath = path.join(oldPluginTrackDir, oldFile);
          if (await fs.pathExists(oldPath) && !(await fs.pathExists(newSentFile))) {
            await fs.move(oldPath, newSentFile);
            this.app.debug('Migrated sent track archive from old plugin location');
            break;
          }
        }
        
        // Try to remove old directory if empty
        try {
          const remainingFiles = await fs.readdir(oldPluginTrackDir);
          if (remainingFiles.length === 0) {
            await fs.rmdir(oldPluginTrackDir);
            this.app.debug('Removed empty old track directory');
          }
        } catch (err) {
          this.app.debug('Could not remove old track directory:', err.message);
        }
      }
    } catch (err) {
      this.app.debug('Error during track file migration:', err.message);
    }
  }

  stop() {
    this.app.debug('plugin stopped');
    
    this.autoSelectedSource = null;
    
    if (this.positionCheckInterval) {
      clearInterval(this.positionCheckInterval);
      this.positionCheckInterval = null;
    }
    
    if (this.cron) {
      this.cron.stop();
      this.cron = undefined;
    }
    
    this.unsubscribesControl.forEach(f => f());
    this.unsubscribesControl = [];
    this.unsubscribes.forEach(f => f());
    this.unsubscribes = [];
    this.app.setPluginStatus('Plugin stopped');
  }

  doLogging() {
    let shouldDoLog = true;

    this.app.subscriptionmanager.subscribe({
      context: 'vessels.self',
      subscribe: [{
        path: 'navigation.position',
        format: 'delta',
        policy: 'instant',
        minPeriod: this.options.trackFrequency ? this.options.trackFrequency * 1000 : 0
      }]
    }, this.unsubscribes, (subscriptionError) => {
      this.app.debug('Error subscription to data:' + subscriptionError);
      this.setPluginError('Error subscription to data:' + subscriptionError.message);
    }, this.doOnValue.bind(this, () => shouldDoLog, newShould => { shouldDoLog = newShould; }));

    // Subscribe for speed
    if (this.options.minSpeed) {
      this.app.subscriptionmanager.subscribe({
        context: 'vessels.self',
        subscribe: [{
          path: 'navigation.speedOverGround',
          format: 'delta',
          policy: 'instant'
        }]
      }, this.unsubscribes, (subscriptionError) => {
        this.app.debug('Error subscription to data:' + subscriptionError);
        this.setPluginError('Error subscription to data:' + subscriptionError.message);
      }, (delta) => {
        delta.updates.forEach(update => {
          if (this.options.filterSource && update.$source !== this.options.filterSource) {
            return;
          }
          update.values.forEach(value => {
            const speedInKnots = value.value * 1.94384; 
            if (!shouldDoLog && this.options.minSpeed < speedInKnots) { 
              this.app.debug('setting shouldDoLog to true, speed:', speedInKnots.toFixed(2), 'knots'); 
              shouldDoLog = true; 
            }
          });
        });
      });
    }
  }

  // FIXED: Use continue instead of return to handle multiple updates properly
  async doOnValue(getShouldDoLog, setShouldDoLog, delta) {
    for (const update of delta.updates) {
      // Auto-select source logic
      if (!this.options.filterSource) {
        const timeSinceLastPosition = this.lastPositionReceived 
          ? (new Date().getTime() - this.lastPositionReceived) / 1000 
          : null;
        
        if (!this.autoSelectedSource) {
          this.autoSelectedSource = update.$source;
          this.lastPositionReceived = new Date().getTime();
          this.app.debug(`Auto-selected GPS source: '${this.autoSelectedSource}'`);
        } else if (update.$source !== this.autoSelectedSource) {
          if (timeSinceLastPosition && timeSinceLastPosition > 300) {
            this.app.debug(`Switching from stale source '${this.autoSelectedSource}' to '${update.$source}' (no data for ${timeSinceLastPosition.toFixed(0)}s)`);
            this.autoSelectedSource = update.$source;
            this.lastPositionReceived = new Date().getTime();
          } else {
            this.app.debug(`Ignoring position from '${update.$source}', using auto-selected source '${this.autoSelectedSource}'`);
            continue;
          }
        } else {
          this.lastPositionReceived = new Date().getTime();
        }
      } else if (update.$source !== this.options.filterSource) {
        this.app.debug(`Ignoring position from '${update.$source}', filterSource is set to '${this.options.filterSource}'`);
        continue;
      } else {
        this.lastPositionReceived = new Date().getTime();
      }
      
      const timestamp = update.timestamp;
      for (const value of update.values) {
        // Validation: GPS near (0,0)
        if (Math.abs(value.value.latitude) <= 0.01 && Math.abs(value.value.longitude) <= 0.01) {
          this.app.debug('GPS coordinates near (0,0), ignoring point to avoid invalid data logging.');
          continue;
        }
        
        // Validate lat/lon
        if (!this.isValidLatitude(value.value.latitude) || !this.isValidLongitude(value.value.longitude)) {
          this.app.debug('got invalid position, ignoring...', value.value);
          continue;
        }

        // 24h ping check
        let force24hSave = false;
        if (this.options.ping_api_every_24h && this.lastPosition) {
          const timeSinceLastPoint = (new Date().getTime() - this.lastPosition.currentTime);
          if (timeSinceLastPoint >= 24 * 60 * 60 * 1000) {
            this.app.debug('24h since last point, forcing save of point to keep boat active on NFL');
            force24hSave = true;
          }
        }

        // Check if we should log
        if (!force24hSave && !getShouldDoLog()) {
          this.app.debug('shouldDoLog is false, not logging position');
          continue;
        }

        // Check timestamp and distance
        if (this.lastPosition && !force24hSave) {
          if (new Date(this.lastPosition.timestamp).getTime() > new Date(timestamp).getTime()) {
            this.app.debug('got error in timestamp:', timestamp, 'is earlier than previous:', this.lastPosition.timestamp);
            continue;
          }
          
          const distance = this.equirectangularDistance(this.lastPosition.pos, value.value);
          if (this.options.minMove && distance < this.options.minMove) {
            this.app.debug('Distance', distance.toFixed(2), 'm is less than minMove', this.options.minMove, 'm - skipping');
            continue;
          }
          
          this.app.debug('Distance', distance.toFixed(2), 'm is greater than minMove', this.options.minMove, 'm - logging');
        }

        // Save point
        this.app.debug('Saving position from source:', update.$source, 'lat:', value.value.latitude, 'lon:', value.value.longitude);
        this.lastPosition = { pos: value.value, timestamp, currentTime: new Date().getTime() };
        await this.savePoint(this.lastPosition);

        // Reset shouldDoLog if minSpeed is active
        if (this.options.minSpeed) {
          this.app.debug('options.minSpeed - setting shouldDoLog to false');
          setShouldDoLog(false);
        }
      }
    }
  }

  async savePoint(point) {
    const obj = {
      lat: point.pos.latitude,
      lon: point.pos.longitude,
      t: point.timestamp
    };
    this.app.debug(`save data point:`, obj);
    await fs.appendFile(path.join(this.options.trackDir, routeSaveName), JSON.stringify(obj) + EOL);
  
    const now = new Date();
    this.emitDelta('noforeignland.savepoint', now.toISOString());
    this.emitDelta('noforeignland.savepoint_local', now.toLocaleString());
    
    // ISO8601 format for Dashboard
    const activeSource = this.options.filterSource || this.autoSelectedSource || '';
    const sourcePrefix = activeSource ? `${activeSource} | ` : '';
    const saveTime = now.toISOString();
    const transferTime = this.lastSuccessfulTransfer ? this.lastSuccessfulTransfer.toISOString() : 'None since start';
  
    this.setPluginStatus(`${sourcePrefix}Save: ${saveTime} | Transfer: ${transferTime}`);
  }

  isValidLatitude(obj) {
    return this.isDefinedNumber(obj) && obj > -90 && obj < 90;
  }
  
  isValidLongitude(obj) {
    return this.isDefinedNumber(obj) && obj > -180 && obj < 180;
  }
  
  isDefinedNumber(obj) {
    return (obj !== undefined && obj !== null && typeof obj === 'number');
  }

  equirectangularDistance(from, to) {
    const rad = Math.PI / 180;
    const φ1 = from.latitude * rad;
    const φ2 = to.latitude * rad;
    const Δλ = (to.longitude - from.longitude) * rad;
    const R = 6371e3;
    const x = Δλ * Math.cos((φ1 + φ2) / 2);
    const y = (φ2 - φ1);
    const d = Math.sqrt(x * x + y * y) * R;
    return d;
  }

  createDir(dir) {
    let res = true;
    if (fs.existsSync(dir)) {
      try {
        fs.accessSync(dir, fs.constants.R_OK | fs.constants.W_OK);
      } catch (error) {
        this.app.debug('[createDir]', error.message);
        this.setPluginError(`No rights to directory ${dir}`);
        res = false;
      }
    } else {
      try {
        fs.mkdirSync(dir, { recursive: true });
      } catch (error) {
        switch (error.code) {
          case 'EACCES':
          case 'EPERM':
            this.app.debug(`Failed to create ${dir} by Permission denied`);
            this.setPluginError(`Failed to create ${dir} by Permission denied`);
            res = false;
            break;
          case 'ETIMEDOUT':
            this.app.debug(`Failed to create ${dir} by Operation timed out`);
            this.setPluginError(`Failed to create ${dir} by Operation timed out`);
            res = false;
            break;
          default:
            this.app.debug(`Error creating directory ${dir}: ${error.message}`);
            this.setPluginError(`Error creating directory ${dir}: ${error.message}`);
            res = false;
        }
      }
    }
    return res;
  }

startPositionHealthCheck() {
  this.positionCheckInterval = setInterval(() => {
    const now = new Date().getTime();
    const timeSinceLastPosition = this.lastPositionReceived 
      ? (now - this.lastPositionReceived) / 1000 
      : null;
    
    const activeSource = this.options.filterSource || this.autoSelectedSource || 'any';
    const filterMsg = activeSource !== 'any' ? ` from source '${activeSource}'` : '';
    
    if (!this.lastPositionReceived) {
      const errorMsg = this.options.filterSource
        ? `No GPS position data received from filtered source '${this.options.filterSource}'. Check Expert Settings > Position source device, or leave empty to use any GPS source.`
        : 'No GPS position data received. Check that your GPS is connected and SignalK is receiving navigation.position data.';
      this.setPluginError(errorMsg);
      this.app.debug('Position health check: No position data ever received' + filterMsg);
    } else if (timeSinceLastPosition > 300) {
      const errorMsg = this.options.filterSource
        ? `No GPS position data${filterMsg} for ${Math.floor(timeSinceLastPosition / 60)} minutes. Check that source '${this.options.filterSource}' is active, or change/clear Position source device in Expert Settings.`
        : `No GPS position data${filterMsg} for ${Math.floor(timeSinceLastPosition / 60)} minutes. Check your GPS connection.`;
      this.setPluginError(errorMsg);
      this.app.debug(`Position health check: No position for ${timeSinceLastPosition.toFixed(0)} seconds` + filterMsg);
    } else {
      this.app.debug(`Position health check: OK (last position ${timeSinceLastPosition.toFixed(0)} seconds ago${filterMsg})`);
      
      // Clear any previous errors when position health is OK
      if (this.currentError) {
        const activeSource = this.options.filterSource || this.autoSelectedSource || '';
        const sourcePrefix = activeSource ? `${activeSource} | ` : '';
        const saveTime = this.lastPosition ? new Date(this.lastPosition.currentTime).toISOString() : 'None since start';
        const transferTime = this.lastSuccessfulTransfer ? this.lastSuccessfulTransfer.toISOString() : 'None since start';
        this.setPluginStatus(`${sourcePrefix}Save: ${saveTime} | Transfer: ${transferTime}`);
      }
    }
  }, 5 * 60 * 1000);
  
  // Initial check after 2 minutes of startup
  setTimeout(() => {
    if (!this.lastPositionReceived) {
      const activeSource = this.options.filterSource || this.autoSelectedSource || 'any';
      const errorMsg = this.options.filterSource
        ? `No GPS position data received after 2 minutes from filtered source '${this.options.filterSource}'. Check Expert Settings > Position source device. You may need to leave it empty to use any available GPS source.`
        : 'No GPS position data received after 2 minutes. Check that your GPS is connected and SignalK is receiving navigation.position data.';
      this.setPluginError(errorMsg);
      this.app.debug('Initial position check: No position data received' + (activeSource !== 'any' ? ` from source '${activeSource}'` : ''));
    }
  }, 2 * 60 * 1000);
}

  async interval() {
    const boatMoving = this.checkBoatMoving();
    if (!boatMoving) {
      return;
    }
    
    const hasTrack = await this.checkTrack();
    if (!hasTrack) {
      return;
    }
    
    const hasInternet = await this.testInternet();
    if (!hasInternet) {
      const errorMsg = 'No internet connection detected. Unable to send tracking data to NFL. DNS lookups failed - check your internet connection.';
      this.app.debug(errorMsg);
      this.setPluginError(errorMsg);
      return;
    }
    
    await this.sendData();
  }

  checkBoatMoving() { 
    if (!this.options.trackFrequency) { 
      return true;
    } 
    const time = this.lastPosition ? this.lastPosition.currentTime : this.upSince; 
    const secsSinceLastPoint = (new Date().getTime() - time) / 1000; 
    const isMoving = secsSinceLastPoint <= (this.options.trackFrequency * 2); 
    if (isMoving) { 
      this.app.debug('Boat is still moving, last move', secsSinceLastPoint, 'seconds ago'); 
      return this.options.sendWhileMoving;
    } else { 
      this.app.debug('Boat stopped moving, last move at least', secsSinceLastPoint, 'seconds ago'); 
      return true;
    } 
  }

  async testInternet() {
    const dns = require('dns').promises;
    
    this.app.debug('testing internet connection');
    
    const timeoutMs = this.options.internetTestTimeout || 2000;
    this.app.debug(`Using internet test timeout: ${timeoutMs}ms`);
    
    const dnsServers = [
      { name: 'Google DNS', ip: '8.8.8.8' },
      { name: 'Cloudflare DNS', ip: '1.1.1.1' }
    ];
    
    for (const server of dnsServers) {
      try {
        const startTime = Date.now();
        const result = await Promise.race([
          dns.reverse(server.ip),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('DNS timeout')), timeoutMs)
          )
        ]);
        const elapsed = Date.now() - startTime;
        
        this.app.debug(`internet connection = true, ${server.name} (${server.ip}) is reachable (took ${elapsed}ms)`);
        return true;
      } catch (err) {
        this.app.debug(`${server.name} (${server.ip}) not reachable:`, err.message);
      }
    }
    
    this.app.debug(`internet connection = false, no public DNS servers reachable (timeout was ${timeoutMs}ms)`);
    return false;
  }

  async checkTrack() {
    const trackFile = path.join(this.options.trackDir, routeSaveName);
    this.app.debug('checking the track', trackFile, 'if should send');
    const exists = await fs.pathExists(trackFile);
    const size = exists ? (await fs.lstat(trackFile)).size : 0;
    this.app.debug(`'${trackFile}'.size=${size} ${trackFile}'.exists=${exists}`);
    return size > 0;
  }

  async sendData() {
    if (this.options.boatApiKey) {
      await this.sendApiData();
    } else {
      this.app.debug('Failed to send track - no boat API key set in plugin settings.');
      this.setPluginError(`Failed to send track - no boat API key set in plugin settings.`);
    }
  }

  async sendApiData() {
    this.app.debug('sending the data');
    const pendingFile = path.join(this.options.trackDir, routeSaveName);
    const trackData = await this.createTrack(pendingFile);
    if (!trackData) {
      this.app.debug('Recorded track did not contain any valid track points, aborting sending.');
      this.setPluginError(`Failed to send track - Recorded track did not contain any valid track points, aborting sending.`);
      return;
    }
    this.app.debug('created track data with timestamp:', new Date(trackData.timestamp));
    const params = new URLSearchParams();
    params.append('timestamp', trackData.timestamp);
    params.append('track', JSON.stringify(trackData.track));
    params.append('boatApiKey', this.options.boatApiKey);
    const headers = { 'X-NFL-API-Key': pluginApiKey };
    this.app.debug('sending track to API');

    const maxRetries = 3;
    const baseTimeout = (this.options.apiTimeout || 30) * 1000;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const currentTimeout = baseTimeout * attempt;
        this.app.debug(`Attempt ${attempt}/${maxRetries} with ${currentTimeout}ms timeout`);
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), currentTimeout);
        
        const response = await fetch(apiUrl, { 
          method: 'POST', 
          body: params, 
          headers: new fetch.Headers(headers),
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (response.ok) {
          const responseBody = await response.json();
          if (responseBody.status === 'ok') {
            this.lastSuccessfulTransfer = new Date();
            
            this.emitDelta('noforeignland.sent_to_api', this.lastSuccessfulTransfer.toISOString());
            this.emitDelta('noforeignland.sent_to_api_local', this.lastSuccessfulTransfer.toLocaleString());
            
            this.app.debug('Track successfully sent to API');
            
            // ISO8601 format for Dashboard
            const activeSource = this.options.filterSource || this.autoSelectedSource || '';
            const sourcePrefix = activeSource ? `${activeSource} | ` : '';
            const saveTime = this.lastPosition ? new Date(this.lastPosition.currentTime).toISOString() : 'None since start';
            const transferTime = this.lastSuccessfulTransfer.toISOString();
            this.setPluginStatus(`${sourcePrefix}Save: ${saveTime} | Transfer: ${transferTime}`);
            
            await this.handleSuccessfulSend(pendingFile);
            return;
          } else {
            this.app.debug('Could not send track to API, returned response json:', responseBody);
            this.setPluginError(`Failed to send track - API returned error.`);
            return;
          }
        } else {
          this.app.debug('Could not send track to API, returned response code:', response.status, response.statusText);
          if (response.status >= 400 && response.status < 500) {
            this.setPluginError(`Failed to send track - HTTP ${response.status}.`);
            return;
          }
          throw new Error(`HTTP ${response.status}`);
        }
      } catch (err) {
        this.app.debug(`Attempt ${attempt} failed:`, err.message);
        
        if (attempt === maxRetries) {
          this.app.debug('Could not send track to API after', maxRetries, 'attempts:', err);
          this.setPluginError(`Failed to send track after ${maxRetries} attempts - check logs for details.`);
        } else {
          const waitTime = 2000 * attempt;
          this.app.debug(`Waiting ${waitTime}ms before retry...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }
      }
    }
  }

  async handleSuccessfulSend(pendingFile) {
    const sentFile = path.join(this.options.trackDir, routeSentName);
    
    try {
      if (this.options.keepFiles) {
        this.app.debug('Appending sent data to archive file:', routeSentName);
        const pendingContent = await fs.readFile(pendingFile, 'utf8');
        await fs.appendFile(sentFile, pendingContent);
        this.app.debug('Successfully archived sent track data');
      } else {
        this.app.debug('keepFiles disabled, will delete pending file');
      }
      
      this.app.debug('Deleting pending track file');
      await fs.remove(pendingFile);
      this.app.debug('Successfully processed track files after send');
      
    } catch (err) {
      this.app.debug('Error handling files after successful send:', err.message);
    }
  }

  async createTrack(inputPath) {
    const fileStream = fs.createReadStream(inputPath);
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
    const track = [];
    let lastTimestamp;
    for await (const line of rl) {
      if (line) {
        try {
          const point = JSON.parse(line);
          const timestamp = new Date(point.t).getTime();
          if (!isNaN(timestamp) && this.isValidLatitude(point.lat) && this.isValidLongitude(point.lon)) {
            track.push([timestamp, point.lat, point.lon]);
            lastTimestamp = timestamp;
          }
        } catch (error) {
          this.app.debug('could not parse line from track file:', line);
          this.setPluginError(`Failed could not parse line from track file - check logs for details.`);
        }
      }
    }
    if (track.length > 0) {
      return { timestamp: new Date(lastTimestamp).getTime(), track };
    }
    return null;
  }
}

module.exports = function (app) {
  const instance = new SignalkToNoforeignland(app);
  return instance.getPluginObject();
};