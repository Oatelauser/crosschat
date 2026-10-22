import { describe, expect, it, vi } from 'vitest';

describe('asynchronous membership machine identity source', () => {
  it('uses fixed argument vectors and preserves the existing Windows and macOS identity sources', async () => {
    const { readMembershipMachineId } = await import('../src/application/session-membership/machine.js');
    const execute = vi.fn(async (file: string) => file === 'reg'
      ? '\n    MachineGuid    REG_SZ    8F2A1B3C-4D5E-4F70-8A9B-0C1D2E3F4A5B\n'
      : '    "IOPlatformUUID" = "8F2A1B3C-4D5E-4F70-8A9B-0C1D2E3F4A5B"');
    expect(await readMembershipMachineId({ platform: 'win32', execute })).toBe('8F2A1B3C-4D5E-4F70-8A9B-0C1D2E3F4A5B');
    expect(execute).toHaveBeenLastCalledWith('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'], expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(await readMembershipMachineId({ platform: 'darwin', execute })).toBe('8F2A1B3C-4D5E-4F70-8A9B-0C1D2E3F4A5B');
    expect(execute).toHaveBeenLastCalledWith('ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'], expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it('reads only the existing Linux machine-id and never creates an identity', async () => {
    const { readMembershipMachineId } = await import('../src/application/session-membership/machine.js');
    const execute = vi.fn();
    const readText = vi.fn(async () => '  a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6\n');
    expect(await readMembershipMachineId({ platform: 'linux', execute, readText })).toBe('a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6');
    expect(readText).toHaveBeenCalledWith('/etc/machine-id', expect.any(AbortSignal));
    expect(execute).not.toHaveBeenCalled();
  });

  it('cancels a pending OS read promptly and aborts the execution owner', async () => {
    const { readMembershipMachineId } = await import('../src/application/session-membership/machine.js');
    const controller = new AbortController();
    let ownedSignal: AbortSignal | undefined;
    const pending = readMembershipMachineId({ platform: 'win32', signal: controller.signal,
      execute: async (_file, _args, options) => { ownedSignal = options.signal; return new Promise(() => undefined); } });
    controller.abort();
    expect(await pending).toBeUndefined();
    expect(ownedSignal?.aborted).toBe(true);
  });

  it('bounds an unresponsive OS read and contains native diagnostics', async () => {
    const { readMembershipMachineId } = await import('../src/application/session-membership/machine.js');
    vi.useFakeTimers();
    try {
      let ownedSignal: AbortSignal | undefined;
      const pending = readMembershipMachineId({ platform: 'darwin', timeoutMs: 20,
        execute: async (_file, _args, options) => { ownedSignal = options.signal; return new Promise(() => undefined); } });
      await vi.advanceTimersByTimeAsync(20);
      expect(await pending).toBeUndefined();
      expect(ownedSignal?.aborted).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
      expect(await readMembershipMachineId({ platform: 'win32', execute: async () => { throw new Error('fixture secret diagnostic'); } })).toBeUndefined();
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
});
