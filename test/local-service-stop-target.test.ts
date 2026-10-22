import { describe, expect, it, vi } from 'vitest';
import { stopServices } from '../src/application/services/local.js';

describe('fixed service stop target', () => {
  it('rejects a replacement process during the same scan before sending any termination signal', () => {
    const killPid = vi.fn(() => true);
    const result = stopServices({ selector: 'fixture', expectedPids: [1234] }, {
      baseDir: '/isolated-not-read', listServeProcesses: () => [{ pid: 5678, cmdline: 'node /isolated/dist/cli.js serve --connect fixture' }], killPid,
    });
    expect(result).toMatchObject({ state: 'failed', error: expect.stringMatching(/变化|目标/) });
    expect(killPid).not.toHaveBeenCalled();
  });

  it('refuses a broadened selector group before killing either the selected or added process', () => {
    const killPid = vi.fn(() => true);
    expect(stopServices({ selector: 'fixture', expectedPids: [1234] }, {
      baseDir: '/isolated-not-read', listServeProcesses: () => [1234, 5678].map((pid) => ({ pid, cmdline: 'node /isolated/dist/cli.js serve --connect fixture' })), killPid,
    })).toMatchObject({ state: 'failed' });
    expect(killPid).not.toHaveBeenCalled();
  });

  it('preserves the old selector behavior when no fixed PID expectation is supplied', () => {
    const killPid = vi.fn(() => true);
    expect(stopServices({ selector: 'fixture' }, {
      baseDir: '/isolated-not-read', listServeProcesses: () => [{ pid: 5678, cmdline: 'node /isolated/dist/cli.js serve --connect fixture' }], killPid,
    })).toMatchObject({ state: 'ready', events: [{ kind: 'terminated', pid: 5678 }] });
    expect(killPid).toHaveBeenCalledWith(5678);
  });
});
