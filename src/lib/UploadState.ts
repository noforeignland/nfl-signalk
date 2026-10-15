/**
 * Where the upload stands, kept in the plugin's data directory so a restart
 * neither resends what NFL already has nor skips what it does not.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { Type, type Static } from 'typebox';
import { Value } from 'typebox/value';

const FixSchema = Type.Object({
  time: Type.Number(),
  latitude: Type.Number(),
  longitude: Type.Number(),
});

const UploadStateSchema = Type.Object({
  version: Type.Literal(1),
  /** Fixes recorded at or before this time (ms) have been dealt with: uploaded or left out. */
  cursor: Type.Number(),
  /** The last fix looked at; speed for the next one is measured from it. */
  previous: Type.Optional(FixSchema),
  /** The last fix uploaded; spacing, distance and the 24 h keep-alive are measured from it. */
  uploaded: Type.Optional(FixSchema),
});

export type UploadState = Static<typeof UploadStateSchema>;

export const STATE_FILE_NAME = 'upload-state.json';

export class UploadStateStore {
  private readonly file: string;

  constructor(dataDir: string) {
    this.file = path.join(dataDir, STATE_FILE_NAME);
  }

  /**
   * The saved state, or null when there is none. An unreadable state is also
   * null: starting over from now loses at most the fixes since the last upload,
   * where trusting a bad cursor could resend the whole recorded track.
   */
  async load(): Promise<UploadState | null> {
    let text: string;
    try {
      text = await fs.readFile(this.file, 'utf8');
    } catch {
      return null;
    }
    try {
      const parsed: unknown = JSON.parse(text);
      return Value.Check(UploadStateSchema, parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  async save(state: UploadState): Promise<void> {
    const temporary = `${this.file}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(state));
    await fs.rename(temporary, this.file);
  }
}
