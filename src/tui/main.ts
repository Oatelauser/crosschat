import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import process from 'node:process';
import type { Writable } from 'node:stream';
import { copyText } from '../application/clipboard.js';
import { createTuiController } from './app/controller.js';
import type { TuiControllerOptions } from './app/controller.js';
import type { TuiContext, TuiResourceAdapter } from './model.js';
import { createResourceRegistry } from './resources/registry.js';
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
      const { listTuiContexts, loadTuiPreferences, saveTuiPreferences } = await import('../application/contexts/index.js');
      if (owner.signal.aborted) return cancelledMount();
      const [configured, preferences] = await Promise.all([
        options.contexts === undefined ? listTuiContexts({ home, signal: owner.signal }) : undefined,
        loadTuiPreferences({ home, signal: owner.signal }),
      ]);
      if (owner.signal.aborted) return cancelledMount();
      const contexts: readonly TuiContext[] = options.contexts ?? (configured?.items ?? []).map((context) => ({
        id: context.id, label: context.name, kind: context.kind, target: context.target, identityHint: context.identityHint,
      }));
      if (configured?.errors.length) stderr.write('部分连接配置无法读取；已列出可用连接，请检查配置格式或访问权限。\n');
      if (preferences.errors.length) stderr.write('界面偏好无法读取；将使用默认选择，原文件保持不变。\n');
      const [ink, ui, react, version] = await Promise.all([
        import('ink'), import('./ui/app.js'), import('react'), options.version ?? packageVersion(),
      ]);
      if (owner.signal.aborted) return cancelledMount();
      const registry = options.registry ?? createResourceRegistry();
      const controller = createTuiController({
        registry, contexts, adapters: options.adapters ?? {},
        initialSelectedContextId: preferences.value?.selectedContextId,
        clipboard: options.clipboard ?? ((text, signal) => copyText(text, { signal })),
        onExit: owner.exit,
      });
      controller.resize(stdout.columns ?? 80, stdout.rows ?? 24);
      const initial = controller.getSnapshot();
      let previousSelectedId = initial.selectedId;
      let previousContextId = initial.route.contextId;
      let previousResourceId = initial.route.resourceId;
      let previousMode = initial.mode;
      let selectedContextId: string | undefined;
      const unsubscribe = controller.subscribe(() => {
        const snapshot = controller.getSnapshot();
        if (snapshot.route.contextId && snapshot.route.contextId !== previousContextId) selectedContextId = snapshot.route.contextId;
        if (snapshot.route.resourceId === 'ctx') {
          if (snapshot.mode === 'list' && previousMode === 'list' && previousResourceId === 'ctx' && snapshot.selectedId !== previousSelectedId) selectedContextId = snapshot.selectedId;
          previousSelectedId = snapshot.selectedId;
        }
        previousContextId = snapshot.route.contextId;
        previousResourceId = snapshot.route.resourceId;
        previousMode = snapshot.mode;
      });
      let instance: ReturnType<typeof ink.render>;
      try {
        instance = ink.render(react.createElement(ui.TuiApp, { controller, registry, version, onError: owner.fail }), {
          stdin, stdout, stderr, alternateScreen: true, exitOnCtrlC: false, patchConsole: false, interactive: true,
        });
      } catch (error) {
        unsubscribe();
        controller.dispose();
        throw error;
      }
      return {
        done: instance.waitUntilExit().then(() => {}),
        interrupt: () => controller.handleKey({ name: 'c', ctrl: true }),
        dispose: async () => {
          unsubscribe();
          controller.dispose();
          try { instance.unmount(); }
          finally {
            if (selectedContextId && contexts.some((context) => context.id === selectedContextId)) {
              const saved = await saveTuiPreferences({ home, preferences: { version: 1, selectedContextId } });
              if (saved.errors.length) stderr.write('最近连接选择未能保存；请检查界面偏好文件的访问权限。\n');
            }
          }
        },
      };
    },
  });
}
