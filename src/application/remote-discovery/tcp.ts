import { randomUUID } from 'node:crypto';
import { SenderConn } from '../../serve/via-tcp.js';
import type { BrokerEntry } from '../../serve/node-config.js';
import { completeRemoteDiscoveryResponse, discoveryFailure, parseDiscoveryRequest, prepareRemoteDiscoveryRequest } from '../discovery/index.js';
import type { DiscoveryEndpoint } from '../discovery/model.js';

export interface TcpDiscoveryOptions {
  broker: BrokerEntry;
  targetMachine: string;
  timeoutMs?: number;
  /** Selects challenge authentication for an existing star-admin credential. */
  admin?: boolean;
}

/** One read owns one transient connection. Cancellation releases both ends of the read. */
export function createTcpDiscoveryClient(options: TcpDiscoveryOptions): DiscoveryEndpoint {
  const { broker, targetMachine } = options;
  if (targetMachine.length === 0 || !Number.isInteger(broker.port) || broker.port < 1 || broker.port > 65535 || broker.host.length === 0) throw new Error('Invalid TCP discovery target.');
  const timeoutMs = options.timeoutMs ?? 120_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('Invalid TCP discovery timeout.');
  if (options.admin === true && !broker.adminKey) throw new Error('Star admin credential is required.');
  const host = broker.host.includes(':') && !broker.host.startsWith('[') ? `[${broker.host}]` : broker.host;
  const url = `ws://${host}:${broker.port}`;
  const target = JSON.stringify([url, broker.starId ?? null, targetMachine]);
  return {
    async execute(input, requestOptions = {}) {
      const request = parseDiscoveryRequest(input);
      const contextId = requestOptions.contextId ?? `tcp:${broker.starId ?? broker.host}:${targetMachine}`;
      const scope = { contextId, target };
      const { signal } = requestOptions;
      if (signal?.aborted) return discoveryFailure(request, contextId, 'cancelled', 'Discovery cancelled.');
      let remote;
      try { remote = prepareRemoteDiscoveryRequest(request, scope); }
      catch { return discoveryFailure(request, contextId, 'invalid-cursor', 'Cursor does not belong to this discovery target and filter.'); }
      let conn: SenderConn | undefined;
      const id = randomUUID();
      const abort = (): void => {
        if (conn === undefined) return;
        void conn.send({ op: 'discover-cancel', id });
        conn.close();
      };
      try {
        conn = options.admin === true
          ? await SenderConn.openAdmin(url, broker.adminKey!, timeoutMs, signal)
          : await SenderConn.open(url, broker.key, undefined, timeoutMs, signal);
        if (broker.starId !== undefined && conn.starId !== broker.starId) throw new Error('Unexpected star identity.');
        signal?.addEventListener('abort', abort, { once: true });
        signal?.throwIfAborted();
        await conn.send({ op: 'discover-query', id, targetMachine, request: remote });
        const frame = await conn.waitFor((f) => (f.op === 'discover-result' || f.op === 'error') && f.id === id || f.op === 'credential-revoked', timeoutMs);
        if (signal?.aborted) return discoveryFailure(request, contextId, 'cancelled', 'Discovery cancelled.');
        if (frame.op !== 'discover-result' || !frame.ok) return discoveryFailure(request, contextId, 'unavailable', 'TCP discovery is unavailable for this target or credential.');
        try { return completeRemoteDiscoveryResponse(frame.result, request, scope); }
        catch { return discoveryFailure(request, contextId, 'malformed', 'TCP discovery returned invalid metadata.'); }
      } catch {
        return discoveryFailure(request, contextId, signal?.aborted ? 'cancelled' : 'unavailable', signal?.aborted ? 'Discovery cancelled.' : 'TCP discovery connection failed.');
      } finally {
        signal?.removeEventListener('abort', abort);
        // Close also cancels a timed-out read at the broker; never silently retry it.
        conn?.close();
      }
    },
  };
}
