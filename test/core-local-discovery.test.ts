import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionReader } from '../src/application/sessions/index.js';
import { createLocalDiscoveryService } from '../src/application/discovery/local.js';

const mocks = vi.hoisted(() => ({ claude: vi.fn(), codex: vi.fn() }));
vi.mock('../src/application/sessions/claude-reader.js', () => ({ createClaudeSessionReader: mocks.claude }));
vi.mock('../src/application/sessions/codex-reader.js', () => ({ createCodexSessionReader: mocks.codex }));
function reader(providerId: string): SessionReader {
  return { providerId, capabilities: { discovery: true, delivery: false, launch: false, diagnostics: false },
    list: async ({ contextId }) => ({ items: [{ key: 'ignored', name: null, ref: { contextId, providerId, nativeId: 'opaque/full-id' }, rawStatus: 'future', capabilities: { discovery: true, delivery: false, launch: false, diagnostics: false }, attributes: { cwd: '/fixture', socketPath: 'must-not-leak' } }], completeness: 'complete', observedAt: 1, errors: [], nextCursor: null }),
    get: async () => ({ item: null, completeness: 'complete', observedAt: 1, errors: [] }),
  };
}
beforeEach(() => { vi.clearAllMocks(); mocks.claude.mockReturnValue(reader('claude')); mocks.codex.mockReturnValue(reader('codex')); });
describe('local discovery composition', () => {
  it('binds source directories to an explicitly supplied home without scanning on construction', () => {
    const home = join('fixture-root', 'home');
    createLocalDiscoveryService({ home });
    expect(mocks.claude).toHaveBeenCalledWith({ directory: join(home, '.claude', 'sessions') });
    expect(mocks.codex).toHaveBeenCalledWith({ codexHome: join(home, '.codex') });
  });
  it('accepts another registered reader through the same sanitized discovery contract', async () => {
    const service = createLocalDiscoveryService({ readers: [reader('future-provider')] });
    expect(mocks.claude).not.toHaveBeenCalled();
    expect(mocks.codex).not.toHaveBeenCalled();
    const result = await service.execute({ op: 'list' }, { contextId: 'fixture' });
    expect(result.providers.map((provider) => provider.providerId)).toEqual(['future-provider']);
    expect(JSON.stringify(result)).toContain('opaque/full-id');
    expect(JSON.stringify(result)).not.toContain('must-not-leak');
  });
});
