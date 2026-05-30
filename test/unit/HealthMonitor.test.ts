/**
 * Tests for HealthMonitor staleness threshold.
 *
 * Regression: with `trackFrequency >= ~150s`, the old hardcoded 300s threshold
 * tripped routinely because navigation.position deltas are throttled to one
 * delivery per trackFrequency window. See issue #38.
 */

import { HealthMonitor, computeStaleThresholdSeconds } from '../../src/lib/HealthMonitor';
import { createMockApp } from '../mocks/signalk-app';
import type { FlatConfig } from '../../src/types';

function makeConfig(overrides: Partial<FlatConfig> = {}): FlatConfig {
  return {
    boatApiKey: 'k',
    minMove: 50,
    minSpeed: 0,
    sendWhileMoving: true,
    ping_api_every_24h: true,
    trackDir: '/tmp/x',
    keepFiles: false,
    trackFrequency: 60,
    apiCron: '*/10 * * * *',
    apiTimeout: 30,
    maxVelocity: 50,
    ...overrides,
  };
}

describe('computeStaleThresholdSeconds', () => {
  it('keeps the 300s floor for small trackFrequency', () => {
    expect(computeStaleThresholdSeconds(0)).toBe(300);
    expect(computeStaleThresholdSeconds(60)).toBe(300);
    expect(computeStaleThresholdSeconds(119)).toBe(300);
  });

  it('scales above 300s once trackFrequency * 2 + 60 exceeds it', () => {
    expect(computeStaleThresholdSeconds(120)).toBe(300);
    expect(computeStaleThresholdSeconds(150)).toBe(360);
    expect(computeStaleThresholdSeconds(600)).toBe(1260);
  });
});

describe('HealthMonitor.performHealthCheck', () => {
  const NOW = 1_700_000_000_000;

  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('does not error on a 599s gap when trackFrequency is 600 (issue #38 regression)', () => {
    const app = createMockApp();
    const monitor = new HealthMonitor(app, makeConfig({ trackFrequency: 600 }));
    const onError = jest.fn();
    const onHealthy = jest.fn();

    monitor.performHealthCheck(NOW - 599_000, null, onError, onHealthy);

    expect(onError).not.toHaveBeenCalled();
    expect(onHealthy).toHaveBeenCalled();
  });

  it('still errors when the gap exceeds the derived threshold', () => {
    const app = createMockApp();
    const monitor = new HealthMonitor(app, makeConfig({ trackFrequency: 600 }));
    const onError = jest.fn();
    const onHealthy = jest.fn();

    monitor.performHealthCheck(NOW - 1_400_000, null, onError, onHealthy);

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onHealthy).not.toHaveBeenCalled();
  });

  it('errors at the legacy 300s threshold when trackFrequency is low', () => {
    const app = createMockApp();
    const monitor = new HealthMonitor(app, makeConfig({ trackFrequency: 60 }));
    const onError = jest.fn();
    const onHealthy = jest.fn();

    monitor.performHealthCheck(NOW - 600_000, null, onError, onHealthy);

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onHealthy).not.toHaveBeenCalled();
  });

  it('errors when lastPositionReceived is null', () => {
    const app = createMockApp();
    const monitor = new HealthMonitor(app, makeConfig());
    const onError = jest.fn();
    const onHealthy = jest.fn();

    monitor.performHealthCheck(null, null, onError, onHealthy);

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('No GNSS position data'));
  });

  it('mentions the filtered source in the error when filterSource is set', () => {
    const app = createMockApp();
    const monitor = new HealthMonitor(app, makeConfig({ filterSource: 'can0.2' }));
    const onError = jest.fn();
    const onHealthy = jest.fn();

    monitor.performHealthCheck(NOW - 1_000_000, null, onError, onHealthy);

    expect(onError).toHaveBeenCalledWith(expect.stringContaining("source 'can0.2'"));
    expect(onHealthy).not.toHaveBeenCalled();
  });

  it('null-source error mentions the filtered source', () => {
    const app = createMockApp();
    const monitor = new HealthMonitor(app, makeConfig({ filterSource: 'can0.2' }));
    const onError = jest.fn();
    const onHealthy = jest.fn();

    monitor.performHealthCheck(null, null, onError, onHealthy);

    expect(onError).toHaveBeenCalledWith(expect.stringContaining("'can0.2'"));
  });
});

describe('HealthMonitor.performInitialCheck', () => {
  it('errors when no position has ever been received', () => {
    const app = createMockApp();
    const monitor = new HealthMonitor(app, makeConfig());
    const onError = jest.fn();

    monitor.performInitialCheck(null, null, onError);

    expect(onError).toHaveBeenCalledWith(expect.stringContaining('after 2 minutes'));
  });

  it('mentions the filtered source on initial-check failure', () => {
    const app = createMockApp();
    const monitor = new HealthMonitor(app, makeConfig({ filterSource: 'can0.2' }));
    const onError = jest.fn();

    monitor.performInitialCheck(null, null, onError);

    expect(onError).toHaveBeenCalledWith(expect.stringContaining("'can0.2'"));
  });

  it('does nothing when a position has been received', () => {
    const app = createMockApp();
    const monitor = new HealthMonitor(app, makeConfig());
    const onError = jest.fn();

    monitor.performInitialCheck(Date.now(), null, onError);

    expect(onError).not.toHaveBeenCalled();
  });
});

describe('HealthMonitor.start/stop', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('schedules an initial check after 2 minutes and a periodic check every 5', () => {
    const app = createMockApp();
    const monitor = new HealthMonitor(app, makeConfig());
    const onError = jest.fn();
    const onHealthy = jest.fn();

    monitor.start(
      () => null,
      () => null,
      onError,
      onHealthy
    );

    jest.advanceTimersByTime(2 * 60 * 1000);
    expect(onError).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(5 * 60 * 1000);
    expect(onError).toHaveBeenCalledTimes(2);

    monitor.stop();
    jest.advanceTimersByTime(10 * 60 * 1000);
    expect(onError).toHaveBeenCalledTimes(2);
  });

  it('stop() is safe to call without start()', () => {
    const app = createMockApp();
    const monitor = new HealthMonitor(app, makeConfig());
    expect(() => {
      monitor.stop();
    }).not.toThrow();
  });
});
