import assert from 'node:assert/strict';
import { appendFile, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { createElement } from 'react';
import { render, Text } from 'ink';
import { launchPty } from './tui-pty-driver.mjs';
import { createDshOwnedNode } from './dsh-owned-node.mjs';
import { assessDshCallerSourceIdentity, createDshFixture, dshIdentityBootstrapCommand, pollDsh } from './dsh-live-fixture.mjs';

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const thisFile = fileURLToPath(import.meta.url);
const snapshot = () => ({ raw: process.stdin.isRaw === true, resize: process.stdout.listenerCount('resize'),
  listeners: Object.fromEntries(['SIGINT', 'SIGTERM', 'uncaughtException', 'unhandledRejection'].map((event) => [event, process.listenerCount(event)])) });

async function fixture() {
  const [root, input, events] = process.argv.slice(3);
  const owner = JSON.parse(await readFile(join(root, 'ownership.json'), 'utf8'));
  assert.equal(owner.task, 'c09-dsh-tui'); assert.equal(await realpath(root), owner.root);
  const config = JSON.parse(await readFile(input, 'utf8'));
  for (const path of [input, events, config.home, config.dshHome]) {
    const inside = relative(root, resolve(path));
    assert(inside && inside !== '..' && !inside.startsWith('..\\') && !inside.startsWith('../') && !isAbsolute(inside));
  }
  const record = (event) => appendFile(events, `${JSON.stringify(event)}\n`);
  const [{ runTui }, { DiscoveryService }, { createDshSessionReader }, { createSessionsResource },
    { createMaintenanceResource }, { createLocalMaintenance }, { createResourceRegistry, defaultResources }, { createTcpApplication }, { createTcpResources }] = await Promise.all([
    import('../../dist/tui/main.js'), import('../../dist/application/discovery/index.js'), import('../../dist/application/sessions/dsh-reader.js'),
    import('../../dist/tui/resources/sessions.js'), import('../../dist/tui/resources/maintenance.js'),
    import('../../dist/application/maintenance/index.js'), import('../../dist/tui/resources/registry.js'),
    import('../../dist/application/tcp/index.js'), import('../../dist/tui/resources/tcp.js'),
  ]);
  // Native metadata comes exclusively from the authenticated production reader.
  // Clipboard writes are captured locally; no messages or member mutations are issued by this TUI.
  const sessions = createSessionsResource({ discovery: new DiscoveryService([createDshSessionReader({ home: config.home })]) });
  const originalRead = sessions.adapter.read;
  sessions.adapter.read = async (request) => { const page = await originalRead(request); await record({ event: 'sessions', page }); return page; };
  const maintenance = createLocalMaintenance({ home: config.home, env: { DSH_HOME: config.dshHome } });
  const originalPreview = maintenance.preview, originalExecute = maintenance.execute;
  maintenance.preview = async (request) => { const result = await originalPreview(request); await record({ event: 'preview', result }); return result; };
  maintenance.execute = async (request) => { assert.equal(request.operationId, 'install-skills'); const result = await originalExecute(request); await record({ event: 'maintenance', result }); return result; };
  const maint = createMaintenanceResource({ maintenance });
  const [{ createDoctorResource }, { createLocalOverview }] = await Promise.all([
    import('../../dist/tui/resources/overview.js'), import('../../dist/application/observations/overview.js'),
  ]);
  const doctor = createDoctorResource({ overview: createLocalOverview({ home: config.home,
    discovery: new DiscoveryService([createDshSessionReader({ home: config.home })]),
    nativeEnvironment: 'inherit',
    env: { PATH: '', HOME: config.home, USERPROFILE: config.home, DSH_HOME: config.dshHome,
      CODEX_HOME: join(config.home, '.codex'), CODEX_SQLITE_HOME: join(config.home, '.codex'), CLAUDE_CONFIG_DIR: join(config.home, '.claude'),
      CROSSCHAT_CLAUDE_BIN: 'fixture-unavailable', CROSSCHAT_CODEX_BIN: 'fixture-unavailable' },
  }) });
  const readDoctor = doctor.adapter.read;
  doctor.adapter.read = async (request) => { const page = await readDoctor(request); await record({ event: 'doctor', page }); return page; };
  const tcp = createTcpResources({ tcp: createTcpApplication({ baseDir: join(config.home, '.crosschat') }) });
  const readMembers = tcp.members.adapter.read;
  tcp.members.adapter.read = async (request) => { const page = await readMembers(request); await record({ event: 'members', page }); return page; };
  const bindings = new Map([sessions, maint, doctor, tcp.stars, tcp.members].map((binding) => [binding.resource.id, binding]));
  const warmup = render(createElement(Text, null, 'C09 terminal baseline'), { interactive: true, patchConsole: false, exitOnCtrlC: false });
  await warmup.waitUntilRenderFlush(); warmup.unmount(); await warmup.waitUntilExit();
  const before = snapshot();
  const code = await runTui({ home: config.home, contexts: [{ id: 'local', kind: 'local', label: 'C09-HARNESS-NATIVE' }],
    registry: createResourceRegistry(defaultResources.map((resource) => bindings.get(resource.id)?.resource ?? resource)),
    adapters: Object.fromEntries([...bindings].map(([id, binding]) => [id, binding.adapter])), clipboard: async (value) => record({ event: 'clipboard', value }),
  });
  await record({ event: 'exit', code, before, after: snapshot() }); process.exitCode = code;
}

async function validate() {
  assert.equal(process.platform, 'win32'); assert.equal(process.env.CROSSCHAT_LIVE, '1');
  const root = await realpath(process.env.DSH_TUI_EVIDENCE_ROOT);
  const owner = JSON.parse(await readFile(join(root, 'ownership.json'), 'utf8')); assert.equal(owner.task, 'c09-dsh-tui'); assert.equal(owner.root, root);
  const round = await mkdtemp(join(root, 'tui-'));
  let runtime, pty, node, bootstrap = false;
  const results = { scope: 'Official npm/Web Host + production bridge/reader + built TUI in Windows ConPTY; no browser or Desktop UI', checks: [] };
  try {
    runtime = await createDshFixture({ runtime: process.env.DSH_TUI_RUNTIME_DIR, parentRoot: root }, () => {
      if (!bootstrap) { bootstrap = true; return { tool: { name: 'pwsh', input: { command: dshIdentityBootstrapCommand(), description: 'Read fixture native source identity' } } }; }
      return { text: 'C09-native-identity-ACK' };
    });
    const first = await runtime.createSession('C09-SAME-TITLE');
    const second = await runtime.createSession('C09-SAME-TITLE');
    await runtime.prompt(first.id, 'C09 native source bootstrap'); await runtime.idle(first.id);
    const identity = assessDshCallerSourceIdentity(runtime.model.requests, { session: first.id, profile: 'web', dshHome: runtime.env.DSH_HOME });
    assert.equal(identity.ready, true); results.identity = identity;
    results.version = runtime.info.version; results.pid = runtime.pid; results.sessions = [first.id, second.id];
    node = await createDshOwnedNode({ root, home: runtime.env.HOME, env: runtime.env, nativeId: first.id, endpointType: 'host' });
    const { starId, machineId } = node;
    results.starId = starId; results.machineId = machineId;
    const profileFile = join(runtime.env.DSH_HOME, 'profiles', 'web', 'package.json');
    const profileBefore = await readFile(profileFile, 'utf8');
    const input = join(round, 'input.json');
    await writeFile(input, JSON.stringify({ home: runtime.env.HOME, dshHome: runtime.env.DSH_HOME }));
    const eventsPath = join(round, 'application.jsonl');
    const events = async () => { try { return (await readFile(eventsPath, 'utf8')).trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)); } catch (error) { if (error.code === 'ENOENT') return []; throw error; } };
    const event = async (predicate, after = 0) => pollDsh(async () => (await events()).slice(after).find(predicate), 'TUI evidence', 10000);
    pty = await launchPty({ executable: process.execPath, args: [thisFile, '--fixture', root, input, eventsPath], cwd: workspace,
      columns: 140, rows: 36, env: runtime.env, logPath: join(round, 'terminal.jsonl') });
    const send = async (keys, expected) => { const mark = pty.output.length; pty.write(keys); if (expected) await pty.waitForOutput(expected, 10000, mark); };
    const copy = async (key = 'y') => { const mark = (await events()).length; await send(key, '已复制完整值'); return (await event((entry) => entry.event === 'clipboard', mark)).value; };
    await pty.waitForOutput('C09-HARNESS-NATIVE'); await send('\r\r', '2 个可发现会话');
    const page = (await event((entry) => entry.event === 'sessions')).page;
    assert.deepEqual(new Set(page.rows.map((row) => row.copyValues.nativeId)), new Set([first.id, second.id]));
    assert(page.rows.every((row) => row.cells.provider === 'dsh'));
    assert(page.rows.every((row) => row.cells.name === 'C09-SAME-TITLE'), 'Official npm title projection is exposed without title guessing');
    results.checks.push('authenticated-live-native-roots');
    await send(`/${first.id}\r`, /1\/1/);
    assert.equal(await copy(), `crosschat send --to ${first.id} --tool dsh --body "<正文>"`);
    const ref = JSON.parse(await copy('Y')); assert.equal(ref.nativeId, first.id); assert.equal(ref.endpointType, 'host');
    await send('d', '只读详情'); await send('\x1b', ':sessions');
    await send('g', 'DeepSeek Harness 原生操作'); await send('\x1b', ':sessions');
    await send('t', 'Enter应用'); await send('\x1b[H\x1b[B\r', 'dsh');
    await send('r', '2 个可发现会话'); assert.equal(JSON.parse(await copy('Y')).nativeId, first.id);
    results.checks.push('exact-full-copy-details-guide-filter-refresh-selection');
    await runtime.controller('/bridge', { enabled: false });
    let mark = (await events()).length; await send('r', '来源不可用');
    const missing = (await event((entry) => entry.event === 'sessions', mark)).page;
    assert.equal(missing.rows.length, 0); assert.equal(missing.completeness, 'unavailable');
    await send('i', '会话读取信息'); await send('\x1b', ':sessions');
    await runtime.controller('/bridge', { enabled: true });
    mark = (await events()).length; await send('r', '2 个可发现会话');
    const restored = (await event((entry) => entry.event === 'sessions', mark)).page;
    assert.deepEqual(new Set(restored.rows.map((row) => row.copyValues.nativeId)), new Set([first.id, second.id]));
    results.checks.push('native-plugin-disable-source-failure-and-reenable-recovery');
    await send(':maintenance\r', '安装 / 更新技能'); await send('/install-skills\r', /1\/1/);
    await send('\r', '确认提交'); await send('\r', '已取消操作');
    assert.equal((await events()).filter((entry) => entry.event === 'maintenance').length, 0);
    await send('\r', '确认提交'); await send('\t\r', '成功 3 项');
    const installed = await event((entry) => entry.event === 'maintenance'); assert.equal(installed.result.status, 'complete');
    assert.equal(await readFile(join(runtime.env.DSH_HOME, 'skills', 'crosschat', 'SKILL.md'), 'utf8'), await readFile(join(workspace, 'skills', 'crosschat', 'SKILL.md'), 'utf8'));
    assert.equal(await readFile(profileFile, 'utf8'), profileBefore);
    results.checks.push('real-maintenance-worker-default-cancel-then-install-profile-preserved');
    await send('d', '只读详情'); let outputMark = pty.output.length;
    pty.resize(48, 16); await pty.waitForOutput('CC · 工作区', 10000, outputMark);
    outputMark = pty.output.length; pty.resize(140, 36); await pty.waitForOutput('CC · 工作区', 10000, outputMark);
    await send('\x1b', ':maintenance');
    await send(':stars\r', 'C09-OWNED-STAR'); await send('\r', '<members>');
    const members = (await event((entry) => entry.event === 'members')).page;
    assert.equal(members.completeness, 'complete'); assert.equal(members.rows.length, 1);
    assert(members.rows[0].copyValue?.includes(`tcp:${starId}:${machineId}:${first.id}`));
    assert(members.rows[0].copyValue?.includes('--tool dsh'));
    assert.equal(await copy(), members.rows[0].copyValue);
    await send('d', '只读详情'); await send('\x1b', ':members');
    results.checks.push('real-owned-broker-node-native-member-list-full-typed-command');
    await send('q');
    assert.deepEqual(await pty.exited, { code: 0, hostCode: 0 });
    const exit = (await events()).find((entry) => entry.event === 'exit'); assert.deepEqual(exit.after, exit.before);
    for (const mode of ['1049', '2004']) assert(pty.output.lastIndexOf(`\x1b[?${mode}l`) > pty.output.lastIndexOf(`\x1b[?${mode}h`));
    results.checks.push('resize-normal-exit-terminal-raw-and-listeners-restored');
    await pty.dispose(); pty = undefined;
    results.status = 'passed';
  } catch (error) {
    results.status = 'failed'; results.failure = { message: error.message, stack: error.stack }; throw error;
  } finally {
    try { await pty?.dispose(); }
    finally {
      try { await node?.close(); }
      finally {
        try { if (runtime) { await writeFile(join(round, 'runtime-logs.json'), JSON.stringify(runtime.logs)); await runtime.close(); results.cleanup = runtime.cleanup; } }
        finally { await writeFile(join(round, 'summary.json'), JSON.stringify(results, null, 2)); process.stdout.write(`${JSON.stringify({ round, ...results })}\n`); }
      }
    }
  }
}

if (process.argv[2] === '--fixture') await fixture(); else await validate();
