class HealthMonitor {
  constructor(app, options) {
    this.app = app;
    this.options = options;
    this.checkInterval = null;
  }

  /**
   * Start position health monitoring
   */
  start(getLastPositionReceived, getAutoSelectedSource, onError, onHealthy) {
    // Periodic health check every 5 minutes
    this.checkInterval = setInterval(() => {
      this.performHealthCheck(
        getLastPositionReceived(),
        getAutoSelectedSource(),
        onError,
        onHealthy
      );
    }, 5 * 60 * 1000);
    
    // Initial check after 2 minutes of startup
    setTimeout(() => {
      this.performInitialCheck(
        getLastPositionReceived(),
        getAutoSelectedSource(),
        onError
      );
    }, 2 * 60 * 1000);
  }

  /**
   * Perform periodic health check
   */
  performHealthCheck(lastPositionReceived, autoSelectedSource, onError, onHealthy) {
    const now = new Date().getTime();
    const timeSinceLastPosition = lastPositionReceived 
      ? (now - lastPositionReceived) / 1000 
      : null;
    
    const activeSource = this.options.filterSource || autoSelectedSource || 'any';
    const filterMsg = activeSource !== 'any' ? ` from source '${activeSource}'` : '';
    
    if (!lastPositionReceived) {
      const errorMsg = this.options.filterSource
        ? `No GPS position data received from filtered source '${this.options.filterSource}'. Check Expert Settings > Position source device, or leave empty to use any GPS source.`
        : 'No GPS position data received. Check that your GPS is connected and SignalK is receiving navigation.position data.';
      
      onError(errorMsg);
      this.app.debug('Position health check: No position data ever received' + filterMsg);
    } else if (timeSinceLastPosition > 300) {
      const errorMsg = this.options.filterSource
        ? `No GPS position data${filterMsg} for ${Math.floor(timeSinceLastPosition / 60)} minutes. Check that source '${this.options.filterSource}' is active, or change/clear Position source device in Expert Settings.`
        : `No GPS position data${filterMsg} for ${Math.floor(timeSinceLastPosition / 60)} minutes. Check your GPS connection.`;
      
      onError(errorMsg);
      this.app.debug(`Position health check: No position for ${timeSinceLastPosition.toFixed(0)} seconds` + filterMsg);
    } else {
      this.app.debug(`Position health check: OK (last position ${timeSinceLastPosition.toFixed(0)} seconds ago${filterMsg})`);
      onHealthy();
    }
  }

  /**
   * Perform initial health check after startup
   */
  performInitialCheck(lastPositionReceived, autoSelectedSource, onError) {
    if (!lastPositionReceived) {
      const activeSource = this.options.filterSource || autoSelectedSource || 'any';
      const errorMsg = this.options.filterSource
        ? `No GPS position data received after 2 minutes from filtered source '${this.options.filterSource}'. Check Expert Settings > Position source device. You may need to leave it empty to use any available GPS source.`
        : 'No GPS position data received after 2 minutes. Check that your GPS is connected and SignalK is receiving navigation.position data.';
      
      onError(errorMsg);
      this.app.debug('Initial position check: No position data received' + 
        (activeSource !== 'any' ? ` from source '${activeSource}'` : ''));
    }
  }

  /**
   * Stop health monitoring
   */
  stop() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }
}

module.exports = HealthMonitor;