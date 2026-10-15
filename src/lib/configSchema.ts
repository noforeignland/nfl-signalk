/**
 * The plugin's configuration schema: what the Admin UI renders as the settings
 * form, and the type of the configuration the server hands to start().
 */

import { Type, type Static, type TObject } from 'typebox';

/**
 * Values for settings the user has not set. The form shows them as defaults
 * and flattenConfig applies them, so the two cannot disagree.
 */
export const CONFIG_DEFAULTS = {
  minMove: 80,
  minSpeed: 1.5,
  sendWhileMoving: true,
  ping_api_every_24h: true,
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
            title: 'Minimum boat move to upload in meters',
            description:
              'A position is only sent to noforeignland.com when the boat has moved at least this far since the last one sent (0 sends every position)',
            default: CONFIG_DEFAULTS.minMove,
          })
        ),
        minSpeed: Type.Optional(
          Type.Number({
            title: 'Minimum boat speed to upload in knots',
            description:
              'A position is only sent when the boat was moving at least this fast as it was recorded, which leaves out swinging at anchor or on a mooring (0 disables the check)',
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
        trackFrequency: Type.Optional(
          Type.Integer({
            title: 'Minimum time between uploaded positions in seconds',
            description:
              'The Tracks plugin records a position every minute by default. Uploaded positions are kept at least this far apart (0 sends every recorded position)',
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
