import process from 'node:process';
import { appendFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { setTimeout, clearTimeout } from 'node:timers';
import { createElement } from 'react';
import { render, Text } from 'ink';
import { runTui } from '../../dist/tui/main.js';
import { createResourceRegistry, defaultResources } from '../../dist/tui/resources/registry.js';
import { contextsResource } from '../../dist/tui/resources/contexts.js';
import { createTcpResources } from '../../dist/tui/resources/tcp.js';

// Only the terminal/controller/resources are real. These effects never touch a broker,
// native process, user session, configuration or credential. All material is synthetic.
const home = process.env.TUI_TCP_HOME;
const evidence = process.env.TUI_TCP_EVIDENCE;
if (!home || !evidence) throw new Error('TCP fixture requires explicit isolated paths.');
await mkdir(home, { recursive: true });
const record = (event) => appendFileSync(evidence, `${JSON.stringify({ at: Date.now(), ...event })}\n`);
const listeners = () => Object.fromEntries(['SIGINT', 'SIGTERM', 'uncaughtException', 'unhandledRejection'].map((event) => [event, process.listenerCount(event)]));
const warmup = render(createElement(Text, null, 'TCP fixture baseline'), { interactive: true, patchConsole: false, exitOnCtrlC: false });
await warmup.waitUntilRenderFlush(); warmup.unmount(); await warmup.waitUntilExit();
const before = { raw: process.stdin.isRaw === true, listeners: listeners(), resize: process.stdout.listenerCount('resize') };
const observedAt = 1_800_000_000_000;
const complete = { completeness: 'complete', observedAt, errors: [] };
const starId = 'full-star-fixture-identity-1234567890';
const remoteId = 'tcp:fixture-remote-admin';
const memberId = 'tcp:fixture-ordinary-member';
const machineA = '12345678-first-full-machine-identity';
const machineB = '12345678-second-full-machine-identity';
const machineC = '87654321-newly-bound-full-machine-identity';
const secret = '{"fixture":"TCP-SYNTHETIC-SECRET-NEVER-A-REAL-KEY"}';
const connectCommand = 'crosschat serve --connect fixture-star --detach';
const longName = `NODE-LONG-中文👩‍💻-${'完整字段-'.repeat(18)}-END`;
const starName = 'STAR-FIXTURE';
let issuedAt = 0;
let removed = '';
let renamed = '';
let previewNumber = 0;
const role = (contextId) => contextId === 'local' ? 'broker-owner' : contextId === memberId ? 'member' : 'star-admin';
const star = (contextId) => ({ id: 'star:fixed-fixture-row', contextId, starId, name: renamed || starName, revision: `star-revision:${renamed}`, role: role(contextId), host: 'fixture.invalid', port: 7260, health: 'reachable', onlineNodes: issuedAt && Date.now() - issuedAt >= 2000 ? 3 : 2 });
const machine = (contextId, machineId, name, presence = 'online') => ({ id: `machine:${machineId}`, contextId, starId, machineId, mid8: machineId.slice(0, 8), name, labels: [`label:${machineId}`], presence, addedAt: '2026-10-22T00:00:00Z' });
const machines = (contextId) => [machine(contextId, machineA, longName), machine(contextId, machineB, 'NODE-SECOND-FIXTURE'), ...(issuedAt && Date.now() - issuedAt >= 2000 ? [machine(contextId, machineC, 'NODE-BOUND-FIXTURE')] : [])].filter((item) => item.id !== removed);
function member(contextId, index) {
  const machineId = index ? machineB : machineA;
  return { id: `member:fixture:${machineId}`, contextId, starId, machineId, machineName: index ? 'NODE-SECOND-FIXTURE' : longName, nativeId: 'same-native-id-on-distinct-nodes', providerId: index ? 'future-provider' : 'codex', name: index ? null : 'SESSION-NAMED-FIXTURE', presence: index ? 'offline' : 'online', temporary: false };
}
const credentials = (contextId) => [{ id: 'credential:unused-node-key', contextId, starId, kind: 'node', label: 'UNUSED-NODE-CREDENTIAL', revision: 'credential-version-fixed', machineId: null, machineName: null, addedAt: '2026-10-22T00:00:00Z' }, { id: 'credential:peer-admin', contextId, starId, kind: 'admin', label: 'PEER-ADMIN-CREDENTIAL', revision: 'admin-version-fixed', machineId: null, machineName: null, addedAt: '2026-10-22T00:00:00Z' }];
function session(contextId, index, scope) {
  const roster = member(contextId, index);
  const discovered = scope === 'discoverable';
  return { id: `session:${roster.machineId}`, contextId, starId, machineId: roster.machineId, mid8: roster.machineId.slice(0, 8), machineName: roster.machineName, nativeId: roster.nativeId, providerId: roster.providerId, name: roster.name,
    ref: { contextId: `tcp-node:${contextId}:${starId}:${roster.machineId}`, providerId: roster.providerId, nativeId: roster.nativeId }, rawStatus: discovered ? index ? 'pondering' : 'idle' : null,
    capabilities: null, attributes: { cwd: `D:/fixture/远端原生目录👩‍💻/${'完整路径/'.repeat(12)}` }, member: roster, membership: 'member', presence: roster.presence, discovered,
    addressReason: 'fixture没有可核验原生发送地址；不伪造地址。' };
}
const tcp = {
  async readStars({ contextId }) { record({ event: 'tcp-stars', contextId }); return { ...complete, contextId, role: role(contextId), configured: true, items: [star(contextId)] }; },
  async readStar(request) {
    record({ event: 'tcp-star', ...request, signal: undefined, machineIds: machines(request.contextId).map((item) => item.id) });
    if (request.signal?.aborted) return { ...complete, contextId: request.contextId, star: null, machines: [], members: [], credentials: [], completeness: 'cancelled' };
    return { ...complete, observedAt: Date.now(), contextId: request.contextId, star: star(request.contextId), machines: machines(request.contextId), members: [member(request.contextId, 0), member(request.contextId, 1)], credentials: credentials(request.contextId) };
  },
  async readSessions(request) {
    record({ event: 'tcp-sessions', ...request, signal: undefined });
    return { ...complete, contextId: request.contextId, star: star(request.contextId), scope: request.scope,
      items: [session(request.contextId, 0, request.scope), session(request.contextId, 1, request.scope)].filter((item) => !request.machineId || item.machineId === request.machineId), nodes: [] };
  },
};
const management = {
  async preview(request) {
    const allowed = role(request.contextId) === 'broker-owner' || role(request.contextId) === 'star-admin' && ['generate-node-key', 'remove-node', 'revoke-credential', 'remove-member', 'adopt-session'].includes(request.action);
    const fields = request.action === 'generate-node-key' ? [{ id: 'count', label: '配置份数', required: true, initialValue: '1' }, { id: 'host', label: '接收机连接地址', required: true, initialValue: 'fixture.invalid' }]
      : request.action === 'rename-star' ? [{ id: 'name', label: '新星名', required: true, initialValue: 'STAR-RENAMED-FIXTURE' }] : [];
    record({ event: 'tcp-preview', ...request, signal: undefined, allowed });
    previewNumber++;
    return { enabled: allowed, reason: allowed ? undefined : 'fixture权限拒绝；不发送写请求。', nextStep: allowed ? undefined : '返回broker主或星管理员上下文。', revision: `preview:${previewNumber}`, fields,
      impact: [{ label: '固定完整星', value: starId }, { label: '固定操作目标', value: request.targetId ?? '新增节点配置' }, { label: '完整影响', value: `TCP-IMPACT-FULL-中文👩‍💻-${'列表确认说明-'.repeat(20)}-END` }] };
  },
  async apply(request) {
    record({ event: 'tcp-effect', ...request, signal: undefined });
    if (!request.expectedPreviewRevision.startsWith('preview:')) throw new Error('fixture requires the checked preview');
    if (request.action === 'remove-node') removed = request.targetId;
    if (request.action === 'rename-star') renamed = request.values.name;
    if (request.action === 'generate-node-key') {
      issuedAt = Date.now();
      return { kind: 'applied', message: 'fixture已发配置。', mode: 'hot', secret: { kind: 'node-configs', title: 'TCP-FIXTURE-ONE-TIME-CONFIG', materials: [{ label: 'fixture-node', content: secret, connectCommand }], notice: '仅人工分发的模拟材料；Esc/Ctrl+C离开清屏。' } };
    }
    return { kind: 'applied', message: 'TCP-FIXTURE-MUTATION-CONFIRMED' };
  },
};
const resources = createTcpResources({ tcp, management });
const localSessions = { async read(request) { record({ event: 'local-sessions', contextId: request.context?.id }); return { rows: [{ id: 'local:fixture-only', cells: { name: 'LOCAL-FIXTURE-SESSION' } }], completeness: 'complete' }; } };
const sessionsAdapter = { ...resources.sessions.adapter, read: (request) => request.context?.kind === 'local' && !request.route?.query?.starId ? localSessions.read(request) : resources.sessions.adapter.read(request) };
const installed = new Map(Object.values(resources).map((binding) => [binding.resource.id, binding]));
const registry = createResourceRegistry(defaultResources.map((resource) => resource.id === 'ctx' ? contextsResource : installed.get(resource.id)?.resource ?? resource));
const adapters = Object.fromEntries(Object.entries(resources).map(([id, binding]) => [id, id === 'sessions' ? sessionsAdapter : binding.adapter]));
const contexts = [{ id: 'local', kind: 'local', label: '本机TCP-FIXTURE', target: 'isolated-fixture' }, { id: remoteId, kind: 'tcp', label: 'TCP-ADMIN-FIXTURE', target: 'fixture.invalid:7260' }, { id: memberId, kind: 'tcp', label: 'TCP-MEMBER-FIXTURE', target: 'fixture.invalid:7260' }];
const resize = () => record({ event: 'resize', columns: process.stdout.columns, rows: process.stdout.rows });
process.stdout.on('resize', resize);
record({ event: 'fixture-ready', starId, machineA, machineB, machineC, remoteId, memberId, longName });
let failure;
if (process.env.TUI_TCP_SCENARIO === 'failure') failure = setTimeout(() => process.emit('uncaughtException', new Error('tcp-fixture-private-error')), 2000);
const code = await runTui({ home, contexts, registry, adapters, clipboard: async (value) => { record({ event: 'clipboard', value }); } });
clearTimeout(failure); process.stdout.off('resize', resize);
record({ event: 'exit', code, before, after: { raw: process.stdin.isRaw === true, listeners: listeners(), resize: process.stdout.listenerCount('resize') } });
process.exitCode = code;
