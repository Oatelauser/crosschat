import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, isAbsolute, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ home: '', list: vi.fn(), deliver: vi.fn() }));
vi.mock('node:os', async (original) => ({ ...await original<typeof import('node:os')>(), homedir: () => mocks.home }));
vi.mock('../src/dsh/client.js', () => ({ listDshThreads: mocks.list }));
vi.mock('../src/dsh/deliver.js', () => ({ deliverToDshSession: mocks.deliver }));
vi.mock('../src/claude/registry.js', () => ({ listClaudeSessions: () => ({ sessions: [], malformed: 0 }) }));
vi.mock('../src/codex/discovery.js', () => ({ listCodexThreads: async () => [], diagnoseCodexTarget: vi.fn() }));
vi.mock('../src/opencode/client.js', () => ({ listOpenCodeThreads: async () => [] }));
import { main, parseStatusArgs } from '../src/cli.js';

let output: string[];
beforeEach(() => {
  mocks.home = mkdtempSync(join(tmpdir(), 'crosschat-dsh-cli-'));
  mocks.list.mockReset().mockResolvedValue([{ id: 'native-session', name: 'Worker', cwd: '', rawStatus: { type: 'idle' }, attributes: {} }]);
  mocks.deliver.mockReset().mockResolvedValue({ status: 'accepted', messageId: 'message-one', queued: false });
  output = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((value) => { output.push(String(value)); return true; });
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  for (const key of ['CODEX_THREAD_ID', 'CODEX_SESSION_ID', 'CLAUDE_CODE_MESSAGING_SOCKET', 'OPENCODE_SESSION_ID', 'CROSSCHAT_OPENCODE_SESSION_ID', 'DSH_SESSION_ID']) vi.stubEnv(key, '');
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); rmSync(mocks.home, { recursive: true, force: true }); });

describe('DeepSeek Harness CLI composition', () => {
  it('accepts a mutually exclusive main-view status section', () => {
    expect(parseStatusArgs(['--dsh']).filters?.section).toBe('dsh');
    expect(() => parseStatusArgs(['--dsh', '--codex'])).toThrow();
    expect(() => parseStatusArgs(['--dsh', '--conversations'])).toThrow();
  });

  it('connects real status dependencies to the Harness native reader', async () => {
    expect(await main(['status', '--dsh', '--json'])).toBe(0);
    expect(mocks.list).toHaveBeenCalledOnce();
    expect(JSON.parse(output.join(''))).toMatchObject({ dsh: [{ id: 'native-session' }] });
  });

  it('connects real send dependencies to Harness delivery with an explicit mode', async () => {
    expect(await main(['send', '--to', 'dsh/native-session', '--delivery', 'steer', '--body', 'hello'])).toBe(0);
    expect(mocks.deliver).toHaveBeenCalledWith('native-session', expect.stringContaining('hello'), { mode: 'steer' });
  });

  it('prints the packaged bridge path without reading native state or writing configuration', async () => {
    expect(await main(['dsh-bridge-path'])).toBe(0);
    const path = output.join('').trim();
    expect(isAbsolute(path)).toBe(true);
    expect(normalize(path)).toBe(normalize(fileURLToPath(new URL('../integrations/dsh', import.meta.url))));
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.deliver).not.toHaveBeenCalled();
    expect(existsSync(join(mocks.home, '.crosschat'))).toBe(false);
    expect(await main(['dsh-bridge-path', '--unexpected'])).toBe(1);
  });
});
