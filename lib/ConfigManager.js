const path = require('path');

const defaultTracksDir = 'nfl-track';

class ConfigManager {
  constructor(app) {
    this.app = app;
  }

  /**
   * Migrate old flat config structure to new grouped structure
   */
  async migrateOldConfig(options) {
    if (options.boatApiKey && !options.mandatory) {
      this.app.debug('Migrating old configuration to new grouped structure');
      
      const migratedOptions = {
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
        await this.app.savePluginOptions(migratedOptions, () => {
          this.app.debug('Configuration successfully migrated and saved');
        });
        return { options: migratedOptions, migrated: true };
      } catch (err) {
        this.app.debug('Failed to save migrated configuration:', err.message);
        return { options: migratedOptions, migrated: true };
      }
    }
    
    return { options, migrated: false };
  }

  /**
   * Flatten nested config structure and apply defaults
   */
  flattenConfig(options) {
    return {
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
  }

  /**
   * Validate boat API key
   */
  validateApiKey(config) {
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
  resolveTrackDir(config, dataDirPath) {
    if (!path.isAbsolute(config.trackDir)) {
      return path.join(dataDirPath, config.trackDir);
    }
    return config.trackDir;
  }

  /**
   * Randomize CRON schedule to avoid all instances running at same time
   */
  randomizeCron(config) {
    if (!config.apiCron || config.apiCron === '*/10 * * * *') {
      const startMinute = Math.floor(Math.random() * 10);
      const startSecond = Math.floor(Math.random() * 60);
      config.apiCron = `${startSecond} ${startMinute}/10 * * * *`;
    }
    return config;
  }

  /**
   * Get the full schema for plugin configuration
   */
  static getSchema(pluginName) {
    return {
      title: pluginName,
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
}

module.exports = ConfigManager;