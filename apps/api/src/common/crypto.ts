import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

/**
 * Criptografia simétrica AES-256-GCM para credenciais de integração.
 * A chave vem de ENCRYPTION_KEY (32 bytes em base64). Nunca logar segredos.
 * Formato de saída: base64(iv).base64(authTag).base64(cipher)
 */
function loadKey(base64Key: string): Buffer {
  const key = Buffer.from(base64Key, 'base64');
  if (key.length !== 32) {
    throw new Error('ENCRYPTION_KEY deve ter 32 bytes (base64 de 32 bytes).');
  }
  return key;
}

export function encryptSecret(plain: string, base64Key: string): string {
  const key = loadKey(base64Key);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join('.');
}

export function decryptSecret(payload: string, base64Key: string): string {
  const key = loadKey(base64Key);
  const [ivB64, tagB64, dataB64] = payload.split('.');
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error('Payload criptografado inválido.');
  }
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString(
    'utf8',
  );
}
