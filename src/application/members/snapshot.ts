import type { MemberObservation, MemberProvider, MemberSnapshotRequest } from './model.js';

/**
 * Ordered provider capabilities retain the legacy first-present policy. An
 * inconclusive probe aborts reconciliation before its caller mutates members.
 */
export async function readMemberSnapshot(
  providers: readonly MemberProvider[],
  request: MemberSnapshotRequest,
): Promise<ReadonlyMap<string, MemberObservation>> {
  const observations = new Map<string, MemberObservation>();
  request.signal?.throwIfAborted();
  for (const nativeId of new Set(request.nativeIds)) {
    const target = { contextId: request.contextId, nativeId, signal: request.signal };
    for (const provider of providers) {
      request.signal?.throwIfAborted();
      const result = await provider.liveness.probe(target);
      request.signal?.throwIfAborted();
      if (result.presence === 'unknown') throw new Error(`Member liveness is unknown for provider ${provider.providerId}.`);
      if (result.presence === 'absent') continue;
      observations.set(nativeId, { providerId: provider.providerId, readName: () => provider.readName(target) });
      break;
    }
  }
  return observations;
}
