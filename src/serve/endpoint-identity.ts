import { decodeOriginIdentity } from '../federation.js';
import { decodeRef } from '../ref.js';
import type { SendFrame } from './protocol.js';

/** Every endpoint carried by a send must survive both broker and destination. */
export function sendRequiresEndpointTypes(frame: SendFrame): boolean {
  if (frame.tool !== undefined) return true;
  if (frame.conversation !== undefined) {
    try {
      const ref = decodeRef(frame.conversation);
      if ((ref.f.p !== 'human' && ref.f.endpointType !== undefined)
        || (ref.t.p !== 'human' && ref.t.endpointType !== undefined)) return true;
    } catch { /* The receiving application retains authority over malformed reference diagnostics. */ }
  }
  if (frame.origin !== undefined) {
    try {
      const origin = decodeOriginIdentity(frame.origin);
      if (origin.p !== 'human' && origin.endpointType !== undefined) return true;
    } catch { /* Do not replace the existing malformed-origin error with a capability error. */ }
  }
  return false;
}
