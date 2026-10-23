import type { DeliveryOptions } from '../delivery-mode.js';
import type { DshOptions } from './client.js';

export type DshDeliveryOptions = DshOptions & DeliveryOptions;
export type DshDeliveryResult = { status: 'accepted'; messageId: string; queued: boolean };
export async function deliverToDshSession(_id: string, _content: string, _options: DshDeliveryOptions = {}): Promise<DshDeliveryResult> { throw new Error('DSH adapter not implemented'); }
