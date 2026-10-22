import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionReader } from '../src/application/sessions/index.js';
import { createLocalDiscoveryService } from '../src/application/discovery/local.js';

const mocks = vi.hoisted(() => ({ claude: vi.fn(), codex: vi.fn(), session: vi.fn(), sessionFactory: vi.fn() }));
vi.mock('../src/application/sessions/claude-reader.js', () => ({ createClaudeSessionReader: mocks.claude }));
vi.mock('../src/application/sessions/codex-reader.js', () => ({ createCodexSessionReader: mocks.codex }));
vi.mock('../src/codex/client.js', () => ({ openCodexSession: mocks.session }));
function reader(providerId: string): SessionReader {
  return { providerId, capabilities: { discovery: true, delivery: false, launch: false, diagnostics: false },
    list: async ({ contextId }) => ({ items: [{ key: 'ignored', name: null, ref: { contextId, providerId, nativeId: 'opaque/full-id' }, rawStatus: 'future', capabilities: { discovery: true, delivery: false, launch: false, diagnostics: false }, attributes: { cwd: '/fixture', socketPath: 'must-not-leak' } }], completeness: 'complete', observedAt: 1, errors: [], nextCursor: null }),
    get: async () => ({ item: null, completeness: 'complete', observedAt: 1, errors: [] }),
  };
}
beforeEach(() => { vi.clearAllMocks(); mocks.claude.mockReturnValue(reader('claude')); mocks.codex.mockReturnValue(reader('codex')); mocks.session.mockReturnValue(mocks.sessionFactory); });
afterEach(() => vi.unstubAllEnvs());
describe('local discovery composition', () => {
  it('binds source directories to an explicitly supplied home without scanning on construction', () => {
    const home = join('fixture-root', 'home');
    vi.stubEnv('CODEX_HOME', 'parent-codex-home');
    vi.stubEnv('CODEX_SQLITE_HOME', undefined);
    vi.stubEnv('codex_sqlite_home', 'parent-mixed-case-sqlite-home');
    createLocalDiscoveryService({ home });
    expect(mocks.claude).toHaveBeenCalledWith({ directory: join(home, '.claude', 'sessions') });
    expect(mocks.codex).toHaveBeenCalledWith({ codexHome: join(home, '.codex'), desktop: { sqliteHome: join(home, '.codex') }, sessionFactory: mocks.sessionFactory });
    expect(mocks.session.mock.calls[0]?.[0].env.CODEX_HOME).toBe(join(home, '.codex'));
    expect(Object.keys(mocks.session.mock.calls[0]?.[0].env ?? {}).some((key) => key.toUpperCase() === 'CODEX_SQLITE_HOME')).toBe(false);
    expect(mocks.sessionFactory).not.toHaveBeenCalled();
    expect(process.env.CODEX_HOME).toBe('parent-codex-home');
    expect(process.env.codex_sqlite_home).toBe('parent-mixed-case-sqlite-home');
  });
  it('retains native environment selection when no isolated home was supplied', () => {
    vi.stubEnv('CODEX_HOME', 'parent-codex-home');
    vi.stubEnv('CODEX_SQLITE_HOME', 'parent-sqlite-home');
    createLocalDiscoveryService();
    expect(mocks.claude).toHaveBeenCalledWith({});
    expect(mocks.codex).toHaveBeenCalledWith({});
    expect(mocks.session).not.toHaveBeenCalled();
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
