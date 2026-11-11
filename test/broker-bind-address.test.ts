import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Broker } from '../src/serve/broker.js';
import { writeBrokerFile } from '../src/serve/registry.js';

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe('broker fixture bind address', () => {
  it('honors an explicit loopback bind without changing the production default', async () => {
    const root = await mkdtemp(join(tmpdir(), 'crosschat-broker-bind-'));
    roots.push(root);
    const registryFile = join(root, 'broker.json');
    writeBrokerFile(registryFile, { stars: [{ starId: 'loopback-fixture', name: 'loopback-fixture', nodes: [], roster: [] }] });
    const broker = new Broker({ registryFile, statusFile: join(root, 'status.json'), port: 0, listenHost: '127.0.0.1',
      version: 'fixture', machineId: () => '11111111222222223333333344444444', hostname: () => 'fixture', now: Date.now,
      log: () => {}, deliverLocal: async () => { throw new Error('Unexpected local delivery'); } });
    try {
      await broker.start();
      const server = Reflect.get(broker, 'wss') as { address(): unknown } | undefined;
      expect(server?.address()).toMatchObject({ address: '127.0.0.1' });
    } finally { await broker.stop(); }
  });
});
