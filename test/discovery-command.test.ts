import { describe, expect, it, vi } from 'vitest';
import { runDiscover } from '../src/commands/discover.js';

describe('discover JSON command adapter', () => {
  it('defaults empty stdin to a complete local list and passes parsed request plus cancellation to its injected service', async () => {
    const response = { op: 'list' as const, providers: [], page: { items: [], nextCursor: null, completeness: 'complete' as const, errors: [], observedAt: 1 } };
    const execute = vi.fn(async () => response);
    const signal = new AbortController().signal;
    expect(await runDiscover(undefined, { service: { execute } }, { signal })).toEqual(response);
    expect(execute).toHaveBeenCalledWith({ op: 'list' }, { contextId: 'local', signal });
    await runDiscover(' {"op":"list","limit":21} ', { service: { execute } });
    expect(execute).toHaveBeenLastCalledWith({ op: 'list', limit: 21 }, { contextId: 'local', signal: undefined });
  });

  it('rejects malformed JSON before reading providers and writes nothing to stdout', async () => {
    const execute = vi.fn();
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await expect(runDiscover('{broken', { service: { execute } })).rejects.toThrow();
      expect(execute).not.toHaveBeenCalled();
      expect(log).not.toHaveBeenCalled();
    } finally { log.mockRestore(); }
  });
});
