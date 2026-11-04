import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, realpath, writeFile, appendFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { launchPty } from './tui-pty-driver.mjs';

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const thisFile = fileURLToPath(import.meta.url);

async function fixture() {
  const [root, home, events] = process.argv.slice(3);
  const owner = JSON.parse(await readFile(join(root, 'ownership.json'), 'utf8'));
  assert(owner.task === 'dsh-profile-diagnostics-pty' && await realpath(root) === owner.root);
  for (const path of [home, events]) {
    const within = relative(owner.root, resolve(path));
    assert(within && !within.startsWith('..') && !isAbsolute(within));
  }
  const [{ runTui }, { createLocalOverview }, { createDoctorResource }, { createResourceRegistry, defaultResources }] = await Promise.all([
    import('../../dist/tui/main.js'), import('../../dist/application/observations/overview.js'),
    import('../../dist/tui/resources/overview.js'), import('../../dist/tui/resources/registry.js'),
  ]);
  const before = { raw: process.stdin.isRaw, sigint: process.listenerCount('SIGINT'), sigterm: process.listenerCount('SIGTERM') };
  const overview = createLocalOverview({ home,
    discovery: { execute: async () => { throw new Error('This doctor-only fixture never discovers native sessions'); } },
    env: { PATH: '', CROSSCHAT_CLAUDE_BIN: 'unavailable-claude', CROSSCHAT_CODEX_BIN: 'unavailable-codex' },
  });
  const readDoctor = overview.readDoctor;
  overview.readDoctor = async (request) => {
    const result = await readDoctor(request);
    await appendFile(events, JSON.stringify({ event: 'doctor', result }) + '\n');
    return result;
  };
  const doctor = createDoctorResource({ overview });
  const code = await runTui({ home, contexts: [{ id: 'local', kind: 'local', label: 'profile诊断fixture' }],
    registry: createResourceRegistry(defaultResources.map((resource) => resource.id === 'doctor' ? doctor.resource : resource)),
    adapters: { doctor: doctor.adapter }, version: 'Harness static profile fixture',
    clipboard: async () => { throw new Error('System clipboard is outside this fixture'); },
  });
  await appendFile(events, JSON.stringify({ event: 'exit', code, before,
    after: { raw: process.stdin.isRaw, sigint: process.listenerCount('SIGINT'), sigterm: process.listenerCount('SIGTERM') } }) + '\n');
  process.exitCode = code;
}

async function validate() {
  assert.equal(process.platform, 'win32', 'This validation uses the existing Windows ConPTY owner');
  const base = await realpath(process.env.DSH_DIAGNOSTIC_EVIDENCE_ROOT ?? tmpdir());
  const root = await mkdtemp(join(base, 'dsh-profile-pty-'));
  await writeFile(join(root, 'ownership.json'), JSON.stringify({ task: 'dsh-profile-diagnostics-pty', root: await realpath(root), runId: randomUUID() }));
  const results = [];
  let pty;
  try {
    for (const scenario of ['matching', 'different', 'not-declared']) {
      const home = join(root, scenario);
      const profileDir = join(home, '.dsh', 'profiles', 'desktop');
      const packageDir = join(profileDir, 'node_modules', '@crosschat', 'dsh-bridge');
      await mkdir(profileDir, { recursive: true });
      const manifest = JSON.stringify(scenario === 'not-declared' ? {} : {
        dependencies: { '@crosschat/dsh-bridge': 'file:private-fixture-spec' }, privateConfig: 'private-fixture-config',
      });
      await writeFile(join(profileDir, 'package.json'), manifest);
      if (scenario !== 'not-declared') await cp(join(workspace, 'integrations', 'dsh'), packageDir, { recursive: true });
      if (scenario === 'different') await writeFile(join(packageDir, 'bridge.js'), 'private-fixture-customized-code');
      const eventsPath = join(root, `${scenario}-application.jsonl`);
      pty = await launchPty({ executable: process.execPath, args: [thisFile, '--fixture', root, home, eventsPath], cwd: workspace,
        columns: 140, rows: 34, logPath: join(root, `${scenario}-pty.jsonl`),
        env: { HOME: home, USERPROFILE: home, APPDATA: join(home, 'appdata'), LOCALAPPDATA: join(home, 'localappdata'),
          CODEX_HOME: join(home, '.codex'), CODEX_SQLITE_HOME: join(home, '.codex'), CLAUDE_CONFIG_DIR: join(home, '.claude'), DSH_HOME: join(home, '.dsh') },
      });
      await pty.waitForOutput('profile诊断fixture');
      pty.write('\r'); await delay(100); pty.write(':doctor\r');
      const label = scenario === 'matching' ? 'Harness 插件安装文件' : scenario === 'different' ? 'Harness 插件配置异常' : 'Harness 插件引用';
      await pty.waitForOutput(label);
      pty.write(`/${label}\r`); await delay(100); pty.write('d');
      await pty.waitForOutput('只读详情');
      const mark = pty.output.length;
      pty.resize(64, 20); await pty.waitForOutput('CC · 工作区', 10_000, mark);
      pty.resize(140, 34); await delay(100); pty.write('\x1b'); await delay(100); pty.write('q');
      assert.deepEqual(await pty.exited, { code: 0, hostCode: 0 });
      const events = (await readFile(eventsPath, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
      const doctor = events.filter((event) => event.event === 'doctor');
      assert.equal(doctor.length, 1);
      const code = scenario === 'matching' ? 'harness-profile-plugin-ready' : scenario === 'different' ? 'harness-profile-plugin-warning' : 'harness-profile-not-declared';
      assert(doctor[0].result.checks.some((check) => check.code === code));
      const exit = events.find((event) => event.event === 'exit');
      assert(exit); assert.deepEqual(exit.after, exit.before);
      for (const flag of ['1049', '2004']) assert(pty.output.lastIndexOf(`\x1b[?${flag}l`) > pty.output.lastIndexOf(`\x1b[?${flag}h`));
      assert(!pty.output.includes('private-fixture-'));
      assert.equal(await readFile(join(profileDir, 'package.json'), 'utf8'), manifest);
      results.push({ scenario, code: 0, terminalRestored: true, profileUnchanged: true, privateFieldsHidden: true });
      await pty.dispose(); pty = undefined;
    }
  } finally { await pty?.dispose(); }
  const result = { root, source: 'Windows ConPTY; built TUI and diagnostic child; owned static profiles, no live DSH runtime', results };
  await writeFile(join(root, 'summary.json'), JSON.stringify(result, null, 2));
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[2] === '--fixture') await fixture();
else await validate();
