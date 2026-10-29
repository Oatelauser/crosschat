import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveTargetById, resolveTargetByName } from '../src/resolve.js';
import { sendMessage } from '../src/application/send/index.js';
import type { SendDeps } from '../src/application/send/types.js';
import { decodeRef } from '../src/ref.js';
import { parseSendArgs } from '../src/cli.js';

const id = '11111111-1111-4111-8111-111111111111';
const desktop = { id, name: 'Worker', status: 'idle' as const, endpointType: 'desktop' };
const cli = { ...desktop, endpointType: 'cli' };
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'crosschat-c14-send-')); roots.push(root);
  const deliverCodex = vi.fn(async () => ({ status: 'accepted' as const, turnId: 'turn-one' }));
  const deps = { env: {}, listClaudeSessions: () => ({ sessions: [], malformed: 0 }),
    listCodexThreads: vi.fn(async () => [desktop, cli]), listDshThreads: async () => [], listOpenCodeThreads: async () => [],
    deliverClaude: vi.fn(async () => ({ status: 'delivered' as const })), deliverCodex,
    sendLogFile: join(root, 'send.jsonl'), outboxDir: join(root, 'outbox'), now: () => 100,
  } satisfies SendDeps;
  return { deps, deliverCodex };
}

describe('C14 precise tool selection', () => {
  it('selects one endpoint by type and name with the same native ID in both owners', () => {
    expect(resolveTargetByName('Worker', [], [desktop, cli], [], [], { providerId: 'codex', endpointType: 'cli' }))
      .toMatchObject({ side: 'codex', thread: cli });
  });
  it('retains the type constraint in full-ID member resolution', () => {
    expect(resolveTargetById(id, [], [desktop, cli], [], [], { providerId: 'codex', endpointType: 'cli' }))
      .toMatchObject({ side: 'codex', thread: cli });
  });
  it('treats former qualifiers literally and rejects an unavailable explicitly selected endpoint', () => {
    const named = { ...desktop, name: 'codex-cli/Worker' };
    expect(resolveTargetByName('codex-cli/Worker', [], [named, cli], [], [], { providerId: 'codex', endpointType: 'desktop' }))
      .toMatchObject({ side: 'codex', thread: named });
    expect(() => resolveTargetByName('Worker', [], [desktop], [], [], { providerId: 'codex', endpointType: 'cli' }))
      .toThrow(expect.objectContaining({ code: 'NAME_NOT_FOUND' }));
  });
  it('does not turn unknown transport metadata into a verified CLI target', () => {
    expect(() => resolveTargetByName('Worker', [], [{ id, name: 'Worker' }], [], [], { providerId: 'codex', endpointType: 'cli' }))
      .toThrow(expect.objectContaining({ code: 'NAME_NOT_FOUND' }));
  });
  it('accepts the public --tool option', () => {
    expect(parseSendArgs(['--tool', 'codex-cli', '--to', 'Worker', '--body', 'once']))
      .toMatchObject({ tool: 'codex-cli', to: 'Worker' });
  });
  it('delivers once through the selected endpoint and records it in the reply reference', async () => {
    const { deps, deliverCodex } = fixture();
    const sent = await sendMessage({ tool: 'codex-cli', to: 'Worker', bodyArg: 'once' }, deps);
    expect(deliverCodex).toHaveBeenCalledTimes(1);
    expect(deliverCodex).toHaveBeenCalledWith(id, expect.stringContaining('once'), { mode: 'queue', endpointType: 'cli' });
    expect(decodeRef(sent.receipt.replyRef).t).toMatchObject({ p: 'codex', id, endpointType: 'cli' });
  });
  it('rejects unknown tool types before native discovery or delivery', async () => {
    const { deps, deliverCodex } = fixture();
    await expect(sendMessage({ tool: 'invented', to: 'Worker', bodyArg: 'once' }, deps)).rejects.toMatchObject({ code: 'USAGE' });
    expect(deps.listCodexThreads).not.toHaveBeenCalled();
    expect(deliverCodex).not.toHaveBeenCalled();
  });
  it('retains injected type and provider restrictions even when to is only a display hint', async () => {
    const { deps, deliverCodex } = fixture();
    const sent = await sendMessage({ tool: 'codex-cli', to: 'display-only', targetSessionId: id, targetProviderId: 'codex', targetEndpointType: 'cli', bodyArg: 'once' }, deps);
    expect(deliverCodex).toHaveBeenCalledWith(id, expect.any(String), { mode: 'queue', endpointType: 'cli' });
    expect(decodeRef(sent.receipt.replyRef).t).toMatchObject({ endpointType: 'cli' });
  });
});
