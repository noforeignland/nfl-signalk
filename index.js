
const { EOL } = require('os');
const internetTestAddress = 'google.com';
const internetTestTimeout = 1000;
const fs = require('fs-extra');
const path = require('path');
const CronJob = require('cron').CronJob;
const readline = require('readline');
const fetch = require('node-fetch');
const isReachable = require('is-reachable');
const sendEmail = require('./sendEmail');
const createGPX = require('./createGPX');
const defaultApiUrl = 'https://www.noforeignland.com/home/api/v1/boat/tracking/track';
const pluginApiKey = '0ede6cb6-5213-45f5-8ab4-b4836b236f97';
// const msToKn = 1.944;


module.exports = function(app) {
	var plugin = {};
	plugin.id = 'signalk-to-noforeignland-beta';
	plugin.name = 'SignalK to Noforeignland-beta';
	plugin.description = 'SignalK track logger to noforeignland.com';

	plugin.schema = {
		"title": plugin.name,
		"description": "Some parameters need for use",
		"type": "object",
		"required": ["emailCron", "boatApiKey"],
		"properties": {
			"trackFrequency": {
				"type": "integer",
				"title": "Position tracking frequency in seconds.",
				"description": "To keep file sizes small we only log positions once in a while (unless you set this value to 0)",
				"default": 60
			},
			"minMove": {
				"type": "number",
				"title": "Minimum boat move to log in meters",
				"description": "To keep file sizes small we only log positions if a move larger than this size is noted (if set to 0 will log every move)",
				"default": 50
			},
			"minSpeed": {
				"type": "number",
				"title": "Minimum boat speed to log in knots",
				"description": "To keep file sizes small we only log positions if boat speed goes above this value to minimize recording position on anchor or mooring (if set to 0 will log every move)",
				"default": 1.5
			},
			"emailCron": {
				"type": "string",
				"title": "Send attempt CRON",
				"description": "We send the tracking data to NFL once in a while, you can set the schedule with this setting. CRON format: https://crontab.guru/",
				"default": '*/10 * * * *',
			},
			'boatApiKey': {
				"type": "string",
				"title": "Boat API key",
				"description": "Boat API key from noforeignland.com. Can be found in Account > Settings > Boat tracking > API Key. *required only in API method is set*",
			},
			"internetTestTimeout": {
				"type": "number",
				"title": "Timeout for testing internet connection in ms",
				"description": "Set this number higher for slower computers and internet connections",
				"default": 2000,
			},
			"sendWhileMoving": {
				"type": "boolean",
				"title": "Attempt sending location while moving",
				"description": "Should the plugin attempt to send tracking data to NFL while detecting the vessel is moving or only when stopped?",
				"default": false
			},
			"filterSource": {
				"type": "string",
				"title": "Position source device",
				"description": "Set this value to the name of a source if you want to only use the position given by that source.",
			},
			"trackDir": {
				"type": "string",
				"title": "Directory to cache tracks.",
				"description": "Path in server filesystem, absolute or from plugin directory. optional param (only used to keep file cache).",
			},
			"keepFiles": {
				"type": "boolean",
				"title": "Should keep track files on disk?",
				"description": "If you have a lot of hard drive space you can keep the track files for logging purposes.",
				"default": false
			},
			"ping": {
				"type": "boolean",
				"title": "Should I force a send every 24 hours",
				"description": "Keeps your boat active on NFL in your current location even if you do not move",
				"default": true
			},
			"defaultApiUrl": {
			  "type": "string",
			  "title": "NFL tracking API endpoint",
			  "description": "Change only if NFL gives you a different endpoint.",
			  "default": defaultApiUrl
			}

		}
	};

	var unsubscribes = [];
	var unsubscribesControl = [];
	var routeSaveName = 'nfl-track.jsonl';
	let lastPosition;
	let upSince;
	let cron;
	const creator = 'signalk-track-logger';
	const defaultTracksDir = 'track';

	let initialSent = false;
	let lastSentTime = 0;

	// const maxAllowedSpeed = 100;

	plugin.start = function(options, restartPlugin) {
		if (!options.trackDir) options.trackDir = defaultTracksDir;
		if (!path.isAbsolute(options.trackDir)) options.trackDir = path.join(__dirname, options.trackDir);
		//app.debug('options.trackDir=',options.trackDir);
		if (!createDir(options.trackDir)) {
			plugin.stop();
			return;
		}

		app.debug('track logger started, now logging to', options.trackDir);
		app.setPluginStatus(`Started`);

		doLogging();

		function doLogging() {
			let shouldDoLog = true
			//subscribe for position
			app.subscriptionmanager.subscribe({
				"context": "vessels.self",
				"subscribe": [
					{
						"path": "navigation.position",
						"format": "delta",
						"policy": "instant",
						"minPeriod": options.trackFrequency ? options.trackFrequency * 1000 : 0,
					}
				]
			},
				unsubscribes,
				subscriptionError => {
					app.debug('Error subscription to data:' + subscriptionError);
					app.setPluginError('Error subscription to data:' + subscriptionError.message);
				},
				doOnValue
			);

			//subscribe for speed
			if (options.minSpeed) {
				app.subscriptionmanager.subscribe({
					"context": "vessels.self",
					"subscribe": [
						{
							"path": "navigation.speedOverGround",
							"format": "delta",
							"policy": "instant",
						}
					]
				},
					unsubscribes,
					subscriptionError => {
						app.debug('Error subscription to data:' + subscriptionError);
						app.setPluginError('Error subscription to data:' + subscriptionError.message);
					},
					delta => {
						// app.debug('got speed delta', delta);
						delta.updates.forEach(update => {
							// app.debug(`update:`, update);
							if (options.filterSource && update.$source !== options.filterSource) {
								return;
							}
							update.values.forEach(value => {
								// value.value is sog in m/s so 'sog*2' is in knots
								if (!shouldDoLog && options.minSpeed < value.value * 2) {
									app.debug('setting shouldDoLog to true');
									shouldDoLog = true;
								}
							})
						})
					}
				);
			}

			async function doOnValue(delta) {

				for (update of delta.updates) {
					// app.debug(`update:`, update);
					if (options.filterSource && update.$source !== options.filterSource) {
						return;
					}
					let timestamp = update.timestamp;
					for (value of update.values) {


						if (
							Math.abs(value.value.latitude) <= 0.01 &&
							Math.abs(value.value.longitude) <= 0.01
						) {
							// Coordinates are within ±0.1 of (0,0)
							return;
						}

						// app.debug(`value:`, value);

						if (!shouldDoLog) {
							return;
						}
						if (!isValidLatitude(value.value.latitude) || !isValidLongitude(value.value.longitude)) {
							return;
						}


						if (lastPosition) {
							if (new Date(lastPosition.timestamp).getTime() > new Date(timestamp).getTime()) {
								app.debug('got error in timestamp:', timestamp, 'is earlier than previous:', lastPosition.timestamp);
								// SK sometimes messes up timestamps, when that happens we throw the update
								return;
							}
							const distance = equirectangularDistance(lastPosition.pos, value.value)
							if (options.minMove && distance < options.minMove) {
								return;
							}
							// if (calculatedSpeed(distance, (timestamp - lastPosition.timestamp) / 1000) > maxAllowedSpeed) {
							//   app.debug('got error position', value.value, 'ignoring...');
							//   return;
							// }
						}
						lastPosition = { pos: value.value, timestamp, currentTime: new Date().getTime() };

						await savePoint(lastPosition);
						if (options.minSpeed) {
							app.debug('setting shouldDoLog to false');
							shouldDoLog = false;
						}
						if (!initialSent) {
							initialSent = true;
							app.debug('sending initial fix');
							if (await testInternet()) {
								await sendData();
								lastSentTime = Date.now();
							}
						}




					};
				};
			}
		}

		async function savePoint(point) {
			//{pos: {latitude, longitude}, timestamp}
			// Date.parse(timestamp)
			const obj = {
				lat: point.pos.latitude,
				lon: point.pos.longitude,
				t: point.timestamp,
			}
			app.debug(`save data point:`, obj);
			await fs.appendFile(path.join(options.trackDir, routeSaveName), JSON.stringify(obj) + EOL);
		}

		function isValidLatitude(obj) {
			return isDefinedNumber(obj) && obj > -90 && obj < 90
		}

		function isValidLongitude(obj) {
			return isDefinedNumber(obj) && obj > -180 && obj < 180
		}

		function isDefinedNumber(obj) {
			return (obj !== undefined && obj !== null && typeof obj === 'number');
		}

		// function calculatedSpeed(distance, timeSecs) {
		//   // m/s to knots ~= speedinms * 1.944
		//   return (distance / timeSecs) * msToKn
		// }

		function equirectangularDistance(from, to) {
			// https://www.movable-type.co.uk/scripts/latlong.html
			// from,to: {longitude: xx, latitude: xx}
			const rad = Math.PI / 180;
			const φ1 = from.latitude * rad;
			const φ2 = to.latitude * rad;
			const Δλ = (to.longitude - from.longitude) * rad;
			const R = 6371e3;
			const x = Δλ * Math.cos((φ1 + φ2) / 2);
			const y = (φ2 - φ1);
			const d = Math.sqrt(x * x + y * y) * R;
			return d;
		}

		function createDir(dir) {
			let res = true;
			if (fs.existsSync(dir)) {
				try {
					fs.accessSync(dir, fs.constants.R_OK | fs.constants.W_OK);
				}
				catch (error) {
					app.debug('[createDir]', error.message);
					app.setPluginError(`No rights to directory ${dir}`);
					res = false;
				}
			}
			else {
				try {
					fs.mkdirSync(dir, { recursive: true });
				}
				catch (error) {
					switch (error.code) {
						case 'EACCES':	// Permission denied
						case 'EPERM':	// Operation not permitted
							app.debug(`False to create ${dir} by Permission denied`);
							app.setPluginError(`False to create ${dir} by Permission denied`);
							res = false;
							break;
						case 'ETIMEDOUT':	// Operation timed out
							app.debug(`False to create ${dir} by Operation timed out`);
							app.setPluginError(`False to create ${dir} by Operation timed out`);
							res = false;
							break;
					}
				}
			}
			return res;
		} // end function createDir

		async function interval() {
			const now = Date.now();
			const twentyFourHrs = 24 * 3600 * 1000;

			if (options.ping && (!lastSentTime || now - lastSentTime >= twentyFourHrs)) {
				app.debug('24 hrs elapsed since last send, pushing periodic fix');
				if (await testInternet()) {
					await sendData();
					lastSentTime = now;
				}
				return;
			}

			if (checkBoatMoving() && await checkTrack() && await testInternet()) {
				await sendData();
				lastSentTime = now;
			}
		}





		function checkBoatMoving() {
			if (options.sendWhileMoving || !options.trackFrequency) {
				return true;
			}
			const time = lastPosition ? lastPosition.currentTime : upSince;

			const secsSinceLastPoint = (new Date().getTime() - time) / 1000
			if (secsSinceLastPoint > (options.trackFrequency * 2)) {
				app.debug('Boat stopped moving, last move at least', secsSinceLastPoint, 'seconds ago');
				return true;
			} else {
				app.debug('Boat is still moving, last move', secsSinceLastPoint, 'seconds ago');
				return false;
			}
		}

		async function testInternet() {
			app.debug('testing internet connection');
			const check = await isReachable(internetTestAddress, { timeout: options.internetTestTimeout || internetTestTimeout });
			app.debug('internet connection = ', check);
			return check;
		}

		async function checkTrack() {
			const trackFile = path.join(options.trackDir, routeSaveName);
			app.debug('checking the track', trackFile, 'if should send');
			const exists = await fs.pathExists(trackFile);
			const size = exists ? (await fs.lstat(trackFile)).size : 0;
			app.debug(`'${trackFile}'.size=${size} ${trackFile}'.exists=${exists}`);
			return size > 0;
		}

		async function sendData() {
			if (options.boatApiKey) {
				sendApiData();
			} else {
				sendEmailData();
			}
		}

		async function sendApiData() {
			const url = options.apiUrl || defaultApiUrl;   

			app.debug('sending the data');
			const trackData = await createTrack(path.join(options.trackDir, routeSaveName));
			if (!trackData) {
				app.debug('Recorded track did not contain any valid track points, aborting sending.');
				return;
			}
			app.debug('created track data with timestamp:', new Date(trackData.timestamp));

			const params = new URLSearchParams();
			params.append('timestamp', trackData.timestamp);
			params.append('track', JSON.stringify(trackData.track));
			params.append('boatApiKey', options.boatApiKey);

			const headers = {
				'X-NFL-API-Key': pluginApiKey
			}

			app.debug('sending track to API');
			try {
				const response = await fetch(url, { method: 'POST', body: params, headers: new fetch.Headers(headers) });
				if (response.ok) {
					const responseBody = await response.json();
					if (responseBody.status === 'ok') {
						app.debug('Track successfully sent to API');
						if (options.keepFiles) {
							const filename = new Date().toJSON().slice(0, 19).replace(/:/g, '') + '-nfl-track.jsonl';
							app.debug('moving and keeping track file: ', filename);
							await fs.move(path.join(options.trackDir, routeSaveName), path.join(options.trackDir, filename));
						} else {
							app.debug('Deleting track file');
							await fs.remove(path.join(options.trackDir, routeSaveName));
						}
					} else {
						app.debug('Could not send track to API, returned response json:', responseBody);
					}
				} else {
					app.debug('Could not send track to API, returned response code:', response.status, response.statusText);
				}
			} catch (err) {
				app.debug('Could not send track to API due to error:', err);
			}
		}

		async function createTrack(inputPath) {
			const fileStream = fs.createReadStream(inputPath);

			const rl = readline.createInterface({
				input: fileStream,
				crlfDelay: Infinity
			});
			const track = []
			let lastTimestamp;
			for await (const line of rl) {
				if (line) {
					try {
						const point = JSON.parse(line);

						const timestamp = new Date(point.t).getTime();
						if (!isNaN(timestamp) && isValidLatitude(point.lat) && isValidLongitude(point.lon)) {
							track.push([timestamp, point.lat, point.lon]);
							lastTimestamp = timestamp;
						}

					} catch (error) {
						app.debug('could not parse line from track file:', line);
					}
				}
			}
			if (track.length > 0) {
				return { timestamp: new Date(lastTimestamp).getTime(), track };
			}
		}

		async function sendEmailData() {
			app.debug('sending the data');
			const gpxFiles = await createGPX({ input: path.join(options.trackDir, routeSaveName), outputDir: options.trackDir, creator });
			app.debug('created GPX files', gpxFiles);
			try {
				for (let file of gpxFiles) {
					app.debug('sending', file);
					try {
						!await sendEmail({
							emailService: options.emailService,
							user: options.emailUser,
							password: options.emailPassword,
							from: options.emailFrom,
							to: options.emailTo,
							trackFile: file
						})
					} catch (err) {
						app.debug('Sending email failed:', err);
						return;
					}
				}
			} finally {
				for (let file of gpxFiles) {
					app.debug('deleting', file);
					await fs.rm(file);
				}
			}
			await fs.rm(path.join(options.trackDir, routeSaveName));
		}
		//every 10 minute but staggered to the second so we don't all send at once.
		if (!options.emailCron || options.emailCron === '*/10 * * * *') {
			const startMinute = Math.floor(Math.random() * 10);  // Random minute within the 10-minute range
			const startSecond = Math.floor(Math.random() * 60);  // Random second within the minute
			options.emailCron = `${startSecond} ${startMinute}/10 * * * *`;  // Every 10 minutes, starting at a random minute and second within each 10-minute block
		}

		upSince = new Date().getTime();

		app.debug('Setting CRON to ', options.emailCron);
		cron = new CronJob(
			options.emailCron,
			interval
		);
		cron.start();
	}; 	// end plugin.start

	plugin.stop = function() {
		app.debug('plugin stopped');
		if (cron) {
			cron.stop();
			cron = undefined;
		}
		unsubscribesControl.forEach(f => f());
		unsubscribesControl = [];
		unsubscribes.forEach(f => f());
		unsubscribes = [];
		app.setPluginStatus('Plugin stopped');
	}; // end plugin.stop


	return plugin;
};
