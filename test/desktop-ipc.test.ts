import { Duplex } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { DesktopIpcError, openDesktopThread } from '../src/codex/desktop-ipc.js';
import { deliverToCodexThread } from '../src/codex/deliver.js';

const target = 'native/opaque/thread';
const owner = 'fixture-owner';
type Message = Record<string, unknown>;

function frame(message: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(message));
  const encoded = Buffer.alloc(body.length + 4);
  encoded.writeUInt32LE(body.length);
  body.copy(encoded, 4);
  return encoded;
}

class FixtureSocket extends Duplex {
  readonly messages: Message[] = [];
  constructor(readonly handle: (message: Message, socket: FixtureSocket) => void) {
    super();
    queueMicrotask(() => this.emit('connect'));
  }
  _read(): void { /* Data arrives through respond(). */ }
  _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    const message = JSON.parse(chunk.subarray(4).toString()) as Message;
    this.messages.push(message);
    callback();
    this.handle(message, this);
  }
  respond(message: unknown, fragmented = false): void {
    const encoded = frame(message);
    queueMicrotask(() => {
      if (this.destroyed) return;
      if (fragmented) {
        for (let offset = 0; offset < encoded.length; offset += 3) this.push(encoded.subarray(offset, offset + 3));
      } else this.push(encoded);
    });
  }
}

function snapshot(state: Message = {}): Message {
  return {
    id: target, title: 'must not expose a prompt as a name', cwd: 'D:\\fixture',
    threadRuntimeStatus: { type: 'idle' },
    turns: [{ turnId: 'completed-turn', status: 'completed', items: [{ text: 'PRIVATE CHAT BODY' }] }],
    ...state,
  };
}

function fixture(options: {
  state?: Message;
  ownerError?: string;
  mutation?: (message: Message, socket: FixtureSocket) => void;
  onSnapshot?: (message: Message, socket: FixtureSocket) => void;
} = {}) {
  const socket = new FixtureSocket((message, socket) => {
    const method = message.method;
    const response = (result: unknown) => socket.respond({ type: 'response', requestId: message.requestId, method, resultType: 'success', handledByClientId: method === 'initialize' ? 'fixture-client' : owner, result });
    if (method === 'initialize') response({ clientId: 'fixture-client' });
    else if (method === 'thread-owner-discovery') {
      if (options.ownerError) socket.respond({ type: 'response', requestId: message.requestId, resultType: 'error', error: options.ownerError });
      else response({ supportsUntrustedAppInput: true });
    } else if (method === 'thread-stream-following-changed') {
      const params = message.params as Message;
      if (params.following !== true) return;
      if (options.onSnapshot) options.onSnapshot(message, socket);
      else socket.respond({ type: 'broadcast', method: 'thread-stream-state-changed', version: 11, sourceClientId: owner, params: { hostId: 'local', conversationId: target, change: { type: 'snapshot', revision: 7, conversationState: snapshot(options.state) } } }, true);
    } else if (method === 'thread-follower-start-turn' || method === 'thread-follower-steer-turn') {
      if (options.mutation) options.mutation(message, socket);
      else response({ result: method === 'thread-follower-start-turn' ? { turn: { id: 'new-turn', status: 'inProgress' } } : { turnId: 'active-turn' } });
    }
  });
  return { socket, options: { connect: () => socket, timeoutMs: 50, snapshotTimeoutMs: 50 } };
}

describe('Desktop IPC thread session', () => {
  it.each(['completed', 'interrupted', 'failed'])('recognizes a known terminal %s turn when the Desktop runtime is idle', async (status) => {
    const f = fixture({ state: { turns: [{ turnId: 'terminal-turn', status }] } });
    const session = await openDesktopThread(target, f.options);
    try { expect(await session?.snapshot()).toMatchObject({ idle: true, activeTurnId: null }); }
    finally { await session?.close(); }
  });

  it.each(['interrupted', 'failed'])('recognizes canonical %s history while retaining conservative runtime and submission checks', async (status) => {
    const state = { turns: [], turnHistory: { kind: 'canonical', history: { islands: [{ entries: [{ value: 'tail' }], newerBoundary: { status: 'exhausted' } }], entitiesByKey: { tail: { turnId: 'terminal-turn', status } } } } };
    for (const [override, idle] of [[{}, true], [{ threadRuntimeStatus: { type: 'active' } }, false], [{ unconfirmedTurnSubmissions: [{ terminal: false }] }, false]] as const) {
      const f = fixture({ state: { ...state, ...override } });
      const session = await openDesktopThread(target, f.options);
      try { expect(await session?.snapshot()).toMatchObject({ idle, activeTurnId: null }); }
      finally { await session?.close(); }
    }
  });

  it.each(['inProgress', 'unknown-native-status'])('does not promote %s history to idle', async (status) => {
    const f = fixture({ state: { turns: [{ turnId: 'unsettled-turn', status }] } });
    const session = await openDesktopThread(target, f.options);
    try { expect(await session?.snapshot()).toMatchObject({ idle: false }); }
    finally { await session?.close(); }
  });

  it.each(['queue', 'steer'] as const)('starts %s delivery after an interrupted or failed prior task', async (mode) => {
    for (const status of ['interrupted', 'failed']) {
      const f = fixture({ state: { turns: [{ turnId: 'terminal-turn', status }] } });
      expect(await deliverToCodexThread(target, 'new independent input', {
        mode, desktopFactory: (id) => openDesktopThread(id, f.options),
        sessionFactory: async () => { throw new Error('Must use the bound Desktop owner.'); },
      })).toMatchObject({ status: 'accepted', turnId: 'new-turn', queued: false });
      expect(f.socket.messages.filter((message) => message.method === 'thread-follower-start-turn')).toHaveLength(1);
      expect(f.socket.messages.filter((message) => message.method === 'thread-follower-steer-turn')).toHaveLength(0);
      expect(f.socket.destroyed).toBe(true);
    }
  });

  it('binds the complete opaque ID and external client, and discards snapshot chat content', async () => {
    const f = fixture();
    const session = await openDesktopThread(target, f.options);
    expect(session).not.toBeNull();
    try {
      expect(session?.ownerId).toBe(owner);
      expect(await session?.snapshot()).toEqual({ id: target, name: null, cwd: 'D:\\fixture', rawStatus: { type: 'idle' }, activeTurnId: null, idle: true, revision: 7 });
      expect(JSON.stringify(await session?.snapshot())).not.toContain('PRIVATE CHAT BODY');
      expect(f.socket.messages[0]).toMatchObject({ method: 'initialize', params: { clientType: 'crosschat' } });
      expect(f.socket.messages[1]).toMatchObject({ method: 'thread-owner-discovery', params: { hostId: 'local', conversationId: target } });
      expect(f.socket.messages.every((message) => !('callerSource' in (message.params as Message)))).toBe(true);
    } finally { await session?.close(); }
    expect(f.socket.destroyed).toBe(true);
  });

  it('returns null only for an absent socket or an explicit missing owner', async () => {
    await expect(openDesktopThread(target, { connect: () => { throw Object.assign(new Error('absent'), { code: 'ENOENT' }); } })).resolves.toBeNull();
    const missing = fixture({ ownerError: 'no-client-found' });
    await expect(openDesktopThread(target, missing.options)).resolves.toBeNull();
    const invalid = fixture({ ownerError: 'request-version-mismatch' });
    await expect(openDesktopThread(target, invalid.options)).rejects.toMatchObject({ stage: 'prewrite' });
    expect(missing.socket.destroyed).toBe(true);
  });

  it('never promotes an incomplete canonical tail or an unconfirmed submission to idle', async () => {
    const f = fixture({ state: { turns: [], turnHistory: { kind: 'canonical', history: { islands: [{ entries: [{ value: 'turn' }], newerBoundary: { status: 'available' } }], entitiesByKey: { turn: { turnId: 'old', status: 'completed' } } } }, unconfirmedTurnSubmissions: [{ terminal: false }] } });
    const session = await openDesktopThread(target, f.options);
    try { expect(await session?.snapshot()).toMatchObject({ idle: false, activeTurnId: null }); }
    finally { await session?.close(); }
  });

  it('preserves native approval flags and the active canonical turn', async () => {
    const f = fixture({ state: { turns: [], threadRuntimeStatus: { type: 'active', activeFlags: ['waitingOnApproval'] }, turnHistory: { kind: 'canonical', history: { islands: [{ entries: [{ value: 'turn' }], newerBoundary: { status: 'exhausted' } }], entitiesByKey: { turn: { turnId: 'running', status: 'inProgress' } } } } } });
    const session = await openDesktopThread(target, f.options);
    try { expect(await session?.snapshot()).toMatchObject({ rawStatus: { type: 'active', activeFlags: ['waitingOnApproval'] }, activeTurnId: 'running', idle: false }); }
    finally { await session?.close(); }
  });

  it('uses owner-bound ordinary native inputs and inherits settings on start', async () => {
    const f = fixture();
    const session = await openDesktopThread(target, f.options);
    try {
      expect(await session?.startTurn('完整信封')).toBe('new-turn');
      expect(await session?.steerTurn('后续信封')).toBe('active-turn');
      const mutations = f.socket.messages.filter((message) => String(message.method).startsWith('thread-follower-'));
      expect(mutations).toHaveLength(2);
      expect(mutations[0]).toMatchObject({ targetClientId: owner, version: 2, params: { conversationId: target, turnStart: { request: { threadId: target, input: [{ type: 'text', text: '完整信封' }] }, context: { inheritThreadSettings: true } } } });
      expect(mutations[1]).toMatchObject({ targetClientId: owner, version: 1, params: { conversationId: target, input: [{ type: 'text', text: '后续信封' }], restoreMessage: { context: { workspaceRoots: ['D:\\fixture'], commentAttachments: [] } } } });
      expect(mutations.every((message) => !('hostId' in message))).toBe(true);
    } finally { await session?.close(); }
  });

  it('exposes an idle steer rejection without silently starting another turn', async () => {
    const f = fixture({ mutation: (message, socket) => socket.respond({ type: 'response', requestId: message.requestId, resultType: 'error', error: `Cannot steer conversation ${target} because its active turn already ended` }) });
    const session = await openDesktopThread(target, f.options);
    try {
      await expect(session?.steerTurn('message')).rejects.toMatchObject({ stage: 'rejected', code: 'CODEX_NO_ACTIVE_TURN', ownerBound: true });
      expect(f.socket.messages.filter((message) => message.method === 'thread-follower-start-turn')).toHaveLength(0);
    } finally { await session?.close(); }
  });

  it('marks a lost post-write acknowledgement uncertain and never retries', async () => {
    const f = fixture({ mutation: () => undefined });
    const session = await openDesktopThread(target, f.options);
    try {
      await expect(session?.startTurn('message')).rejects.toMatchObject({ stage: 'uncertain', code: 'CODEX_WRITE_UNCERTAIN', ownerBound: true });
      expect(f.socket.messages.filter((message) => message.method === 'thread-follower-start-turn')).toHaveLength(1);
      await expect(session?.snapshot()).rejects.toBeInstanceOf(DesktopIpcError);
    } finally { await session?.close(); }
  });

  it('rejects mismatched target snapshots and closes oversized incoming frames', async () => {
    const wrong = fixture({ state: { id: 'other-thread' } });
    const session = await openDesktopThread(target, wrong.options);
    try { await expect(session?.snapshot()).rejects.toMatchObject({ code: 'CODEX_DESKTOP_PROTOCOL_ERROR', stage: 'prewrite' }); }
    finally { await session?.close(); }
    const large = fixture({ onSnapshot: (_message, socket) => { const header = Buffer.alloc(4); header.writeUInt32LE(32 * 1024 * 1024 + 1); queueMicrotask(() => socket.push(header)); } });
    const second = await openDesktopThread(target, large.options);
    try { await expect(second?.snapshot()).rejects.toMatchObject({ code: 'CODEX_DESKTOP_PROTOCOL_ERROR' }); }
    finally { await second?.close(); }
    expect(large.socket.destroyed).toBe(true);
  });

  it('cancels before connecting and treats post-write cancellation as uncertain', async () => {
    const early = new AbortController(); early.abort();
    await expect(openDesktopThread(target, { signal: early.signal, connect: () => { throw new Error('must not connect'); } })).rejects.toMatchObject({ name: 'AbortError' });
    const controller = new AbortController();
    const f = fixture({ mutation: () => controller.abort() });
    const session = await openDesktopThread(target, { ...f.options, signal: controller.signal });
    await expect(session?.startTurn('message')).rejects.toMatchObject({ stage: 'uncertain', code: 'CODEX_WRITE_UNCERTAIN' });
    await session?.close();
    expect(f.socket.destroyed).toBe(true);
  });

  it('treats a successful mutation acknowledgement from a different owner as uncertain', async () => {
    const f = fixture({ mutation: (message, socket) => socket.respond({ type: 'response', requestId: message.requestId, method: message.method, resultType: 'success', handledByClientId: 'other-owner', result: { result: { turn: { id: 'wrong-owner-turn' } } } }) });
    const session = await openDesktopThread(target, f.options);
    try { await expect(session?.startTurn('message')).rejects.toMatchObject({ stage: 'uncertain', ownerBound: true, code: 'CODEX_WRITE_UNCERTAIN' }); }
    finally { await session?.close(); }
  });

  it('cancels a pending snapshot without turning cancellation into an absent owner', async () => {
    const controller = new AbortController();
    const f = fixture({ onSnapshot: () => controller.abort() });
    const session = await openDesktopThread(target, { ...f.options, signal: controller.signal });
    try { await expect(session?.snapshot()).rejects.toMatchObject({ name: 'AbortError', stage: 'prewrite', ownerBound: true }); }
    finally { await session?.close(); }
    expect(f.socket.destroyed).toBe(true);
  });

  it('rejects invalid timeout settings before opening a transport', async () => {
    let connected = false;
    await expect(openDesktopThread(target, { timeoutMs: 0, connect: () => { connected = true; throw new Error('must not connect'); } }))
      .rejects.toMatchObject({ code: 'CODEX_DESKTOP_PROTOCOL_ERROR', stage: 'prewrite', ownerBound: false });
    expect(connected).toBe(false);
  });
});
