/**
 * Monitors GNSS position health and reports errors
 */

import type {
  SignalKApp,
  FlatConfig,
  GetLastPositionReceived,
  GetAutoSelectedSource,
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
  private options: FlatConfig;
  private checkInterval: ReturnType<typeof setInterval> | null = null;
  private initialTimeout: ReturnType<typeof setTimeout> | null = null;
  private staleThresholdSeconds: number;

  constructor(app: SignalKApp, options: FlatConfig) {
    this.app = app;
    this.options = options;
    this.staleThresholdSeconds = computeStaleThresholdSeconds(options.trackFrequency);
  }

  /**
   * Start position health monitoring
   */
  start(
    getLastPositionReceived: GetLastPositionReceived,
    getAutoSelectedSource: GetAutoSelectedSource,
    onError: OnErrorCallback,
    onHealthy: OnHealthyCallback
  ): void {
    // Periodic health check every 5 minutes
    this.checkInterval = setInterval(
      () => {
        this.performHealthCheck(
          getLastPositionReceived(),
          getAutoSelectedSource(),
          onError,
          onHealthy
        );
      },
      5 * 60 * 1000
    );

    // Initial check after 2 minutes of startup
    this.initialTimeout = setTimeout(
      () => {
        this.performInitialCheck(getLastPositionReceived(), getAutoSelectedSource(), onError);
      },
      2 * 60 * 1000
    );
  }

  /**
   * Perform periodic health check
   */
  performHealthCheck(
    lastPositionReceived: number | null,
    autoSelectedSource: string | null,
    onError: OnErrorCallback,
    onHealthy: OnHealthyCallback
  ): void {
    const now = Date.now();
    const timeSinceLastPosition = lastPositionReceived ? (now - lastPositionReceived) / 1000 : null;

    const activeSource = this.options.filterSource || autoSelectedSource || 'any';
    const filterMsg = activeSource !== 'any' ? ` from source '${activeSource}'` : '';

    if (!lastPositionReceived) {
      const errorMsg = this.options.filterSource
        ? `No GNSS position data received from filtered source '${this.options.filterSource}'. Check Expert Settings > Position source device, or leave empty to use any GNSS source.`
        : 'No GNSS position data received. Check that your GNSS is connected and SignalK is receiving navigation.position data.';

      onError(errorMsg);
      this.app.debug('Position health check: No position data ever received' + filterMsg);
    } else if (
      timeSinceLastPosition !== null &&
      timeSinceLastPosition > this.staleThresholdSeconds
    ) {
      const errorMsg = this.options.filterSource
        ? `No GNSS position data${filterMsg} for ${String(Math.floor(timeSinceLastPosition / 60))} minutes. Check that source '${this.options.filterSource}' is active, or change/clear Position source device in Expert Settings.`
        : `No GNSS position data${filterMsg} for ${String(Math.floor(timeSinceLastPosition / 60))} minutes. Check your GNSS connection.`;

      onError(errorMsg);
      this.app.debug(
        `Position health check: No position for ${timeSinceLastPosition.toFixed(0)} seconds` +
          filterMsg
      );
    } else {
      this.app.debug(
        `Position health check: OK (last position ${timeSinceLastPosition?.toFixed(0) ?? 'unknown'} seconds ago${filterMsg})`
      );
      onHealthy();
    }
  }

  /**
   * Perform initial health check after startup
   */
  performInitialCheck(
    lastPositionReceived: number | null,
    autoSelectedSource: string | null,
    onError: OnErrorCallback
  ): void {
    if (!lastPositionReceived) {
      const activeSource = this.options.filterSource || autoSelectedSource || 'any';
      const errorMsg = this.options.filterSource
        ? `No GNSS position data received after 2 minutes from filtered source '${this.options.filterSource}'. Check Expert Settings > Position source device. You may need to leave it empty to use any available GNSS source.`
        : 'No GNSS position data received after 2 minutes. Check that your GNSS is connected and SignalK is receiving navigation.position data.';

      onError(errorMsg);
      this.app.debug(
        'Initial position check: No position data received' +
          (activeSource !== 'any' ? ` from source '${activeSource}'` : '')
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
