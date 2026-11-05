import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { DSH_ONBOARDING_CHECKS, DSH_ONBOARDING_SCOPE } from '../scripts/dsh-onboarding-contract.mjs';

const workflow = (await readFile(new URL('../.github/workflows/dsh-onboarding-compat.yml', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
const pinned = JSON.parse(await readFile(new URL('../scripts/dsh-compat-baseline.json', import.meta.url), 'utf8'));
const posix = [['linux', 'x64'], ['darwin', 'x64'], ['darwin', 'arm64']];
const all = [['win32', 'x64'], ...posix];
function summary(platform: string, arch: string) {
  const baseline = { name: pinned.package.name, version: pinned.package.version, url: pinned.package.dist.tarball, integrity: pinned.package.dist.integrity };
  const candidate = { ...baseline, version: '0.2.2', url: 'https://registry.npmjs.org/@deepseek-ai/dsh/-/dsh-0.2.2.tgz' };
  const passed = () => ({ schema: 1, tool: 'dsh-onboarding', platform, arch, version: baseline.version, runId: randomUUID(), scope: DSH_ONBOARDING_SCOPE,
    status: 'passed', stage: 'done', category: null, checks: DSH_ONBOARDING_CHECKS.map((name: string) => ({ name, status: 'passed', elapsedMs: 1 })),
    cleanup: { runtimeStopped: true, registrationRemoved: true, removed: true, forced: false }, process: { code: 0, signal: null, timedOut: false } });
  const failed = () => ({ ...passed(), version: candidate.version, status: 'failed', stage: 'onboarding', category: 'compatibility', check: DSH_ONBOARDING_CHECKS[2],
    checks: passed().checks.slice(0, 2), process: { code: 1, signal: null, timedOut: false } });
  return { schema: 1, tool: 'dsh-onboarding', platform, arch, scope: DSH_ONBOARDING_SCOPE, installationCleanup: 'removed', classification: { kind: 'regression', notify: true },
    builds: { baseline, candidate, packageManager: { name: 'pnpm', version: pinned.packageManager.version, url: pinned.packageManager.dist.tarball, integrity: pinned.packageManager.dist.integrity } },
    baseline: passed(), candidate: failed(), retry: failed() };
}
async function executeReport(summaries: ReturnType<typeof summary>[], options: { schedule?: string; existing?: unknown; regular?: boolean; symlink?: boolean; size?: number } = {}) {
  const files = new Map(summaries.map(value => [`evidence/dsh-onboarding-${value.platform}-${value.arch}/summary.json`, value]));
  const created: { title: string; body: string }[] = []; const readPaths: string[] = []; const statPaths: string[] = [];
  const selected = (file: string) => {
    const value = file === 'evidence/summary.json' ? summaries[0] : files.get(file);
    if (!value) throw new Error('No artifact for this target'); return value;
  };
  const script = workflow.split('          script: |\n')[1]!.split('\n').map(line => line.replace(/^ {12}/, '')).join('\n');
  await runInNewContext(`(async()=>{${script}\n})()`, {
    require: (name: string) => {
      if (name !== 'node:fs/promises') throw new Error('Unexpected privileged dependency');
      return { lstat: async (file: string) => { statPaths.push(file); selected(file); return { isFile: () => options.regular ?? true, isSymbolicLink: () => options.symlink ?? false, size: options.size ?? 1000 }; },
        readFile: async (file: string) => { readPaths.push(file); return JSON.stringify(selected(file)); } };
    },
    context: { serverUrl: 'https://github.com', repo: { owner: 'fixture', repo: 'fixture' }, runId: 42,
      eventName: options.schedule === undefined ? 'workflow_dispatch' : 'schedule', payload: { schedule: options.schedule } },
    core: { notice: () => {} },
    github: { paginate: async () => Object.hasOwn(options, 'existing') ? options.existing : [], rest: { issues: { listForRepo: {}, create: async (value: { title: string; body: string }) => created.push(value) } } },
  });
  return { created, readPaths, statPaths };
}
function matrix(schedule?: string) {
  const line = workflow.split('\n').find(line => line.trimStart().startsWith('include: ${{'));
  if (!line) throw new Error('The from-zero workflow has no platform matrix');
  const expression = line.slice(line.indexOf('${{') + 3, line.lastIndexOf('}}')).trim();
  const values = runInNewContext(expression, { fromJSON: JSON.parse, github: { event_name: schedule === undefined ? 'workflow_dispatch' : 'schedule', event: { schedule } } });
  return values.map((value: { platform: string; arch: string }) => [value.platform, value.arch]);
}

describe('from-zero hosted target selection', () => {
  it('runs four targets manually, preserves Windows weekly and separates POSIX weekly', () => {
    expect(matrix()).toEqual(all); expect(matrix('7 5 * * 5')).toEqual([all[0]]);
    expect(matrix('7 6 * * 5')).toEqual(posix); expect(matrix('unexpected')).toEqual([]);
  });
  it('keeps the privileged report isolated from checkout and probe execution', () => {
    const report = workflow.split('\n  report:\n')[1];
    expect(report).toContain('github.event.repository.default_branch');
    expect(report).not.toContain('actions/checkout'); expect(report).not.toContain('node scripts/');
    expect(workflow.split('\n  report:\n')[0]).not.toContain('issues: write');
  });
});

describe('actual from-zero YAML report for POSIX artifacts', () => {
  it.each(posix)('admits and deduplicates only a fully released %s/%s regression', async (platform, arch) => {
    const value = summary(platform, arch); const marker = `<!-- dsh-onboarding-compat:0.2.2:${platform}-${arch}:${DSH_ONBOARDING_CHECKS[2]} -->`;
    const result = await executeReport([value]); expect(result.created).toHaveLength(1);
    expect(result.created[0].body).toContain(marker); expect(result.created[0].title).toContain(`(${platform}-${arch})`);
    expect(result.readPaths).toEqual([`evidence/dsh-onboarding-${platform}-${arch}/summary.json`]);
    expect((await executeReport([value], { existing: [{ body: marker }] })).created).toHaveLength(0);
  });
  it('reports each architecture separately in one run while preserving the Windows marker', async () => {
    const result = await executeReport(all.map(([platform, arch]) => summary(platform, arch)));
    expect(result.created).toHaveLength(4); expect(new Set(result.created.map(value => value.title)).size).toBe(4);
    expect(result.created[0].body).toContain(`dsh-onboarding-compat:0.2.2:win32:${DSH_ONBOARDING_CHECKS[2]}`);
  });
  it('consumes only artifacts selected by the scheduled event', async () => {
    const inputs = all.map(([platform, arch]) => summary(platform, arch));
    expect((await executeReport(inputs, { schedule: '7 5 * * 5' })).created).toHaveLength(1);
    const posixResult = await executeReport(inputs, { schedule: '7 6 * * 5' }); expect(posixResult.created).toHaveLength(3);
    expect(posixResult.statPaths.every(file => !file.includes('win32'))).toBe(true);
    expect((await executeReport(inputs, { schedule: 'unexpected' })).statPaths).toEqual([]);
  });
  it('rejects foreign architecture, incomplete phases, reused UUIDs and uncertain release', async () => {
    const value = summary('darwin', 'arm64');
    for (const invalid of [
      { ...value, retry: { ...value.retry, arch: 'x64' } },
      { ...value, baseline: { ...value.baseline, checks: value.baseline.checks.slice(0, -1) } },
      { ...value, retry: { ...value.retry, runId: value.candidate.runId } },
      { ...value, retry: { ...value.retry, cleanup: { ...value.retry.cleanup, forced: true } } },
      { ...value, classification: { kind: 'infrastructure', notify: false } },
    ]) expect((await executeReport([invalid])).created).toHaveLength(0);
  });
  it('bounds each file before reading it and never writes with an incomplete Issue list', async () => {
    const value = summary('linux', 'x64');
    for (const options of [{ regular: false }, { symlink: true }, { size: 4 * 1024 * 1024 + 1 }]) {
      const result = await executeReport([value], options); expect(result.readPaths).toEqual([]); expect(result.created).toHaveLength(0);
    }
    expect((await executeReport([value], { existing: undefined })).created).toHaveLength(0);
  });
});
