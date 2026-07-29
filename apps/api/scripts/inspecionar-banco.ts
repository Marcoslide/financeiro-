/**
 * Inspeção do banco (somente leitura) para a homologação do Bloco 2 no sistema
 * REAL. Depois de importar pela Central de Importações, rode este script para
 * COMPROVAR que os dados foram PERSISTIDOS no PostgreSQL — lotes, linhas,
 * rawPayload, hashes, chaves de deduplicação e auditoria.
 *
 * Uso:
 *   pnpm --filter @financeiro/api homologar:db
 *   (opcional) ... homologar:db -- lidermolduras   # filtra por nome da loja
 *
 * Não altera nada. Ideal para conferir a persistência após reiniciar a API.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function short(s: string | null | undefined, n = 14): string {
  if (!s) return '—';
  return s.length > n ? s.slice(0, n) + '…' : s;
}

async function main() {
  const filtro = process.argv.slice(2).find((a) => a !== '--');

  const accounts = await prisma.marketplaceAccount.findMany({
    where: filtro ? { displayName: { contains: filtro } } : {},
    include: { organization: { select: { name: true } } },
    orderBy: { createdAt: 'asc' },
  });

  if (accounts.length === 0) {
    console.log('Nenhuma loja encontrada.' + (filtro ? ` (filtro: "${filtro}")` : ''));
    await prisma.$disconnect();
    return;
  }

  for (const acc of accounts) {
    const batches = await prisma.importBatch.findMany({
      where: { marketplaceAccountId: acc.id },
      orderBy: { createdAt: 'asc' },
      include: { createdBy: { select: { name: true } }, _count: { select: { rows: true } } },
    });

    console.log('\n══════════════════════════════════════════════════════════════');
    console.log(`LOJA: ${acc.displayName}  ·  ORG: ${acc.organization.name}`);
    console.log(`marketplaceAccountId=${acc.id}`);
    console.log('══════════════════════════════════════════════════════════════');
    if (batches.length === 0) {
      console.log('  (nenhum lote importado ainda)');
      continue;
    }

    for (const b of batches) {
      console.log(`\n▸ Lote ${short(b.id, 10)}  ${b.originalFilename}`);
      console.log(`   tipo=${b.reportType} (detectado=${b.detectedReportType}, conf=${(b.reportTypeConfidence * 100).toFixed(0)}%${b.reportTypeManualOverride ? ', ajustado' : ''})  status=${b.status}`);
      console.log(`   formato=${b.fileFormat} ext=.${b.declaredExtension}${b.extensionMismatch ? ' (divergente)' : ''}  aba=${b.sheetName ?? '—'}  cabeçalho=linha ${b.headerRowIndex ?? '—'}  colunas=${b.columnCount}`);
      console.log(`   linhas: físicas=${b.physicalRowCount} dados=${b.dataRowCount} | válidas=${b.validRows} importadas=${b.importedRows} duplicadas=${b.duplicatedRows} atualizadas=${b.updatedRows} alerta=${b.warningRows} erro=${b.failedRows}`);
      console.log(`   ImportRow no banco (deste lote)=${b._count.rows}  processamento=${b.processingMs ?? '—'}ms`);
      console.log(`   período=${b.periodStart ? b.periodStart.toISOString().slice(0, 10) : '—'} → ${b.periodEnd ? b.periodEnd.toISOString().slice(0, 10) : '—'}`);
      console.log(`   fileHash=${short(b.fileHash, 24)}  storageKey=${short(b.storageKey, 40)}  por=${b.createdBy?.name ?? '—'}`);
    }

    // Amostra de uma linha persistida (rawPayload + hashes)
    const sample = await prisma.importRow.findFirst({
      where: { batch: { marketplaceAccountId: acc.id } },
      orderBy: { createdAt: 'desc' },
    });
    if (sample) {
      const raw = sample.rawPayload as { headers?: string[]; values?: string[] };
      console.log('\n  Amostra de linha persistida (prova de rawPayload + hashes):');
      console.log(`   linha física ${sample.physicalRowNumber} · status=${sample.processingStatus} · orderId=${sample.externalOrderId ?? '—'}`);
      console.log(`   rawPayload: ${raw.headers?.length ?? 0} colunas preservadas (ex.: ${(raw.headers ?? []).slice(0, 4).join(', ')}…)`);
      console.log(`   rawHash=${short(sample.rawHash, 20)}  canonicalHash=${short(sample.canonicalHash, 20)}  (bruto ≠ canônico: ${sample.rawHash !== sample.canonicalHash})`);
    }

    // Totais persistidos
    const [rowsTotal, dedupTotal, dedupByType, auditTotal] = await Promise.all([
      prisma.importRow.count({ where: { batch: { marketplaceAccountId: acc.id } } }),
      prisma.importDedupKey.count({ where: { marketplaceAccountId: acc.id } }),
      prisma.importDedupKey.groupBy({ by: ['reportType'], where: { marketplaceAccountId: acc.id }, _count: true }),
      prisma.auditLog.count({ where: { organizationId: acc.organizationId, action: { in: ['IMPORT_ANALYZE', 'IMPORT_CONFIRM', 'IMPORT_REPROCESS', 'IMPORT_DISCARD'] } } }),
    ]);
    console.log('\n  Totais persistidos nesta loja:');
    console.log(`   ImportRow=${rowsTotal}  ImportDedupKey=${dedupTotal}  AuditLog(import)=${auditTotal}`);
    console.log('   Chaves de deduplicação por relatório: ' + (dedupByType.map((d) => `${d.reportType}=${d._count}`).join(', ') || '—'));
  }

  console.log('\nDica de persistência: reinicie a API, reimporte o mesmo arquivo pela');
  console.log('Central e rode este script de novo — importadas deve ser 0 e ImportDedupKey');
  console.log('não deve crescer. Isso prova que a dedup vem do banco, não da memória.\n');

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
