class DataPathEmitter {
  constructor(app, pluginId) {
    this.app = app;
    this.pluginId = pluginId;
    this.currentError = null;
  }

  /**
   * Emit SignalK delta for a data path
   */
  emitDelta(path, value) {
    try {
      const delta = {
        context: 'vessels.self',
        updates: [{
          timestamp: new Date().toISOString(),
          values: [{
            path: path,
            value: value
          }]
        }]
      };
      this.app.handleMessage(this.pluginId, delta);
    } catch (err) {
      this.app.debug(`Failed to emit delta for ${path}:`, err.message);
    }
  }

  /**
   * Update status paths with current state
   */
  updateStatusPaths(options, lastPosition, lastSuccessfulTransfer, autoSelectedSource) {
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
      this.emitDelta('noforeignland.status', `ERROR: ${this.currentError}`);
    }
    
    this.emitDelta('noforeignland.status_boolean', hasError ? 1 : 0);
  }

  /**
   * Emit savepoint deltas
   */
  emitSavepoint() {
    const now = new Date();
    this.emitDelta('noforeignland.savepoint', now.toISOString());
    this.emitDelta('noforeignland.savepoint_local', now.toLocaleString());
  }

  /**
   * Emit API transfer deltas
   */
  emitApiTransfer(transferTime) {
    this.emitDelta('noforeignland.sent_to_api', transferTime.toISOString());
    this.emitDelta('noforeignland.sent_to_api_local', transferTime.toLocaleString());
  }

  /**
   * Set error state
   */
  setError(error) {
    this.currentError = error;
  }

  /**
   * Clear error state
   */
  clearError() {
    this.currentError = null;
  }

  /**
   * Get current error
   */
  getError() {
    return this.currentError;
  }
}

module.exports = DataPathEmitter;