/**
 * Mock Signal K app for testing
 */

import type { SignalKApp, Delta, SubscribeCommand, Unsubscribe } from '../../src/types';

export interface MockAppOptions {
  dataDir?: string;
}

export interface MockSignalKApp extends SignalKApp {
  // Expose mocks for assertions
  _mocks: {
    debug: jest.Mock;
    error: jest.Mock;
    setPluginStatus: jest.Mock;
    setPluginError: jest.Mock;
    getDataDirPath: jest.Mock;
    savePluginOptions: jest.Mock;
    handleMessage: jest.Mock;
    subscribe: jest.Mock;
  };
  // Helper to trigger subscription callbacks
  _triggerDelta: (delta: Delta) => void;
}

export function createMockApp(options: MockAppOptions = {}): MockSignalKApp {
  const dataDir = options.dataDir ?? '/tmp/test-signalk-data';
  let subscribeCallback: ((delta: Delta) => void) | null = null;

  const mocks = {
    debug: jest.fn(),
    error: jest.fn(),
    setPluginStatus: jest.fn(),
    setPluginError: jest.fn(),
    getDataDirPath: jest.fn(() => dataDir),
    savePluginOptions: jest.fn((_options: unknown, callback?: (err?: Error) => void) => {
      if (callback) callback();
    }),
    handleMessage: jest.fn(),
    subscribe: jest.fn(
      (
        _command: SubscribeCommand,
        unsubscribes: Unsubscribe[],
        _errorCallback: (err: unknown) => void,
        callback: (delta: Delta) => void
      ) => {
        subscribeCallback = callback;
        // Add unsubscribe function
        unsubscribes.push(() => {
          subscribeCallback = null;
        });
      }
    ),
  };

  return {
    debug: mocks.debug,
    error: mocks.error,
    setPluginStatus: mocks.setPluginStatus,
    setPluginError: mocks.setPluginError,
    getDataDirPath: mocks.getDataDirPath,
    savePluginOptions: mocks.savePluginOptions,
    handleMessage: mocks.handleMessage,
    subscriptionmanager: {
      subscribe: mocks.subscribe,
    },
    _mocks: mocks,
    _triggerDelta: (delta: Delta): void => {
      if (subscribeCallback) {
        subscribeCallback(delta);
      }
    },
  };
}

/**
 * Create a position delta for testing
 */
export function createPositionDelta(
  latitude: number,
  longitude: number,
  source = 'test-gps',
  timestamp?: string
): Delta {
  return {
    context: 'vessels.self',
    updates: [
      {
        timestamp: timestamp ?? new Date().toISOString(),
        $source: source,
        values: [
          {
            path: 'navigation.position',
            value: { latitude, longitude },
          },
        ],
      },
    ],
  };
}

/**
 * Create a speed delta for testing
 */
export function createSpeedDelta(speedInKnots: number, source = 'test-gps'): Delta {
  const speedInMs = speedInKnots / 1.94384; // Convert knots to m/s
  return {
    context: 'vessels.self',
    updates: [
      {
        timestamp: new Date().toISOString(),
        $source: source,
        values: [
          {
            path: 'navigation.speedOverGround',
            value: speedInMs,
          },
        ],
      },
    ],
  };
}
