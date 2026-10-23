import type { SshChallenge } from '../../application/ssh/index.js';
import type { TuiPromptRequest } from '../model.js';

/** OpenSSH may ask about an intermediate host; retain its actual identity verbatim. */
export function sshAuthenticationPrompt(challenge: SshChallenge): TuiPromptRequest {
  if (challenge.kind === 'host-key') return { kind: 'confirm', title: '首次 SSH 主机身份确认', fields: [
    { label: '所选连接', value: challenge.host }, { label: '主机身份提示', value: challenge.prompt },
    { label: '算法', value: challenge.algorithm }, { label: '完整指纹', value: challenge.fingerprint },
  ] };
  return { kind: 'secret', title: challenge.kind === 'passphrase' ? 'SSH 私钥口令' : 'SSH 登录密码', fields: [
    { label: '所选连接', value: challenge.host }, { label: '提示', value: challenge.prompt },
  ] };
}
