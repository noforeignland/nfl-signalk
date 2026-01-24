/**
 * Emits Signal K delta messages for plugin data paths
 */

import type { SignalKApp, FlatConfig, SavedPosition, Delta } from '../types';

export class DataPathEmitter {
  private app: SignalKApp;
  private pluginId: string;
  private currentError: string | null = null;

  constructor(app: SignalKApp, pluginId: string) {
    this.app = app;
    this.pluginId = pluginId;
  }

  /**
   * Emit SignalK delta for a data path
   */
  emitDelta(path: string, value: unknown): void {
    try {
      const delta: Partial<Delta> = {
        context: 'vessels.self',
        updates: [
          {
            timestamp: new Date().toISOString(),
            values: [
              {
                path: path,
                value: value,
              },
            ],
          },
        ],
      };
      this.app.handleMessage(this.pluginId, delta);
    } catch (err) {
      const error = err as Error;
      this.app.debug(`Failed to emit delta for ${path}:`, error.message);
    }
  }

  /**
   * Update status paths with current state
   */
  updateStatusPaths(
    options: FlatConfig,
    lastPosition: SavedPosition | null,
    lastSuccessfulTransfer: Date | null,
    autoSelectedSource: string | null
  ): void {
    const hasError = this.currentError !== null;

    if (!hasError) {
      const activeSource = options.filterSource || autoSelectedSource || '';
      const saveTime = lastPosition
        ? new Date(lastPosition.currentTime).toLocaleTimeString()
        : 'None since start';
      const transferTime = lastSuccessfulTransfer
        ? lastSuccessfulTransfer.toLocaleTimeString()
        : 'None since start';
      const shortStatus = `Save: ${saveTime} | Transfer: ${transferTime}`;

      this.emitDelta('noforeignland.status', shortStatus);
      this.emitDelta('noforeignland.source', activeSource);
    } else {
      this.emitDelta('noforeignland.status', `ERROR: ${this.currentError ?? 'Unknown error'}`);
    }

    this.emitDelta('noforeignland.status_boolean', hasError ? 1 : 0);
  }

  /**
   * Emit savepoint deltas
   */
  emitSavepoint(): void {
    const now = new Date();
    this.emitDelta('noforeignland.savepoint', now.toISOString());
    this.emitDelta('noforeignland.savepoint_local', now.toLocaleString());
  }

  /**
   * Emit API transfer deltas
   */
  emitApiTransfer(transferTime: Date): void {
    this.emitDelta('noforeignland.sent_to_api', transferTime.toISOString());
    this.emitDelta('noforeignland.sent_to_api_local', transferTime.toLocaleString());
  }

  /**
   * Set error state
   */
  setError(error: string): void {
    this.currentError = error;
  }

  /**
   * Clear error state
   */
  clearError(): void {
    this.currentError = null;
  }

  /**
   * Get current error
   */
  getError(): string | null {
    return this.currentError;
  }
}

export default DataPathEmitter;
