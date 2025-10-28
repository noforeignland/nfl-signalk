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
    this.pluginName = 'SignalK to Noforeland';
    this.creator = 'signalk-track-logger';

    // runtime state
    this.unsubscribes = [];
    this.unsubscribesControl = [];
    this.lastPosition = null;
    this.upSince = null;
    this.cron = null;
    this.options = {};
  }

  getSchema() {
    return {
      title: this.pluginName,
      description: 'Some parameters need for use',
      type: 'object',
      required: ['apiCron', 'boatApiKey'],
      properties: {
        trackFrequency: {
          type: 'integer',
          title: 'Position tracking frequency in seconds.',
          description: 'To keep file sizes small we only log positions once in a while (unless you set this value to 0)',
          default: 60
        },
        minMove: {
          type: 'number',
          title: 'Minimum boat move to log in meters',
          description: 'To keep file sizes small we only log positions if a move larger than this size (if set to 0 will log every move)',
          default: 50
        },
        minSpeed: {
          type: 'number',
          title: 'Minimum boat speed to log in knots',
          description: 'To keep file sizes small we only log positions if boat speed goes above this value to minimize recording position on anchor or mooring (if set to 0 will log every move)',
          default: 1.5
        },
        apiCron: {
          type: 'string',
          title: 'Send attempt CRON',
          description: 'We send the tracking data to NFL once in a while, you can set the schedule with this setting.\nCRON format: https://crontab.guru/',
          default: '*/10 * * * *'
        },
        boatApiKey: {
          type: 'string',
          title: 'Boat API key',
          description: 'Boat API key from noforeignland.com. Can be found in Account > Settings > Boat tracking > API Key.\n*required only in API method is set*'
        },
        internetTestTimeout: {
          type: 'number',
          title: 'Timeout for testing internet connection in ms',
          description: 'Set this number higher for slower computers and internet connections',
          default: 2000
        },
        sendWhileMoving: {
          type: 'boolean',
          title: 'Attempt sending location while moving',
          description: 'Should the plugin attempt to send tracking data to NFL while detecting the vessel is moving or only when stopped?',
          default: true
        },
        filterSource: {
          type: 'string',
          title: 'Position source device',
          description: 'Set this value to the name of a source if you want to only use the position given by that source.'
        },
        trackDir: {
          type: 'string',
          title: 'Directory to cache tracks.',
          description: 'Path in server filesystem, absolute or from plugin directory.\noptional param (only used to keep file cache).'
        },
        keepFiles: {
          type: 'boolean',
          title: 'Should keep track files on disk?',
          description: 'If you have a lot of hard drive space you can keep the track files for logging purposes.',
          default: false
        },
        ping_api_every_24h: {
          type: 'boolean',
          title: 'Should I force a send every 24 hours',
          description: 'Keeps your boat active on NFL in your current location even if you do not move',
          default: true
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
    // normalize options
    this.options = Object.assign({}, options);
    if (!this.options.trackDir) this.options.trackDir = defaultTracksDir;
    if (!path.isAbsolute(this.options.trackDir)) {
      this.options.trackDir = path.join(__dirname, this.options.trackDir);
    }

    if (!this.createDir(this.options.trackDir)) {
      this.stop();
      return;
    }

    this.app.debug('track logger started, now logging to', this.options.trackDir);
    this.app.setPluginStatus(`Started`);
    this.upSince = new Date().getTime();

    // adjust default CRON if unchanged
    if (!this.options.apiCron || this.options.apiCron === '*/10 * * * *') {
      const startMinute = Math.floor(Math.random() * 10);
      const startSecond = Math.floor(Math.random() * 60);
      this.options.apiCron = `${startSecond} ${startMinute}/10 * * * *`;
    }

    this.app.debug('Setting CRON to ', this.options.apiCron);

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
            // value.value is sog in m/s so 'sog*2' is in knots (original code used *2)
            if (!shouldDoLog && this.options.minSpeed < value.value * 2) {
              this.app.debug('setting shouldDoLog to true');
              shouldDoLog = true;
            }
          });
        });
      });
    }
  }

  // doOnValue helper is a bit special: we pass closures for shouldDoLog
  async doOnValue(getShouldDoLog, setShouldDoLog, delta) {
    for (const update of delta.updates) {
      if (this.options.filterSource && update.$source !== this.options.filterSource) {
        return;
      }
      const timestamp = update.timestamp;
      for (const value of update.values) {
        if (Math.abs(value.value.latitude) <= 0.01 && Math.abs(value.value.longitude) <= 0.01) {
          this.app.debug('GPS coordinates near (0,0), ignoring point to avoid invalid data logging.');
          return;
        }
        // 24h ping to keep boat active on NFL
        if (this.options.ping_api_every_24h && this.lastPosition) {
          const timeSinceLastPoint = (new Date().getTime() - this.lastPosition.currentTime);
          if (timeSinceLastPoint >= 24 * 60 * 60 * 1000) {
            this.app.debug('24h since last point, forcing save of point to keep boat active on NFL');
            this.lastPosition = { pos: value.value, timestamp, currentTime: new Date().getTime() };
            await this.savePoint(this.lastPosition);
            //setShouldDoLog(true);
            return;
          }
        }
        if (!getShouldDoLog()) {
          return;
        }
        if (!this.isValidLatitude(value.value.latitude) || !this.isValidLongitude(value.value.longitude)) {
          this.app.debug('got invalid position, ignoring...', value.value);
          return;
        }
        if (this.lastPosition) {
          if (new Date(this.lastPosition.timestamp).getTime() > new Date(timestamp).getTime()) {
            this.app.debug('got error in timestamp:', timestamp, 'is earlier than previous:', this.lastPosition.timestamp);
            return;
          }
          const distance = this.equirectangularDistance(this.lastPosition.pos, value.value);
          if (this.options.minMove && distance < this.options.minMove) {
            return;
          }
        }

        this.lastPosition = { pos: value.value, timestamp, currentTime: new Date().getTime() };
        await this.savePoint(this.lastPosition);

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
    if (this.options.sendWhileMoving || !this.options.trackFrequency) {
      return true;
    }
    const time = this.lastPosition ? this.lastPosition.currentTime : this.upSince;
    const secsSinceLastPoint = (new Date().getTime() - time) / 1000;
    if (secsSinceLastPoint > (this.options.trackFrequency * 2)) {
      this.app.debug('Boat stopped moving, last move at least', secsSinceLastPoint, 'seconds ago');
      return true;
    } else {
      this.app.debug('Boat is still moving, last move', secsSinceLastPoint, 'seconds ago');
      return false;
    }
  }

  async testInternet() {
    this.app.debug('testing internet connection');
    const check = await isReachable(internetTestAddress, { timeout: this.options.internetTestTimeout || internetTestTimeout });
    this.app.debug('internet connection = ', check);
    return check;
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
      this.app.setPluginSError(`Failed to send track - Recorded track did not contain any valid track points, aborting sending.`);
      return;
    }
    this.app.debug('created track data with timestamp:', new Date(trackData.timestamp));
    const params = new URLSearchParams();
    params.append('timestamp', trackData.timestamp);
    params.append('track', JSON.stringify(trackData.track));
    params.append('boatApiKey', this.options.boatApiKey);
    const headers = { 'X-NFL-API-Key': pluginApiKey };
    this.app.debug('sending track to API');

    try {
      const response = await fetch(apiUrl, { method: 'POST', body: params, headers: new fetch.Headers(headers) });
      if (response.ok) {
        const responseBody = await response.json();
        if (responseBody.status === 'ok') {
          this.app.debug('Track successfully sent to API');
          this.app.setPluginStatus(`Started - last Track sent successfully at ${new Date().toLocaleString()}`);
          if (this.options.keepFiles) {
            const filename = new Date().toJSON().slice(0, 19).replace(/:/g, '') + '-nfl-track.jsonl';
            this.app.debug('moving and keeping track file: ', filename);
            await fs.move(path.join(this.options.trackDir, routeSaveName), path.join(this.options.trackDir, filename));
          } else {
            this.app.debug('Deleting track file');
            await fs.remove(path.join(this.options.trackDir, routeSaveName));
          }
        } else {
          this.app.debug('Could not send track to API, returned response json:', responseBody);
          this.app.setPluginError(`Failed to send track - check logs for details.`);
        }
      } else {
        this.app.debug('Could not send track to API, returned response code:', response.status, response.statusText);
        this.app.setPluginError(`Failed to send track - check logs for details.`);
      }
    } catch (err) {
      this.app.debug('Could not send track to API due to error:', err);
      this.app.setPluginError(`Failed to send track - check logs for details.`);
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
