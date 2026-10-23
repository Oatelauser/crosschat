import { afterEach, describe, expect, it, vi } from 'vitest';
import { NodeNameChanges } from '../src/serve/node-naming.js';
import { VirtualSocket } from '../src/serve/virtual-socket.js';
import type { NodeNameResultFrame, NodeNameSetFrame } from '../src/serve/protocol.js';
import { parseFrame } from '../src/serve/protocol.js';

afterEach(() => vi.useRealTimers());
function fixture(timeoutMs = 50) {
  const [socket, peer] = VirtualSocket.pair(); const requests: NodeNameSetFrame[] = [];
  peer.on('message', (text) => requests.push(JSON.parse(String(text))));
  const owner = new NodeNameChanges(timeoutMs); const apply = vi.fn();
  const target = { socket, starId: 'star-a', machineId: 'a'.repeat(32) };
  function reply(extra: Partial<NodeNameResultFrame> = {}): NodeNameResultFrame {
    return { op: 'node-name-result', id: requests[0].id, starId: target.starId, machineId: target.machineId, ok: true, saved: true, applied: true, showName: 'new-name', name: 'new-name', ...extra };
  }
  return { socket, peer, requests, owner, target, apply, reply };
}
describe('online peer naming request ownership', () => {
  it('validates full targets, bounded names and explicit persistence evidence at the new frame boundary', () => {
    const f = fixture();
    const request = { op: 'node-name-set', id: 'fixture', starId: f.target.starId, machineId: f.target.machineId, name: 'new-name' };
    expect(parseFrame(JSON.stringify(request))).toEqual(request);
    for (const invalid of [{ ...request, machineId: 'abcd1234' }, { ...request, name: 'x'.repeat(33) }, { ...request, name: '\u001b[31m' }, { ...request, starId: '' }]) expect(parseFrame(JSON.stringify(invalid))).toBeUndefined();
    const result = { op: 'node-name-result', id: 'fixture', starId: f.target.starId, machineId: f.target.machineId, ok: true, saved: true, applied: true, showName: 'new-name', name: 'new-name' };
    expect(parseFrame(JSON.stringify(result))).toEqual(result);
    expect(parseFrame(JSON.stringify({ ...result, saved: 'yes' }))).toBeUndefined();
    expect(parseFrame(JSON.stringify({ ...result, name: '\u001b[31m' }))).toBeUndefined();
  });
  it('accepts only the exact socket, full star and full machine receipt and applies it once', async () => {
    const f = fixture(); const pending = f.owner.request(f.target, 'new-name', f.apply);
    const [other] = VirtualSocket.pair();
    f.owner.receive(other, f.reply()); f.owner.receive(f.socket, f.reply({ starId: 'another-star' })); f.owner.receive(f.socket, f.reply({ machineId: 'b'.repeat(32) }));
    expect(f.apply).not.toHaveBeenCalled();
    f.owner.receive(f.socket, f.reply()); expect(await pending).toMatchObject({ ok: true, renamed: true, saved: true, applied: true });
    f.owner.receive(f.socket, f.reply()); expect(f.apply).toHaveBeenCalledExactlyOnceWith('new-name');
  });
  it('refuses a second mutation for the same target while the first is awaiting its receipt', async () => {
    const f = fixture(); const pending = f.owner.request(f.target, 'new-name', f.apply);
    expect(await f.owner.request(f.target, 'another', f.apply)).toMatchObject({ ok: false });
    expect(f.requests).toHaveLength(1); f.owner.stop(); expect(await pending).toMatchObject({ uncertain: true });
  });
  it('bounds missing receipts and ignores late results after timeout or disconnection', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    for (const condition of ['timeout', 'disconnect', 'stop']) {
      const f = fixture(); const pending = f.owner.request(f.target, 'new-name', f.apply);
      if (condition === 'timeout') await vi.advanceTimersByTimeAsync(51);
      else if (condition === 'disconnect') f.owner.disconnect(f.socket);
      else f.owner.stop();
      expect(await pending).toMatchObject({ ok: false, uncertain: true });
      f.owner.receive(f.socket, f.reply()); expect(f.apply).not.toHaveBeenCalled();
    }
    expect(vi.getTimerCount()).toBe(0);
  });
  it('distinguishes a peer refusal before writing from a saved but unconfirmed application', async () => {
    const refused = fixture(); const refusal = refused.owner.request(refused.target, 'new-name', refused.apply);
    refused.owner.receive(refused.socket, refused.reply({ ok: false, saved: false, applied: false }));
    expect(await refusal).toMatchObject({ ok: false }); expect(await refusal).not.toHaveProperty('uncertain', true); expect(refused.apply).not.toHaveBeenCalled();
    const partial = fixture(); const unknown = partial.owner.request(partial.target, 'new-name', partial.apply);
    partial.owner.receive(partial.socket, partial.reply({ ok: false, saved: true, applied: false }));
    expect(await unknown).toMatchObject({ uncertain: true }); expect(partial.apply).not.toHaveBeenCalled();
  });
  it('does not confirm a contradictory effective name or a failed broker projection', async () => {
    const wrong = fixture(); const pending = wrong.owner.request(wrong.target, 'new-name', wrong.apply);
    wrong.owner.receive(wrong.socket, wrong.reply({ name: 'different' }));
    expect(await pending).toMatchObject({ ok: false, uncertain: true }); expect(wrong.apply).not.toHaveBeenCalled();
    const failed = fixture(); failed.apply.mockImplementation(() => { throw new Error('controlled persistence failure'); });
    const result = failed.owner.request(failed.target, 'new-name', failed.apply); failed.owner.receive(failed.socket, failed.reply());
    expect(await result).toMatchObject({ ok: false, uncertain: true });
  });
});
