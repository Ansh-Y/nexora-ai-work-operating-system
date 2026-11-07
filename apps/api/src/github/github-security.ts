import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { ServiceUnavailableException } from '@nestjs/common';

function encryptionKey(value: string | undefined) {
  if (!value || !/^[\da-f]{64}$/i.test(value)) throw new ServiceUnavailableException('Configure GITHUB_TOKEN_ENCRYPTION_KEY as 64 hexadecimal characters to store GitHub credentials securely.');
  return Buffer.from(value, 'hex');
}

export function encryptGithubSecret(value: string, key: string | undefined) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(key), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return `v1.${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${ciphertext.toString('base64url')}`;
}

export function decryptGithubSecret(value: string, key: string | undefined) {
  const [version, ivText, tagText, ciphertextText] = value.split('.');
  if (version !== 'v1' || !ivText || !tagText || !ciphertextText) throw new ServiceUnavailableException('Stored GitHub credentials cannot be read. Rotate the connection encryption key only after disconnecting it.');
  try {
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey(key), Buffer.from(ivText, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(ciphertextText, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    throw new ServiceUnavailableException('Stored GitHub credentials cannot be decrypted. Verify GITHUB_TOKEN_ENCRYPTION_KEY.');
  }
}

export function hashGithubOAuthState(state: string) {
  return createHash('sha256').update(state).digest('hex');
}

export function newGithubOAuthState() {
  return randomBytes(32).toString('base64url');
}

export function verifyGithubSignature(payload: Buffer, signature: string | undefined, secret: string) {
  if (!signature || !/^sha256=[\da-f]{64}$/i.test(signature)) return false;
  const expected = Buffer.from(`sha256=${createHmac('sha256', secret).update(payload).digest('hex')}`, 'utf8');
  const received = Buffer.from(signature, 'utf8');
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export function taskReference(text: string) {
  return text.match(/\bNEXORA-TASK:([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\b/i)?.[1] ?? null;
}
