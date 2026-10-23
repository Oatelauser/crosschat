import assert from 'node:assert/strict';

// Extracted probe behavior: exercised without starting an upstream application.
export function scriptedAcknowledgement(_request, prefix) {
  return `${prefix}mock-ACK`;
}

export function assertAcknowledgedDelivery({ transcript, uiText, bodyMarker, prefix }) {
  const acknowledgement = `${prefix}mock-ACK`;
  const recorded = JSON.stringify(transcript);
  assert.ok(recorded.includes(bodyMarker) && recorded.includes(acknowledgement), 'Transcript must contain the incoming message and its model acknowledgement');
  assert.ok(uiText.includes(bodyMarker) && uiText.includes(acknowledgement), 'Current native UI must contain the incoming message and its model acknowledgement');
  return { bodyMarker, acknowledgement };
}

export function probeFailure(_error, fallback) {
  return { ...fallback };
}
