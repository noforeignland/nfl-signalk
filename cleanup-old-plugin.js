#!/usr/bin/env node

/**
 * Cleanup script for old plugin versions
 * This runs as a standalone script during npm postinstall
 * NOT a class - just a simple executable script
 */

const fs = require('fs');
const path = require('path');

// Detect SignalK directory (standard ~/.signalk or Victron Cerbo /data/conf/signalk)
function getSignalKDir() {
  const victronPath = '/data/conf/signalk';
  const homePath = path.join(process.env.HOME || '', '.signalk');
  
  // Check Victron path first
  if (fs.existsSync(victronPath)) {
    return victronPath;
  }
  
  return homePath;
}

const signalkDir = getSignalKDir();
console.log(`Using SignalK directory: ${signalkDir}`);

// 1. Migration (only for signalk-to-noforeignland config)
try {
  const configPath = path.join(signalkDir, 'plugin-config-data');
  const oldConfig = path.join(configPath, 'signalk-to-noforeignland.json');
  const newConfig = path.join(configPath, '@noforeignland-signalk-to-noforeignland.json');
  
  if (fs.existsSync(oldConfig) && !fs.existsSync(newConfig)) {
    fs.copyFileSync(oldConfig, newConfig);
    fs.copyFileSync(oldConfig, `${oldConfig}.backup`);
    console.log('✓ Configuration migrated');
  }
} catch (e) {
  console.warn('Could not migrate config:', e.message);
}

// 2. Uninstall old plugins (with delay so npm can finish)
setTimeout(() => {
  try {
    const oldPlugins = [
      { dir: path.join(signalkDir, 'node_modules', 'signalk-to-noforeignland'), name: 'signalk-to-noforeignland' },
      { dir: path.join(signalkDir, 'node_modules', 'signalk-to-nfl'), name: 'signalk-to-nfl' }
    ];
    
    let removedAny = false;
    const failedPlugins = [];
    
    for (const plugin of oldPlugins) {
      if (fs.existsSync(plugin.dir)) {
        try {
          console.log(`Removing old plugin "${plugin.name}"...`);
          // Direct deletion is safer than npm uninstall during installation
          fs.rmSync(plugin.dir, { recursive: true, force: true });
          console.log(`✓ Old plugin "${plugin.name}" removed`);
          removedAny = true;
        } catch (e) {
          console.warn(`Could not remove "${plugin.name}":`, e.message);
          failedPlugins.push(plugin.name);
        }
      }
    }
    
    if (failedPlugins.length > 0) {
      const uninstallCmd = failedPlugins.join(' ');
      console.warn(`Please run manually: npm uninstall ${uninstallCmd}`);
    }
    
    if (!removedAny && failedPlugins.length === 0) {
      console.log('No old plugins found - already clean!');
    }
  } catch (e) {
    console.warn('Error during cleanup:', e.message);
  }
}, 2000); // Wait 2 seconds for npm to finish