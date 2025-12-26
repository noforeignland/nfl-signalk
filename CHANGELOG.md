1.1.0
* CHANGE: Removed postinstall script - SignalK server will use --ignore-scripts (issue #2181). Runtime PluginCleanup handles all migration.
* CHANGE: Refactored Project structure, see PROJECT_STRUCTURE.md
* CHANGE: Use phrase GNSS instead of GPS - Thanks Piotr
* BUGFIX: Removed unreliable DNS-based internet connectivity test (beta.11) - API retry logic is sufficient
* BUGFIX: Reverted to beta.3 working configuration (beta.10) - undoing all failed schema experiments from beta.4-9
* CHANGE: Improved cleanup error handling - only shows error after all retry attempts fail
* CHANGE: Added installed plugins logging for better debugging
* CHANGE: Platform-specific cleanup instructions (Cerbo GX vs standard)

1.0.1
* CHANGE: Cleanup previous installs and migrate plugin config, removes depricated old plugins.

1.0.0
* CHANGE: Package now released unter npmjs org noforeignland in version 1.0.0 due to deployment changes in npmjs and the need of trustworthy sources. All npmjs keys will be revoked Nov 19th, 2025. 
Users of the old (depricated) 0.1.x versions need to install this new package once manually using the Signal K Appstore. The Plugin Configuration will be kept from the 0.1.x install. 

0.2.x
* CHANGE: Deployment via OIDC authentication 
npmjs.org is revoking all deployment keys Nov 19th. The future deployment shall be via trusted publishers, so the workflow changes from publishing local -> npmjs to local -> github -> npmjs.
To fullfil this we had to deprecate the old package and deploy it under the scope of the org noforeignland in npmjs. This is the reason, why you don't see the old package anymore in the Appstore.

The "new" one has to be installed once manually, after that everything is back to normal and you are fine.

0.1.3x
* CHANGE: Working on Deployment via OIDC authentication 

0.1.29
* CHANGE: Removed unused dependency "is-reachable" in package.json

0.1.29-beta.2 
* NEW: setPluginError and error in data path if Internet Connection is not working. 

0.1.29-beta.1
* CHANGE: After talking to Treppo from Sugnal K core team we should use the data path "noforeignland.*", code and docs changed.
* CHANGE: README.md info added and format optimized
* CHANGE: GNSS source at the end for setPluginStatus - Cerbo has a long source name and truncates it.
* CHANGE: Use "npm install instead" of "npm ci" to push from Github to npmjs using OIDC authentication
* CHANGE: Moved navigation.position source from path noforeignland.status to noforeignland.source

0.1.28
* BUGFIX: No GNSS data found - introduced in 0.1.27 - Thanks Piotr

0.1.28-beta.2
* EXPERIMENTAL: Signal K data path to visualize the plugin behaviour or error in Node Red, KIP, etc. Using plugin.signalk-to-noforeignland.* for now. See README.md for details.
* CHANGE: Using app.getDataDirPath() to store transient data, thanks Jeremy, they are now in "plugin-config-data/signalk-to-noforeignland/nfl-track" and renamed to pending.json1 and sent.json1
* CHANGE: Optimize GNSS detection if multiple navigation.position from different sources exist.
* CHANGE: PluginStatus optimized for limited space available.
* CHANGE: doc/beta_install.md changed for new file structure.

0.1.28-beta.1
* CHANGE: By design SK deletes the track folder upon Pluging update via the Appstore, so we have to save the long term track in a different location, default folder: signalk-to-noforeignland-data

0.1.27
* Final version after successful testing SV MOIN and SV KIAPA NUI

0.1.27-beta.1
* NEW: NPMJS requires new method for publishing. The old tokens will expire Nov 19th, 2025, so moving to OIDC authentication.
* NEW: Check the GNSS status in navigation.position, else retry and throw PluginError on Dashboard
* CHANGE: Keep track data on disk rewritten and migrate old files to new structure, so nfl-track-sent.jsonl becomes a continuous archive of all sent track data over time, when enabled. New Logic:
    * New points accumulate in nfl-track-pending.jsonl
    * Send succeeds → API confirms receipt
    * If keepFiles=true: The content of pending file is appended to nfl-track-sent.jsonl (line 588)
    * Pending file is deleted
    * Next GNSS points → create a new pending file
    * Next successful send → appends again to the same nfl-track-sent.jsonl

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

