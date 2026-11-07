import { createHmac, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decryptGithubSecret, encryptGithubSecret, hashGithubOAuthState, newGithubOAuthState, taskReference, verifyGithubSignature } from './github-security';

const key = randomBytes(32).toString('hex');

describe('GitHub integration security helpers', () => {
  it('encrypts secrets with authenticated encryption and rejects altered ciphertext', () => {
    const encrypted = encryptGithubSecret('gho_private-token', key);
    expect(encrypted).not.toContain('gho_private-token');
    expect(decryptGithubSecret(encrypted, key)).toBe('gho_private-token');
    expect(() => decryptGithubSecret(`${encrypted.slice(0, -1)}${encrypted.endsWith('x') ? 'y' : 'x'}`, key)).toThrow();
  });

  it('creates high entropy state values and stores only stable hashes', () => {
    const state = newGithubOAuthState();
    expect(state).toHaveLength(43);
    expect(hashGithubOAuthState(state)).not.toContain(state);
    expect(hashGithubOAuthState(state)).toBe(hashGithubOAuthState(state));
  });

  it('verifies webhook signatures in constant time and rejects malformed signatures', () => {
    const body = Buffer.from('{"action":"opened"}');
    const signature = `sha256=${createHmac('sha256', 'hook-secret').update(body).digest('hex')}`;
    expect(verifyGithubSignature(body, signature, 'hook-secret')).toBe(true);
    expect(verifyGithubSignature(body, signature.toUpperCase(), 'hook-secret')).toBe(false);
    expect(verifyGithubSignature(body, 'sha1=abcd', 'hook-secret')).toBe(false);
  });

  it('only recognizes explicit Nexora task references', () => {
    const taskId = '01234567-89ab-4cde-8fab-0123456789ab';
    expect(taskReference(`Fix [NEXORA-TASK:${taskId}]`)).toBe(taskId);
    expect(taskReference('Fix auth API for launch')).toBeNull();
  });
});
