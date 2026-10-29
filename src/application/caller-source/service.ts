import type { CallerIdentity } from '../../identity.js';
import { MultichatError } from '../../errors.js';
import { parseToolType } from '../../tool-types.js';
import type { CallerSourceObservation } from './providers.js';
import { confirmSource, inspectSource } from './confirmations.js';
import type { SourceClassification, SourceContext, SourcePromptProbe } from './confirmations.js';

export interface CallerSourceDeps {
  directory: string;
  probe(caller: CallerIdentity): Promise<CallerSourceObservation>;
  /** Entry-specific policy approved after its native association was verified. */
  manualConfirmationApproved?(caller: CallerIdentity, observation: CallerSourceObservation): boolean;
  /** The approved Adapter can authoritatively distinguish a live owner from an exited one. */
  probePromptOwner?: SourcePromptProbe;
}
export interface CallerSourceResult {
  status: SourceClassification['status'] | 'human' | 'unresolved' | 'unavailable' | 'review-required';
  shouldAsk: boolean;
  sourceTool?: string;
  basis?: 'native' | 'user';
  association?: 'verified' | 'unavailable';
  scope?: 'origin' | 'instance';
  context?: string;
  promptClaim?: string;
  code?: string;
  reason?: string;
}
async function probe(caller: CallerIdentity, deps: CallerSourceDeps): Promise<CallerSourceObservation> {
  try { return await deps.probe(caller); }
  catch { return { status: 'unavailable', association: 'unavailable', basis: 'native', code: 'SOURCE_PROBE_UNAVAILABLE', reason: 'Native source observation is temporarily unavailable; no type was inferred.' }; }
}
function contextOf(caller: CallerIdentity, observation: CallerSourceObservation): SourceContext | undefined {
  if (caller.p === 'human' || observation.association !== 'verified' || !observation.sourceDomain || !observation.runtimeFingerprint || !observation.scope) return undefined;
  return { providerId: caller.p, nativeId: caller.id, domain: observation.sourceDomain,
    runtime: observation.runtimeFingerprint, scope: observation.scope, observedTool: observation.sourceTool };
}
function knownType(caller: CallerIdentity, observation: CallerSourceObservation): boolean {
  return caller.p !== 'human' && observation.status === 'identified'
    && observation.sourceTool !== undefined && parseToolType(observation.sourceTool)?.providerId === caller.p;
}
function classifiedCaller(caller: CallerIdentity, result: CallerSourceResult): CallerSourceResult {
  const type = result.sourceTool === undefined ? undefined : parseToolType(result.sourceTool);
  if (caller.p !== 'human' && caller.endpointType !== undefined && type !== undefined && type.endpointType !== caller.endpointType) {
    return { status: 'conflict', shouldAsk: false, association: result.association, scope: result.scope,
      code: 'SOURCE_TYPE_CONFLICT', reason: 'The final source classification conflicts with the existing native caller type.' };
  }
  return result;
}

/** Source classification never chooses a recipient or manufactures a native identity. */
export async function inspectCallerSource(caller: CallerIdentity, deps: CallerSourceDeps, requestConfirmation = false): Promise<CallerSourceResult> {
  if (caller.p === 'human') return { status: 'human', shouldAsk: false };
  const observation = await probe(caller, deps);
  if (observation.sourceTool !== undefined && parseToolType(observation.sourceTool)?.providerId !== caller.p) {
    return { status: 'conflict', shouldAsk: false, code: 'SOURCE_TYPE_CONFLICT', reason: 'Native source observation does not match this Provider.' };
  }
  if (knownType(caller, observation) && caller.endpointType !== undefined
    && parseToolType(observation.sourceTool!)?.endpointType !== caller.endpointType) {
    return { status: 'conflict', shouldAsk: false, code: 'SOURCE_TYPE_CONFLICT', reason: 'The observed source type conflicts with the existing native classification.' };
  }
  const source = contextOf(caller, observation);
  if (knownType(caller, observation)) {
    const result: SourceClassification = source === undefined
      ? { status: 'identified', shouldAsk: false, sourceTool: observation.sourceTool, basis: 'native' }
      : await inspectSource(source, { directory: deps.directory });
    return classifiedCaller(caller, { ...result, association: observation.association, scope: observation.scope });
  }
  if (source === undefined) return { status: observation.status === 'unavailable' ? 'unavailable' : 'unresolved',
    shouldAsk: false, association: observation.association, code: observation.code,
    reason: observation.reason ?? 'The invocation cannot yet be associated with a reusable native source; entry-specific review is required.' };
  if (deps.manualConfirmationApproved?.(caller, observation) !== true) return {
    status: 'review-required', shouldAsk: false, association: observation.association, scope: observation.scope,
    code: 'SOURCE_CONFIRMATION_REVIEW_REQUIRED', reason: 'The manual confirmation scope for this native entry needs user review before use.',
  };
  if (deps.probePromptOwner === undefined) return {
    status: 'review-required', shouldAsk: false, association: observation.association, scope: observation.scope,
    code: 'SOURCE_LIFECYCLE_REVIEW_REQUIRED', reason: 'The approved native entry must provide prompt-owner lifecycle evidence before manual confirmation can be used.',
  };
  return classifiedCaller(caller, { ...await inspectSource(source, { directory: deps.directory, requestConfirmation,
    probePromptOwner: deps.probePromptOwner }), association: observation.association });
}

/** Send's optional source probe is non-blocking for Q8 and never requests a question. */
export async function enrichCallerSource(caller: CallerIdentity, deps: CallerSourceDeps): Promise<CallerIdentity> {
  if (caller.p === 'human') return caller;
  try {
    const result = await inspectCallerSource(caller, deps);
    if ((result.status !== 'identified' && result.status !== 'confirmed') || result.sourceTool === undefined) return caller;
    const type = parseToolType(result.sourceTool);
    return type?.providerId === caller.p && (caller.endpointType === undefined || caller.endpointType === type.endpointType)
      ? { ...caller, endpointType: type.endpointType } : caller;
  } catch { return caller; } // A state/probe failure does not invalidate a matching native session ID.
}

export async function confirmCallerSource(caller: CallerIdentity, tool: string, context: string, deps: CallerSourceDeps): Promise<CallerSourceResult> {
  if (caller.p === 'human') throw new MultichatError('SOURCE_CONTEXT_UNAVAILABLE', 'Run this operation inside the native tool session; a user answer cannot create a missing native identity.');
  const selected = parseToolType(tool);
  if (selected?.providerId !== caller.p || caller.endpointType !== undefined && selected.endpointType !== caller.endpointType) {
    throw new MultichatError('SOURCE_TYPE_CONFLICT', 'The chosen source type conflicts with the current native caller.');
  }
  const observation = await probe(caller, deps);
  const source = contextOf(caller, observation);
  if (source === undefined && observation.status !== 'unavailable') throw new MultichatError('SOURCE_CONTEXT_UNAVAILABLE', 'This native entry has no verified source association; its limitation and fallback scope need user review.');
  if (deps.manualConfirmationApproved?.(caller, observation) !== true) throw new MultichatError('SOURCE_CONFIRMATION_REVIEW_REQUIRED', 'The manual confirmation policy for this entry has not been approved.');
  if (deps.probePromptOwner === undefined) throw new MultichatError('SOURCE_LIFECYCLE_REVIEW_REQUIRED', 'A native prompt-owner lifecycle probe is required for this manual confirmation policy.');
  return { ...await confirmSource(context, selected.id, source ?? { providerId: caller.p, nativeId: caller.id }, { directory: deps.directory }), association: observation.association };
}
