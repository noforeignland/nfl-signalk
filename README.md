# SignalK To NFL
Effortlessly log your boat's movement to **noforeignland.com**

## Features
* Automatically log your position to NFL
* Send detailed tracks to log your entire trip and not just your final position
* Can be used in near real time or cache and upload when stopped and data-connection is available.
* Can sent a 24h keepalive, when off the boat for a while.

## Issues
* Report issues on GitHub (https://github.com/noforeignland/nfl-signalk/issues)

## Requirements
* An internet connection is required in order to update NFL.
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