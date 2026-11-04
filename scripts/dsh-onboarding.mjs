#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { DSH_ONBOARDING_CHECKS, DSH_ONBOARDING_SCOPE, DSH_ONBOARDING_TOOL } from './dsh-onboarding-contract.mjs';
import { assessDshCallerSourceIdentity, createDshFixture, dshIdentityBootstrapCommand, dshShellCommand, pollDsh, repositoryRoot, runDshCommand, snapshotDshStoredChats } from '../test/helpers/dsh-live-fixture.mjs';
import { replySendArgs } from '../test/helpers/compat-reply.mjs';
import { launchPty } from '../test/helpers/tui-pty-driver.mjs';
import { createDshOwnedNode } from '../test/helpers/dsh-owned-node.mjs';

assert.equal(process.env.CROSSCHAT_LIVE, '1'); assert.equal(process.platform, 'win32'); assert.equal(process.arch, 'x64');
const reportIndex = process.argv.indexOf('--report'); assert(reportIndex >= 0 && process.argv[reportIndex + 1]);
const reportPath = resolve(process.argv[reportIndex + 1]), evidence = dirname(reportPath);
await mkdir(evidence, { recursive: true });
const runId = process.env.DSH_EXPECTED_RUN_ID ?? randomUUID();
assert(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(runId));
const marker = `c11_${runId.slice(0, 8)}_`;
const report = { schema: 1, tool: DSH_ONBOARDING_TOOL, platform: 'win32', arch: 'x64', runId,
  version: process.env.DSH_EXPECTED_VERSION, scope: DSH_ONBOARDING_SCOPE, status: 'failed', category: 'infrastructure',
  stage: 'setup', check: DSH_ONBOARDING_CHECKS[0], startedAt: new Date().toISOString(), checks: [] };
let fixture, node, pty, tuiEvents, maintenanceReleaseUnclear = false, skillIssued = false, identityIssued = false, senderIssued = false, receiverIssued = false;
const sessions = {};
const userText = (body) => body.messages.filter((message) => message.role === 'user').flatMap((message) => typeof message.content === 'string' ? [message.content]
  : message.content.filter((part) => part.type === 'text').map((part) => part.text)).join('\n');
const text = (value) => ({ text: value });
const shell = (command) => ({ tool: { name: 'pwsh', id: `${marker}${randomUUID().slice(0, 8)}`, input: { command, description: 'Run a fixed isolated crosschat onboarding command' } } });
function respond(body) {
  const input = userText(body);
  if (input.includes(`${marker}skill`) && !skillIssued) { skillIssued = true; return { tool: { name: 'skill', id: `${marker}skill-load`, input: { name: 'crosschat' } } }; }
  if (input.includes(`${marker}skill`) && !identityIssued) { identityIssued = true; return shell(dshIdentityBootstrapCommand()); }
  if (input.includes(`${marker}begin-send`) && !senderIssued) { senderIssued = true; return shell(dshShellCommand(['send', '--to', sessions.receiver.id, '--tool', 'dsh', '--body', `${marker}request`, '--json'])); }
  if (input.includes(`${marker}request`) && !input.includes(`${marker}reply`) && !receiverIssued) {
    receiverIssued = true; return shell(dshShellCommand(replySendArgs(input, { tool: 'dsh', requestBody: `${marker}request`, body: `${marker}reply` })));
  }
  return text(`${marker}ACK`);
}
async function check(index, work) {
  report.check = DSH_ONBOARDING_CHECKS[index]; const started = performance.now(); await work();
  report.checks.push({ name: report.check, status: 'passed', elapsedMs: Math.round(performance.now() - started) });
  process.stdout.write(`PASS ${report.check}\n`);
}
function normal(result) {
  if (result.timedOut || result.signal !== null || !Number.isInteger(result.code)) throw Object.assign(new Error('Owned command did not exit normally'), { category: 'infrastructure' });
  assert.equal(result.code, 0, result.stderr);
}
function redact(value) {
  let result = typeof value === 'string' ? value : JSON.stringify(value);
  if (fixture?.info?.token) result = result.replaceAll(fixture.info.token, '[fixture-token-redacted]');
  return result.replace(/([?&]token=)[^&\s"'\\]+/g, '$1[fixture-token-redacted]');
}
async function save(name, value) { await writeFile(join(evidence, name), redact(value) + '\n'); }

try {
  await check(0, async () => {
    fixture = await createDshFixture({ runtime: process.env.DSH_RUNTIME_DIR, parentRoot: process.env.DSH_TASK_ROOT }, respond);
    assert.equal(fixture.info.version, report.version);
    await writeFile(join(fixture.root, 'ownership.json'), JSON.stringify({ task: 'c11-dsh-onboarding', root: await realpath(fixture.root), runId }));
    Object.assign(fixture.env, { CROSSCHAT_CLAUDE_BIN: 'fixture-unavailable-claude', CROSSCHAT_CODEX_BIN: 'fixture-unavailable-codex' });
    const installed = await fixture.cli(['install-skills']); normal(installed); await save('install-skills.json', installed);
    assert.equal(await readFile(join(fixture.env.DSH_HOME, 'skills/crosschat/SKILL.md'), 'utf8'), await readFile(join(repositoryRoot, 'skills/crosschat/SKILL.md'), 'utf8'));
    sessions.sender = await fixture.createSession(`${marker}sender`); sessions.receiver = await fixture.createSession(`${marker}receiver`);
  });
  report.stage = 'onboarding'; report.category = 'compatibility';
  await check(1, async () => {
    await fixture.prompt(sessions.sender.id, `${marker}skill`); await fixture.idle(sessions.sender.id);
    const results = fixture.model.requests.flatMap((body) => body.messages.flatMap((message) => Array.isArray(message.content)
      ? message.content.filter((part) => part.type === 'tool_result' && part.tool_use_id === `${marker}skill-load`) : []));
    const normalized = JSON.stringify(results).replaceAll('\\r\\n', '\\n');
    const body = (await readFile(join(repositoryRoot, 'skills/crosschat/SKILL.md'), 'utf8')).replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').trim().replaceAll('\r\n', '\n');
    assert(normalized.includes(JSON.stringify(body).slice(1, -1)), 'The actual native skill result must contain the complete current instructions');
    const identity = assessDshCallerSourceIdentity(fixture.model.requests, { session: sessions.sender.id, profile: 'web', dshHome: fixture.env.DSH_HOME });
    assert.equal(identity.ready, true); report.source = identity.source;
    await save('native-skill-and-identity.json', { skillIssued, identityIssued, results, source: identity.source });
  });
  await check(2, async () => {
    await fixture.prompt(sessions.sender.id, `${marker}begin-send`);
    await pollDsh(async () => JSON.stringify((await fixture.snapshot(sessions.sender.id)).events).includes(`${marker}reply`), 'native onboarding round trip', 60000);
    await Promise.all([fixture.idle(sessions.sender.id), fixture.idle(sessions.receiver.id)]);
    assert(senderIssued && receiverIssued);
    const listed = await fixture.cli(['discover'], JSON.stringify({ op: 'list', filter: { providerIds: ['dsh'] }, limit: 10 })); normal(listed);
    const page = JSON.parse(listed.stdout).page; assert.equal(page.completeness, 'complete'); assert.equal(page.items.length, 2);
    for (const session of Object.values(sessions)) {
      assert(page.items.some((item) => item.ref.nativeId === session.id && item.ref.endpointType === 'host'));
      assert.equal((await fixture.snapshot(session.id)).sameAgent, true);
    }
    await save('discovery.json', page);
  });
  await check(3, async () => {
    const [doctorJson, doctorText] = await Promise.all([fixture.cli(['doctor', '--json']), fixture.cli(['doctor'])]); normal(doctorJson); normal(doctorText);
    const doctor = JSON.parse(doctorJson.stdout), checks = doctor.groups.flatMap((group) => group.checks);
    assert(checks.some((entry) => entry.code === 'harness-bridge-ready'));
    assert(checks.some((entry) => entry.code === 'harness-profile-plugin-ready'));
    assert(checks.some((entry) => entry.code === 'skill-match' && entry.data.side === 'harness'));
    await save('doctor-json.json', doctor); await save('doctor-text.json', doctorText);
    node = await createDshOwnedNode({ root: fixture.root, home: fixture.env.HOME, env: fixture.env, nativeId: sessions.sender.id, endpointType: 'host' });
    const input = join(fixture.root, 'tui-input.json'), eventsPath = join(fixture.root, 'tui-application.jsonl'); tuiEvents = eventsPath;
    await writeFile(input, JSON.stringify({ home: fixture.env.HOME, dshHome: fixture.env.DSH_HOME }));
    const events = async () => { try { return (await readFile(eventsPath, 'utf8')).trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)); } catch (error) { if (error.code === 'ENOENT') return []; throw error; } };
    const event = (predicate, after = 0) => pollDsh(async () => (await events()).slice(after).find(predicate), 'onboarding terminal evidence', 10000);
    pty = await launchPty({ executable: process.execPath, args: [fileURLToPath(new globalThis.URL('../test/helpers/dsh-tui-pty-validation.mjs', import.meta.url)), '--fixture', fixture.root, input, eventsPath],
      env: fixture.env, columns: 140, rows: 36, logPath: join(evidence, 'tui-terminal.jsonl') });
    const send = async (keys, expected) => { const mark = pty.output.length; pty.write(keys); if (expected) await pty.waitForOutput(expected, 10000, mark); };
    const copy = async () => { const after = (await events()).length; pty.write('y'); return (await event((entry) => entry.event === 'clipboard', after)).value; };
    await pty.waitForOutput('C09-HARNESS-NATIVE'); await send('\r\r', '个可发现会话'); await send(`/${sessions.sender.id}\r`, /1\/1/);
    assert.equal(await copy(), `crosschat send --to ${sessions.sender.id} --tool dsh --body "<正文>"`);
    await send(':doctor\r', 'Harness 桥版本与身份');
    const page = (await event((entry) => entry.event === 'doctor')).page;
    for (const code of ['harness-bridge-ready', 'harness-profile-plugin-ready']) assert(page.rows.some((row) => row.searchText.includes(code)));
    await send(':maintenance\r', '安装 / 更新技能'); await send('/install-skills\r', /1\/1/); await send('\r', '确认提交'); await send('\r', '已取消操作');
    assert(!(await events()).some((entry) => entry.event === 'maintenance'));
    await send('\r', '确认提交'); await send('\t\r', '成功 3 项'); await event((entry) => entry.event === 'maintenance' && entry.result.status === 'complete');
    await send(':stars\r', 'C09-OWNED-STAR'); await send('\r', sessions.sender.title);
    await event((entry) => entry.event === 'members' && entry.page.rows.length === 1);
    assert.equal(await copy(), `crosschat send --via tcp:${node.starId}:${node.machineId}:${sessions.sender.id} --tool dsh --body "<正文>"`);
    let mark = pty.output.length; pty.resize(48, 16); await pty.waitForOutput('CC · 工作区', 10000, mark);
    mark = pty.output.length; pty.resize(140, 36); await pty.waitForOutput('CC · 工作区', 10000, mark);
    await send('q'); assert.deepEqual(await pty.exited, { code: 0, hostCode: 0 });
    const exit = (await events()).find((entry) => entry.event === 'exit'); assert.deepEqual(exit.after, exit.before);
    for (const mode of ['1049', '2004']) assert(pty.output.lastIndexOf(`\x1b[?${mode}l`) > pty.output.lastIndexOf(`\x1b[?${mode}h`));
    await save('tui-application.jsonl', await readFile(eventsPath, 'utf8'));
    await pty.dispose(); pty = undefined; await node.close(); node = undefined;
  });
  await check(4, async () => {
    const skill = join(fixture.env.DSH_HOME, 'skills/crosschat');
    await writeFile(join(skill, 'SKILL.md'), 'stale owned onboarding skill'); await writeFile(join(skill, 'extra-owned-fixture.txt'), marker);
    const update = await fixture.cli(['install-skills']); normal(update); await save('update-skills.json', update);
    assert.equal(await readFile(join(skill, 'SKILL.md'), 'utf8'), await readFile(join(repositoryRoot, 'skills/crosschat/SKILL.md'), 'utf8'));
    assert.equal(await readFile(join(skill, 'extra-owned-fixture.txt'), 'utf8'), marker);
    await fixture.stop();
    assert.equal(fixture.cleanup.runtimeStopped, true); assert.equal(fixture.cleanup.removed, false);
  });
  await check(5, async () => {
    const removed = await runDshCommand(process.execPath, [join(fixture.root, 'official-launcher.mjs'), 'plugin', '--profile', 'web', 'remove', '@crosschat/dsh-bridge'], { env: fixture.env, cwd: fixture.workspace, timeout: 120000 });
    maintenanceReleaseUnclear = removed.timedOut || removed.signal !== null || !Number.isInteger(removed.code);
    normal(removed); await save('remove-plugin.json', removed);
    const profileFile = join(fixture.env.DSH_HOME, 'profiles/web/package.json'), profile = await readFile(profileFile, 'utf8');
    assert(!JSON.parse(profile).dependencies?.['@crosschat/dsh-bridge']);
    const contentMarkers = [`${marker}skill`, `${marker}request`, `${marker}reply`];
    const chatFiles = await snapshotDshStoredChats(join(fixture.env.DSH_HOME, 'sessions'), contentMarkers);
    const uninstalled = await fixture.cli(['uninstall', '--yes']); normal(uninstalled); await save('uninstall-crosschat-data.json', uninstalled);
    assert.equal(await readFile(profileFile, 'utf8'), profile);
    assert.deepEqual(await snapshotDshStoredChats(join(fixture.env.DSH_HOME, 'sessions')), chatFiles);
    const skillExists = await readFile(join(fixture.env.DSH_HOME, 'skills/crosschat/SKILL.md')).then(() => true, (error) => { if (error.code === 'ENOENT') return false; throw error; });
    assert.equal(skillExists, false);
    await save('retained-profile-chat-hashes.json', { nativeSessionIds: Object.values(sessions).map((session) => session.id), contentMarkers,
      profileSha256: createHash('sha256').update(profile).digest('hex'), chatFiles });
    await fixture.close(); assert.equal(fixture.cleanup.removed, true);
  });
  report.status = 'passed'; report.stage = 'done'; report.category = null; delete report.check;
} catch (error) {
  report.error = redact(error instanceof Error ? error.message : String(error));
  if (error?.category === 'infrastructure') report.category = 'infrastructure';
  if (error?.cleanup) report.cleanup = error.cleanup;
} finally {
  const cleanupErrors = [];
  const release = async (label, operation) => { try { await operation(); } catch (error) { cleanupErrors.push(`${label}: ${redact(error.message)}`); } };
  await release('terminal', () => pty?.dispose()); await release('node', () => node?.close());
  if (fixture) {
    await release('terminal evidence', async () => { if (tuiEvents) { try { await save('tui-application.jsonl', await readFile(tuiEvents, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; } } });
    await release('runtime evidence', () => save('runtime-logs.json', fixture.logs));
    if (maintenanceReleaseUnclear) {
      cleanupErrors.push('Native package-manager release is unknown; the owned run root is retained'); report.retainedFixtureRoot = fixture.root;
    } else await release('runtime', () => fixture.close());
    report.cleanup = fixture.cleanup;
  }
  if (cleanupErrors.length) { report.status = 'failed'; report.category = 'infrastructure'; report.stage = 'cleanup'; report.check = 'owned-cleanup'; report.cleanupErrors = cleanupErrors; }
  report.finishedAt = new Date().toISOString();
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  process.stdout.write(`${JSON.stringify({ status: report.status, check: report.check, passed: report.checks.length, reportPath })}\n`);
  if (report.status !== 'passed') process.exitCode = 1;
}
