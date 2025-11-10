0.1.28
* BUGFIX: No GPS data found - introduced in 0.1.27 - Thanks Piotr

0.1.28-beta.2
* EXPERIMENTAL: Signal K data path to visualize the plugin behaviour or error in Node Red, KIP, etc. Using plugin.signalk-to-noforeignland.* for now. See README.md for details.
* CHANGE: Using app.getDataDirPath() to store transient data, thanks Jeremy, they are now in "plugin-config-data/signalk-to-noforeignland/nfl-track" and renamed to pending.json1 and sent.json1
* CHANGE: Optimize GPS detection if multiple navigation.position from different sources exist.
* CHANGE: PluginStatus optimized for limited space available.
* CHANGE: doc/beta_install.md changed for new file structure.

0.1.28-beta.1
* CHANGE: By design SK deletes the track folder upon Pluging update via the Appstore, so we have to save the long term track in a different location, default folder: signalk-to-noforeignland-data

0.1.27
* Final version after successful testing SV MOIN and SV KIAPA NUI

0.1.27-beta.1
* NEW: NPMJS requires new method for publishing. The old tokens will expire Nov 19th, 2025, so moving to OIDC authentication.
* NEW: Check the GPS status in navigation.position, else retry and throw PluginError on Dashboard
* CHANGE: Keep track data on disk rewritten and migrate old files to new structure, so nfl-track-sent.jsonl becomes a continuous archive of all sent track data over time, when enabled. New Logic:
* * New points accumulate in nfl-track-pending.jsonl
* * Send succeeds → API confirms receipt
* * If keepFiles=true: The content of pending file is appended to nfl-track-sent.jsonl (line 588)
* * Pending file is deleted
* * Next GPS points → create a new pending file
* * Next successful send → appends again to the same nfl-track-sent.jsonl

0.1.26
* Same as 0.1.26-beta.1 

0.1.26-beta.1
* CHANGE: PluginStatus last track sent "Not transfered since plugin start" gets truncated by the dashboard. Changed to "None since start"

0.1.25
* CHANGE: Minimum boat move default increased from 50m to 80m
* CHANGE: Updated the README.md
* CHANGE: Use public ipv4 DNS instead of local with cache for testInternet()
* Final version after successful testing SV MOIN and SV KIAPA NUI

0.1.25-beta.3
* NEW: Check if boat key is set on startup, else report error to dashboard
* CHANGE: Changing the order and label of the Plugin Settings to make it more clear for unexpierienced users and grouped to Mandatory, Advanced and Expert.
* CHANGE: Migration of < 0.1.25 Plugin settings to new structure.
* CHANGE: PluginStatus last track sent "Never" changed to "Not transfered since plugin start" to avoid confusions.


0.1.25-beta.2
* CHANGE: Typo in pluginName fixed
* CHANGE: Dates for SetPlugin now ISO8601 formated (https://github.com/noforeignland/nfl-signalk/issues/9)

0.1.25-beta.1
* CHANGE: User mattzilla470 reported timout Issues on VE Cerbo with a small CPU and using 4G (https://github.com/noforeignland/nfl-signalk/issues/7). So added a timout option in the plugin config and a tripple retry while increasing the timeout for the API call.

0.1.24
* CHANGE: testInternet() only uses ipv4 now, some users don't have ipv6 configured properly and where unable to reach the API, when testInternet returned false
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

