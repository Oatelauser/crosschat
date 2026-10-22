import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSessionMembershipService } from '../src/application/session-membership/index.js';
import type { DiscoveryEndpoint } from '../src/application/discovery/model.js';
import { SenderConn } from '../src/serve/via-tcp.js';

const directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('exact membership IPv6 targets', () => {
  it.each(['2001:db8::1', '[2001:db8::1]'])('connects to the selected %s host with one bracket pair', async (host) => {
    const baseDir = await mkdtemp(join(tmpdir(), 'crosschat-membership-ipv6-'));
    directories.push(baseDir);
    const open = vi.spyOn(SenderConn, 'open').mockRejectedValue(new Error('Controlled transport boundary; no socket is opened.'));
    const execute = vi.fn<DiscoveryEndpoint['execute']>(async () => { throw new Error('Removal must not inspect native sessions.'); });
    const spawnServeDetach = vi.fn();
    const app = createSessionMembershipService({
      baseDir, discovery: { execute }, machineId: () => 'a'.repeat(32), spawnServeDetach,
      readText: async () => JSON.stringify({ brokers: [{ host, port: 7260, starId: 'exact-star', key: 'fixture-member-key' }] }),
    });

    expect(await app.check({ op: 'remove', starId: 'exact-star', ref: { contextId: 'local', providerId: 'claude', nativeId: 'exact-session' } })).toMatchObject({ allowed: false });
    expect(open).toHaveBeenCalledExactlyOnceWith('ws://[2001:db8::1]:7260', 'fixture-member-key', undefined, 8_000, undefined);
    expect(execute).not.toHaveBeenCalled();
    expect(spawnServeDetach).not.toHaveBeenCalled();
  });
});
