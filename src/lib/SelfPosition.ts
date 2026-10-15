/**
 * The own vessel's current position as the server holds it.
 */

import { Type } from 'typebox';
import { Value } from 'typebox/value';
import type { Fix, SignalKApp } from '../types';

const PositionNode = Type.Object({
  value: Type.Object({ latitude: Type.Number(), longitude: Type.Number() }),
  timestamp: Type.String(),
  $source: Type.Optional(Type.String()),
});

export interface SelfPosition {
  fix: Fix;
  /** The source the server chose for navigation.position, by its source priority. */
  source: string | null;
}

/** navigation.position of the own vessel, or null when there is none or it is malformed. */
export function readSelfPosition(app: SignalKApp): SelfPosition | null {
  const node = app.getSelfPath('navigation.position');
  if (!Value.Check(PositionNode, node)) {
    return null;
  }
  const time = Date.parse(node.timestamp);
  if (Number.isNaN(time)) {
    return null;
  }
  return {
    fix: { time, latitude: node.value.latitude, longitude: node.value.longitude },
    source: node.$source ?? null,
  };
}
