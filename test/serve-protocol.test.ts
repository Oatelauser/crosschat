import { describe, expect, it } from 'vitest';
import {
  encodeFrame,
  parseFrame,
  type Frame,
} from '../src/serve/protocol.js';

const allFrames: Frame[] = [
  { op: 'info', proto: 1, server: 'crosschat/1.4.0', caps: [] },
  { op: 'connect', proto: 1, role: 'node', machineId: 'm1', auth: 'k' },
  { op: 'connect', proto: 1, role: 'sender', auth: 'k' },
  { op: 'connected', machineName: 'box' },
  { op: 'error', code: 'BAD_AUTH', message: 'nope' },
  { op: 'error', code: 'UNKNOWN_MACHINE', message: 'nope', id: 's1' },
  { op: 'send', id: 's1', targetMachine: 'box', body: 'hi', origin: 'peer' },
  { op: 'send', id: 's2', targetMachine: 'box', to: 'alpha', conversation: 'mc1', body: 'hi' },
  { op: 'receipt', id: 's1', status: 'delivered' },
  { op: 'receipt', id: 's2', status: 'parked', turn: '1/5', replyRef: 'mc1_x' },
  { op: 'deliver', id: 's1', fromMachine: 'peer', payload: 'hi' },
  { op: 'result', id: 's1', status: 'queued', turn: '2/5', replyRef: 'r9' },
  { op: 'file-begin', id: 'f1', sha256: 'ab', name: 'a.txt', size: 3 },
  { op: 'file-chunk', id: 'f1', seq: 0, bytes: 'aGk=' },
  { op: 'file-end', id: 'f1' },
  { op: 'file-result', id: 'f1', ok: true, path: '/tmp/a.txt' },
  { op: 'file-result', id: 'f2', ok: false, error: 'disk full' },
];

describe('protocol frames', () => {
  it('round-trips every frame type', () => {
    for (const frame of allFrames) {
      expect(parseFrame(encodeFrame(frame))).toEqual(frame);
    }
  });

  it('returns undefined for unknown op', () => {
    expect(parseFrame('{"op":"teleport","id":"x"}')).toBeUndefined();
  });

  it('returns undefined for broken json, scalars and missing op', () => {
    expect(parseFrame('{not json')).toBeUndefined();
    expect(parseFrame('42')).toBeUndefined();
    expect(parseFrame('{"id":"x"}')).toBeUndefined();
  });
});
