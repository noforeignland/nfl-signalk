/**
 * Directory utility functions
 */

import fs from 'fs';

/**
 * Minimal app interface for directory utils (only needs debug)
 */
interface DebugLogger {
  debug: (...args: unknown[]) => void;
}

/**
 * Create directory with proper error handling
 * @param dir Directory path to create
 * @param app App instance for logging
 * @returns true if directory exists and is writable
 * @throws Error if directory cannot be created or accessed
 */
export function createDir(dir: string, app: DebugLogger): boolean {
  if (fs.existsSync(dir)) {
    try {
      fs.accessSync(dir, fs.constants.R_OK | fs.constants.W_OK);
      return true;
    } catch (error: unknown) {
      const err = error as NodeJS.ErrnoException;
      app.debug('[createDir]', err.message);
      throw new Error(`No rights to directory ${dir}`);
    }
  } else {
    try {
      fs.mkdirSync(dir, { recursive: true });
      return true;
    } catch (error: unknown) {
      const err = error as NodeJS.ErrnoException;
      switch (err.code) {
        case 'EACCES':
        case 'EPERM':
          app.debug(`Failed to create ${dir} by Permission denied`);
          throw new Error(`Failed to create ${dir} by Permission denied`);
        case 'ETIMEDOUT':
          app.debug(`Failed to create ${dir} by Operation timed out`);
          throw new Error(`Failed to create ${dir} by Operation timed out`);
        default:
          app.debug(`Error creating directory ${dir}: ${err.message}`);
          throw new Error(`Error creating directory ${dir}: ${err.message}`);
      }
    }
  }
}
