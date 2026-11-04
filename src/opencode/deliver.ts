import { resolveDeliveryMode } from '../delivery-mode.js';
import type { DeliveryOptions } from '../delivery-mode.js';
import { openCodeSessionPath } from './client.js';
import { connectOpenCode, isRecord, openCodeError } from './service.js';
import type { OpenCodeOptions } from './service.js';

export type OpenCodeDeliveryOptions = OpenCodeOptions & DeliveryOptions;
export type OpenCodeDeliveryResult = { status: 'accepted'; messageId: string; queued: boolean };

/** Native durable inbox admission; acceptance does not claim model execution or a reply. */
export async function deliverToOpenCodeSession(id: string, content: string, options: OpenCodeDeliveryOptions = {}): Promise<OpenCodeDeliveryResult> {
  if (options.endpointType !== undefined && options.endpointType !== 'shared') throw openCodeError('INPUT_REJECTED', 'OpenCode uses a shared native service; the requested endpoint type is not supported.');
  const path = `${openCodeSessionPath(id)}/prompt`;
  const delivery = resolveDeliveryMode(options.mode);
  const connection = await connectOpenCode(options);
  const result = await connection.request(path, { text: content, delivery, resume: true });
  if (!isRecord(result) || !isRecord(result.data) || typeof result.data.id !== 'string' || result.data.id === ''
    || result.data.sessionID !== id || result.data.type !== 'user' || result.data.delivery !== delivery) {
    throw openCodeError('WRITE_UNCERTAIN', 'OpenCode input receipt did not confirm this session and delivery mode; the write was not retried.');
  }
  return { status: 'accepted', messageId: result.data.id, queued: delivery === 'queue' };
}
