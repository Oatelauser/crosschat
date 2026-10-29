import { describe, expect, it } from 'vitest';
import { replySendArgs } from './helpers/compat-reply.mjs';

const envelope = (tool: string, command: string, body = 'owned-request') => `<cross-session-message from-tool="${tool}"><crosschat-reply-hint>${command}</crosschat-reply-hint>${body}</cross-session-message>`;
const options = { tool: 'dsh', requestBody: 'owned-request', body: 'actual reply; $literal\n中文' };
describe('real tool compatibility reply command', () => {
  it('copies the actual reference and explicit recipient tool while preserving body bytes', () => {
    const incoming = envelope('dsh', '回复请运行: crosschat send --conversation mc2_aB-9 --tool dsh --body "<正文>"');
    expect(replySendArgs(incoming, options)).toEqual(['send', '--conversation', 'mc2_aB-9', '--tool', 'dsh', '--body', options.body, '--json']);
  });

  it('selects the owned incoming envelope and tolerates repeated identical history', () => {
    const current = envelope('opencode', 'crosschat send --conversation c13 --tool opencode --body "<正文>"');
    const other = envelope('claude', 'crosschat send --conversation c12 --tool claude --body "<正文>"', 'other request');
    expect(replySendArgs(other + current + current, { ...options, tool: 'opencode' })).toContain('c13');
  });

  it.each([
    envelope('pending', '回复收件类型待核实；保留会话引用 mc2_aB-9'),
    envelope('dsh', 'crosschat send --conversation mc2_aB-9 --body "<正文>"'),
    envelope('dsh', 'crosschat send --conversation mc2_aB-9 --tool claude --body "<正文>"'),
    envelope('pending', 'crosschat send --conversation mc2_aB-9 --tool dsh --body "<正文>"'),
    envelope('dsh', 'crosschat send --conversation $(untrusted) --tool dsh --body "<正文>"'),
    'crosschat send --conversation mc2_aB-9 --tool dsh --body "<正文>"',
    envelope('dsh', 'crosschat send --conversation c1 --tool dsh --body "<正文>"') + envelope('dsh', 'crosschat send --conversation c2 --tool dsh --body "<正文>"'),
  ])('rejects an unverified, missing, conflicting or ambiguous reply hint: %s', (incoming) => {
    expect(() => replySendArgs(incoming, options)).toThrow();
  });
});
