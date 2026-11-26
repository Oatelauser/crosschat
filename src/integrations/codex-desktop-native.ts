import { join } from 'node:path';
import { sendMessage } from '../application/send/index.js';
import type { SendArgs, SendResult } from '../application/send/types.js';
import { deliverAppToolsMessage, listAppToolsThreads, readAppToolsThread } from '../codex/app-tools.js';
import type { AppToolsInvoker } from '../codex/app-tools.js';
import { MultichatError } from '../errors.js';
import { resolveCallerIdentity } from '../identity.js';
import { resolveTargetByName } from '../resolve.js';
import { appendSendLog } from '../send-log.js';
import { stateRoot } from '../state-root.js';

/** --tool is an integration selector, not a new option on the 1.13 CLI. */
export interface DesktopNativeSendArgs extends SendArgs {
  tool?: string;
  targetProviderId?: string;
  targetEndpointType?: string;
}

export interface DesktopNativeSendOptions {
  /** The host invokes official MCP tools with its actual identity and approvals. */
  invoke: AppToolsInvoker;
  env: Record<string, string | undefined>;
  stateDir?: string;
  now?: () => number;
}

/** A local embedding of the existing send pipeline; never a raw-pipe sender. */
export async function sendViaDesktopAppTools(args: DesktopNativeSendArgs, options: DesktopNativeSendOptions): Promise<SendResult> {
  if (args.tool !== 'codex-desktop' || args.delivery !== 'steer' || !args.to ||
      args.conversation !== undefined || args.via !== undefined || args.origin !== undefined ||
      args.fileArg !== undefined || args.targetSessionId !== undefined ||
      args.targetProviderId !== undefined || args.targetEndpointType !== undefined) {
    throw new MultichatError('CODEX_APP_TOOLS_SCOPE_UNSUPPORTED',
      'The native Desktop integration requires --to, --tool codex-desktop and explicit --delivery steer. Remote routes, conversation references and file transfer are not supported by this entry.');
  }
  const scan = { sessions: [], malformed: 0 };
  const env = { ...options.env };
  const caller = resolveCallerIdentity(env, scan);
  if (caller.p !== 'codex') {
    throw new MultichatError('CALLER_IDENTITY_UNRESOLVED', 'Run this integration inside the actual sending Codex chat; do not supply another chat\'s identity.');
  }
  // The official host verifies the actual sender before any delivery or state write.
  await readAppToolsThread(options.invoke, caller.id);
  // Preflight here: the legacy general-purpose send pipeline tolerates discovery
  // failures to keep Claude names usable, which is inappropriate for this entry.
  const threads = await listAppToolsThreads(options.invoke);
  // Full native IDs are authoritative in this bridge, including opaque IDs that
  // happen to match another thread's title. Legacy CLI name rules stay unchanged.
  const exact = threads.find((thread) => thread.id === args.to);
  let targetId: string;
  if (exact !== undefined) targetId = exact.id;
  else {
    const target = resolveTargetByName(args.to, scan.sessions, threads);
    if (target.side !== 'codex') throw new MultichatError('CODEX_APP_TOOLS_SCOPE_UNSUPPORTED', 'Only local Codex Desktop threads are supported.');
    targetId = target.thread.id;
  }
  // The legacy exact-target display interpolates a nullable title directly.
  // Supply a display fallback only after selection so it cannot affect routing.
  const displayThreads = threads.map((thread) => ({ ...thread, name: thread.name ?? thread.id.slice(0, 8) }));
  const directory = options.stateDir ?? stateRoot();
  const logFile = join(directory, 'send-log.jsonl');
  return sendMessage({ ...args, targetSessionId: targetId }, {
    env,
    listClaudeSessions: () => scan,
    listCodexThreads: async () => displayThreads,
    deliverClaude: async () => { throw new MultichatError('CODEX_APP_TOOLS_SCOPE_UNSUPPORTED', 'Only the selected Desktop endpoint is supported.'); },
    deliverCodex: (id, content, delivery) => deliverAppToolsMessage(options.invoke, id, content, { ...delivery, endpointType: 'desktop' }),
    sendLogFile: logFile,
    outboxDir: join(directory, 'outbox'),
    conversationStateFile: join(directory, 'conversations.json'),
    now: options.now ?? Date.now,
    appendLog: (entry) => appendSendLog(logFile, entry),
    // Native toolOutput delivery is not evidence recognized by the rollout reader.
    confirmReceipt: async () => 'unconfirmed',
  });
}
