import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runServe } from '../src/commands/serve.js';
import type { ServeArgs, ServeDeps } from '../src/commands/serve.js';
import { executeRemoteManagement } from '../src/application/management/remote.js';

vi.mock('../src/application/management/remote.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/application/management/remote.js')>(),
  executeRemoteManagement: vi.fn(),
}));

const roots: string[] = [];
function fixture(): { deps: ServeDeps; lines: string[] } {
  const baseDir = mkdtempSync(join(tmpdir(), 'crosschat-remote-format-'));
  roots.push(baseDir);
  mkdirSync(join(baseDir, 'tcp'));
  writeFileSync(join(baseDir, 'tcp', 'node.json'), JSON.stringify({ brokers: [
    { host: 'fixture-host', port: 7260, name: 'cloud', key: 'fixture-member-key' },
  ] }));
  const lines: string[] = [];
  return { lines, deps: {
    baseDir, stdout: (line) => lines.push(line), env: {}, version: 'fixture',
    machineId: () => undefined, hostname: () => 'fixture-machine', networkInterfaces: () => ({}),
    now: () => 0, onSignal: () => {}, listServeProcesses: () => [],
  } };
}

afterEach(() => {
  vi.clearAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('remote management CLI compatibility error boundary', () => {
  const cases: Array<{ args: ServeArgs; field: string }> = [
    { args: { listNodes: true }, field: 'nodes' },
    { args: { listMembers: true }, field: 'members' },
    { args: { genKeyArg: '1' }, field: 'results' },
  ];

  it.each(cases)('retains TCP_TRANSPORT_FAILED when an old peer sends malformed $field rows', async ({ args, field }) => {
    const { deps } = fixture();
    vi.mocked(executeRemoteManagement).mockResolvedValue(JSON.parse(JSON.stringify({ op: 'admin-op-result', id: 'fixture', ok: true, [field]: [{}] })));
    await expect(runServe({ viaArg: 'tcp:cloud', ...args }, deps)).rejects.toMatchObject({
      code: 'TCP_TRANSPORT_FAILED', message: expect.stringContaining('远程管理未达（'),
    });
  });

  it.each(cases)('still accepts an old peer omitting optional $field arrays', async ({ args }) => {
    const { deps } = fixture();
    vi.mocked(executeRemoteManagement).mockResolvedValue({ op: 'admin-op-result', id: 'fixture', ok: true });
    expect(await runServe({ viaArg: 'tcp:cloud', ...args }, deps)).toBe(0);
  });
});
