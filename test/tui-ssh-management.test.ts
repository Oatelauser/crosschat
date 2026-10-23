import { describe, expect, it, vi } from 'vitest';
import { createSshResource } from '../src/tui/resources/ssh.js';

const signal = () => new AbortController().signal;
function application() {
  return {
    list: vi.fn(async () => ({ items: [
      { id: 'ssh:external', kind: 'ssh', name: 'external', target: 'external', identityHint: '外部 Host', attributes: { source: '/fixture/.ssh/config' } },
      { id: 'ssh:profile:12345678-1234-1234-1234-123456789abc', kind: 'ssh', name: '开发机', target: 'cc-12345678-1234-1234-1234-123456789abc', identityHint: 'TUI 管理', attributes: { source: '/fixture/.crosschat/ssh-connections.json', managed: true, host: 'dev.example', user: 'dev', port: 2222, keyFile: '/fixture/key' } },
    ], errors: [], observedAt: 1 })),
    configuration: {
      preview: vi.fn(async () => ({ enabled: true, revision: 'confirmed-version', impact: ['仅修改本机受管配置'] })),
      apply: vi.fn(async () => ({ status: 'applied', contextId: 'ssh:profile:12345678-1234-1234-1234-123456789abc', message: '已保存' })),
    },
  };
}

describe('SSH workspace list-owned configuration forms', () => {
  it('exposes add/edit/delete on the list and explains why external Host rows remain readonly', async () => {
    const ssh = application();
    const { adapter, resource } = createSshResource({ ssh });
    expect(resource.actions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'add-connection', shortcut: 'a', mutation: true }),
      expect.objectContaining({ id: 'edit-connection', shortcut: 'e', mutation: true }),
      expect.objectContaining({ id: 'remove-connection', shortcut: 'Ctrl+D', mutation: true }),
    ]));
    const page = await adapter.read({ signal: signal() });
    expect(page.rows[0].actionAvailability?.['edit-connection']).toMatchObject({ enabled: false, reason: expect.stringMatching(/外部|只读/) });
    expect(page.rows[1].actionAvailability?.['edit-connection']?.enabled).not.toBe(false);
    expect(page.rows[1].cells).toMatchObject({ host: 'dev.example', port: '2222', user: 'dev' });
    expect(ssh.configuration.apply).not.toHaveBeenCalled();
  });

  it('prefills the selected managed connection and binds the final fields and context to the confirmed revision', async () => {
    const ssh = application(); const { adapter, resource } = createSshResource({ ssh });
    const page = await adapter.read({ signal: signal() });
    const action = resource.actions.find((entry) => entry.id === 'edit-connection')!;
    const initial = await adapter.checkAction!({ action, target: page.rows[1], values: {}, signal: signal() });
    expect(initial.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'name', initialValue: '开发机' }),
      expect.objectContaining({ id: 'host', initialValue: 'dev.example' }),
      expect.objectContaining({ id: 'port', initialValue: '2222' }),
    ]));
    const request = { action, target: page.rows[1], values: { name: '改名', host: 'new.example', port: '22', user: 'new-user', keyFile: '' }, signal: signal() };
    expect((await adapter.checkAction!(request)).enabled).toBe(true);
    expect(await adapter.mutate!(request)).toMatchObject({ message: '已保存' });
    expect(ssh.configuration.apply).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ operation: 'update', contextId: page.rows[1].id, expectedRevision: 'confirmed-version', profile: { name: '改名', host: 'new.example', port: 22, user: 'new-user' } }));
    await expect(adapter.mutate!({ ...request, values: { ...request.values, host: 'unconfirmed.example' } })).rejects.toThrow(/确认|预览/);
  });

  it('refuses a forged edit of an external row and a changed configuration receipt without claiming success', async () => {
    const ssh = application(); const { adapter, resource } = createSshResource({ ssh });
    const page = await adapter.read({ signal: signal() });
    const action = resource.actions.find((entry) => entry.id === 'remove-connection')!;
    const external = { action, target: page.rows[0], values: {}, signal: signal() };
    expect((await adapter.checkAction!(external)).enabled).toBe(false);
    await expect(adapter.mutate!(external)).rejects.toThrow();
    expect(ssh.configuration.apply).not.toHaveBeenCalled();
    const managed = { ...external, target: page.rows[1] };
    expect((await adapter.checkAction!(managed)).enabled).toBe(true);
    ssh.configuration.apply.mockResolvedValueOnce({ status: 'changed', contextId: page.rows[1].id, message: '配置已变化，重新确认' });
    await expect(adapter.mutate!(managed)).rejects.toThrow(/变化/);
  });
});
