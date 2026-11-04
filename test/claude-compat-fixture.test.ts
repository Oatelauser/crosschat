import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createClaudeMockModel } from './helpers/claude-mock-model.mjs';
import { prepareClaudeProfile } from './helpers/claude-live-fixture.mjs';

const models: Array<{ close(): Promise<void> }> = [];
const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(models.splice(0).map((model) => model.close()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const headers = { 'content-type': 'application/json', 'x-api-key': 'mock-key' };
const body = { model: 'claude-sonnet-4-6', stream: true, messages: [{ role: 'user', content: 'fixture-only-中文-123' }] };
const post = (url: string, value: unknown = body) => fetch(`${url}/v1/messages?beta=true`, { method: 'POST', headers, body: JSON.stringify(value) });
function events(text: string): Array<Record<string, unknown>> {
  return text.trim().split('\n\n').map((block) => {
    const lines = block.split('\n');
    const value = JSON.parse(lines.find((line) => line.startsWith('data: '))!.slice(6));
    expect(lines[0]).toBe(`event: ${value.type}`);
    return value;
  });
}

describe('Claude compatibility model-only HTTP fixture', () => {
  it('binds loopback and streams the complete Messages text response without accepting invalid traffic', async () => {
    const model = await createClaudeMockModel((value: unknown) => ({ text: JSON.stringify(value).includes('fixture-only-中文-123') ? 'ACK-中文' : 'unexpected' }));
    models.push(model);
    expect(new URL(model.url).hostname).toBe('127.0.0.1');
    expect(new URL(model.url).pathname).toBe('/');
    expect((await fetch(`${model.url}/v1/messages`, { method: 'POST', headers: { ...headers, 'x-api-key': 'real-key-must-not-work' }, body: JSON.stringify(body) })).status).toBe(401);
    expect((await fetch(`${model.url}/v1/messages`, { method: 'POST', headers, body: '{' })).status).toBe(400);
    expect((await fetch(`${model.url}/v1/messages`, { method: 'POST', headers, body: JSON.stringify({ ...body, stream: 'true' }) })).status).toBe(400);
    expect((await fetch(`${model.url}/v1/chat/completions`, { method: 'POST', headers, body: JSON.stringify(body) })).status).toBe(404);
    const response = await post(model.url);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    const frames = events(await response.text());
    expect(frames.map((frame) => frame.type)).toEqual(['message_start', 'content_block_start', 'content_block_delta', 'content_block_stop', 'message_delta', 'message_stop']);
    expect(frames[0]).toMatchObject({ message: { type: 'message', role: 'assistant', model: body.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: expect.any(Number), output_tokens: expect.any(Number) } } });
    expect(frames[2]).toMatchObject({ delta: { type: 'text_delta', text: 'ACK-中文' } });
    expect(frames[4]).toMatchObject({ delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: expect.any(Number) } });
    expect(model.requests).toEqual([body]);
    expect(model.errors).toEqual([]);
  });

  it.each([false, undefined])('returns an ordinary Message for stream=%s and echoes the requested model', async (stream) => {
    const model = await createClaudeMockModel(() => ({ text: 'nonstream-ACK' }));
    models.push(model);
    const response = await post(model.url, { ...body, stream, model: 'fixture-model-open-field' });
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.json()).toMatchObject({ id: expect.any(String), type: 'message', role: 'assistant', model: 'fixture-model-open-field', content: [{ type: 'text', text: 'nonstream-ACK' }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: expect.any(Number), output_tokens: expect.any(Number) } });
  });

  it.each([true, false])('serves actual Bash tool_use arguments for stream=%s', async (stream) => {
    const input = { command: 'node --version', description: 'Fixture actual shell invocation' };
    const model = await createClaudeMockModel(() => ({ tool: { name: 'Bash', input, id: 'fixture-bash-call-123' } }));
    models.push(model);
    const response = await post(model.url, { ...body, stream });
    if (stream) {
      const frames = events(await response.text());
      expect(frames[1]).toMatchObject({ content_block: { type: 'tool_use', name: 'Bash', id: 'fixture-bash-call-123', input: {} } });
      expect(frames[2]).toMatchObject({ delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) } });
      expect(frames[4]).toMatchObject({ delta: { stop_reason: 'tool_use' } });
    } else {
      expect(await response.json()).toMatchObject({ content: [{ type: 'tool_use', name: 'Bash', id: 'fixture-bash-call-123', input }], stop_reason: 'tool_use' });
    }
  });

  it('serves token counting and startup warming without consuming the inference script', async () => {
    let calls = 0;
    const model = await createClaudeMockModel(() => { calls += 1; return { text: 'must-not-run' }; });
    models.push(model);
    expect((await fetch(`${model.url}/api/hello`, { method: 'HEAD', headers })).status).toBe(204);
    const response = await fetch(`${model.url}/v1/messages/count_tokens?beta=true`, { method: 'POST', headers, body: JSON.stringify(body) });
    expect(await response.json()).toMatchObject({ input_tokens: expect.any(Number) });
    expect(model.requests).toEqual([]);
    expect(calls).toBe(0);
    await expect(model.waitForRequests(1, 30)).rejects.toThrow(/Expected 1 Claude model requests/);
  });

  it('bounds request bytes before invoking the script', async () => {
    const model = await createClaudeMockModel(() => ({ text: 'must-not-run' }), { maxRequestBytes: 256 });
    models.push(model);
    const status = await new Promise<number>((done, reject) => {
      const outgoing = request(`${model.url}/v1/messages`, { method: 'POST', headers }, (incoming) => {
        incoming.resume(); incoming.once('end', () => done(incoming.statusCode ?? 0));
      });
      outgoing.once('error', reject);
      outgoing.end(JSON.stringify({ ...body, padding: 'x'.repeat(1000) }));
    });
    expect(status).toBe(413);
    expect(model.requests).toEqual([]);
  });

  it('redacts responder errors and invalid results while remaining usable', async () => {
    const model = await createClaudeMockModel((_value: unknown, context: { index: number }) => {
      if (context.index === 0) throw new Error('private-script-request-value');
      if (context.index === 1) return { tool: { name: '', input: 'private-script-request-value' } };
      return { text: 'recovered' };
    });
    models.push(model);
    for (let index = 0; index < 2; index += 1) {
      const response = await post(model.url);
      expect(response.status).toBe(500);
      expect(await response.text()).not.toContain('private-script-request-value');
    }
    expect(await (await post(model.url)).text()).toContain('recovered');
    expect(model.errors).toEqual(['MODEL_SCRIPT_FAILED', 'MODEL_SCRIPT_FAILED']);
  });

  it('closes pending responses, aborts their owned signal, and is idempotent', async () => {
    let signal: AbortSignal | undefined;
    let entered!: () => void;
    const ready = new Promise<void>((done) => { entered = done; });
    const model = await createClaudeMockModel((_value: unknown, context: { signal: AbortSignal }) => {
      signal = context.signal; entered();
      return new Promise(() => {});
    });
    models.push(model);
    const response = post(model.url).then(() => 'resolved', () => 'closed');
    await ready;
    await model.close();
    expect(signal?.aborted).toBe(true);
    expect(await response).toBe('closed');
    await model.close();
  }, 3000);
});

async function fixtureRoot() { const root = await mkdtemp(join(tmpdir(), 'crosschat-claude-profile-unit-')); roots.push(root); return root; }

describe('Claude compatibility runtime profile isolation', () => {
  it('isolates actual child home and Git without passing inherited credentials or native identities', async () => {
    const root = await fixtureRoot();
    const inherited = ['ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE_MESSAGING_SOCKET', 'CLAUDE_CODE_MESSAGING_TOKEN', 'CLAUDE_CONFIG_DIR', 'CODEX_THREAD_ID', 'OPENCODE_HOME', 'DSH_HOME', 'OPENAI_API_KEY', 'GITHUB_TOKEN', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NODE_OPTIONS', 'NODE_PATH', 'BASH_ENV', 'AWS_PROFILE', 'GOOGLE_APPLICATION_CREDENTIALS', 'AZURE_CLIENT_SECRET'];
    for (const name of inherited) vi.stubEnv(name, name === 'NODE_OPTIONS' ? '--no-warnings' : 'real-value-must-not-inherit');
    const env = await prepareClaudeProfile(root, 'http://127.0.0.1:12345');
    const observed = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', `
      import {homedir,tmpdir} from 'node:os';
      console.log(JSON.stringify({home:homedir(),tmp:tmpdir(),config:process.env.CLAUDE_CONFIG_DIR,key:process.env.ANTHROPIC_API_KEY,base:process.env.ANTHROPIC_BASE_URL}));
    `], { env, cwd: root, windowsHide: true });
    expect(JSON.parse(observed.stdout)).toEqual({ home: join(root, 'profile'), tmp: join(root, 'tmp'), config: join(root, 'profile', '.claude'), key: 'mock-key', base: 'http://127.0.0.1:12345' });
    for (const name of inherited.filter((name) => !['ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL', 'CLAUDE_CONFIG_DIR'].includes(name))) expect(env[name]).toBeUndefined();
    for (const name of ['APPDATA', 'LOCALAPPDATA', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME', 'TEMP', 'TMP', 'TMPDIR', 'CLAUDE_CODE_TMPDIR', 'GIT_CONFIG_GLOBAL']) {
      expect(isAbsolute(env[name])).toBe(true);
      expect(env[name].startsWith(root)).toBe(true);
    }
    expect(env.GIT_CONFIG_NOSYSTEM).toBe('1');
    expect(await readFile(env.GIT_CONFIG_GLOBAL, 'utf8')).toBe('');
    expect(env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC).toBe('1');
    expect(env.CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL).toBe('1');
    expect(env.DISABLE_AUTOUPDATER).toBe('1');
    expect(env.CLAUDE_CODE_SIMPLE).toBeUndefined();
    expect((await stat(env.CLAUDE_CONFIG_DIR)).isDirectory()).toBe(true);
  });

  it.each(['https://api.anthropic.com', 'http://localhost:12345', 'http://127.0.0.2:12345', 'http://127.0.0.1', 'http://127.0.0.1:12345/v1', 'http://127.0.0.1:12345?token=x', 'http://127.0.0.1:12345#secret', 'http://user:secret@127.0.0.1:12345'])('rejects unsafe model URL %s before any profile write', async (url) => {
    const root = await fixtureRoot();
    await expect(prepareClaudeProfile(root, url)).rejects.toMatchObject({ code: 'INVALID_MODEL_ENDPOINT' });
    expect(await readdir(root)).toEqual([]);
  });
});

describe('Claude compatibility workflow trust boundary', () => {
  it.each(['\n', '\r\n'])('keeps real upstream execution on a read-only Windows job and issue reporting on a separate trusted job with %j line endings', async (lineEnding) => {
    const workflow = (await readFile(new URL('../.github/workflows/claude-compat.yml', import.meta.url), 'utf8')).replace(/\r?\n/g, lineEnding);
    const probe = workflow.split('\n  probe:')[1]?.split('\n  report:')[0];
    const report = workflow.split('\n  report:')[1];
    expect(probe).toBeTruthy(); expect(report).toBeTruthy();
    expect(workflow).toMatch(/^ {2}schedule:/m); expect(workflow).toMatch(/^ {2}workflow_dispatch:/m);
    expect(workflow).not.toMatch(/pull_request|workflow_run|\bsecrets\./);
    expect(probe).toMatch(/runs-on: windows-latest/);
    expect(probe).toMatch(/permissions:\r?\n {6}contents: read/);
    expect(probe).not.toMatch(/issues: write|contents: write|matrix:|GITHUB_TOKEN|GH_TOKEN/);
    expect(probe).toContain('node scripts/claude-compat-ci.mjs');
    expect(probe).toMatch(/persist-credentials: false/);
    expect(report).toMatch(/needs: probe/);
    expect(report).toContain('github.event.repository.default_branch');
    expect(report).toMatch(/issues: write/);
    expect(report).not.toMatch(/node scripts\/claude-compat-ci\.mjs|npm ci|npm run/);
    expect(report).toContain('ref: ${{ github.sha }}');
    expect(report).toMatch(/persist-credentials: false/);
    expect(report).toMatch(/path: trusted/);
    expect(report).toMatch(/path: evidence/);
    expect(report).toContain('claudeRegressionIdentity');
    expect(report).toMatch(/trusted\/scripts\/claude-compat-ci\.mjs/);
    expect(report).toMatch(/if \(!identity\)/);
    expect(report).toContain('github.rest.issues.create');
  });
});
