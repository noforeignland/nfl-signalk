/**
 * Sends track data to the NFL API
 */

import https from 'node:https';
import fetch, { Headers } from 'node-fetch';
import type { SignalKApp, FlatConfig, Fix, TrackData, NFLApiResponse } from '../types';
import { NFL_PLUGIN_API_KEY, NFL_API_URL } from '../types/api';
import { describeFetchError } from '../utils/errors';

/**
 * Node >= 20 enables Happy Eyeballs with a 250 ms per-address connect cap.
 * The NFL API resolves to multiple addresses (Cloudflare dual-stack), so on
 * high-latency links (cellular/satellite at sea) every connect attempt is
 * aborted before the TLS handshake can start and fetch fails instantly with
 * ETIMEDOUT no matter what apiTimeout is set to (issue #44). Keep the
 * IPv6/IPv4 fallback but give each address a budget that survives slow links;
 * apiTimeout still bounds the request overall via the AbortController.
 */
const httpsAgent = new https.Agent({
  autoSelectFamily: true,
  autoSelectFamilyAttemptTimeout: 5000,
});

/** NFL logs this with each track to tell which plugin version a boat is uploading from. */
const PLUGIN_VERSION = __PLUGIN_VERSION__;
const NODE_VERSION = process.version;

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

  constructor(app: SignalKApp, options: FlatConfig) {
    this.app = app;
    this.options = options;
  }

  /**
   * Upload fixes as one track. Resolves once NFL has accepted them and throws
   * otherwise, so a caller only counts them as sent when this returns.
   */
  async sendFixes(fixes: readonly Fix[]): Promise<void> {
    if (!this.options.boatApiKey) {
      throw new Error('No boat API key set in plugin settings.');
    }
    const last = fixes.at(-1);
    if (!last) {
      return;
    }

    const trackData: TrackData = {
      timestamp: last.time,
      track: fixes.map((fix) => [fix.time, fix.latitude, fix.longitude]),
    };

    const params = new URLSearchParams();
    params.append('timestamp', String(trackData.timestamp));
    params.append('track', JSON.stringify(trackData.track));
    params.append('boatApiKey', this.options.boatApiKey);
    params.append('pluginVersion', PLUGIN_VERSION);
    params.append('skVersion', this.app.config?.version ?? 'unknown');
    params.append('nodeVersion', NODE_VERSION);

    const headers = { 'X-NFL-API-Key': NFL_PLUGIN_API_KEY };
    this.app.debug(`sending ${String(fixes.length)} fixes to the API`);

    if (!(await this.sendWithRetry(params, headers))) {
      throw new Error('Track upload did not complete');
    }
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

        // The timeout must stay armed until the response body has been read:
        // a truncated identity body otherwise leaves response.json() pending
        // forever and the send cron never runs again until a server restart.
        try {
          const response = await fetch(NFL_API_URL, {
            method: 'POST',
            body: params,
            headers: new Headers(headers),
            signal: controller.signal,
            agent: httpsAgent,
            // The API reply is a few bytes of JSON; a gzipped reply can die in
            // node-fetch's Gunzip stream with "Premature close", making a
            // delivered upload look failed. Don't ask for compression at all.
            compress: false,
          });

          if (response.ok) {
            let responseBody: NFLApiResponse;
            try {
              responseBody = (await response.json()) as NFLApiResponse;
            } catch (bodyErr) {
              // Any 2xx means the server already accepted and stored the
              // track. Failing to read the response body afterwards must not
              // count as a failed upload — retrying/resending the pending file
              // from here is what duplicates the whole track on the NFL map.
              this.app.debug(
                `Track delivered (HTTP ${String(response.status)}) but response body could not be read, treating as sent:`,
                describeFetchError(bodyErr)
              );
              return true;
            }
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
            throw new ApiError(
              `HTTP ${String(response.status)} ${response.statusText}`,
              shouldRetry
            );
          }
        } finally {
          clearTimeout(timeoutId);
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
}

export default TrackSender;
