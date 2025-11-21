const { EOL } = require('os');
const fs = require('fs-extra');
const path = require('path');

class TrackLogger {
  constructor(app, options, trackDir) {
    this.app = app;
    this.options = options;
    this.trackDir = trackDir;
    this.routeSaveName = 'pending.jsonl';
    
    this.lastPosition = null;
    this.lastPositionReceived = null;
    this.autoSelectedSource = null;
    this.unsubscribes = [];
  }

  /**
   * Start logging position data
   */
  startLogging(onSavePoint) {
    let shouldDoLog = true;

    // Subscribe to position updates
    this.app.subscriptionmanager.subscribe({
      context: 'vessels.self',
      subscribe: [{
        path: 'navigation.position',
        format: 'delta',
        policy: 'instant',
        minPeriod: this.options.trackFrequency ? this.options.trackFrequency * 1000 : 0
      }]
    }, this.unsubscribes, 
    (subscriptionError) => {
      this.app.debug('Error subscription to data:' + subscriptionError);
      throw new Error('Error subscription to data:' + subscriptionError.message);
    }, 
    this.doOnValue.bind(this, () => shouldDoLog, newShould => { shouldDoLog = newShould; }, onSavePoint));

    // Subscribe for speed if minSpeed is configured
    if (this.options.minSpeed) {
      this.subscribeToSpeed(() => shouldDoLog, newShould => { shouldDoLog = newShould; });
    }
  }

  /**
   * Subscribe to speed over ground
   */
  subscribeToSpeed(getShouldDoLog, setShouldDoLog) {
    this.app.subscriptionmanager.subscribe({
      context: 'vessels.self',
      subscribe: [{
        path: 'navigation.speedOverGround',
        format: 'delta',
        policy: 'instant'
      }]
    }, this.unsubscribes, 
    (subscriptionError) => {
      this.app.debug('Error subscription to data:' + subscriptionError);
      throw new Error('Error subscription to data:' + subscriptionError.message);
    }, 
    (delta) => {
      delta.updates.forEach(update => {
        if (this.options.filterSource && update.$source !== this.options.filterSource) {
          return;
        }
        update.values.forEach(value => {
          const speedInKnots = value.value * 1.94384; 
          if (!getShouldDoLog() && this.options.minSpeed < speedInKnots) { 
            this.app.debug('setting shouldDoLog to true, speed:', speedInKnots.toFixed(2), 'knots'); 
            setShouldDoLog(true); 
          }
        });
      });
    });
  }

  /**
   * Handle incoming position values
   */
  async doOnValue(getShouldDoLog, setShouldDoLog, onSavePoint, delta) {
    for (const update of delta.updates) {
      // Handle source selection (auto or filtered)
      if (!this.handleSourceSelection(update)) {
        continue;
      }
      
      const timestamp = update.timestamp;
      
      for (const value of update.values) {
        // Validate position
        if (!this.isValidPosition(value.value)) {
          continue;
        }

        // Check if we should save (24h ping or shouldDoLog)
        const force24hSave = this.should24hPing();
        if (!force24hSave && !getShouldDoLog()) {
          this.app.debug('shouldDoLog is false, not logging position');
          continue;
        }

        // Check timestamp and distance
        if (this.lastPosition && !force24hSave) {
          if (!this.shouldLogPosition(timestamp, value.value)) {
            continue;
          }
        }

        // Save point
        this.app.debug('Saving position from source:', update.$source, 
          'lat:', value.value.latitude, 'lon:', value.value.longitude);
        
        this.lastPosition = { 
          pos: value.value, 
          timestamp, 
          currentTime: new Date().getTime() 
        };
        
        await this.savePoint(this.lastPosition);
        onSavePoint(this.lastPosition);

        // Reset shouldDoLog if minSpeed is active
        if (this.options.minSpeed) {
          this.app.debug('options.minSpeed - setting shouldDoLog to false');
          setShouldDoLog(false);
        }
      }
    }
  }

  /**
   * Handle GNSS source selection (auto-select or filtered)
   */
  handleSourceSelection(update) {
    if (!this.options.filterSource) {
      // Auto-select logic
      const timeSinceLastPosition = this.lastPositionReceived 
        ? (new Date().getTime() - this.lastPositionReceived) / 1000 
        : null;
      
      if (!this.autoSelectedSource) {
        this.autoSelectedSource = update.$source;
        this.lastPositionReceived = new Date().getTime();
        this.app.debug(`Auto-selected GNSS source: '${this.autoSelectedSource}'`);
      } else if (update.$source !== this.autoSelectedSource) {
        if (timeSinceLastPosition && timeSinceLastPosition > 300) {
          this.app.debug(`Switching from stale source '${this.autoSelectedSource}' to '${update.$source}' (no data for ${timeSinceLastPosition.toFixed(0)}s)`);
          this.autoSelectedSource = update.$source;
          this.lastPositionReceived = new Date().getTime();
        } else {
          this.app.debug(`Ignoring position from '${update.$source}', using auto-selected source '${this.autoSelectedSource}'`);
          return false;
        }
      } else {
        this.lastPositionReceived = new Date().getTime();
      }
    } else if (update.$source !== this.options.filterSource) {
      // Filtered source
      this.app.debug(`Ignoring position from '${update.$source}', filterSource is set to '${this.options.filterSource}'`);
      return false;
    } else {
      this.lastPositionReceived = new Date().getTime();
    }
    
    return true;
  }

  /**
   * Validate position (lat/lon and not at 0,0)
   */
  isValidPosition(position) {
    // Check if near (0,0) - likely invalid
    if (Math.abs(position.latitude) <= 0.01 && Math.abs(position.longitude) <= 0.01) {
      this.app.debug('GNSS coordinates near (0,0), ignoring point to avoid invalid data logging.');
      return false;
    }
    
    // Validate lat/lon ranges
    if (!this.isValidLatitude(position.latitude) || !this.isValidLongitude(position.longitude)) {
      this.app.debug('got invalid position, ignoring...', position);
      return false;
    }
    
    return true;
  }

  /**
   * Check if 24h ping should force a save
   */
  should24hPing() {
    if (this.options.ping_api_every_24h && this.lastPosition) {
      const timeSinceLastPoint = (new Date().getTime() - this.lastPosition.currentTime);
      if (timeSinceLastPoint >= 24 * 60 * 60 * 1000) {
        this.app.debug('24h since last point, forcing save of point to keep boat active on NFL');
        return true;
      }
    }
    return false;
  }

  /**
   * Check if position should be logged based on timestamp and distance
   */
  shouldLogPosition(timestamp, position) {
    // Check timestamp
    if (new Date(this.lastPosition.timestamp).getTime() > new Date(timestamp).getTime()) {
      this.app.debug('got error in timestamp:', timestamp, 'is earlier than previous:', this.lastPosition.timestamp);
      return false;
    }
    
    // Check distance
    const distance = this.equirectangularDistance(this.lastPosition.pos, position);
    if (this.options.minMove && distance < this.options.minMove) {
      this.app.debug('Distance', distance.toFixed(2), 'm is less than minMove', this.options.minMove, 'm - skipping');
      return false;
    }
    
    this.app.debug('Distance', distance.toFixed(2), 'm is greater than minMove', this.options.minMove, 'm - logging');
    return true;
  }

  /**
   * Save position point to file
   */
  async savePoint(point) {
    const obj = {
      lat: point.pos.latitude,
      lon: point.pos.longitude,
      t: point.timestamp
    };
    this.app.debug(`save data point:`, obj);
    await fs.appendFile(
      path.join(this.trackDir, this.routeSaveName), 
      JSON.stringify(obj) + EOL
    );
  }

  /**
   * Calculate distance between two positions
   */
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

  /**
   * Validate latitude
   */
  isValidLatitude(obj) {
    return this.isDefinedNumber(obj) && obj > -90 && obj < 90;
  }
  
  /**
   * Validate longitude
   */
  isValidLongitude(obj) {
    return this.isDefinedNumber(obj) && obj > -180 && obj < 180;
  }
  
  /**
   * Check if value is a defined number
   */
  isDefinedNumber(obj) {
    return (obj !== undefined && obj !== null && typeof obj === 'number');
  }

  /**
   * Stop logging and unsubscribe
   */
  stop() {
    this.unsubscribes.forEach(f => f());
    this.unsubscribes = [];
    this.autoSelectedSource = null;
  }

  /**
   * Get last position
   */
  getLastPosition() {
    return this.lastPosition;
  }

  /**
   * Get last position received time
   */
  getLastPositionReceived() {
    return this.lastPositionReceived;
  }

  /**
   * Get auto-selected source
   */
  getAutoSelectedSource() {
    return this.autoSelectedSource;
  }
}

module.exports = TrackLogger;