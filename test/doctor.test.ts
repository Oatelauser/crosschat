import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { runDoctor, type DoctorDeps } from '../src/commands/doctor.js';
import type { ClaudeRegistryScan } from '../src/claude/registry.js';

// All probes mocked: doctor must be testable without a real environment.
function makeDeps(over: Partial<DoctorDeps> = {}): DoctorDeps {
  return {
    nodeVersion: '24.7.0',
    env: {},
    resolveClaude: () => 'C:\\fake\\claude.exe',
    listClaudeSessions: (): ClaudeRegistryScan => ({ sessions: [session], malformed: 0 }),
    codexBin: () => 'C:\\fake\\codex.exe',
    run: (_bin, args) =>
      args[0] === '--version'
        ? { status: 0, stdout: 'codex-cli 0.160.0 (windows x86_64)\n' }
        : { status: 0, stdout: '0.160.0\n' },
    exists: () => true,
    readFile: () => 'SKILL body',
    homeDir: () => 'C:\\home',
    listOutbox: () => [],
    repoSkillFiles: () => [{ path: 'SKILL.md', content: 'SKILL body' }],
    ...over,
  };
}

const session = {
  pid: 1,
  sessionId: 's-1',
  kind: 'interactive',
  status: 'running',
  messagingSocketPath: 'sock-1',
};

describe('runDoctor', () => {
  it('passes clean: only ✅ lines, no failure', () => {
    const report = runDoctor(makeDeps());
    expect(report.failed).toBe(false);
    expect(report.output).not.toContain('⚠️');
    expect(report.output).not.toContain('❌');
    expect(report.output).toContain('✅ Node v24.7.0 (≥22)');
    expect(report.output).toContain('可路由会话 1 个');
    expect(report.output).toContain('✅ codex CLI 0.160.0');
    expect(report.output).toContain('✅ codex daemon 0.160.0');
    expect(report.output).toContain('claude 侧 skill 与安装源一致');
    expect(report.output).toContain('codex 侧 skill 与安装源一致');
    expect(report.output).toContain('✅ 无双身份残留');
    expect(report.output).toContain('发件箱空');
    expect(report.output).toContain('结论:');
  });

  // 025：两级缩进分组树——组名顶格、条目行缩进两空格、结论行格式与退出码不动
  it('renders the grouped tree: bare group headers, two-space indented entries', () => {
    const report = runDoctor(makeDeps());
    const lines = report.output.split('\n');
    expect(lines[0]).toBe('环境');
    expect(lines[1]).toBe('  ✅ Node v24.7.0 (≥22)');
    expect(lines.at(-3)).toBe('其他');
    expect(lines.at(-2)).toBe('  ✅ 发件箱空（无暂存消息）');
    expect(lines.at(-1)).toBe('结论: 8 项通过，0 项警告，0 项错误');
    expect(report.failed).toBe(false);
  });

  it('fails on Node < 22', () => {
    const report = runDoctor(makeDeps({ nodeVersion: '20.11.0' }));
    expect(report.failed).toBe(true);
    expect(report.output).toContain('❌ Node v20.11.0（需 ≥22）');
  });

  it('fails when the claude CLI cannot be resolved, warns when no routable sessions', () => {
    const missing = runDoctor(
      makeDeps({
        resolveClaude: () => {
          throw new Error('CLAUDE_EXE_NOT_FOUND');
        },
      }),
    );
    expect(missing.failed).toBe(false);
    expect(missing.output).toContain('⚠️ claude CLI 未安装');
    const empty = runDoctor(
      makeDeps({ listClaudeSessions: () => ({ sessions: [], malformed: 0 }) }),
    );
    expect(empty.failed).toBe(false);
    expect(empty.output).toContain('⚠️ claude CLI 可解析');
  });

  it('warns on codex CLI below 0.160 and fails when it is missing entirely', () => {
    const old = runDoctor(
      makeDeps({
        run: (_bin, args) =>
          args[0] === '--version'
            ? { status: 0, stdout: 'codex-cli 0.150.0\n' }
            : { status: 0, stdout: '0.150.0\n' },
      }),
    );
    expect(old.failed).toBe(false);
    expect(old.output).toContain('⚠️ codex CLI 0.150.0');
    expect(old.output).toContain('⚠️ codex daemon 0.150.0');
    const gone = runDoctor(
      makeDeps({
        codexBin: () => {
          throw new Error('not found');
        },
      }),
    );
    expect(gone.failed).toBe(false);
    expect(gone.output).toContain('⚠️ codex CLI 未安装');
  });

  // 回归：v1.5.0 云端（无 codex）崩溃——linux 解析器返回 'codex' 不验存在性，
  // spawnSync ENOENT 时 stdout 为 undefined，旧代码 firstLine(undefined).split 崩。
  it('fails (not crashes) when the codex spawn errors with ENOENT and undefined stdout', () => {
    const report = runDoctor(
      makeDeps({
        run: (_bin, args) =>
          args[0] === '--version'
            ? { status: null, stdout: undefined, error: { code: 'ENOENT' } }
            : { status: null, stdout: undefined, error: { code: 'ENOENT' } },
      }),
    );
    expect(report.failed).toBe(false);
    expect(report.output).toContain('⚠️ codex CLI 未安装');
  });

  // 回归：v1.5.0 云端（无 codex）崩溃——linux 解析器返回 'codex' 不验存在性，
  // spawnSync ENOENT 时 stdout 为 undefined，旧代码 firstLine(undefined).split 崩。
  it('warns (not crashes, not fails) when the codex spawn errors with ENOENT and undefined stdout', () => {
    const report = runDoctor(
      makeDeps({
        run: (_bin, args) =>
          args[0] === '--version'
            ? { status: null, stdout: undefined, error: { code: 'ENOENT' } }
            : { status: null, stdout: undefined, error: { code: 'ENOENT' } },
      }),
    );
    expect(report.failed).toBe(false);
    expect(report.output).toContain('⚠️ codex CLI 未安装');
  });

  // 015 刀三：装了 codex 但 daemon 没跑是"要用再启"的教学提示（⚠️），不是故障（❌）
  it('warns (not fails) with the daemon-start guidance when the daemon is not running', () => {
    const report = runDoctor(
      makeDeps({
        run: (_bin, args) =>
          args[0] === '--version'
            ? { status: 0, stdout: 'codex-cli 0.160.0\n' }
            : { status: 1, stdout: 'daemon not running\n' },
      }),
    );
    expect(report.failed).toBe(false);
    expect(report.output).toContain('⚠️ codex daemon 未运行；要用 codex 通道时先执行: codex app-server daemon start');
  });

  it('warns on missing / mismatched skills and passes on repo-identical ones', () => {
    const missing = runDoctor(makeDeps({ exists: () => false }));
    expect(missing.failed).toBe(false);
    expect(missing.output.match(/⚠️ .* skill 未安装/g)).toHaveLength(2);
    expect(missing.output).toContain('crosschat install-skills');
    const stale = runDoctor(makeDeps({ readFile: () => 'old skill body' }));
    expect(stale.output).toContain('claude 侧 skill 与安装源不一致');
    expect(stale.output).toContain('codex 侧 skill 与安装源不一致');
    const noRepo = runDoctor(makeDeps({ repoSkillFiles: () => undefined }));
    expect(noRepo.output).toContain('claude 侧 skill 已安装（安装源 skill 目录未定位到，跳过版本比对）');
  });

  it('028 skill 分层：递归比对 references/ 子文件，点名差异文件；多出文件不算不一致', () => {
    const repo = [
      { path: 'SKILL.md', content: 'main' },
      { path: 'references/errors.md', content: 'errors' },
      { path: 'references/stars.md', content: 'stars' },
    ];
    // 键照 doctor 同款 join 构造（homeDir+side+skills/crosschat+rel）——posix 下 join
    // 会保住 homeDir 里的反斜杠再接正斜杠，写死 \\ 键在 linux/mac 全数失配（CI 实证）
    const key = (side: '.claude' | '.codex', rel: string) =>
      join(join('C:\\home', side, 'skills', 'crosschat'), rel);
    const contents: Record<string, string> = {
      [key('.claude', 'SKILL.md')]: 'main',
      [key('.claude', 'references/errors.md')]: 'errors',
      [key('.claude', 'references/stars.md')]: 'stale stars', // 子文件漂了
      [key('.codex', 'SKILL.md')]: 'main',
      [key('.codex', 'references/errors.md')]: 'errors',
      [key('.codex', 'references/stars.md')]: 'stars',
    };
    const report = runDoctor(makeDeps({ repoSkillFiles: () => repo, readFile: (p) => contents[p] }));
    expect(report.output).toContain('⚠️ claude 侧 skill 与安装源不一致（references/stars.md）');
    expect(report.output).toContain('✅ codex 侧 skill 与安装源一致');
  });

  it('warns on dual caller-identity residue with the env -u remedy', () => {
    const report = runDoctor(
      makeDeps({
        env: { CLAUDE_CODE_MESSAGING_SOCKET: 'sock-1', CODEX_THREAD_ID: 't-1' },
      }),
    );
    expect(report.failed).toBe(false);
    expect(report.output).toContain('⚠️ 双身份残留');
    expect(report.output).toContain('env -u CLAUDE_CODE_MESSAGING_SOCKET');
  });

  it('reports parked outbox items as auto-drain pending', () => {
    const report = runDoctor(
      makeDeps({ listOutbox: () => [{ threadId: 'abcdefgh1234', count: 3 }] }),
    );
    expect(report.failed).toBe(false);
    expect(report.output).toContain('⏳ 线程 abcdefgh 暂存 3 条');
    expect(report.output).toContain('看门狗未运行');
  });

  it('exposes exit code semantics: failed iff any ❌ was reported', () => {
    expect(runDoctor(makeDeps()).failed).toBe(false);
    expect(
      runDoctor(makeDeps({ listOutbox: () => [{ threadId: 'x', count: 1 }] })).failed,
    ).toBe(false); // ⏳ is informational, not a failure
    expect(runDoctor(makeDeps({ nodeVersion: '18.0.0' })).failed).toBe(true);
  });
});
