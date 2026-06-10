/**
 * Sends track data to the NFL API
 */

import fs from 'fs-extra';
import path from 'path';
import readline from 'readline';
import fetch, { Headers } from 'node-fetch';
import type { SignalKApp, FlatConfig, SavedPosition, TrackData, NFLApiResponse } from '../types';
import { NFL_PLUGIN_API_KEY, NFL_API_URL } from '../types/api';
import { isValidLatitude, isValidLongitude } from '../utils/validation';
import { describeFetchError } from '../utils/errors';

/**
 * Custom error class to distinguish retryable from non-retryable errors
 */
class ApiError extends Error {
  readonly retryable: boolean;

  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = 'ApiError';
    this.retryable = retryable;
  }
}

export class TrackSender {
  private app: SignalKApp;
  private options: FlatConfig;
  private trackDir: string;
  private routeSaveName = 'pending.jsonl';
  private routeSentName = 'sent.jsonl';

  constructor(app: SignalKApp, options: FlatConfig, trackDir: string) {
    this.app = app;
    this.options = options;
    this.trackDir = trackDir;
  }

  /**
   * Check if boat is currently moving
   */
  isBoatMoving(lastPosition: SavedPosition | null, upSince: number): boolean {
    if (!this.options.trackFrequency) {
      return true;
    }

    const time = lastPosition ? lastPosition.currentTime : upSince;
    const secsSinceLastPoint = (Date.now() - time) / 1000;
    const isMoving = secsSinceLastPoint <= this.options.trackFrequency * 2;

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
  async hasTrackData(): Promise<boolean> {
    const trackFile = path.join(this.trackDir, this.routeSaveName);
    this.app.debug('checking the track', trackFile, 'if should send');

    const exists = await fs.pathExists(trackFile);
    const size = exists ? (await fs.lstat(trackFile)).size : 0;

    this.app.debug(`'${trackFile}'.size=${String(size)} ${trackFile}'.exists=${String(exists)}`);
    return size > 0;
  }

  /**
   * Send track data to API
   */
  async sendTrack(): Promise<boolean> {
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
    params.append('timestamp', String(trackData.timestamp));
    params.append('track', JSON.stringify(trackData.track));
    params.append('boatApiKey', this.options.boatApiKey);

    const headers = { 'X-NFL-API-Key': NFL_PLUGIN_API_KEY };
    this.app.debug('sending track to API');

    const success = await this.sendWithRetry(params, headers);

    if (success) {
      await this.handleSuccessfulSend(pendingFile);
    }

    return success;
  }

  /**
   * Send data with retry logic
   * Only retries on network errors and 5xx server errors
   * Does NOT retry on 4xx client errors (invalid API key, bad request, etc.)
   */
  async sendWithRetry(params: URLSearchParams, headers: Record<string, string>): Promise<boolean> {
    const maxRetries = 3;
    const baseTimeout = (this.options.apiTimeout || 30) * 1000;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const currentTimeout = baseTimeout * attempt;
        this.app.debug(
          `Attempt ${String(attempt)}/${String(maxRetries)} with ${String(currentTimeout)}ms timeout`
        );

        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
          controller.abort();
        }, currentTimeout);

        const response = await fetch(NFL_API_URL, {
          method: 'POST',
          body: params,
          headers: new Headers(headers),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (response.ok) {
          const responseBody = (await response.json()) as NFLApiResponse;
          if (responseBody.status === 'ok') {
            this.app.debug('Track successfully sent to API');
            return true;
          } else {
            // API returned error with message - don't retry, this is a client-side issue
            const apiMessage = responseBody.message ?? 'Unknown API error';
            this.app.debug('API returned error:', apiMessage);
            throw new ApiError(apiMessage, false);
          }
        } else {
          this.app.debug(
            'Could not send track to API, returned response code:',
            response.status,
            response.statusText
          );
          // 4xx = client error (don't retry), 5xx = server error (retry)
          const shouldRetry = response.status >= 500;
          throw new ApiError(`HTTP ${String(response.status)} ${response.statusText}`, shouldRetry);
        }
      } catch (err) {
        const error = err as Error;
        // Network errors are retryable, API errors depend on the error type
        const shouldRetry = err instanceof ApiError ? err.retryable : true;

        // Replace cryptic node-fetch AbortError message with a human-readable one.
        // For other network failures, describeFetchError fills in the diagnostic
        // code when node-fetch left the FetchError reason blank (issue #44).
        const message =
          error.name === 'AbortError'
            ? `Request timed out after ${String((baseTimeout * attempt) / 1000)}s`
            : describeFetchError(err);

        this.app.debug(`Attempt ${String(attempt)} failed:`, message);

        if (!shouldRetry || attempt === maxRetries) {
          // Don't retry client errors or if we've exhausted retries
          throw new Error(message, { cause: err });
        } else {
          const waitTime = 2000 * attempt;
          this.app.debug(`Waiting ${String(waitTime)}ms before retry...`);
          await new Promise((resolve) => setTimeout(resolve, waitTime));
        }
      }
    }

    return false;
  }

  /**
   * Handle successful send (archive or delete track file)
   */
  async handleSuccessfulSend(pendingFile: string): Promise<void> {
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
      const error = err as Error;
      this.app.debug('Error handling files after successful send:', error.message);
    }
  }

  /**
   * Create track data from file
   */
  async createTrackFromFile(inputPath: string): Promise<TrackData | null> {
    const fileStream = fs.createReadStream(inputPath);
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
    const track: Array<[number, number, number]> = [];
    let lastTimestamp = 0;

    for await (const line of rl) {
      if (line) {
        try {
          const point = JSON.parse(line) as { lat: unknown; lon: unknown; t: string };
          const timestamp = new Date(point.t).getTime();

          const lat = point.lat;
          const lon = point.lon;
          if (!isNaN(timestamp) && isValidLatitude(lat) && isValidLongitude(lon)) {
            track.push([timestamp, lat, lon]);
            lastTimestamp = timestamp;
          }
        } catch {
          this.app.debug('could not parse line from track file:', line);
        }
      }
    }

    if (track.length > 0) {
      return { timestamp: lastTimestamp, track };
    }

    return null;
  }
}

export default TrackSender;
