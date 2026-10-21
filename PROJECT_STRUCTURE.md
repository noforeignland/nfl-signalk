# Project Structure

How the plugin is put together. `AGENTS.md` lists the modules and the conventions; this file explains how they work together.

## Data flow

```
GNSS ──► Signal K server ──► Tracks plugin ──► its SQLite store (the own vessel's track)
         (source priority                            │
          picks one receiver)                        │ app.getTrackApi('tracks').getTracks(
                                                     │   { contexts: ['vessels.self'], from, times: true })
                                                     ▼
                                  this plugin, every cron tick (TrackUploader.run)
                                     │  fixes recorded after the cursor
                                     │  ─► selectFixes: spacing, distance, speed
                                     │  ─► chunks of 1000 ─► TrackSender ─► noforeignland.com
                                     ▼
                                  upload-state.json (cursor moves after each accepted chunk)
```

The plugin records nothing itself. It decides what of the recorded track to upload and remembers how far it got.

## Startup (`src/index.ts`)

1. Migrate a flat pre-1.1 configuration into the groups, flatten it and apply the defaults (`ConfigManager`, `configSchema`).
2. Stop with a plugin error if there is no boat API key, or if the server has no Track API (signalk-server < 2.33).
3. Create the data directory and wire up a `TrackUploader` with its dependencies: Tracks reader, NFL sender, state store, the 1.x pending file, and the live position.
4. Schedule the upload pass on the (randomised) cron, plus one pass two minutes after start, which gives the Tracks plugin time to register.
5. Start the GNSS health check, which reads `navigation.position` from the server.

`stop()` cancels the cron, the delayed pass and the health check timers.

## One upload pass (`TrackUploader.run`)

1. Load `upload-state.json`. If there is none, this is the first pass after 1.x: upload its `pending.jsonl` in chunks, rewriting the file after each accepted chunk and removing it at the end. The cursor then starts at the last pending fix, or at now when nothing was pending.
2. Ask the Tracks plugin for the own vessel's fixes recorded after the cursor.
3. Keep the fixes worth uploading (`utils/trackFilter.ts`): at least `trackFrequency` seconds and `minMove` metres from the last uploaded fix, recorded at `minSpeed` knots or more from the fix before.
4. If nothing qualifies and nothing went up for 24 hours, send one keep-alive: the newest recorded fix, or the live position.
5. With `sendWhileMoving` off, hold back while the newest fix is recent; nothing is lost, the next pass picks it up.
6. Upload in chunks of 1000. After each accepted chunk, save the cursor and the last uploaded fix. When everything went up, move the cursor past the fixes the filters left out too.

A failed chunk throws. The plugin reports it in its status, and the next pass resumes after the last accepted chunk.

## Status

`index.ts` keeps two messages. An upload error (no Tracks plugin, NFL rejected the track, network) outranks a GNSS warning from the health check, so a healthy GNSS cannot clear a message about the upload. Without either, the status reads `Save: <newest recorded fix> | Transfer: <last upload> | <source>`, and `DataPathEmitter` mirrors it to the `noforeignland.*` paths.

## Files on disk

Under the plugin's data directory, `<Signal K config>/plugin-config-data/signalk-to-noforeignland/`:

| File | Written by | Purpose |
| --- | --- | --- |
| `upload-state.json` | `UploadState` | `cursor`, `previous`, `uploaded`; written atomically (temporary file + rename) |
| `nfl-track/pending.jsonl` | 1.x | Fixes 1.x had not uploaded; drained once, then removed |
| `nfl-track/sent.jsonl` | 1.x | Archive from "Keep track files on disk"; left alone (see README) |

The Signal K config directory is `~/.signalk` on most installs and `/data/conf/signalk` on a Victron Cerbo GX.
