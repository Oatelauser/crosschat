import { createConnection } from 'node:net';
import { describe, expect, it, vi } from 'vitest';
import { createClaudeSessionBinding } from '../src/claude/session-events.js';
import type { SessionSelectionEvent } from '../src/application/session-selection.js';

describe('Claude window session event binding', () => {
  it('rechecks a temporarily unreadable owner and ignores late hooks from the previous selection', async () => {
    vi.useFakeTimers();
    const events: SessionSelectionEvent[] = [];
    let current = 'A';
    let unreadable = true;
    const binding = await createClaudeSessionBinding({ args: [], onSelection: (event) => events.push(event),
      currentSessionId: () => { if (unreadable) throw new Error('registry temporarily unavailable'); return current; } });
    const send = (input: unknown) => new Promise<void>((resolve, reject) => {
      const socket = createConnection(binding.path, () => socket.end(JSON.stringify({ token: binding.token, input }) + '\n'));
      socket.on('error', reject); socket.on('close', () => resolve());
    });
    try {
      await send({ hook_event_name: 'UserPromptSubmit', session_id: 'A' });
      expect(events).toEqual([]);
      unreadable = false;
      await vi.advanceTimersByTimeAsync(30);
      expect(events).toEqual([{ kind: 'selected', sessionId: 'A' }]);
      current = 'B';
      await send({ hook_event_name: 'SessionStart', source: 'resume', session_id: 'B' });
      await send({ hook_event_name: 'UserPromptSubmit', session_id: 'A' });
      await send({ hook_event_name: 'SessionStart', source: 'startup', session_id: 'A' });
      await vi.advanceTimersByTimeAsync(700);
      expect(events).toEqual([{ kind: 'selected', sessionId: 'A' }, { kind: 'selected', sessionId: 'B' }]);
    } finally { await binding.close(); vi.useRealTimers(); }
  });

  it('keeps blank startup unregistered, resumes exact IDs, ignores end/compact and never persists prompt content', async () => {
    const events: SessionSelectionEvent[] = [];
    const binding = await createClaudeSessionBinding({ args: [], onSelection: (event) => events.push(event) });
    const send = (input: unknown) => new Promise<void>((resolve, reject) => {
      const socket = createConnection(binding.path, () => socket.end(JSON.stringify({ token: binding.token, input }) + '\n'));
      socket.on('error', reject); socket.on('close', () => resolve());
    });
    try {
      await send({ hook_event_name: 'SessionStart', source: 'startup', session_id: 'new-a' });
      expect(events).toEqual([{ kind: 'empty', sessionId: 'new-a' }]);
      await send({ hook_event_name: 'UserPromptSubmit', session_id: 'new-a', session_title: 'A', prompt: 'must not be retained' });
      await send({ hook_event_name: 'SessionEnd', reason: 'resume', session_id: 'new-a' });
      await send({ hook_event_name: 'SessionStart', source: 'resume', session_id: 'existing-b' });
      await send({ hook_event_name: 'SessionStart', source: 'compact', session_id: 'existing-b' });
      expect(events.slice(1)).toEqual([{ kind: 'selected', sessionId: 'new-a', name: 'A' }, { kind: 'selected', sessionId: 'existing-b' }]);
      expect(JSON.stringify(events)).not.toContain('must not be retained');
    } finally { await binding.close(); }
  });
});
