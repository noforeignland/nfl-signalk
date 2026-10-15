import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { STATE_FILE_NAME, UploadStateStore } from '../../src/lib/UploadState';
import { PendingFile, legacyPendingFile } from '../../src/lib/PendingDrain';
import { readSelfPosition } from '../../src/lib/SelfPosition';
import { createMockApp } from '../mocks/signalk-app';

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nfl-storage-'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('UploadStateStore', () => {
  const state = {
    version: 1 as const,
    cursor: 1_000,
    uploaded: { time: 900, latitude: 52.1, longitude: 4.3 },
  };

  it('reads back what it saved', async () => {
    const store = new UploadStateStore(dir);
    await store.save(state);
    expect(await store.load()).toEqual(state);
    expect(await fs.readdir(dir)).toEqual([STATE_FILE_NAME]);
  });

  it('has no state before the first save', async () => {
    expect(await new UploadStateStore(dir).load()).toBeNull();
  });

  it('treats an unreadable or foreign state as none', async () => {
    const file = path.join(dir, STATE_FILE_NAME);
    await fs.writeFile(file, '{"version":1,"cursor":');
    expect(await new UploadStateStore(dir).load()).toBeNull();
    await fs.writeFile(file, JSON.stringify({ version: 2, cursor: 5 }));
    expect(await new UploadStateStore(dir).load()).toBeNull();
  });
});

describe('legacyPendingFile', () => {
  const dataDir = path.resolve('/data/plugin');

  it('defaults to the nfl-track directory under the data directory', () => {
    expect(legacyPendingFile({}, dataDir)).toBe(path.join(dataDir, 'nfl-track', 'pending.jsonl'));
  });

  it('follows a track directory 1.x saved in the expert group or the flat layout', () => {
    const absolute = path.resolve('/var/nfl');
    const grouped = JSON.parse(`{"expert":{"trackDir":${JSON.stringify(absolute)}}}`) as object;
    expect(legacyPendingFile(grouped, dataDir)).toBe(path.join(absolute, 'pending.jsonl'));
    expect(legacyPendingFile({ trackDir: 'tracks' }, dataDir)).toBe(
      path.join(dataDir, 'tracks', 'pending.jsonl')
    );
  });
});

describe('PendingFile', () => {
  it('reads the valid lines in time order and skips the rest', async () => {
    const file = path.join(dir, 'pending.jsonl');
    await fs.writeFile(
      file,
      [
        '{"lat":52.2,"lon":4.4,"t":"2026-10-01T12:01:00.000Z"}',
        'not json',
        '{"lat":95,"lon":4.4,"t":"2026-10-01T12:02:00.000Z"}',
        '{"lat":52.1,"lon":4.3,"t":"2026-10-01T12:00:00.000Z"}',
        '',
      ].join('\r\n')
    );
    expect(await new PendingFile(file).read()).toEqual([
      { time: Date.parse('2026-10-01T12:00:00.000Z'), latitude: 52.1, longitude: 4.3 },
      { time: Date.parse('2026-10-01T12:01:00.000Z'), latitude: 52.2, longitude: 4.4 },
    ]);
  });

  it('has nothing pending when there is no file', async () => {
    expect(await new PendingFile(path.join(dir, 'missing.jsonl')).read()).toEqual([]);
  });

  it('keeps what is left in the 1.x format, and removes the file when nothing is', async () => {
    const file = path.join(dir, 'pending.jsonl');
    const pending = new PendingFile(file);
    const left = [{ time: Date.parse('2026-10-01T12:00:00.000Z'), latitude: 52.1, longitude: 4.3 }];

    await pending.replace(left);
    expect(await fs.readFile(file, 'utf8')).toBe(
      '{"lat":52.1,"lon":4.3,"t":"2026-10-01T12:00:00.000Z"}\n'
    );
    expect(await pending.read()).toEqual(left);

    await pending.replace([]);
    await expect(fs.access(file)).rejects.toThrow();
  });
});

describe('readSelfPosition', () => {
  it('reads the position, its time and the source the server chose', () => {
    const app = createMockApp({
      selfPath: {
        value: { latitude: 52.1, longitude: 4.3 },
        timestamp: '2026-10-01T12:00:00.000Z',
        $source: 'can0.2',
      },
    });
    expect(readSelfPosition(app)).toEqual({
      fix: { time: Date.parse('2026-10-01T12:00:00.000Z'), latitude: 52.1, longitude: 4.3 },
      source: 'can0.2',
    });
    expect(app._mocks.getSelfPath).toHaveBeenCalledWith('navigation.position');
  });

  it('has no position when the path is missing or malformed', () => {
    expect(readSelfPosition(createMockApp())).toBeNull();
    expect(readSelfPosition(createMockApp({ selfPath: { value: { latitude: 52.1 } } }))).toBeNull();
    expect(
      readSelfPosition(
        createMockApp({
          selfPath: { value: { latitude: 52.1, longitude: 4.3 }, timestamp: 'yesterday' },
        })
      )
    ).toBeNull();
  });
});
