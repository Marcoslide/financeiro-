import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Abstração de armazenamento de arquivos brutos. Implementação local em disco
 * (dev), preparada para trocar por S3 sem tocar no serviço de importação.
 * Os bytes são gravados INTACTOS — o payload bruto nunca é alterado.
 */
export interface FileStorage {
  save(key: string, data: Buffer): Promise<void>;
  read(key: string): Promise<Buffer>;
  exists(key: string): Promise<boolean>;
  buildKey(organizationId: string, marketplaceAccountId: string, fileHash: string, ext: string): string;
}

@Injectable()
export class LocalDiskStorage implements FileStorage {
  private readonly root: string;

  constructor(config: ConfigService) {
    const dir = config.get<string>('STORAGE_DIR') ?? './storage';
    this.root = path.isAbsolute(dir) ? dir : path.resolve(process.cwd(), dir);
  }

  buildKey(organizationId: string, marketplaceAccountId: string, fileHash: string, ext: string): string {
    const safeExt = ext.replace(/[^a-z0-9]/gi, '').slice(0, 8) || 'bin';
    return path.join(organizationId, marketplaceAccountId, `${fileHash}.${safeExt}`);
  }

  private full(key: string): string {
    return path.join(this.root, key);
  }

  async save(key: string, data: Buffer): Promise<void> {
    const full = this.full(key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, data);
  }

  async read(key: string): Promise<Buffer> {
    return fs.readFile(this.full(key));
  }

  async exists(key: string): Promise<boolean> {
    try {
      await fs.access(this.full(key));
      return true;
    } catch {
      return false;
    }
  }
}

export const FILE_STORAGE = Symbol('FILE_STORAGE');
