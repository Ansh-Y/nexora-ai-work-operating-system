import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { ServiceUnavailableException } from '@nestjs/common';

export const GOOGLE_OAUTH_SCOPES = [
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/gmail.readonly',
];

function resolveEncryptionKey(value: string | undefined): Buffer {
  if (!value || !/^[\da-f]{64}$/i.test(value)) {
    throw new ServiceUnavailableException(
      'Configure GOOGLE_TOKEN_ENCRYPTION_KEY or GITHUB_TOKEN_ENCRYPTION_KEY as 64 hexadecimal characters to store Google credentials securely.',
    );
  }
  return Buffer.from(value, 'hex');
}

export function encryptGoogleSecret(value: string, key: string | undefined): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', resolveEncryptionKey(key), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return `v1.${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${ciphertext.toString('base64url')}`;
}

export function decryptGoogleSecret(value: string, key: string | undefined): string {
  const [version, ivText, tagText, ciphertextText] = value.split('.');
  if (version !== 'v1' || !ivText || !tagText || !ciphertextText) {
    throw new ServiceUnavailableException(
      'Stored Google credentials cannot be read. Reconnect your Google Workspace account.',
    );
  }
  try {
    const tag = Buffer.from(tagText, 'base64url');
    if (tag.length !== 16) {
      throw new Error('Invalid authentication tag length');
    }
    const decipher = createDecipheriv('aes-256-gcm', resolveEncryptionKey(key), Buffer.from(ivText, 'base64url'));
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextText, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new ServiceUnavailableException(
      'Stored Google credentials cannot be decrypted. Verify your token encryption key.',
    );
  }
}

export function hashGoogleOAuthState(state: string): string {
  return createHash('sha256').update(state).digest('hex');
}

export function newGoogleOAuthState(): string {
  return randomBytes(32).toString('base64url');
}
