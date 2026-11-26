import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { sendViaDesktopAppTools } from '../src/integrations/codex-desktop-native.js';
import type { AppToolsInvoker } from '../src/codex/app-tools.js';
import { decodeRef } from '../src/ref.js';

const directories: string[] = [];
afterEach(() => { for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }); });
const target = 'target-thread';
const sender = 'sender-thread';
const mcp = (value: unknown) => ({ content: [{ type: 'text', text: JSON.stringify(value) }], isError: false });

function fixture() {
  const stateDir = mkdtempSync(join(tmpdir(), 'crosschat-native-send-'));
  directories.push(stateDir);
  const calls: Array<{ tool: string; arguments: Record<string, unknown> }> = [];
  const invoke: AppToolsInvoker = async (tool, args) => {
    calls.push({ tool, arguments: args });
    if (tool === 'list_threads') return mcp({ threads: [{ id: target, title: '目标会话', kind: 'codex', hostId: 'local', status: 'idle' }], nextCursor: null });
    if (tool === 'read_thread') return mcp({ schemaVersion: 1, thread: { id: args.threadId, title: args.threadId === target ? '目标会话' : '发送会话', kind: 'codex', hostId: 'local', status: { type: 'idle' } } });
    return mcp({ threadId: target });
  };
  return { stateDir, invoke, calls, env: { CODEX_THREAD_ID: sender } };
}

describe('crosschat Desktop native send integration', () => {
  it('uses the real envelope, conversation state and send log without inventing a native turn ID', async () => {
    const f = fixture();
    const result = await sendViaDesktopAppTools({ to: '目标会话', tool: 'codex-desktop', delivery: 'steer', bodyArg: '原生信封测试' }, f);
    expect(result).toMatchObject({ status: 'delivered', deliveryMode: 'steer', confirmation: 'unconfirmed', receipt: { turn: 1 } });
    const writes = f.calls.filter((call) => call.tool === 'send_message_to_thread');
    expect(writes).toHaveLength(1);
    expect(writes[0].arguments).toMatchObject({ threadId: target, hostId: 'local' });
    expect(writes[0].arguments.prompt).toContain('<cross-session-message');
    expect(writes[0].arguments.prompt).toContain('原生信封测试');
    expect(writes[0].arguments.prompt).toContain('<crosschat-reply-hint');
    expect(writes[0].arguments.prompt).toContain('from-name="codex/sender-t"');
    expect(writes[0].arguments.prompt).toMatch(/crosschat send --conversation c\d+ --body/);
    expect(writes[0].arguments.prompt).not.toContain('from-tool=');
    expect(writes[0].arguments.prompt).not.toContain('--tool');
    expect(decodeRef(result.receipt.replyRef)).toMatchObject({ f: { p: 'codex', id: sender }, t: { p: 'codex', id: target }, c: 1 });
    expect(f.calls.slice(0, 3).map((call) => [call.tool, call.arguments.threadId])).toEqual([
      ['read_thread', sender], ['list_threads', undefined], ['read_thread', target],
    ]);
    const log = JSON.parse(readFileSync(join(f.stateDir, 'send-log.jsonl'), 'utf8').trim());
    expect(log).toMatchObject({ status: 'delivered', receipt: 'unconfirmed', turn: 1 });
    expect(readFileSync(join(f.stateDir, 'send-log.jsonl'), 'utf8')).not.toContain('原生信封测试');
    expect(readdirSync(join(f.stateDir, 'conversations')).length).toBeGreaterThan(0);
    const next = await sendViaDesktopAppTools({ to: target, tool: 'codex-desktop', delivery: 'steer', bodyArg: '第二条' }, f);
    expect(next.receipt.turn).toBe(2);
  });

  it.each([
    { delivery: 'queue' }, { delivery: undefined }, { tool: 'codex-cli' },
    { via: 'tcp:remote' }, { conversation: 'cA000', to: undefined },
    { origin: 'untrusted' }, { targetSessionId: 'unverified' }, { fileArg: 'body.txt' },
    { targetProviderId: 'codex' }, { targetEndpointType: 'desktop' },
  ])('rejects unsupported routing or delivery before requesting tools: %j', async (override) => {
    const f = fixture();
    await expect(sendViaDesktopAppTools({ to: target, tool: 'codex-desktop', delivery: 'steer', bodyArg: 'test', ...override }, f)).rejects.toMatchObject({ code: 'CODEX_APP_TOOLS_SCOPE_UNSUPPORTED' });
    expect(f.calls).toEqual([]);
    expect(readdirSync(f.stateDir)).toEqual([]);
  });

  it('requires the real Codex caller identity before asking the host to send', async () => {
    const f = fixture();
    await expect(sendViaDesktopAppTools({ to: target, tool: 'codex-desktop', delivery: 'steer', bodyArg: 'test' }, { ...f, env: {} })).rejects.toMatchObject({ code: 'CALLER_IDENTITY_UNRESOLVED' });
    expect(f.calls).toEqual([]);
  });

  it('does not trust an environment sender that the native host cannot verify', async () => {
    const f = fixture();
    const invoke: AppToolsInvoker = async (tool, args) => {
      f.calls.push({ tool, arguments: args });
      return mcp({ schemaVersion: 1, thread: { id: sender, title: '错误工具', kind: 'chatgpt', hostId: 'local', status: { type: 'idle' } } });
    };
    await expect(sendViaDesktopAppTools({ to: target, tool: 'codex-desktop', delivery: 'steer', bodyArg: 'test' }, { ...f, invoke })).rejects.toMatchObject({ code: 'CODEX_APP_TOOLS_PROTOCOL_ERROR' });
    expect(f.calls.map((call) => call.tool)).toEqual(['read_thread']);
    expect(readdirSync(f.stateDir)).toEqual([]);
  });

  it('retains native discovery errors instead of treating a partial list as a name miss', async () => {
    const f = fixture();
    const invoke: AppToolsInvoker = async (tool, args) => {
      if (tool !== 'list_threads') return f.invoke(tool, args);
      throw new Error('native history unavailable');
    };
    await expect(sendViaDesktopAppTools({ to: target, tool: 'codex-desktop', delivery: 'steer', bodyArg: 'test' }, { ...f, invoke })).rejects.toMatchObject({ code: 'CODEX_APP_TOOLS_UNAVAILABLE' });
    expect(f.calls.some((call) => call.tool === 'send_message_to_thread')).toBe(false);
    expect(readdirSync(f.stateDir)).toEqual([]);
  });

  it('rejects ambiguous titles before writing instead of selecting the first candidate', async () => {
    const f = fixture();
    const invoke: AppToolsInvoker = async (tool, args) => tool !== 'list_threads' ? f.invoke(tool, args) : mcp({
      threads: [target, 'another-thread'].map((id) => ({ id, title: '同名', kind: 'codex', hostId: 'local', status: 'idle' })), nextCursor: null,
    });
    await expect(sendViaDesktopAppTools({ to: '同名', tool: 'codex-desktop', delivery: 'steer', bodyArg: 'test' }, { ...f, invoke })).rejects.toMatchObject({ code: 'NAME_COLLISION' });
    expect(f.calls.some((call) => call.tool === 'send_message_to_thread')).toBe(false);
    expect(readdirSync(f.stateDir)).toEqual([]);
  });

  it('keeps an exact opaque ID authoritative when another title matches that ID', async () => {
    const f = fixture();
    const invoke: AppToolsInvoker = async (tool, args) => {
      if (tool === 'list_threads') return mcp({ threads: [
        { id: target, title: '目标', kind: 'codex', hostId: 'local', status: 'idle' },
        { id: 'wrong-thread', title: target, kind: 'codex', hostId: 'local', status: 'idle' },
      ], nextCursor: null });
      if (tool === 'send_message_to_thread') {
        f.calls.push({ tool, arguments: args });
        return mcp({ threadId: args.threadId });
      }
      return f.invoke(tool, args);
    };
    await sendViaDesktopAppTools({ to: target, tool: 'codex-desktop', delivery: 'steer', bodyArg: '指定 ID' }, { ...f, invoke });
    expect(f.calls.filter((call) => call.tool === 'send_message_to_thread').map((call) => call.arguments.threadId)).toEqual([target]);
  });

  it('shows an anonymous target by its ID instead of a null title', async () => {
    const f = fixture();
    const invoke: AppToolsInvoker = async (tool, args) => tool !== 'list_threads' ? f.invoke(tool, args) : mcp({
      threads: [{ id: target, title: null, kind: 'codex', hostId: 'local', status: 'idle' }], nextCursor: null,
    });
    const result = await sendViaDesktopAppTools({ to: target, tool: 'codex-desktop', delivery: 'steer', bodyArg: '匿名目标' }, { ...f, invoke });
    expect(result.receipt.to).toBe('codex/target-t');
    expect(f.calls.find((call) => call.tool === 'send_message_to_thread')?.arguments.prompt).toContain('reply-as="codex/target-t"');
  });

  it('continues the same legacy conversation when the peer replies through the native bridge', async () => {
    const f = fixture();
    const invoke: AppToolsInvoker = async (tool, args) => {
      if (tool === 'list_threads') return mcp({ threads: [target, sender].map((id) => ({ id, title: id, kind: 'codex', hostId: 'local', status: 'idle' })), nextCursor: null });
      if (tool === 'send_message_to_thread') {
        f.calls.push({ tool, arguments: args });
        return mcp({ threadId: args.threadId });
      }
      return f.invoke(tool, args);
    };
    const first = await sendViaDesktopAppTools({ to: target, tool: 'codex-desktop', delivery: 'steer', bodyArg: '往' }, { ...f, invoke });
    const reply = await sendViaDesktopAppTools({ to: sender, tool: 'codex-desktop', delivery: 'steer', bodyArg: '返' }, { ...f, invoke, env: { CODEX_THREAD_ID: target } });
    expect(reply.receipt.turn).toBe(2);
    expect(decodeRef(reply.receipt.replyRef)).toEqual({ ...decodeRef(first.receipt.replyRef), c: 2 });
    expect(f.calls.filter((call) => call.tool === 'send_message_to_thread').map((call) => call.arguments.threadId)).toEqual([target, sender]);
  });

  it('records an uncertain write once without replaying or creating an outbox', async () => {
    const f = fixture();
    const invoke: AppToolsInvoker = async (tool, args) => {
      if (tool !== 'send_message_to_thread') return f.invoke(tool, args);
      f.calls.push({ tool, arguments: args });
      throw new Error('Host disconnected after submission');
    };
    await expect(sendViaDesktopAppTools({ to: target, tool: 'codex-desktop', delivery: 'steer', bodyArg: 'test' }, { ...f, invoke })).rejects.toMatchObject({ code: 'CODEX_WRITE_UNCERTAIN' });
    expect(f.calls.filter((call) => call.tool === 'send_message_to_thread')).toHaveLength(1);
    expect(readdirSync(f.stateDir)).not.toContain('outbox');
    expect(JSON.parse(readFileSync(join(f.stateDir, 'send-log.jsonl'), 'utf8').trim())).toMatchObject({ status: 'failed', code: 'CODEX_WRITE_UNCERTAIN' });
  });
});
