import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildRuntimeImportGraph,
  findForbiddenDependencies,
  findRuntimeCycles,
} from '../scripts/runtime-import-graph.mjs';

const roots: string[] = [];

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'crosschat-import-graph-'));
  roots.push(root);
  for (const [name, source] of Object.entries(files)) {
    const path = join(root, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, source);
  }
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('runtime import graph', () => {
  it('uses syntax nodes for runtime imports, re-exports and literal dynamic imports', () => {
    const root = fixture({
      'entry.ts': [
        '// import { ignored } from "./comment.js";',
        'const text = "export * from \\\"./text.js\\\"";',
        'import "./side-effect.js";',
        'import value, { type Shape } from "./value.js";',
        'export { value } from "./re-export.js";',
        'export * from "./star-export.js";',
        'const a = import("./dynamic.js");',
        'const b = import(`./template.js`);',
        'const c = import(`./${text}.js`);',
      ].join('\n'),
      'side-effect.ts': '',
      'value.ts': '',
      're-export.ts': '',
      'star-export.ts': '',
      'dynamic.ts': '',
      'template.ts': '',
      'comment.ts': '',
      'text.ts': '',
    });
    const graph = buildRuntimeImportGraph(root);
    expect(graph.edges.filter((edge) => edge.from === 'entry.ts')).toEqual([
      { from: 'entry.ts', to: 'side-effect.ts', kind: 'import' },
      { from: 'entry.ts', to: 'value.ts', kind: 'import' },
      { from: 'entry.ts', to: 're-export.ts', kind: 'export' },
      { from: 'entry.ts', to: 'star-export.ts', kind: 'export' },
      { from: 'entry.ts', to: 'dynamic.ts', kind: 'dynamic-import' },
      { from: 'entry.ts', to: 'template.ts', kind: 'dynamic-import' },
    ]);
    expect(graph.unresolved).toEqual([]);
  });

  it('excludes declaration and specifier type-only dependencies, including import types', () => {
    const root = fixture({
      'a.ts': [
        'import type { B } from "./b.js";',
        'import { type B as OtherB } from "./b.js";',
        'export type { B } from "./b.js";',
        'export { type B } from "./b.js";',
        'export type * from "./b.js";',
        'type LazyB = import("./b.js").B;',
        'export interface A {}',
      ].join('\n'),
      'b.ts': 'import { A } from "./a.js"; export interface B {}',
    });
    const graph = buildRuntimeImportGraph(root);
    expect(graph.edges).toEqual([{ from: 'b.ts', to: 'a.ts', kind: 'import' }]);
    expect(findRuntimeCycles(graph)).toEqual([]);
  });

  it('reports independent cycles including re-export, dynamic and self edges', () => {
    const root = fixture({
      'a.ts': 'export * from "./b.js";',
      'b.ts': 'void import("./a.js");',
      'self.ts': 'import "./self.js";',
      'leaf.ts': 'import "node:fs"; import "ws";',
    });
    expect(findRuntimeCycles(buildRuntimeImportGraph(root))).toEqual([
      ['a.ts', 'b.ts'],
      ['self.ts'],
    ]);
  });

  it('resolves TypeScript modules and directory indexes and reports broken local edges', () => {
    const root = fixture({
      'a.ts': 'import "./nested"; export * from "./modern.mjs"; import "./missing.js";',
      'nested/index.ts': '',
      'modern.mts': '',
    });
    const graph = buildRuntimeImportGraph(root);
    expect(graph.edges.map((edge) => edge.to)).toEqual(['nested/index.ts', 'modern.mts']);
    expect(graph.unresolved).toEqual([{ from: 'a.ts', specifier: './missing.js' }]);
  });

  it('enforces module boundaries transitively while allowing legal type-only imports', () => {
    const root = fixture({
      'core/config.ts': 'export * from "../shared.js"; import type { View } from "../ui/view.js";',
      'shared.ts': 'void import("./commands/serve.js");',
      'commands/serve.ts': '',
      'ui/view.ts': 'export interface View {}',
      'core/selector.ts': 'import type { View } from "../ui/view.js";',
    });
    expect(findForbiddenDependencies(buildRuntimeImportGraph(root), [
      { from: 'core/config.ts', forbidden: ['commands/', 'ui/'] },
      { from: 'core/selector.ts', forbidden: ['commands/', 'ui/'] },
    ])).toEqual([
      { from: 'core/config.ts', to: 'commands/serve.ts', path: ['core/config.ts', 'shared.ts', 'commands/serve.ts'] },
    ]);
  });
});

describe('core source architecture', () => {
  const sourceRoot = fileURLToPath(new URL('../src', import.meta.url));

  it('has no runtime dependency cycle or broken local import', () => {
    const graph = buildRuntimeImportGraph(sourceRoot);
    expect(graph.unresolved).toEqual([]);
    expect(findRuntimeCycles(graph)).toEqual([]);
  });

  it('keeps node configuration and connection selection independent of commands and clients', () => {
    const graph = buildRuntimeImportGraph(sourceRoot);
    expect(graph.files).toContain('serve/node-config.ts');
    expect(graph.files).toContain('serve/connect-selector.ts');
    expect(findForbiddenDependencies(graph, [
      { from: 'serve/node-config.ts', forbidden: ['commands/', 'serve/node.ts', 'tui/'] },
      { from: 'serve/connect-selector.ts', forbidden: ['commands/', 'serve/node.ts', 'tui/'] },
    ])).toEqual([]);
  });
});
