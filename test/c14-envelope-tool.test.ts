import { describe, expect, it } from 'vitest';
import { composeEnvelope } from '../src/envelope.js';

const input = { fromName: '发送方', toName: '接收方', turn: 2, ref: 'mc2_ref', handle: 'cA014', body: '正文' };

describe('explicit reply tools and source classification', () => {
  it('puts the known source type in its own attribute and the recipient type into the reply command', () => {
    const result = composeEnvelope({ ...input, fromTool: 'codex-desktop', replyTool: 'codex-desktop', fromAddr: 'tcp:main:电脑A:完整ID' });
    expect(result).toContain('from-tool="codex-desktop"');
    expect(result).toContain('from-addr="tcp:main:电脑A:完整ID"');
    expect(result).toContain('crosschat send --conversation cA014 --tool codex-desktop --body "<你的回复>"');
  });

  it('can retain a fixed reply recipient type while showing the current source classification as pending', () => {
    const result = composeEnvelope({ ...input, replyTool: 'codex-cli' });
    expect(result).toContain('from-tool="pending"');
    expect(result).toContain('crosschat send --conversation cA014 --tool codex-cli');
    expect(result).not.toContain('from-tool="codex-cli"');
  });

  it('preserves the conversation handle without presenting an executable command when its reply type is unknown', () => {
    const result = composeEnvelope(input);
    expect(result).toContain('from-tool="pending"');
    expect(result).toContain('收件类型待核实');
    expect(result).toContain('cA014');
    expect(result).not.toContain('回复请运行:');
    expect(result).not.toContain('crosschat send');
  });
});
