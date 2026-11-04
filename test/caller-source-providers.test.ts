import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { mountDshBridge } from '../integrations/dsh/bridge.js';
import { probeCallerSource } from '../src/application/caller-source/providers.js';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose(); });

async function harness(home?: string, profile = 'web') {
  const rootHome = home ?? await mkdtemp(join(tmpdir(), 'crosschat-source-provider-'));
  if (home === undefined) cleanup.push(() => rm(rootHome, { recursive: true, force: true }));
  const profileDir = join(rootHome, 'native-profile');
  const agents = new Map(['A', 'B'].map((id) => [id, { id, status: 'idle', session: { header: { id, createdAt: 1 } } }]));
  let contributor: { resolve: (execution: { agent?: unknown }) => NodeJS.ProcessEnv } | undefined;
  const effects: Array<() => void | Promise<void>> = [];
  const ctx = {
    agents: { roots: () => [...agents.values()], get: (id: string) => agents.get(id) },
    get: (key: string) => key === 'profileContext' ? { name: profile, dir: profileDir }
      : key === 'shellEnv' ? { register: (value: typeof contributor) => { contributor = value; return () => { contributor = undefined; }; } } : undefined,
    effect: (setup: () => () => void | Promise<void>) => { const dispose = setup(); effects.push(dispose); return dispose; },
  };
  const bridge = await mountDshBridge(ctx, { getDshRuntimeVersion: () => '0.2.1-rc.2', createUserMessage: () => ({ id: randomUUID() }) }, { home: rootHome });
  cleanup.push(async () => { for (const dispose of effects.reverse()) await dispose(); });
  const files = await readdir(join(rootHome, '.crosschat', 'dsh', 'instances'));
  const registrations = await Promise.all(files.map(async (file) => JSON.parse(await readFile(join(rootHome, '.crosschat', 'dsh', 'instances', file), 'utf8'))));
  const env = (id: string): NodeJS.ProcessEnv => ({ DSH_SESSION_ID: id, DSH_SHELL: '1', DSH_HOME: join(rootHome, 'native-home'),
    DSH_PROFILE: profile, DSH_PROFILE_DIR: profileDir, ...contributor?.resolve({ agent: agents.get(id) }) });
  return { home: rootHome, profileDir, registrations, env, bridge, agents };
}

describe('native caller source providers', () => {
  it('classifies known native channels without fabricating shared runtime provenance', async () => {
    expect(await probeCallerSource({ p: 'claude', id: 'native' }, { env: { CLAUDE_CODE_MESSAGING_SOCKET: 'native-socket' } }))
      .toMatchObject({ status: 'identified', sourceTool: 'claude', association: 'unavailable' });
    const opencode = await probeCallerSource({ p: 'opencode', id: 'native' }, { env: { OPENCODE_SESSION_ID: 'native', CROSSCHAT_OPENCODE_URL: 'http://127.0.0.1:1' } });
    expect(opencode).toMatchObject({ status: 'identified', sourceTool: 'opencode', association: 'unavailable' });
    expect(opencode).not.toHaveProperty('sourceDomain');
  });

  it('does not classify Codex from inherited source labels, a supplied endpoint, or a shared native id', async () => {
    const result = await probeCallerSource({ p: 'codex', id: 'same', endpointType: 'desktop' }, { env: {
      CODEX_THREAD_ID: 'same', CODEX_TOOL_CALL_ID: 'call', CODEX_ORIGINATOR: 'Codex Desktop', CROSSCHAT_CALLER_TOOL: 'codex-desktop',
    } });
    expect(result).toMatchObject({ status: 'unresolved', association: 'unavailable', code: 'CODEX_SOURCE_ASSOCIATION_UNVERIFIED' });
    expect(result).not.toHaveProperty('sourceTool');
    expect(result).not.toHaveProperty('sourceDomain');
  });

  it('associates multiple native sessions with the same exact live Host instance', async () => {
    const value = await harness();
    const first = await probeCallerSource({ p: 'dsh', id: 'A' }, { env: value.env('A'), home: value.home });
    const second = await probeCallerSource({ p: 'dsh', id: 'B' }, { env: value.env('B'), home: value.home });
    expect(first).toMatchObject({ status: 'identified', sourceTool: 'dsh', association: 'verified', scope: 'instance',
      sourceDomain: expect.any(String), runtimeFingerprint: expect.any(String) });
    expect(second.sourceDomain).toBe(first.sourceDomain);
    expect(second.runtimeFingerprint).toBe(first.runtimeFingerprint);
    for (const registration of value.registrations) expect(JSON.stringify(first)).not.toContain(registration.token);
  });

  it('uses the contributed instance rather than selecting the first Host with the same session id', async () => {
    const host = await harness();
    const desktop = await harness(host.home, 'desktop');
    const result = await probeCallerSource({ p: 'dsh', id: 'A' }, { env: desktop.env('A'), home: host.home });
    expect(result).toMatchObject({ status: 'identified', sourceTool: 'dsh-desktop', association: 'verified' });
    const other = await probeCallerSource({ p: 'dsh', id: 'A' }, { env: host.env('A'), home: host.home });
    expect(other.sourceDomain).not.toBe(result.sourceDomain);
  });

  it('does not probe unrelated malformed source records when the native call identifies an exact instance', async () => {
    const value = await harness();
    await writeFile(join(value.home, '.crosschat', 'dsh', 'instances', `${randomUUID()}.json`), '{unrelated malformed record', { mode: 0o600 });
    expect(await probeCallerSource({ p: 'dsh', id: 'A' }, { env: value.env('A'), home: value.home }))
      .toMatchObject({ status: 'identified', sourceTool: 'dsh', association: 'verified' });
  });

  it('invalidates a closed bridge generation and verifies a new generation without retaining a failed verdict', async () => {
    const value = await harness();
    const oldEnv = value.env('A');
    const previous = await probeCallerSource({ p: 'dsh', id: 'A' }, { env: oldEnv, home: value.home });
    await value.bridge.close();
    expect((await probeCallerSource({ p: 'dsh', id: 'A' }, { env: oldEnv, home: value.home })).status).toBe('unavailable');
    const next = await harness(value.home);
    const current = await probeCallerSource({ p: 'dsh', id: 'A' }, { env: next.env('A'), home: value.home });
    expect(current.status).toBe('identified');
    expect(current.sourceDomain).not.toBe(previous.sourceDomain);
    expect(current.runtimeFingerprint).not.toBe(previous.runtimeFingerprint);
    expect((await probeCallerSource({ p: 'dsh', id: 'A' }, { env: oldEnv, home: value.home })).status).toBe('unavailable');
  });

  it.each(['DSH_CROSSCHAT_INSTANCE_ID', 'DSH_CROSSCHAT_HOME', 'DSH_PROFILE_DIR', 'DSH_PROFILE', 'DSH_SHELL'])('does not associate a Host when %s is absent', async (key) => {
    const value = await harness();
    const env = value.env('A');
    delete env[key];
    const result = await probeCallerSource({ p: 'dsh', id: 'A' }, { env, home: value.home });
    expect(result.association).toBe('unavailable');
    expect(result).not.toHaveProperty('sourceDomain');
  });

  it('rejects profile, state-home or native-session disagreement instead of borrowing another source', async () => {
    const value = await harness();
    for (const change of [{ DSH_PROFILE: 'desktop' }, { DSH_PROFILE_DIR: join(value.home, 'other-profile') },
      { DSH_CROSSCHAT_HOME: join(value.home, 'other-home') }, { DSH_SESSION_ID: 'B' }]) {
      const result = await probeCallerSource({ p: 'dsh', id: 'A' }, { env: { ...value.env('A'), ...change }, home: value.home });
      expect(result.association).toBe('unavailable');
      expect(result).not.toHaveProperty('sourceDomain');
    }
  });

  it('does not accept a removed root or a closed bridge and does not persist an unsupported verdict', async () => {
    const value = await harness();
    const env = value.env('A');
    value.agents.delete('A');
    expect(await probeCallerSource({ p: 'dsh', id: 'A' }, { env, home: value.home })).toMatchObject({ status: 'unavailable', association: 'unavailable' });
    await value.bridge.close();
    const after = await probeCallerSource({ p: 'dsh', id: 'A' }, { env, home: value.home });
    expect(after.status).toBe('unavailable');
    expect(after).not.toHaveProperty('sourceDomain');
  });

  it('cancels before touching source state', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(probeCallerSource({ p: 'dsh', id: 'A' }, { env: {}, signal: controller.signal })).rejects.toMatchObject({ code: 'CALLER_SOURCE_CANCELLED' });
  });
});
