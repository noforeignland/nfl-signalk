/**
 * NFL API types
 */

/**
 * API response from noforeignland.com
 */
export interface NFLApiResponse {
  status: 'ok' | 'error';
  message?: string;
}

/**
 * Track payload for API submission
 */
export interface TrackPayload {
  timestamp: number;
  track: Array<[number, number, number]>; // [timestamp_ms, lat, lon]
  boatApiKey: string;
}

/**
 * API configuration
 */
export interface ApiConfig {
  apiKey: string;
  boatApiKey: string;
  timeout: number;
}

/**
 * NFL Plugin API key (hardcoded)
 */
export const NFL_PLUGIN_API_KEY = '0ede6cb6-5213-45f5-8ab4-b4836b236f97';

/**
 * NFL API endpoint
 */
export const NFL_API_URL = 'https://www.noforeignland.com/home/api/v1/boat/tracking/track';
