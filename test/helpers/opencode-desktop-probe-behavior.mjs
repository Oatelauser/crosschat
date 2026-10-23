import assert from 'node:assert/strict';

// Probe behavior is exercised without starting an upstream application.
export function acknowledgementForDelivery(bodyMarker, prefix) {
  assert.ok(bodyMarker.startsWith(prefix), 'The delivery marker must belong to this probe');
  const phase = bodyMarker.slice(prefix.length);
  assert.match(phase, /^[a-z0-9-]{1,80}$/, 'The delivery phase must be a bounded fixture identifier');
  // Do not embed the complete incoming marker: its presence must be verified separately in the UI.
  return `${prefix}model-ACK:${phase}`;
}

export function scriptedAcknowledgement(request, prefix) {
  const latestUser = Array.isArray(request?.messages) ? request.messages.findLast((message) => message?.role === 'user') : undefined;
  const text = typeof latestUser?.content === 'string' ? latestUser.content : JSON.stringify(latestUser?.content ?? '');
  const start = text.lastIndexOf(prefix);
  const phase = start < 0 ? undefined : text.slice(start + prefix.length).match(/^[a-z0-9-]+/)?.[0];
  return acknowledgementForDelivery(`${prefix}${phase ?? 'unmarked'}`, prefix);
}

export function assertAcknowledgedDelivery({ transcript, uiText, bodyMarker, prefix }) {
  const acknowledgement = acknowledgementForDelivery(bodyMarker, prefix);
  assert.ok(Array.isArray(transcript), 'A native transcript is required for model acknowledgement evidence');
  const incoming = transcript.findLastIndex((message) => message.type === 'user' && typeof message.text === 'string' && message.text.includes(bodyMarker));
  assert.ok(incoming >= 0, 'Transcript must contain the current incoming user message before its model acknowledgement');
  const nextUser = transcript.findIndex((message, index) => index > incoming && message.type === 'user');
  const currentTurn = transcript.slice(incoming + 1, nextUser < 0 ? undefined : nextUser);
  assert.ok(currentTurn.some((message) => message.type === 'assistant' && Array.isArray(message.content)
    && message.content.some((part) => part.type === 'text' && typeof part.text === 'string' && part.text.includes(acknowledgement))),
  'Current incoming message must have its own subsequent assistant text acknowledgement');
  assert.ok(uiText.includes(bodyMarker) && uiText.includes(acknowledgement), 'Current native UI must contain the incoming message and its model acknowledgement');
  return { bodyMarker, acknowledgement };
}

export function probeFailure(error, fallback) {
  if (['compatibility', 'infrastructure'].includes(error?.category)
    && /^[a-z0-9-]{1,80}$/.test(error?.stage ?? '') && /^[a-z0-9-]{1,80}$/.test(error?.check ?? '')) {
    return { stage: error.stage, category: error.category, check: error.check };
  }
  return { ...fallback };
}
