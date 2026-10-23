import process from 'node:process';
import { appendFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createElement } from 'react';
import { render, Text } from 'ink';
import { runTui } from '../../dist/tui/main.js';
import { createResourceRegistry, defaultResources } from '../../dist/tui/resources/registry.js';
import { contextsResource } from '../../dist/tui/resources/contexts.js';
import { createTcpTargetsResource } from '../../dist/tui/resources/connections.js';
import { createSessionsResource } from '../../dist/tui/resources/sessions.js';
import { createServicesResource } from '../../dist/tui/resources/services.js';
import { createFilesResource } from '../../dist/tui/resources/files.js';
import { createMaintenanceResource } from '../../dist/tui/resources/maintenance.js';
import { createStatusResource, createDoctorResource } from '../../dist/tui/resources/overview.js';
import { createSshResource, createSshSessionsResource, createSshDoctorResource } from '../../dist/tui/resources/ssh.js';
import { createTcpResources } from '../../dist/tui/resources/tcp.js';
import { createTcpConfiguration } from '../../dist/application/tcp/configuration.js';
import { listTuiContexts } from '../../dist/application/contexts/index.js';
import { queryManagedFiles } from '../../dist/application/queries/files.js';
import { MAINTENANCE_OPERATIONS } from '../../dist/application/maintenance/model.js';

// One real terminal/controller/resource chain. Only the temporary configuration import
// and metadata reads touch disk; native, SSH, TCP and mutation effects are fixture owned.
const home = process.env.TUI_FINAL_HOME;
const evidence = process.env.TUI_FINAL_EVIDENCE;
if (!home || !evidence) throw new Error('Final acceptance requires explicit isolated paths.');
const baseDir = join(home, '.crosschat');
const file = join(baseDir, 'tcp', 'inbox', 'FINAL-READONLY-FILE.txt');
await mkdir(join(home, '.ssh'), { recursive: true });
await mkdir(join(baseDir, 'tcp', 'inbox'), { recursive: true });
await writeFile(join(home, '.ssh', 'config'), 'Host final-remote\n  HostName fixture.invalid\n');
await writeFile(file, 'FINAL-FILE-CONTENT-MUST-REMAIN');
const record = (event) => appendFileSync(evidence, `${JSON.stringify({ at: Date.now(), ...event })}\n`);
const listeners = () => Object.fromEntries(['SIGINT', 'SIGTERM', 'uncaughtException', 'unhandledRejection'].map((event) => [event, process.listenerCount(event)]));
const warmup = render(createElement(Text, null, 'final acceptance baseline'), { interactive: true, patchConsole: false, exitOnCtrlC: false });
await warmup.waitUntilRenderFlush(); warmup.unmount(); await warmup.waitUntilExit();
const before = { raw: process.stdin.isRaw === true, listeners: listeners(), resize: process.stdout.listenerCount('resize') };
const observedAt = 1_800_000_000_000;
const complete = { completeness: 'complete', observedAt, errors: [] };
const capabilities = { discovery: true, delivery: true, launch: false, diagnostics: false };
const sshId = 'ssh:final-remote';
const starId = 'final-full-star-identity';
const importedId = `tcp:star:${starId}:fixture.invalid%3A7260`;
const machineId = '1234567890abcdef1234567890abcdef';
const localRef = { contextId: 'local', providerId: 'future-provider', nativeId: 'local-target-opaque-id' };
const secondRef = { contextId: 'local', providerId: 'codex', nativeId: 'local-second-opaque-id' };
const discovered = (ref, name, rawStatus = 'idle') => ({ ref, name, rawStatus, capabilities, attributes: { cwd: 'D:/fixture/中文👩‍💻' } });
const discovery = { async execute(_request, options) {
  record({ event: 'local-sessions', contextId: options.contextId });
  return { op: 'list', providers: ['future-provider', 'codex'].map((providerId) => ({ providerId, capabilities })), page: { ...complete, nextCursor: null,
    items: [discovered(localRef, 'FINAL-LOCAL-TARGET', 'pondering'), discovered(secondRef, 'FINAL-LOCAL-SECOND')] } };
} };
const ssh = {
  async list() {
    const result = await listTuiContexts({ home });
    const items = result.items.filter((item) => item.kind === 'ssh');
    record({ event: 'ssh-list', ids: items.map((item) => item.id) });
    return { items, observedAt, errors: result.errors };
  },
  discovery: { async execute(_request, options) {
    record({ event: 'ssh-sessions', contextId: options.contextId });
    return { op: 'list', providers: [{ providerId: 'codex', capabilities }], page: { ...complete, nextCursor: null,
      items: [discovered({ contextId: options.contextId, providerId: 'codex', nativeId: 'remote-anonymous-opaque-id' }, null)] } };
  } },
  async doctor({ contextId }) {
    record({ event: 'ssh-doctor', contextId });
    return { ...complete, contextId, host: 'final-remote', exitCode: 0, result: { groups: [{ context: { kind: 'environment' }, checks: [{ code: 'node-supported', level: 'pass', data: { version: '24.7.0' } }] }], summary: { pass: 1, warn: 0, error: 0, failed: false } } };
  },
};
const localDoctor = { ...complete, summary: { pass: 1, warn: 0, error: 0, failed: false }, checks: [
  { id: 'final-doctor', group: '本机', code: 'fixture', level: 'pass', label: 'FINAL-LOCAL-DOCTOR', description: '只读模拟检查', guidance: 'FINAL-LOCAL-GUIDANCE', facts: [] },
] };
const overview = {
  async readStatus({ contextId }) {
    record({ event: 'local-status', contextId });
    return { ...complete, providers: [{ providerId: 'future-provider', count: 1, anonymous: 0, completeness: 'complete' }], connections: [], services: [], outbox: { threads: 0, items: 0 }, watchdog: { running: false, evidence: 'missing' }, lastDoctor: null };
  },
  async readDoctor({ contextId }) { record({ event: 'local-doctor', contextId }); return localDoctor; },
};
const service = {
  async read({ contextId }) {
    record({ event: 'services', contextId });
    return { ...complete, items: [{ id: 'service:final-fixture', revision: 'stopped-fixture', kind: 'node', label: 'FINAL-SERVICE', target: 'fixture.invalid', selector: 'fixture', state: 'not-running', readiness: 'stopped',
      start: { allowed: true, impact: ['FINAL-SERVICE-PREVIEW'] }, stop: { allowed: false, reason: '没有进程' }, detail: [{ label: '边界', value: 'FINAL-SERVICE-READONLY' }] }] };
  },
  async check(request) { record({ event: 'service-preview', contextId: request.contextId }); return { allowed: true, impact: ['FINAL-SERVICE-PREVIEW'] }; },
  async execute() { record({ event: 'unexpected-effect', source: 'service' }); throw new Error('Fixture service execution must never be called.'); },
};
const maintenance = {
  list: () => MAINTENANCE_OPERATIONS,
  async preview({ operationId }) { record({ event: 'maintenance-preview', operationId }); return { operationId, label: 'FINAL-MAINTENANCE-PREVIEW', enabled: true, observedAt,
    fingerprint: 'a'.repeat(64), targets: [{ path: file, kind: 'file', label: '仅临时文件', bytes: 30 }], effects: ['只预览，默认取消。'] }; },
  async execute() { record({ event: 'unexpected-effect', source: 'maintenance' }); throw new Error('Fixture maintenance execution must never be called.'); },
};
const star = (contextId) => ({ id: 'star:final', contextId, starId, name: 'FINAL-IMPORTED-STAR', revision: 'static-final-revision', role: 'member', host: 'fixture.invalid', port: 7260, health: 'reachable', onlineNodes: 1 });
const member = (contextId) => ({ id: 'member:final', contextId, starId, machineId, machineName: 'FINAL-TCP-MACHINE', nativeId: 'tcp-member-opaque-id', providerId: 'codex', name: 'FINAL-TCP-MEMBER', presence: 'online', temporary: false });
const tcp = {
  async readStars({ contextId }) {
    record({ event: 'tcp-stars', contextId });
    return { ...complete, contextId, role: 'member', configured: true, items: [star(contextId)] };
  },
  async readStar(request) {
    record({ event: 'tcp-star', contextId: request.contextId, starId: request.starId });
    return { ...complete, contextId: request.contextId, star: star(request.contextId),
      machines: [{ id: `machine:${machineId}`, contextId: request.contextId, starId, machineId, mid8: machineId.slice(0, 8), name: 'FINAL-TCP-MACHINE', labels: ['final-node'], presence: 'online', addedAt: '2026-10-22T00:00:00Z' }],
      members: [member(request.contextId)], credentials: [{ id: 'credential:final-node', contextId: request.contextId, starId, label: 'FINAL-NODE-CREDENTIAL', kind: 'node', revision: 'credential-final-revision', machineId, machineName: 'FINAL-TCP-MACHINE', addedAt: '2026-10-22T00:00:00Z' }] };
  },
  async readSessions(request) {
    record({ event: 'tcp-sessions', contextId: request.contextId, starId: request.starId, machineId: request.machineId, scope: request.scope });
    const current = member(request.contextId);
    return { ...complete, contextId: request.contextId, star: star(request.contextId), scope: request.scope, nodes: [], items: [{ ...current, id: 'tcp-session:final', mid8: machineId.slice(0, 8),
      ref: { contextId: `tcp-node:${request.contextId}:${starId}:${machineId}`, providerId: 'codex', nativeId: current.nativeId }, rawStatus: null, capabilities: null, attributes: {}, member: current, membership: 'member', discovered: false }] };
  },
};
const tcpResources = createTcpResources({ tcp });
const localSessions = createSessionsResource({ discovery });
const remoteSessions = createSshSessionsResource({ ssh });
const localDoctorBinding = createDoctorResource({ overview });
const remoteDoctor = createSshDoctorResource({ ssh });
const configuration = createTcpConfiguration({ baseDir });
const connection = createTcpTargetsResource({ configuration: {
  ...configuration,
  async preview(request) { const result = await configuration.preview(request); record({ event: 'import-preview', enabled: result.enabled, targetIds: result.targets.map((target) => target.contextId) }); return result; },
  async apply(request) {
    const result = await configuration.apply(request);
    record({ event: 'import-applied', status: result.status, contextId: result.contextId });
    return result;
  },
} });
const installed = [
  { resource: localSessions.resource, adapter: { read: (request) => request.context?.kind === 'ssh' ? remoteSessions.adapter.read(request) : request.context?.kind === 'tcp' ? tcpResources.sessions.adapter.read(request) : localSessions.adapter.read(request) } },
  { resource: localDoctorBinding.resource, adapter: { read: (request) => request.context?.kind === 'ssh' ? remoteDoctor.adapter.read(request) : localDoctorBinding.adapter.read(request) } },
  createStatusResource({ overview }), createServicesResource({ service }), createMaintenanceResource({ maintenance }),
  createFilesResource({ read: ({ signal }) => queryManagedFiles({ baseDir, signal }) }), createSshResource({ ssh }), connection,
  ...Object.values(tcpResources).filter((binding) => binding.resource.id !== 'sessions'),
];
function observe(id, adapter) { return { ...adapter, async read(request) {
  record({ event: 'resource-read', resourceId: id, contextId: request.context?.id, route: request.route });
  const page = await adapter.read(request);
  record({ event: 'resource-page', resourceId: id, contextId: request.context?.id, route: request.route, ids: page.rows.map((row) => row.id), completeness: page.completeness });
  return page;
} }; }
const byId = new Map(installed.map((binding) => [binding.resource.id, binding]));
const registry = createResourceRegistry(defaultResources.map((resource) => resource.id === 'ctx' ? contextsResource : byId.get(resource.id)?.resource ?? resource));
const adapters = Object.fromEntries(installed.map((binding) => [binding.resource.id, observe(binding.resource.id, binding.adapter)]));
record({ event: 'fixture-ready', home, baseDir, file, sshId, importedId, starId, machineId, localRef, secondRef });
// No supplied contexts: runTui uses the real, rereadable temporary context catalog.
const code = await runTui({ home, registry, adapters, clipboard: async (value) => { record({ event: 'clipboard', value }); } });
const finalContexts = await listTuiContexts({ home });
record({ event: 'exit', code, before, after: { raw: process.stdin.isRaw === true, listeners: listeners(), resize: process.stdout.listenerCount('resize') }, contextIds: finalContexts.items.map((item) => item.id), fileUnchanged: await readFile(file, 'utf8') === 'FINAL-FILE-CONTENT-MUST-REMAIN' });
process.exitCode = code;
