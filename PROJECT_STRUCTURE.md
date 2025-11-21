# Project Structure

This document describes the architecture and organization of the SignalK to Noforeignland plugin.

## Overview

This plugin follows a modular architecture where each responsibility is encapsulated in a dedicated module. The main orchestrator ([index.js](index.js)) coordinates all modules through a class-based approach.

## Directory Layout

```
nfl-signalk/
  index.js                      # Main plugin entry point & orchestrator
  cleanup-old-plugin.js         # Postinstall script for removing old versions
  package.json                  # NPM package configuration
  lib/                          # Core modules directory
    ConfigManager.js            # Configuration handling & migration
    TrackLogger.js              # Position subscription & logging
    TrackSender.js              # API communication & track sending
    HealthMonitor.js            # Position data health checks
    PluginCleanup.js            # Runtime cleanup of old plugins
    TrackMigration.js           # Track file migration utilities
    DataPathEmitter.js          # SignalK delta emission
    DirectoryUtils.js           # File system utilities
  README.md                     # User documentation
  CHANGELOG.md                  # Version history
  PROJECT_STRUCTURE.md          # This file
```

## Module Responsibilities

### Core Orchestrator

#### [index.js](index.js)
**Purpose**: Main plugin class that orchestrates all modules and implements SignalK plugin lifecycle.

**Key Responsibilities**:
- Exports SignalK plugin object with `start()` and `stop()` methods
- Initializes all module instances in correct order
- Manages plugin state (options, upSince, cron, lastSuccessfulTransfer)
- Coordinates between modules during startup sequence
- Handles plugin status and error reporting to SignalK UI
- Implements CRON-based interval for data sending

**Key Methods**:
- `start(options, restartPlugin)`: 13-step startup sequence
- `stop()`: Cleanup and shutdown
- `interval()`: CRON job handler for sending tracks
- `handleSavePoint(lastPosition)`: Callback when track point is saved
- `handleHealthy()`: Callback when health check passes
- `setPluginStatus(status)`: Update UI status
- `setPluginError(error)`: Report error to UI

### Configuration & Migration

#### [lib/ConfigManager.js](lib/ConfigManager.js)
**Purpose**: Handles plugin configuration, schema definition, and config migration.

**Key Responsibilities**:
- Defines plugin schema (mandatory/advanced/expert settings groups)
- Migrates old flat config structure to new nested structure
- Flattens nested config back to internal format with defaults
- Validates boat API key
- Resolves track directory paths (absolute vs relative)
- Randomizes CRON schedule to avoid server load spikes

**Config Structure**:
```javascript
{
  mandatory: { boatApiKey: string },
  advanced: { minMove, minSpeed, sendWhileMoving, ping_api_every_24h },
  expert: { filterSource, trackDir, keepFiles, trackFrequency, apiCron,
            internetTestTimeout, apiTimeout }
}
```

### Position Tracking

#### [lib/TrackLogger.js](lib/TrackLogger.js)
**Purpose**: Subscribes to position updates and logs them to disk.

**Key Responsibilities**:
- Subscribes to `navigation.position` and optionally `navigation.speedOverGround`
- Implements GNSS source auto-selection (stick to one source unless stale)
- Supports manual source filtering via `filterSource` config
- Validates positions (rejects coordinates near 0,0)
- Applies movement filters (minSpeed, minMove, trackFrequency)
- Implements 24-hour keepalive ping
- Saves track points to JSONL file (`pending.jsonl`)
- Calculates distances using equirectangular approximation

**GNSS Source Logic**:
- If `filterSource` is set: only accept that specific source
- If not set: auto-select first source, switch only if stale (>5 min)
- Prevents position jumps when multiple GNSS devices are present

**Track Point Format**:
```json
{"lat": 37.8136, "lon": -122.4784, "t": "2025-01-15T10:30:00.000Z"}
```

#### [lib/TrackSender.js](lib/TrackSender.js)
**Purpose**: Sends accumulated track data to the Noforeignland API.

**Key Responsibilities**:
- Reads track points from `pending.jsonl`
- Tests internet connectivity via DNS lookups (8.8.8.8, 1.1.1.1)
- Checks if boat is moving (based on last position timestamp)
- Sends track data to NFL API with retry logic (3 attempts)
- Handles successful sends (archive to `sent.jsonl` or delete)
- Validates position coordinates before sending

**API Request Format**:
```javascript
POST https://www.noforeignland.com/home/api/v1/boat/tracking/track
Headers: { 'X-NFL-API-Key': pluginApiKey }
Body: {
  timestamp: ms,
  track: [[ms, lat, lon], [ms, lat, lon], ...],
  boatApiKey: userBoatApiKey
}
```

**Retry Logic**:
- Attempt 1: base timeout (default 30s)
- Attempt 2: 2x timeout + 2s delay
- Attempt 3: 3x timeout + 4s delay

### Health & Monitoring

#### [lib/HealthMonitor.js](lib/HealthMonitor.js)
**Purpose**: Monitors GNSS position data freshness and reports issues.

**Key Responsibilities**:
- Initial check: 2 minutes after startup
- Periodic checks: every 5 minutes
- Detects stale position data (>5 minutes old)
- Detects missing position data
- Provides context-aware error messages (filtered vs auto-selected source)
- Calls error/healthy callbacks to update plugin status

**Health States**:
- Healthy: Position received within last 5 minutes
- Warning: No position for >5 minutes
- Error: No position ever received (or 2+ min after startup)

### Cleanup & Migration

#### [lib/PluginCleanup.js](lib/PluginCleanup.js)
**Purpose**: Runtime cleanup of old plugin versions.

**Key Responsibilities**:
- Detects Victron Cerbo vs standard SignalK paths
- Migrates config from old `signalk-to-noforeignland` to new scoped name
- Removes old plugin directories (`signalk-to-noforeignland`, `signalk-to-nfl`)
- Multiple retry attempts (immediate, 5s, 15s, 30s delays)
- Falls back to manual instructions if removal fails
- Returns promise resolving to 'all_removed' or 'partial_removal'

**Old Plugins Removed**:
- `signalk-to-noforeignland` (unscoped predecessor)
- `signalk-to-nfl` (deprecated alias)

#### [cleanup-old-plugin.js](cleanup-old-plugin.js)
**Purpose**: Postinstall script for immediate cleanup during npm install.

**Key Responsibilities**:
- Runs via `npm postinstall` hook
- Uses direct `fs.rmSync()` instead of npm uninstall (safer during install)
- 2-second delay to allow npm to complete current operation
- Detects Victron Cerbo vs standard SignalK paths
- Migrates config files
- Provides fallback manual instructions

**Why Two Cleanup Mechanisms?**
1. **Postinstall**: Runs during installation, removes old plugins immediately
2. **Runtime**: Handles cases where postinstall failed (permissions, timing)

#### [lib/TrackMigration.js](lib/TrackMigration.js)
**Purpose**: Migrates track files from old naming/location schemes.

**Key Responsibilities**:
- Migrates old file names to new naming scheme:
  - `nfl-track.jsonl` -> `pending.jsonl`
  - `nfl-track-pending.jsonl` -> `pending.jsonl`
  - `nfl-track-sent.jsonl` -> `sent.jsonl`
- Migrates track files from old plugin directory to new data directory
- Removes old track directory if empty
- Non-destructive: only migrates if target doesn't exist

### SignalK Integration

#### [lib/DataPathEmitter.js](lib/DataPathEmitter.js)
**Purpose**: Creates and updates SignalK data paths for external integrations.

**Key Responsibilities**:
- Emits SignalK deltas to create data paths
- Updates status paths on state changes
- Manages error state independently
- Provides both ISO8601 and locale-formatted timestamps

**Data Paths Created**:
```
noforeignland.savepoint             # ISO8601 timestamp of last save
noforeignland.savepoint_local       # Locale string of last save
noforeignland.sent_to_api           # ISO8601 timestamp of last API transfer
noforeignland.sent_to_api_local     # Locale string of last API transfer
noforeignland.status                # Status string (save/transfer/source info)
noforeignland.status_boolean        # 0 = OK, 1 = error
noforeignland.source                # Active GNSS source name
```

**Usage**: These paths can be consumed by Node-RED, KIP dashboards, or other SignalK consumers.

#### [lib/DirectoryUtils.js](lib/DirectoryUtils.js)
**Purpose**: File system utilities with proper error handling.

**Key Responsibilities**:
- Creates directories recursively
- Checks read/write permissions
- Provides context-specific error messages
- Handles common error codes (EACCES, EPERM, ETIMEDOUT)

## Data Flow

### Startup Sequence
```
1. ConfigManager: Migrate old config -> flatten -> validate
2. DirectoryUtils: Create track directory
3. PluginCleanup: Remove old plugins (async, non-blocking)
4. TrackMigration: Migrate old track files
5. Initialize: TrackLogger, TrackSender, HealthMonitor
6. ConfigManager: Randomize CRON schedule
7. TrackLogger: Start position subscription
8. CRON: Start interval job
9. HealthMonitor: Start health checks
```

### Position Logging Flow
```
navigation.position delta
  -> TrackLogger.doOnValue()
    -> handleSourceSelection() [filter/auto-select]
    -> isValidPosition() [validate lat/lon]
    -> shouldLogPosition() [check distance/frequency]
    -> savePoint() [append to pending.jsonl]
    -> callback to index.handleSavePoint()
      -> DataPathEmitter.emitSavepoint()
      -> setPluginStatus()
```

### Track Sending Flow (CRON Interval)
```
CRON trigger
  -> index.interval()
    -> TrackSender.isBoatMoving() [check last position age]
    -> TrackSender.hasTrackData() [check pending.jsonl exists]
    -> TrackSender.testInternet() [DNS lookup test]
    -> TrackSender.sendTrack()
      -> createTrackFromFile() [read pending.jsonl]
      -> sendWithRetry() [POST to API, 3 attempts]
      -> handleSuccessfulSend() [archive or delete]
    -> DataPathEmitter.emitApiTransfer()
    -> setPluginStatus()
```

### Health Monitoring Flow
```
HealthMonitor timer (every 5 min)
  -> performHealthCheck()
    -> check lastPositionReceived timestamp
    -> if stale/missing: call onError callback
      -> index.setPluginError()
        -> DataPathEmitter.setError()
        -> app.setPluginError()
    -> if healthy: call onHealthy callback
      -> index.handleHealthy()
        -> setPluginStatus() [clear error if needed]
```

## File Locations

### Victron Cerbo GX
- SignalK directory: `/data/conf/signalk`
- Plugin installed at: `/data/conf/signalk/node_modules/@noforeignland/signalk-to-noforeignland`
- Config: `/data/conf/signalk/plugin-config-data/@noforeignland-signalk-to-noforeignland.json`
- Track files: `/data/conf/signalk/plugin-config-data/@noforeignland-signalk-to-noforeignland/nfl-track/`

### Standard SignalK
- SignalK directory: `~/.signalk`
- Plugin installed at: `~/.signalk/node_modules/@noforeignland/signalk-to-noforeignland`
- Config: `~/.signalk/plugin-config-data/@noforeignland-signalk-to-noforeignland.json`
- Track files: `~/.signalk/plugin-config-data/@noforeignland-signalk-to-noforeignland/nfl-track/`

## Development Notes

### Adding New Features
1. Create module in `lib/` if it's a distinct responsibility
2. Instantiate in [index.js](index.js) constructor
3. Initialize in `start()` method at appropriate step
4. Clean up in `stop()` method
5. Update this document

### Configuration Changes
1. Update schema in [ConfigManager.js](lib/ConfigManager.js) `getSchema()`
2. Add migration logic in `migrateOldConfig()` if breaking change
3. Update `flattenConfig()` to include new fields with defaults
4. Test both old and new config formats

### Track File Format Changes
1. Update `TrackLogger.savePoint()` for writing
2. Update `TrackSender.createTrackFromFile()` for reading
3. Add migration logic in [TrackMigration.js](lib/TrackMigration.js) if needed

### Testing Checklist
- [ ] Test on Victron Cerbo GX (path detection, limited storage)
- [ ] Test on standard SignalK installation
- [ ] Test config migration from old versions
- [ ] Test with multiple GNSS sources (auto-selection)
- [ ] Test with filtered source
- [ ] Test with no internet connection
- [ ] Test with slow internet (timeout scenarios)
- [ ] Test cleanup of old plugins
- [ ] Test track file migration

## Dependencies

```json
{
  "cron": "^2.1.0",           // CRON job scheduling
  "fs-extra": "^10.1.0",      // Enhanced file system operations
  "node-fetch": "^2.6.7"      // HTTP requests to API
}
```

## Version History Notes

- **1.1.0**: Refactored to modular structure
- **1.0.x**: Scoped package name, cleanup mechanism
- **0.1.x**: Original flat structure (deprecated)

## Known Technical Debt

1. **Empty process.exit()**: [cleanup-old-plugin.js](cleanup-old-plugin.js) setTimeout may not complete
2. **Error timing**: [PluginCleanup.js](lib/PluginCleanup.js) shows error before retries complete
3. **No test suite**: Manual testing only, no automated tests

## SignalK Plugin Conventions

This plugin follows SignalK plugin conventions:
- Exports function returning `{id, name, schema, start, stop}`
- Uses `app.debug()` for logging
- Uses `app.setPluginStatus()` and `app.setPluginError()` for UI feedback
- Subscribes via `app.subscriptionmanager.subscribe()`
- Emits deltas via `app.handleMessage(pluginId, delta)`
- Config stored in `plugin-config-data/` directory
- Data stored in plugin's data directory
