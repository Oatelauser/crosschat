// Test-only control plane. Production discovery and crosschat delivery never use these routes.
import { createServer } from 'node:http';
import { writeFile } from 'node:fs/promises';
import process from 'node:process';
import { setImmediate } from 'node:timers';
import { getDshRuntimeVersion } from '@deepseek-ai/dsh-app-boot';
import { snapshotDshRuntimeRequest } from './dsh-runtime-snapshot.mjs';

export const name = 'crosschat-dsh-test-driver';
export const inject = ['agents', 'sessionController', 'webServer', 'pluginManager'];

export async function apply(ctx, config) {
  const version = getDshRuntimeVersion();
  let registeredWorkspace;
  // UI qualification starts from an explicitly owned existing directory. This
  // fixture setup uses the public registry; it neither opens a native picker nor
  // creates/restores an Agent on behalf of the operation under test.
  if (config.registerWorkspace === true) {
    const registry = ctx.get('workspaceRegistry');
    if (typeof registry?.create !== 'function') throw new Error('Native workspace registry is unavailable');
    const workspace = await registry.create(config.workspace);
    registeredWorkspace = { id: workspace.id, path: workspace.path };
  }
  const originalAgents = new Map();
  const send = (response, value, status = 200) => { response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify(value)); };
  const snapshot = (id, request, response) => snapshotDshRuntimeRequest(ctx, originalAgents, id, request, response);
  const server = createServer((request, response) => {
    void (async () => {
      if (request.headers.authorization !== `Bearer ${config.token}` || request.headers.origin !== undefined) { send(response, { error: 'AUTH_REQUIRED' }, 401); request.resume(); return; }
      let body = {};
      if (request.method === 'POST') {
        let text = '';
        for await (const chunk of request) { text += chunk; if (text.length > 64 * 1024) { send(response, { error: 'TOO_LARGE' }, 413); return; } }
        body = JSON.parse(text);
      }
      const path = request.url ?? '';
      if (request.method === 'GET' && path === '/health') return send(response, { schema: 1, pid: process.pid, version, webPort: ctx.webServer.port,
        ...(registeredWorkspace === undefined ? {} : { registeredWorkspace }) });
      if (request.method === 'POST' && path === '/shutdown') { send(response, { accepted: true }); setImmediate(() => process.emit('SIGTERM')); return; }
      if (request.method === 'POST' && path === '/bridge') {
        if (body === null || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 || typeof body.enabled !== 'boolean') return send(response, { error: 'INVALID_BRIDGE_TOGGLE' }, 400);
        const result = await ctx.pluginManager.setBundleEnabled('@crosschat/dsh-bridge', body.enabled);
        return send(response, { result, pid: process.pid });
      }
      if (request.method === 'POST' && path === '/sessions') {
        const created = await ctx.sessionController.create(registeredWorkspace === undefined
          ? { cwd: config.workspace } : { workspaceId: registeredWorkspace.id });
        originalAgents.set(created.sessionId, ctx.agents.get(created.sessionId));
        await ctx.sessionController.rename({ sessionId: created.sessionId, title: body.title });
        await ctx.sessionController.selectModel({ sessionId: created.sessionId, provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'off' });
        return send(response, { id: created.sessionId, title: body.title });
      }
      const match = /^\/sessions\/([^/]+)(\/(?:prompt|idle))?$/.exec(path);
      if (!match) return send(response, { error: 'NOT_FOUND' }, 404);
      const id = decodeURIComponent(match[1]);
      if (request.method === 'GET' && !match[2]) return send(response, await snapshot(id, request, response));
      if (request.method === 'POST' && match[2] === '/prompt') return send(response, await ctx.sessionController.prompt({ sessionId: id, requestId: body.requestId, mode: 'queue', content: [{ type: 'text', text: body.text }] }, new globalThis.AbortController().signal));
      if (request.method === 'POST' && match[2] === '/idle') { const agent = ctx.agents.get(id); if (!agent) throw new Error('Fixture agent disappeared'); await agent.whenIdle(); return send(response, await snapshot(id, request, response)); }
      return send(response, { error: 'NOT_FOUND' }, 404);
    })().catch((error) => { if (!response.headersSent && !response.destroyed) send(response, { error: error instanceof Error ? error.message : String(error) }, 500); });
  });
  let closing;
  const close = () => closing ??= new Promise((done) => { server.close(done); server.closeAllConnections(); });
  ctx.effect(() => close);
  await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('DSH fixture driver did not bind TCP');
  await writeFile(config.path, JSON.stringify({ schema: 1, pid: process.pid, version, token: config.token, url: `http://127.0.0.1:${address.port}` }), { flag: 'wx', mode: 0o600 });
}
