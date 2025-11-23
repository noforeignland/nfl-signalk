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
  const standardPath = process.env.SIGNALK_NODE_CONFIG_DIR ||
                       path.join(process.env.HOME || process.env.USERPROFILE || '', '.signalk');

  // Check Victron path first
  if (fs.existsSync(victronPath)) {
    console.log('Detected Victron Cerbo GX environment');
    return victronPath;
  }

  return standardPath;
}

const signalkDir = getSignalKDir();
console.log(`[@noforeignland/signalk-to-noforeignland] Using SignalK directory: ${signalkDir}`);

// 1. Config Migration - migrate from old plugin to new scoped plugin
try {
  const configPath = path.join(signalkDir, 'plugin-config-data');
  const oldConfig = path.join(configPath, 'signalk-to-noforeignland.json');
  const newConfig = path.join(configPath, '@noforeignland-signalk-to-noforeignland.json');

  console.log(`[@noforeignland/signalk-to-noforeignland] Checking for config migration...`);
  console.log(`  Old config: ${oldConfig}`);
  console.log(`  Old config exists: ${fs.existsSync(oldConfig)}`);
  console.log(`  New config: ${newConfig}`);
  console.log(`  New config exists: ${fs.existsSync(newConfig)}`);

  if (fs.existsSync(oldConfig) && !fs.existsSync(newConfig)) {
    console.log(`[@noforeignland/signalk-to-noforeignland] Migrating configuration...`);
    fs.copyFileSync(oldConfig, newConfig);
    const backupFile = `${oldConfig}.backup-${Date.now()}`;
    fs.copyFileSync(oldConfig, backupFile);
    console.log(`[@noforeignland/signalk-to-noforeignland] ✓ Configuration migrated successfully`);
    console.log(`  Backup: ${backupFile}`);
  } else if (fs.existsSync(newConfig)) {
    console.log(`[@noforeignland/signalk-to-noforeignland] Configuration already exists at new location`);

    // Check if config has incorrect "configuration" wrapper and fix it
    try {
      const configData = JSON.parse(fs.readFileSync(newConfig, 'utf8'));
      if (configData.configuration && typeof configData.configuration === 'object') {
        console.log(`[@noforeignland/signalk-to-noforeignland] Detected nested "configuration" wrapper, unwrapping...`);

        // Unwrap: move properties from configuration object to root
        const unwrapped = {
          ...configData.configuration,
          enabled: configData.enabled,
          enableLogging: configData.enableLogging,
          enableDebug: configData.enableDebug
        };

        // Backup before fixing
        const fixBackupFile = `${newConfig}.backup-unwrap-${Date.now()}`;
        fs.copyFileSync(newConfig, fixBackupFile);

        // Write fixed config
        fs.writeFileSync(newConfig, JSON.stringify(unwrapped, null, 2));
        console.log(`[@noforeignland/signalk-to-noforeignland] ✓ Configuration unwrapped successfully`);
        console.log(`  Backup: ${fixBackupFile}`);
      }
    } catch (e) {
      console.warn(`[@noforeignland/signalk-to-noforeignland] Could not check/fix config structure:`, e.message);
    }
  } else if (!fs.existsSync(oldConfig)) {
    console.log(`[@noforeignland/signalk-to-noforeignland] No old configuration found (first-time install or config not yet created)`);
  }
} catch (e) {
  console.warn(`[@noforeignland/signalk-to-noforeignland] Could not migrate config:`, e.message);
}

// 2. Old Plugin Cleanup (with delay so npm can finish)
setTimeout(() => {
  try {
    console.log(`[@noforeignland/signalk-to-noforeignland] Checking for old plugins to remove...`);

    const oldPlugins = [
      { dir: path.join(signalkDir, 'node_modules', 'signalk-to-noforeignland'), name: 'signalk-to-noforeignland' },
      { dir: path.join(signalkDir, 'node_modules', 'signalk-to-nfl'), name: 'signalk-to-nfl' }
    ];

    let removedAny = false;
    const failedPlugins = [];

    for (const plugin of oldPlugins) {
      if (fs.existsSync(plugin.dir)) {
        try {
          console.log(`[@noforeignland/signalk-to-noforeignland] Removing old plugin "${plugin.name}"...`);
          // Direct deletion is safer than npm uninstall during installation
          fs.rmSync(plugin.dir, { recursive: true, force: true });
          console.log(`[@noforeignland/signalk-to-noforeignland] ✓ Old plugin "${plugin.name}" removed`);
          removedAny = true;
        } catch (e) {
          console.warn(`[@noforeignland/signalk-to-noforeignland] Could not remove "${plugin.name}":`, e.message);
          failedPlugins.push(plugin.name);
        }
      }
    }

    if (failedPlugins.length > 0) {
      const uninstallCmd = failedPlugins.join(' ');
      console.warn(`[@noforeignland/signalk-to-noforeignland] Please run manually: cd ${signalkDir} && npm uninstall ${uninstallCmd}`);
    }

    if (!removedAny && failedPlugins.length === 0) {
      console.log(`[@noforeignland/signalk-to-noforeignland] No old plugins found - already clean!`);
    }

    // Explicit exit after cleanup completes
    process.exit(0);
  } catch (e) {
    console.warn(`[@noforeignland/signalk-to-noforeignland] Error during cleanup:`, e.message);
    process.exit(1);
  }
}, 2000); // Wait 2 seconds for npm to finish