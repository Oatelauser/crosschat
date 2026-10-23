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
});
