/**
 * One upload pass, run on every cron tick: what the Tracks plugin recorded
 * since the last pass, filtered, uploaded in chunks.
 */

import type { FlatConfig, Fix } from '../types';
import { selectFixes } from '../utils/trackFilter';
import { validatePosition } from '../utils/validation';
import type { UploadState } from './UploadState';

/** NFL has no documented limit; this keeps one request small on a slow link. */
export const MAX_FIXES_PER_UPLOAD = 1000;

const KEEP_ALIVE_MS = 24 * 60 * 60 * 1000;

export interface UploaderDeps {
  fixesAfter: (afterMs: number) => Promise<Fix[]>;
  sendFixes: (fixes: readonly Fix[]) => Promise<void>;
  loadState: () => Promise<UploadState | null>;
  saveState: (state: UploadState) => Promise<void>;
  readPending: () => Promise<Fix[]>;
  replacePending: (remaining: readonly Fix[]) => Promise<void>;
  /** The live position, for a keep-alive while the Tracks plugin has nothing new. */
  currentFix: () => Fix | null;
  debug: (...args: unknown[]) => void;
}

export interface PassResult {
  /** The newest fix the Tracks plugin has recorded, if this pass saw one. */
  newestRecorded?: Fix;
  /** Fixes NFL accepted in this pass. */
  uploaded: number;
  /** Held back because the boat is moving and sendWhileMoving is off. */
  deferred: boolean;
}

export class TrackUploader {
  constructor(
    private readonly options: FlatConfig,
    private readonly deps: UploaderDeps
  ) {}

  async run(now: number = Date.now()): Promise<PassResult> {
    const state = (await this.deps.loadState()) ?? (await this.drainPending(now));

    const recorded = await this.deps.fixesAfter(state.cursor);
    const newestRecorded = recorded.at(-1);
    const { kept, previous } = selectFixes(recorded, state, {
      minIntervalMs: this.options.trackFrequency * 1000,
      minMoveMeters: this.options.minMove,
      minSpeedKnots: this.options.minSpeed,
    });

    if (kept.length === 0) {
      const keepAlive = this.keepAliveFix(state, newestRecorded, now);
      if (keepAlive) {
        kept.push(keepAlive);
      }
    }

    const newestKept = kept.at(-1);
    if (newestKept && !this.options.sendWhileMoving && this.isMoving(newestKept, now)) {
      this.deps.debug('Boat is moving and sendWhileMoving is off, holding the upload back');
      return { newestRecorded, uploaded: 0, deferred: true };
    }

    let uploaded = 0;
    for (const chunk of chunks(kept)) {
      await this.deps.sendFixes(chunk);
      uploaded += chunk.length;
      const last = chunk[chunk.length - 1];
      // A keep-alive from the live position may be newer than anything the
      // Tracks plugin has recorded yet; the cursor stays on recorded fixes so
      // none of those is skipped. The spacing rule drops any older than it.
      if (recorded.includes(last)) {
        state.cursor = last.time;
        state.previous = last;
      }
      state.uploaded = last;
      await this.deps.saveState(state);
    }

    if (newestRecorded && newestRecorded.time > state.cursor) {
      state.cursor = newestRecorded.time;
      state.previous = previous;
      await this.deps.saveState(state);
    }

    return { newestRecorded, uploaded, deferred: false };
  }

  /**
   * The first pass after 1.x: upload what it left pending, then start the
   * cursor after it, or at `now` when nothing was pending. Never earlier:
   * NFL keeps every point it is sent, and everything recorded before was
   * either uploaded by 1.x or is in that file.
   */
  private async drainPending(now: number): Promise<UploadState> {
    const pending = await this.deps.readPending();
    if (pending.length > 0) {
      this.deps.debug(`Uploading ${String(pending.length)} fixes left pending by version 1`);
    }
    let remaining = pending;
    for (const chunk of chunks(pending)) {
      await this.deps.sendFixes(chunk);
      remaining = remaining.slice(chunk.length);
      await this.deps.replacePending(remaining);
    }

    const last = pending.at(-1);
    const state: UploadState = last
      ? { version: 1, cursor: last.time, previous: last, uploaded: last }
      : { version: 1, cursor: now };
    await this.deps.saveState(state);
    return state;
  }

  private keepAliveFix(
    state: UploadState,
    newestRecorded: Fix | undefined,
    now: number
  ): Fix | null {
    if (!this.options.ping_api_every_24h) {
      return null;
    }
    if (state.uploaded && now - state.uploaded.time < KEEP_ALIVE_MS) {
      return null;
    }
    const candidate = newestRecorded ?? this.deps.currentFix();
    if (
      !candidate ||
      !validatePosition(candidate).valid ||
      (state.uploaded && candidate.time <= state.uploaded.time)
    ) {
      return null;
    }
    this.deps.debug(
      'Nothing uploaded for 24 hours, sending the current position to stay active on NFL'
    );
    return candidate;
  }

  private isMoving(newest: Fix, now: number): boolean {
    if (this.options.trackFrequency <= 0) {
      return false;
    }
    return now - newest.time <= this.options.trackFrequency * 2 * 1000;
  }
}

function* chunks(fixes: readonly Fix[]): Generator<Fix[]> {
  for (let i = 0; i < fixes.length; i += MAX_FIXES_PER_UPLOAD) {
    yield fixes.slice(i, i + MAX_FIXES_PER_UPLOAD);
  }
}
