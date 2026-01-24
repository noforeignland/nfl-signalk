/**
 * Logs GPS position data to track files
 * Includes velocity-based outlier filtering to catch GPS anomalies
 */

import { EOL } from 'os';
import fs from 'fs-extra';
import path from 'path';
import type {
  SignalKApp,
  FlatConfig,
  Delta,
  Update,
  Position,
  PositionValue,
  SavedPosition,
  OnSavePointCallback,
  Unsubscribe,
} from '../types';
import { validatePosition, validateVelocity } from '../utils/validation';
import { equirectangularDistance, msToKnots } from '../utils/geo';

export class TrackLogger {
  private app: SignalKApp;
  private options: FlatConfig;
  private trackDir: string;
  private routeSaveName = 'pending.jsonl';

  private lastPosition: SavedPosition | null = null;
  private lastPositionReceived: number | null = null;
  private autoSelectedSource: string | null = null;
  private unsubscribes: Unsubscribe[] = [];

  constructor(app: SignalKApp, options: FlatConfig, trackDir: string) {
    this.app = app;
    this.options = options;
    this.trackDir = trackDir;
  }

  /**
   * Start logging position data
   */
  startLogging(onSavePoint: OnSavePointCallback): void {
    let shouldDoLog = true;

    // Subscribe to position updates
    this.app.subscriptionmanager.subscribe(
      {
        context: 'vessels.self',
        subscribe: [
          {
            path: 'navigation.position',
            format: 'delta',
            policy: 'instant',
            minPeriod: this.options.trackFrequency ? this.options.trackFrequency * 1000 : 0,
          },
        ],
      },
      this.unsubscribes,
      (subscriptionError: unknown) => {
        this.app.debug('Error subscription to data:', subscriptionError);
        throw new Error('Error subscription to data: ' + String(subscriptionError));
      },
      (delta: Delta) => {
        void this.doOnValue(
          () => shouldDoLog,
          (newShould: boolean) => {
            shouldDoLog = newShould;
          },
          onSavePoint,
          delta
        );
      }
    );

    // Subscribe for speed if minSpeed is configured
    if (this.options.minSpeed) {
      this.subscribeToSpeed(
        () => shouldDoLog,
        (newShould: boolean) => {
          shouldDoLog = newShould;
        }
      );
    }
  }

  /**
   * Subscribe to speed over ground
   */
  subscribeToSpeed(getShouldDoLog: () => boolean, setShouldDoLog: (value: boolean) => void): void {
    this.app.subscriptionmanager.subscribe(
      {
        context: 'vessels.self',
        subscribe: [
          {
            path: 'navigation.speedOverGround',
            format: 'delta',
            policy: 'instant',
          },
        ],
      },
      this.unsubscribes,
      (subscriptionError: unknown) => {
        this.app.debug('Error subscription to data:', subscriptionError);
        throw new Error('Error subscription to data: ' + String(subscriptionError));
      },
      (delta: Delta) => {
        for (const update of delta.updates) {
          if (this.options.filterSource && update.$source !== this.options.filterSource) {
            continue;
          }
          if (!update.values) continue;
          for (const value of update.values) {
            if (typeof value.value !== 'number') continue;
            const speedInMs = value.value;
            const speedInKnots = msToKnots(speedInMs);
            if (!getShouldDoLog() && this.options.minSpeed < speedInKnots) {
              this.app.debug(
                'setting shouldDoLog to true, speed:',
                speedInKnots.toFixed(2),
                'knots'
              );
              setShouldDoLog(true);
            }
          }
        }
      }
    );
  }

  /**
   * Handle incoming position values
   */
  async doOnValue(
    getShouldDoLog: () => boolean,
    setShouldDoLog: (value: boolean) => void,
    onSavePoint: OnSavePointCallback,
    delta: Delta
  ): Promise<void> {
    for (const update of delta.updates) {
      // Handle source selection (auto or filtered)
      if (!this.handleSourceSelection(update)) {
        continue;
      }

      const timestamp = update.timestamp;
      if (!timestamp) continue;

      if (!update.values) continue;
      for (const value of update.values) {
        const positionValue = value.value as PositionValue;

        // Validate position using new validation module
        const validationResult = validatePosition(positionValue);
        if (!validationResult.valid) {
          this.app.debug('Position validation failed:', validationResult.reason);
          continue;
        }

        // Check if we should save (24h ping or shouldDoLog)
        const force24hSave = this.should24hPing();
        if (!force24hSave && !getShouldDoLog()) {
          this.app.debug('shouldDoLog is false, not logging position');
          continue;
        }

        // Check timestamp, distance, and velocity
        if (this.lastPosition && !force24hSave) {
          if (!this.shouldLogPosition(timestamp, positionValue)) {
            continue;
          }
        }

        // Save point
        this.app.debug(
          'Saving position from source:',
          update.$source,
          'lat:',
          positionValue.latitude,
          'lon:',
          positionValue.longitude
        );

        this.lastPosition = {
          pos: positionValue,
          timestamp,
          currentTime: Date.now(),
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
  handleSourceSelection(update: Update): boolean {
    if (!this.options.filterSource) {
      // Auto-select logic
      const timeSinceLastPosition = this.lastPositionReceived
        ? (Date.now() - this.lastPositionReceived) / 1000
        : null;

      if (!this.autoSelectedSource) {
        this.autoSelectedSource = update.$source ?? null;
        this.lastPositionReceived = Date.now();
        this.app.debug(`Auto-selected GNSS source: '${this.autoSelectedSource ?? 'unknown'}'`);
      } else if (update.$source !== this.autoSelectedSource) {
        if (timeSinceLastPosition !== null && timeSinceLastPosition > 300) {
          this.app.debug(
            `Switching from stale source '${this.autoSelectedSource}' to '${update.$source ?? 'unknown'}' (no data for ${timeSinceLastPosition.toFixed(0)}s)`
          );
          this.autoSelectedSource = update.$source ?? null;
          this.lastPositionReceived = Date.now();
        } else {
          this.app.debug(
            `Ignoring position from '${update.$source ?? 'unknown'}', using auto-selected source '${this.autoSelectedSource}'`
          );
          return false;
        }
      } else {
        this.lastPositionReceived = Date.now();
      }
    } else if (update.$source !== this.options.filterSource) {
      // Filtered source
      this.app.debug(
        `Ignoring position from '${update.$source ?? 'unknown'}', filterSource is set to '${this.options.filterSource}'`
      );
      return false;
    } else {
      this.lastPositionReceived = Date.now();
    }

    return true;
  }

  /**
   * Check if 24h ping should force a save
   */
  should24hPing(): boolean {
    if (this.options.ping_api_every_24h && this.lastPosition) {
      const timeSinceLastPoint = Date.now() - this.lastPosition.currentTime;
      if (timeSinceLastPoint >= 24 * 60 * 60 * 1000) {
        this.app.debug('24h since last point, forcing save of point to keep boat active on NFL');
        return true;
      }
    }
    return false;
  }

  /**
   * Check if position should be logged based on timestamp, distance, and velocity
   */
  shouldLogPosition(timestamp: string, position: Position): boolean {
    if (!this.lastPosition) return true;

    // Check timestamp
    if (new Date(this.lastPosition.timestamp).getTime() > new Date(timestamp).getTime()) {
      this.app.debug(
        'got error in timestamp:',
        timestamp,
        'is earlier than previous:',
        this.lastPosition.timestamp
      );
      return false;
    }

    // Check distance
    const distance = equirectangularDistance(this.lastPosition.pos, position);
    if (this.options.minMove && distance < this.options.minMove) {
      this.app.debug(
        'Distance',
        distance.toFixed(2),
        'm is less than minMove',
        this.options.minMove,
        'm - skipping'
      );
      return false;
    }

    // NEW: Velocity sanity check to catch GPS outliers
    const velocityResult = validateVelocity(
      this.lastPosition.pos,
      position,
      this.lastPosition.timestamp,
      timestamp,
      this.options.maxVelocity
    );

    if (!velocityResult.valid) {
      this.app.debug('Velocity filter:', velocityResult.reason);
      return false;
    }

    this.app.debug(
      'Distance',
      distance.toFixed(2),
      'm is greater than minMove',
      this.options.minMove,
      'm - logging'
    );
    return true;
  }

  /**
   * Save position point to file
   */
  async savePoint(point: SavedPosition): Promise<void> {
    const obj = {
      lat: point.pos.latitude,
      lon: point.pos.longitude,
      t: point.timestamp,
    };
    this.app.debug(`save data point:`, obj);
    await fs.appendFile(path.join(this.trackDir, this.routeSaveName), JSON.stringify(obj) + EOL);
  }

  /**
   * Stop logging and unsubscribe
   */
  stop(): void {
    this.unsubscribes.forEach((f) => {
      f();
    });
    this.unsubscribes = [];
    this.autoSelectedSource = null;
  }

  /**
   * Get last position
   */
  getLastPosition(): SavedPosition | null {
    return this.lastPosition;
  }

  /**
   * Get last position received time
   */
  getLastPositionReceived(): number | null {
    return this.lastPositionReceived;
  }

  /**
   * Get auto-selected source
   */
  getAutoSelectedSource(): string | null {
    return this.autoSelectedSource;
  }
}

export default TrackLogger;
