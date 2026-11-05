import type { NativeOperationProvider } from '../application/session-operations.js';
import { MultichatError } from '../errors.js';
import type { DshOptions } from './client.js';

/** C20 begins disabled until the exact native title contract is independently verified. */
export function createDshRenameAdapter(_options: DshOptions = {}): NonNullable<NativeOperationProvider['rename']> {
  return {
    contextKey: () => 'dsh-title-not-qualified',
    probe: async () => ({ state: 'needs-verification', reason: 'Harness 原生改名尚未完成目标和界面核实。' }),
    apply: async () => { throw new MultichatError('NATIVE_OPERATION_REJECTED', 'Harness 原生改名尚未核实。'); },
  };
}
