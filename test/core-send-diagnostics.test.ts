import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { sendMessage } from '../src/application/send/index.js';
import type { SendDeps } from '../src/application/send/types.js';
import { MultichatError } from '../src/errors.js';

const directory = mkdtempSync(join(tmpdir(), 'crosschat-send-diagnosis-'));
afterAll(() => rmSync(directory, { recursive: true, force: true }));
function deps(): SendDeps {
  return { env: {}, listClaudeSessions: () => ({ sessions: [], malformed: 0 }), listCodexThreads: vi.fn(async () => []),
    deliverClaude: vi.fn(async () => ({ status: 'delivered' as const })), deliverCodex: vi.fn(async () => ({ status: 'accepted' as const, turnId: 'native-turn' })),
    sendLogFile: join(directory, 'send-log.jsonl'), outboxDir: join(directory, 'outbox'), now: () => 1000 };
}

describe('name-miss diagnostic classification', () => {
  it('surfaces saved-target stage/code and stops before any delivery', async () => {
    const base = deps();
    const diagnosis = { kind: 'saved' as const, scope: 'desktop' as const, cliStatus: 'not-checked' as const,
      code: 'CODEX_DESKTOP_OWNER_UNAVAILABLE', message: 'Saved target: stage=owner code=CODEX_DESKTOP_OWNER_UNAVAILABLE; CLI未复核。',
      candidates: [{ id: 'native', name: 'worker', status: 'owner-missing' as const, failure: { stage: 'owner' as const, code: 'CODEX_DESKTOP_OWNER_UNAVAILABLE' } }], errors: [] };
    const diagnose = vi.fn(async () => diagnosis);
    await expect(sendMessage({ to: 'worker', bodyArg: 'input' }, { ...base, diagnoseCodexTarget: diagnose })).rejects.toMatchObject({ code: diagnosis.code, message: diagnosis.message, diagnosis });
    expect(diagnose).toHaveBeenCalledWith('worker');
    expect(base.deliverCodex).not.toHaveBeenCalled();
    expect(base.deliverClaude).not.toHaveBeenCalled();
  });

  it('keeps true NAME_NOT_FOUND after a complete diagnostic miss', async () => {
    const diagnose = vi.fn(async () => ({ kind: 'not-found' as const, scope: 'desktop' as const, cliStatus: 'not-checked' as const, candidates: [], errors: [] }));
    await expect(sendMessage({ to: 'absent', bodyArg: 'input' }, { ...deps(), diagnoseCodexTarget: diagnose })).rejects.toMatchObject({ code: 'NAME_NOT_FOUND' });
    expect(diagnose).toHaveBeenCalledOnce();
  });

  it('does not run diagnostics for a live Claude name when Codex discovery failed', async () => {
    const diagnose = vi.fn(async () => { throw new Error('must not run'); });
    const base = deps();
    const result = await sendMessage({ to: 'live', bodyArg: 'input' }, { ...base, diagnoseCodexTarget: diagnose,
      listClaudeSessions: () => ({ sessions: [{ sessionId: 'claude-native', name: 'live', pid: 100, kind: 'interactive' as const, status: 'idle', messagingSocketPath: 'fixture' }], malformed: 0 }),
      listCodexThreads: async () => { throw new MultichatError('CODEX_PROXY_SPAWN_FAILED', 'CLI down'); },
    });
    expect(result.status).toBe('delivered');
    expect(diagnose).not.toHaveBeenCalled();
    expect(base.deliverClaude).toHaveBeenCalledOnce();
  });

  it('preserves existing live prefix ambiguity without probing saved records', async () => {
    const diagnose = vi.fn(async () => { throw new Error('must not run'); });
    await expect(sendMessage({ to: 'wor', bodyArg: 'input' }, { ...deps(), diagnoseCodexTarget: diagnose,
      listCodexThreads: async () => [{ id: 'a', name: 'worker-a', status: 'idle' }, { id: 'b', name: 'worker-b', status: 'idle' }],
    })).rejects.toMatchObject({ code: 'NAME_COLLISION' });
    expect(diagnose).not.toHaveBeenCalled();
  });

  it('leaves a live Codex send on its existing direct path', async () => {
    const diagnose = vi.fn(async () => { throw new Error('must not run'); });
    const base = deps();
    const result = await sendMessage({ to: 'worker', bodyArg: 'input' }, { ...base, diagnoseCodexTarget: diagnose,
      listCodexThreads: async () => [{ id: 'native', name: 'worker', status: 'idle' }],
    });
    expect(result.status).toBe('delivered');
    expect(diagnose).not.toHaveBeenCalled();
    expect(base.deliverCodex).toHaveBeenCalledOnce();
  });

  it('does not probe a targetSessionId lookup failure as a name', async () => {
    const diagnose = vi.fn(async () => { throw new Error('must not run'); });
    await expect(sendMessage({ to: 'placeholder', targetSessionId: 'missing-id', bodyArg: 'input' }, { ...deps(), diagnoseCodexTarget: diagnose })).rejects.toMatchObject({ code: 'TARGET_NOT_FOUND' });
    expect(diagnose).not.toHaveBeenCalled();
  });
});
