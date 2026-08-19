import { describe, expect, it } from 'vitest';
import { decryptJson, encryptJson, hashPassword, secureEqual, verifyPassword } from '../src/security';

describe('security', () => {
  it('hashes and verifies passwords', async () => {
    const hash = await hashPassword('ein-sehr-sicheres-passwort');
    expect(hash).not.toContain('ein-sehr-sicheres-passwort');
    expect(await verifyPassword('ein-sehr-sicheres-passwort', hash)).toBe(true);
    expect(await verifyPassword('falsch', hash)).toBe(false);
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
