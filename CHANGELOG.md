0.1.25-beta.2
* CHANGE: Typo in pluginName fixed
* CHANGE: Dates for SetPlugin now ISO8601 formated (https://github.com/noforeignland/nfl-signalk/issues/9)

0.1.25-beta.1
* CHANGE: User mattzilla470 reported timout Issues on VE Cerbo with a small CPU (https://github.com/noforeignland/nfl-signalk/issues/7). So added a timout option in the plugin config and a tripple retry while increasing the timeout for the API call.

0.1.24
* CHANGE: testInternet only uses ipv4 now, some users don't have ipv6 configured properly and where unable to reach the API, when testInternet returned false
* NEW: PluginStatus on SK dashboard now shows last savePoint and last API transfer, so a user has more feedback what the app is doing without enabling the debug log and crawling though it.
* CHANGE: Renamed CHANGELOG to CHANGELOG.md
* CHANGE: CHANGELOG ORDER - newest on top.
* Final version after successful testing SV MOIN and  SV KIAPA NUI

0.1.23
* Final version after successful testing SV MOIN and SV KIAPA NUI

0.1.23-beta.1
* Renamed branch to follow the release versions. 
* CLEANUP - More debug info for the SK dashboard using this.app.setPluginError
* CLEANUP - Removed CreateGPX, was only used for removed Email transmission of the track

0.1.22-beta.2

* CLEANUP and move to Object Oriented Javascript

0.1.22-beta.1

* CONFIG: Attempt sending location while moving - Default changed from false to true
* CONFIG: Ping added for 24h ping if boat is not moved. - Default: true
* Package.json - Nodemailer dependency removed
* Marked for removal - Depricated "sendEmailData" function.
* REMOVED - sendEmail.js
* CLEANUP - Renamed emaiCron to apiCron
* NEW: 24h api ping, when enabled, even if boat didn't move.

