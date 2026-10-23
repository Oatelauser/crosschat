import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLocalDiscoveryService } from '../src/application/discovery/local.js';
import type { SessionReader } from '../src/application/sessions/model.js';

const mocks = vi.hoisted(() => ({ reader: vi.fn() }));
vi.mock('../src/application/sessions/opencode-reader.js', () => ({ createOpenCodeSessionReader: mocks.reader }));
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
describe('OpenCode source composition', () => {
  it('registers the source without reading it and isolates explicit HOME from parent overrides', () => {
    const fake: SessionReader = { providerId: 'opencode', capabilities: { discovery: true, delivery: true, launch: false, diagnostics: false }, list: vi.fn(), get: vi.fn() };
    mocks.reader.mockReturnValue(fake);
    vi.stubEnv('CROSSCHAT_OPENCODE_URL', 'http://127.0.0.1:1');
    vi.stubEnv('XDG_STATE_HOME', 'parent-state');
    const home = join('fixture', 'home');
    createLocalDiscoveryService({ home });
    expect(mocks.reader).toHaveBeenCalledTimes(1);
    expect(mocks.reader.mock.calls[0][0].home).toBe(home);
    expect(mocks.reader.mock.calls[0][0].env).not.toHaveProperty('CROSSCHAT_OPENCODE_URL');
    expect(mocks.reader.mock.calls[0][0].env.XDG_STATE_HOME).toBe(join(home, '.local', 'state'));
    expect(fake.list).not.toHaveBeenCalled();
  });
  it('keeps an uninstalled optional source from making legacy discovery incomplete', async () => {
    mocks.reader.mockReturnValue({ providerId: 'opencode', capabilities: { discovery: true, delivery: true, launch: false, diagnostics: false },
      list: async () => ({ items: [], nextCursor: null, completeness: 'unavailable', observedAt: 1,
        errors: [{ source: { contextId: 'local', providerId: 'opencode' }, kind: 'missing', message: 'No running OpenCode service is registered.' }] }),
      get: vi.fn(),
    });
    const result = await createLocalDiscoveryService({ home: join('fixture', 'home') }).execute({ op: 'list', filter: { providerIds: ['opencode'] } });
    expect(result.op === 'list' && result.page.completeness).toBe('complete');
    expect(result.op === 'list' && result.page.errors).toEqual([]);
  });
  it('keeps configured OpenCode failures visible', async () => {
    mocks.reader.mockReturnValue({ providerId: 'opencode', capabilities: { discovery: true, delivery: true, launch: false, diagnostics: false },
      list: async () => ({ items: [], nextCursor: null, completeness: 'unavailable', observedAt: 1,
        errors: [{ source: { contextId: 'local', providerId: 'opencode' }, kind: 'unavailable', message: 'Service could not be reached.' }] }),
      get: vi.fn(),
    });
    const result = await createLocalDiscoveryService({ home: join('fixture', 'home') }).execute({ op: 'list', filter: { providerIds: ['opencode'] } });
    expect(result.op === 'list' && result.page.completeness).toBe('unavailable');
  });
  it('proves absence through default detail reads when OpenCode is uninstalled', async () => {
    const missing = { item: null, completeness: 'unavailable', observedAt: 1,
      errors: [{ source: { contextId: 'local', providerId: 'opencode' }, kind: 'missing', message: 'No running OpenCode service is registered.' }] };
    mocks.reader.mockReturnValue({ providerId: 'opencode', capabilities: { discovery: true, delivery: true, launch: false, diagnostics: false }, list: vi.fn(), get: async () => missing });
    const result = await createLocalDiscoveryService({ home: join('fixture', 'home') }).execute({ op: 'detail', providerId: 'opencode', nativeId: 'legacy-native-id' });
    expect(result.op === 'detail' && result.detail).toMatchObject({ item: null, completeness: 'complete', errors: [] });
  });
});
