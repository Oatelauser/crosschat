import { describe, expect, it } from 'vitest';
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
    repoSkillContent: () => 'SKILL body',
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
    expect(report.output).toContain('claude 侧 skill 与仓库版本一致');
    expect(report.output).toContain('codex 侧 skill 与仓库版本一致');
    expect(report.output).toContain('✅ 无双身份残留');
    expect(report.output).toContain('发件箱空');
    expect(report.output).toContain('结论:');
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
    expect(missing.failed).toBe(true);
    expect(missing.output).toContain('❌ claude CLI 不可解析');
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
    expect(gone.failed).toBe(true);
    expect(gone.output).toContain('❌ codex CLI 未找到');
    expect(gone.output).toContain('❌ codex daemon 无法检查');
  });

  it('fails with the daemon-start guidance when the daemon is not running', () => {
    const report = runDoctor(
      makeDeps({
        run: (_bin, args) =>
          args[0] === '--version'
            ? { status: 0, stdout: 'codex-cli 0.160.0\n' }
            : { status: 1, stdout: 'daemon not running\n' },
      }),
    );
    expect(report.failed).toBe(true);
    expect(report.output).toContain('❌ codex daemon 未运行；先执行: codex app-server daemon start');
  });

  it('warns on missing / mismatched skills and passes on repo-identical ones', () => {
    const missing = runDoctor(makeDeps({ exists: () => false }));
    expect(missing.failed).toBe(false);
    expect(missing.output.match(/⚠️ .* skill 未安装/g)).toHaveLength(2);
    expect(missing.output).toContain('crosschat install-skills');
    const stale = runDoctor(makeDeps({ readFile: () => 'old skill body' }));
    expect(stale.output).toContain('claude 侧 skill 与仓库版本不一致');
    expect(stale.output).toContain('codex 侧 skill 与仓库版本不一致');
    const noRepo = runDoctor(makeDeps({ repoSkillContent: () => undefined }));
    expect(noRepo.output).toContain('claude 侧 skill 已安装（仓库 SKILL.md 未定位到，跳过版本比对）');
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
    expect(report.output).toContain('⏳ 线程 abcdefgh 暂存 3 条（将在对方空闲时自动补投）');
  });

  it('exposes exit code semantics: failed iff any ❌ was reported', () => {
    expect(runDoctor(makeDeps()).failed).toBe(false);
    expect(
      runDoctor(makeDeps({ listOutbox: () => [{ threadId: 'x', count: 1 }] })).failed,
    ).toBe(false); // ⏳ is informational, not a failure
    expect(runDoctor(makeDeps({ nodeVersion: '18.0.0' })).failed).toBe(true);
  });
});
