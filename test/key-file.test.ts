import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { keyFileName, normalizePipePath, readPeerToken } from '../src/claude/key-file.js';

/**
 * Real fixtures from docs/research/claude-windows-pipe.md: registry pipe paths of
 * live sessions 17324 and 24900 (§1/§2), and their key-file sha256 prefixes
 * cfb5a69d… / a532ca38… (§3, rule verified 6/6 on the live machine). The full
 * digests below are the completion of those prefixes under the documented rule.
 */
const PIPE_17324 = '\\\\.\\pipe\\LOCAL\\cc-msg-0e4d56cd5b3e15b7d6c3d675995318ce';
const SHA_17324 = 'cfb5a69dd12c11b371fc9470efe294a55047359dbad43ce21e2cd36fa7ecfff4';
const PIPE_24900 = '\\\\.\\pipe\\LOCAL\\cc-msg-5e265dab4154233cf0d28ed48349d427';
const SHA_24900 = 'a532ca3841f5936d975e2b70398dbc97206833b3d14b317d80eca2f7675906fd';

const KEY_17324 = `17324.${SHA_17324}.key`;
const KEY_24900 = `24900.${SHA_24900}.key`;
const REAL_KEY_BODY =
  '{"peerToken":"578ba13cbe83cdbe8dd9d63c3932704","procStartFt":"134353221215414169","pidDomain":"win32:yang"}';

const tmp = mkdtempSync(join(tmpdir(), 'crosschat-keyfile-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('key file name derivation (report samples)', () => {
  it('derives 17324.cfb5a69d….key for session 17324', () => {
    const name = keyFileName(17324, PIPE_17324);
    expect(name).toBe(KEY_17324);
    expect(SHA_17324.startsWith('cfb5a69d')).toBe(true); // report cross-check
  });

  it('derives 24900.a532ca38….key for session 24900', () => {
    const name = keyFileName(24900, PIPE_24900);
    expect(name).toBe(KEY_24900);
    expect(SHA_24900.startsWith('a532ca38')).toBe(true); // report cross-check
  });

  it('normalization lowercases only the part after \\\\.\\pipe\\', () => {
    expect(normalizePipePath(PIPE_17324)).toBe('\\\\.\\pipe\\local\\cc-msg-0e4d56cd5b3e15b7d6c3d675995318ce');
    expect(
      keyFileName(17324, '\\\\.\\pipe\\LOCAL\\CC-MSG-0E4D56CD5B3E15B7D6C3D675995318CE'),
    ).toBe(KEY_17324);
    try {
      normalizePipePath('/tmp/cc-socks/1.sock');
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as { code?: string }).code).toBe('CLAUDE_PIPE_PATH_INVALID');
    }
  });
});

describe('readPeerToken', () => {
  it('reads peerToken from the derived key file', () => {
    writeFileSync(join(tmp, KEY_17324), REAL_KEY_BODY, 'utf8');
    expect(readPeerToken(tmp, 17324, PIPE_17324)).toBe('578ba13cbe83cdbe8dd9d63c3932704');
  });

  it('throws CLAUDE_KEY_FILE_MISSING when the key file is absent', () => {
    try {
      readPeerToken(tmp, 24900, PIPE_24900);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as { code?: string }).code).toBe('CLAUDE_KEY_FILE_MISSING');
    }
  });

  it('throws CLAUDE_KEY_FILE_INVALID for garbage or tokenless JSON', () => {
    writeFileSync(join(tmp, KEY_24900), 'not json at all', 'utf8');
    try {
      readPeerToken(tmp, 24900, PIPE_24900);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as { code?: string }).code).toBe('CLAUDE_KEY_FILE_INVALID');
    }
    writeFileSync(join(tmp, KEY_24900), '{"procStartFt":"1"}', 'utf8');
    try {
      readPeerToken(tmp, 24900, PIPE_24900);
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as { code?: string }).code).toBe('CLAUDE_KEY_FILE_INVALID');
    }
  });
});
