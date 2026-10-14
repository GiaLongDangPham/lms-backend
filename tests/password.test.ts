import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../src/security/password.js';

describe('seed password compatibility for B1', () => {
  it('uses different salts and verifies passwords without storing plaintext', async () => {
    const password = 'LocalTestPassword2026!';
    const first = await hashPassword(password);
    const second = await hashPassword(password);
    expect(first).not.toEqual(second);
    expect(first).not.toContain(password);
    expect(await verifyPassword(password, first)).toBe(true);
    expect(await verifyPassword('wrong-password', first)).toBe(false);
  }, 10000);

  it('rejects malformed hashes and untrusted work factors', async () => {
    expect(await verifyPassword('password', 'not-a-hash')).toBe(false);
    expect(await verifyPassword('password', 'scrypt$999999999$8$1$salt$key')).toBe(false);
  });
});
