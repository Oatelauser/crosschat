import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as zlib from 'node:zlib';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { assessDshCallerSourceIdentity, assessDshNativeIdentity, classifyDshStartupFailure, diagnoseDshCallerSource, prepareDshProfile, snapshotDshStoredChats } from './helpers/dsh-live-fixture.mjs';

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function root() { const value = await mkdtemp(join(tmpdir(), 'crosschat-dsh-env-unit-')); roots.push(value); return value; }

describe('DSH stored-chat preservation evidence', () => {
  it('verifies actual text from a compressed native session while hashing its original stored bytes', async () => {
    const directory = await root();
    const stored = Buffer.from('KLUv/SAjGQEAb3duZWQgc3RvcmVkIGNoYXQgcmVxdWVzdC1hbmQtcmVwbHk=', 'base64');
    await writeFile(join(directory, 'session.v4.jsonl.zstd'), stored);
    // Older supported Node minors without zstd must fail explicitly as infrastructure, not silently pass or skip.
    if (typeof zlib.zstdDecompressSync !== 'function') {
      await expect(snapshotDshStoredChats(directory, ['request-and-reply'])).rejects.toMatchObject({ category: 'infrastructure' });
    } else {
      expect(await snapshotDshStoredChats(directory, ['request-and-reply'])).toEqual({ 'session.v4.jsonl.zstd': createHash('sha256').update(stored).digest('hex') });
      await expect(snapshotDshStoredChats(directory, ['absent request'])).rejects.toMatchObject({ category: 'infrastructure' });
    }
  });

  it('does not accept empty data or unrelated files as proof that the test conversation was retained', async () => {
    const directory = await root();
    await expect(snapshotDshStoredChats(directory, ['owned message'])).rejects.toMatchObject({ category: 'infrastructure' });
    await writeFile(join(directory, 'unrelated.txt'), 'owned message');
    await expect(snapshotDshStoredChats(directory, ['owned message'])).rejects.toMatchObject({ category: 'infrastructure' });
  });

  it('accepts native uncompressed JSONL and detects later changes through the original-byte hashes', async () => {
    const directory = await root(), file = join(directory, 'session.v4.jsonl');
    await writeFile(file, 'owned request and reply');
    const before = await snapshotDshStoredChats(directory, ['owned request', 'reply']);
    await writeFile(file, 'changed chat');
    expect(await snapshotDshStoredChats(directory)).not.toEqual(before);
    await expect(snapshotDshStoredChats(directory, ['owned request'])).rejects.toMatchObject({ category: 'infrastructure' });
  });

  it('treats unreadable compressed conversation content as a fixture failure', async () => {
    const directory = await root();
    await writeFile(join(directory, 'session.v4.jsonl.zstd'), 'not a zstd stream');
    await expect(snapshotDshStoredChats(directory, ['owned message'])).rejects.toMatchObject({ category: 'infrastructure' });
  });
});

describe('DSH real-runtime profile isolation', () => {
  it('keeps native home, shared skills, temporary files and credentials inside a new fixture profile', async () => {
    const directory = await root();
    vi.stubEnv('OPENAI_API_KEY', 'real-key-must-not-reach-tool');
    vi.stubEnv('DEEPSEEK_API_KEY', 'real-key-must-not-reach-tool');
    vi.stubEnv('GITHUB_TOKEN', 'real-token-must-not-reach-tool');
    vi.stubEnv('DSH_SESSION_ID', 'inherited-false-identity');
    vi.stubEnv('CODEX_THREAD_ID', 'another-tools-identity');
    vi.stubEnv('OPENCODE_TEST_HOME', 'another-tools-directory');
    vi.stubEnv('NODE_OPTIONS', '--no-warnings');
    const env = await prepareDshProfile(directory, 'http://127.0.0.1:12345/v1');
    const observed = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', `
      import {homedir,tmpdir} from 'node:os';
      console.log(JSON.stringify({home:homedir(),tmp:tmpdir(),dsh:process.env.DSH_HOME,agents:process.env.DSH_AGENTS_HOME,
        key:process.env.DEEPSEEK_API_KEY,base:process.env.DEEPSEEK_BASE_URL,
        foreign:['OPENAI_API_KEY','GITHUB_TOKEN','DSH_SESSION_ID','CODEX_THREAD_ID','OPENCODE_TEST_HOME','NODE_OPTIONS'].filter(k=>process.env[k])}));
    `], { env, cwd: directory, windowsHide: true });
    expect(JSON.parse(observed.stdout)).toEqual({ home: join(directory, 'profile'), tmp: join(directory, 'tmp'), dsh: join(directory, 'dsh-home'), agents: join(directory, 'agents-home'), key: 'mock-key', base: 'http://127.0.0.1:12345/v1', foreign: [] });
    for (const name of ['APPDATA', 'LOCALAPPDATA', 'XDG_STATE_HOME', 'npm_config_cache', 'npm_config_userconfig', 'npm_config_globalconfig', 'COREPACK_HOME', 'PNPM_HOME']) {
      expect(isAbsolute(env[name])).toBe(true);
      expect(env[name].startsWith(directory)).toBe(true);
    }
    expect(await readFile(env.npm_config_userconfig, 'utf8')).toBe('');
    expect((await stat(join(directory, 'workspace', '.git'))).isDirectory()).toBe(true);
  });

  it.each(['https://api.deepseek.com/v1', 'http://localhost:12345/v1', 'http://127.0.0.1:12345/v1?token=x', 'http://user:secret@127.0.0.1:12345/v1'])('rejects a non-fixture model endpoint before preparing %s', async (url) => {
    const directory = await root();
    await expect(prepareDshProfile(directory, url)).rejects.toMatchObject({ code: 'INVALID_MODEL_ENDPOINT' });
    await expect(stat(join(directory, 'dsh-home'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

describe('DSH startup failure evidence', () => {
  it('keeps a broken fixture import distinct from a broken production bridge import', () => {
    const fixture = "crosschat-dsh-test-driver (file:///owned/driver.mjs): failed to import: Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@deepseek-ai/dsh-app-boot'";
    const production = "crosschat-dsh-bridge (@crosschat/dsh-bridge): failed to import: Error: Package subpath is not defined";
    expect(classifyDshStartupFailure({ processAlive: true, stderr: fixture })).toEqual({ category: 'infrastructure', check: 'fixture-driver-load' });
    expect(classifyDshStartupFailure({ processAlive: true, stderr: production })).toEqual({ category: 'compatibility', check: 'production-bridge-load' });
  });

  it('treats a missing test controller as infrastructure while keeping transient process readiness inconclusive', () => {
    expect(classifyDshStartupFailure({ processAlive: true, stderr: 'crosschat-dsh-test-driver: pending - missing required service: sessionController' })).toEqual({ category: 'infrastructure', check: 'fixture-session-controller' });
    expect(classifyDshStartupFailure({ processAlive: false, stderr: '' })).toEqual({ category: 'infrastructure', check: 'runtime-process' });
    expect(classifyDshStartupFailure({ processAlive: true, stderr: 'dsh: starting web runtime' })).toEqual({ category: 'infrastructure', check: 'runtime-readiness' });
  });
});

describe('DSH native shell identity evidence', () => {
  const expected = { session: 'session-current-full-id', profile: 'web', dshHome: '/owned/dsh-home' };
  const requests = (output: unknown) => [{ messages: [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'actual-shell-call', content: JSON.stringify(output) + '\n' }] }] }];
  it('accepts only the exact identity returned by a real tool-result shape', () => {
    expect(assessDshNativeIdentity(requests(expected), expected)).toEqual({ ready: true });
    expect(assessDshNativeIdentity([{ messages: [{ role: 'user', content: JSON.stringify(expected) }] }], expected)).toEqual({ ready: false, category: 'infrastructure', check: 'model-tool-result' });
  });
  it('reports removed or changed native DSH fields as compatibility after a successful JSON shell result', () => {
    expect(assessDshNativeIdentity(requests({ ...expected, session: 'different-native-session' }), expected)).toEqual({ ready: false, category: 'compatibility', check: 'native-shell-identity' });
    expect(assessDshNativeIdentity(requests({ profile: 'web', dshHome: expected.dshHome }), expected)).toEqual({ ready: false, category: 'compatibility', check: 'native-shell-identity' });
  });

  const source = { status: 'identified', sourceTool: 'dsh', basis: 'native', association: 'verified', scope: 'instance', shouldAsk: false };
  it('requires the real native shell and read-only identity observation in the same tool result', () => {
    const observed = { ...expected, callerSourceExit: 0, callerSource: source };
    expect(assessDshCallerSourceIdentity(requests(observed), expected)).toEqual({ ready: true, source });
    expect(assessDshCallerSourceIdentity(requests({ ...observed, session: 'other' }), expected)).toMatchObject({ ready: false, category: 'compatibility' });
  });

  it.each([
    undefined,
    { ...source, sourceTool: 'dsh-desktop' },
    { ...source, basis: 'user', status: 'confirmed' },
    { ...source, association: 'unavailable' },
    { ...source, scope: 'origin' },
    { ...source, shouldAsk: true, context: 'manual-confirmation-context' },
  ])('does not manufacture the missing native shellEnv source association: %j', (callerSource) => {
    expect(assessDshCallerSourceIdentity(requests({ ...expected, callerSourceExit: 0, callerSource }), expected)).toEqual({
      ready: false, category: 'compatibility', check: 'native-shell-caller-source',
    });
  });

  it('distinguishes a broken shell JSON bootstrap from an unavailable native source probe', () => {
    expect(assessDshCallerSourceIdentity([], expected)).toMatchObject({ ready: false, category: 'infrastructure', check: 'model-tool-result' });
    expect(assessDshCallerSourceIdentity(requests({ ...expected, callerSourceExit: 1, callerSource: source }), expected)).toMatchObject({
      ready: false, category: 'compatibility', check: 'native-shell-caller-source',
    });
  });

  it('retains structured source failures and presence facts without token, directory or free-form values', () => {
    const observed = { ...expected, callerSourceExit: 0,
      callerSource: { status: 'unresolved', association: 'unavailable', code: 'DSH_SOURCE_ASSOCIATION_UNAVAILABLE',
        reason: '/private/profile secret-token', token: 'secret-token', sourceDomain: '/private/profile' },
      callerSourceInput: { shellFlagExpected: true, instanceMarkerValid: false, stateHomeAbsolute: false, profileDirAbsolute: true,
        token: 'secret-token', profileDir: '/private/profile' } };
    expect(diagnoseDshCallerSource(requests(observed), expected)).toEqual({ nativeIdentityMatched: true, sourceExit: 0,
      source: { status: 'unresolved', association: 'unavailable', code: 'DSH_SOURCE_ASSOCIATION_UNAVAILABLE' },
      input: { shellFlagExpected: true, instanceMarkerValid: false, stateHomeAbsolute: false, profileDirAbsolute: true } });
    expect(JSON.stringify(diagnoseDshCallerSource(requests(observed), expected))).not.toMatch(/private|secret-token|sourceDomain/);
  });
});
