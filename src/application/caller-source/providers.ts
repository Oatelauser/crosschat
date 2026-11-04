import type { CallerIdentity } from '../../identity.js';
import { createHash } from 'node:crypto';
import { isAbsolute, resolve } from 'node:path';
import { MultichatError } from '../../errors.js';
import { DSH_INSTANCE_ID } from '../../dsh/registry.js';
import { findDshTarget } from '../../dsh/client.js';
import { withDshOperation } from '../../dsh/service.js';
import { toolTypeFor } from '../../tool-types.js';

/** Native facts only. A source category does not imply a verified runtime association. */
export interface CallerSourceObservation {
  status: 'identified' | 'unresolved' | 'unavailable';
  sourceTool?: string;
  sourceDomain?: string;
  runtimeFingerprint?: string;
  scope?: 'origin' | 'instance';
  association: 'verified' | 'unavailable';
  basis: 'native';
  code?: string;
  reason?: string;
}

export interface CallerSourceOptions {
  env?: NodeJS.ProcessEnv;
  home?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

function unresolved(code: string, reason: string, status: 'unresolved' | 'unavailable' = 'unresolved'): CallerSourceObservation {
  return { status, association: 'unavailable', basis: 'native', code, reason };
}

function pathKey(path: string): string {
  const absolute = resolve(path);
  return process.platform === 'win32' ? absolute.toLowerCase() : absolute;
}

function digest(parts: readonly unknown[]): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
}

function check(signal?: AbortSignal): void {
  if (signal?.aborted) throw new MultichatError('CALLER_SOURCE_CANCELLED', 'Caller source probing was cancelled.');
}

async function harnessSource(caller: Extract<CallerIdentity, { p: 'dsh' }>, options: CallerSourceOptions): Promise<CallerSourceObservation> {
  const env = options.env ?? process.env;
  const instanceId = env.DSH_CROSSCHAT_INSTANCE_ID;
  const stateHome = env.DSH_CROSSCHAT_HOME;
  const profile = env.DSH_PROFILE;
  const profileDir = env.DSH_PROFILE_DIR;
  const nativeHome = env.DSH_HOME;
  if (env.DSH_SESSION_ID !== caller.id || env.DSH_SHELL !== '1' || typeof instanceId !== 'string' || !DSH_INSTANCE_ID.test(instanceId)
    || typeof stateHome !== 'string' || !isAbsolute(stateHome) || typeof profile !== 'string' || profile.trim() === ''
    || typeof profileDir !== 'string' || !isAbsolute(profileDir) || typeof nativeHome !== 'string' || !isAbsolute(nativeHome)) {
    return unresolved('DSH_SOURCE_ASSOCIATION_UNAVAILABLE', 'The native Harness shell has not supplied a complete current bridge association. No source instance was guessed.');
  }
  if (options.home !== undefined && pathKey(options.home) !== pathKey(stateHome)) {
    return unresolved('DSH_SOURCE_CONTEXT_MISMATCH', 'The current Harness bridge and selected crosschat state home disagree.', 'unavailable');
  }
  return withDshOperation({ home: stateHome, instanceId, signal: options.signal, timeoutMs: options.timeoutMs }, async (operation) => {
    const target = await findDshTarget(caller.id, operation);
    if (target === null) return unresolved('DSH_SOURCE_SESSION_UNAVAILABLE', 'The native caller is not a live root in its exact registered bridge.', 'unavailable');
    const registration = target.connection.registration;
    const association = registration.callerIdentity;
    const sourceTool = toolTypeFor('dsh', registration.endpointType);
    if (registration.profile !== profile || association === undefined || pathKey(association.profileDir) !== pathKey(profileDir) || sourceTool === undefined) {
      return unresolved('DSH_SOURCE_CONTEXT_MISMATCH', 'The native Harness profile and authenticated bridge association disagree.', 'unavailable');
    }
    check(options.signal);
    // DSH_HOME belongs to the native shell registry; it may differ from crosschat's
    // home or profileContext.home. Include it in runtime observations, never equate them.
    return { status: 'identified', sourceTool, association: 'verified', basis: 'native', scope: 'instance',
      sourceDomain: `dsh:${digest([pathKey(stateHome), instanceId, profile, pathKey(profileDir)])}`,
      runtimeFingerprint: digest([instanceId, registration.pid, registration.createdAt, registration.runtimeVersion, profile, pathKey(profileDir), pathKey(nativeHome)]),
    };
  });
}

/** Read current native facts without installing, changing configuration, or asking the user. */
export async function probeCallerSource(caller: CallerIdentity, options: CallerSourceOptions = {}): Promise<CallerSourceObservation> {
  check(options.signal);
  const env = options.env ?? process.env;
  if (caller.p === 'human') return unresolved('CALLER_SOURCE_HUMAN', 'A normal terminal has no native receiving session.');
  if (caller.p === 'claude') {
    if (!env.CLAUDE_CODE_MESSAGING_SOCKET) return unresolved('CLAUDE_SOURCE_CONTEXT_UNAVAILABLE', 'The native Claude messaging channel is not available.');
    return { status: 'identified', sourceTool: 'claude', association: 'unavailable', basis: 'native',
      reason: 'The native messaging channel identifies the supported Claude CLI type; a reusable execution-origin scope is not asserted.' };
  }
  if (caller.p === 'opencode') {
    if ((env.OPENCODE_SESSION_ID || env.CROSSCHAT_OPENCODE_SESSION_ID) !== caller.id) {
      return unresolved('OPENCODE_SOURCE_CONTEXT_MISMATCH', 'The current native OpenCode identity does not match the caller.', 'unavailable');
    }
    return { status: 'identified', sourceTool: 'opencode', association: 'unavailable', basis: 'native', code: 'OPENCODE_SOURCE_ASSOCIATION_UNVERIFIED',
      reason: 'OpenCode uses the shared service type. Its session id and selected registration do not establish which service executed this shell.' };
  }
  if (caller.p === 'codex') return unresolved('CODEX_SOURCE_ASSOCIATION_UNVERIFIED',
    'The native Codex session and call identifiers have not been associated with the actual CLI or Desktop execution entry. Candidate owners and inherited labels are not source evidence.');
  try { return await harnessSource(caller, options); }
  catch (error) {
    check(options.signal);
    return unresolved(error instanceof MultichatError ? error.code : 'DSH_SOURCE_UNAVAILABLE',
      'The exact native Harness source could not be verified. This temporary result does not change routing or permanently disable the provider.', 'unavailable');
  }
}
