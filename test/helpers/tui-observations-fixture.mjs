import process from 'node:process';
import { appendFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout, clearTimeout } from 'node:timers';
import { createElement } from 'react';
import { render, Text } from 'ink';
import { encodeRef } from '../../dist/ref.js';
import { runTui } from '../../dist/tui/main.js';
import { createResourceRegistry, defaultResources } from '../../dist/tui/resources/registry.js';
import { createSessionsResource } from '../../dist/tui/resources/sessions.js';
import { createLogsResource } from '../../dist/tui/resources/logs.js';
import { createCommunicationResources } from '../../dist/tui/resources/communications.js';
import { createStatusResource, createDoctorResource } from '../../dist/tui/resources/overview.js';
import { queryManagedLog } from '../../dist/application/observations/logs.js';

// Every source and clipboard effect belongs to this temporary ConPTY fixture.
const home = process.env.TUI_OBSERVATIONS_HOME;
const evidence = process.env.TUI_OBSERVATIONS_EVIDENCE;
if (!home || !evidence) throw new Error('Observation fixture requires explicit isolated paths.');
const baseDir = join(home, '.crosschat');
await mkdir(join(baseDir, 'tcp'), { recursive: true });
await mkdir(join(baseDir, 'outbox'), { recursive: true });
const record = (event) => appendFileSync(evidence, `${JSON.stringify({ at: Date.now(), ...event })}\n`);
const listeners = () => Object.fromEntries(['SIGINT', 'SIGTERM', 'uncaughtException', 'unhandledRejection'].map((event) => [event, process.listenerCount(event)]));
const warmup = render(createElement(Text, null, 'observations fixture baseline'), { interactive: true, patchConsole: false, exitOnCtrlC: false });
await warmup.waitUntilRenderFlush(); warmup.unmount(); await warmup.waitUntilExit();
const before = { raw: process.stdin.isRaw === true, listeners: listeners(), resize: process.stdout.listenerCount('resize') };
const observedAt = 1_800_000_000_000;
const sessionRef = { contextId: 'local', providerId: 'codex', nativeId: 'observation-target-full-id' };
const pairId = 'claude:observation-sender-full-id\ncodex:observation-target-full-id';
const savedRef = encodeRef({ v: 1, f: { p: 'claude', id: 'observation-sender-full-id' }, t: { p: 'codex', id: sessionRef.nativeId }, n: '0102030405060708', c: 3 });
const mailboxFile = join(baseDir, 'outbox', 'observation-target-full-id.md');
const audit = (event) => JSON.stringify({ event, target: `codex:${sessionRef.nativeId}`, from: 'claude:observation-sender-full-id', replyRef: savedRef, status: 'queued' });
const longEvent = `LONG-中文👩‍💻-${'完整日志内容👩‍💻'.repeat(90)}-DETAIL-END`;
const duplicate = audit('重复投递日志-中文👩‍💻');
const privateLine = JSON.stringify({ ...JSON.parse(audit('LOG-FIRST')), body: 'observation-private-message', key: 'observation-private-key' });
await writeFile(join(baseDir, 'send-log.jsonl'), [privateLine, duplicate, duplicate, audit(longEvent), audit('LOG-LATEST')].join('\n') + '\n');
await writeFile(join(baseDir, 'tcp', 'broker.log'), 'BROKER-FIRST-中文👩‍💻\nBROKER-LATEST\n');
await writeFile(mailboxFile, '# Isolated metadata-only mailbox fixture\n');
record({ event: 'fixture-ready', home, baseDir, sessionRef, pairId, savedRef, mailboxFile, duplicate, longLine: audit(longEvent) });

/** @type {import('../../dist/application/observations/communications.js').CommunicationSummary} */
const communication = { id: 'observation-communication-full-id', contextId: 'local', pairId,
  endpoints: ['claude:observation-sender-full-id', `codex:${sessionRef.nativeId}`], names: ['发送端fixture', '接收端fixture'], ref: savedRef,
  updatedAt: observedAt, channel: 'local', turn: 3, status: 'queued', receipt: 'fixture-unconfirmed', parked: 1, localSessionRefs: [sessionRef] };
/** @type {import('../../dist/application/observations/communications.js').OutboxThreadMetadata} */
const queue = { id: 'observation-queue-full-id', contextId: 'local', providerId: 'codex', threadId: sessionRef.nativeId,
  toName: '接收端fixture', count: 1, oldestParkedAt: observedAt, mailboxFile, state: 'ready', items: [
    { id: 'observation-item-full-id', parkedAt: observedAt, attempts: 1, toName: '接收端fixture', callerKey: 'claude:observation-sender-full-id', deliveryState: 'uncertain' },
  ] };
/** @type {import('../../dist/application/observations/overview.js').DoctorObservation} */
const doctorResult = { completeness: 'complete', observedAt, errors: [], summary: { pass: 1, warn: 0, error: 0, failed: false }, checks: [
  { id: 'doctor-fixture-stable-id', group: '本机fixture', code: 'fixture-read-only', level: 'pass', label: '隔离体检fixture', description: 'DOCTOR-FIXTURE-READY',
    guidance: '仅示例：在本机检查fixture配置；不会自动修复。', facts: [{ label: '只读证据', value: '没有启动服务、修复或补投。' }] },
] };
let doctorCalls = 0;
let lastDoctor = null;
/** @type {import('../../dist/application/observations/overview.js').LocalOverview} */
const overview = {
  async readStatus({ contextId }) {
    record({ event: 'status-read', contextId });
    return { completeness: 'complete', observedAt, errors: [], providers: [{ providerId: 'codex', count: 1, anonymous: 0, completeness: 'complete' }],
      connections: [], services: [], outbox: { threads: 1, items: 1 }, watchdog: { running: null, evidence: 'missing' }, lastDoctor };
  },
  async readDoctor({ contextId, signal }) {
    doctorCalls++;
    record({ event: 'doctor-read', contextId, attempt: doctorCalls });
    if (doctorCalls === 1) return new Promise((_, reject) => {
      const abort = () => { record({ event: 'doctor-aborted', attempt: doctorCalls }); reject(new Error('fixture doctor cancelled')); };
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
    });
    lastDoctor = doctorResult;
    return doctorResult;
  },
};
const communications = createCommunicationResources({
  async readCommunications({ contextId }) { record({ event: 'communications-read', contextId }); return { items: [communication, { ...communication, id: 'unrelated-communication', pairId: 'claude:other\ncodex:neighbor-full-id', endpoints: ['claude:other', 'codex:neighbor-full-id'], names: ['不相关端点', '同名近邻'], ref: null, parked: 0, localSessionRefs: [{ ...sessionRef, nativeId: 'neighbor-full-id' }] }], completeness: 'complete', observedAt, errors: [] }; },
  async readOutbox({ contextId }) { record({ event: 'outbox-read', contextId }); return { items: [queue], completeness: 'complete', observedAt, errors: [] }; },
});
const logs = createLogsResource({ intervalMs: 150, read: (options) => queryManagedLog({ ...options, baseDir, maxBytes: 64 * 1024 }) });
const status = createStatusResource({ overview });
const doctor = createDoctorResource({ overview });
const capabilities = { discovery: true, delivery: true, launch: false, diagnostics: false };
const discovery = { async execute(_input, options) {
  record({ event: 'sessions-read', contextId: options.contextId });
  return { op: 'list', providers: [{ providerId: 'codex', capabilities }], page: { items: [{ ref: sessionRef, name: '观察会话fixture', rawStatus: 'idle', capabilities, attributes: { cwd: 'D:/fixture/中文👩‍💻' } }], nextCursor: null, completeness: 'complete', observedAt, errors: [] } };
} };
const sessions = createSessionsResource({ discovery, relatedResources: ['deliveries', 'logs'] });

function observe(id, adapter) {
  const describe = (page, route, event) => record({ event, resourceId: id, route, ids: page.rows.map((row) => row.id), texts: id === 'logs' ? page.rows.map((row) => row.copyValue) : undefined, notice: page.notice });
  return {
    ...adapter,
    async read(request) {
      record({ event: 'resource-read', resourceId: id, route: request.route });
      const page = await adapter.read(request);
      describe(page, request.route, 'resource-page');
      return page;
    },
    ...(adapter.watch ? { async watch(request, publish) {
      record({ event: 'watch-start', route: request.route });
      const aborted = () => record({ event: 'watch-aborted', route: request.route });
      request.signal.addEventListener('abort', aborted, { once: true });
      try { await adapter.watch(request, (page) => { describe(page, request.route, 'watch-page'); publish(page); }); }
      finally { request.signal.removeEventListener('abort', aborted); record({ event: 'watch-end', route: request.route }); }
    } } : {}),
  };
}
const implemented = [sessions, status, doctor, communications.deliveries, communications.outbox, logs];
const byId = new Map(implemented.map((item) => [item.resource.id, item]));
const registry = createResourceRegistry(defaultResources.map((resource) => byId.get(resource.id)?.resource ?? resource));
const adapters = Object.fromEntries(implemented.map((item) => [item.resource.id, observe(item.resource.id, item.adapter)]));
const resize = () => record({ event: 'resize', columns: process.stdout.columns, rows: process.stdout.rows });
process.stdout.on('resize', resize);
let failure;
if (process.env.TUI_OBSERVATIONS_SCENARIO === 'failure') failure = setTimeout(() => process.emit('uncaughtException', new Error('observation-fixture-private-error')), 2000);
const code = await runTui({ home, contexts: [{ id: 'local', kind: 'local', label: '本机观察fixture', target: 'isolated-observation-fixture' }], registry, adapters,
  clipboard: async (value) => { record({ event: 'clipboard', value }); },
});
clearTimeout(failure);
process.stdout.off('resize', resize);
record({ event: 'exit', code, before, after: { raw: process.stdin.isRaw === true, listeners: listeners(), resize: process.stdout.listenerCount('resize') } });
process.exitCode = code;
