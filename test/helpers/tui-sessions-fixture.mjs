import process from 'node:process';
import { appendFileSync } from 'node:fs';
import { setTimeout, clearTimeout } from 'node:timers';
import { createElement } from 'react';
import { render, Text } from 'ink';
import { DiscoveryService } from '../../dist/application/discovery/index.js';
import { sessionKey } from '../../dist/application/sessions/model.js';
import { runTui } from '../../dist/tui/main.js';
import { createSessionsResource } from '../../dist/tui/resources/sessions.js';
import { createStatusRegistry } from '../../dist/tui/resources/status.js';
import { createResourceRegistry, defaultResources } from '../../dist/tui/resources/registry.js';

// Real Windows terminal, isolated metadata and mutation spies: no native reader or service.
const record = (event) => appendFileSync(process.env.TUI_SESSIONS_EVIDENCE, JSON.stringify(event) + '\n');
const listeners = () => Object.fromEntries(['SIGINT', 'SIGTERM', 'uncaughtException', 'unhandledRejection'].map((event) => [event, process.listenerCount(event)]));
const warmup = render(createElement(Text, null, 'session fixture baseline'), { interactive: true, patchConsole: false, exitOnCtrlC: false });
await warmup.waitUntilRenderFlush(); warmup.unmount(); await warmup.waitUntilExit();
const before = { raw: process.stdin.isRaw === true, listeners: listeners(), resize: process.stdout.listenerCount('resize') };
const capabilities = { discovery: true, delivery: true, launch: false, diagnostics: false };
const nativeId = (index) => `11111111-1111-1111-1111-${String(index).padStart(12, '0')}`;
const makeSession = (providerId, id, name, rawStatus = 'idle', attributes = {}) => ({
  ref: { contextId: 'local', providerId, nativeId: id }, key: sessionKey({ contextId: 'local', providerId, nativeId: id }), name, rawStatus, capabilities,
  attributes: { cwd: 'D:/fixture/中文/' + '完整目录'.repeat(12), fixtureMetadata: '元数据👩‍💻末尾', messagingSocketPath: 'must-not-reach-terminal', ...attributes },
});
const sources = {
  claude: Array.from({ length: 121 }, (_, index) => makeSession('claude', nativeId(index), index === 0 ? '当前fixture' : index === 1 ? '同名fixture' : null, index === 1 ? 'busy' : 'idle')),
  codex: [makeSession('codex', '22222222-2222-2222-2222-000000000000', '同名fixture'), makeSession('codex', '22222222-2222-2222-2222-000000000001', null)],
  'future-tool': [makeSession('future-tool', 'opaque/full/未来会话', '未来工具fixture', { type: 'pondering', reason: '第三工具完整状态' })],
};
let generation = 0;
const readers = Object.entries(sources).map(([providerId, original]) => ({
  providerId, capabilities,
  async list(request) {
    if (providerId === 'claude' && request.cursor === undefined) generation++;
    record({ event: 'read-page', providerId, contextId: request.contextId, cursor: request.cursor, limit: request.limit, generation });
    if (process.env.TUI_SESSIONS_SCENARIO === 'cancel' && generation > 1) {
      return new Promise((_, reject) => {
        const abort = () => { record({ event: 'read-aborted', providerId }); reject(new Error('fixture read cancelled')); };
        request.signal.addEventListener('abort', abort, { once: true });
        if (request.signal.aborted) abort();
      });
    }
    const items = generation % 2 === 0 ? [...original].reverse() : original;
    const offset = request.cursor === undefined ? 0 : Number(request.cursor);
    const end = Math.min(offset + (request.limit ?? 100), items.length);
    return { items: items.slice(offset, end), nextCursor: end < items.length ? String(end) : null, completeness: end < items.length ? 'partial' : 'complete', errors: [], observedAt: 1_792_640_000_000 + generation };
  },
  async get(request) {
    record({ event: 'native-detail', providerId, nativeId: request.nativeId });
    return { item: original.find((item) => item.ref.nativeId === request.nativeId) ?? null, completeness: 'complete', errors: [], observedAt: 1_792_640_000_000 };
  },
}));
const membership = {
  async listTargets() { return { stars: [{ id: 'star-full-A', label: '星甲fixture', eligible: true }, { id: 'star-full-B', label: '星乙fixture', eligible: true }], completeness: 'complete', observedAt: 1_792_640_000_000, errors: [] }; },
  async check({ op, ref, starId }) { record({ event: 'membership-check', op, ref, starId }); return { allowed: true, impact: [`fixture精确${op}；星 ${starId}`, '仅隔离册位元数据，不启动或结束原生聊天。'] }; },
  async apply({ op, ref, starId }) { record({ event: 'membership-apply', op, ref, starId }); return { kind: 'applied', message: `fixture-${op}-applied` }; },
};
const sessions = createSessionsResource({ discovery: new DiscoveryService(readers), membership, statusRegistry: createStatusRegistry({ 'future-tool': { pondering: '思考中' } }) });
const registry = createResourceRegistry(defaultResources.map((resource) => resource.id === 'sessions' ? sessions.resource : resource));
const resize = () => record({ event: 'resize', columns: process.stdout.columns, rows: process.stdout.rows });
process.stdout.on('resize', resize);
let failure;
if (process.env.TUI_SESSIONS_SCENARIO === 'failure') failure = setTimeout(() => process.emit('uncaughtException', new Error('session-fixture-private-error')), 3000);
const code = await runTui({
  home: process.env.TUI_SESSIONS_HOME,
  contexts: [{ id: 'local', kind: 'local', label: '本机会话fixture', target: 'isolated-fixture' }], registry, adapters: { sessions: sessions.adapter },
  clipboard: async (value) => { record({ event: 'clipboard', value }); },
});
clearTimeout(failure);
process.stdout.off('resize', resize);
record({ event: 'exit', code, before, after: { raw: process.stdin.isRaw === true, listeners: listeners(), resize: process.stdout.listenerCount('resize') } });
process.exitCode = code;
