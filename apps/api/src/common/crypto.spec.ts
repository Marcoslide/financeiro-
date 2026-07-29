import { describe, it, expect } from 'vitest';
import { randomBytes } from 'crypto';
import { encryptSecret, decryptSecret } from './crypto';

describe('crypto (AES-256-GCM)', () => {
  const key = randomBytes(32).toString('base64');

  it('criptografa e descriptografa de volta', () => {
    const secret = 'token-super-secreto-123';
    const enc = encryptSecret(secret, key);
    expect(enc).not.toContain(secret);
    expect(decryptSecret(enc, key)).toBe(secret);
  });

  it('falha com chave de tamanho errado', () => {
    expect(() => encryptSecret('x', Buffer.from('curta').toString('base64'))).toThrow();
  });

  it('falha ao adulterar o texto cifrado', () => {
    const enc = encryptSecret('abc', key);
    const tampered = enc.slice(0, -2) + 'xy';
    expect(() => decryptSecret(tampered, key)).toThrow();
  });
});
