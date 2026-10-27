export type SessionSelectionEvent = { kind: 'selected' | 'empty'; sessionId: string; name?: string };
export interface SessionSelectionLease { close(): Promise<void> }
export interface LauncherSessionBinding { args: readonly string[]; env?: NodeJS.ProcessEnv; close(): Promise<void> }
type Start = (selection: SessionSelectionEvent, signal: AbortSignal) => Promise<SessionSelectionLease>;

/** One window's desired native selection. Late starts are released, never adopted as current. */
export function createSessionSelectionFollower(start: Start, onError: (error: unknown) => void = () => undefined) {
  let generation = 0;
  let closed = false;
  let selected: SessionSelectionEvent | undefined;
  let controller: AbortController | undefined;
  let active: SessionSelectionLease | undefined;
  let work = Promise.resolve();
  return {
    select(event: SessionSelectionEvent): void {
      if (closed || !event.sessionId || (selected?.kind === event.kind && selected.sessionId === event.sessionId)) return;
      selected = { ...event };
      controller?.abort();
      const turn = ++generation;
      work = work.then(async () => {
        const previous = active; active = undefined;
        await previous?.close();
        if (closed || turn !== generation || event.kind === 'empty') return;
        const owned = new AbortController(); controller = owned;
        const next = await start(event, owned.signal);
        if (closed || turn !== generation || owned.signal.aborted) await next.close();
        else active = next;
      }).catch(onError);
    },
    idle: (): Promise<void> => work,
    async close(): Promise<void> {
      if (closed) return work;
      closed = true; generation++; controller?.abort();
      await work;
      const previous = active; active = undefined; await previous?.close();
    },
  };
}
