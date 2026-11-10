import crypto from 'node:crypto';
import { config } from '../config';

/**
 * Admin-viewable secrets (challenge flags, organizer-set team passwords).
 *
 * Flags and passwords are still checked against their one-way hashes; this is a
 * separate AES-256-GCM sealed copy, readable only by the admin panel. The key is
 * derived from ADMIN_SECRETS_KEY (default: JWT_SECRET) and never stored in the
 * database, so a database dump or backup alone does not reveal them.
 */
const KEY = Buffer.from(crypto.hkdfSync('sha256', config.adminSecretsKey, 'black-basta', 'admin-viewable-secrets', 32));
const PREFIX = 'v1:';

export function sealSecret(text: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const ct = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return PREFIX + Buffer.concat([iv, ct, cipher.getAuthTag()]).toString('base64');
}

/** The stored text, or null if there is none or it was sealed with another key. */
export function openSecret(sealed: string | null | undefined): string | null {
  if (!sealed?.startsWith(PREFIX)) return null;
  try {
    const raw = Buffer.from(sealed.slice(PREFIX.length), 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(raw.length - 16));
    return Buffer.concat([decipher.update(raw.subarray(12, raw.length - 16)), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
