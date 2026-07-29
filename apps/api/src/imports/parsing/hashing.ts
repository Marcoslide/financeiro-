import { createHash } from 'crypto';

export const CANONICAL_HASH_VERSION = 'v1';

export function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Hash do CONTEÚDO bruto do arquivo (dedup em nível de arquivo). */
export function fileHash(buffer: Buffer): string {
  return sha256(buffer);
}

/**
 * Hash da linha BRUTA (todas as células por posição). Serve de "hash bruto" da
 * linha, independente de normalização — muda se qualquer caractere mudar.
 */
export function rawRowHash(values: string[]): string {
  return sha256(values.join(''));
}

/**
 * Hash CANÔNICO por relatório (§9.1 do contrato). Recebe as partes já
 * normalizadas e ordenadas. Duas linhas legítimas do mesmo pedido no mesmo dia
 * produzem hashes DIFERENTES porque os discriminadores (saldo, status, id do
 * resgate, etc.) entram no conjunto.
 */
export function canonicalRowHash(parts: string[]): string {
  return sha256(`${CANONICAL_HASH_VERSION}${parts.join('')}`);
}
