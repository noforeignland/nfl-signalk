const fs = require('fs');

class DirectoryUtils {
  /**
   * Create directory with proper error handling
   */
  static createDir(dir, app) {
    if (fs.existsSync(dir)) {
      try {
        fs.accessSync(dir, fs.constants.R_OK | fs.constants.W_OK);
        return true;
      } catch (error) {
        app.debug('[createDir]', error.message);
        throw new Error(`No rights to directory ${dir}`);
      }
    } else {
      try {
        fs.mkdirSync(dir, { recursive: true });
        return true;
      } catch (error) {
        switch (error.code) {
          case 'EACCES':
          case 'EPERM':
            app.debug(`Failed to create ${dir} by Permission denied`);
            throw new Error(`Failed to create ${dir} by Permission denied`);
          case 'ETIMEDOUT':
            app.debug(`Failed to create ${dir} by Operation timed out`);
            throw new Error(`Failed to create ${dir} by Operation timed out`);
          default:
            app.debug(`Error creating directory ${dir}: ${error.message}`);
            throw new Error(`Error creating directory ${dir}: ${error.message}`);
        }
      }
    }
  }
}

module.exports = DirectoryUtils;