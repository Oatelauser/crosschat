import { Buffer } from 'node:buffer';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function driverFixture(result: Record<string, unknown> = { application: 'applied', changed: true }) {
  const root = await mkdtemp(join(tmpdir(), 'crosschat-dsh-driver-unit-'));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const source = (await readFile(new URL('./helpers/dsh-runtime-driver.mjs', import.meta.url), 'utf8'))
    .replace("import { getDshRuntimeVersion } from '@deepseek-ai/dsh-app-boot';", "const getDshRuntimeVersion = () => 'controlled-unit-runtime';");
  const driver = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  const setBundleEnabled = vi.fn(async () => result);
  const context = { agents: {}, sessionController: {}, webServer: { port: 12345 }, pluginManager: { setBundleEnabled }, effect: (setup: () => () => Promise<void>) => { cleanups.push(setup()); } };
  const file = join(root, 'controller.json');
  await driver.apply(context, { token: 'unit-control-token', path: file, workspace: root });
  const info = JSON.parse(await readFile(file, 'utf8'));
  const post = (body: unknown, token = 'unit-control-token') => fetch(`${info.url}/bridge`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { post, setBundleEnabled };
}

describe('controlled DSH driver lifecycle boundary', () => {
  it('requires its own token and only delegates the fixed production bundle toggle', async () => {
    const fixture = await driverFixture();
    expect((await fixture.post({ enabled: false }, 'wrong-token')).status).toBe(401);
    expect(fixture.setBundleEnabled).not.toHaveBeenCalled();
    const response = await fixture.post({ enabled: false });
    expect(response.status).toBe(200);
    expect(fixture.setBundleEnabled.mock.calls).toEqual([['@crosschat/dsh-bridge', false]]);
    expect(await response.json()).toMatchObject({ result: { application: 'applied', changed: true }, pid: process.pid });
  });

  it('rejects arbitrary targets and non-boolean flags before invoking the manager', async () => {
    const fixture = await driverFixture();
    expect((await fixture.post({ enabled: false, target: '@deepseek-ai/dsh-base' })).status).toBe(400);
    expect((await fixture.post({ enabled: 'false' })).status).toBe(400);
    expect(fixture.setBundleEnabled).not.toHaveBeenCalled();
  });

  it('preserves restart-required outcomes instead of claiming a live toggle applied', async () => {
    const fixture = await driverFixture({ application: 'restart-required', changed: true, restartReason: 'no-hmr' });
    const response = await fixture.post({ enabled: true });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ result: { application: 'restart-required', restartReason: 'no-hmr' } });
    expect(fixture.setBundleEnabled.mock.calls).toEqual([['@crosschat/dsh-bridge', true]]);
  });
});
