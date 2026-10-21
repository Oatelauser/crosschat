import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const home = mkdtempSync(join(tmpdir(), 'crosschat-discover-cli-'));
  roots.push(home);
  const registry = join(home, '.claude', 'sessions');
  const outbox = join(home, '.crosschat', 'outbox');
  mkdirSync(registry, { recursive: true });
  mkdirSync(outbox, { recursive: true });
  writeFileSync(join(registry, 'anonymous.json'), JSON.stringify({ pid: process.pid, sessionId: 'full-anonymous-session-id', kind: 'interactive', status: 'idle', messagingSocketPath: 'hidden-delivery-socket' }));
  writeFileSync(join(outbox, 'do-not-drain.json'), '{"fixture":"leave exactly unchanged"}');
  const env = { ...process.env, HOME: home, USERPROFILE: home, CODEX_HOME: join(home, 'codex'), PATH: '', CROSSCHAT_LIVE: undefined };
  const run = (input: string, args: string[] = []) => spawnSync(process.execPath, [cli, 'discover', ...args], { input, encoding: 'utf8', env, timeout: 5000, windowsHide: true });
  return { home, outbox, run };
}

describe('built discover CLI endpoint', () => {
  it('reads only JSON stdin and emits full anonymous metadata without draining outbox or exposing sockets', () => {
    const { home, outbox, run } = fixture();
    const result = run(JSON.stringify({ op: 'list', filter: { providerIds: ['claude'] } }));
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ op: 'list', page: { completeness: 'complete', items: [{ name: null, ref: { nativeId: 'full-anonymous-session-id' } }] } });
    expect(result.stdout).not.toContain('hidden-delivery-socket');
    expect(result.stderr).toBe('');
    expect(readFileSync(join(outbox, 'do-not-drain.json'), 'utf8')).toBe('{"fixture":"leave exactly unchanged"}');
    expect(readdirSync(join(home, '.crosschat'))).toEqual(['outbox']);
  });

  it('rejects invalid JSON and oversized input before provider execution', () => {
    const { run } = fixture();
    for (const input of ['{broken', 'x'.repeat(2 * 1024 * 1024 + 1)]) {
      const result = run(input);
      expect(result.status).toBe(1);
      expect(result.stdout).toBe('');
      expect(result.stderr).toContain('crosschat:');
      expect(result.stderr).not.toContain('unknown command');
    }
    expect(run('{}', ['--old-end']).status).toBe(1);
  });
});
