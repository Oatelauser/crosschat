import { MultichatError } from './errors.js';

/** Delivery intent belongs to one message; conversation references never retain it. */
export type DeliveryMode = 'queue' | 'steer';

export interface DeliveryOptions {
  mode?: DeliveryMode;
}

export function isDeliveryMode(value: unknown): value is DeliveryMode {
  return value === 'queue' || value === 'steer';
}

export function resolveDeliveryMode(value: unknown = undefined): DeliveryMode {
  if (value === undefined) return 'queue';
  if (isDeliveryMode(value)) return value;
  throw new MultichatError('USAGE', '--delivery must be queue or steer.');
}
