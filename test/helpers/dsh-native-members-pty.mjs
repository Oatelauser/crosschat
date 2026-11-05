// Production TCP resources and real Ink keyboard handling; effects use the owned native broker/node.
import assert from 'node:assert/strict';
import { appendFile, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import process from 'node:process';
import { createElement } from 'react';
import { render, Text } from 'ink';
import { createTcpApplication } from '../../dist/application/tcp/index.js';
import { createTcpManagement } from '../../dist/application/tcp/management.js';
import { createLocalDiscoveryService } from '../../dist/application/discovery/local.js';
import { runTui } from '../../dist/tui/main.js';
import { createTcpResources } from '../../dist/tui/resources/tcp.js';
import { createResourceRegistry, defaultResources } from '../../dist/tui/resources/registry.js';

const [root, input, events] = process.argv.slice(2), config = JSON.parse(await readFile(input, 'utf8'));
assert.equal(await realpath(root), root); assert.equal(await readFile(join(root, '.fixture-owner'), 'utf8'), config.owner);
if (config.contexts !== undefined) assert(config.task === 'c22-dsh-terminal' && Array.isArray(config.contexts) && config.contexts.length === 1
  && config.contexts.every(context => context.kind === 'tcp' && typeof context.id === 'string' && context.id.startsWith('tcp:star:') && typeof context.label === 'string'));
for (const path of [input, events, config.home]) {
  const inside = relative(root, await realpath(path).catch((error) => error.code === 'ENOENT' ? resolve(path) : Promise.reject(error)));
  assert(inside && inside !== '..' && !inside.startsWith('../') && !inside.startsWith('..\\') && !isAbsolute(inside));
}
const record = (value) => appendFile(events, JSON.stringify(value) + '\n');
const snapshot = () => ({ raw: process.stdin.isRaw === true, resize: process.stdout.listenerCount('resize'),
  listeners: Object.fromEntries(['SIGINT', 'SIGTERM', 'uncaughtException', 'unhandledRejection'].map((name) => [name, process.listenerCount(name)])) });
const baseDir = join(config.home, '.crosschat'), tcp = createTcpApplication({ baseDir });
const resources = createTcpResources({ tcp, management: createTcpManagement({ baseDir, catalog: tcp, discovery: createLocalDiscoveryService({ home: config.home }) }) });
const bindings = new Map(Object.values(resources).map((binding) => [binding.resource.id, binding]));
for (const binding of bindings.values()) {
  const read = binding.adapter.read, check = binding.adapter.checkAction, mutate = binding.adapter.mutate, describe = binding.adapter.describeActions;
  binding.adapter.read = async (request) => { const page = await read(request); await record({ event: 'read', resource: binding.resource.id, page }); return page; };
  if (check) binding.adapter.checkAction = async (request) => {
    const result = await check(request); await record({ event: 'preview', action: request.action.id, result }); return result;
  };
  if (describe) binding.adapter.describeActions = async (request) => {
    const result = await describe(request); await record({ event: 'availability', result }); return result;
  };
  if (mutate) binding.adapter.mutate = async (request) => {
    const result = await mutate(request); await record({ event: 'mutation', action: request.action.id, result }); return result;
  };
}
const warmup = render(createElement(Text, null, 'C18 native terminal baseline'), { interactive: true, patchConsole: false, exitOnCtrlC: false });
await warmup.waitUntilRenderFlush(); warmup.unmount(); await warmup.waitUntilExit();
const before = snapshot();
const code = await runTui({ home: config.home, contexts: config.contexts ?? [{ id: 'local', kind: 'local', label: 'C18-NATIVE-MEMBERS' }],
  registry: createResourceRegistry(defaultResources.map((resource) => bindings.get(resource.id)?.resource ?? resource)),
  adapters: Object.fromEntries([...bindings].map(([id, binding]) => [id, binding.adapter])), clipboard: async (value) => record({ event: 'clipboard', value }) });
await record({ event: 'exit', code, before, after: snapshot() }); process.exitCode = code;
