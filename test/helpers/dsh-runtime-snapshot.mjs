// Test-only native snapshot seam. Production discovery never imports this helper.
export async function snapshotDshRuntimeSession(ctx, originalAgents, id) {
  const agent = ctx.agents.get(id);
  if (!agent) throw new Error('Fixture session is not live');
  const inspected = await ctx.sessionController.inspect(id);
  return { id, sameAgent: originalAgents.get(id) === agent, status: agent.status, header: inspected.meta, events: inspected.events,
    inbox: { nextTurn: agent.inbox.nextTurn, nextStep: agent.inbox.nextStep } };
}
