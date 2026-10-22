import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import process from 'node:process';
import type { Writable } from 'node:stream';
import { copyText } from '../application/clipboard.js';
import { createTuiController } from './app/controller.js';
import type { TuiContextPage, TuiControllerOptions } from './app/controller.js';
import type { TuiContext, TuiResourceAdapter } from './model.js';
import { presentContext } from './resources/contexts.js';
import { createResourceRegistry, defaultResources } from './resources/registry.js';
import type { ResourceRegistry } from './resources/registry.js';
import { runTerminalSession } from './terminal.js';
import type { MountedTui, TerminalInput, TerminalOutput, TerminalSignals } from './terminal.js';

export interface RunTuiOptions {
  stdin?: TerminalInput;
  stdout?: TerminalOutput;
  stderr?: Writable;
  signals?: TerminalSignals;
  home?: string;
  contexts?: readonly TuiContext[];
  adapters?: Readonly<Record<string, TuiResourceAdapter>>;
  registry?: ResourceRegistry;
  clipboard?: TuiControllerOptions['clipboard'];
  version?: string;
}

function cancelledMount(): MountedTui {
  return { done: Promise.resolve(), dispose: () => {} };
}

async function packageVersion(): Promise<string> {
  const value: unknown = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
  if (typeof value !== 'object' || value === null || !('version' in value) || typeof value.version !== 'string') {
    throw new Error('Package version is unavailable.');
  }
  return value.version;
}

/** Loading TUI data and Ink happens only after the outer terminal owner accepts TTY IO. */
export async function runTui(options: RunTuiOptions = {}): Promise<number> {
  const stdin = options.stdin ?? process.stdin;
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  return runTerminalSession({
    stdin, stdout, stderr, signals: options.signals,
    mount: async (owner) => {
      const home = options.home ?? homedir();
      const present = options.adapters === undefined ? presentContext : (context: TuiContext) => context;
      const { listTuiContexts, loadTuiPreferences, saveTuiPreferences } = await import('../application/contexts/index.js');
      if (owner.signal.aborted) return cancelledMount();
      const readContexts = async (signal: AbortSignal): Promise<TuiContextPage> => {
        const result = await listTuiContexts({ home, signal });
        return {
          contexts: result.items.map((context) => present({ id: context.id, label: context.name, kind: context.kind, target: context.target, identityHint: context.identityHint })),
          completeness: signal.aborted ? 'cancelled' : result.errors.length ? 'partial' : 'complete',
          notice: result.errors.length ? result.errors.map((error) => `${error.source} <${error.kind}>：${error.message}；${error.nextStep}`).join('\n') : undefined,
        };
      };
      const [initialContexts, preferences] = await Promise.all([
        options.contexts === undefined ? readContexts(owner.signal) : { contexts: options.contexts.map(present), completeness: 'complete' as const },
        loadTuiPreferences({ home, signal: owner.signal }),
      ]);
      if (owner.signal.aborted) return cancelledMount();
      if (preferences.errors.length) stderr.write('界面偏好无法读取；将使用默认选择，原文件保持不变。\n');
      const [ink, ui, react, version] = await Promise.all([
        import('ink'), import('./ui/app.js'), import('react'), options.version ?? packageVersion(),
      ]);
      if (owner.signal.aborted) return cancelledMount();
      const composition = options.adapters === undefined
        ? (await import('./composition.js')).createDefaultResources({ home, isolatedHome: options.home !== undefined }) : undefined;
      if (owner.signal.aborted) return cancelledMount();
      const registry = options.registry ?? createResourceRegistry(composition?.resources ?? defaultResources);
      let selectedContextId: string | undefined;
      const controller = createTuiController({
        registry, contexts: initialContexts.contexts, adapters: options.adapters ?? composition?.adapters ?? {},
        contextSource: options.contexts === undefined ? { initial: initialContexts, read: readContexts } : undefined,
        initialSelectedContextId: preferences.value?.selectedContextId,
        onContextSelection: (id) => { selectedContextId = id; },
        clipboard: options.clipboard ?? ((text, signal) => copyText(text, { signal })),
        onExit: owner.exit,
      });
      controller.resize(stdout.columns ?? 80, stdout.rows ?? 24);
      let instance: ReturnType<typeof ink.render>;
      try {
        instance = ink.render(react.createElement(ui.TuiApp, { controller, registry, version, onError: owner.fail }), {
          stdin, stdout, stderr, alternateScreen: true, exitOnCtrlC: false, patchConsole: false, interactive: true,
        });
      } catch (error) {
        controller.dispose();
        throw error;
      }
      const done = instance.waitUntilExit().then(() => {});
      return {
        done,
        interrupt: () => controller.handleKey({ name: 'c', ctrl: true }),
        dispose: async () => {
          controller.dispose();
          try { instance.unmount(); await done; }
          finally {
            if (selectedContextId && (composition?.shouldSavePreferences() ?? true)) {
              const saved = await saveTuiPreferences({ home, preferences: { version: 1, selectedContextId } });
              if (saved.errors.length) stderr.write('最近连接选择未能保存；请检查界面偏好文件的访问权限。\n');
            }
          }
        },
      };
    },
  });
}
