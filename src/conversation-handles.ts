/** The finite machine-local namespace: 26 generations of 1000 ring slots. */
export const CONVERSATION_HANDLE_RE = /^c[A-Z]\d{3}$/;
export const LEGACY_CONVERSATION_HANDLE_RE = /^c\d+$/;
export const HANDLE_RING_SLOTS = 1000;
export const HANDLE_SEQUENCE_LIMIT = 26 * HANDLE_RING_SLOTS;

export interface HandleProgress {
  handles?: Record<string, string>;
  handleSequence?: number;
}

export function isHandleSequence(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= HANDLE_SEQUENCE_LIMIT;
}

/** Sequence numbers start at one; the first public handle is cA000. */
export function handleForSequence(sequence: number): string {
  if (!isHandleSequence(sequence)) throw new Error('Conversation handle sequence is outside the finite ring.');
  const offset = sequence - 1;
  return `c${String.fromCharCode(65 + Math.floor(offset / HANDLE_RING_SLOTS))}${String(offset % HANDLE_RING_SLOTS).padStart(3, '0')}`;
}

export function sequenceForHandle(handle: string): number | undefined {
  if (!CONVERSATION_HANDLE_RE.test(handle)) return undefined;
  return (handle.charCodeAt(1) - 65) * HANDLE_RING_SLOTS + Number(handle.slice(2)) + 1;
}

export function highestHandleSequence(records: Iterable<HandleProgress>): number {
  let highest = 0;
  for (const record of records) highest = Math.max(highest, record.handleSequence ?? 0);
  return highest;
}

export function isCurrentHandle(handle: string, highest: number): boolean {
  const sequence = sequenceForHandle(handle);
  return sequence !== undefined && sequence <= highest && sequence > highest - HANDLE_RING_SLOTS;
}
