/**
 * Monitors GNSS position health and reports errors
 */

import type {
  SignalKApp,
  FlatConfig,
  GetLastPositionReceived,
  GetPositionSource,
  OnErrorCallback,
  OnHealthyCallback,
} from '../types';

const BASE_STALE_THRESHOLD_SECONDS = 300;
const TRACK_FREQUENCY_HEADROOM_SECONDS = 60;

/**
 * Compute the staleness threshold from the configured trackFrequency.
 * navigation.position is subscribed with `minPeriod: trackFrequency * 1000`,
 * so the plugin only sees one delivery per trackFrequency window. We need at
 * least two windows of headroom before declaring the source dead, otherwise
 * any user with trackFrequency >= 150s gets false "No GNSS position data"
 * errors on a perfectly healthy GNSS.
 */
export function computeStaleThresholdSeconds(trackFrequencySeconds: number): number {
  const derived = trackFrequencySeconds * 2 + TRACK_FREQUENCY_HEADROOM_SECONDS;
  return Math.max(BASE_STALE_THRESHOLD_SECONDS, derived);
}

export class HealthMonitor {
  private app: SignalKApp;
  private checkInterval: ReturnType<typeof setInterval> | null = null;
  private initialTimeout: ReturnType<typeof setTimeout> | null = null;
  private staleThresholdSeconds: number;

  constructor(app: SignalKApp, options: FlatConfig) {
    this.app = app;
    this.staleThresholdSeconds = computeStaleThresholdSeconds(options.trackFrequency);
  }

  /**
   * Start position health monitoring
   */
  start(
    getLastPositionReceived: GetLastPositionReceived,
    getPositionSource: GetPositionSource,
    onError: OnErrorCallback,
    onHealthy: OnHealthyCallback
  ): void {
    // Periodic health check every 5 minutes
    this.checkInterval = setInterval(
      () => {
        this.performHealthCheck(getLastPositionReceived(), getPositionSource(), onError, onHealthy);
      },
      5 * 60 * 1000
    );

    // Initial check after 2 minutes of startup
    this.initialTimeout = setTimeout(
      () => {
        this.performInitialCheck(getLastPositionReceived(), getPositionSource(), onError);
      },
      2 * 60 * 1000
    );
  }

  /**
   * Perform periodic health check
   */
  performHealthCheck(
    lastPositionReceived: number | null,
    positionSource: string | null,
    onError: OnErrorCallback,
    onHealthy: OnHealthyCallback
  ): void {
    const now = Date.now();
    const timeSinceLastPosition = lastPositionReceived ? (now - lastPositionReceived) / 1000 : null;
    const fromSource = positionSource ? ` from source '${positionSource}'` : '';

    if (!lastPositionReceived) {
      onError(
        'No GNSS position data received. Check that your GNSS is connected and SignalK is receiving navigation.position data.'
      );
      this.app.debug('Position health check: No position data ever received');
    } else if (
      timeSinceLastPosition !== null &&
      timeSinceLastPosition > this.staleThresholdSeconds
    ) {
      onError(
        `No GNSS position data${fromSource} for ${String(Math.floor(timeSinceLastPosition / 60))} minutes. Check your GNSS connection.`
      );
      this.app.debug(
        `Position health check: No position for ${timeSinceLastPosition.toFixed(0)} seconds` +
          fromSource
      );
    } else {
      this.app.debug(
        `Position health check: OK (last position ${timeSinceLastPosition?.toFixed(0) ?? 'unknown'} seconds ago${fromSource})`
      );
      onHealthy();
    }
  }

  /**
   * Perform initial health check after startup
   */
  performInitialCheck(
    lastPositionReceived: number | null,
    positionSource: string | null,
    onError: OnErrorCallback
  ): void {
    if (!lastPositionReceived) {
      onError(
        'No GNSS position data received after 2 minutes. Check that your GNSS is connected and SignalK is receiving navigation.position data.'
      );
      this.app.debug(
        'Initial position check: No position data received' +
          (positionSource ? ` from source '${positionSource}'` : '')
      );
    }
  }

  /**
   * Stop health monitoring
   */
  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    if (this.initialTimeout) {
      clearTimeout(this.initialTimeout);
      this.initialTimeout = null;
    }
  }
}

export default HealthMonitor;
