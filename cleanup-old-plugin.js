const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// 1. Migration
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

// 2. Uninstall (mit Verzögerung, damit npm fertig ist)
setTimeout(() => {
  try {
    const signalkDir = path.join(process.env.HOME || '', '.signalk');
    const oldPluginDir = path.join(signalkDir, 'node_modules', 'signalk-to-noforeignland');
    
    if (fs.existsSync(oldPluginDir)) {
      console.log('Removing old plugin...');
      // Direktes Löschen ist sicherer als npm uninstall während Installation
      fs.rmSync(oldPluginDir, { recursive: true, force: true });
      console.log('✓ Old plugin removed');
    }
  } catch (e) {
    console.warn('Could not remove old plugin automatically. Please run: npm uninstall signalk-to-noforeignland');
  }
}, 2000); // 2 Sekunden warten bis npm fertig ist
