# Signal K To Noforeignland
Effortlessly log your boat's movement to **noforeignland.com**

## Features
* Uploads your boat's track to noforeignland.com, as recorded by the Signal K [Tracks](https://github.com/SignalK/tracks) plugin
* Sends detailed tracks of your entire trip, not just your final position
* Uploads in near real time, or holds back until you stop and have a data connection
* Catches up after time offline: whatever was recorded meanwhile is sent once the connection is back
* Sends a 24h keepalive so your boat stays active on noforeignland.com
* Detailed plugin information in the SK dashboard
* SK data paths about the plugin status for your own dashboard or Node Red coding

## Issues
* Enable debug logging: Server -> Plugin Config -> Signal K to Noforeignland -> Enable debug log (top right)
* Check logs: Server -> Server Log (in SignalK web UI)
* Report issues on [GitHub](https://github.com/noforeignland/nfl-signalk/issues)

## Requirements
* **Signal K server 2.33 or later**
* The **Tracks** plugin (`@signalk/tracks-plugin`), installed and enabled. The App Store offers to install it together with this plugin, and it starts recording as soon as it is installed.
* An internet connection is required in order to update noforeignland.com
* A navigation.position data path inside Signal K for self, which is your current GNSS position
* A **noforeignland.com** account
* Your Boat API Key from the **noforeignland.com** website: 
  * Account > Settings > Boat tracking > API Key

> Note your Boat API Key is not available in the app. 
> You must sign in to the **noforeignland.com** website (using the same authentication method you use for the app: Google. Facebook, Email).

On an older Signal K server, for example the one bundled with an older Venus OS, use version 1.4 of this plugin: `npm i @noforeignland/signalk-to-noforeignland@1.4` in your Signal K directory. Version 2 reports "This version needs Signal K server 2.33 or later" there.

## Configuration
1. Add your boat's API Key into the Server > Plugin Config > Signal K to Noforeignland > Boat API Key
2. Hit "Submit"
3. Restart the Signal K server

### More than one GNSS receiver
The Tracks plugin records the position the server chooses for `navigation.position`. If you have several receivers (a GPS, an AIS transponder, a chart plotter), set a source priority for `navigation.position` under _Data -> Source Priority_ in the Admin UI. Without one, positions from all receivers are mixed and the track zigzags.

### Advanced and Expert Settings
* **Minimum boat move to upload** (default 80 m), **Minimum boat speed to upload** (default 1.5 knots) and **Minimum time between uploaded positions** (default 60 s) decide which recorded positions are sent, so swinging at anchor does not fill your track on noforeignland.com. The Tracks plugin keeps every recorded position regardless.
* Positions far off the boat's track are filtered by the Tracks plugin ("Discard positions implying a speed above this").

## Upgrading from version 1
* Positions that version 1 had recorded but not uploaded yet (`pending.jsonl`) are uploaded once on the first start, and the file is removed.
* These settings are gone: **Position source device** (use _Data -> Source Priority_, see above), **Maximum velocity** (the Tracks plugin filters glitches), **Directory to cache tracks** and **Keep track files on disk** (the Tracks plugin keeps your track).
* An archive kept with "Keep track files on disk" (`sent.jsonl`) stays on your disk. To add it to your recorded track in the Tracks plugin:
  1. Log in to your Signal K device with SSH (PuTTY on Windows) and go to the folder with the archive:
     * Victron Cerbo GX: `cd /data/conf/signalk/plugin-config-data/signalk-to-noforeignland/nfl-track`
     * Other installs: `cd ~/.signalk/plugin-config-data/signalk-to-noforeignland/nfl-track`
     * If you had set "Directory to cache tracks", go to that folder instead.
  2. Turn it into a GPX file:
     ```
     node -e 'const fs=require("fs");const p=fs.readFileSync("sent.jsonl","utf8").split("\n").filter(Boolean).map(l=>JSON.parse(l));fs.writeFileSync("sent.gpx",`<?xml version="1.0"?><gpx version="1.1" creator="noforeignland archive" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>noforeignland archive</name><trkseg>${p.map(x=>`<trkpt lat="${x.lat}" lon="${x.lon}"><time>${x.t}</time></trkpt>`).join("")}</trkseg></trk></gpx>`)'
     ```
  3. Copy `sent.gpx` to your computer (WinSCP on Windows, or `scp`).
  4. Open the Tracks webapp, choose **Import**, pick `sent.gpx`, tick **Tracks of my own vessel** and import it.

  The archive becomes part of your recorded track. It is not uploaded to noforeignland.com again: this plugin only uploads positions recorded after its last upload.

## Data paths created by this plugin
```
noforeignland.savepoint         - ISO8601 timestamp - time of the newest position the Tracks plugin recorded
noforeignland.savepoint_local   - locale timestamp  - the same, in local time
noforeignland.sent_to_api       - ISO8601 timestamp - last successful transfer to the API
noforeignland.sent_to_api_local - locale timestamp  - last successful transfer to the API
noforeignland.status            - string            - Status & Error messages
noforeignland.status_boolean    - number            - 0 = normal operation, 1 = error
noforeignland.source            - string            - data source of navigation.position
```

To get a Signal K notification when the plugin enters the error state, add a Zone rule on `noforeignland.status_boolean` (Server → Data Browser → the path → "Set Zones"): treat values `>= 1` as `alarm` (or `alert`). The plugin itself does not emit any `notifications.*` deltas.

## Development

This plugin is written in TypeScript with strict type checking.

```bash
npm install          # Install dependencies
npm run build        # Bundle with Vite (fails on a type error)
npm run dev          # Rebuild on change
npm run test         # Run tests
npm run test:coverage # Run tests with coverage
npm run lint         # Run ESLint
npm run format       # Run ESLint --fix and Prettier
npm run validate     # Run all checks (typecheck + lint + test:coverage)
```

# Victron Cerbo GX Users

## Limited storage
Signal K can quickly exhaust the small onboard storage of the device, especially when a lot of logging is enabled and not properly configured. The Tracks plugin keeps the own vessel's track indefinitely, and other vessels for 30 days ("Days to keep another vessel after its last fix"). Its "Pause recording while navigation.state is one of" setting stops recording the own vessel while it is moored.

Vicron Energy addressed this here:
https://www.victronenergy.com/live/venus-os:large#disk_space_issues_data_partition_full
