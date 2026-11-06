import { describe, expect, it } from 'vitest';
import { DSH_ENHANCEMENT_CHECKS, DSH_ENHANCEMENT_SCOPE, validateDshEnhancementReport } from '../scripts/dsh-enhancement-contract.mjs';

const binding = { runId: '11111111-1111-4111-8111-111111111111', sourceHead: 'a'.repeat(40), platform: 'win32', arch: 'x64', version: '0.2.1-rc.5' };
function passed() {
  const terminalState = () => ({ raw: false, resize: 0, listeners: { SIGINT: 1, SIGTERM: 1, uncaughtException: 0, unhandledRejection: 0 } });
  return { schema: 1, tool: 'dsh-enhancement', ...binding, node: 'v22.23.4', scope: { ...DSH_ENHANCEMENT_SCOPE }, status: 'passed',
    checks: DSH_ENHANCEMENT_CHECKS.map((name: string) => ({ name, status: 'passed' })),
    hosts: [10, 11].map(pid => ({ pid, cleanup: { runtimeStopped: true, registrationRemoved: true, removed: true, forced: false } })),
    nodes: [12, 13].map(pid => ({ pid, exit: { code: 0, signal: null }, messages: [{ event: 'stopped', pid, failures: [] }] })),
    terminals: [0, 1].map(index => ({ index, exit: { event: 'exit', code: 0, before: terminalState(), after: terminalState() } })),
    nativeReceiptFault: { titlePosts: 1, acceptedWrites: 1, droppedReceipts: 1, registrationRestored: true, proxyClosed: true },
    brokerReceiptFault: { requests: 1, acceptedReceipts: 1, droppedReceipts: 1, configRestored: true, proxyClosed: true },
    cleanupFailures: [], unsafe: false, outerRemoved: true };
}
describe('C22 enhancement evidence contract', () => {
  it('accepts eleven ordered checks only for the bound run and qualified release', () => {
    expect(DSH_ENHANCEMENT_CHECKS).toHaveLength(11);
    expect(validateDshEnhancementReport(passed(), binding)).toEqual({ valid: true });
  });
  it.each(['runId', 'sourceHead', 'platform', 'arch', 'version', 'node'])('rejects mismatched %s', field => {
    expect(validateDshEnhancementReport({ ...passed(), [field]: 'wrong' }, binding).valid).toBe(false);
  });
  it('rejects an unplanned target even when report and caller agree', () => {
    expect(validateDshEnhancementReport({ ...passed(), platform: 'linux', arch: 'arm64' }, { ...binding, platform: 'linux', arch: 'arm64' }).valid).toBe(false);
  });
  it('rejects missing, duplicated or reordered checks', () => {
    const report = passed(); report.checks.pop(); expect(validateDshEnhancementReport(report, binding).valid).toBe(false);
    const duplicate = passed(); duplicate.checks[1] = duplicate.checks[0]; expect(validateDshEnhancementReport(duplicate, binding).valid).toBe(false);
    const reordered = passed(); [reordered.checks[0], reordered.checks[1]] = [reordered.checks[1], reordered.checks[0]]; expect(validateDshEnhancementReport(reordered, binding).valid).toBe(false);
  });
  it('rejects scope changes or extra claims', () => {
    expect(validateDshEnhancementReport({ ...passed(), scope: {} }, binding).valid).toBe(false);
    expect(validateDshEnhancementReport({ ...passed(), scope: { ...DSH_ENHANCEMENT_SCOPE, desktop: true } }, binding).valid).toBe(false);
  });
  it('rejects malformed input and invalid run identity', () => {
    for (const value of [null, [], {}, 'passed']) expect(validateDshEnhancementReport(value, binding).valid).toBe(false);
    expect(validateDshEnhancementReport({ ...passed(), runId: 'old' }, { ...binding, runId: 'old' }).valid).toBe(false);
  });
  it('requires two normally released hosts, nodes and restored terminals', () => {
    const report = passed(); report.hosts[0].cleanup.forced = true; expect(validateDshEnhancementReport(report, binding).valid).toBe(false);
    const node = passed(); node.nodes[0].exit.code = 1; expect(validateDshEnhancementReport(node, binding).valid).toBe(false);
    const terminal = passed(); terminal.terminals[0].exit.after.raw = true; expect(validateDshEnhancementReport(terminal, binding).valid).toBe(false);
    const absent = passed(); absent.terminals.pop(); expect(validateDshEnhancementReport(absent, binding).valid).toBe(false);
    const repeated = passed(); repeated.nodes[1].pid = repeated.nodes[0].pid; expect(validateDshEnhancementReport(repeated, binding).valid).toBe(false);
  });
  it('requires both receipt faults to prove one accepted write and restored transport', () => {
    const native = passed(); native.nativeReceiptFault.titlePosts = 2; expect(validateDshEnhancementReport(native, binding).valid).toBe(false);
    const broker = passed(); broker.brokerReceiptFault.configRestored = false; expect(validateDshEnhancementReport(broker, binding).valid).toBe(false);
    const closed = passed(); closed.brokerReceiptFault.proxyClosed = false; expect(validateDshEnhancementReport(closed, binding).valid).toBe(false);
  });
  it('rejects missing root release, unsafe cleanup or reported cleanup failures', () => {
    for (const change of [{ outerRemoved: false }, { unsafe: true }, { cleanupFailures: ['release failed'] }])
      expect(validateDshEnhancementReport({ ...passed(), ...change }, binding).valid).toBe(false);
  });
  it('recognizes a cleanly released failed run without turning it into acceptance', () => {
    const report = { ...passed(), status: 'failed', checks: passed().checks.slice(0, 4), error: { message: 'permanent protection failed' } };
    expect(validateDshEnhancementReport(report, binding)).toEqual({ valid: true });
    expect(report.status).toBe('failed');
    expect(validateDshEnhancementReport({ ...report, error: undefined }, binding).valid).toBe(false);
    expect(validateDshEnhancementReport({ ...report, status: 'passed' }, binding).valid).toBe(false);
  });
});
