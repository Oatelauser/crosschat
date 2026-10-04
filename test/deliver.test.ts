import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { deliverToClaudeSession } from '../src/claude/deliver.js';
import { encodeAuthLine } from '../src/claude/frame.js';
import { keyFileName } from '../src/claude/key-file.js';
import { MultichatError } from '../src/errors.js';
import type { PipeTransport } from '../src/platform/pipe-transport.js';

// Same fixture手法 as key-file.test.ts: live registry pipe path of session
// 17324 and its verified key-file derivation rule.
const PIPE_17324 = '\\\\.\\pipe\\LOCAL\\cc-msg-0e4d56cd5b3e15b7d6c3d675995318ce';
const TOKEN_17324 = '00112233445566778899aabbccddeeff';

const sessionsDir = mkdtempSync(join(tmpdir(), 'crosschat-deliver-'));
afterAll(() => rmSync(sessionsDir, { recursive: true, force: true }));

function fakeTransport(failWith?: MultichatError) {
  const calls: { path: string; lines: string[] }[] = [];
  const transport: PipeTransport = {
    async sendLines(pipePath, lines) {
      calls.push({ path: pipePath, lines: [...lines] });
      if (failWith) throw failWith;
    },
  };
  return { transport, calls };
}

function parseUserFrame(line: string) {
  const frame = JSON.parse(line) as {
    msgV: number;
    msg_id: string;
    type: string;
    message: { role: string; content: string };
    priority: string;
  };
  expect(frame).toMatchObject({
    msgV: 1,
    type: 'user',
    message: { role: 'user', content: 'hello unix' },
    priority: 'next',
  });
  expect(frame.msg_id).not.toBe('');
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise;
    expect.unreachable(`should have thrown ${code}`);
  } catch (err) {
    expect(err).toBeInstanceOf(MultichatError);
    expect((err as MultichatError).code).toBe(code);
  }
}

describe('deliverToClaudeSession platform assembly', () => {
  it('win32 sends [auth line, user frame] with the token from the key file', async () => {
    writeFileSync(
      join(sessionsDir, keyFileName(17324, PIPE_17324)),
      `{"peerToken":"${TOKEN_17324}"}`,
      'utf8',
    );
    const { transport, calls } = fakeTransport();
    const result = await deliverToClaudeSession(
      { pid: 17324, messagingSocketPath: PIPE_17324 },
      'hello unix',
      { platform: 'win32', sessionsDir, transport },
    );
    expect(result).toEqual({ status: 'delivered' });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.path).toBe(PIPE_17324);
    const lines = calls[0]!.lines;
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe(encodeAuthLine(TOKEN_17324));
    expect(JSON.parse(lines[0]!)).toEqual({ type: 'auth', token: TOKEN_17324 });
    parseUserFrame(lines[1]!);
  });

  it('linux sends only the user frame and never touches the key file', async () => {
    // No key file exists for this session: a read would throw
    // CLAUDE_KEY_FILE_MISSING, so reaching 'delivered' proves none happened.
    const { transport, calls } = fakeTransport();
    const result = await deliverToClaudeSession(
      { pid: 24900, messagingSocketPath: PIPE_17324 },
      'hello unix',
      { platform: 'linux', sessionsDir, transport },
    );
    expect(result).toEqual({ status: 'delivered' });
    const lines = calls[0]!.lines;
    expect(lines).toHaveLength(1);
    parseUserFrame(lines[0]!);
  });
});

describe('deliverToClaudeSession transport error mapping', () => {
  it('maps PIPE_CONNECT_FAILED to CLAUDE_PIPE_CONNECT_FAILED', async () => {
    const { transport } = fakeTransport(
      new MultichatError('PIPE_CONNECT_FAILED', 'cannot connect'),
    );
    await expectCode(
      deliverToClaudeSession(
        { pid: 24900, messagingSocketPath: PIPE_17324 },
        'hello unix',
        { platform: 'linux', sessionsDir, transport },
      ),
      'CLAUDE_PIPE_CONNECT_FAILED',
    );
  });

  it('maps PIPE_WRITE_UNCERTAIN to CLAUDE_PIPE_WRITE_UNCERTAIN', async () => {
    const { transport } = fakeTransport(
      new MultichatError('PIPE_WRITE_UNCERTAIN', 'lost mid-write'),
    );
    await expectCode(
      deliverToClaudeSession(
        { pid: 24900, messagingSocketPath: PIPE_17324 },
        'hello unix',
        { platform: 'linux', sessionsDir, transport },
      ),
      'CLAUDE_PIPE_WRITE_UNCERTAIN',
    );
  });
});
