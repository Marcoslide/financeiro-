import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class MarketplaceAccountsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Lojas da organização (isolamento por organizationId). */
  list(organizationId: string) {
    return this.prisma.marketplaceAccount.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'asc' },
      include: {
        connections: {
          select: { sourceType: true, connectionStatus: true, lastSyncAt: true },
        },
        _count: { select: { memberships: true } },
      },
    });
  }

  async get(organizationId: string, id: string) {
    const account = await this.prisma.marketplaceAccount.findFirst({
      where: { id, organizationId },
      include: { connections: true },
    });
    if (!account) throw new NotFoundException('Loja não encontrada nesta organização.');
    return account;
  }
}
