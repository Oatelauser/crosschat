/** Opt-in Windows OpenSSH -> existing local WSL sshd probe. No production host or installation. */
import { spawn } from 'node:child_process';
import console from 'node:console';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { clearTimeout, setTimeout } from 'node:timers';
import { createSshApplication } from '../../dist/application/ssh/index.js';

if (process.platform !== 'win32') throw new Error('This opt-in probe requires Windows OpenSSH and an existing local WSL sshd.');
const prefix = join(tmpdir(), 'crosschat-native-ssh-');
const home = await mkdtemp(prefix);
if (!resolve(home).startsWith(resolve(prefix))) throw new Error('Unsafe local fixture cleanup path.');
const password = `isolated-fixture-${Date.now()}`;
const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
const linuxPath = (value) => `/mnt/${value[0].toLowerCase()}/${value.slice(3).replaceAll('\\', '/')}`;
let linuxRoot;
let supervisor;
let application;
let serverPid;
let serverOutput = '';
const results = [];
function run(command, args) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; let err = '';
    child.stdout.on('data', (chunk) => { out += chunk; }); child.stderr.on('data', (chunk) => { err += chunk; });
    child.once('error', reject); child.once('close', (code) => code === 0 ? resolveResult(out.trim()) : reject(new Error(`Fixture command failed (${code}): ${err.replaceAll(password, '[redacted]')}`)));
  });
}
const wsl = (command) => run('wsl', ['--exec', 'sh', '-lc', command]);
async function portNumber() {
  const server = createServer();
  await new Promise((resolveReady, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolveReady); });
  const address = server.address(); const port = address.port;
  await new Promise((resolveClosed) => server.close(resolveClosed)); return port;
}
async function available(port) {
  return new Promise((resolveReady) => {
    const socket = connect({ port, host: '127.0.0.1' });
    const finish = (ok) => { socket.destroy(); resolveReady(ok); };
    socket.once('connect', () => finish(true)); socket.once('error', () => finish(false)); socket.setTimeout(250, () => finish(false));
  });
}
async function stop() {
  if (!supervisor) return;
  const child = supervisor; supervisor = undefined;
  if (child.exitCode !== null) return;
  const closed = new Promise((resolveClosed) => child.once('close', resolveClosed));
  child.stdin.end();
  const timer = setTimeout(() => { if (serverPid) void wsl(`kill -TERM ${serverPid}`).catch(() => {}); }, 3000);
  try { await closed; } finally { clearTimeout(timer); }
}
async function start(config, port) {
  serverOutput = '';
  const program = `const{spawn}=require('node:child_process');const child=spawn('/usr/sbin/sshd',['-D','-e','-f',process.argv[1]],{stdio:['ignore','ignore','pipe']});console.log('PID:'+child.pid);child.stderr.pipe(process.stderr);process.stdin.resume();let stopping=false;const stop=()=>{if(stopping)return;stopping=true;child.kill('SIGTERM');};process.stdin.once('end',stop);process.on('SIGTERM',stop);child.once('close',code=>process.exit(stopping?0:code||1));`;
  supervisor = spawn('wsl', ['--exec', 'node', '-e', program, config], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  supervisor.stdout.on('data', (chunk) => { const match = /PID:(\d+)/.exec(String(chunk)); if (match) serverPid = Number(match[1]); });
  supervisor.stderr.on('data', (chunk) => { if (serverOutput.length < 8192) serverOutput += chunk; });
  for (let attempt = 0; attempt < 50; attempt++) {
    if (await available(port)) return;
    if (supervisor.exitCode !== null) throw new Error(`Owned sshd exited: ${serverOutput}`);
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error('Local WSL loopback forwarding was not available.');
}
function assert(condition, label, extra = {}) {
  results.push({ label, passed: Boolean(condition), ...extra });
  if (!condition) throw new Error(`Native SSH probe failed: ${label}`);
}

try {
  linuxRoot = await wsl('mktemp -d /root/.crosschat-native-sshd-XXXXXX');
  if (!/^\/root\/\.crosschat-native-sshd-[A-Za-z0-9]+$/.test(linuxRoot)) throw new Error('Unexpected owned Linux fixture path.');
  await mkdir(join(home, '.ssh'));
  const privateKey = join(home, 'fixture-key');
  await run('ssh-keygen', ['-q', '-t', 'ed25519', '-N', password, '-f', privateKey]);
  const port = await portNumber();
  await wsl(`ssh-keygen -q -t ed25519 -N '' -f ${quote(`${linuxRoot}/host-key`)} && cp ${quote(linuxPath(`${privateKey}.pub`))} ${quote(`${linuxRoot}/authorized_keys`)} && chmod 600 ${quote(`${linuxRoot}/authorized_keys`)}`);
  const responseFile = join(home, 'response.mjs');
  await writeFile(responseFile, `process.stdin.resume();process.stdin.once('end',()=>process.stdout.write(JSON.stringify({op:'list',providers:[],page:{items:[],nextCursor:null,completeness:'complete',errors:[],observedAt:1}})));`);
  await wsl(`cp ${quote(linuxPath(responseFile))} ${quote(`${linuxRoot}/response.mjs`)}`);
  const configFile = join(home, 'sshd-config');
  await writeFile(configFile, `Port ${port}\nListenAddress 127.0.0.1\nHostKey ${linuxRoot}/host-key\nPidFile ${linuxRoot}/sshd.pid\nAuthorizedKeysFile ${linuxRoot}/authorized_keys\nPasswordAuthentication no\nKbdInteractiveAuthentication no\nPubkeyAuthentication yes\nUsePAM yes\nPermitRootLogin yes\nStrictModes yes\nAllowUsers root\nLogLevel VERBOSE\nForceCommand /usr/local/bin/node ${linuxRoot}/response.mjs\n`);
  const linuxConfig = `${linuxRoot}/sshd-config`;
  await wsl(`cp ${quote(linuxPath(configFile))} ${quote(linuxConfig)}`);
  await start(linuxConfig, port);
  const clientConfig = join(home, '.ssh', 'config');
  await writeFile(clientConfig, `Host fixture\n  HostName 127.0.0.1\n  Port ${port}\n  User root\n  IdentityFile "${privateKey.replaceAll('\\', '/')}"\n  IdentitiesOnly yes\n`);
  const challenges = [];
  let clientOutput = '';
  application = createSshApplication({ home, configFile: clientConfig, timeoutMs: 20_000, spawn: (command, args, settings) => {
    const child = spawn(command, args, settings); child.stderr.on('data', (chunk) => { if (clientOutput.length < 8192) clientOutput += chunk; }); return child;
  }, onChallenge: async (challenge) => {
    challenges.push({ kind: challenge.kind, ...(challenge.kind === 'host-key' ? { algorithm: challenge.algorithm, fingerprint: challenge.fingerprint } : {}) });
    return challenge.kind === 'host-key' ? true : password;
  } });
  application.setActiveContext('ssh:fixture');
  const first = await application.inspect({ contextId: 'ssh:fixture' });
  assert(first.completeness === 'complete', 'native external Host authentication and discover', { completeness: first.completeness, errors: first.errors,
    ...(first.completeness === 'complete' ? {} : { serverLog: serverOutput.replaceAll(password, '[redacted]'), clientLog: clientOutput.replaceAll(password, '[redacted]'), challenges }) });
  assert(challenges.filter((item) => item.kind === 'host-key').length === 1 && challenges.filter((item) => item.kind === 'passphrase').length === 1, 'one full host fingerprint and one encrypted-key challenge');
  const expectedFingerprint = (await wsl(`ssh-keygen -lf ${quote(`${linuxRoot}/host-key.pub`)} -E sha256`)).split(/\s+/)[1];
  assert(challenges[0].fingerprint === expectedFingerprint, 'shown fingerprint equals the real server key');
  assert((await readFile(join(home, '.ssh', 'known_hosts'), 'utf8')).includes('ssh-ed25519'), 'approved server key persisted to isolated known_hosts');
  assert((await application.inspect({ contextId: 'ssh:fixture' })).completeness === 'complete' && challenges.length === 2, 'refresh reuses only active-connection memory secret');
  const request = { operation: 'create', profile: { name: 'Managed fixture', host: '127.0.0.1', user: 'root', port, keyFile: privateKey } };
  const created = await application.configuration.apply({ ...request, expectedRevision: (await application.configuration.preview(request)).revision });
  application.setActiveContext(created.contextId);
  assert((await application.inspect({ contextId: created.contextId })).completeness === 'complete', 'managed profile native target arguments authenticate');
  assert(challenges.length === 3, 'changing connection clears the previous credential cache');
  await stop();
  await wsl(`rm -- ${quote(`${linuxRoot}/host-key`)} ${quote(`${linuxRoot}/host-key.pub`)} && ssh-keygen -q -t ed25519 -N '' -f ${quote(`${linuxRoot}/host-key`)}`);
  await start(linuxConfig, port);
  const changed = await application.inspect({ contextId: created.contextId });
  assert(changed.completeness === 'unavailable' && challenges.length === 3, 'changed known host is refused without another trust prompt');
} finally {
  await application?.dispose(); await stop();
  if (linuxRoot && /^\/root\/\.crosschat-native-sshd-[A-Za-z0-9]+$/.test(linuxRoot)) await wsl(`rm -rf -- ${quote(linuxRoot)}`);
  await rm(home, { recursive: true, force: true });
  console.log(JSON.stringify({ platform: process.platform, transport: 'Windows OpenSSH to existing local WSL sshd only', results, cleanup: 'owned SSH server stopped; validated fixture roots removed' }, null, 2));
}
