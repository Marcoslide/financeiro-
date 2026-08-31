import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ui = readFileSync(resolve(__dirname, '../../scripts/sistema-app-ui.js'), 'utf8');

describe('pacote operacional v1.1.1 — invariantes da interface única', () => {
  it('sincroniza automaticamente em intervalo curto sem exigir reload', () => {
    expect(ui).toContain('setInterval(poll, 4000)');
    expect(ui).toContain('workspaceReplaceLocal(row.storeName, fresh.payload)');
    expect(ui).toContain("toast('Dados atualizados'");
  });

  it('protege formulário aberto antes de aplicar atualização remota', () => {
    expect(ui).toContain('function hasActiveDraft()');
    expect(ui).toContain('A atualização automática será aplicada assim que você concluir o formulário aberto.');
  });

  it('persiste rota e subaba no hash', () => {
    expect(ui).toContain("var next = '#/' + route + (tab ? '?tab='");
    expect(ui).toContain('restoreRouteUiState(); persistRouteUiState();');
  });

  it('gera parcelamento em meses e preserva fechamento de mês', () => {
    expect(ui).toContain("if (occ.type === 'PARCELADA') venc = cpAddMonths(first, i);");
    expect(ui).toContain('Math.min(day, last)');
  });

  it('alinha recorrência semanal ao dia escolhido', () => {
    expect(ui).toContain("if (occ.type === 'SEMANAL') first = cpAlignWeekday");
    expect(ui).toContain('id="cp-occ-week"');
  });

  it('baixa manual de CP exige hoje e Conta Bancária', () => {
    expect(ui).toContain('A data do pagamento manual deve ser a data de hoje.');
    expect(ui).toContain('Selecione a Conta Bancária do pagamento.');
  });

  it('Salvar e Dar Baixa abre o mesmo modal canônico', () => {
    expect(ui).toContain("if (andBaixa && saved) openCpBaixaModal(saved.id, 'total');");
  });

  it('conciliação preserva data anterior, referência e origem', () => {
    expect(ui).toContain('cpCorrigirDataPagamentoConciliacao');
    expect(ui).toContain("origin: 'Conciliação Bancária'");
    expect(ui).toContain('oldDate: oldDate, newDate: newDate, movementRef:');
  });

  it('recebimento bloqueia futuro com a mensagem aprovada', () => {
    expect(ui.match(/A data do recebimento não pode ser futura\./g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('recebimento mantém decomposição completa', () => {
    expect(ui).toContain('valorOriginal: r2(h.valor || 0)');
    expect(ui).toContain('juros: r2(dto.juros || 0)');
    expect(ui).toContain('multa: r2(dto.multa || 0)');
    expect(ui).toContain('acrescimo: r2(dto.acrescimo || 0)');
  });

  it('amortização de CR separa principal dos acréscimos', () => {
    expect(ui).toContain('(p.valorRecebido || 0) + (p.desconto || 0) - (p.juros || 0) - (p.multa || 0) - (p.acrescimo || 0)');
  });

  it('categoria de CP permite seleção filtrada e ações em massa', () => {
    expect(ui).toContain('Selecionar resultados filtrados');
    expect(ui).toContain('id="cpcat-on"');
    expect(ui).toContain('id="cpcat-off"');
    expect(ui).toContain('id="cpcat-del"');
  });

  it('remoção de categoria usada é lógica e preserva histórico', () => {
    expect(ui).toContain("if (used) { c.active = false;");
  });

  it('categoria usa somente Nome, Centro e Conta Contábil no editor', () => {
    const editor = ui.slice(ui.indexOf('function openCpCategoryEditor'), ui.indexOf('function renderCpPlanoContasTab'));
    expect(editor).toContain('Conta Contábil');
    expect(editor).not.toContain('Categoria pai');
  });

  it('retira o painel Avançado — Plano de Contas do lançamento', () => {
    const paymentTab = ui.slice(ui.indexOf('function cpTabPagamento'), ui.indexOf('function cpTabOcorrencia'));
    expect(paymentTab).not.toContain('Avançado — Plano de Contas');
  });

  it('propaga categoria do cabeçalho só para item vazio ou autofill', () => {
    expect(ui).toContain('!it.categoryId || it.categoryAutoFilled === true');
    expect(ui).toContain('it.categoryAutoFilled = false');
  });

  it('não fecha os três editores inline por blur', () => {
    const inline = ui.slice(ui.indexOf('function editVarFamily'), ui.indexOf('function confirmModal'));
    expect(inline).not.toContain('.onblur');
  });

  it('filtra bancos pela empresa e operação atuais', () => {
    expect(ui).toContain('var sameCompany = b.companyId ? b.companyId === compId : legacySafe;');
    expect(ui).toContain('var sameOperation = !b.operationId || b.operationId === opId;');
  });
});
