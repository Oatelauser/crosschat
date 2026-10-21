import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { defaultOutboxDir, mailboxFileFor } from '../../outbox.js';
import { watchdogStatus } from '../../watchdog.js';
import { readNodeConfig } from '../../serve/node-config.js';
import type { BrokerEntry } from '../../serve/node-config.js';
import { DEFAULT_PORT } from '../../serve/broker.js';
import { isProcessAlive } from '../../platform/process-inspector.js';
import { listNodeStatusFiles, nodeStatusSelector, TCP_STATUS_FRESH_MS } from '../status/status-files.js';
import type { DoctorDeps } from './deps.js';
import { diagnosticCheck, summarizeDiagnosticChecks } from './model.js';
import type { DiagnosticCheckGroup, DiagnosticGroup, DiagnosticInput, DiagnosticResult } from './model.js';

const CODEX_MIN_VERSION: readonly [number, number, number] = [0, 160, 0];

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Existing one-shot probes and decisions; no formatting or automatic repair. */
export function collectDoctorDiagnostics(deps: DoctorDeps): DiagnosticResult {
  const groups: DiagnosticCheckGroup[] = [];
  const group = (context: DiagnosticGroup): DiagnosticCheckGroup => {
    const found = groups.find((candidate) => candidate.context.kind === context.kind
      && (candidate.context.kind !== 'tcp' || context.kind !== 'tcp' || candidate.context.star === context.star));
    if (found !== undefined) return found;
    const next = { context, checks: [] };
    groups.push(next);
    return next;
  };
  const starGroup = (star: string): DiagnosticCheckGroup => group({ kind: 'tcp', star });
  let current = group({ kind: 'environment' });
  const add = (input: DiagnosticInput): void => { current.checks.push(diagnosticCheck(input)); };

  const major = Number.parseInt(deps.nodeVersion.split('.')[0] ?? '', 10);
  add({ code: Number.isInteger(major) && major >= 22 ? 'node-supported' : 'node-unsupported', data: { version: deps.nodeVersion } });

  try {
    const executable = deps.resolveClaude();
    const scan = deps.listClaudeSessions();
    if (scan.sessions.length === 0) add({ code: 'claude-empty', data: { executable } });
    else add({ code: 'claude-ready', data: { executable, count: scan.sessions.length } });
    if (scan.malformed > 0) add({ code: 'claude-registry-malformed', data: { count: scan.malformed } });
  } catch {
    add({ code: 'claude-missing', data: {} });
  }

  let codexBin: string | undefined;
  try { codexBin = deps.codexBin(); } catch { /* Report missing below. */ }
  if (codexBin === undefined) add({ code: 'codex-missing', data: {} });
  else {
    const cli = deps.run(codexBin, ['--version']);
    if (cli.error !== undefined) add({ code: 'codex-missing', data: {} });
    else {
      const version = cli.status === 0 ? parseSemver(cli.stdout ?? '') : undefined;
      if (version === undefined) add({ code: 'codex-unparsed', data: { firstLine: firstLine(cli.stdout), status: cli.status } });
      else add({ code: cmpVersion(version, CODEX_MIN_VERSION) < 0 ? 'codex-cli-old' : 'codex-cli-ready', data: { version: version.join('.') } });

      const daemon = deps.run(codexBin, ['app-server', 'daemon', 'version']);
      const daemonVersion = daemon.status === 0 ? parseSemver(daemon.stdout ?? '') : undefined;
      if (daemonVersion === undefined) add({ code: 'codex-daemon-missing', data: {} });
      else add({ code: cmpVersion(daemonVersion, CODEX_MIN_VERSION) < 0 ? 'codex-daemon-old' : 'codex-daemon-ready', data: { version: daemonVersion.join('.') } });
    }
  }

  const repo = deps.repoSkillFiles();
  for (const root of ['.claude', '.codex'] as const) {
    const side = root === '.claude' ? 'claude' : 'codex';
    const skillDir = join(deps.homeDir(), root, 'skills', 'crosschat');
    const path = join(skillDir, 'SKILL.md');
    if (!deps.exists(path)) {
      add({ code: 'skill-missing', data: { side, path } });
      continue;
    }
    if (repo === undefined) {
      add({ code: 'skill-installed', data: { side } });
      continue;
    }
    const paths = repo.filter((file) => deps.readFile(join(skillDir, file.path)) !== file.content).map((file) => file.path);
    if (paths.length === 0) add({ code: 'skill-match', data: { side } });
    else add({ code: 'skill-mismatch', data: { side, paths } });
  }

  const claudeSide = (deps.env.CLAUDE_CODE_MESSAGING_SOCKET ?? '') !== '';
  const codexSide = (deps.env.CODEX_THREAD_ID ?? '') !== '' || (deps.env.CODEX_SESSION_ID ?? '') !== '';
  add({ code: claudeSide && codexSide ? 'identity-conflict' : 'identity-clear', data: {} });

  if (deps.tcpDir !== undefined) {
    const nodePath = join(deps.tcpDir, 'node.json');
    const brokerPath = join(deps.tcpDir, 'broker.json');
    const nodeRaw = deps.readFile(nodePath);
    const brokerRaw = deps.readFile(brokerPath);
    if (nodeRaw !== undefined || brokerRaw !== undefined) {
      const label = (entry: BrokerEntry): string => entry.name ?? `${entry.host}:${entry.port}`;
      let entries: BrokerEntry[] | undefined;
      if (nodeRaw !== undefined) {
        try { entries = readNodeConfig(nodePath).entries; }
        catch {
          current = group({ kind: 'tcp' });
          add({ code: 'node-config-invalid', data: { path: nodePath } });
        }
        if (entries !== undefined) {
          for (const entry of entries) {
            current = starGroup(label(entry));
            add({ code: 'node-config-ready', data: {} });
          }
          if (entries.length > 1) {
            for (const entry of entries) {
              if (entry.starId === undefined) {
                current = starGroup(label(entry));
                add({ code: 'node-star-id-missing', data: { label: label(entry) } });
              }
            }
            const firstOfStar = new Map<string, string>();
            for (const entry of entries) {
              if (entry.starId === undefined) continue;
              const first = firstOfStar.get(entry.starId);
              if (first === undefined) firstOfStar.set(entry.starId, label(entry));
              else {
                current = starGroup(label(entry));
                add({ code: 'node-star-id-duplicate', data: { first, label: label(entry), starId: entry.starId } });
              }
            }
          }
        }
      }
      if (entries !== undefined) {
        const probe = deps.probeTcp ?? (() => true);
        for (const entry of entries) {
          current = starGroup(label(entry));
          add({ code: probe(entry.host, entry.port) ? 'broker-reachable' : 'broker-unreachable', data: { host: entry.host, port: entry.port } });
        }
      }
      if (brokerRaw !== undefined) {
        current = groups.find((candidate) => candidate.context.kind === 'tcp' && candidate.context.star !== undefined) ?? group({ kind: 'tcp' });
        try {
          const doc: unknown = JSON.parse(brokerRaw);
          if (!record(doc) || !Array.isArray(doc.stars)) throw new Error('bad shape');
          let nodes = 0;
          for (const star of doc.stars) {
            if (!record(star) || !Array.isArray(star.nodes) || star.nodes.some((node: unknown) => !record(node) || typeof node.label !== 'string')) {
              throw new Error('bad shape');
            }
            nodes += star.nodes.length;
          }
          if (doc.stars.length === 0) add({ code: 'broker-empty', data: {} });
          else add({ code: 'broker-ready', data: { stars: doc.stars.length, nodes } });
          if (typeof doc.port === 'number' && doc.port !== DEFAULT_PORT) {
            add({ code: 'broker-port-custom', data: { port: doc.port, defaultPort: DEFAULT_PORT, path: brokerPath } });
          }
        } catch { add({ code: 'broker-invalid', data: {} }); }
      }
    }
  }

  if (deps.tcpDir !== undefined && deps.cliVersion !== undefined) {
    const tcpDir = deps.tcpDir;
    const cliVersion = deps.cliVersion;
    const nowMs = deps.now?.() ?? Date.now();
    const reconcile = (file: string, label: string, restartCommand: string): void => {
      const raw = deps.readFile(join(tcpDir, file));
      if (raw === undefined) return;
      let parsed: unknown;
      try { parsed = JSON.parse(raw); } catch { return; }
      if (!record(parsed)) return;
      if (file === 'status-node.json') {
        current = typeof parsed.brokerAlias === 'string' && parsed.brokerAlias !== '' ? starGroup(parsed.brokerAlias) : group({ kind: 'other' });
      } else if (file === 'status-broker.json') {
        current = typeof parsed.name === 'string' && parsed.name !== '' ? starGroup(parsed.name) : group({ kind: 'other' });
      } else current = starGroup(nodeStatusSelector(file));
      if (!(nowMs - Date.parse(String(parsed.lastUpdated)) < TCP_STATUS_FRESH_MS)) {
        add({ code: 'status-stale', data: { file } });
        return;
      }
      const pid = parsed.pid;
      if (typeof pid !== 'number' || !(deps.isProcessAlive ?? isProcessAlive)(pid)) {
        add({ code: 'status-process-unavailable', data: { file, ...(typeof pid === 'number' ? { pid } : {}) } });
        return;
      }
      const version = parsed.version;
      if (typeof version === 'string' && version !== '' && version !== cliVersion) {
        add({ code: 'resident-version-mismatch', data: { label, version, cliVersion, restartCommand } });
      }
    };
    reconcile('status-broker.json', 'broker', 'serve --stop && serve --detach');
    const list = deps.readDir ?? ((dir: string) => {
      try { return readdirSync(dir); } catch { return []; }
    });
    for (const file of listNodeStatusFiles(tcpDir, list)) {
      const selector = nodeStatusSelector(file);
      reconcile(file, selector === '' ? '节点守护' : `节点守护 ${selector}`,
        selector === '' ? 'crosschat serve --connect --detach' : `crosschat serve --connect ${selector} --detach`);
    }
  }

  current = group({ kind: 'other' });
  const parked = deps.listOutbox();
  if (parked.length === 0) add({ code: 'outbox-empty', data: {} });
  else {
    const watchdog = deps.watchdogRunning?.() ?? watchdogStatus(defaultOutboxDir());
    const nowMs = deps.now?.() ?? Date.now();
    for (const { threadId, count, oldestParkedAt } of parked) {
      add({ code: 'outbox-parked', data: {
        threadId, count, watchdogRunning: watchdog.running, mailboxFile: mailboxFileFor(defaultOutboxDir(), threadId),
        ...(oldestParkedAt === undefined ? {} : { ageMinutes: Math.max(1, Math.round((nowMs - oldestParkedAt) / 60_000)) }),
      } });
    }
  }
  return { groups, summary: summarizeDiagnosticChecks(groups) };
}

function parseSemver(text: string): [number, number, number] | undefined {
  const match = text.match(/(\d+)\.(\d+)\.(\d+)/);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : undefined;
}

function cmpVersion(a: readonly [number, number, number], b: readonly [number, number, number]): number {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
  return 0;
}

function firstLine(text: string | undefined): string {
  return (text ?? '').split(/\r?\n/, 1)[0] ?? '';
}
