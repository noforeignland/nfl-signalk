/**
 * Signal K plugin that uploads the own vessel's track, as recorded by the
 * Tracks plugin, to noforeignland.com
 */

import { CronJob } from 'cron';
import type { SignalKApp, Plugin, PluginConfig, ConfigSchema } from './types';
import { ConfigManager } from './lib/ConfigManager';
import { TrackSender } from './lib/TrackSender';
import { TrackSource, TrackApiUnsupportedError, TracksNotRunningError } from './lib/TrackSource';
import { TrackUploader, type PassResult, type UploaderDeps } from './lib/TrackUploader';
import { UploadStateStore } from './lib/UploadState';
import { PendingFile, legacyPendingFile } from './lib/PendingDrain';
import { readSelfPosition } from './lib/SelfPosition';
import { HealthMonitor } from './lib/HealthMonitor';
import { DataPathEmitter } from './lib/DataPathEmitter';
import { createDir } from './lib/DirectoryUtils';

/** The Tracks plugin may register after this one starts; give it time before the first pass. */
const FIRST_PASS_DELAY_MS = 2 * 60 * 1000;

class SignalkToNoforeignland {
  private app: SignalKApp;
  private pluginId = 'signalk-to-noforeignland';
  private pluginName = 'Signal K to Noforeignland';

  private configManager: ConfigManager;
  private dataPathEmitter: DataPathEmitter;
  private uploader: TrackUploader | null = null;
  private healthMonitor: HealthMonitor | null = null;
  private cron: CronJob | null = null;
  private firstPass: ReturnType<typeof setTimeout> | null = null;
  private passRunning = false;

  private lastSavepoint: Date | null = null;
  private lastSuccessfulTransfer: Date | null = null;
  // An upload error outranks a GNSS warning, so a healthy GNSS check cannot
  // clear a message about the Tracks plugin or the NFL API.
  private uploadError: string | null = null;
  private gnssError: string | null = null;

  constructor(app: SignalKApp) {
    this.app = app;
    this.configManager = new ConfigManager(app);
    this.dataPathEmitter = new DataPathEmitter(app, this.pluginId);
  }

  getSchema(): ConfigSchema {
    return ConfigManager.getSchema(this.pluginName);
  }

  getPluginObject(): Plugin {
    return {
      id: this.pluginId,
      name: this.pluginName,
      description: 'Uploads the track recorded by the Tracks plugin to noforeignland.com',
      schema: this.getSchema(),
      start: this.start.bind(this),
      stop: this.stop.bind(this),
    };
  }

  async start(config: PluginConfig = {}): Promise<void> {
    // The server restarts a plugin by calling stop() and start() on the same
    // instance; a message from the previous configuration must not outlive it.
    this.uploadError = null;
    this.gnssError = null;
    try {
      const { options: migrated, migrated: wasMigrated } =
        await this.configManager.migrateOldConfig(config);
      const options = this.configManager.randomizeCron(this.configManager.flattenConfig(migrated));

      try {
        this.configManager.validateApiKey(options);
      } catch (err) {
        this.fail(err instanceof Error ? err.message : String(err));
        return;
      }
      if (!this.app.getTrackApi) {
        this.fail(new TrackApiUnsupportedError().message);
        return;
      }

      const dataDir = this.app.getDataDirPath();
      createDir(dataDir, this.app);
      const store = new UploadStateStore(dataDir);
      // The configuration as 1.x saved it still names its track directory.
      const pending = new PendingFile(legacyPendingFile(config, dataDir));
      const source = new TrackSource(this.app);
      const sender = new TrackSender(this.app, options);

      const deps: UploaderDeps = {
        fixesAfter: (afterMs) => source.fixesAfter(afterMs),
        sendFixes: (fixes) => sender.sendFixes(fixes),
        loadState: () => store.load(),
        saveState: (state) => store.save(state),
        readPending: () => pending.read(),
        replacePending: (remaining) => pending.replace(remaining),
        currentFix: () => readSelfPosition(this.app)?.fix ?? null,
        debug: (...args) => {
          this.app.debug(...args);
        },
      };
      this.uploader = new TrackUploader(options, deps);

      this.app.debug('Upload schedule:', options.apiCron);
      this.cron = new CronJob(options.apiCron, () => {
        void this.runPass();
      });
      this.cron.start();
      this.firstPass = setTimeout(() => {
        void this.runPass();
      }, FIRST_PASS_DELAY_MS);

      this.healthMonitor = new HealthMonitor(this.app, options);
      this.healthMonitor.start(
        () => readSelfPosition(this.app)?.fix.time ?? null,
        () => readSelfPosition(this.app)?.source ?? null,
        (message) => {
          this.gnssError = message;
          this.refreshStatus();
        },
        () => {
          this.gnssError = null;
          this.refreshStatus();
        }
      );

      this.app.setPluginStatus(`Started${wasMigrated ? ' (config migrated)' : ''}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.app.debug('Error during plugin start:', message);
      this.fail(`Failed to start: ${message}`);
    }
  }

  async runPass(): Promise<void> {
    const uploader = this.uploader;
    if (!uploader || this.passRunning) {
      return;
    }
    this.passRunning = true;
    let outcome: { result: PassResult } | { error: unknown };
    try {
      outcome = { result: await uploader.run() };
    } catch (error) {
      outcome = { error };
    } finally {
      this.passRunning = false;
    }

    // Stopped or restarted while the pass ran: what NFL accepted is already
    // in the upload state, but the status belongs to whatever runs now.
    if (uploader !== this.uploader) {
      return;
    }

    if ('result' in outcome) {
      const { result } = outcome;
      if (result.newestRecorded) {
        this.lastSavepoint = new Date(result.newestRecorded.time);
        this.dataPathEmitter.emitSavepoint(this.lastSavepoint);
      }
      if (result.uploaded > 0) {
        this.lastSuccessfulTransfer = new Date();
        this.dataPathEmitter.emitApiTransfer(this.lastSuccessfulTransfer);
      }
      this.uploadError = null;
    } else {
      const { error } = outcome;
      const message = error instanceof Error ? error.message : String(error);
      this.app.debug('Upload pass failed:', message);
      this.uploadError =
        error instanceof TracksNotRunningError || error instanceof TrackApiUnsupportedError
          ? message
          : `Failed to send track - ${message}`;
    }
    this.refreshStatus();
  }

  stop(): void {
    this.app.debug('plugin stopped');
    this.teardown();
    this.app.setPluginStatus('Plugin stopped');
  }

  private teardown(): void {
    if (this.cron) {
      void this.cron.stop();
      this.cron = null;
    }
    if (this.firstPass) {
      clearTimeout(this.firstPass);
      this.firstPass = null;
    }
    this.healthMonitor?.stop();
    this.healthMonitor = null;
    this.uploader = null;
  }

  private fail(message: string): void {
    this.teardown();
    this.uploadError = message;
    this.refreshStatus();
  }

  private refreshStatus(): void {
    const source = readSelfPosition(this.app)?.source ?? null;
    const error = this.uploadError ?? this.gnssError;
    if (error) {
      this.dataPathEmitter.setError(error);
      this.app.setPluginError(error);
    } else {
      this.dataPathEmitter.clearError();
      const save = this.lastSavepoint?.toISOString() ?? 'None since start';
      const transfer = this.lastSuccessfulTransfer?.toISOString() ?? 'None since start';
      this.app.setPluginStatus(
        `Save: ${save} | Transfer: ${transfer}${source ? ` | ${source}` : ''}`
      );
    }
    this.dataPathEmitter.updateStatusPaths(this.lastSavepoint, this.lastSuccessfulTransfer, source);
  }
}

/**
 * Plugin factory function
 */
export default function (app: SignalKApp): Plugin {
  const instance = new SignalkToNoforeignland(app);
  return instance.getPluginObject();
}
