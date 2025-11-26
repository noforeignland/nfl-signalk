const fs = require('fs-extra');
const path = require('path');
const readline = require('readline');
const fetch = require('node-fetch');

class TrackSender {
  constructor(app, options, trackDir) {
    this.app = app;
    this.options = options;
    this.trackDir = trackDir;
    this.routeSaveName = 'pending.jsonl';
    this.routeSentName = 'sent.jsonl';
    
    this.apiUrl = 'https://www.noforeignland.com/home/api/v1/boat/tracking/track';
    this.pluginApiKey = '0ede6cb6-5213-45f5-8ab4-b4836b236f97';
  }

  /**
   * Check if boat is currently moving
   */
  isBoatMoving(lastPosition, upSince) {
    if (!this.options.trackFrequency) { 
      return true;
    } 
    
    const time = lastPosition ? lastPosition.currentTime : upSince; 
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

  /**
   * Check if track file exists and has content
   */
  async hasTrackData() {
    const trackFile = path.join(this.trackDir, this.routeSaveName);
    this.app.debug('checking the track', trackFile, 'if should send');
    
    const exists = await fs.pathExists(trackFile);
    const size = exists ? (await fs.lstat(trackFile)).size : 0;
    
    this.app.debug(`'${trackFile}'.size=${size} ${trackFile}'.exists=${exists}`);
    return size > 0;
  }

  /**
   * Send track data to API
   */
  async sendTrack() {
    if (!this.options.boatApiKey) {
      throw new Error('No boat API key set in plugin settings.');
    }

    this.app.debug('sending the data');
    const pendingFile = path.join(this.trackDir, this.routeSaveName);
    const trackData = await this.createTrackFromFile(pendingFile);
    
    if (!trackData) {
      throw new Error('Recorded track did not contain any valid track points, aborting sending.');
    }
    
    this.app.debug('created track data with timestamp:', new Date(trackData.timestamp));
    
    const params = new URLSearchParams();
    params.append('timestamp', trackData.timestamp);
    params.append('track', JSON.stringify(trackData.track));
    params.append('boatApiKey', this.options.boatApiKey);
    
    const headers = { 'X-NFL-API-Key': this.pluginApiKey };
    this.app.debug('sending track to API');

    const success = await this.sendWithRetry(params, headers);
    
    if (success) {
      await this.handleSuccessfulSend(pendingFile);
    }
    
    return success;
  }

  /**
   * Send data with retry logic
   */
  async sendWithRetry(params, headers) {
    const maxRetries = 3;
    const baseTimeout = (this.options.apiTimeout || 30) * 1000;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const currentTimeout = baseTimeout * attempt;
        this.app.debug(`Attempt ${attempt}/${maxRetries} with ${currentTimeout}ms timeout`);
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), currentTimeout);
        
        const response = await fetch(this.apiUrl, { 
          method: 'POST', 
          body: params, 
          headers: new fetch.Headers(headers),
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (response.ok) {
          const responseBody = await response.json();
          if (responseBody.status === 'ok') {
            this.app.debug('Track successfully sent to API');
            return true;
          } else {
            this.app.debug('Could not send track to API, returned response json:', responseBody);
            throw new Error('API returned error.');
          }
        } else {
          this.app.debug('Could not send track to API, returned response code:', response.status, response.statusText);
          if (response.status >= 400 && response.status < 500) {
            throw new Error(`HTTP ${response.status}.`);
          }
          throw new Error(`HTTP ${response.status}`);
        }
      } catch (err) {
        this.app.debug(`Attempt ${attempt} failed:`, err.message);
        
        if (attempt === maxRetries) {
          this.app.debug('Could not send track to API after', maxRetries, 'attempts:', err);
          throw new Error(`Failed to send track after ${maxRetries} attempts - check logs for details.`);
        } else {
          const waitTime = 2000 * attempt;
          this.app.debug(`Waiting ${waitTime}ms before retry...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }
      }
    }
    
    return false;
  }

  /**
   * Handle successful send (archive or delete track file)
   */
  async handleSuccessfulSend(pendingFile) {
    const sentFile = path.join(this.trackDir, this.routeSentName);
    
    try {
      if (this.options.keepFiles) {
        this.app.debug('Appending sent data to archive file:', this.routeSentName);
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

  /**
   * Create track data from file
   */
  async createTrackFromFile(inputPath) {
    const fileStream = fs.createReadStream(inputPath);
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
    const track = [];
    let lastTimestamp;
    
    for await (const line of rl) {
      if (line) {
        try {
          const point = JSON.parse(line);
          const timestamp = new Date(point.t).getTime();
          
          if (!isNaN(timestamp) && 
              this.isValidLatitude(point.lat) && 
              this.isValidLongitude(point.lon)) {
            track.push([timestamp, point.lat, point.lon]);
            lastTimestamp = timestamp;
          }
        } catch (error) {
          this.app.debug('could not parse line from track file:', line);
        }
      }
    }
    
    if (track.length > 0) {
      return { timestamp: new Date(lastTimestamp).getTime(), track };
    }
    
    return null;
  }

  /**
   * Validate latitude
   */
  isValidLatitude(obj) {
    return (obj !== undefined && obj !== null && typeof obj === 'number' && obj > -90 && obj < 90);
  }
  
  /**
   * Validate longitude
   */
  isValidLongitude(obj) {
    return (obj !== undefined && obj !== null && typeof obj === 'number' && obj > -180 && obj < 180);
  }
}

module.exports = TrackSender;