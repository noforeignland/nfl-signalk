async cleanupOldPlugin() {
    try {
      // Detect SignalK directory (standard or Victron Cerbo)
      const victronPath = '/data/conf/signalk';
      const standardPath = process.env.SIGNALK_NODE_CONFIG_DIR || 
                           path.join(process.env.HOME || process.env.USERPROFILE, '.signalk');
      
      const configDir = fs.existsSync(victronPath) ? victronPath : standardPath;
      this.app.debug(`Using SignalK directory: ${configDir}`);
      
      const configPath = path.join(configDir, 'plugin-config-data');
      
      // 1. Config Migration - only from signalk-to-noforeignland
      const oldConfigFile = path.join(configPath, 'signalk-to-noforeignland.json');
      const newConfigFile = path.join(configPath, '@noforeignland-signalk-to-noforeignland.json');
      
      if (fs.existsSync(oldConfigFile) && !fs.existsSync(newConfigFile)) {
        this.app.debug('Migrating configuration from old plugin "signalk-to-noforeignland"...');
        fs.copyFileSync(oldConfigFile, newConfigFile);
        fs.copyFileSync(oldConfigFile, `${oldConfigFile}.backup`);
        this.app.debug('✓ Configuration migrated successfully');
      }
      
      // 2. Check if old plugins still exist (including very old signalk-to-nfl)
      const oldPlugins = [
        { dir: path.join(configDir, 'node_modules', 'signalk-to-noforeignland'), name: 'signalk-to-noforeignland' },
        { dir: path.join(configDir, 'node_modules', 'signalk-to-nfl'), name: 'signalk-to-nfl' }
      ];
      
      const foundOldPlugins = oldPlugins.filter(plugin => fs.existsSync(plugin.dir));
      
      if (foundOldPlugins.length > 0) {
        const pluginNames = foundOldPlugins.map(p => `"${p.name}"`).join(' and ');
        const uninstallCmd = foundOldPlugins.map(p => p.name).join(' ');
        
        this.app.debug(`Old plugin(s) detected: ${pluginNames}`);
        this.app.setPluginError(
          `Old plugin(s) ${pluginNames} still installed. ` +
          `Please uninstall manually: cd ${configDir} && npm uninstall ${uninstallCmd}`
        );
        
        // Try to remove them after a delay (non-blocking)
        setTimeout(async () => {
          let anyRemoved = false;
          let anyFailed = false;
          
          for (const plugin of foundOldPlugins) {
            try {
              this.app.debug(`Attempting to remove old plugin directory: ${plugin.name}...`);
              await fs.remove(plugin.dir);
              this.app.debug(`✓ Old plugin "${plugin.name}" directory removed`);
              anyRemoved = true;
            } catch (err) {
              this.app.debug(`Could not automatically remove old plugin "${plugin.name}":`, err.message);
              anyFailed = true;
            }
          }
          
          if (anyRemoved && !anyFailed) {
            this.setPluginStatus('Started (old plugins cleaned up)');
          } else if (anyFailed) {
            const remainingPlugins = foundOldPlugins.map(p => p.name).join(' ');
            this.app.debug(`Please manually run: cd ${configDir} && npm uninstall ${remainingPlugins}`);
          }
        }, 5000); // 5 seconds wait for SignalK to fully start
      }
      
    } catch (err) {
      this.app.debug('Error during old plugin cleanup:', err.message);
    }
  }