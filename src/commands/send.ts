import { sendMessage } from '../application/send/index.js';
import { formatSendResult } from '../application/send/format.js';
import type { SendArgs, SendDeps } from '../application/send/types.js';

export type { SendArgs, SendDeps } from '../application/send/types.js';
export { pickAutoVia } from '../application/send/index.js';
export { DEFAULT_MAX_BODY_BYTES as MAX_BODY_BYTES } from '../limits.js';

/** Compatibility command boundary; application callers use sendMessage directly. */
export async function runSend(args: SendArgs, deps: SendDeps): Promise<string> {
  return formatSendResult(await sendMessage(args, deps), args.json === true);
}
