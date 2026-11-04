/** A real incoming hint supplies the recipient type; the fixture never invents it. */
export function replySendArgs(input, { tool, requestBody, body }) {
  if (typeof input !== 'string' || typeof requestBody !== 'string' || !requestBody
    || typeof body !== 'string' || !['claude', 'opencode', 'dsh', 'dsh-desktop'].includes(tool)) throw new Error('Invalid owned reply scenario');
  const targets = new Map();
  for (const [raw] of input.matchAll(/<cross-session-message\b[^>]*>[\s\S]*?<\/cross-session-message>/g)) {
    if (!raw.includes(requestBody)) continue;
    // Some model clients serialize structured text blocks as JSON strings.
    const envelope = raw.replaceAll('\\"', '"');
    const source = envelope.match(/^<cross-session-message\b[^>]*\bfrom-tool="([a-z][a-z0-9-]*)"/)?.[1];
    if (source !== tool) throw new Error('The incoming source tool is unverified or differs from the owned sender');
    for (const [, hint] of envelope.matchAll(/<crosschat-reply-hint\b[^>]*>([\s\S]*?)<\/crosschat-reply-hint>/g)) {
      const command = /crosschat send --conversation (mc[12]_[A-Za-z0-9_-]+|c[A-Z][0-9]{3}) --tool ([a-z][a-z0-9-]*) --body\b/.exec(hint);
      if (!command) throw new Error('The incoming reply hint has no complete explicit recipient command');
      const [, reference, recipientTool] = command;
      if (recipientTool !== tool) throw new Error('The reply hint selects a different recipient tool');
      targets.set(`${reference}:${recipientTool}`, { reference, recipientTool });
    }
  }
  if (targets.size !== 1) throw new Error('The owned incoming reply hint is missing or ambiguous');
  const { reference, recipientTool } = targets.values().next().value;
  return ['send', '--conversation', reference, '--tool', recipientTool, '--body', body, '--json'];
}
