const fs = require('fs');
const path = require('path');

function migrateConfig() {
  try {
    const configDir = process.env.SIGNALK_NODE_CONFIG_DIR || 
                      path.join(process.env.HOME || process.env.USERPROFILE, '.signalk');
    
    const oldPluginId = 'signalk-to-noforeignland';
    // SignalK speichert scoped packages ohne den Scope oder mit - statt /
    const newPluginId = '@noforeignland-signalk-to-noforeignland'; // @ bleibt, / wird zu -
    
    const configPath = path.join(configDir, 'plugin-config-data');
    
    // Sicherstellen dass configPath existiert
    if (!fs.existsSync(configPath)) {
      console.log(`Config directory does not exist: ${configPath}`);
      return;
    }
    
    const oldConfigFile = path.join(configPath, `${oldPluginId}.json`);
    const newConfigFile = path.join(configPath, `${newPluginId}.json`);
    
    console.log(`Looking for old config at: ${oldConfigFile}`);
    console.log(`Will create new config at: ${newConfigFile}`);
    console.log(`Old config exists: ${fs.existsSync(oldConfigFile)}`);
    console.log(`New config exists: ${fs.existsSync(newConfigFile)}`);
    
    // Prüfen ob alte Config existiert und neue noch nicht
    if (fs.existsSync(oldConfigFile) && !fs.existsSync(newConfigFile)) {
      console.log('Migrating configuration from old plugin...');
      
      // Config kopieren
      const oldConfig = fs.readFileSync(oldConfigFile, 'utf8');
      fs.writeFileSync(newConfigFile, oldConfig);
      
      console.log('Configuration migrated successfully!');
      console.log('Old configuration file can be safely deleted after verification.');
      
      // Backup erstellen
      const backupFile = `${oldConfigFile}.backup`;
      fs.copyFileSync(oldConfigFile, backupFile);
      console.log(`Backup created at: ${backupFile}`);
    } else if (fs.existsSync(newConfigFile)) {
      console.log('New configuration already exists, no migration needed.');
    } else if (!fs.existsSync(oldConfigFile)) {
      console.log('No old configuration found to migrate.');
    }
    
  } catch (error) {
    console.warn('Could not migrate configuration:', error.message);
    console.warn('You may need to reconfigure the plugin manually.');
  }
}

migrateConfig();