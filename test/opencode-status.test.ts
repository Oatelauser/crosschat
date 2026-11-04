import { describe, expect, it } from 'vitest';
import { runStatus } from '../src/commands/status.js';
import type { StatusDeps } from '../src/commands/status.js';
import { buildStatusPayload } from '../src/serve/node.js';
import { MultichatError } from '../src/errors.js';
import type { OpenCodeThread } from '../src/opencode/client.js';
import type { StatusPayload } from '../src/serve/protocol.js';

const thread: OpenCodeThread = {
  id: 'ses_opaque/native@雪', name: 'Worker', cwd: '/isolated/workspace',
  rawStatus: { type: 'retry', attempt: 2 }, attributes: { projectID: 'project-1' },
};
const base: StatusDeps = {
  listClaudeSessions: () => ({ sessions: [], malformed: 0 }),
  listCodexThreads: async () => [], now: () => 100,
};

describe('OpenCode status', () => {
  it('shows full opaque identity and native status in a separate selected JSON section', async () => {
    const deps: StatusDeps = { ...base, listOpenCodeThreads: async () => [thread] };
    expect(JSON.parse(await runStatus(deps, true, false, { section: 'opencode' })))
      .toEqual({ opencode: [thread] });
    const text = await runStatus(deps, false, false, { section: 'opencode' });
    expect(text).toContain('opencode:');
    expect(text).toContain(thread.id);
    expect(text).toContain('retry');
    expect(text).not.toContain('claude:');
    expect(text).not.toContain('codex:');
  });

  it('retains old output when the optional source is absent, empty or not installed', async () => {
    for (const json of [false, true]) {
      const legacy = await runStatus(base, json);
      expect(await runStatus({ ...base, listOpenCodeThreads: async () => [] }, json)).toBe(legacy);
      expect(await runStatus({ ...base, listOpenCodeThreads: async () => {
        throw new MultichatError('OPENCODE_NOT_CONFIGURED', 'No OpenCode service registered.');
      } }, json)).toBe(legacy);
    }
  });

  it('adds named sessions to the summary and applies normal name and unnamed filters', async () => {
    const deps: StatusDeps = { ...base, listOpenCodeThreads: async () => [thread, { ...thread, id: 'ses_unnamed', name: null }] };
    const summary = await runStatus(deps, false);
    expect(summary).toContain('opencode 2');
    expect(summary).toContain('opencode Worker');
    expect(await runStatus(deps, false, false, { name: 'work' })).toContain('Worker');
    expect(await runStatus(deps, false, false, { section: 'opencode' })).not.toContain('ses_unnamed');
    expect(await runStatus(deps, false, false, { section: 'opencode', all: true })).toContain('ses_unnamed');
  });

  it('reports configured service failures without failing legacy status sources', async () => {
    const deps: StatusDeps = { ...base, listOpenCodeThreads: async () => {
      throw new MultichatError('OPENCODE_UNAVAILABLE', 'Service unavailable.');
    } };
    expect(JSON.parse(await runStatus(deps, true))).toMatchObject({ claude: [], codex: [], opencode: { error: 'OPENCODE_UNAVAILABLE: Service unavailable.' } });
    expect(await runStatus(deps, false)).toContain('opencode unavailable');
    expect(await runStatus(deps, false, false, { section: 'opencode' })).toContain('OPENCODE_UNAVAILABLE');
  });

  it('includes optional raw OpenCode rows in remote status payloads and renders them separately', async () => {
    const payload = await buildStatusPayload({ ...base, listOpenCodeThreads: async () => [thread] });
    expect(payload).toEqual({ claude: [], codex: [], opencode: [thread] });
    const remote: StatusDeps = { ...base, fetchRemoteStatus: async () => ({ target: 'fixture-peer', payload }) };
    expect(JSON.parse(await runStatus(remote, true, false, { section: 'opencode' }, 'tcp:fixture-peer')))
      .toEqual({ via: 'tcp:fixture-peer', machine: 'fixture-peer', opencode: [thread] });
    const text = await runStatus(remote, false, false, { section: 'opencode' }, 'tcp:fixture-peer');
    expect(text).toContain(thread.id);
    expect(text).toContain('retry');
    expect(text).not.toContain('codex:');
  });

  it('preserves old remote payloads and makes new remote failures explicit', async () => {
    expect(await buildStatusPayload({ ...base, listOpenCodeThreads: async () => [] })).toEqual({ claude: [], codex: [] });
    const payload: StatusPayload = { claude: [], codex: [], opencode: { unavailable: 'OPENCODE_UNAVAILABLE: Service unavailable.' } };
    const remote: StatusDeps = { ...base, fetchRemoteStatus: async () => ({ target: 'fixture-peer', payload }) };
    expect(await runStatus(remote, false, false, { section: 'opencode' }, 'tcp:fixture-peer')).toContain('OPENCODE_UNAVAILABLE');
  });
});
