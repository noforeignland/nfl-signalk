const { EOL } = require('os');
const internetTestAddress = 'google.com';
const internetTestTimeout = 1000;
const fs = require('fs-extra');
const path = require('path');
const CronJob = require('cron').CronJob;
const readline = require('readline');
const fetch = require('node-fetch');
const isReachable = require('is-reachable');

const apiUrl = 'https://www.noforeignland.com/home/api/v1/boat/tracking/track';
const pluginApiKey = '0ede6cb6-5213-45f5-8ab4-b4836b236f97';
const defaultTracksDir = 'track';
const routeSaveName = 'nfl-track.jsonl';

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
  }

getSchema() {
  return {
    title: this.pluginName,
    description: 'Some parameters need for use',
    type: 'object',
    required: ['boatApiKey', 'apiCron'],
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
            description: 'EMPTY DEFAULT IS FINE - Path in server filesystem, absolute or from plugin directory.\noptional param (only used to keep file cache).'
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
  
  // Backward compatibility: migrate old flat structure to new nested structure
  let needsSave = false;
  if (options.boatApiKey && !options.mandatory) {
    // Old config detected, migrate to new structure
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
    
    // Save the migrated configuration
    try {
      this.app.debug('Saving migrated configuration...');
      await this.app.savePluginOptions(options, () => {
        this.app.debug('Configuration successfully migrated and saved');
      });
    } catch (err) {
      this.app.debug('Failed to save migrated configuration:', err.message);
      // Continue anyway - the migration will work in memory
    }
  }

  // Flatten the nested structure for easier access and apply defaults
  this.options = {
    // Mandatory defaults
    boatApiKey: options.mandatory?.boatApiKey,
    
    // Advanced defaults
    minMove: options.advanced?.minMove !== undefined ? options.advanced.minMove : 80,
    minSpeed: options.advanced?.minSpeed !== undefined ? options.advanced.minSpeed : 1.5,
    sendWhileMoving: options.advanced?.sendWhileMoving !== undefined ? options.advanced.sendWhileMoving : true,
    ping_api_every_24h: options.advanced?.ping_api_every_24h !== undefined ? options.advanced.ping_api_every_24h : true,
    
    // Expert defaults
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
    this.app.setPluginError(errorMsg);
    this.stop();
    return;
  }
  
  if (!path.isAbsolute(this.options.trackDir)) {
    this.options.trackDir = path.join(__dirname, this.options.trackDir);
  }

  if (!this.createDir(this.options.trackDir)) {
    this.stop();
    return;
  }

  this.app.debug('track logger started, now logging to', this.options.trackDir);
  this.app.setPluginStatus(`Started${needsSave ? ' (config migrated)' : ''}`);
  this.upSince = new Date().getTime();

  // adjust default CRON if unchanged
  if (!this.options.apiCron || this.options.apiCron === '*/10 * * * *') {
    const startMinute = Math.floor(Math.random() * 10);
    const startSecond = Math.floor(Math.random() * 60);
    this.options.apiCron = `${startSecond} ${startMinute}/10 * * * *`;
  }

  this.app.debug('Setting CRON to ', this.options.apiCron);
  this.app.debug('trackFrequency is set to', this.options.trackFrequency, 'seconds');

  // subscribe and logging
  this.doLogging();

  // start cron job
  this.cron = new CronJob(this.options.apiCron, this.interval.bind(this));
  this.cron.start();
}

  stop() {
    this.app.debug('plugin stopped');
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
    // subscribe for position
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
      this.app.setPluginError('Error subscription to data:' + subscriptionError.message);
    }, this.doOnValue.bind(this, () => shouldDoLog, newShould => { shouldDoLog = newShould; }));

    // subscribe for speed
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
        this.app.setPluginError('Error subscription to data:' + subscriptionError.message);
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

  async doOnValue(getShouldDoLog, setShouldDoLog, delta) {
  for (const update of delta.updates) {
    if (this.options.filterSource && update.$source !== this.options.filterSource) {
      return;
    }
    const timestamp = update.timestamp;
    for (const value of update.values) {
      // Validierung: GPS nahe (0,0)
      if (Math.abs(value.value.latitude) <= 0.01 && Math.abs(value.value.longitude) <= 0.01) {
        this.app.debug('GPS coordinates near (0,0), ignoring point to avoid invalid data logging.');
        return;
      }
      
      // Validate for valid lat/lon
      if (!this.isValidLatitude(value.value.latitude) || !this.isValidLongitude(value.value.longitude)) {
        this.app.debug('got invalid position, ignoring...', value.value);
        return;
      }

      // 24h-Ping Check: Setze Flag, aber breche NICHT ab
      let force24hSave = false;
      if (this.options.ping_api_every_24h && this.lastPosition) {
        const timeSinceLastPoint = (new Date().getTime() - this.lastPosition.currentTime);
        if (timeSinceLastPoint >= 24 * 60 * 60 * 1000) {
          this.app.debug('24h since last point, forcing save of point to keep boat active on NFL');
          force24hSave = true;
        }
      }

      // Wenn wir nicht loggen sollen UND es kein 24h-Force ist, dann raus
      if (!force24hSave && !getShouldDoLog()) {
        return;
      }

      // Wenn wir eine letzte Position haben, prüfe Timestamp und Distanz
      if (this.lastPosition && !force24hSave) {
        // Timestamp-Validierung
        if (new Date(this.lastPosition.timestamp).getTime() > new Date(timestamp).getTime()) {
          this.app.debug('got error in timestamp:', timestamp, 'is earlier than previous:', this.lastPosition.timestamp);
          return;
        }
        
        // Distance-Check (nur wenn NICHT 24h-Force)
        const distance = this.equirectangularDistance(this.lastPosition.pos, value.value);
        if (this.options.minMove && distance < this.options.minMove) {
          this.app.debug('Distance', distance.toFixed(2), 'm is less than minMove', this.options.minMove, 'm - skipping');
          return;
        }
      }

      // Punkt speichern
      this.lastPosition = { pos: value.value, timestamp, currentTime: new Date().getTime() };
      await this.savePoint(this.lastPosition);

      // shouldDoLog zurücksetzen wenn minSpeed aktiv ist
      if (this.options.minSpeed) {
        this.app.debug('options.minSpeed - setting shouldDoLog to false');
        setShouldDoLog(false);
      }
    }
  }}


 async savePoint(point) {
  const obj = {
    lat: point.pos.latitude,
    lon: point.pos.longitude,
    t: point.timestamp
  };
  this.app.debug(`save data point:`, obj);
  await fs.appendFile(path.join(this.options.trackDir, routeSaveName), JSON.stringify(obj) + EOL);
  
  const lastSaveTime = new Date().toISOString();
  const lastTransferTime = this.lastSuccessfulTransfer ? this.lastSuccessfulTransfer.toISOString() : 'Not transfered since plugin start';
  this.app.setPluginStatus(`Last save: ${lastSaveTime} | Last transfer: ${lastTransferTime}`);
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
        this.app.setPluginError(`No rights to directory ${dir}`);
        res = false;
      }
    } else {
      try {
        fs.mkdirSync(dir, { recursive: true });
      } catch (error) {
        switch (error.code) {
          case 'EACCES':
          case 'EPERM':
            this.app.debug(`False to create ${dir} by Permission denied`);
            this.app.setPluginError(`False to create ${dir} by Permission denied`);
            res = false;
            break;
          case 'ETIMEDOUT':
            this.app.debug(`False to create ${dir} by Operation timed out`);
            this.app.setPluginError(`False to create ${dir} by Operation timed out`);
            res = false;
            break;
          default:
            this.app.debug(`Error creating directory ${dir}: ${error.message}`);
            this.app.setPluginError(`Error creating directory ${dir}: ${error.message}`);
            res = false;
        }
      }
    }
    return res;
  }

  // periodic interval called by cron
  async interval() {
    if ((this.checkBoatMoving()) && await this.checkTrack() && await this.testInternet()) {
      await this.sendData();
    }
  }

  checkBoatMoving() { 
    if (!this.options.trackFrequency) { 
      return true; // Kein Tracking → immer senden 
    } 
    const time = this.lastPosition ? this.lastPosition.currentTime : this.upSince; 
    const secsSinceLastPoint = (new Date().getTime() - time) / 1000; 
    const isMoving = secsSinceLastPoint <= (this.options.trackFrequency * 2); 
    if (isMoving) { 
      this.app.debug('Boat is still moving, last move', secsSinceLastPoint, 'seconds ago'); 
      return this.options.sendWhileMoving; // Nur senden wenn gewünscht 
    } else { 
      this.app.debug('Boat stopped moving, last move at least', secsSinceLastPoint, 'seconds ago'); 
      return true; // Immer senden wenn gestoppt 
      } 
  }

 async testInternet() {
  const dns = require('dns').promises;
  
  this.app.debug('testing internet connection');
  
  try {
    // Force IPv4 DNS lookup with timeout
    const timeoutMs = this.options.internetTestTimeout || internetTestTimeout;
    const addresses = await Promise.race([
      dns.resolve4(internetTestAddress),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('DNS timeout')), timeoutMs)
      )
    ]);
    
    if (addresses && addresses.length > 0) {
      this.app.debug('internet connection = true, resolved IPv4:', addresses[0]);
      return true;
    } else {
      this.app.debug('internet connection = false, no IPv4 addresses found');
      return false;
    }
  } catch (err) {
    this.app.debug('internet connection = false, error:', err.message);
    return false;
  }
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
      this.app.setPluginError(`Failed to send track - no boat API key set in plugin settings.`);
    }
  }

  async sendApiData() {
    this.app.debug('sending the data');
    const trackData = await this.createTrack(path.join(this.options.trackDir, routeSaveName));
    if (!trackData) {
      this.app.debug('Recorded track did not contain any valid track points, aborting sending.');
      this.app.setPluginError(`Failed to send track - Recorded track did not contain any valid track points, aborting sending.`);
      return;
    }
    this.app.debug('created track data with timestamp:', new Date(trackData.timestamp));
    const params = new URLSearchParams();
    params.append('timestamp', trackData.timestamp);
    params.append('track', JSON.stringify(trackData.track));
    params.append('boatApiKey', this.options.boatApiKey);
    const headers = { 'X-NFL-API-Key': pluginApiKey };
    this.app.debug('sending track to API');

    // Retry-Logik mit exponentiell steigendem Timeout
    const maxRetries = 3;
    const baseTimeout = (this.options.apiTimeout || 30) * 1000; // Konfigurierbarer Basis-Timeout in ms
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const currentTimeout = baseTimeout * attempt; // 30s, 60s, 90s
        this.app.debug(`Attempt ${attempt}/${maxRetries} with ${currentTimeout}ms timeout`);
        
        // AbortController für Timeout
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
            this.app.debug('Track successfully sent to API');
            this.app.setPluginStatus(`Started - last Track sent successfully at ${new Date().toISOString()}`);
            if (this.options.keepFiles) {
              const filename = new Date().toJSON().slice(0, 19).replace(/:/g, '') + '-nfl-track.jsonl';
              this.app.debug('moving and keeping track file: ', filename);
              await fs.move(path.join(this.options.trackDir, routeSaveName), path.join(this.options.trackDir, filename));
            } else {
              this.app.debug('Deleting track file');
              await fs.remove(path.join(this.options.trackDir, routeSaveName));
            }
            return; // Erfolg - beende Funktion
          } else {
            this.app.debug('Could not send track to API, returned response json:', responseBody);
            // Bei API-Fehler nicht erneut versuchen
            this.app.setPluginError(`Failed to send track - API returned error.`);
            return;
          }
        } else {
          this.app.debug('Could not send track to API, returned response code:', response.status, response.statusText);
          // Bei 4xx Fehler nicht erneut versuchen
          if (response.status >= 400 && response.status < 500) {
            this.app.setPluginError(`Failed to send track - HTTP ${response.status}.`);
            return;
          }
          // Bei 5xx Fehler retry
          throw new Error(`HTTP ${response.status}`);
        }
      } catch (err) {
        this.app.debug(`Attempt ${attempt} failed:`, err.message);
        
        // Bei letztem Versuch Fehler setzen
        if (attempt === maxRetries) {
          this.app.debug('Could not send track to API after', maxRetries, 'attempts:', err);
          this.app.setPluginError(`Failed to send track after ${maxRetries} attempts - check logs for details.`);
        } else {
          // Kurze Pause vor nächstem Versuch
          const waitTime = 2000 * attempt; // 2s, 4s
          this.app.debug(`Waiting ${waitTime}ms before retry...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }
      }
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
          this.app.setPluginError(`Failed could not parse line from track file - check logs for details.`);
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
