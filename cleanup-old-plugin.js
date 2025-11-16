const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// 1. Migration (only for signalk-to-noforeignland config)
try {
  const configDir = path.join(process.env.HOME || '', '.signalk');
  const configPath = path.join(configDir, 'plugin-config-data');
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
    const signalkDir = path.join(process.env.HOME || '', '.signalk');
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
  } catch (e) {
    console.warn('Error during cleanup:', e.message);
  }
}, 2000); // Wait 2 seconds for npm to finish
