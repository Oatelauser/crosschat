import { describe, expect, it } from 'vitest';
import { ERR, parseFrame } from '../src/serve/protocol.js';

describe('explicit credential revocation notification', () => {
  it.each([
    { kind: 'node', reason: 'node-removed' },
    { kind: 'admin', reason: 'admin-key-revoked' },
  ])('preserves star-bound revocation metadata for $kind credentials', (fields) => {
    const notification = { op: 'credential-revoked', starId: 'star-full-id', ...fields, message: '此凭证已撤销，请换钥后重新连接' };
    expect(parseFrame(JSON.stringify(notification))).toEqual(notification);
    expect(ERR.CREDENTIAL_REVOKED).toBe('CREDENTIAL_REVOKED');
  });

  it.each([
    { starId: '', kind: 'node', reason: 'node-removed', message: 'revoked' },
    { starId: 'star', kind: 'node', reason: 'admin-key-revoked', message: 'revoked' },
    { starId: 'star', kind: 'admin', reason: 'node-removed', message: 'revoked' },
    { starId: 'star', kind: 'node', reason: 'node-removed' },
  ])('rejects an invalid notification without treating general auth errors as revocation', (fields) => {
    expect(parseFrame(JSON.stringify({ op: 'credential-revoked', ...fields }))).toBeUndefined();
    expect(parseFrame('{"op":"error","code":"BAD_AUTH","message":"bad key"}')).toEqual({ op: 'error', code: 'BAD_AUTH', message: 'bad key' });
  });
});
