const fs = require('fs-extra');
const path = require('path');

class PluginCleanup {
  constructor(app) {
    this.app = app;
  }

  /**
   * Cleanup old plugin versions (signalk-to-noforeignland and signalk-to-nfl)
   */
  async cleanup() {
    try {
      // Detect SignalK directory (standard or Victron Cerbo)
      const victronPath = '/data/conf/signalk';
      const standardPath = process.env.SIGNALK_NODE_CONFIG_DIR || 
                           path.join(process.env.HOME || process.env.USERPROFILE, '.signalk');
      
      const configDir = fs.existsSync(victronPath) ? victronPath : standardPath;
      this.app.debug(`Using SignalK directory: ${configDir}`);
      
      const configPath = path.join(configDir, 'plugin-config-data');
      
      // 1. Config Migration - only from signalk-to-noforeignland
      await this.migrateConfig(configPath);
      
      // 2. Check and remove old plugins
      await this.removeOldPlugins(configDir);
      
    } catch (err) {
      this.app.debug('Error during old plugin cleanup:', err.message);
    }
  }

  /**
   * Migrate config from old plugin to new scoped version
   */
  async migrateConfig(configPath) {
    const oldConfigFile = path.join(configPath, 'signalk-to-noforeignland.json');
    const newConfigFile = path.join(configPath, '@noforeignland-signalk-to-noforeignland.json');
    
    if (fs.existsSync(oldConfigFile) && !fs.existsSync(newConfigFile)) {
      this.app.debug('Migrating configuration from old plugin "signalk-to-noforeignland"...');
      fs.copyFileSync(oldConfigFile, newConfigFile);
      fs.copyFileSync(oldConfigFile, `${oldConfigFile}.backup`);
      this.app.debug('✓ Configuration migrated successfully');
    }
  }

  /**
   * Remove old plugin directories - with immediate and delayed attempts
   */
  async removeOldPlugins(configDir) {
    const oldPlugins = [
      { dir: path.join(configDir, 'node_modules', 'signalk-to-noforeignland'), name: 'signalk-to-noforeignland' },
      { dir: path.join(configDir, 'node_modules', 'signalk-to-nfl'), name: 'signalk-to-nfl' }
    ];
    
    const foundOldPlugins = oldPlugins.filter(plugin => fs.existsSync(plugin.dir));
    
    if (foundOldPlugins.length === 0) {
      return null;
    }

    const pluginNames = foundOldPlugins.map(p => `"${p.name}"`).join(' and ');
    const uninstallCmd = foundOldPlugins.map(p => p.name).join(' ');
    
    this.app.debug(`Old plugin(s) detected: ${pluginNames}`);
    
    // Immediate removal attempt
    let anyRemovedNow = false;
    const stillPresent = [];
    
    for (const plugin of foundOldPlugins) {
      try {
        this.app.debug(`Attempting immediate removal of: ${plugin.name}...`);
        await fs.remove(plugin.dir);
        this.app.debug(`✓ Old plugin "${plugin.name}" removed immediately`);
        anyRemovedNow = true;
      } catch (err) {
        this.app.debug(`Could not remove "${plugin.name}" immediately:`, err.message);
        stillPresent.push(plugin);
      }
    }
    
    if (stillPresent.length === 0) {
      this.app.debug('All old plugins removed successfully');
      return 'all_removed';
    }
    
    // Show warning for plugins that couldn't be removed immediately
    const stillPresentNames = stillPresent.map(p => `"${p.name}"`).join(' and ');
    const stillPresentCmd = stillPresent.map(p => p.name).join(' ');
    
    this.app.setPluginError(
      `Old plugin(s) ${stillPresentNames} still installed. ` +
      `Will retry removal, or uninstall manually: cd ${configDir} && npm uninstall ${stillPresentCmd}`
    );
    
    // Delayed removal attempts (multiple tries with increasing delays)
    return new Promise((resolve) => {
      const delays = [5000, 15000, 30000]; // 5s, 15s, 30s
      let attemptIndex = 0;
      
      const attemptRemoval = async () => {
        if (attemptIndex >= delays.length) {
          // Final attempt failed
          const remaining = stillPresent.filter(p => fs.existsSync(p.dir));
          if (remaining.length > 0) {
            const remainingNames = remaining.map(p => p.name).join(' ');
            this.app.debug(`Could not remove old plugins after multiple attempts: ${remainingNames}`);
            this.app.debug(`Please manually run: cd ${configDir} && npm uninstall ${remainingNames}`);
            resolve('partial_removal');
          } else {
            this.app.debug('All old plugins eventually removed');
            resolve('all_removed');
          }
          return;
        }
        
        const delay = delays[attemptIndex];
        attemptIndex++;
        
        setTimeout(async () => {
          this.app.debug(`Delayed removal attempt ${attemptIndex}/${delays.length}...`);
          
          const remaining = [];
          for (const plugin of stillPresent) {
            if (!fs.existsSync(plugin.dir)) {
              this.app.debug(`Plugin "${plugin.name}" already removed`);
              continue;
            }
            
            try {
              await fs.remove(plugin.dir);
              this.app.debug(`✓ Old plugin "${plugin.name}" removed on attempt ${attemptIndex}`);
            } catch (err) {
              this.app.debug(`Still cannot remove "${plugin.name}":`, err.message);
              remaining.push(plugin);
            }
          }
          
          if (remaining.length === 0) {
            this.app.debug('All old plugins successfully removed');
            // Clear the error
            this.app.setPluginStatus('Started (old plugins cleaned up)');
            resolve('all_removed');
          } else {
            stillPresent.length = 0;
            stillPresent.push(...remaining);
            attemptRemoval(); // Next attempt
          }
        }, delay);
      };
      
      attemptRemoval();
    });
  }
}

module.exports = PluginCleanup;