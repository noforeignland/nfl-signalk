import { describe, expect, it } from 'vitest';
import { ConfigManager } from '../../src/lib/ConfigManager';
import { CONFIG_DEFAULTS } from '../../src/lib/configSchema';
import type { FlatConfig, PluginConfig } from '../../src/types';
import { createMockApp } from '../mocks/signalk-app';

describe('ConfigManager.getSchema', () => {
  // The Admin UI renders the settings form straight from this schema, so a
  // change to it is a change to what users see. The file shows exactly what
  // changed.
  it('emits the schema the settings form is rendered from', async () => {
    const schema = JSON.stringify(ConfigManager.getSchema('Signal K to Noforeignland'), null, 2);
    await expect(schema + '\n').toMatchFileSnapshot('./__snapshots__/config-schema.json');
  });
});

describe('ConfigManager.flattenConfig', () => {
  const manager = new ConfigManager(createMockApp());

  it('applies the defaults to an empty configuration', () => {
    expect(manager.flattenConfig({})).toEqual({ ...CONFIG_DEFAULTS, boatApiKey: '' });
  });

  it('keeps an explicit 0 or false rather than the default', () => {
    const flat = manager.flattenConfig({
      advanced: { minMove: 0, minSpeed: 0, sendWhileMoving: false, ping_api_every_24h: false },
      expert: { trackFrequency: 0 },
    });
    expect(flat).toMatchObject({
      minMove: 0,
      minSpeed: 0,
      sendWhileMoving: false,
      ping_api_every_24h: false,
      trackFrequency: 0,
    });
  });

  it('treats an empty schedule as unset', () => {
    const flat = manager.flattenConfig({ expert: { apiCron: '' } });
    expect(flat.apiCron).toBe(CONFIG_DEFAULTS.apiCron);
  });
});

describe('ConfigManager.validateApiKey', () => {
  const manager = new ConfigManager(createMockApp());
  const config = (boatApiKey: string): FlatConfig => ({
    ...manager.flattenConfig({}),
    boatApiKey,
  });

  it('rejects a missing or blank key', () => {
    expect(() => {
      manager.validateApiKey(config(''));
    }).toThrow('No boat API key configured');
    expect(() => {
      manager.validateApiKey(config('   '));
    }).toThrow('No boat API key configured');
  });

  it('accepts a key', () => {
    expect(() => {
      manager.validateApiKey(config('abc'));
    }).not.toThrow();
  });
});

describe('ConfigManager.randomizeCron', () => {
  const manager = new ConfigManager(createMockApp());

  it('spreads the default schedule over a random second and minute', () => {
    const { apiCron } = manager.randomizeCron(manager.flattenConfig({}));
    expect(apiCron).toMatch(/^([0-9]|[1-5][0-9]) [0-9]\/10 \* \* \* \*$/);
  });

  it('keeps a schedule the user set', () => {
    const flat = manager.flattenConfig({ expert: { apiCron: '0 * * * *' } });
    expect(manager.randomizeCron(flat).apiCron).toBe('0 * * * *');
  });
});

describe('ConfigManager.migrateOldConfig', () => {
  const legacy: PluginConfig = { boatApiKey: 'key', minMove: 10, apiTimeout: 60 };

  it('moves a flat configuration into the groups and saves it', async () => {
    const app = createMockApp();
    const result = await new ConfigManager(app).migrateOldConfig(legacy);

    expect(result.migrated).toBe(true);
    expect(result.options.mandatory?.boatApiKey).toBe('key');
    expect(result.options.advanced?.minMove).toBe(10);
    expect(result.options.expert?.apiTimeout).toBe(60);
    expect(app._mocks.savePluginOptions).toHaveBeenCalledWith(result.options, expect.any(Function));
  });

  it('still uses the migrated configuration when saving it fails', async () => {
    const app = createMockApp();
    app._mocks.savePluginOptions.mockImplementation(
      (_options: unknown, callback: (err?: Error) => void) => {
        callback(new Error('read-only'));
      }
    );
    const result = await new ConfigManager(app).migrateOldConfig(legacy);

    expect(result.migrated).toBe(true);
    expect(result.options.mandatory?.boatApiKey).toBe('key');
  });

  it('leaves a grouped configuration alone', async () => {
    const app = createMockApp();
    const grouped: PluginConfig = { mandatory: { boatApiKey: 'key' } };
    const result = await new ConfigManager(app).migrateOldConfig(grouped);

    expect(result).toEqual({ options: grouped, migrated: false });
    expect(app._mocks.savePluginOptions).not.toHaveBeenCalled();
  });
});
