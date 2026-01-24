/**
 * GPS position with latitude and longitude
 */
export interface Position {
  latitude: number;
  longitude: number;
}

/**
 * Track point as stored in JSONL files
 */
export interface TrackPoint {
  lat: number;
  lon: number;
  t: string; // ISO timestamp
}

/**
 * Position with metadata for internal tracking
 */
export interface SavedPosition {
  pos: Position;
  timestamp: string;
  currentTime: number; // ms since epoch
}

/**
 * Track data formatted for NFL API
 */
export interface TrackData {
  timestamp: number;
  track: Array<[number, number, number]>; // [timestamp_ms, lat, lon]
}
