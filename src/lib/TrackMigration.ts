/**
 * Migrates old track file names to new naming scheme
 */

import fs from 'fs-extra';
import path from 'path';
import type { SignalKApp } from '../types';

export class TrackMigration {
  private app: SignalKApp;
  private trackDir: string;
  private routeSaveName = 'pending.jsonl';
  private routeSentName = 'sent.jsonl';

  constructor(app: SignalKApp, trackDir: string) {
    this.app = app;
    this.trackDir = trackDir;
  }

  /**
   * Migrate old track file names to new naming scheme
   */
  async migrate(): Promise<void> {
    const oldTrackFile = path.join(this.trackDir, 'nfl-track.jsonl');
    const oldPendingFile = path.join(this.trackDir, 'nfl-track-pending.jsonl');
    const oldSentFile = path.join(this.trackDir, 'nfl-track-sent.jsonl');
    const newPendingFile = path.join(this.trackDir, this.routeSaveName);
    const newSentFile = path.join(this.trackDir, this.routeSentName);

    try {
      // Migrate old track file
      await this.migrateSingleFile(oldTrackFile, newPendingFile, 'track file');

      // Migrate old pending file
      await this.migrateSingleFile(oldPendingFile, newPendingFile, 'pending file');

      // Migrate old sent file
      await this.migrateSingleFile(oldSentFile, newSentFile, 'sent file');

      // Check old plugin directory location
      await this.migrateFromOldPluginDir(newPendingFile, newSentFile);
    } catch (err) {
      const error = err as Error;
      this.app.debug('Error during track file migration:', error.message);
    }
  }

  /**
   * Migrate a single file if it exists
   */
  async migrateSingleFile(oldPath: string, newPath: string, description: string): Promise<void> {
    if ((await fs.pathExists(oldPath)) && !(await fs.pathExists(newPath))) {
      this.app.debug(`Migrating old ${description} to new naming scheme...`);
      await fs.move(oldPath, newPath);
      this.app.debug(`Successfully migrated old ${description} to: ${path.basename(newPath)}`);
    }
  }

  /**
   * Migrate track files from old plugin directory location
   */
  async migrateFromOldPluginDir(newPendingFile: string, newSentFile: string): Promise<void> {
    const oldPluginTrackDir = path.join(__dirname, '..', '..', 'track');

    if (!(await fs.pathExists(oldPluginTrackDir))) {
      return;
    }

    this.app.debug('Found old track directory in plugin folder, migrating to new location...');

    // Migrate pending files
    const oldPendingFiles = ['nfl-track.jsonl', 'nfl-track-pending.jsonl', this.routeSaveName];

    for (const oldFile of oldPendingFiles) {
      const oldPath = path.join(oldPluginTrackDir, oldFile);
      if ((await fs.pathExists(oldPath)) && !(await fs.pathExists(newPendingFile))) {
        await fs.move(oldPath, newPendingFile);
        this.app.debug('Migrated pending track file from old plugin location');
        break;
      }
    }

    // Migrate sent archive
    const oldSentFiles = [this.routeSentName, 'nfl-track-sent.jsonl'];
    for (const oldFile of oldSentFiles) {
      const oldPath = path.join(oldPluginTrackDir, oldFile);
      if ((await fs.pathExists(oldPath)) && !(await fs.pathExists(newSentFile))) {
        await fs.move(oldPath, newSentFile);
        this.app.debug('Migrated sent track archive from old plugin location');
        break;
      }
    }

    // Try to remove old directory if empty
    await this.removeOldDirectoryIfEmpty(oldPluginTrackDir);
  }

  /**
   * Remove old directory if it's empty
   */
  async removeOldDirectoryIfEmpty(dirPath: string): Promise<void> {
    try {
      const remainingFiles = await fs.readdir(dirPath);
      if (remainingFiles.length === 0) {
        await fs.rmdir(dirPath);
        this.app.debug('Removed empty old track directory');
      }
    } catch (err) {
      const error = err as Error;
      this.app.debug('Could not remove old track directory:', error.message);
    }
  }
}

export default TrackMigration;
