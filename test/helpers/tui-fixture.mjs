import process from 'node:process';
import { appendFileSync } from 'node:fs';
import { setTimeout, clearTimeout } from 'node:timers';
import { createElement } from 'react';
import { render, Text } from 'ink';
import { runTui } from '../../dist/tui/main.js';
import { createResourceRegistry, defaultResources } from '../../dist/tui/resources/registry.js';

// Real terminal fixture. All application data, writes and clipboard calls are isolated.
const evidence = process.env.TUI_FIXTURE_EVIDENCE;
const record = (value) => appendFileSync(evidence, JSON.stringify(value) + '\n');
const listeners = () => Object.fromEntries(['SIGINT', 'SIGTERM', 'uncaughtException', 'unhandledRejection'].map((event) => [event, process.listenerCount(event)]));
// restore-cursor intentionally installs one process-wide exit guard on its first hide.
// Establish that dependency baseline without TUI owners, then detect per-session leaks.
const warmup = render(createElement(Text, null, 'terminal fixture baseline'), { interactive: true, patchConsole: false, exitOnCtrlC: false });
await warmup.waitUntilRenderFlush();
warmup.unmount();
await warmup.waitUntilExit();
const before = { raw: process.stdin.isRaw === true, listeners: listeners(), resize: process.stdout.listenerCount('resize') };
const contexts = [
  { id: 'local', kind: 'local', label: '本机fixture', target: 'fixture-host' },
  { id: 'ssh:fixture', kind: 'ssh', label: 'SSHfixture', target: 'fixture-alias', identityHint: '配置提示，不代表认证' },
  { id: 'tcp:fixture', kind: 'tcp', label: 'TCPfixture', target: 'ws://fixture.invalid:9000', defaultResourceId: 'machines' },
];
let rows = Array.from({ length: 30 }, (_, index) => ({
  id: `future/native/${index}`,
  cells: { name: index ? `会话${String(index).padStart(2, '0')}` : '匿名👩‍💻é', provider: 'future-provider', state: '未识别<pondering>', full: `完整标识${index}-` + '很长的字符'.repeat(15) },
  detail: [{ label: '原始ID', value: `future/native/${index}` }, { label: '完整值', value: '长字段👩‍💻'.repeat(50) + '详情终点' }],
  copyValue: `future/native/${index}`,
}));
const impact = ['仅隔离fixture数据：' + '影响项目👩‍💻'.repeat(100) + '\nIMPACT-END'];
const rename = { id: 'rename', label: '修改显示名', shortcut: 'e', ownerResourceId: 'sessions', selectionPolicy: 'required', mutation: true, kind: 'form', fields: [{ id: 'name', label: '显示名', required: true }], impact, returnPolicy: 'restore' };
const registry = createResourceRegistry([
  ...defaultResources.map((resource) => resource.id === 'sessions' ? { ...resource, columns: [{ id: 'name', label: '名称', width: 22 }, { id: 'provider', label: '工具', width: 18 }, { id: 'state', label: '原生状态', width: 22 }, { id: 'full', label: '完整标识', width: 30 }], actions: [rename] } : resource),
  { id: 'slow', label: '取消读取fixture', aliases: [], description: '', columns: [{ id: 'name', label: '名称', width: 20 }], actions: [] },
]);
let failTimer;
if (process.env.TUI_FIXTURE_FAILURE === 'true') failTimer = setTimeout(() => { process.emit('uncaughtException', new Error('never-print-private-fixture')); }, 3000);
const resize = () => record({ event: 'resize', columns: process.stdout.columns, rows: process.stdout.rows });
process.stdout.on('resize', resize);
const code = await runTui({
  home: process.env.TUI_FIXTURE_HOME, contexts, registry,
  clipboard: async (value) => { record({ event: 'clipboard', value }); },
  adapters: {
    sessions: {
      read: async () => ({ rows, completeness: 'complete' }),
      checkAction: async ({ target }) => ({ enabled: Boolean(target), impact }),
      mutate: async ({ target, values }) => {
        record({ event: 'mutate', targetId: target.id, values });
        rows = rows.map((row) => row.id === target.id ? { ...row, cells: { ...row.cells, name: values.name } } : row);
        return { message: 'fixture显示名已更新' };
      },
    },
    slow: { read: ({ signal }) => new Promise((_, reject) => {
      signal.addEventListener('abort', () => { record({ event: 'read-aborted' }); reject(new Error('aborted')); }, { once: true });
    }) },
  },
});
clearTimeout(failTimer);
process.stdout.off('resize', resize);
record({ event: 'exit', code, before, after: { raw: process.stdin.isRaw === true, listeners: listeners(), resize: process.stdout.listenerCount('resize') } });
process.exitCode = code;
