import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { computeImpact } from './impact';
import { classifyExposureNumbers } from './exposure';

/**
 * Persistência do motor de impacto (§16/§17/§19). Cria eventos financeiros
 * IDEMPOTENTES a partir da importação (compensação e reembolso confirmado) e
 * recalcula os campos desnormalizados da ocorrência. Reimportar não duplica.
 */

const n = (d: Prisma.Decimal | null | undefined) => (d == null ? 0 : Number(d));

/** Eventos derivados da importação (idempotentes por dedupeKey estável). */
export async function putImportFinancialEvents(
  prisma: PrismaService,
  occ: { id: string; organizationId: string; status: string | null; requested: number; compensation: number },
  importBatchId: string,
): Promise<void> {
  const requested = occ.requested;
  const compensation = occ.compensation;
  const exp = classifyExposureNumbers(occ.status, requested, compensation);

  const events: Array<{ type: string; direction: string; amount: number; dedupeKey: string }> = [];
  // Reembolso considerado PAGO apenas quando a exposição confirma a perda (§21/§22).
  if (exp.bucket === 'CONFIRMED' && requested > 0) {
    events.push({ type: 'REEMBOLSO_PAGO', direction: 'COST', amount: requested, dedupeKey: 'import:refund' });
  }
  if (compensation > 0) {
    events.push({ type: 'COMPENSACAO_SHOPEE', direction: 'RECOVERY', amount: compensation, dedupeKey: 'import:compensation' });
  }
  for (const e of events) {
    await prisma.occurrenceFinancialEvent.upsert({
      where: { occurrenceId_dedupeKey: { occurrenceId: occ.id, dedupeKey: e.dedupeKey } },
      create: {
        organizationId: occ.organizationId, occurrenceId: occ.id, type: e.type, direction: e.direction,
        amount: e.amount.toString(), source: 'IMPORT', importBatchId, dedupeKey: e.dedupeKey,
        createdByName: 'Importação',
      },
      update: { amount: e.amount.toString(), type: e.type, direction: e.direction, importBatchId },
    });
  }
}

/** Recalcula e persiste os campos de impacto da ocorrência a partir dos eventos. */
export async function recomputeOccurrenceImpact(prisma: PrismaService, occurrenceId: string) {
  const [events, occ] = await Promise.all([
    prisma.occurrenceFinancialEvent.findMany({ where: { occurrenceId }, select: { type: true, direction: true, amount: true } }),
    prisma.postSaleOccurrence.findUnique({ where: { id: occurrenceId }, select: { recoverableValue: true } }),
  ]);
  const impact = computeImpact(
    events.map((e) => ({ type: e.type, direction: e.direction as 'COST' | 'RECOVERY' | 'NEUTRAL', amount: Number(e.amount) })),
    n(occ?.recoverableValue),
  );
  await prisma.postSaleOccurrence.update({
    where: { id: occurrenceId },
    data: {
      refundedTotal: impact.refundedTotal.toString(),
      additionalCostTotal: impact.additionalCostTotal.toString(),
      recoveredTotal: impact.recoveredTotal.toString(),
      knownNetImpact: impact.knownNetImpact.toString(),
      cmvAvailable: impact.cmvAvailable,
    },
  });
  return impact;
}
