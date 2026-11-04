import { describe, expect, it } from 'vitest';
import { replySendArgs } from './helpers/compat-reply.mjs';

const envelope = (tool: string, command: string, body = 'owned-request') => `<cross-session-message from-tool="${tool}"><crosschat-reply-hint>${command}</crosschat-reply-hint>${body}</cross-session-message>`;
const options = { tool: 'dsh', requestBody: 'owned-request', body: 'actual reply; $literal\n中文' };
describe('real tool compatibility reply command', () => {
  it('copies the actual reference and explicit recipient tool while preserving body bytes', () => {
    const incoming = envelope('dsh', '回复请运行: crosschat send --conversation mc2_aB-9 --tool dsh --body "<正文>"');
    expect(replySendArgs(incoming, options)).toEqual(['send', '--conversation', 'mc2_aB-9', '--tool', 'dsh', '--body', options.body, '--json']);
  });

  it.each(['cA000', 'cZ999'])('uses the approved short handle %s from a native Desktop reply hint', (reference) => {
    const incoming = envelope('dsh-desktop', `crosschat send --conversation ${reference} --tool dsh-desktop --body "<正文>"`);
    expect(replySendArgs(incoming, { ...options, tool: 'dsh-desktop' })).toEqual([
      'send', '--conversation', reference, '--tool', 'dsh-desktop', '--body', options.body, '--json',
    ]);
  });

  it('selects the owned incoming envelope and tolerates repeated identical history', () => {
    const current = envelope('opencode', 'crosschat send --conversation cB013 --tool opencode --body "<正文>"');
    const other = envelope('claude', 'crosschat send --conversation cB012 --tool claude --body "<正文>"', 'other request');
    expect(replySendArgs(other + current + current, { ...options, tool: 'opencode' })).toContain('cB013');
  });

  it('reads a typed current hint inside serialized native model text blocks', () => {
    const incoming = JSON.stringify([{ type: 'text', text: envelope('claude', 'crosschat send --conversation cD304 --tool claude --body "<正文>"') }]);
    expect(replySendArgs(incoming, { ...options, tool: 'claude' })).toContain('cD304');
  });

  it.each(['c13', 'c0', 'ca000', 'cA00', 'cA0000', 'cAA000', 'cZ1000'])(
    'rejects a retired or malformed short handle %s', (reference) => {
      const incoming = envelope('dsh', `crosschat send --conversation ${reference} --tool dsh --body "<正文>"`);
      expect(() => replySendArgs(incoming, options)).toThrow();
    },
  );

  it('rejects two different verified current reply targets', () => {
    const incoming = envelope('dsh', 'crosschat send --conversation cA001 --tool dsh --body "<正文>"')
      + envelope('dsh', 'crosschat send --conversation cA002 --tool dsh --body "<正文>"');
    expect(() => replySendArgs(incoming, options)).toThrow('ambiguous');
  });

  it.each([
    envelope('pending', '回复收件类型待核实；保留会话引用 mc2_aB-9'),
    envelope('dsh', 'crosschat send --conversation mc2_aB-9 --body "<正文>"'),
    envelope('dsh', 'crosschat send --conversation mc2_aB-9 --tool claude --body "<正文>"'),
    envelope('pending', 'crosschat send --conversation mc2_aB-9 --tool dsh --body "<正文>"'),
    envelope('dsh', 'crosschat send --conversation $(untrusted) --tool dsh --body "<正文>"'),
    'crosschat send --conversation mc2_aB-9 --tool dsh --body "<正文>"',
  ])('rejects an unverified, missing, conflicting or ambiguous reply hint: %s', (incoming) => {
    expect(() => replySendArgs(incoming, options)).toThrow();
  });
});
