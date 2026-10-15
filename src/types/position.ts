/**
 * GPS position with latitude and longitude
 */
export interface Position {
  latitude: number;
  longitude: number;
}

/**
 * One recorded position of the own vessel.
 */
export interface Fix {
  /** Recording time, ms since epoch */
  time: number;
  latitude: number;
  longitude: number;
}

/**
 * Track data formatted for NFL API
 */
export interface TrackData {
  timestamp: number;
  track: Array<[number, number, number]>; // [timestamp_ms, lat, lon]
}
