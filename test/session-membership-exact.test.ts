import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Broker } from '../src/serve/broker.js';
import { parseFrame } from '../src/serve/protocol.js';
import { loadBrokerFile, writeBrokerFile } from '../src/serve/registry.js';
import type { RosterEntry } from '../src/serve/registry.js';
import { SenderConn, requestMemberRemove } from '../src/serve/via-tcp.js';

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const machine = '11111111222233334444555555555555';
const otherMachine = '66666666777788889999aaaaaaaaaaaa';
const memberKey = 'a'.repeat(64);
const otherKey = 'b'.repeat(64);
const target = { sessionId: 'native/full-session-id', machine, tool: 'claude' };
function row(sessionId: string, name: string, tool = 'claude', owner = machine): RosterEntry {
  return { sessionId, name, tool, machine: owner, machineName: 'fixture-machine', online: false };
}
async function fixture(roster: RosterEntry[]) {
  const base = await mkdtemp(join(tmpdir(), 'crosschat-member-exact-'));
  cleanups.push(() => rm(base, { recursive: true, force: true }));
  const registryFile = join(base, 'broker.json');
  writeBrokerFile(registryFile, { stars: [
    { starId: 'star-a', name: 'alpha', nodes: [{ label: 'member', key: memberKey, addedAt: '2026-01-01' }], roster },
    { starId: 'star-b', name: 'beta', nodes: [{ label: 'other', key: otherKey, addedAt: '2026-01-01' }], roster: [row(target.sessionId, 'other-star')] },
  ] });
  const broker = new Broker({ registryFile, statusFile: join(base, 'status.json'), machineId: () => otherMachine, hostname: () => 'fixture-broker',
    version: 'fixture', now: Date.now, log: () => undefined, deliverLocal: async (frame) => ({ op: 'result', id: frame.id, status: 'delivered' }), port: 0, heartbeatMs: 60_000 });
  const port = await broker.start();
  cleanups.push(() => broker.stop());
  const connection = await SenderConn.open(`ws://127.0.0.1:${port}`, memberKey, undefined, 1000);
  cleanups.push(() => connection.close());
  return { connection, registryFile, entry: { host: '127.0.0.1', port, key: memberKey, starId: 'star-a' } };
}

describe('atomic exact member removal', () => {
  it('validates exact request and response boundaries independently of legacy selector frames', () => {
    const valid = { op: 'member-remove-exact', id: 'request-id', ...target };
    expect(parseFrame(JSON.stringify(valid))).toEqual(valid);
    for (const invalid of [
      { ...valid, id: '' }, { ...valid, sessionId: '' }, { ...valid, machine: '' }, { ...valid, tool: '' }, { ...valid, tool: undefined }, { ...valid, machine: 7 },
    ]) expect(parseFrame(JSON.stringify(invalid))).toBeUndefined();
    expect(parseFrame(JSON.stringify({ op: 'member-remove-exact-result', id: 'request-id', ok: true, removed: true }))).toMatchObject({ ok: true, removed: true });
    expect(parseFrame(JSON.stringify({ op: 'member-remove-exact-result', id: 'request-id', ok: true, removed: 'yes' }))).toBeUndefined();
    expect(parseFrame('{"op":"member-remove","target":"legacy-name"}')).toMatchObject({ target: 'legacy-name' });
  });

  it('removes only the exact full session, machine and tool with ordinary star membership authority', async () => {
    const { requestMemberRemoveExact } = await import('../src/serve/via-tcp.js');
    const { connection, registryFile } = await fixture([row(target.sessionId, 'shared-name'), row('other-session', 'shared-name', 'codex')]);
    expect(await requestMemberRemoveExact(connection, target, 1000)).toMatchObject({ op: 'member-remove-exact-result', ok: true, removed: true });
    const stars = loadBrokerFile(registryFile).stars;
    expect(stars[0].roster.map((item) => item.sessionId)).toEqual(['other-session']);
    expect(stars[1].roster.map((item) => item.sessionId)).toEqual([target.sessionId]);
  });

  it('rejects a vanished exact target without falling back to another member with that name or prefix', async () => {
    const { requestMemberRemoveExact } = await import('../src/serve/via-tcp.js');
    const { connection, registryFile } = await fixture([row('different-id', target.sessionId), row(`${target.sessionId}-longer`, 'prefix-neighbor')]);
    expect(await requestMemberRemoveExact(connection, target, 1000)).toMatchObject({ ok: false, removed: false, code: 'TARGET_CHANGED' });
    expect(loadBrokerFile(registryFile).stars[0].roster).toHaveLength(2);
  });

  it('rejects changed machine or Provider identity and does not accept a machine prefix', async () => {
    const { requestMemberRemoveExact } = await import('../src/serve/via-tcp.js');
    const { connection, registryFile } = await fixture([row(target.sessionId, 'changed-owner', 'codex', otherMachine)]);
    for (const expected of [target, { ...target, machine: otherMachine }, { ...target, machine: otherMachine.slice(0, 8), tool: 'codex' }]) {
      expect(await requestMemberRemoveExact(connection, expected, 1000)).toMatchObject({ ok: false, removed: false, code: 'TARGET_CHANGED' });
    }
    expect(loadBrokerFile(registryFile).stars[0].roster).toHaveLength(1);
  });

  it('rejects an unverified Provider and preserves the old CLI selector removal behavior', async () => {
    const { requestMemberRemoveExact } = await import('../src/serve/via-tcp.js');
    const unverified = row(target.sessionId, 'legacy-name');
    delete unverified.tool;
    const { connection, registryFile, entry } = await fixture([unverified]);
    expect(await requestMemberRemoveExact(connection, target, 1000)).toMatchObject({ ok: false, removed: false });
    expect(await requestMemberRemove(entry, 'legacy-name', 1000)).toMatchObject({ ok: true, removed: ['legacy-name'] });
    expect(loadBrokerFile(registryFile).stars[0].roster).toEqual([]);
  });
});
