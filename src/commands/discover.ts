import { parseDiscoveryRequest } from '../application/discovery/index.js';
import type { DiscoveryEndpoint, DiscoveryResponse } from '../application/discovery/index.js';
import { createLocalDiscoveryService } from '../application/discovery/local.js';
export { createLocalDiscoveryService };

/** JSON command adapter; entry points own stdin/stdout and never invoke status or repair. */
export async function runDiscover(input?: string, deps: { service: DiscoveryEndpoint } = { service: createLocalDiscoveryService() }, options: { signal?: AbortSignal } = {}): Promise<DiscoveryResponse> {
  let value: unknown = { op: 'list' };
  if (input !== undefined && input.trim() !== '') {
    try { value = JSON.parse(input); }
    catch { throw new Error('discover expects one JSON request on stdin.'); }
  }
  return deps.service.execute(parseDiscoveryRequest(value), { contextId: 'local', signal: options.signal });
}
