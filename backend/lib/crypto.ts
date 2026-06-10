/**
 * App-layer crypto for Phase 0b auth.
 * - AES-256-GCM encryption for configSecret at rest (CONFIG_ENC_KEY env, 32 bytes).
 * - High-entropy device secret generation + hashing.
 *
 * Device secrets are 256-bit random tokens, so a fast salted SHA-256 is
 * sufficient (no slow KDF needed — there is no low-entropy password to protect).
 */
import crypto from 'node:crypto';

function encKey(): Buffer {
  const raw = process.env.CONFIG_ENC_KEY;
  if (!raw) throw new Error('CONFIG_ENC_KEY not set');
  const key = Buffer.from(raw, raw.length === 64 ? 'hex' : 'base64');
  if (key.length !== 32) throw new Error('CONFIG_ENC_KEY must decode to 32 bytes (hex or base64)');
  return key;
}

/** AES-256-GCM. Returns base64( iv(12) || ciphertext || tag(16) ). */
export function encryptSecret(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encKey(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, ct, tag]).toString('base64');
}

export function decryptSecret(enc: string): string {
  const buf = Buffer.from(enc, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(buf.length - 16);
  const ct = buf.subarray(12, buf.length - 16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', encKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

/** Generate a URL-safe 256-bit secret. */
export function generateSecret(): string {
  return crypto.randomBytes(32).toString('base64url');
}

/** Hash a high-entropy secret with a random per-row salt: sha256(salt || secret). */
export function hashSecret(secret: string): { hash: string; salt: string } {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.createHash('sha256').update(salt + secret).digest('hex');
  return { hash, salt };
}

/** Constant-time verify. */
export function verifySecret(secret: string, hash: string, salt: string): boolean {
  const computed = crypto.createHash('sha256').update(salt + secret).digest('hex');
  const a = Buffer.from(computed, 'hex');
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
