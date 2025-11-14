# Signal K To Noforeignland
Effortlessly log your boat's movement to **noforeignland.com**

## Important for 0.1.x users
Since 1.0.0 this package now released unter npmjs org noforeignland in version 1.0.0 due to deployment changes in npmjs and the need of trustworthy sources. All npmjs keys will be revoked Nov 19th, 2025. 
Users of the old (depricated) 0.1.x versions need to install this new package once manually using the Signal K Appstore. The Plugin Configuration will be kept from the 0.1.x install. 

## Features
* Automatically log your position to noforeignland.com
* Send detailed tracks to log your entire trip and not just your final position
* Can be used in near real time or cache and upload when stopped and data-connection is available
* Sends 24h keepalive
* Option to archive your track on the local disk
* Detailed plugin information in the SK dashboard 
* SK data paths about the plugin status for your own dashboard or Node Red coding

## Issues
* Server -> Plugin Config -> Signal K to Noforeignland -> Enable debug log (top right)
* Report issues on GitHub (https://github.com/noforeignland/nfl-signalk/issues)

## Requirements
* An internet connection is required in order to update noforeignland.com
* A navigation.position data path inside Signal K for self, which is your current GPS position
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