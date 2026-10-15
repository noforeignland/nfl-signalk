/**
 * Mock Signal K app for testing
 */

import { vi, type Mock } from 'vitest';
import type { SignalKApp, TrackApi } from '../../src/types';

export interface MockAppOptions {
  dataDir?: string;
  // When set, exposes app.config.version (the Signal K server release). Leave
  // undefined to model older servers / @signalk/server-api where it's absent.
  serverVersion?: string;
  /** What getSelfPath returns for every path. */
  selfPath?: unknown;
  /** Exposes getTrackApi, resolving to this provider; omit to model a server before 2.33. */
  trackApi?: TrackApi;
}

export interface MockSignalKApp extends SignalKApp {
  // Expose mocks for assertions
  _mocks: {
    debug: Mock;
    error: Mock;
    setPluginStatus: Mock;
    setPluginError: Mock;
    getDataDirPath: Mock;
    savePluginOptions: Mock;
    handleMessage: Mock;
    getSelfPath: Mock;
  };
}

export function createMockApp(options: MockAppOptions = {}): MockSignalKApp {
  const dataDir = options.dataDir ?? '/tmp/test-signalk-data';

  const mocks = {
    debug: vi.fn(),
    error: vi.fn(),
    setPluginStatus: vi.fn(),
    setPluginError: vi.fn(),
    getDataDirPath: vi.fn(() => dataDir),
    savePluginOptions: vi.fn((_options: unknown, callback?: (err?: Error) => void) => {
      if (callback) callback();
    }),
    handleMessage: vi.fn(),
    getSelfPath: vi.fn((): unknown => options.selfPath),
  };

  const trackApi = options.trackApi;
  return {
    debug: mocks.debug,
    error: mocks.error,
    setPluginStatus: mocks.setPluginStatus,
    setPluginError: mocks.setPluginError,
    getDataDirPath: mocks.getDataDirPath,
    savePluginOptions: mocks.savePluginOptions,
    handleMessage: mocks.handleMessage,
    getSelfPath: mocks.getSelfPath,
    ...(trackApi ? { getTrackApi: (): Promise<TrackApi> => Promise.resolve(trackApi) } : {}),
    ...(options.serverVersion !== undefined ? { config: { version: options.serverVersion } } : {}),
    _mocks: mocks,
  };
}
