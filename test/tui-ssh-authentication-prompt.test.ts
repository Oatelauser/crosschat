import { describe, expect, it } from 'vitest';
import { sshAuthenticationPrompt } from '../src/tui/app/authentication.js';

describe('SSH host identity confirmation presentation', () => {
  it('shows the actual OpenSSH host identity separately from the selected final connection', () => {
    const fingerprint = `SHA256:${'A'.repeat(43)}`;
    const prompt = `The authenticity of host 'bastion.example (192.0.2.17)' can't be established.\nED25519 key fingerprint is ${fingerprint}.\nAre you sure you want to continue connecting (yes/no/[fingerprint])?`;
    const confirmation = sshAuthenticationPrompt({
      kind: 'host-key', contextId: 'ssh:production', host: 'production', prompt,
      algorithm: 'ED25519', fingerprint,
    });

    expect(confirmation.kind).toBe('confirm');
    expect(confirmation.fields).toEqual(expect.arrayContaining([
      { label: '所选连接', value: 'production' },
      { label: '主机身份提示', value: prompt },
      { label: '算法', value: 'ED25519' },
      { label: '完整指纹', value: fingerprint },
    ]));
  });
});
