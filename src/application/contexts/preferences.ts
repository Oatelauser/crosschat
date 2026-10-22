import { randomUUID } from 'node:crypto';
import { mkdir, open, rename, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { checkAbort, isRecord, queryError, readParsed } from '../queries/reading.js';
import type { QueryOptions, ReadResult, TextOptions } from '../queries/reading.js';

export interface TuiPreferences {
  version: 1;
  selectedContextId?: string;
}

export interface TuiPreferencesOptions extends TextOptions {
  home?: string;
}

export interface SaveTuiPreferencesOptions extends QueryOptions {
  home?: string;
  /** Validate as an external boundary and persist only the preference allowlist. */
  preferences: unknown;
  /** Atomic replacement seam for isolated filesystem failures. */
  renameFile?: (from: string, to: string) => Promise<void>;
}

function parsePreferences(input: unknown): TuiPreferences {
  if (!isRecord(input) || input.version !== 1) throw new Error('Invalid preference version');
  if (input.selectedContextId !== undefined && (typeof input.selectedContextId !== 'string' || input.selectedContextId === '')) {
    throw new Error('Invalid context selection');
  }
  return { version: 1, ...(typeof input.selectedContextId === 'string' ? { selectedContextId: input.selectedContextId } : {}) };
}

function preferencesFile(home?: string): string {
  return join(home ?? homedir(), '.crosschat', 'tui.json');
}

/** Loading preferences is read-only, including for malformed or unknown-version files. */
export async function loadTuiPreferences(options: TuiPreferencesOptions = {}): Promise<ReadResult<TuiPreferences>> {
  const result = await readParsed(preferencesFile(options.home), (raw) => {
    const parsed: unknown = JSON.parse(raw);
    return parsePreferences(parsed);
  }, options);
  return { ...result, value: result.value ?? { version: 1 }, errors: result.errors.filter((error) => error.kind !== 'missing') };
}

/** Only an explicit user selection calls this writer; discovery never calls it. */
export async function saveTuiPreferences(options: SaveTuiPreferencesOptions): Promise<ReadResult<TuiPreferences>> {
  const file = preferencesFile(options.home);
  const observedAt = (options.now ?? Date.now)();
  let preferences: TuiPreferences;
  try {
    checkAbort(options.signal);
    preferences = parsePreferences(options.preferences);
  } catch (error) {
    const issue = queryError(file, error, true);
    return { state: issue.kind, value: null, errors: [issue], observedAt };
  }

  const temporary = join(dirname(file), `.tui.${randomUUID()}.tmp`);
  let temporaryOwned = false;
  try {
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    checkAbort(options.signal);
    const handle = await open(temporary, 'wx', 0o600);
    temporaryOwned = true;
    try {
      await handle.writeFile(`${JSON.stringify(preferences, null, 2)}\n`, 'utf8');
    } finally {
      await handle.close();
    }
    checkAbort(options.signal);
    // Once replacement starts, cancellation cannot claim that the save was rolled back.
    await (options.renameFile ?? rename)(temporary, file);
    temporaryOwned = false;
    return { state: 'ready', value: preferences, errors: [], observedAt };
  } catch (error) {
    const issue = queryError(file, error);
    return { state: issue.kind, value: null, errors: [issue], observedAt };
  } finally {
    if (temporaryOwned) await rm(temporary, { force: true }).catch(() => {});
  }
}
