/**
 * Version 1.x kept the fixes it had not uploaded yet in pending.jsonl. They
 * were recorded before the Tracks plugin necessarily was, so on the first
 * start of 2.x they are uploaded from the file, once, before anything else.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type { Fix, PluginConfig } from '../types';
import { isValidLatitude, isValidLongitude } from '../utils/validation';

const LEGACY_TRACK_DIR = 'nfl-track';
const PENDING_FILE_NAME = 'pending.jsonl';

/**
 * Where 1.x kept pending.jsonl: its `trackDir` setting, relative to the data
 * directory unless absolute. The setting is gone from the schema, but a
 * configuration saved by 1.x still carries it.
 */
export function legacyPendingFile(config: PluginConfig, dataDir: string): string {
  const configured = legacyTrackDir(config);
  const dir = configured ? configured : LEGACY_TRACK_DIR;
  return path.join(path.isAbsolute(dir) ? dir : path.join(dataDir, dir), PENDING_FILE_NAME);
}

function legacyTrackDir(config: PluginConfig): string | undefined {
  const expert: unknown = config.expert;
  if (
    typeof expert === 'object' &&
    expert !== null &&
    'trackDir' in expert &&
    typeof expert.trackDir === 'string'
  ) {
    return expert.trackDir;
  }
  return config.trackDir;
}

export class PendingFile {
  constructor(private readonly file: string) {}

  /** The fixes still waiting in the file, oldest first; none when there is no file. */
  async read(): Promise<Fix[]> {
    let text: string;
    try {
      text = await fs.readFile(this.file, 'utf8');
    } catch {
      return [];
    }
    return text
      .split(/\r?\n/)
      .flatMap((line) => parseLine(line))
      .sort((a, b) => a.time - b.time);
  }

  /** Keeps `fixes` as what is still to upload, or removes the file when there are none. */
  async replace(fixes: readonly Fix[]): Promise<void> {
    if (fixes.length === 0) {
      await fs.rm(this.file, { force: true });
      return;
    }
    const lines = fixes.map((fix) =>
      JSON.stringify({
        lat: fix.latitude,
        lon: fix.longitude,
        t: new Date(fix.time).toISOString(),
      })
    );
    const temporary = `${this.file}.tmp`;
    await fs.writeFile(temporary, lines.join('\n') + '\n');
    await fs.rename(temporary, this.file);
  }
}

function parseLine(line: string): Fix[] {
  if (line.trim() === '') {
    return [];
  }
  try {
    const point = JSON.parse(line) as { lat?: unknown; lon?: unknown; t?: unknown };
    const time = typeof point.t === 'string' ? Date.parse(point.t) : NaN;
    if (Number.isNaN(time) || !isValidLatitude(point.lat) || !isValidLongitude(point.lon)) {
      return [];
    }
    return [{ time, latitude: point.lat, longitude: point.lon }];
  } catch {
    return [];
  }
}
