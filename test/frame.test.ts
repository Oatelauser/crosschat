import { describe, expect, it } from 'vitest';
import { encodeAuthLine, encodeUserFrame } from '../src/claude/frame.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('encodeUserFrame', () => {
  it('emits a protocol v1 user frame on a single line', () => {
    const line = encodeUserFrame('hello world');
    expect(line.startsWith('{"msgV":1,"msg_id":"')).toBe(true);
    expect(line.includes('\n')).toBe(false);
    const frame = JSON.parse(line) as Record<string, unknown>;
    expect(frame.msgV).toBe(1);
    expect(frame.type).toBe('user');
    expect(frame.priority).toBe('next');
    expect(frame.message).toEqual({ role: 'user', content: 'hello world' });
    expect(typeof frame.msg_id).toBe('string');
    expect(frame.msg_id).toMatch(UUID_RE);
  });

  it('generates a fresh uuid per frame and accepts an explicit one', () => {
    const a = JSON.parse(encodeUserFrame('x')) as { msg_id: string };
    const b = JSON.parse(encodeUserFrame('x')) as { msg_id: string };
    expect(a.msg_id).not.toBe(b.msg_id);
    expect(
      (JSON.parse(encodeUserFrame('x', '11111111-2222-4333-8444-555555555555')) as { msg_id: string })
        .msg_id,
    ).toBe('11111111-2222-4333-8444-555555555555');
  });

  it('JSON-escapes content without breaking the single-line shape', () => {
    const content = 'quote " backslash \\ newline \n tab \t emoji \u{1F600}';
    const line = encodeUserFrame(content);
    expect(line.includes('\n')).toBe(false);
    expect((JSON.parse(line) as { message: { content: string } }).message.content).toBe(content);
  });
});

describe('encodeAuthLine', () => {
  it('emits the mandatory auth frame', () => {
    expect(encodeAuthLine('deadbeef')).toBe('{"type":"auth","token":"deadbeef"}');
  });
});
