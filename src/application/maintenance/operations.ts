import { createHash } from 'node:crypto';
import { closeSync, fstatSync, lstatSync, openSync, opendirSync, readSync, readdirSync, rmSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { legacyStateRoots, stateRoot } from '../../state-root.js';
import { executeCleanup, planCleanup } from '../cleanup/index.js';
import { defaultInstallSkillsDeps, installSkillDestination, skillDestinations } from './skills.js';
import { removeUninstallTargets, uninstallTargets } from './uninstall.js';
import type { UninstallEnvironment } from './uninstall.js';
import { isMaintenanceOperationId, MAINTENANCE_OPERATIONS } from './model.js';
import type { MaintenanceItem, MaintenanceOperationId, MaintenancePreview, MaintenanceResult, MaintenanceTarget } from './model.js';
import { TCP_STATUS_FRESH_MS } from '../status/status-files.js';

export interface MaintenanceOperationOptions {
  home: string;
  sourceDir?: string;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
  /** Internal filesystem seam; production executes it off the TUI thread. */
  effects?: { remove?(file: string, recursive: boolean): void; install?(source: string, destination: string): void };
}
interface Environment { home: string; source: string; uninstall: UninstallEnvironment }
function environment(options: MaintenanceOperationOptions): Environment {
  if (!isAbsolute(options.home)) throw new Error('维护需要明确的本机用户绝对路径。');
  const home = resolve(options.home);
  const source = options.sourceDir ?? defaultInstallSkillsDeps().sourceDir();
  if (!isAbsolute(source)) throw new Error('技能安装源必须为绝对路径。');
  const legacy = legacyStateRoots(home, options.env ?? {}).map((file) => resolve(file));
  return { home, source: resolve(source), uninstall: { crosschatHome: stateRoot(home), stateRoot: stateRoot(home), legacyStateRoots: legacy,
    skillDirs: skillDestinations(home), now: options.now ?? Date.now } };
}
function operation(operationId: MaintenanceOperationId) {
  const value = MAINTENANCE_OPERATIONS.find((item) => item.id === operationId);
  if (!value) throw new Error('未知维护任务，未执行任何操作。');
  return value;
}
const reasons = { expired: '收件/断点超过5天', 'inbox-capacity': '收件超过容量上限，从最旧开始', 'shard-expired': '会话分片30天未更新', force: '强制清理' };
function cleanupPlan(operationId: MaintenanceOperationId, options: MaintenanceOperationOptions, env: Environment) {
  return planCleanup({ force: operationId === 'cleanup-force' }, { tcpDir: join(env.uninstall.crosschatHome, 'tcp'), conversationsDir: join(env.uninstall.crosschatHome, 'conversations'), now: options.now ?? Date.now });
}
function fingerprint(value: { operationId: MaintenanceOperationId; enabled: boolean; reason?: string; targets: MaintenanceTarget[]; effects: string[] }): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
/** Inspect each ancestor before descending; never stat or list through a link. */
function verifyDirectoryPath(root: string, target: string, allowFinalFile = false): void {
  const descendant = relative(root, target);
  if (!descendant || isAbsolute(descendant) || descendant === '..' || descendant.startsWith(`..${sep}`)) throw new Error('维护目标不在已知范围。');
  const segments = descendant.split(sep);
  let current = root;
  for (const [index, segment] of segments.entries()) {
    current = join(current, segment);
    let stat;
    try { stat = lstatSync(current); }
    catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return;
      throw error;
    }
    if (stat.isSymbolicLink() || (!stat.isDirectory() && !(allowFinalFile && index === segments.length - 1 && stat.isFile()))) throw new Error('维护目录不可完整核验。');
  }
}
/** TUI previews fail closed when the legacy planner's skip-on-stat-error would hide candidates. */
function verifyCleanupInventory(home: string, root: string): void {
  for (const relative of ['tcp/inbox', 'tcp/parts', 'conversations']) {
    const directory = join(root, relative);
    verifyDirectoryPath(home, directory);
    let names: string[];
    try { names = readdirSync(directory); }
    catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') continue;
      throw error;
    }
    for (const name of names) {
      if (relative === 'conversations' && !name.endsWith('.json')) continue;
      lstatSync(join(directory, name));
    }
  }
}

const MAX_INVENTORY_ENTRIES = 10_000;
const MAX_COPY_DEPTH = 64;
const MAX_STATUS_BYTES = 2 * 1024 * 1024;
interface InventoryBudget { entries: number }
function missing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
/** A bounded iterator retains one directory owner and never follows directory links. */
function directoryEntries(directory: string, budget: InventoryBudget, visit: (path: string) => void): void {
  const handle = opendirSync(directory);
  try {
    for (;;) {
      const entry = handle.readSync();
      if (entry === null) return;
      if (++budget.entries > MAX_INVENTORY_ENTRIES) throw new Error('Maintenance inventory exceeds its entry limit.');
      visit(join(directory, entry.name));
    }
  } finally { handle.closeSync(); }
}
/** Verify readable ordinary files without reading skill contents or accepting hard-linked write destinations. */
function readableFile(file: string, destination = false): void {
  const entry = lstatSync(file, { bigint: true });
  if (!entry.isFile() || entry.isSymbolicLink() || (destination && entry.nlink !== 1n)) throw new Error('Maintenance file is not an independent regular file.');
  const descriptor = openSync(file, 'r');
  try {
    const opened = fstatSync(descriptor, { bigint: true });
    if (!opened.isFile() || opened.ino !== entry.ino || opened.dev !== entry.dev || (destination && opened.nlink !== 1n)) throw new Error('Maintenance file identity changed.');
  } finally { closeSync(descriptor); }
}
function verifySkillTree(directory: string, budget: InventoryBudget, destination = false, depth = 0): void {
  if (depth > MAX_COPY_DEPTH) throw new Error('Maintenance copy tree exceeds its depth limit.');
  let entry;
  try { entry = lstatSync(directory); }
  catch (error) { if (destination && depth === 0 && missing(error)) return; throw error; }
  if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error('Maintenance copy tree contains a directory link or unsupported entry.');
  directoryEntries(directory, budget, (path) => {
    const child = lstatSync(path);
    if (child.isSymbolicLink()) throw new Error('Maintenance copy tree contains a link.');
    if (child.isDirectory()) verifySkillTree(path, budget, destination, depth + 1);
    else readableFile(path, destination);
  });
}
function readUninstallStatus(file: string): { state: string; lastUpdated: number } {
  const entry = lstatSync(file, { bigint: true });
  if (!entry.isFile() || entry.isSymbolicLink() || entry.size > BigInt(MAX_STATUS_BYTES)) throw new Error('Uninstall service status is not a bounded regular file.');
  const descriptor = openSync(file, 'r');
  try {
    const opened = fstatSync(descriptor, { bigint: true });
    if (!opened.isFile() || opened.ino !== entry.ino || opened.dev !== entry.dev || opened.size > BigInt(MAX_STATUS_BYTES)) throw new Error('Uninstall service status identity changed.');
    const buffer = Buffer.alloc(Math.min(Number(opened.size) + 1, MAX_STATUS_BYTES + 1));
    const bytes = readSync(descriptor, buffer, 0, buffer.length, 0);
    if (bytes > MAX_STATUS_BYTES) throw new Error('Uninstall service status exceeds its byte limit.');
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytes)));
    if (typeof value !== 'object' || value === null || Array.isArray(value) || !('state' in value) || typeof value.state !== 'string'
      || !('lastUpdated' in value) || typeof value.lastUpdated !== 'string' || !Number.isFinite(Date.parse(value.lastUpdated))) throw new Error('Uninstall service status is malformed.');
    return { state: value.state, lastUpdated: Date.parse(value.lastUpdated) };
  } finally { closeSync(descriptor); }
}
/** Retain the old freshness decisions, but unknown TUI sources must not authorize recursive deletion. */
function verifyUninstallStatuses(environment: UninstallEnvironment): boolean {
  const directory = join(environment.crosschatHome, 'tcp');
  let running = false;
  try {
    directoryEntries(directory, { entries: 0 }, (file) => {
      const name = file.slice(directory.length + 1);
      if (name !== 'status-broker.json' && !/^status-node.*\.json$/.test(name)) return;
      const status = readUninstallStatus(file);
      if (environment.now() - status.lastUpdated < TCP_STATUS_FRESH_MS && (name !== 'status-broker.json' || status.state === 'running')) running = true;
    });
  } catch (error) { if (missing(error)) return running; throw error; }
  return running;
}

/** Read-only preview of the current command scopes; never creates paths or repairs data. */
export function previewMaintenance(operationId: MaintenanceOperationId, options: MaintenanceOperationOptions): MaintenancePreview {
  if (!isMaintenanceOperationId(operationId)) throw new Error('未知维护任务。');
  const selected = operation(operationId);
  const env = environment(options);
  const observedAt = (options.now ?? Date.now)();
  let enabled = true;
  let reason: string | undefined;
  let targets: MaintenanceTarget[] = [];
  const effects: string[] = [selected.guidance];
  if (operationId === 'cleanup' || operationId === 'cleanup-force') {
    try {
      verifyCleanupInventory(env.home, env.uninstall.crosschatHome);
      const plan = cleanupPlan(operationId, options, env);
      targets = plan.targets.map((item) => ({ path: item.file, label: reasons[item.reason], kind: 'file', bytes: item.size, modifiedAt: item.mtime }));
      effects.push(`本次预览将删除 ${targets.length} 项；仅执行这次确认的清单。`);
      effects.push('请确认没有正在进行的文件传输；确认不会停止传输或服务。');
    } catch {
      enabled = false; reason = '无法完整读取清理范围；检查目录类型、文件元数据和访问权限后重新预览。';
    }
  } else if (operationId === 'install-skills') {
    targets = skillDestinations(env.home).map((path) => ({ path, label: '覆盖安装 / 更新crosschat技能', kind: 'directory' }));
    effects.push(`安装源：${env.source}`);
    try {
      for (const target of targets) verifyDirectoryPath(env.home, target.path);
      const budget = { entries: 0 };
      verifySkillTree(env.source, budget);
      for (const target of targets) verifySkillTree(target.path, budget, true);
    } catch { enabled = false; reason = '技能安装源或目标子树不可完整核验；检查链接、文件类型、读取权限和目录规模后重新预览（合计至多10000项、64层）。'; }
    effects.push('不会调用npm，不会安装其他工具或修改原生聊天配置。');
  } else {
    targets = uninstallTargets(env.uninstall).map(({ path, label }) => ({ path, label, kind: 'directory' }));
    try {
      for (const target of targets) {
        const parent = options.env?.LOCALAPPDATA && target.path === resolve(join(options.env.LOCALAPPDATA, 'crosschat'))
          ? resolve(options.env.LOCALAPPDATA) : env.home;
        verifyDirectoryPath(parent, target.path, true);
      }
      // The legacy serve guard reads tcp snapshots; verify that read path too.
      verifyDirectoryPath(env.home, join(env.uninstall.crosschatHome, 'tcp'));
    } catch { enabled = false; reason = '卸载目标目录不可完整核验；检查目录链接、类型及访问权限后重新预览。'; }
    if (enabled) {
      try {
        if (verifyUninstallStatuses(env.uninstall)) {
          enabled = false; reason = 'crosschat serve 正在运行（或有新鲜节点快照）；先停止对应服务，再重新预览卸载。';
        }
      } catch { enabled = false; reason = '服务状态来源不可完整核验；检查状态快照的格式、大小、链接和读取权限后重新预览卸载。'; }
    }
    effects.push('npm包尚未卸载；本任务不会执行npm。收尾命令：npm uninstall -g @oatelauser/crosschat');
    effects.push('卸载后数据、日志和技能会消失，当前TUI读取结果可能变为未配置。');
  }
  const value = { operationId, enabled, ...(reason === undefined ? {} : { reason }), targets, effects };
  return { ...value, label: selected.label, observedAt, fingerprint: fingerprint(value) };
}

/** Recompute inside the write owner; a changed preview never silently broadens the accepted plan. */
export function executeMaintenance(operationId: MaintenanceOperationId, expectedFingerprint: string, options: MaintenanceOperationOptions): MaintenanceResult {
  const startedAt = (options.now ?? Date.now)();
  const preview = previewMaintenance(operationId, options);
  const result = (status: MaintenanceResult['status'], message: string, items: MaintenanceItem[] = []): MaintenanceResult => ({ operationId, status, startedAt, finishedAt: (options.now ?? Date.now)(), npm: 'not-run', message, items });
  if (!preview.enabled) return result('blocked', preview.reason ?? '当前维护任务不可执行。');
  if (preview.fingerprint !== expectedFingerprint) return result('changed', '维护范围已变化，未执行任何操作；请重新预览并确认。');
  const env = environment(options);
  const items: MaintenanceItem[] = [];
  if (operationId === 'cleanup' || operationId === 'cleanup-force') {
    const plan = cleanupPlan(operationId, options, env);
    // No asynchronous gap occurs between this fresh plan and synchronous execution.
    const actual = executeCleanup(plan, { remove: (file) => {
      if (!preview.targets.some((target) => target.path === file)) throw new Error('Unconfirmed target');
      (options.effects?.remove ?? ((path: string) => rmSync(path, { force: true })))(file, false);
    } });
    items.push(...actual.items.map((item): MaintenanceItem => ({ path: item.file, outcome: item.deleted ? 'deleted' : 'failed', ...(item.deleted ? {} : { message: '删除失败，请核对该路径权限后重新预览。' }) })));
  } else if (operationId === 'install-skills') {
    let stopped = false;
    for (const target of preview.targets) {
      if (stopped) { items.push({ path: target.path, outcome: 'skipped', message: '前一目标失败，按原有顺序停止，尚未尝试。' }); continue; }
      try { (options.effects?.install ?? installSkillDestination)(env.source, target.path); items.push({ path: target.path, outcome: 'installed' }); }
      catch { stopped = true; items.push({ path: target.path, outcome: 'failed', message: '技能复制失败；目标可能已有部分更新，请核对权限并重新预览。' }); }
    }
  } else {
    // Exact generated scope is checked before any recursive removal.
    const allowed = new Set(uninstallTargets(env.uninstall).map((target) => resolve(target.path)));
    const actual = removeUninstallTargets(preview.targets.map(({ path, label }) => ({ path, label })), { remove: (file, recursive) => {
      if (!allowed.has(resolve(file))) throw new Error('Unconfirmed uninstall target');
      (options.effects?.remove ?? ((path: string, recurse: boolean) => rmSync(path, { recursive: recurse, force: true })))(file, recursive);
    } });
    items.push(...actual.map((item): MaintenanceItem => ({ path: item.target.path, outcome: item.outcome, ...(item.outcome === 'failed' ? { message: '删除失败，该路径仍需核对。' } : {}) })));
  }
  const succeeded = items.filter((item) => item.outcome === 'deleted' || item.outcome === 'installed').length;
  const failed = items.filter((item) => item.outcome === 'failed').length;
  const skipped = items.filter((item) => item.outcome === 'skipped').length;
  return result(failed ? 'partial' : 'complete', `${preview.label}：成功 ${succeeded} 项，失败 ${failed} 项，跳过 ${skipped} 项。${operationId === 'uninstall-data' ? 'npm包未卸载；收尾：npm uninstall -g @oatelauser/crosschat' : '详情可查看逐项实际结果。'}`, items);
}
