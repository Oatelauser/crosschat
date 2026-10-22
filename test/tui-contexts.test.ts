import { mkdtemp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const homes: string[] = [];
afterEach(async () => {
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});

async function fixture() {
  const home = await mkdtemp(join(tmpdir(), 'crosschat-tui-contexts-'));
  homes.push(home);
  return { home, ssh: join(home, '.ssh', 'config'), node: join(home, '.crosschat', 'tcp', 'node.json'), preferences: join(home, '.crosschat', 'tui.json') };
}

async function configure(home: string, ssh: string, brokers: unknown[]) {
  await mkdir(join(home, '.ssh'), { recursive: true });
  await mkdir(join(home, '.crosschat', 'tcp'), { recursive: true });
  await writeFile(join(home, '.ssh', 'config'), ssh);
  await writeFile(join(home, '.crosschat', 'tcp', 'node.json'), JSON.stringify({ brokers }));
}

describe('TUI entry contexts', () => {
  it('keeps the local context with missing optional configuration and creates no directories', async () => {
    const { listTuiContexts } = await import('../src/application/contexts/index.js');
    const { home } = await fixture();
    const result = await listTuiContexts({ home, hostname: () => 'fixture-host', now: () => 123 });
    expect(result).toMatchObject({ items: [{ id: 'local', kind: 'local', name: '本机', target: 'fixture-host' }], errors: [], observedAt: 123 });
    expect(result.items).toHaveLength(1);
    expect(await readdir(home)).toEqual([]);
  });

  it('lists deterministic SSH aliases once without executing or following configuration', async () => {
    const { listTuiContexts } = await import('../src/application/contexts/index.js');
    const { home, ssh } = await fixture();
    await configure(home, [
      '# a comment containing Host hidden',
      '  Host alpha beta alpha  # duplicate',
      'Host *.example !excluded ?',
      'Host="quoted-name" gamma',
      '  HostName private-target.example',
      '  IdentityFile /private/key',
      '  ProxyCommand printf secret-token',
      'Include additional-config',
      'Match exec "printf do-not-execute"',
      'Host alpha',
    ].join('\n'), [{ host: 'broker', port: 7260, key: 'member-secret' }]);
    const before = await readFile(ssh, 'utf8');
    const result = await listTuiContexts({ home, hostname: () => 'fixture-host' });
    expect(result.items.filter((item) => item.kind === 'ssh').map((item) => item.target)).toEqual(['alpha', 'beta', 'quoted-name', 'gamma']);
    expect(result.items.find((item) => item.target === 'alpha')).toMatchObject({ id: 'ssh:alpha', attributes: { source: ssh, coverage: 'host-aliases-only' } });
    expect(JSON.stringify(result)).not.toMatch(/private-target|\/private\/key|secret-token|do-not-execute|member-secret/);
    expect(await readFile(ssh, 'utf8')).toBe(before);
    expect((await readdir(join(home, '.ssh'))).sort()).toEqual(['config']);
  });

  it('keys TCP contexts by stable star identity or endpoint and never exports credentials', async () => {
    const { listTuiContexts } = await import('../src/application/contexts/index.js');
    const { home, node } = await fixture();
    await configure(home, '', [
      { host: 'one', port: 7260, name: 'same', starId: 'star-full-one', key: 'member-secret', adminKey: 'admin-secret', pipe: 'pipe-secret', token: 'token-secret' },
      { host: 'two', port: 7260, name: 'same', starId: 'star-full-two', key: 'other-member' },
      { host: '::1', port: 7261, name: 'same', key: 'third-member' },
    ]);
    const before = await readFile(node, 'utf8');
    const result = await listTuiContexts({ home });
    const entries = result.items.filter((item) => item.kind === 'tcp');
    expect(entries.map((item) => item.id)).toEqual(['tcp:star:star-full-one', 'tcp:star:star-full-two', `tcp:endpoint:${encodeURIComponent('[::1]:7261')}`]);
    expect(entries.map((item) => item.target)).toEqual(['one:7260', 'two:7260', '[::1]:7261']);
    expect(entries[0].attributes).toMatchObject({ starId: 'star-full-one', source: node });
    expect(JSON.stringify(result)).not.toMatch(/member-secret|admin-secret|pipe-secret|token-secret|other-member|third-member|hasAdmin|hasMember|authenticated/);
    expect(await readFile(node, 'utf8')).toBe(before);
    expect((await readdir(join(home, '.crosschat', 'tcp'))).sort()).toEqual(['node.json']);
    await configure(home, '', [{ host: 'renamed-endpoint', port: 7262, name: 'renamed', starId: 'star-full-one', key: 'replacement-member' }]);
    expect((await listTuiContexts({ home })).items.find((item) => item.kind === 'tcp')?.id).toBe(entries[0].id);
  });

  it('isolates malformed and unreadable sources and emits only safe source errors', async () => {
    const { listTuiContexts } = await import('../src/application/contexts/index.js');
    const { home, ssh, node } = await fixture();
    const result = await listTuiContexts({ home, readText: async (file) => {
      if (file === ssh) throw Object.assign(new Error('secret-error-body'), { code: 'EACCES' });
      return '{secret-broken-json';
    } });
    expect(result.items.map((item) => item.kind)).toEqual(['local']);
    expect(result.errors).toEqual([
      expect.objectContaining({ source: ssh, kind: 'unreadable' }),
      expect.objectContaining({ source: node, kind: 'malformed' }),
    ]);
    expect(JSON.stringify(result)).not.toContain('secret-');
    expect(await readdir(home)).toEqual([]);
  });

  it('reports malformed SSH tokens without dropping independent TCP contexts', async () => {
    const { listTuiContexts } = await import('../src/application/contexts/index.js');
    const { home, ssh } = await fixture();
    await configure(home, 'Host "unfinished-secret', [{ host: 'broker', port: 7260, key: 'member-secret' }]);
    const result = await listTuiContexts({ home });
    expect(result.items.map((item) => item.kind)).toEqual(['local', 'tcp']);
    expect(result.errors).toEqual([expect.objectContaining({ source: ssh, kind: 'malformed' })]);
    expect(JSON.stringify(result)).not.toMatch(/unfinished-secret|member-secret/);
  });

  it('does no source IO after cancellation and discards late results', async () => {
    const { listTuiContexts } = await import('../src/application/contexts/index.js');
    const { home } = await fixture();
    const controller = new AbortController();
    controller.abort();
    const readText = vi.fn(async () => 'Host hidden');
    const cancelled = await listTuiContexts({ home, signal: controller.signal, readText });
    expect(cancelled.items.map((item) => item.kind)).toEqual(['local']);
    expect(cancelled.errors.every((error) => error.kind === 'cancelled')).toBe(true);
    expect(readText).not.toHaveBeenCalled();
    const next = new AbortController();
    const finishes: Array<(value: string) => void> = [];
    const pending = listTuiContexts({ home, signal: next.signal, readText: () => new Promise((resolve) => { finishes.push(resolve); }) });
    next.abort();
    const result = await pending;
    expect(result.items.map((item) => item.kind)).toEqual(['local']);
    expect(result.errors.every((error) => error.kind === 'cancelled')).toBe(true);
    for (const finish of finishes) finish('Host arrived-too-late');
    expect(result.items.map((item) => item.kind)).toEqual(['local']);
  });

  it('allows future connection kinds without inventing protocol-specific permissions', async () => {
    const { listTuiContexts } = await import('../src/application/contexts/index.js');
    const { home } = await fixture();
    const result = await listTuiContexts({ home });
    const future: (typeof result.items)[number] = { id: 'future:test', kind: 'future-protocol', name: 'future', target: 'opaque', identityHint: '尚未核实', attributes: { custom: true } };
    expect(future.kind).toBe('future-protocol');
    expect(result.items[0]).not.toHaveProperty('permissions');
  });
});

describe('TUI preferences', () => {
  it('loads absent preferences as defaults without creating a state directory', async () => {
    const { loadTuiPreferences } = await import('../src/application/contexts/index.js');
    const { home } = await fixture();
    expect(await loadTuiPreferences({ home, now: () => 456 })).toMatchObject({ state: 'missing', value: { version: 1 }, errors: [], observedAt: 456 });
    expect(await readdir(home)).toEqual([]);
  });

  it('keeps corrupt or future-version preferences unchanged until an explicit save', async () => {
    const { loadTuiPreferences } = await import('../src/application/contexts/index.js');
    const { home, preferences } = await fixture();
    await mkdir(join(home, '.crosschat'));
    for (const raw of ['{secret-corrupt-json', '{"version":2,"selectedContextId":"future:context"}', '{"version":1,"selectedContextId":17}', 'null']) {
      await writeFile(preferences, raw);
      const result = await loadTuiPreferences({ home });
      expect(result).toMatchObject({ state: 'malformed', value: { version: 1 }, errors: [expect.objectContaining({ source: preferences, kind: 'malformed' })] });
      expect(JSON.stringify(result)).not.toContain('secret-corrupt-json');
      expect(await readFile(preferences, 'utf8')).toBe(raw);
      expect(await readdir(join(home, '.crosschat'))).toEqual(['tui.json']);
    }
  });

  it('only persists a selected context preference and atomically installs a private file', async () => {
    const { loadTuiPreferences, saveTuiPreferences } = await import('../src/application/contexts/index.js');
    const { home, preferences } = await fixture();
    const renameFile = vi.fn(async (from: string, to: string) => {
      expect(to).toBe(preferences);
      expect(from).not.toBe(to);
      expect(JSON.parse(await readFile(from, 'utf8'))).toEqual({ version: 1, selectedContextId: 'future:opaque-context' });
      if (process.platform !== 'win32') expect((await stat(from)).mode & 0o777).toBe(0o600);
      await rename(from, to);
    });
    expect(await saveTuiPreferences({ home, preferences: { version: 1, selectedContextId: 'future:opaque-context', key: 'secret-key', adminKey: 'secret-admin', entries: [{ key: 'secret-entry' }] }, renameFile })).toMatchObject({ state: 'ready', value: { version: 1, selectedContextId: 'future:opaque-context' }, errors: [] });
    expect(renameFile).toHaveBeenCalledOnce();
    expect(await loadTuiPreferences({ home })).toMatchObject({ state: 'ready', value: { version: 1, selectedContextId: 'future:opaque-context' } });
    expect(await readdir(join(home, '.crosschat'))).toEqual(['tui.json']);
    expect(await readFile(preferences, 'utf8')).not.toContain('secret-');
  });

  it('preserves the original preference on atomic replacement failure and cleans the temporary file', async () => {
    const { saveTuiPreferences } = await import('../src/application/contexts/index.js');
    const { home, preferences } = await fixture();
    await mkdir(join(home, '.crosschat'));
    const before = '{"version":1,"selectedContextId":"local"}\n';
    await writeFile(preferences, before);
    const result = await saveTuiPreferences({ home, preferences: { version: 1, selectedContextId: 'ssh:other' }, renameFile: async () => { throw new Error('secret-failure'); } });
    expect(result).toMatchObject({ state: 'unreadable', value: null, errors: [expect.objectContaining({ source: preferences, kind: 'unreadable' })] });
    expect(JSON.stringify(result)).not.toContain('secret-failure');
    expect(await readFile(preferences, 'utf8')).toBe(before);
    expect(await readdir(join(home, '.crosschat'))).toEqual(['tui.json']);
  });

  it('rejects invalid values before creating directories and handles cancelled reads and saves', async () => {
    const { loadTuiPreferences, saveTuiPreferences } = await import('../src/application/contexts/index.js');
    const { home } = await fixture();
    for (const preferences of [{ version: 2 }, { version: 1, selectedContextId: 7 }, null]) {
      expect(await saveTuiPreferences({ home, preferences })).toMatchObject({ state: 'malformed', value: null });
    }
    const controller = new AbortController();
    controller.abort();
    const readText = vi.fn(async () => '{"version":1}');
    expect(await loadTuiPreferences({ home, signal: controller.signal, readText })).toMatchObject({ state: 'cancelled', value: { version: 1 } });
    expect(readText).not.toHaveBeenCalled();
    expect(await saveTuiPreferences({ home, signal: controller.signal, preferences: { version: 1, selectedContextId: 'local' } })).toMatchObject({ state: 'cancelled', value: null });
    expect(await readdir(home)).toEqual([]);
  });
});
