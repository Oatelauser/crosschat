// Test-only native snapshot seam. Production discovery never imports this helper.
export async function snapshotDshRuntimeRequest(ctx, originalAgents, id, request, response) {
  const controller = new globalThis.AbortController();
  const cancel = () => controller.abort(new Error('Fixture snapshot request closed'));
  const timer = globalThis.setTimeout(() => controller.abort(new Error('Fixture snapshot request timed out')), 30000);
  request.once('aborted', cancel); response.once('close', cancel);
  if (request.aborted || response.destroyed) cancel();
  try { return await snapshotDshRuntimeSession(ctx, originalAgents, id, controller.signal); }
  finally { globalThis.clearTimeout(timer); request.removeListener('aborted', cancel); response.removeListener('close', cancel); }
}

export async function snapshotDshRuntimeSession(ctx, originalAgents, id, signal = globalThis.AbortSignal.timeout(30000)) {
  signal.throwIfAborted();
  const agent = ctx.agents.get(id);
  if (!agent) throw new Error('Fixture session is not live');
  let observation;
  try {
    let header, events;
    if (typeof ctx.sessionController.inspect === 'function') {
      const inspected = await ctx.sessionController.inspect(id);
      header = inspected.meta; events = inspected.events;
    } else {
      const query = ctx.get('sessionQuery');
      if (typeof query?.observeSession !== 'function') throw new Error('Fixture native session snapshot reader is unavailable');
      observation = await query.observeSession(id, { signal, projectionMode: 'none' });
      signal.throwIfAborted();
      if (observation.source !== 'live') throw new Error('Fixture session observation is not live');
      header = observation.header; events = observation.events;
    }
    signal.throwIfAborted();
    if (header?.id !== id || !Array.isArray(events)) throw new Error('Fixture session snapshot does not match the exact native session');
    const detached = globalThis.structuredClone({ header, events });
    signal.throwIfAborted();
    if (ctx.agents.get(id) !== agent) throw new Error('Fixture native session Agent changed during snapshot');
    return { id, sameAgent: originalAgents.get(id) === agent, status: agent.status, ...detached,
      inbox: { nextTurn: agent.inbox.nextTurn, nextStep: agent.inbox.nextStep } };
  } finally {
    if (observation !== undefined) observation[Symbol.dispose]();
  }
}
