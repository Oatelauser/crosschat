import { afterEach, describe, expect, it } from 'vitest';
import {
  assertAcknowledgedDelivery,
  probeFailure,
  scriptedAcknowledgement,
} from './helpers/opencode-desktop-probe-behavior.mjs';
import { createMockModel, textStream } from './helpers/opencode-mock-model.mjs';

const prefix = 'crosschat_desktop_fixture_';
const bodies = ['idle-message', 'after-service-restart', 'after-desktop-reopen'].map((suffix) => `${prefix}${suffix}`);
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { await Promise.all(cleanups.splice(0).map((cleanup) => cleanup())); });
const user = (text: string) => ({ type: 'user', text });
const assistant = (text: string) => ({ type: 'assistant', content: [{ type: 'text', text }] });

describe('Desktop probe acknowledgement evidence', () => {
  it('returns different model ACKs for the current delivery after both kinds of restart, with old history present', async () => {
    const model = await createMockModel((body: unknown) => textStream(scriptedAcknowledgement(body, prefix)));
    cleanups.push(model.close);
    const messages: { role: string; content: string }[] = [];
    const streams: string[] = [];
    for (const body of bodies) {
      messages.push({ role: 'user', content: body });
      const request = { model: 'fixture', messages, stream: true };
      const response = await fetch(`${model.url}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) });
      streams.push(await response.text());
      messages.push({ role: 'assistant', content: scriptedAcknowledgement(request, prefix) });
    }
    expect(new Set(streams).size).toBe(3);
    for (const [index, stream] of streams.entries()) expect(stream).toContain(bodies[index].slice(prefix.length));
    expect(model.errors).toEqual([]);
  });

  it('rejects a new visible incoming message when the only model reply belongs to an earlier turn', () => {
    const transcript = [user(bodies[0]), assistant(`${prefix}mock-ACK`), user(bodies[1])];
    const uiText = `${bodies[0]}\n${prefix}mock-ACK\n${bodies[1]}`;
    expect(() => assertAcknowledgedDelivery({ transcript, uiText, bodyMarker: bodies[1], prefix })).toThrow(/acknowledgement/i);
  });

  it('requires the current ACK to be an assistant text reply after this incoming message, not quoted user or tool content', () => {
    const bodyMarker = bodies[1];
    const acknowledgement = scriptedAcknowledgement({ messages: [{ role: 'user', content: bodyMarker }] }, prefix);
    const uiText = `${bodyMarker}\n${acknowledgement}`;
    const quoted = [user(`${bodyMarker}\n${acknowledgement}`)];
    expect(() => assertAcknowledgedDelivery({ transcript: quoted, uiText, bodyMarker, prefix })).toThrow(/acknowledgement/i);
    const toolOnly = [user(bodyMarker), { type: 'assistant', content: [{ type: 'tool', state: { status: 'completed', content: [{ type: 'text', text: acknowledgement }] } }] }];
    expect(() => assertAcknowledgedDelivery({ transcript: toolOnly, uiText, bodyMarker, prefix })).toThrow(/acknowledgement/i);
    const stale = [assistant(acknowledgement), user(bodyMarker)];
    expect(() => assertAcknowledgedDelivery({ transcript: stale, uiText, bodyMarker, prefix })).toThrow(/acknowledgement/i);
  });

  it('requires both persisted reply evidence and the same current reply on the visible Desktop', () => {
    const bodyMarker = bodies[2];
    const acknowledgement = scriptedAcknowledgement({ messages: [{ role: 'user', content: bodyMarker }] }, prefix);
    const transcript = [user(bodyMarker), assistant(acknowledgement)];
    expect(() => assertAcknowledgedDelivery({ transcript, uiText: `${bodyMarker}\n${acknowledgement}`, bodyMarker, prefix })).not.toThrow();
    expect(() => assertAcknowledgedDelivery({ transcript, uiText: bodyMarker, bodyMarker, prefix })).toThrow();
    expect(acknowledgement).not.toContain(bodyMarker);
    expect(() => assertAcknowledgedDelivery({ transcript, uiText: acknowledgement, bodyMarker, prefix })).toThrow();
  });
});

describe('Desktop probe startup failure reporting', () => {
  const fallback = { stage: 'setup', category: 'infrastructure', check: 'official-desktop-startup' };
  it.each(['service-registration-schema', 'service-authentication', 'service-info-route', 'service-info-schema'])('keeps the fixture diagnostic for deterministic %s changes', (check) => {
    const error = Object.assign(new Error('Official service contract changed'), { stage: 'setup', category: 'compatibility', check });
    expect(probeFailure(error, fallback)).toEqual({ stage: 'setup', category: 'compatibility', check });
  });
  it('preserves process and readiness infrastructure failures and keeps unclassified errors conservative', () => {
    for (const check of ['service-readiness', 'service-process']) {
      expect(probeFailure({ stage: 'setup', category: 'infrastructure', check }, fallback)).toEqual({ stage: 'setup', category: 'infrastructure', check });
    }
    expect(probeFailure(new Error('transport failed'), fallback)).toEqual(fallback);
    expect(probeFailure({ stage: 'setup', category: 'compatibility', check: 'bad\ncheck' }, fallback)).toEqual(fallback);
  });
});
