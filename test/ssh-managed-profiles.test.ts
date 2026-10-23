import { link, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createSshApplication } from '../src/application/ssh/index.js';
import { listTuiContexts } from '../src/application/contexts/index.js';

const homes: string[] = [];
async function fixture() {
  const home = await mkdtemp(join(tmpdir(), 'crosschat-managed-ssh-'));
  homes.push(home);
  await mkdir(join(home, '.ssh'));
  await writeFile(join(home, '.ssh', 'config'), 'Host external\n  HostName external.example\n  User existing\n');
  return { home, external: join(home, '.ssh', 'config'), managed: join(home, '.crosschat', 'ssh-connections.json') };
}
afterEach(async () => { await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true }))); });

describe('TUI-owned SSH connection profiles', () => {
  it('adds a managed target without rewriting external SSH Host configuration or persisting credentials', async () => {
    const { home, external, managed } = await fixture();
    const before = await readFile(external, 'utf8');
    const application = createSshApplication({ home });
    const request = { operation: 'create' as const, profile: { name: '开发机', host: '10.0.0.8', user: 'dev', port: 2222, keyFile: '/keys/dev key' } };
    const preview = await application.configuration.preview(request);
    expect(preview).toMatchObject({ enabled: true, revision: 'missing' });
    const result = await application.configuration.apply({ ...request, expectedRevision: preview.revision });
    expect(result).toMatchObject({ status: 'applied', contextId: expect.stringMatching(/^ssh:profile:/) });
    const contexts = await listTuiContexts({ home });
    expect(contexts.items.find((item) => item.id === result.contextId)).toMatchObject({ name: '开发机', kind: 'ssh', attributes: { managed: true, host: '10.0.0.8', user: 'dev', port: 2222 } });
    expect(contexts.items.find((item) => item.id === 'ssh:external')?.attributes.managed).not.toBe(true);
    expect(await readFile(external, 'utf8')).toBe(before);
    expect(JSON.parse(await readFile(managed, 'utf8'))).toMatchObject({ version: 1, profiles: [{ name: '开发机', host: '10.0.0.8', user: 'dev', port: 2222 }] });
  });

  it('edits and deletes only managed profiles using the version confirmed by the user', async () => {
    const { home, external } = await fixture();
    const application = createSshApplication({ home });
    const create = { operation: 'create' as const, profile: { name: 'one', host: 'one.example', port: 22 } };
    const first = await application.configuration.apply({ ...create, expectedRevision: (await application.configuration.preview(create)).revision });
    const edit = { operation: 'update' as const, contextId: first.contextId, profile: { name: 'renamed', host: 'two.example', port: 2200, user: 'another' } };
    const planned = await application.configuration.preview(edit);
    expect(planned.enabled).toBe(true);
    expect(await application.configuration.apply({ ...edit, expectedRevision: planned.revision })).toMatchObject({ status: 'applied', contextId: first.contextId });
    expect((await application.list()).items.find((item) => item.id === first.contextId)).toMatchObject({ name: 'renamed', attributes: { host: 'two.example', port: 2200, user: 'another' } });
    const remove = { operation: 'delete' as const, contextId: first.contextId };
    expect(await application.configuration.apply({ ...remove, expectedRevision: (await application.configuration.preview(remove)).revision })).toMatchObject({ status: 'applied' });
    expect((await application.list()).items.map((item) => item.id)).toEqual(['ssh:external']);
    expect(await application.configuration.preview({ operation: 'delete', contextId: 'ssh:external' })).toMatchObject({ enabled: false, reason: expect.stringMatching(/外部|只读/) });
    expect(await readFile(external, 'utf8')).toContain('Host external');
  });

  it('rejects a stale confirmation after another connection was added and preserves both saved versions', async () => {
    const { home } = await fixture();
    const application = createSshApplication({ home });
    const first = { operation: 'create' as const, profile: { name: 'one', host: 'one.example', port: 22 } };
    const preview = await application.configuration.preview(first);
    const second = { operation: 'create' as const, profile: { name: 'two', host: 'two.example', port: 22 } };
    expect(await application.configuration.apply({ ...second, expectedRevision: preview.revision })).toMatchObject({ status: 'applied' });
    expect(await application.configuration.apply({ ...first, expectedRevision: preview.revision })).toMatchObject({ status: 'changed' });
    expect((await application.list()).items.filter((item) => item.attributes.managed).map((item) => item.name)).toEqual(['two']);
  });

  it('rejects control characters, SSH option injection, invalid ports and secret-bearing profile fields before writing', async () => {
    const { home } = await fixture();
    const application = createSshApplication({ home });
    for (const profile of [
      { name: 'bad', host: '-oProxyCommand=bad', port: 22 },
      { name: 'bad', host: 'host\nProxyCommand bad', port: 22 },
      { name: 'bad', host: 'example', port: 0 },
      { name: 'bad', host: 'example', port: 65536 },
      { name: 'bad', host: 'example', user: '-root', port: 22 },
      { name: 'bad', host: 'example', port: 22, password: 'DO-NOT-SAVE' },
    ]) {
      const preview = await application.configuration.preview({ operation: 'create', profile });
      expect(preview.enabled).toBe(false);
      expect(JSON.stringify(preview)).not.toContain('DO-NOT-SAVE');
    }
    expect(await readdir(home)).toEqual(['.ssh']);
  });

  it('does not overwrite malformed profiles, linked storage or cancelled configuration', async () => {
    const { home, managed } = await fixture();
    await mkdir(join(home, '.crosschat'));
    const raw = '{"version":1,"profiles":"broken-secret"}';
    await writeFile(managed, raw);
    const application = createSshApplication({ home });
    const request = { operation: 'create' as const, profile: { name: 'one', host: 'one.example', port: 22 } };
    expect(await application.configuration.preview(request)).toMatchObject({ enabled: false });
    expect(await application.configuration.apply({ ...request, expectedRevision: 'missing' })).toMatchObject({ status: 'blocked' });
    expect(await readFile(managed, 'utf8')).toBe(raw);
    await rm(managed);
    await link(join(home, '.ssh', 'config'), managed);
    expect(await application.configuration.preview(request)).toMatchObject({ enabled: false });
    const controller = new AbortController(); controller.abort();
    expect(await application.configuration.apply({ ...request, expectedRevision: 'missing', signal: controller.signal })).toMatchObject({ status: 'cancelled' });
  });
});
