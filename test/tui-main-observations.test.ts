import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import os from 'node:os';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { isValidElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runTui } from '../src/tui/main.js';
import { encodeRef } from '../src/ref.js';
import type { TuiController } from '../src/tui/app/controller.js';

const mocks = vi.hoisted(() => ({ discovery: vi.fn(), membership: vi.fn(), overview: vi.fn(), status: vi.fn(), doctor: vi.fn(), communications: vi.fn(), outbox: vi.fn(), logs: vi.fn(), render: vi.fn() }));
vi.mock('../src/application/discovery/local.js', () => ({ createLocalDiscoveryService: mocks.discovery }));
vi.mock('../src/application/session-membership/index.js', () => ({ createSessionMembershipService: mocks.membership }));
vi.mock('../src/application/observations/overview.js', async (original) => ({ ...await original<object>(), createLocalOverview: mocks.overview }));
vi.mock('../src/application/observations/communications.js', () => ({ queryCommunications: mocks.communications, queryOutbox: mocks.outbox }));
vi.mock('../src/application/observations/logs.js', () => ({ queryManagedLog: mocks.logs }));
vi.mock('ink', () => ({ render: mocks.render }));
vi.mock('../src/tui/ui/app.js', () => ({ TuiApp: () => null }));

class Input extends PassThrough { isTTY = true; isRaw = false; setRawMode(value: boolean) { this.isRaw = value; return this; } }
class Output extends PassThrough { isTTY = true; columns = 100; rows = 28; }
const homes: string[] = [];
const nativeId = '11111111-1111-1111-1111-000000000001';
const sessionRef = { contextId: 'local', providerId: 'codex', nativeId };
const pairId = `codex:${nativeId}\nhuman`;
const completeness = { completeness: 'complete' as const, observedAt: 42, errors: [] };
async function fixture() {
  const home = await mkdtemp(join(tmpdir(), 'crosschat-t08-main-')); homes.push(home);
  const stderr = new PassThrough(); stderr.resume();
  return { home, stdin: new Input(), stdout: new Output(), stderr, signals: new EventEmitter(), version: 'fixture', contexts: [{ id: 'local', kind: 'local', label: '本机' }, { id: 'ssh:fixture', kind: 'ssh', label: 'SSH' }] };
}
function controller(): TuiController {
  const element: unknown = mocks.render.mock.calls[0]?.[0];
  if (!isValidElement<{ controller: TuiController }>(element)) throw new Error('Expected controller');
  return element.props.controller;
}
function command(text: string) { for (const name of `:${text}`) controller().handleKey({ name, text: name }); controller().handleKey({ name: 'enter' }); }

beforeEach(() => {
  vi.clearAllMocks();
  const capabilities = { discovery: true, delivery: true, launch: false, diagnostics: false };
  mocks.discovery.mockReturnValue({ execute: async () => ({ op: 'list', providers: [{ providerId: 'codex', capabilities }], page: { ...completeness, nextCursor: null,
    items: [{ ref: sessionRef, name: 'fixture', rawStatus: 'idle', attributes: {}, capabilities }] } }) });
  mocks.membership.mockReturnValue({ listTargets: async () => ({ ...completeness, stars: [] }) });
  mocks.status.mockResolvedValue({ ...completeness, providers: [{ providerId: 'codex', count: 1, anonymous: 0, completeness: 'complete' }], connections: [], services: [], outbox: { threads: 1, items: 1 }, watchdog: { running: null, evidence: 'missing' }, lastDoctor: null });
  mocks.doctor.mockResolvedValue({ ...completeness, checks: [], summary: { pass: 0, warn: 0, error: 0, failed: false } });
  mocks.overview.mockReturnValue({ readStatus: mocks.status, readDoctor: mocks.doctor });
  mocks.communications.mockResolvedValue({ ...completeness, items: [{ id: pairId, pairId, contextId: 'local', endpoints: [`codex:${nativeId}`, 'human'], names: ['fixture', 'human'],
    ref: encodeRef({ v: 1, f: { p: 'human' }, t: { p: 'codex', id: nativeId }, n: '0123456789abcdef', c: 1 }), updatedAt: 42, channel: 'local', turn: 1, status: 'parked', receipt: null, parked: 1, localSessionRefs: [sessionRef] }] });
  mocks.outbox.mockResolvedValue({ ...completeness, items: [{ id: nativeId, contextId: 'local', providerId: 'codex', threadId: nativeId, toName: 'fixture', count: 1, oldestParkedAt: 42,
    mailboxFile: '/isolated/mailbox.md', state: 'ready', items: [{ id: 'queue-one', parkedAt: 42, attempts: 0, toName: 'fixture', callerKey: 'human' }] }] });
  mocks.logs.mockResolvedValue({ ...completeness, source: { id: 'send-log', label: '投递日志', path: '/isolated/send-log.jsonl' }, sources: [], bytesRead: 100, truncated: false, omittedLeadingLine: false, rotated: false,
    items: [{ id: 'log/one', offset: 0, text: 'isolated log line', terminated: true }] });
  mocks.render.mockImplementation(() => { let finish!: () => void; const done = new Promise<void>((resolve) => { finish = resolve; }); return { unmount: finish, waitUntilExit: () => done }; });
});
afterEach(async () => { await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true }))); });

describe('default local observation wiring', () => {
  it('preserves native environment paths when the caller has not requested an isolated home', async () => {
    const io = await fixture();
    const homeProbe = vi.spyOn(os, 'homedir').mockReturnValue(io.home);
    syncBuiltinESMExports();
    const active = runTui({ ...io, home: undefined });
    try {
      await vi.waitFor(() => expect(mocks.render).toHaveBeenCalledOnce());
      expect(mocks.discovery).toHaveBeenCalledWith({});
      expect(mocks.overview).toHaveBeenCalledWith(expect.objectContaining({ home: io.home, nativeEnvironment: 'inherit' }));
    } finally {
      io.signals.emit('SIGTERM'); await active;
      homeProbe.mockRestore(); syncBuiltinESMExports();
    }
  });
  it('installs the five real readonly resources lazily and preserves exact related routes', async () => {
    const io = await fixture(); const active = runTui(io);
    try {
      await vi.waitFor(() => expect(mocks.render).toHaveBeenCalledOnce());
      for (const read of [mocks.status, mocks.doctor, mocks.communications, mocks.outbox, mocks.logs]) expect(read).not.toHaveBeenCalled();
      command('status');
      await vi.waitFor(() => expect(controller().getSnapshot().rows).toHaveLength(6));
      expect(mocks.doctor).not.toHaveBeenCalled();
      command('doctor'); await vi.waitFor(() => expect(mocks.doctor).toHaveBeenCalledOnce());
      command('deliveries'); await vi.waitFor(() => expect(controller().getSnapshot().rows).toHaveLength(1));
      controller().handleKey({ name: 'w' });
      await vi.waitFor(() => expect(controller().getSnapshot().route).toEqual({ resourceId: 'outbox', contextId: 'local', query: { pairId } }));
      await vi.waitFor(() => expect(controller().getSnapshot().rows).toHaveLength(1));
      controller().handleKey({ name: 'o' });
      await vi.waitFor(() => expect(controller().getSnapshot().route).toEqual({ resourceId: 'deliveries', contextId: 'local', query: { pairId } }));
      await vi.waitFor(() => expect(controller().getSnapshot().rows).toHaveLength(1));
      controller().handleKey({ name: 'l' });
      await vi.waitFor(() => expect(controller().getSnapshot().rows[0]?.cells.line).toBe('isolated log line'));
      expect(mocks.logs).toHaveBeenCalledWith(expect.objectContaining({ baseDir: join(io.home, '.crosschat'), sourceId: 'send-log', pairId }));
      expect(mocks.communications).toHaveBeenCalledWith(expect.objectContaining({ baseDir: join(io.home, '.crosschat'), contextId: 'local' }));
    } finally { io.signals.emit('SIGTERM'); await active; }
  });

  it('enables sessions-to-observation links only through installed default resources and full native references', async () => {
    const io = await fixture(); const active = runTui(io);
    try {
      await vi.waitFor(() => expect(mocks.render).toHaveBeenCalledOnce());
      controller().handleKey({ name: 'enter' });
      await vi.waitFor(() => expect(controller().getSnapshot().rows).toHaveLength(1));
      controller().handleKey({ name: 'o' });
      await vi.waitFor(() => expect(controller().getSnapshot().route.resourceId).toBe('deliveries'));
      expect(JSON.parse(controller().getSnapshot().route.query?.sessionRef ?? 'null')).toEqual(sessionRef);
      controller().handleKey({ name: 'escape' });
      controller().handleKey({ name: 'l' });
      await vi.waitFor(() => expect(controller().getSnapshot().route.resourceId).toBe('logs'));
      expect(JSON.parse(controller().getSnapshot().route.query?.sessionRef ?? 'null')).toEqual(sessionRef);
    } finally { io.signals.emit('SIGTERM'); await active; }
  });
});
