import type { DeliveryOptions } from '../delivery-mode.js';
import type { DshOptions } from './client.js';
import { dshSessionPath, findDshTarget } from './client.js';
import { resolveDeliveryMode } from '../delivery-mode.js';
import { DSH_ADAPTER_MAX_BODY_BYTES } from '../limits.js';
import { dshError, isDshRecord } from './registry.js';
import { withDshOperation } from './service.js';

export type DshDeliveryOptions = DshOptions & DeliveryOptions;
export type DshDeliveryResult = { status: 'accepted'; messageId: string; queued: boolean };
export async function deliverToDshSession(id: string, content: string, options: DshDeliveryOptions = {}): Promise<DshDeliveryResult> {
  const path = dshSessionPath(id);
  const mode = resolveDeliveryMode(options.mode);
  if (typeof content !== 'string' || content.trim() === '' || Buffer.byteLength(content) > DSH_ADAPTER_MAX_BODY_BYTES) throw dshError('INPUT_REJECTED', 'Harness message must be non-empty text within the 1MiB adapter budget.');
  return withDshOperation(options, async (operation) => {
    const target = await findDshTarget(id, operation, options.endpointType);
    if (target === null) throw dshError('SESSION_NOT_FOUND', 'The exact live Harness root session does not exist; no session was created.');
    const receipt = await target.connection.request(`${path}/messages`, { text: content, mode });
    if (!isDshRecord(receipt) || receipt.accepted !== true || receipt.sessionId !== id || receipt.mode !== mode
      || typeof receipt.messageId !== 'string' || receipt.messageId === '') throw dshError('WRITE_UNCERTAIN', 'Harness did not confirm this exact input admission; the write was not retried.');
    return { status: 'accepted', messageId: receipt.messageId, queued: mode === 'queue' };
  });
}
