import { describe, expect, it } from 'vitest';
import * as fixture from './helpers/claude-live-fixture.mjs';

const sessionId = '669312c3-f342-47c0-b199-b96acc5b6e14';
const expected = { session: sessionId, socket: '\\\\.\\pipe\\LOCAL\\cc-msg-fixture', home: 'D:\\owned\\profile', cwd: 'D:\\owned\\workspace' };
const startup = () => ({ processAlive: true, sessionId, modelErrors: [],
  events: [{ type: 'system', subtype: 'init', session_id: sessionId }],
  requests: [{ messages: [{ role: 'user', content: [{ type: 'text', text: `CC_CI_BOOTSTRAP ${sessionId}` }] }] }],
});
const identityEvidence = () => ({
  toolResult: { type: 'tool_result', tool_use_id: `cc_bootstrap_${sessionId.replaceAll('-', '')}`, content: JSON.stringify(expected) },
  identity: expected, modelErrors: [], ack: `CC_CI_BOOTSTRAP_ACK ${sessionId}`,
  turnResult: { type: 'result', subtype: 'success', is_error: false, result: `CC_CI_BOOTSTRAP_ACK ${sessionId}` },
});

describe('Claude compatibility failure evidence gates', () => {
  it('reports missing native registration as compatibility only after this owned process initialized and reached the local model', () => {
    expect(fixture.assessClaudeStartupEvidence(startup())).toEqual({ category: 'compatibility', stage: 'contract' });
  });

  it('keeps missing readiness, another session, assistant-only markers and model failures inconclusive infrastructure', () => {
    const valid = startup();
    for (const evidence of [
      { ...valid, processAlive: false }, { ...valid, events: [] }, { ...valid, requests: [] },
      { ...valid, events: [{ type: 'system', subtype: 'init', session_id: 'another-session' }] },
      { ...valid, requests: [{ messages: [{ role: 'assistant', content: `CC_CI_BOOTSTRAP ${sessionId}` }] }] },
      { ...valid, requests: [{ messages: [{ role: 'user', content: 'another unrelated bootstrap' }] }] },
      { ...valid, modelErrors: ['MODEL_SCRIPT_FAILED'] },
    ]) expect(fixture.assessClaudeStartupEvidence(evidence)).toEqual({ category: 'infrastructure', stage: 'setup' });
  });

  it('accepts the exact identity only with a successful real tool result and expected bootstrap acknowledgement', () => {
    expect(fixture.assessClaudeIdentityEvidence(identityEvidence(), expected)).toEqual({ ready: true });
  });

  it('reports changed or removed native identity fields as compatibility after the tool/model path is proven', () => {
    for (const identity of [{}, { ...expected, session: 'changed-native-id' }, { ...expected, socket: '\\\\.\\pipe\\changed' },
      { ...expected, home: 'D:\\different-profile' }, { ...expected, cwd: 'D:\\different-workspace' }]) {
      expect(fixture.assessClaudeIdentityEvidence({ ...identityEvidence(), identity }, expected)).toEqual({ ready: false, category: 'compatibility', stage: 'contract' });
    }
  });

  it('keeps failed or missing tools, unparsed JSON, absent acknowledgements and broken mock output as infrastructure', () => {
    const valid = identityEvidence();
    for (const evidence of [
      { ...valid, toolResult: undefined }, { ...valid, toolResult: { ...valid.toolResult, is_error: true } },
      { ...valid, toolResult: { ...valid.toolResult, tool_use_id: 'unrelated-tool-result' } },
      { ...valid, identity: undefined }, { ...valid, identity: 'not parsed JSON' }, { ...valid, identity: [] },
      { ...valid, turnResult: { ...valid.turnResult, is_error: true } },
      { ...valid, turnResult: { ...valid.turnResult, result: 'unrelated response' } }, { ...valid, modelErrors: ['MODEL_SCRIPT_FAILED'] },
    ]) expect(fixture.assessClaudeIdentityEvidence(evidence, expected)).toEqual({ ready: false, category: 'infrastructure', stage: 'model-fixture' });
  });
});
