import { Buffer } from 'node:buffer';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, sep } from 'node:path';
import process from 'node:process';
import console from 'node:console';
import { prepareDesktopProfile } from './opencode-desktop-live-fixture.mjs';
import { runCommand } from './opencode-live-fixture.mjs';

if (process.platform !== 'win32') throw new Error('This read-only diagnostic requires Windows');
const parent = await realpath(tmpdir());
const root = await realpath(await mkdtemp(join(parent, 'crosschat-cim-diagnostic-')));
async function removeOwnedRoot() {
  const resolved = await realpath(root);
  const child = relative(parent, resolved);
  if (resolved !== root || !child || child === '..' || child.startsWith(`..${sep}`) || isAbsolute(child)) throw new Error('Diagnostic cleanup escaped its owned temporary root');
  await rm(resolved, { recursive: true, force: true });
}
try {
  const env = await prepareDesktopProfile(root);
  const binary = join(env.SystemRoot ?? env.SYSTEMROOT, 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const script = [
    '$ErrorActionPreference = "Stop"',
    '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)',
    '$crosschatCimClock = [System.Diagnostics.Stopwatch]::StartNew()',
    '[Console]::Error.WriteLine("crosschat-cim-diagnostic:started")',
    'Import-Module (Join-Path $PSHOME "Modules/CimCmdlets/CimCmdlets.psd1") -ErrorAction Stop',
    '[Console]::Error.WriteLine("crosschat-cim-diagnostic:module:" + $crosschatCimClock.ElapsedMilliseconds)',
    '$crosschatOwnRows = @(Get-CimInstance -ClassName Win32_Process -Filter ("ProcessId = " + $PID) -Property ProcessId, ExecutablePath, ParentProcessId)',
    '[Console]::Error.WriteLine("crosschat-cim-diagnostic:self:" + $crosschatCimClock.ElapsedMilliseconds)',
    '$crosschatAllRows = @(Get-CimInstance -ClassName Win32_Process -Property ProcessId, ExecutablePath, ParentProcessId)',
    '[Console]::Error.WriteLine("crosschat-cim-diagnostic:all:" + $crosschatCimClock.ElapsedMilliseconds)',
    '@{ ownCount = $crosschatOwnRows.Count; allCount = $crosschatAllRows.Count; elapsedMs = $crosschatCimClock.ElapsedMilliseconds } | ConvertTo-Json -Compress',
  ].join('\n');
  const result = await runCommand(binary, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], { env, cwd: root, timeout: 30000 });
  let counts;
  try { counts = JSON.parse(result.stdout); } catch { /* Partial output is not an observation. */ }
  console.log(JSON.stringify({ diagnostic: 'non-admitting CIM measurement', budgetMs: 30000, code: result.code,
    timedOut: result.timedOut, phases: result.stderr.trim().slice(0, 2000), stdoutBytes: Buffer.byteLength(result.stdout), counts }));
} finally {
  await removeOwnedRoot();
}
