import { describe, expect, it } from 'vitest';
import { waitForServiceReady } from '../src/application/services/local.js';

describe('asynchronous service readiness source', () => {
  it('awaits injected bounded status reads without confusing the promise with a status snapshot', async () => {
    let clock = 100;
    const started = { state: 'starting' as const, target: 'node' as const, pid: 1234, logFile: '/isolated/node.log', statusFile: '/isolated/status-node.json', requestedAt: 100 };
    const result = await waitForServiceReady(started, {
      readStatus: async () => ({ pid: 1234, state: 'online', lastUpdated: new Date(100).toISOString() }),
      isProcessAlive: () => true, now: () => clock, wait: async (ms) => { clock += ms; },
    }, { timeoutMs: 50, pollMs: 10 });
    expect(result).toMatchObject({ state: 'ready', pid: 1234 });
  });
});
