import { describe, expect, it } from 'vitest';
import { decryptJson, encryptJson, hashPassword, secureEqual, verifyPassword } from '../src/security';

describe('security', () => {
  it('hashes and verifies passwords with a Cloudflare-compatible PBKDF2 work factor', async () => {
    const hash = await hashPassword('ein-sehr-sicheres-passwort');
    expect(hash).toMatch(/^pbkdf2\$100000\$/);
    expect(hash).not.toContain('ein-sehr-sicheres-passwort');
    expect(await verifyPassword('ein-sehr-sicheres-passwort', hash)).toBe(true);
    expect(await verifyPassword('falsch', hash)).toBe(false);
  });

  it('rejects unsupported PBKDF2 iteration counts before invoking Web Crypto', async () => {
    expect(await verifyPassword('passwort', 'pbkdf2$100001$YWJj$YWJj')).toBe(false);
    expect(await verifyPassword('passwort', 'pbkdf2$0$YWJj$YWJj')).toBe(false);
  });

  it('encrypts secrets reversibly without plaintext leakage', async () => {
    const encrypted = await encryptJson({ apiKey: 'secret-value' }, 'master-key');
    expect(encrypted).not.toContain('secret-value');
    expect(await decryptJson<{ apiKey: string }>(encrypted, 'master-key')).toEqual({ apiKey: 'secret-value' });
  });

  it('compares setup tokens safely', async () => {
    expect(await secureEqual('abc', 'abc')).toBe(true);
    expect(await secureEqual('abc', 'abd')).toBe(false);
  });
});
