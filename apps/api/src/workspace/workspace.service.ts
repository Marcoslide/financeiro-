import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PatchWorkspaceStoreDto } from './dto';

/** Lista fechada das stores compartilhadas da aplicação. */
export const WORKSPACE_STORE_NAMES = [
  'orders',
  'occ',
  'batches',
  'products',
  'variations',
  'pfamilies',
  'pimports',
  'plans',
  'wallet',
  'walletcls',
  'settings',
  'acelera',
  'affconv',
  'affrpa',
  'affvb',
  'affmaster',
  'mrrenda',
  'mrship',
  'mradj',
  'mrsvc',
  'mrpdf',
  'shipbip',
  'walletclose',
  'expsessions',
  'caixafechamentos',
  'banktransfers',
  'bankaccounts',
  'companies',
  'operations',
  'cpheader',
  'cpitems',
  'cppayments',
  'cpattach',
  'cpcategories',
  'cpaccounting',
  'cpcostcenters',
  'cpsuppliers',
  'cpsupplylinks',
  'pricingopconfig',
  'pricingfamilyrules',
  'financialaccounts',
  'financialevents',
  'crheader',
  'crreceipts',
  'crcategories',
  'crcostcenters',
  'financialtransfers',
  'fatorfuncionarios',
  'fatorcustosfixos',
  'fatorcustosvariaveis',
  'fatorpedidosnapshots',
  'skufamilyoverrides',
  'fatorconfigs',
  'fatorsetores',
  'fatorimpostos',
  'fatorprocessos',
  'fatorroteiros',
  'fatorroteirosku',
  'skufamilyoverridehistory',
  'productidentitymappings',
  'fatorcategories',
] as const;

const WORKSPACE_STORE_SET = new Set<string>(WORKSPACE_STORE_NAMES);
const MAX_STORE_ITEMS = 250_000;
const MAX_STORE_JSON_BYTES = 50 * 1024 * 1024;

export function mergeWorkspaceItems(
  current: unknown,
  puts: Record<string, unknown>[],
  deletes: string[],
): Record<string, unknown>[] {
  const rows = Array.isArray(current) ? current : [];
  const byId = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    if (row && typeof row === 'object' && !Array.isArray(row) && 'id' in row) {
      byId.set(String((row as Record<string, unknown>).id), row as Record<string, unknown>);
    }
  }
  for (const id of deletes) byId.delete(String(id));
  for (const row of puts) {
    if (
      !row ||
      typeof row !== 'object' ||
      Array.isArray(row) ||
      row.id === undefined ||
      row.id === null
    ) {
      throw new BadRequestException('Todo registro sincronizado precisa ter um campo id.');
    }
    byId.set(String(row.id), row);
  }
  return [...byId.values()];
}

@Injectable()
export class WorkspaceService {
  constructor(private readonly prisma: PrismaService) {}

  private assertStoreName(storeName: string): void {
    if (!WORKSPACE_STORE_SET.has(storeName)) {
      throw new BadRequestException('Store operacional desconhecida.');
    }
  }

  async list(organizationId: string) {
    const stores = await this.prisma.organizationWorkspaceStore.findMany({
      where: { organizationId },
      orderBy: { storeName: 'asc' },
      select: { storeName: true, revision: true, payload: true, updatedAt: true },
    });
    return { stores };
  }

  async versions(organizationId: string) {
    const stores = await this.prisma.organizationWorkspaceStore.findMany({
      where: { organizationId },
      orderBy: { storeName: 'asc' },
      select: { storeName: true, revision: true, updatedAt: true },
    });
    return { stores };
  }

  async get(organizationId: string, storeName: string) {
    this.assertStoreName(storeName);
    const row = await this.prisma.organizationWorkspaceStore.findUnique({
      where: { organizationId_storeName: { organizationId, storeName } },
      select: { storeName: true, revision: true, payload: true, updatedAt: true },
    });
    return row ?? { storeName, revision: 0, payload: [], updatedAt: null };
  }

  async patch(
    organizationId: string,
    userId: string,
    storeName: string,
    dto: PatchWorkspaceStoreDto,
  ) {
    this.assertStoreName(storeName);
    const puts = dto.puts ?? [];
    const deletes = dto.deletes ?? [];
    if (!puts.length && !deletes.length) return this.get(organizationId, storeName);

    const current = await this.prisma.organizationWorkspaceStore.findUnique({
      where: { organizationId_storeName: { organizationId, storeName } },
      select: { revision: true, payload: true },
    });
    const currentRevision = current?.revision ?? 0;
    if (currentRevision !== dto.expectedRevision) {
      throw new ConflictException({
        message: 'A store foi atualizada por outro usuário.',
        revision: currentRevision,
      });
    }

    const payload = mergeWorkspaceItems(current?.payload, puts, deletes);
    if (payload.length > MAX_STORE_ITEMS) {
      throw new BadRequestException('A store excedeu o limite seguro de registros.');
    }
    const payloadBytes = Buffer.byteLength(JSON.stringify(payload));
    if (payloadBytes > MAX_STORE_JSON_BYTES) {
      throw new BadRequestException('A store excedeu o limite seguro de 50 MB.');
    }

    if (!current) {
      try {
        return await this.prisma.organizationWorkspaceStore.create({
          data: {
            organizationId,
            storeName,
            revision: 1,
            payload: payload as Prisma.InputJsonValue,
            updatedByUserId: userId,
          },
          select: { storeName: true, revision: true, updatedAt: true },
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          const latest = await this.get(organizationId, storeName);
          throw new ConflictException({
            message: 'A store foi criada por outro usuário.',
            revision: latest.revision,
          });
        }
        throw error;
      }
    }

    const updated = await this.prisma.organizationWorkspaceStore.updateMany({
      where: { organizationId, storeName, revision: dto.expectedRevision },
      data: {
        revision: { increment: 1 },
        payload: payload as Prisma.InputJsonValue,
        updatedByUserId: userId,
      },
    });
    if (updated.count !== 1) {
      const latest = await this.get(organizationId, storeName);
      throw new ConflictException({
        message: 'A store foi atualizada por outro usuário.',
        revision: latest.revision,
      });
    }
    return this.get(organizationId, storeName).then(({ storeName: name, revision, updatedAt }) => ({
      storeName: name,
      revision,
      updatedAt,
    }));
  }
}
