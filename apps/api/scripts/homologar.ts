/**
 * Harness de HOMOLOGAÇÃO REAL (Bloco 2.1) — leitura em modo "dry-run".
 *
 * Lê TODOS os arquivos de uma pasta (os relatórios REAIS da Shopee) usando o
 * MESMO pipeline de parsing da importação, SEM banco e SEM gravar nada, e
 * produz um relatório: formato real, tipo detectado + confiança, aba, cabeçalho,
 * colunas, linhas físicas/dados, prévia, linhas com erro de parsing e hash.
 *
 * Objetivo: rodar em segundos sobre os arquivos reais e revelar qualquer
 * divergência ANTES de subir o sistema — para corrigir no próprio Bloco 2.
 *
 * Uso:
 *   pnpm --filter @financeiro/api homologar -- ./caminho/para/seus-arquivos
 *   (ou)  tsx apps/api/scripts/homologar.ts ./caminho/para/seus-arquivos
 *
 * Nenhum dado é enviado a lugar nenhum. Rode localmente, na sua máquina.
 */
import * as fs from 'fs';
import * as path from 'path';
import { ImportIssueSeverity, ReportType, REPORT_TYPE_LABELS } from '@financeiro/shared';
import { parseFile, computePeriod } from '../src/imports/parsing/analyze';
import { processRow, fileHash } from '../src/imports/parsing';

// Contagem de colunas esperada por relatório (inspeção do Bloco 0) — só informativo.
const EXPECTED_COLUMNS: Partial<Record<ReportType, number>> = {
  [ReportType.ORDERS]: 64,
  [ReportType.ORDER_CANCELLATION]: 60,
  [ReportType.FAILED_DELIVERY]: 59,
  [ReportType.RETURN_REFUND]: 46,
  [ReportType.WALLET_TRANSACTION]: 9,
  [ReportType.SHOPEE_ACELERA]: 15,
  [ReportType.AFFILIATE_COMMISSION]: 41,
  [ReportType.AFFILIATE_PERFORMANCE]: 11,
};

const SUPPORTED = /\.(csv|xls|xlsx|tsv|txt)$/i;

interface FileReport {
  arquivo: string;
  ok: boolean;
  erro?: string;
  formatoReal?: string;
  extensao?: string;
  extensaoDivergente?: boolean;
  tipo?: ReportType;
  confianca?: number;
  usouDicaNome?: boolean;
  aba?: string | null;
  cabecalhoLinha?: number | null;
  colunas?: number;
  colunasEsperadas?: number;
  linhasFisicas?: number;
  linhasDados?: number;
  linhasComErro?: number;
  linhasComAlerta?: number;
  hash?: string;
  periodo?: string;
  amostraErros?: string[];
  previa?: Array<Record<string, string>>;
  candidatos?: Array<{ tipo: string; score: number }>;
}

function analisar(file: string): FileReport {
  const buf = fs.readFileSync(file);
  const name = path.basename(file);
  try {
    const parsed = parseFile(buf, name);
    let erros = 0;
    let alertas = 0;
    const amostraErros: string[] = [];
    if (parsed.spec) {
      for (const dr of parsed.dataRows) {
        const pr = processRow(parsed.spec, dr);
        const rowErr = pr.normalized.issues.filter((i) => i.severity === ImportIssueSeverity.ERROR);
        const rowWarn = pr.normalized.issues.filter((i) => i.severity !== ImportIssueSeverity.ERROR);
        if (rowErr.length) {
          erros++;
          if (amostraErros.length < 5) amostraErros.push(`linha ${dr.physicalRowNumber}: ${rowErr[0].message}`);
        }
        if (rowWarn.length) alertas++;
      }
    }
    const period = computePeriod(parsed);
    const previa = parsed.dataRows.slice(0, 3).map((r) => {
      const o: Record<string, string> = {};
      r.headerNames.slice(0, 6).forEach((h, i) => (o[h || `col${i + 1}`] = r.values[i] ?? ''));
      return o;
    });
    return {
      arquivo: name,
      ok: parsed.reportType !== ReportType.UNKNOWN,
      formatoReal: parsed.format,
      extensao: parsed.declaredExtension,
      extensaoDivergente: parsed.extensionMismatch,
      tipo: parsed.reportType,
      confianca: Number(parsed.confidence.toFixed(2)),
      usouDicaNome: parsed.detection.usedFilenameHint,
      aba: parsed.sheetName,
      cabecalhoLinha: parsed.headerRowIndex,
      colunas: parsed.columns.length,
      colunasEsperadas: EXPECTED_COLUMNS[parsed.reportType],
      linhasFisicas: parsed.physicalRowCount,
      linhasDados: parsed.dataRows.length,
      linhasComErro: erros,
      linhasComAlerta: alertas,
      hash: fileHash(buf),
      periodo:
        (period.start ? period.start.toISOString().slice(0, 10) : '—') +
        ' → ' +
        (period.end ? period.end.toISOString().slice(0, 10) : '—'),
      amostraErros,
      previa,
      candidatos: parsed.detection.candidates.slice(0, 4).map((c) => ({ tipo: c.type, score: Number(c.score.toFixed(2)) })),
    };
  } catch (e) {
    return { arquivo: name, ok: false, erro: e instanceof Error ? e.message : String(e) };
  }
}

function fmtReport(reports: FileReport[]): string {
  const L: string[] = [];
  L.push('# Homologação real — resultado do harness (dry-run)\n');
  L.push('> Gerado por `apps/api/scripts/homologar.ts`. Nenhum dado foi enviado a lugar nenhum.');
  L.push('> Este é um **pré-check de leitura** (sem banco). A homologação definitiva é a');
  L.push('> importação pela tela real (persistência + deduplicação + lote).\n');

  L.push('## Resumo\n');
  L.push('| Arquivo | Tipo detectado | Conf. | Formato | Cabeçalho | Colunas (esp.) | Físicas | Dados | Erros | Alertas |');
  L.push('|---|---|---|---|---|---|---|---|---|---|');
  for (const r of reports) {
    if (!r.ok && r.erro) {
      L.push(`| ${r.arquivo} | **FALHA** | — | — | — | — | — | — | — | — |`);
      continue;
    }
    const col = `${r.colunas}${r.colunasEsperadas ? ` (${r.colunasEsperadas})` : ''}`;
    const tipo = `${REPORT_TYPE_LABELS[r.tipo!]}${r.usouDicaNome ? ' ⤷nome' : ''}`;
    L.push(
      `| ${r.arquivo} | ${tipo} | ${(r.confianca! * 100).toFixed(0)}% | ${r.formatoReal}${r.extensaoDivergente ? ` (.${r.extensao}!)` : ''} | linha ${r.cabecalhoLinha ?? '—'} | ${col} | ${r.linhasFisicas} | ${r.linhasDados} | ${r.linhasComErro} | ${r.linhasComAlerta} |`,
    );
  }

  L.push('\n## Detalhe por arquivo\n');
  for (const r of reports) {
    L.push(`### ${r.arquivo}`);
    if (!r.ok && r.erro) {
      L.push(`- ❌ **Não foi possível ler:** ${r.erro}\n`);
      continue;
    }
    if (r.tipo === ReportType.UNKNOWN) {
      L.push('- ⚠️ **Tipo NÃO identificado automaticamente.** Candidatos por conteúdo:');
      for (const c of r.candidatos ?? []) L.push(`  - ${c.tipo}: ${(c.score * 100).toFixed(0)}%`);
      L.push('  Selecione o tipo manualmente na tela ao importar.');
    }
    L.push(`- Tipo: **${REPORT_TYPE_LABELS[r.tipo!]}** (confiança ${(r.confianca! * 100).toFixed(0)}%${r.usouDicaNome ? ', desempate pelo nome do arquivo' : ''})`);
    L.push(`- Formato real: ${r.formatoReal}${r.extensaoDivergente ? ` — ⚠️ extensão .${r.extensao} divergente do conteúdo` : ''}`);
    L.push(`- Aba: ${r.aba ?? '—'} · Cabeçalho: linha ${r.cabecalhoLinha ?? '—'} · Colunas: ${r.colunas}${r.colunasEsperadas && r.colunas !== r.colunasEsperadas ? ` — ⚠️ esperado ${r.colunasEsperadas} (inspeção)` : ''}`);
    L.push(`- Linhas físicas: ${r.linhasFisicas} · linhas de dados: ${r.linhasDados} · período: ${r.periodo}`);
    L.push(`- Linhas com erro: ${r.linhasComErro} · com alerta: ${r.linhasComAlerta}`);
    L.push(`- Hash do arquivo: \`${r.hash}\``);
    if (r.amostraErros && r.amostraErros.length) {
      L.push('- Amostra de erros:');
      for (const e of r.amostraErros) L.push(`  - ${e}`);
    }
    if (r.previa && r.previa.length) {
      L.push('- Prévia (3 primeiras linhas, 6 primeiras colunas):');
      L.push('```json');
      L.push(JSON.stringify(r.previa, null, 2));
      L.push('```');
    }
    L.push('');
  }
  return L.join('\n');
}

function main() {
  const arg = process.argv.slice(2).find((a) => a !== '--');
  const dir = arg || './homologacao';
  const abs = path.resolve(process.cwd(), dir);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
    console.error(`Pasta não encontrada: ${abs}`);
    console.error('Uso: tsx apps/api/scripts/homologar.ts <pasta-com-os-arquivos-reais>');
    process.exit(1);
  }
  const files = fs
    .readdirSync(abs)
    .filter((f) => SUPPORTED.test(f))
    .map((f) => path.join(abs, f))
    .sort();
  if (files.length === 0) {
    console.error(`Nenhum arquivo .csv/.xls/.xlsx em ${abs}`);
    process.exit(1);
  }

  console.log(`Homologando ${files.length} arquivo(s) em ${abs}\n`);
  const reports = files.map((f) => {
    const r = analisar(f);
    const flag = !r.ok ? '❌' : r.linhasComErro ? '⚠️ ' : '✓';
    const tipo = r.tipo ? REPORT_TYPE_LABELS[r.tipo] : (r.erro ?? 'falha');
    console.log(`${flag} ${r.arquivo} → ${tipo}${r.ok ? ` (${(r.confianca! * 100).toFixed(0)}%, cab. linha ${r.cabecalhoLinha}, ${r.linhasDados} linhas, ${r.linhasComErro} erros)` : ''}`);
    return r;
  });

  const out = path.join(abs, 'homologacao-resultado.md');
  fs.writeFileSync(out, fmtReport(reports));
  console.log(`\nRelatório salvo em: ${out}`);
  console.log('Se algo divergir (tipo errado, cabeçalho não encontrado, colunas a menos,');
  console.log('erros de parsing), me envie este arquivo que eu corrijo no Bloco 2.');

  const problemas = reports.filter((r) => !r.ok || (r.linhasComErro ?? 0) > 0);
  if (problemas.length) {
    console.log(`\n${problemas.length} arquivo(s) com pontos de atenção — veja o relatório.`);
  } else {
    console.log('\nTodos os arquivos foram lidos e identificados sem erros de parsing. ✓');
  }
}

main();
