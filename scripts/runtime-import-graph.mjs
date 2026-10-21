import { readFileSync, readdirSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import ts from 'typescript';

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return ['node_modules', 'dist', '.git'].includes(entry.name) ? [] : sourceFiles(path);
    }
    return /\.[cm]?[jt]sx?$/.test(entry.name) && !/\.d\.[cm]?ts$/.test(entry.name) ? [path] : [];
  }).sort();
}

function hasRuntimeImport(node) {
  const clause = node.importClause;
  if (clause === undefined) return true;
  if (clause.isTypeOnly) return false;
  if (clause.name !== undefined || clause.namedBindings === undefined) return true;
  const bindings = clause.namedBindings;
  return ts.isNamespaceImport(bindings) || bindings.elements.length === 0 || bindings.elements.some((entry) => !entry.isTypeOnly);
}

function hasRuntimeExport(node) {
  if (node.isTypeOnly) return false;
  const clause = node.exportClause;
  return clause === undefined || ts.isNamespaceExport(clause) || clause.elements.length === 0 || clause.elements.some((entry) => !entry.isTypeOnly);
}

function moduleReferences(sourceFile) {
  const references = [];
  function visit(node) {
    if (ts.isImportDeclaration(node) && hasRuntimeImport(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      references.push({ specifier: node.moduleSpecifier.text, kind: 'import' });
    } else if (ts.isExportDeclaration(node) && hasRuntimeExport(node) && node.moduleSpecifier !== undefined && ts.isStringLiteral(node.moduleSpecifier)) {
      references.push({ specifier: node.moduleSpecifier.text, kind: 'export' });
    } else if (ts.isImportEqualsDeclaration(node) && !node.isTypeOnly && ts.isExternalModuleReference(node.moduleReference)) {
      const expression = node.moduleReference.expression;
      if (expression !== undefined && ts.isStringLiteral(expression)) references.push({ specifier: expression.text, kind: 'import' });
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const argument = node.arguments[0];
      if (argument !== undefined && (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument))) {
        references.push({ specifier: argument.text, kind: 'dynamic-import' });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return references;
}

/** Parse actual syntax and resolve local runtime edges without loading any source module. */
export function buildRuntimeImportGraph(sourceRoot) {
  const root = resolve(sourceRoot);
  const absoluteFiles = sourceFiles(root);
  const knownFiles = new Set(absoluteFiles.map((file) => resolve(file)));
  const label = (file) => relative(root, file).split(sep).join('/');
  const configFile = ts.findConfigFile(root, ts.sys.fileExists);
  let options = { module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, allowJs: true };
  if (configFile !== undefined) {
    const config = ts.readConfigFile(configFile, ts.sys.readFile);
    if (config.error !== undefined) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, resolve(configFile, '..'));
    options = { ...options, ...parsed.options };
  }
  const edges = [];
  const unresolved = [];
  const cache = ts.createModuleResolutionCache(root, (file) => file, options);
  for (const file of absoluteFiles) {
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    for (const { specifier, kind } of moduleReferences(source)) {
      const result = ts.resolveModuleName(specifier, file, options, ts.sys, cache).resolvedModule;
      if (result !== undefined && knownFiles.has(resolve(result.resolvedFileName))) {
        edges.push({ from: label(file), to: label(result.resolvedFileName), kind });
      } else if (result === undefined && (specifier.startsWith('.') || isAbsolute(specifier))) {
        unresolved.push({ from: label(file), specifier });
      }
    }
  }
  return { files: absoluteFiles.map(label), edges, unresolved };
}

function adjacency(graph) {
  const next = new Map(graph.files.map((file) => [file, new Set()]));
  for (const { from, to } of graph.edges) next.get(from)?.add(to);
  return next;
}

/** Return strongly connected components; a self import is also a runtime cycle. */
export function findRuntimeCycles(graph) {
  const next = adjacency(graph);
  const indices = new Map();
  const lows = new Map();
  const stack = [];
  const pending = new Set();
  const cycles = [];
  let index = 0;
  function visit(file) {
    indices.set(file, index);
    lows.set(file, index++);
    stack.push(file);
    pending.add(file);
    for (const dependency of next.get(file) ?? []) {
      if (!indices.has(dependency)) {
        visit(dependency);
        lows.set(file, Math.min(lows.get(file), lows.get(dependency)));
      } else if (pending.has(dependency)) {
        lows.set(file, Math.min(lows.get(file), indices.get(dependency)));
      }
    }
    if (lows.get(file) !== indices.get(file)) return;
    const component = [];
    let member;
    do {
      member = stack.pop();
      pending.delete(member);
      component.push(member);
    } while (member !== file);
    if (component.length > 1 || next.get(file)?.has(file)) cycles.push(component.sort());
  }
  for (const file of graph.files) if (!indices.has(file)) visit(file);
  return cycles.sort((a, b) => a[0].localeCompare(b[0]));
}

/** Report the shortest runtime path from a protected module to a forbidden dependency. */
export function findForbiddenDependencies(graph, rules) {
  const next = adjacency(graph);
  const violations = [];
  for (const { from, forbidden } of rules) {
    const seen = new Set([from]);
    const queue = [[from]];
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const path = queue[cursor];
      for (const to of next.get(path.at(-1)) ?? []) {
        if (seen.has(to)) continue;
        seen.add(to);
        const dependencyPath = [...path, to];
        if (forbidden.some((prefix) => prefix.endsWith('/') ? to.startsWith(prefix) : to === prefix)) {
          violations.push({ from, to, path: dependencyPath });
        }
        queue.push(dependencyPath);
      }
    }
  }
  return violations.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
}

export const coreModuleRules = [
  { from: 'serve/node-config.ts', forbidden: ['commands/', 'serve/node.ts', 'tui/'] },
  { from: 'serve/connect-selector.ts', forbidden: ['commands/', 'serve/node.ts', 'tui/'] },
];

/** New application adapters inherit the dependency boundary without a manual allowlist. */
export function coreRulesFor(graph) {
  return [
    ...coreModuleRules,
    ...graph.files.filter((file) => file.startsWith('application/')).map((from) => ({ from, forbidden: ['commands/', 'tui/'] })),
  ];
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const graph = buildRuntimeImportGraph(process.argv[2] ?? 'src');
  const cycles = findRuntimeCycles(graph);
  const violations = findForbiddenDependencies(graph, coreRulesFor(graph));
  for (const cycle of cycles) console.error(`Runtime dependency cycle: ${cycle.join(', ')}`);
  for (const edge of graph.unresolved) console.error(`Unresolved runtime import: ${edge.from} -> ${edge.specifier}`);
  for (const violation of violations) console.error(`Forbidden runtime dependency: ${violation.path.join(' -> ')}`);
  if (cycles.length + graph.unresolved.length + violations.length > 0) process.exitCode = 1;
  else console.log(`Runtime import graph: ${graph.files.length} modules, ${graph.edges.length} edges; no cycles or boundary violations.`);
}
