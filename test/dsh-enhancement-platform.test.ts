import { Buffer } from 'node:buffer';
import process from 'node:process';
import { describe, expect, it } from 'vitest';
import { attachPipePath } from '../src/serve/node.js';
import { buildC22AttachLabel, buildC22AttachPath, assertC22AttachPath } from './helpers/dsh-enhancement-platform.mjs';

const owner = 'c61a9473-e382-48c9-bd98-e00dc867c9af';
const machines = ['1'.repeat(32), '2'.repeat(32)];
const stars = ['c22-alpha', 'c22-beta'];

describe('C22 owned attach namespaces', () => {
  it('keeps four real production endpoints distinct on every planned OS', () => {
      for (const platform of ['win32', 'linux', 'darwin']) {
        const base = platform === 'win32' ? 'C:\\c22\\tcp' : '/private/tmp/c22/run/profile/.crosschat/tcp';
        const paths = machines.flatMap(machine => stars.map(starId => {
          const label = buildC22AttachLabel(owner, machine, starId);
          const path = buildC22AttachPath(platform, base, label);
          if (platform === process.platform) expect(path).toBe(attachPipePath(
            { host: '127.0.0.1', port: 7260, key: 'fixture', starId }, base, label));
          return path;
        }));
        expect(new Set(paths).size).toBe(4);
        for (const path of paths) {
          expect(() => assertC22AttachPath(path, platform)).not.toThrow();
          if (platform === 'win32') expect(path.startsWith('\\\\.\\pipe\\crosschat-attach-')).toBe(true);
          else { expect(path.startsWith(base + '/')).toBe(true); expect(Buffer.byteLength(path)).toBeLessThanOrEqual(103); }
        }
      }
  });
  it('binds all three ownership axes without delimiter ambiguity', () => {
    const base = buildC22AttachLabel(owner, machines[0], stars[0]);
    expect(base).toBe(buildC22AttachLabel(owner, machines[0], stars[0]));
    expect(new Set([base, buildC22AttachLabel('another-run', machines[0], stars[0]),
      buildC22AttachLabel(owner, machines[1], stars[0]), buildC22AttachLabel(owner, machines[0], stars[1]),
      buildC22AttachLabel('a-b', 'c', 'd'), buildC22AttachLabel('a', 'b-c', 'd')]).size).toBe(6);
    for (const label of [base, buildC22AttachLabel('run/'.repeat(100), machines[0], '星'.repeat(100))]) {
      expect(label).toMatch(/^[a-z0-9-]+$/u); expect(Buffer.byteLength(label)).toBeLessThanOrEqual(32);
    }
  });
  it('rejects unsafe endpoint budgets and unplanned platforms', () => {
    expect(() => assertC22AttachPath('/tmp/' + 'x'.repeat(99), 'darwin')).toThrow();
    expect(() => assertC22AttachPath('/tmp/' + '星'.repeat(34), 'linux')).toThrow();
    expect(() => assertC22AttachPath('relative.sock', 'darwin')).toThrow();
    expect(() => assertC22AttachPath('/tmp/a.sock', 'freebsd')).toThrow();
    expect(() => assertC22AttachPath('/tmp/a.sock', 'win32')).toThrow();
  });
});
