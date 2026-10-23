import { describe, expect, it, vi } from 'vitest';
import { createSshInteraction } from '../src/application/ssh/interaction.js';

describe('SSH authentication challenges and active-context secret ownership', () => {
  it('reuses a masked password only within the active connection and configuration revision', async () => {
    const onChallenge = vi.fn(async () => 'ephemeral-secret');
    const interaction = createSshInteraction({ onChallenge });
    interaction.setActiveContext('ssh:first');
    const request = { contextId: 'ssh:first', host: 'first', revision: 'revision-1', prompt: "dev@first's password:" };
    expect(await interaction.answer(request)).toBe('ephemeral-secret');
    expect(await interaction.answer(request)).toBe('ephemeral-secret');
    expect(onChallenge).toHaveBeenCalledOnce();
    expect(onChallenge.mock.calls[0][0]).toMatchObject({ kind: 'password', contextId: 'ssh:first', host: 'first' });
    interaction.setActiveContext('ssh:first');
    expect(await interaction.answer(request)).toBe('ephemeral-secret');
    expect(onChallenge).toHaveBeenCalledOnce();
    expect(await interaction.answer({ ...request, revision: 'revision-2' })).toBe('ephemeral-secret');
    expect(onChallenge).toHaveBeenCalledTimes(2);
    interaction.setActiveContext('ssh:other');
    interaction.setActiveContext('ssh:first');
    expect(await interaction.answer({ ...request, revision: 'revision-2' })).toBe('ephemeral-secret');
    expect(onChallenge).toHaveBeenCalledTimes(3);
    interaction.dispose();
  });

  it('requires the complete algorithm and SHA256 fingerprint before offering first-host trust', async () => {
    const onChallenge = vi.fn(async () => true);
    const interaction = createSshInteraction({ onChallenge });
    interaction.setActiveContext('ssh:fixture');
    const fingerprint = `SHA256:${'A'.repeat(43)}`;
    const request = { contextId: 'ssh:fixture', host: 'fixture', revision: 'one', prompt: `The authenticity of host 'fixture (127.0.0.1)' can't be established.\nED25519 key fingerprint is ${fingerprint}.\nAre you sure you want to continue connecting (yes/no/[fingerprint])?` };
    expect(await interaction.answer(request)).toBe('yes');
    expect(onChallenge.mock.calls[0][0]).toMatchObject({ kind: 'host-key', host: 'fixture', algorithm: 'ED25519', fingerprint });
    expect(await interaction.answer({ ...request, prompt: 'Are you sure you want to continue connecting (yes/no)?' })).toBeNull();
    expect(onChallenge).toHaveBeenCalledOnce();
    interaction.dispose();
  });

  it('keeps private-key passphrases separate from passwords and never caches confirmation answers', async () => {
    const onChallenge = vi.fn(async (challenge) => challenge.kind === 'host-key' ? false : challenge.kind === 'passphrase' ? 'private-unlock' : 'login-password');
    const interaction = createSshInteraction({ onChallenge });
    interaction.setActiveContext('ssh:fixture');
    const request = { contextId: 'ssh:fixture', host: 'fixture', revision: 'one' };
    expect(await interaction.answer({ ...request, prompt: 'Enter passphrase for key "/a/key":' })).toBe('private-unlock');
    expect(await interaction.answer({ ...request, prompt: "root@fixture's password:" })).toBe('login-password');
    expect(onChallenge).toHaveBeenCalledTimes(2);
    interaction.dispose();
    expect(await interaction.answer({ ...request, prompt: "root@fixture's password:" })).toBeNull();
  });

  it('recognizes the native OpenSSH bare private-key passphrase prompt', async () => {
    const onChallenge = vi.fn(async () => 'private-key-unlock');
    const interaction = createSshInteraction({ onChallenge });
    interaction.setActiveContext('ssh:fixture');
    expect(await interaction.answer({ contextId: 'ssh:fixture', host: 'fixture', revision: 'one', prompt: 'Enter passphrase: ' })).toBe('private-key-unlock');
    expect(onChallenge.mock.calls[0][0]).toMatchObject({ kind: 'passphrase' });
    interaction.dispose();
  });

  it('cancels pending interaction on a real context change and discards its late secret', async () => {
    let finish: (answer: string) => void = () => {};
    let challengeSignal: AbortSignal | undefined;
    const onChallenge = vi.fn((_challenge, signal) => { challengeSignal = signal; return new Promise<string>((resolve) => { finish = resolve; }); });
    const interaction = createSshInteraction({ onChallenge });
    interaction.setActiveContext('ssh:first');
    const pending = interaction.answer({ contextId: 'ssh:first', host: 'first', revision: 'one', prompt: "root@first's password:" });
    await vi.waitFor(() => expect(onChallenge).toHaveBeenCalledOnce());
    interaction.setActiveContext('ssh:second');
    expect(await pending).toBeNull();
    expect(challengeSignal?.aborted).toBe(true);
    finish('late-secret');
    interaction.dispose();
  });

  it('rejects unknown authentication prompts and cancellation without exposing a raw prompt as a secret challenge', async () => {
    const onChallenge = vi.fn(async () => 'secret');
    const interaction = createSshInteraction({ onChallenge });
    interaction.setActiveContext('ssh:fixture');
    const request = { contextId: 'ssh:fixture', host: 'fixture', revision: 'one' };
    expect(await interaction.answer({ ...request, prompt: 'Unexpected arbitrary remote prompt\u001b[2J' })).toBeNull();
    const controller = new AbortController(); controller.abort();
    expect(await interaction.answer({ ...request, prompt: "root@fixture's password:", signal: controller.signal })).toBeNull();
    expect(onChallenge).not.toHaveBeenCalled();
    interaction.dispose();
  });
});
