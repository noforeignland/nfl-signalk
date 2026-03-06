/**
 * Integration test — runs against a live Signal K server
 * with the plugin installed and sample NMEA data flowing.
 *
 * The CI workflow sets SIGNALK_URL=http://localhost:3000
 */

/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access,
   @typescript-eslint/no-explicit-any, @typescript-eslint/restrict-template-expressions,
   @typescript-eslint/explicit-function-return-type */

const SIGNALK_URL = process.env.SIGNALK_URL || 'http://localhost:3000';
const PLUGIN_ID = 'signalk-to-noforeignland';

async function fetchJson(path: string): Promise<any> {
  const res = await fetch(`${SIGNALK_URL}${path}`);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} on ${path}`);
  return res.json();
}

async function postJson(path: string, body: unknown) {
  const res = await fetch(`${SIGNALK_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} on POST ${path}`);
  return res;
}

describe('nfl-signalk integration', () => {
  beforeAll(async () => {
    // Configure plugin with a dummy API key so it actually starts
    await postJson(`/skServer/plugins/${PLUGIN_ID}/config`, {
      enabled: true,
      configuration: {
        mandatory: { boatApiKey: 'ci-test-dummy-key-12345' },
        expert: { trackFrequency: 5, apiCron: '0 0 31 2 *' }, // never-fire cron
      },
    });

    // Give the plugin time to restart and receive position data
    await new Promise((r) => setTimeout(r, 8000));
  }, 15000);

  it('plugin is loaded by the server', async () => {
    const plugins: any[] = await fetchJson('/skServer/plugins');
    const nfl = plugins.find((p: any) => p.id === PLUGIN_ID);
    expect(nfl).toBeDefined();
    expect(nfl.packageName).toBe('@noforeignland/signalk-to-noforeignland');
  });

  it('plugin has a valid schema', async () => {
    const plugins: any[] = await fetchJson('/skServer/plugins');
    const nfl = plugins.find((p: any) => p.id === PLUGIN_ID);
    expect(nfl.schema).toBeDefined();
    expect(nfl.schema.type).toBe('object');
    expect(nfl.schema.properties).toBeDefined();
    expect(nfl.schema.properties.mandatory).toBeDefined();
  });

  it('server receives navigation.position from sample data', async () => {
    const api = await fetchJson(
      '/signalk/v1/api/vessels/self/navigation/position'
    );
    expect(api).toBeDefined();
    expect(api.value).toBeDefined();
    expect(api.value.latitude).toBeDefined();
    expect(api.value.longitude).toBeDefined();
  });

  it('plugin emits noforeignland.status delta', async () => {
    const api = await fetchJson(
      '/signalk/v1/api/vessels/self/noforeignland/status'
    );
    expect(api).toBeDefined();
    expect(api.value).toBeDefined();
    expect(typeof api.value).toBe('string');
  });

  it('plugin emits noforeignland.status_boolean delta', async () => {
    const api = await fetchJson(
      '/signalk/v1/api/vessels/self/noforeignland/status_boolean'
    );
    expect(api).toBeDefined();
    expect([0, 1]).toContain(api.value);
  });
});
