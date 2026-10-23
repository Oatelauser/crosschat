import { describe, expect, it } from 'vitest';
import { runStatus } from '../src/commands/status.js';
import type { StatusDeps } from '../src/commands/status.js';
import { buildStatusPayload } from '../src/serve/node.js';
import type { StatusPayload } from '../src/serve/protocol.js';
import { MultichatError } from '../src/errors.js';
import type { DshThread } from '../src/dsh/client.js';

const thread: DshThread = { id: 'harness/native@雪', name: 'Harness Worker', cwd: '/isolated/workspace', rawStatus: { type: 'running' }, attributes: { instanceId: 'instance-one' } };
const base: StatusDeps = { listClaudeSessions: () => ({ sessions: [], malformed: 0 }), listCodexThreads: async () => [], now: () => 100 };

describe('DeepSeek Harness local and remote status', () => {
  it('offers a selected optional section with full native ID and raw status', async () => {
    const deps = { ...base, listDshThreads: async () => [thread] };
    expect(JSON.parse(await runStatus(deps, true, false, { section: 'dsh' }))).toEqual({ dsh: [thread] });
    const text = await runStatus(deps, false, false, { section: 'dsh' });
    expect(text).toContain('dsh:');
    expect(text).toContain(thread.id);
    expect(text).toContain('running');
    expect(text).not.toContain('codex:');
  });

  it('preserves old output when Harness is absent, empty or not configured', async () => {
    for (const json of [false, true]) {
      const previous = await runStatus(base, json);
      expect(await runStatus({ ...base, listDshThreads: async () => [] }, json)).toBe(previous);
      expect(await runStatus({ ...base, listDshThreads: async () => { throw new MultichatError('DSH_NOT_CONFIGURED', 'No bridge instance registered.'); } }, json)).toBe(previous);
    }
  });

  it('keeps anonymous JSON rows while text uses ordinary name and all filters', async () => {
    const deps = { ...base, listDshThreads: async () => [thread, { ...thread, id: 'unnamed-harness', name: null }] };
    expect(await runStatus(deps, false)).toContain('dsh 2');
    expect(await runStatus(deps, false)).toContain('dsh Harness Worker');
    expect(await runStatus(deps, false, false, { name: 'harness' })).toContain('Harness Worker');
    expect(await runStatus(deps, false, false, { section: 'dsh' })).not.toContain('unnamed-harness');
    expect(await runStatus(deps, false, false, { section: 'dsh', all: true })).toContain('unnamed-harness');
    expect(JSON.parse(await runStatus(deps, true, false, { section: 'dsh' })).dsh).toHaveLength(2);
  });

  it('shows configured native failures instead of hiding them as an empty source', async () => {
    const deps = { ...base, listDshThreads: async () => { throw new MultichatError('DSH_UNAVAILABLE', 'Bridge unavailable.'); } };
    expect(JSON.parse(await runStatus(deps, true))).toEqual({ claude: [], codex: [], dsh: { error: 'DSH_UNAVAILABLE: Bridge unavailable.' } });
    expect(await runStatus(deps, false)).toContain('dsh unavailable');
    expect(await runStatus(deps, false, false, { section: 'dsh' })).toContain('DSH_UNAVAILABLE');
  });

  it('adds a typed optional remote section without changing legacy payloads', async () => {
    const payload = await buildStatusPayload({ ...base, listDshThreads: async () => [thread] });
    expect(payload).toEqual({ claude: [], codex: [], dsh: [thread] });
    expect(await buildStatusPayload(base)).toEqual({ claude: [], codex: [] });
    expect(await buildStatusPayload({ ...base, listDshThreads: async () => [] })).toEqual({ claude: [], codex: [] });
    const remote = { ...base, fetchRemoteStatus: async () => ({ target: 'fixture-peer', payload }) };
    expect(JSON.parse(await runStatus(remote, true, false, { section: 'dsh' }, 'tcp:fixture-peer'))).toEqual({ via: 'tcp:fixture-peer', machine: 'fixture-peer', dsh: [thread] });
    expect(await runStatus(remote, false, false, { section: 'dsh' }, 'tcp:fixture-peer')).toContain(thread.id);
  });

  it('preserves remote native failures and explains absent remote support when explicitly selected', async () => {
    const payload: StatusPayload = { claude: [], codex: [], dsh: { unavailable: 'DSH_UNAVAILABLE: Bridge unavailable.' } };
    expect(await buildStatusPayload({ ...base, listDshThreads: async () => { throw new MultichatError('DSH_UNAVAILABLE', 'Bridge unavailable.'); } })).toEqual(payload);
    const remote = { ...base, fetchRemoteStatus: async () => ({ target: 'fixture-peer', payload }) };
    expect(await runStatus(remote, false, false, { section: 'dsh' }, 'tcp:fixture-peer')).toContain('DSH_UNAVAILABLE');
    const missing = { ...base, fetchRemoteStatus: async () => ({ target: 'fixture-peer', payload: { claude: [], codex: [] } }) };
    expect(JSON.parse(await runStatus(missing, true, false, { section: 'dsh' }, 'tcp:fixture-peer')).dsh).toHaveProperty('unavailable');
  });

  it('contains malformed new remote sections without trusting their rows or exposing response bodies', async () => {
    const payload: StatusPayload = JSON.parse('{"claude":[],"codex":[],"dsh":[{"id":"native","name":{"secret":"private-upstream-value"}}]}');
    const remote = { ...base, fetchRemoteStatus: async () => ({ target: 'fixture-peer', payload }) };
    const result = await runStatus(remote, true, false, { section: 'dsh' }, 'tcp:fixture-peer');
    expect(JSON.parse(result).dsh.unavailable).toContain('DSH_PROTOCOL_ERROR');
    expect(result).not.toContain('private-upstream-value');
  });
});
