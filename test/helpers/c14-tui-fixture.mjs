import assert from 'node:assert/strict';
import process from 'node:process';
import { appendFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { setTimeout, clearTimeout } from 'node:timers';
import { createElement } from 'react';
import { render, Text } from 'ink';
import { DiscoveryService } from '../../dist/application/discovery/index.js';
import { runTui } from '../../dist/tui/main.js';
import { createSessionsResource } from '../../dist/tui/resources/sessions.js';
import { createTcpResources } from '../../dist/tui/resources/tcp.js';
import { createResourceRegistry, defaultResources } from '../../dist/tui/resources/registry.js';

// Real terminal/controller/resources; only synthetic metadata and effect spies.
// There are no native readers, network connections, system clipboard or real keys.
const home = process.env.C14_TUI_HOME;
const evidence = process.env.C14_TUI_EVIDENCE;
assert(home && evidence, 'Explicit isolated home and evidence paths are required.');
await mkdir(home, { recursive: true });
const record = (event) => appendFileSync(evidence, `${JSON.stringify({ at: Date.now(), ...event })}\n`);
const snapshot = () => ({ raw: process.stdin.isRaw === true,
  listeners: Object.fromEntries(['SIGINT', 'SIGTERM', 'uncaughtException', 'unhandledRejection'].map((event) => [event, process.listenerCount(event)])),
  resize: process.stdout.listenerCount('resize') });
const warmup = render(createElement(Text, null, 'C14 fixture baseline'), { interactive: true, patchConsole: false, exitOnCtrlC: false });
await warmup.waitUntilRenderFlush(); warmup.unmount(); await warmup.waitUntilExit();
const before = snapshot();
const nativeId = '11111111-2222-3333-4444-555555555555';
const starId = 'c14-full-star-identity';
const machineId = '12345678123456781234567812345678';
const remoteId = 'tcp:c14-fixture';
const capabilities = { discovery: true, delivery: true, launch: false, diagnostics: false };
let localGeneration = 0;
let tcpGeneration = 0;
const localItem = (endpointType) => ({ ref: { contextId: 'local', providerId: 'codex', endpointType, nativeId, referenceKind: 'native' },
  name: 'C14-SAME-NAME', rawStatus: 'idle', capabilities, attributes: { cwd: 'D:/isolated/中文👩‍💻', transport: endpointType } });
const originals = ['cli', 'desktop'].map(localItem);
const sessions = createSessionsResource({ discovery: new DiscoveryService([{ providerId: 'codex', capabilities,
  async list(request) {
    localGeneration++;
    record({ event: 'local-read', generation: localGeneration, endpointType: request.endpointType });
    return { items: localGeneration % 2 === 1 ? originals : [...originals].reverse(), nextCursor: null, completeness: 'complete', errors: [], observedAt: Date.now() };
  },
  async get(request) { return { item: originals.find((item) => item.ref.nativeId === request.nativeId && item.ref.endpointType === request.endpointType) ?? null,
    completeness: 'complete', errors: [], observedAt: Date.now() }; },
}]), membership: {
  async listTargets() { return { stars: [{ id: starId, label: 'C14-STAR', eligible: true }], completeness: 'complete', errors: [], observedAt: Date.now() }; },
  async check(request) { record({ event: 'local-membership-check', op: request.op, ref: request.ref, starId: request.starId }); return { allowed: true, impact: ['Synthetic typed target only.'] }; },
  async apply(request) { record({ event: 'local-membership-write', op: request.op, ref: request.ref, starId: request.starId }); return { kind: 'applied', message: 'C14-LOCAL-APPLIED' }; },
} });
const complete = (contextId) => ({ contextId, completeness: 'complete', errors: [], observedAt: Date.now() });
const star = (contextId) => ({ id: 'c14-star-row', contextId, starId, name: 'C14-STAR', revision: 'c14-star-v1', role: 'star-admin',
  host: 'c14.invalid', port: 1, health: 'reachable', onlineNodes: 1 });
const member = (contextId, endpointType) => ({ id: `c14-member:${endpointType}`, contextId, starId, machineId, machineName: 'C14-NODE',
  providerId: 'codex', nativeId, endpointType, name: 'C14-SAME-NAME', presence: 'online', temporary: false,
  address: `tcp:${starId}:${machineId}:${nativeId}` });
const tcpSession = (contextId, endpointType, scope) => ({ id: `c14-session:${endpointType}`, contextId, starId, machineId,
  mid8: machineId.slice(0, 8), machineName: 'C14-NODE', providerId: 'codex', nativeId, endpointType, name: 'C14-SAME-NAME',
  ref: { contextId: `tcp-node:${contextId}:${starId}:${machineId}`, providerId: 'codex', endpointType, nativeId, referenceKind: 'native' },
  rawStatus: 'idle', capabilities, attributes: { cwd: '/isolated/中文👩‍💻', transport: endpointType }, member: member(contextId, endpointType),
  membership: 'member', presence: 'online', discovered: scope === 'discoverable', address: member(contextId, endpointType).address });
const tcp = createTcpResources({ tcp: {
  async readStars({ contextId }) { record({ event: 'tcp-stars', contextId }); return { ...complete(contextId), role: 'star-admin', configured: true, items: [star(contextId)] }; },
  async readStar(request) { record({ event: 'tcp-star', contextId: request.contextId }); return { ...complete(request.contextId), star: star(request.contextId),
    machines: [{ id: 'c14-node-row', contextId: request.contextId, starId, machineId, mid8: machineId.slice(0, 8), name: 'C14-NODE', labels: [], presence: 'online', addedAt: null }],
    members: ['cli', 'desktop'].map((endpointType) => member(request.contextId, endpointType)), credentials: [] }; },
  async readSessions(request) {
    tcpGeneration++;
    record({ event: 'tcp-sessions', contextId: request.contextId, scope: request.scope, machineId: request.machineId, generation: tcpGeneration });
    const types = tcpGeneration % 2 === 1 ? ['cli', 'desktop'] : ['desktop', 'cli'];
    return { ...complete(request.contextId), star: star(request.contextId), scope: request.scope,
      items: types.map((endpointType) => tcpSession(request.contextId, endpointType, request.scope)), nodes: [] };
  },
}, management: {
  async preview(request) { record({ event: 'tcp-preview', action: request.action, sessionTarget: request.sessionTarget }); return { enabled: false,
    reason: 'C14 fixture is read only', revision: 'disabled', fields: [], impact: [] }; },
  async apply() { throw new Error('C14 fixture must not issue TCP writes.'); },
} });
const bindings = new Map(Object.values(tcp).map((binding) => [binding.resource.id, binding]));
const adapters = Object.fromEntries(Object.entries(tcp).map(([id, binding]) => [id, binding.adapter]));
const selectedAdapter = (request) => request.context?.kind === 'local' && !request.route?.query?.starId ? sessions.adapter : tcp.sessions.adapter;
adapters.sessions = { read: (request) => selectedAdapter(request).read(request),
  describeActions: (request) => selectedAdapter(request).describeActions?.(request) ?? {},
  async watch(request, publish) { const observe = selectedAdapter(request).watch; if (observe) return observe(request, publish); },
  checkAction: (request) => selectedAdapter(request).checkAction?.(request) ?? { enabled: false },
  mutate: (request) => selectedAdapter(request).mutate?.(request) };
const registry = createResourceRegistry(defaultResources.map((resource) => resource.id === 'sessions' ? sessions.resource : bindings.get(resource.id)?.resource ?? resource));
const resize = () => record({ event: 'resize', columns: process.stdout.columns, rows: process.stdout.rows });
process.stdout.on('resize', resize);
let failure;
if (process.env.C14_TUI_SCENARIO === 'failure') failure = setTimeout(() => process.emit('uncaughtException', new Error('c14-private-fixture-failure')), 4000);
record({ event: 'fixture-ready', nativeId, starId, machineId, remoteId });
const code = await runTui({ home, contexts: [{ id: 'local', kind: 'local', label: 'C14-LOCAL', target: 'isolated' },
  { id: remoteId, kind: 'tcp', label: 'C14-TCP', target: 'c14.invalid:1' }], registry, adapters,
  clipboard: async (value) => record({ event: 'clipboard', value }) });
clearTimeout(failure); process.stdout.off('resize', resize);
record({ event: 'exit', code, before, after: snapshot() });
process.exitCode = code;
