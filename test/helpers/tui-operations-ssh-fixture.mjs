import process from 'node:process';
import { appendFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout, clearTimeout } from 'node:timers';
import { createElement } from 'react';
import { render, Text } from 'ink';
import { runTui } from '../../dist/tui/main.js';
import { createResourceRegistry, defaultResources } from '../../dist/tui/resources/registry.js';
import { contextsResource, presentContext } from '../../dist/tui/resources/contexts.js';
import { createSessionsResource } from '../../dist/tui/resources/sessions.js';
import { createServicesResource } from '../../dist/tui/resources/services.js';
import { createFilesResource } from '../../dist/tui/resources/files.js';
import { createMaintenanceResource } from '../../dist/tui/resources/maintenance.js';
import { createLogsResource } from '../../dist/tui/resources/logs.js';
import { createStatusResource } from '../../dist/tui/resources/overview.js';
import { createSshResource, createSshSessionsResource, createSshDoctorResource } from '../../dist/tui/resources/ssh.js';
import { MAINTENANCE_OPERATIONS } from '../../dist/application/maintenance/model.js';
import { queryManagedFiles } from '../../dist/application/queries/files.js';
import { queryManagedLog } from '../../dist/application/observations/logs.js';

// Real terminal, controller and resource adapters; all application effects belong to this fixture.
const home = process.env.TUI_OPERATIONS_HOME;
const evidence = process.env.TUI_OPERATIONS_EVIDENCE;
if (!home || !evidence) throw new Error('Operations fixture requires explicit isolated paths.');
const baseDir = join(home, '.crosschat');
const target = join(baseDir, 'tcp', 'inbox', `maintenance-中文👩‍💻-${'long-target-'.repeat(9)}.txt`);
await mkdir(join(baseDir, 'tcp', 'inbox'), { recursive: true });
await writeFile(target, 'FIXTURE-CONTENT-MUST-REMAIN');
await writeFile(join(baseDir, 'tcp', 'node-fixture.log'), 'SERVICE-LOG-FIRST\nSERVICE-LOG-LATEST-中文👩‍💻\n');
const record = (event) => appendFileSync(evidence, `${JSON.stringify({ at: Date.now(), ...event })}\n`);
const listeners = () => Object.fromEntries(['SIGINT', 'SIGTERM', 'uncaughtException', 'unhandledRejection'].map((event) => [event, process.listenerCount(event)]));
const warmup = render(createElement(Text, null, 'operations fixture baseline'), { interactive: true, patchConsole: false, exitOnCtrlC: false });
await warmup.waitUntilRenderFlush(); warmup.unmount(); await warmup.waitUntilExit();
const before = { raw: process.stdin.isRaw === true, listeners: listeners(), resize: process.stdout.listenerCount('resize') };
const observedAt = 1_800_000_000_000;
const complete = { completeness: 'complete', observedAt, errors: [] };
const remoteHost = 'fixture-remote';
const errorHost = 'fixture-error';
const remoteId = `ssh:${remoteHost}`;
const anonymousId = '11111111-1111-1111-1111-000000000222';
const capabilities = { discovery: true, delivery: true, launch: false, diagnostics: false };
const connection = (host) => ({ id: `ssh:${host}`, kind: 'ssh', name: host, target: host, identityHint: `配置的同一 SSH 用户；尚未检测 ${host}`, attributes: { source: join(home, '.ssh', 'config') } });
const remoteConnections = [connection(remoteHost), connection(errorHost)];
record({ event: 'fixture-ready', home, baseDir, target, remoteId, anonymousId });

function discovered(contextId, providerId, nativeId, name, rawStatus = 'idle') { return { ref: { contextId, providerId, nativeId }, name, rawStatus, capabilities, attributes: { cwd: `D:/fixture/远端路径👩‍💻/${'完整长字段/'.repeat(12)}` } }; }
const localDiscovery = { async execute(_input, options) {
  record({ event: 'local-sessions', contextId: options.contextId });
  return { op: 'list', providers: [{ providerId: 'claude', capabilities }], page: { ...complete, nextCursor: null, items: [discovered('local', 'claude', '11111111-1111-1111-1111-000000000111', 'LOCAL-SESSION-FIXTURE')] } };
} };
let doctorCalls = 0;
const diagnostic = { groups: [{ context: { kind: 'environment' }, checks: [{ code: 'node-supported', level: 'pass', data: { version: '24.7.0' } }] }], summary: { pass: 1, warn: 0, error: 0, failed: false } };
const ssh = {
  async list() { record({ event: 'ssh-list' }); return { items: remoteConnections, observedAt, errors: [] }; },
  discovery: { async execute(_input, options) {
    record({ event: 'remote-sessions', contextId: options.contextId });
    if (options.contextId !== remoteId) return { op: 'list', providers: [], page: { ...complete, completeness: 'unavailable', nextCursor: null, items: [], errors: [{ source: { contextId: options.contextId, providerId: 'ssh' }, kind: 'unavailable', message: 'SSH 认证未通过 fixture', nextStep: '在对应 Host 同一用户核对认证 fixture。' }] } };
    return { op: 'list', providers: ['codex', 'future-provider'].map((providerId) => ({ providerId, capabilities })), page: { ...complete, nextCursor: null, items: [
      discovered(remoteId, 'codex', '11111111-1111-1111-1111-000000000221', 'REMOTE-NAMED-FIXTURE'),
      discovered(remoteId, 'codex', anonymousId, null),
      discovered(remoteId, 'future-provider', 'opaque/full/远端未来工具', 'REMOTE-FUTURE-FIXTURE', 'pondering'),
    ] } };
  } },
  async inspect({ contextId }) {
    record({ event: 'ssh-inspect', contextId });
    return { ...complete, contextId, host: contextId === remoteId ? remoteHost : errorHost, sampleCount: contextId === remoteId ? 1 : 0, providers: [{ providerId: 'codex', capabilities }],
      ...(contextId === remoteId ? {} : { completeness: 'unavailable', errors: [{ source: contextId, kind: 'unavailable', message: 'SSH 认证未通过 fixture', nextStep: '核对对应 Host 同一用户的认证 fixture。' }] }) };
  },
  async doctor({ contextId, signal }) {
    doctorCalls++; const attempt = doctorCalls;
    record({ event: 'ssh-doctor', contextId, attempt });
    if (attempt === 1) return { ...complete, contextId, host: remoteHost, result: null, exitCode: 127, completeness: 'unavailable', errors: [{ source: contextId, kind: 'unavailable', message: '远端 crosschat 命令不可用 fixture', nextStep: '用同一 SSH Host 与用户核对非交互 PATH fixture。' }] };
    if (attempt === 2) return new Promise((_, reject) => {
      const abort = () => { signal.removeEventListener('abort', abort); record({ event: 'ssh-doctor-aborted', contextId, attempt }); reject(new Error('fixture owned remote read cancelled')); };
      signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
    });
    return { ...complete, contextId, host: remoteHost, result: diagnostic, exitCode: 0 };
  },
};

let running = false;
const serviceId = 'service:node:full-fixture-target';
const serviceImpact = (operation) => [`${operation === 'start' ? '启动' : '停止'}本机隔离服务；目标 ${serviceId}。`, `SERVICE-IMPACT-FULL-中文👩‍💻-${'long-impact-'.repeat(30)}-END`, '仅服务连接；不结束原生工具、不修改凭证。'];
const service = {
  async read({ contextId }) {
    record({ event: 'services-read', contextId });
    return { ...complete, items: [{ id: serviceId, revision: running ? 'running-1234' : 'not-running', kind: 'node', label: 'SERVICE-FIXTURE', target: 'fixture.invalid:7260', selector: 'fixture', sourceId: 'node:node-fixture.log', state: running ? 'running' : 'not-running', readiness: running ? 'ready' : 'stopped', ...(running ? { pid: 1234 } : {}),
      start: { allowed: !running, impact: serviceImpact('start'), reason: running ? '已有服务运行。' : undefined }, stop: { allowed: running, impact: serviceImpact('stop'), reason: running ? undefined : '没有运行进程。' }, detail: [{ label: '完整目标', value: `${serviceId}\n仅隔离模拟服务，没有真实起停。` }] }] };
  },
  async check(request) {
    record({ event: 'service-check', ...request, signal: undefined });
    const valid = request.id === serviceId && request.revision === (running ? 'running-1234' : 'not-running') && request.contextId === 'local';
    return { allowed: valid, reason: valid ? undefined : '隔离目标变化', impact: serviceImpact(request.operation) };
  },
  async execute(request) {
    record({ event: 'service-effect', ...request, signal: undefined });
    running = request.operation === 'start';
    return { state: 'ready', id: serviceId, pid: 1234, message: running ? 'SERVICE-START-READY' : 'SERVICE-STOP-CONFIRMED' };
  },
};
const maintenance = {
  list: () => MAINTENANCE_OPERATIONS,
  async preview({ operationId }) { record({ event: 'maintenance-preview', operationId }); return { operationId, label: MAINTENANCE_OPERATIONS.find((item) => item.id === operationId).label, observedAt, fingerprint: 'a'.repeat(64), enabled: true,
    targets: [{ path: target, kind: 'file', label: '仅fixture模拟删除目标', bytes: 27, modifiedAt: observedAt - 10 * 86400000 }], effects: ['仅模拟预览和执行，原始fixture文件保持。', 'MAINTENANCE-PREVIEW-FULL-中文👩‍💻-END'] }; },
  async execute({ operationId, expectedFingerprint }) { record({ event: 'maintenance-effect', operationId, expectedFingerprint, target }); return { operationId, status: 'complete', startedAt: observedAt, finishedAt: observedAt + 1, npm: 'not-run', message: 'MAINTENANCE-FIXTURE-COMPLETE', items: [{ path: target, outcome: 'deleted', message: '模拟已删除；工装没有删除任何文件。' }] }; },
};
const overview = { async readStatus({ contextId }) { record({ event: 'status-read', contextId }); return { ...complete, providers: [], connections: [], services: [], outbox: { threads: 0, items: 0 }, watchdog: { running: false, evidence: 'missing' }, lastDoctor: null }; } };
const localSessions = createSessionsResource({ discovery: localDiscovery });
const remoteSessions = createSshSessionsResource({ ssh });
const remoteDoctor = createSshDoctorResource({ ssh });
const implemented = [
  { resource: localSessions.resource, adapter: { read: (request) => request.context?.kind === 'ssh' ? remoteSessions.adapter.read(request) : localSessions.adapter.read(request) } },
  createSshResource({ ssh }), remoteDoctor, createServicesResource({ service }), createMaintenanceResource({ maintenance }),
  createFilesResource({ read: ({ signal }) => queryManagedFiles({ baseDir, signal }) }),
  createLogsResource({ intervalMs: 150, read: (request) => queryManagedLog({ ...request, baseDir }) }), createStatusResource({ overview }),
];
function observe(id, adapter) { return { ...adapter, async read(request) {
  record({ event: 'resource-read', resourceId: id, route: request.route });
  const page = await adapter.read(request);
  record({ event: 'resource-page', resourceId: id, route: request.route, ids: page.rows.map((row) => row.id), completeness: page.completeness });
  return page;
} }; }
const installed = new Map(implemented.map((item) => [item.resource.id, item]));
const registry = createResourceRegistry(defaultResources.map((resource) => resource.id === 'ctx' ? contextsResource : installed.get(resource.id)?.resource ?? resource));
const adapters = Object.fromEntries(implemented.map((item) => [item.resource.id, observe(item.resource.id, item.adapter)]));
const contexts = [{ id: 'local', kind: 'local', label: '本机操作fixture', target: 'isolated-local-fixture' }, ...remoteConnections.map((item) => ({ id: item.id, kind: 'ssh', label: item.name, target: item.target, identityHint: item.identityHint }))].map(presentContext);
const resize = () => record({ event: 'resize', columns: process.stdout.columns, rows: process.stdout.rows });
process.stdout.on('resize', resize);
let failure;
if (process.env.TUI_OPERATIONS_SCENARIO === 'failure') failure = setTimeout(() => process.emit('uncaughtException', new Error('operations-fixture-private-error')), 2000);
const code = await runTui({ home, contexts, registry, adapters, clipboard: async (value) => { record({ event: 'clipboard', value }); } });
clearTimeout(failure); process.stdout.off('resize', resize);
record({ event: 'exit', code, before, after: { raw: process.stdin.isRaw === true, listeners: listeners(), resize: process.stdout.listenerCount('resize') } });
process.exitCode = code;
