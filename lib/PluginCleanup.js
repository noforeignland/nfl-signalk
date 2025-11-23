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

      // 2. Verify what plugins are actually present
      this.logInstalledPlugins(configDir);

      // 3. Check and remove old plugins
      return await this.removeOldPlugins(configDir);

    } catch (err) {
      this.app.debug('Error during old plugin cleanup:', err.message);
      return null;
    }
  }

  /**
   * Log which SignalK NFL plugins are currently installed (for debugging)
   */
  logInstalledPlugins(configDir) {
    const nodeModulesDir = path.join(configDir, 'node_modules');
    const pluginsToCheck = [
      '@noforeignland/signalk-to-noforeignland',
      'signalk-to-noforeignland',
      'signalk-to-nfl'
    ];

    const found = [];
    for (const pluginName of pluginsToCheck) {
      const pluginPath = path.join(nodeModulesDir, pluginName);
      if (fs.existsSync(pluginPath)) {
        const packageJsonPath = path.join(pluginPath, 'package.json');
        let version = 'unknown';
        try {
          if (fs.existsSync(packageJsonPath)) {
            const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
            version = packageJson.version;
          }
        } catch (e) {
          // Ignore version read errors
        }
        found.push(`${pluginName}@${version}`);
      }
    }

    if (found.length > 0) {
      this.app.debug(`Installed NFL plugins: ${found.join(', ')}`);
    }
  }

  /**
   * Migrate config from old plugin ID to new plugin ID
   *
   * Handles config migration from:
   * 1. Old unscoped plugin "signalk-to-noforeignland" (v0.1.x)
   * 2. Beta versions with wrong plugin ID (v1.1.0-beta.1/2/3)
   *
   * Both used config filename: "signalk-to-noforeignland.json"
   * New version uses: "@noforeignland-signalk-to-noforeignland.json"
   *
   * Since both sources use the same filename, we simply copy if it exists.
   */
  async migrateConfig(configPath) {
    const oldConfigFile = path.join(configPath, 'signalk-to-noforeignland.json');
    const newConfigFile = path.join(configPath, '@noforeignland-signalk-to-noforeignland.json');

    // Only migrate if old config exists and new config doesn't
    if (fs.existsSync(oldConfigFile) && !fs.existsSync(newConfigFile)) {
      this.app.debug('Migrating configuration from old plugin to new scoped plugin...');
      this.app.debug(`  Source: ${oldConfigFile}`);
      this.app.debug(`  Target: ${newConfigFile}`);

      try {
        // Copy to new location
        fs.copyFileSync(oldConfigFile, newConfigFile);

        // Create backup of old config
        const backupFile = `${oldConfigFile}.backup-${Date.now()}`;
        fs.copyFileSync(oldConfigFile, backupFile);

        this.app.debug('✓ Configuration successfully migrated');
        this.app.debug(`  Backup saved: ${backupFile}`);
      } catch (err) {
        this.app.debug(`⨯ Config migration failed: ${err.message}`);
        this.app.debug('  You may need to reconfigure the plugin manually');
      }
    } else if (fs.existsSync(newConfigFile)) {
      this.app.debug('Configuration already in new location');

      // Check if config has incorrect "configuration" wrapper and fix it
      try {
        const configData = JSON.parse(fs.readFileSync(newConfigFile, 'utf8'));
        if (configData.configuration && typeof configData.configuration === 'object') {
          this.app.debug('Detected nested "configuration" wrapper, unwrapping...');

          // Unwrap: move properties from configuration object to root
          const unwrapped = {
            ...configData.configuration,
            enabled: configData.enabled,
            enableLogging: configData.enableLogging,
            enableDebug: configData.enableDebug
          };

          // Backup before fixing
          const fixBackupFile = `${newConfigFile}.backup-unwrap-${Date.now()}`;
          fs.copyFileSync(newConfigFile, fixBackupFile);

          // Write fixed config
          fs.writeFileSync(newConfigFile, JSON.stringify(unwrapped, null, 2));
          this.app.debug('✓ Configuration unwrapped successfully');
          this.app.debug(`  Backup: ${fixBackupFile}`);
        }
      } catch (err) {
        this.app.debug(`⨯ Could not check/fix config structure: ${err.message}`);
      }
    } else {
      this.app.debug('No old configuration found, first-time setup');
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

    // Don't show error immediately - log that we're retrying
    const stillPresentNames = stillPresent.map(p => `"${p.name}"`).join(' and ');
    this.app.debug(`Old plugin(s) ${stillPresentNames} still present, will retry removal...`);

    // Delayed removal attempts (multiple tries with increasing delays)
    return new Promise((resolve) => {
      const delays = [5000, 15000, 30000]; // 5s, 15s, 30s
      let attemptIndex = 0;
      
      const attemptRemoval = async () => {
        if (attemptIndex >= delays.length) {
          // Final attempt failed - NOW show error only if plugins still exist
          const remaining = stillPresent.filter(p => fs.existsSync(p.dir));
          if (remaining.length > 0) {
            const remainingNames = remaining.map(p => `"${p.name}"`).join(' and ');
            const remainingCmd = remaining.map(p => p.name).join(' ');

            this.app.debug(`Could not remove old plugins after ${delays.length} attempts: ${remainingNames}`);

            // Show error with platform-specific commands
            const isVictronCerbo = configDir === '/data/conf/signalk';
            const cmdPrefix = isVictronCerbo ? 'On Victron Cerbo GX, ' : '';

            this.app.setPluginError(
              `${cmdPrefix}Old plugin(s) ${remainingNames} detected. ` +
              `Manual removal required: cd ${configDir} && npm uninstall ${remainingCmd}`
            );
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