import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { runServe } from '../src/commands/serve.js';
import type { ServeDeps } from '../src/commands/serve.js';
import type { SendDeps } from '../src/application/send/types.js';
import { attachPipePath } from '../src/serve/node.js';
import type { BrokerEntry } from '../src/serve/node-config.js';
import { registryFileOf } from '../src/serve/registry.js';
import { SenderConn } from '../src/serve/via-tcp.js';
import { MultichatError } from '../src/errors.js';

const root = mkdtempSync(join(tmpdir(), 'crosschat-serve-tool-bridge-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const MID = 'test-broker-machine';
const STAR_ID = 'aabbccddeeff';
const KEY = 'a'.repeat(64);

function fixture() {
  const dir = mkdtempSync(join(root, 'case-'));
  const codex = [
    { id: 'same-native-id', name: 'same-name', endpointType: 'cli', status: 'idle' as const },
    { id: 'same-native-id', name: 'same-name', endpointType: 'desktop', status: 'idle' as const },
  ];
  const listCodexThreads: SendDeps['listCodexThreads'] = vi.fn(async (options) => codex.filter((row) => options?.endpointType === undefined || options.endpointType === row.endpointType));
  const deliverCodex: SendDeps['deliverCodex'] = vi.fn(async () => ({ status: 'accepted', turnId: 'fixture-turn' }));
  const send: SendDeps = {
    env: {},
    listClaudeSessions: () => ({ sessions: [], malformed: 0 }),
    listCodexThreads,
    deliverClaude: async () => ({ status: 'delivered' }),
    deliverCodex,
    sendLogFile: join(dir, 'send-log.jsonl'),
    outboxDir: join(dir, 'outbox'),
    now: Date.now,
    hostname: () => 'fixture-host',
    machineId: () => MID,
  };
  const lines: string[] = [];
  const deps: ServeDeps = {
    baseDir: dir,
    stdout: (line) => lines.push(line),
    stderr: (line) => lines.push(line),
    env: {},
    version: 'test',
    machineId: () => MID,
    hostname: () => 'fixture-host',
    networkInterfaces: () => ({}),
    now: Date.now,
    onSignal: () => {},
    listServeProcesses: () => [],
    makeSendDeps: () => send,
  };
  mkdirSync(join(dir, 'tcp'), { recursive: true });
  return { dir, lines, send, deps, codex, deliverCodex, listCodexThreads };
}

describe('serve endpoint type bridges', () => {
  it.each(['cli', 'desktop'])('keeps the selected %s endpoint when TCP delivers to the broker machine', async (endpointType) => {
    const f = fixture();
    writeFileSync(registryFileOf(f.dir), JSON.stringify({ port: 0, stars: [{
      starId: STAR_ID, name: 'fixture-star', roster: [],
      nodes: [{ label: 'self', key: KEY, machineId: MID, machineName: 'fixture-host', addedAt: new Date().toISOString() }],
    }] }));
    let stop: (() => void) | undefined;
    const done = runServe({}, { ...f.deps, onSignal: (_signal, callback) => { stop = callback; } });
    let sender: SenderConn | undefined;
    try {
      await vi.waitFor(() => expect(stop).toBeDefined());
      const status: unknown = JSON.parse(readFileSync(join(f.dir, 'tcp', 'status-broker.json'), 'utf8'));
      if (typeof status !== 'object' || status === null || !('port' in status) || typeof status.port !== 'number') throw new Error('fixture broker did not publish a port');
      sender = await SenderConn.open(`ws://127.0.0.1:${status.port}`, KEY, undefined, 3_000);
      await sender.send({ op: 'send', id: 'typed-local', targetMachine: 'fixture-host', to: 'same-name', tool: `codex-${endpointType}`, body: 'isolated message' });
      const result = await sender.waitFor((frame) => (frame.op === 'receipt' || frame.op === 'error') && frame.id === 'typed-local', 3_000);
      expect(result).toMatchObject({ op: 'receipt', status: 'delivered' });
      expect(f.deliverCodex).toHaveBeenCalledExactlyOnceWith('same-native-id', expect.any(String), expect.objectContaining({ endpointType }));
    } finally {
      sender?.close();
      stop?.();
      await done;
    }
  });

  it.each(['cli', 'desktop'])('adopts the selected %s endpoint without reading an unavailable other Codex domain', async (endpointType) => {
    const f = fixture();
    f.send.listCodexThreads = vi.fn(async (options) => {
      if (options?.endpointType !== endpointType) throw new Error('The unrelated Codex domain is unavailable.');
      return options.complete === true ? f.codex.filter((row) => row.endpointType === endpointType) : [];
    });
    f.send.listClaudeSessions = vi.fn(() => { throw new Error('The unrelated Claude registry is unavailable.'); });
    f.send.listOpenCodeThreads = vi.fn(async () => { throw new MultichatError('OPENCODE_UNAVAILABLE', 'The unrelated OpenCode source is unavailable.'); });
    f.send.listDshThreads = vi.fn(async () => { throw new MultichatError('DSH_UNAVAILABLE', 'The unrelated Harness source is unavailable.'); });
    const entry: BrokerEntry = { host: '127.0.0.1', port: 1, name: 'fixture-star', key: KEY, starId: STAR_ID };
    writeFileSync(join(f.dir, 'tcp', 'node.json'), JSON.stringify({ brokers: [entry] }));
    const requests: Record<string, unknown>[] = [];
    const sockets = new Set<import('node:net').Socket>();
    const server = createServer((socket) => {
      sockets.add(socket);
      socket.once('close', () => sockets.delete(socket));
      let pending = '';
      socket.setEncoding('utf8');
      socket.on('data', (chunk) => {
        pending += chunk;
        let newline: number;
        while ((newline = pending.indexOf('\n')) >= 0) {
          const input: unknown = JSON.parse(pending.slice(0, newline));
          pending = pending.slice(newline + 1);
          if (typeof input !== 'object' || input === null || !('op' in input)) throw new Error('invalid fixture request');
          requests.push(input);
          socket.write(`${JSON.stringify(input.op === 'status' ? { ok: true, online: true, brokerCap: true, members: [] } : { ok: true })}\n`);
        }
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(attachPipePath(entry, join(f.dir, 'tcp')), resolve);
    });
    try {
      expect(await runServe({ connect: 'fixture-star', adopt: `codex-${endpointType}/same-name` }, f.deps)).toBe(0);
      expect(f.send.listCodexThreads).toHaveBeenCalledWith({ complete: true, endpointType });
      expect(f.send.listClaudeSessions).not.toHaveBeenCalled();
      expect(f.send.listOpenCodeThreads).not.toHaveBeenCalled();
      expect(f.send.listDshThreads).not.toHaveBeenCalled();
      expect(requests.filter((request) => request.op === 'attach')).toEqual([
        expect.objectContaining({ sessionId: 'same-native-id', tool: 'codex', endpointType, name: 'same-name' }),
      ]);
    } finally {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
    }
  });

  it.each(['dsh-host', 'dsh-desktop'])('preserves a missing selected %s source instead of reporting a name miss', async (tool) => {
    const f = fixture();
    const endpointType = tool === 'dsh-host' ? 'host' : 'desktop';
    const entry: BrokerEntry = { host: '127.0.0.1', port: 1, name: 'fixture-star', key: KEY, starId: STAR_ID };
    writeFileSync(join(f.dir, 'tcp', 'node.json'), JSON.stringify({ brokers: [entry] }));
    f.send.listCodexThreads = vi.fn(async () => { throw new Error('The unrelated Codex source must not be read.'); });
    f.send.listDshThreads = vi.fn(async (options) => {
      if (options?.endpointType !== endpointType) throw new MultichatError('DSH_UNAVAILABLE', 'An unrelated Harness instance is unavailable.');
      throw new MultichatError('DSH_NOT_CONFIGURED', 'The selected Harness bridge is missing.');
    });
    expect(await runServe({ connect: 'fixture-star', adopt: `${tool}/missing-id` }, f.deps)).toBe(1);
    expect(f.lines).toContain('adopt: The selected Harness bridge is missing.');
    expect(f.send.listCodexThreads).not.toHaveBeenCalled();
    expect(f.send.listDshThreads).toHaveBeenCalledWith({ endpointType });
    expect(f.deliverCodex).not.toHaveBeenCalled();
  });
});
