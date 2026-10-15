/**
 * The plugin's configuration schema: what the Admin UI renders as the settings
 * form, and the type of the configuration the server hands to start().
 */

import { Type, type Static, type TObject } from 'typebox';
import { DEFAULT_MAX_VELOCITY } from '../utils/validation';

/**
 * Values for settings the user has not set. The form shows them as defaults
 * (trackDir only in its description) and flattenConfig applies them, so the
 * two cannot disagree.
 */
export const CONFIG_DEFAULTS = {
  minMove: 80,
  minSpeed: 1.5,
  sendWhileMoving: true,
  ping_api_every_24h: true,
  maxVelocity: DEFAULT_MAX_VELOCITY,
  trackDir: 'nfl-track',
  keepFiles: false,
  trackFrequency: 60,
  apiCron: '*/10 * * * *',
  apiTimeout: 30,
} as const;

// Every property is optional: the stored configuration may lack any of them,
// and a schema without `required` lists is what the form has always rendered.
const groups = {
  mandatory: Type.Optional(
    Type.Object(
      {
        boatApiKey: Type.Optional(
          Type.String({
            title: 'Boat API Key',
            description:
              'Boat API Key from noforeignland.com. Can be found in Account > Settings > Boat tracking > API Key.',
          })
        ),
      },
      { title: 'Mandatory Settings' }
    )
  ),

  advanced: Type.Optional(
    Type.Object(
      {
        minMove: Type.Optional(
          Type.Number({
            title: 'Minimum boat move to log in meters',
            description:
              'To keep file sizes small we only log positions if a move larger than this size (if set to 0 will log every move)',
            default: CONFIG_DEFAULTS.minMove,
          })
        ),
        minSpeed: Type.Optional(
          Type.Number({
            title: 'Minimum boat speed to log in knots',
            description:
              'To keep file sizes small we only log positions if boat speed goes above this value to minimize recording position on anchor or mooring (if set to 0 will log every move)',
            default: CONFIG_DEFAULTS.minSpeed,
          })
        ),
        sendWhileMoving: Type.Optional(
          Type.Boolean({
            title: 'Attempt sending location while moving',
            description:
              'Should the plugin attempt to send tracking data to NFL while detecting the vessel is moving or only when stopped?',
            default: CONFIG_DEFAULTS.sendWhileMoving,
          })
        ),
        ping_api_every_24h: Type.Optional(
          Type.Boolean({
            title: 'Force a send every 24 hours',
            description:
              'Keeps your boat active on NFL in your current location even if you do not move',
            default: CONFIG_DEFAULTS.ping_api_every_24h,
          })
        ),
      },
      { title: 'Advanced Settings' }
    )
  ),

  expert: Type.Optional(
    Type.Object(
      {
        filterSource: Type.Optional(
          Type.String({
            title: 'Position source device',
            description:
              'EMPTY DEFAULT IS FINE - Set this value to the name of a source if you want to only use the position given by that source.',
          })
        ),
        maxVelocity: Type.Optional(
          Type.Number({
            title: 'Maximum velocity (m/s)',
            description:
              'Reject positions implying faster movement than this (catches GPS outliers). Default: 50 m/s ≈ 97 knots.',
            default: CONFIG_DEFAULTS.maxVelocity,
            minimum: 10,
            maximum: 200,
          })
        ),
        // No form default: an empty field means the default directory, which
        // the description names.
        trackDir: Type.Optional(
          Type.String({
            title: 'Directory to cache tracks',
            description:
              'EMPTY DEFAULT IS FINE - Path to store track data. Relative paths are stored in plugin data directory. Absolute paths can point anywhere.\nDefault: nfl-track',
          })
        ),
        keepFiles: Type.Optional(
          Type.Boolean({
            title: 'Keep track files on disk',
            description:
              'If you have a lot of hard drive space you can keep the track files for logging purposes.',
            default: CONFIG_DEFAULTS.keepFiles,
          })
        ),
        trackFrequency: Type.Optional(
          Type.Integer({
            title: 'Position tracking frequency in seconds',
            description:
              'To keep file sizes small we only log positions once in a while (unless you set this value to 0)',
            default: CONFIG_DEFAULTS.trackFrequency,
          })
        ),
        apiCron: Type.Optional(
          Type.String({
            title: 'Send attempt CRON',
            description:
              'We send the tracking data to NFL once in a while, you can set the schedule with this setting.\nCRON format: https://crontab.guru/',
            default: CONFIG_DEFAULTS.apiCron,
          })
        ),
        apiTimeout: Type.Optional(
          Type.Integer({
            title: 'API request timeout in seconds',
            description: 'Timeout for sending data to NFL API. Increase for slow connections.',
            default: CONFIG_DEFAULTS.apiTimeout,
            minimum: 10,
            maximum: 180,
          })
        ),
      },
      { title: 'Expert Settings' }
    )
  ),
};

export type ConfigSchema = TObject<typeof groups>;

/** The configuration as the server stores it and passes it to start(). */
export type StoredConfig = Static<ConfigSchema>;

export function configSchema(title: string): ConfigSchema {
  return Type.Object(groups, { title, description: 'Some parameters need for use' });
}
