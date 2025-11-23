# Signal K To Noforeignland
Effortlessly log your boat's movement to **noforeignland.com**

## Important for 0.1.x users
Upgrade to >1.1.0 by installing this plugin from the Appstore again. Your old config will be migrated and old plugins will be automatically removed.

## Features
* Automatically log your position to noforeignland.com
* Send detailed tracks to log your entire trip and not just your final position
* Can be used in near real time or cache and upload when stopped and data-connection is available
* Sends 24h keepalive
* Option to archive your track on the local disk
* Detailed plugin information in the SK dashboard 
* SK data paths about the plugin status for your own dashboard or Node Red coding

## Issues
* Enable debug logging: Server -> Plugin Config -> Signal K to Noforeignland -> Enable debug log (top right)
* Check logs: Server -> Server Log (in SignalK web UI)
* Report issues on [GitHub](https://github.com/noforeignland/nfl-signalk/issues)

## Requirements
* An internet connection is required in order to update noforeignland.com
* A navigation.position data path inside Signal K for self, which is your current GNSS position
* A **noforeignland.com** account
* Your Boat API Key from the **noforeignland.com** website: 
  * Account > Settings > Boat tracking > API Key

> Note your Boat API Key is not available in the app. 
> You must sign in to the **noforeignland.com** website (using the same authentication method you use for the app: Google. Facebook, Email).

## Configuration
1. Add your boat's API Key into the Server > Plugin Config > Signal K to Noforeignland > Boat API Key
2. Hit "Submit"
3. Restart the Signal K server 

## Data paths created by this plugin
```
noforeignland.savepoint                    - ISO8601 timestamp - when was last point saved to trackfile
noforeignland.savepoint_local              - locale timestamp  - when was last point saved to trackfile
noforeignland.sent_to_api                  - ISO8601 timestamp - last successful transfer to the API
noforeignland.sent_to_api_local            - locale timestamp  - last successful transfer to the API
noforeignland.status                       - string            - Status & Error messages
noforeignland.status_boolean               - number            - 0 = normal operation, 1 = error
noforeignland.source - string              - string            - data source of navigation.position
notifications.noforeignland.status_boolean - json object       - auto created
```

# Virctron Cerbo GX Users

## Limited storage
Signal K can quickly exhaust the small onboard storage of the device, especially when a lot of logging is enabled and not properly configured. Even concider to not enable "Keep track files on disk" if you are moving a lot.

Vicron Energy addressed this here:
https://www.victronenergy.com/live/venus-os:large#disk_space_issues_data_partition_full

