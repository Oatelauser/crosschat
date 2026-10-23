import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { classifyDshStartupFailure, prepareDshProfile } from './helpers/dsh-live-fixture.mjs';

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function root() { const value = await mkdtemp(join(tmpdir(), 'crosschat-dsh-env-unit-')); roots.push(value); return value; }

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
