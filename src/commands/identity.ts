import type { CallerIdentity } from '../identity.js';
import { MultichatError } from '../errors.js';
import { parseToolType } from '../tool-types.js';
import { confirmCallerSource, inspectCallerSource } from '../application/caller-source/service.js';
import type { CallerSourceDeps, CallerSourceResult } from '../application/caller-source/service.js';

export interface IdentityDeps extends CallerSourceDeps { resolveCaller(): CallerIdentity }
export interface IdentityResult extends CallerSourceResult { confirmationCommand?: string }

/** User answers classify a source; this command never supplies or changes its native ID. */
export async function runIdentity(argv: readonly string[], deps: IdentityDeps): Promise<IdentityResult> {
  let action: { tool: string; context: string } | undefined;
  if (argv.length > 0) {
    if (argv[0] !== 'confirm') throw new MultichatError('USAGE', 'Use crosschat identity, or identity confirm --tool <self type> --context <generated reference>.');
    const values = new Map<string, string>();
    for (let index = 1; index < argv.length; index += 2) {
      const flag = argv[index], value = argv[index + 1];
      if (!['--tool', '--context'].includes(flag) || values.has(flag) || !value || value.startsWith('--')) {
        throw new MultichatError('USAGE', 'identity confirm requires one --tool and one program-generated --context.');
      }
      values.set(flag, value);
    }
    const tool = values.get('--tool'), context = values.get('--context');
    if (!tool || !context || parseToolType(tool) === undefined) throw new MultichatError('USAGE', 'identity confirm requires a registered self tool type and a program-generated context.');
    action = { tool, context };
  }
  const caller = deps.resolveCaller();
  if (action !== undefined) return confirmCallerSource(caller, action.tool, action.context, deps);
  const result = await inspectCallerSource(caller, deps, true);
  return { ...result, ...(result.context === undefined || result.sourceTool !== undefined ? {} : {
    confirmationCommand: `crosschat identity confirm --tool <自身类型> --context ${result.context}`,
  }) };
}
