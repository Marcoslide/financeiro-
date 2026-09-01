import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ui = readFileSync(resolve(__dirname, '../../scripts/sistema-app-ui.js'), 'utf8');
const shell = readFileSync(resolve(__dirname, '../../scripts/sistema-app-shell.html'), 'utf8');

function functionFromUi(name: string): (...args: any[]) => any {
  const start = ui.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`Função ${name} não encontrada`);
  const open = ui.indexOf('{', start);
  let depth = 0;
  for (let index = open; index < ui.length; index += 1) {
    if (ui[index] === '{') depth += 1;
    if (ui[index] === '}') depth -= 1;
    if (depth === 0) {
      const source = ui.slice(start, index + 1);
      return new Function(`return (${source});`)();
    }
  }
  throw new Error(`Fim da função ${name} não encontrado`);
}

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
    expect(ui).toContain("var next = '#/' + route + (params.toString() ? '?' + params.toString() : '');");
    expect(ui).toContain('restoreRouteUiState(); persistRouteUiState();');
    expect(ui).toContain("if (route === 'configuracoes') return configSub;");
    expect(ui).toContain("if (route === 'produtos' && Produtos && Produtos.getTab) return Produtos.getTab();");
  });

  it('centraliza configurações sem criar stores ou cadastros paralelos', () => {
    expect(shell).toContain('data-route="configuracoes"');
    expect(ui).toContain('function renderConfiguracoes()');
    expect(ui).toContain("cpSub = tab;");
    expect(ui).toContain("crSub = 'classificacoes';");
    expect(ui).toContain('fatorSubView(tab, opId)');
    expect(ui).toContain("precSub = 'regras';");
    expect(ui).toContain('openGerenciarBancos(function () { render(); });');
    expect(ui).toContain('openGerenciarOperacoes;');
    expect(ui).not.toContain("openDB('configuracoes");
  });

  it('reduz abas operacionais e mantém atalhos para a fonte oficial', () => {
    const cpTabs = ui.slice(ui.indexOf('function cpTabsHtml'), ui.indexOf('function renderContasPagar'));
    expect(cpTabs).toContain("['lista', 'Contas a pagar'], ['dre', 'DRE de Despesas']");
    expect(cpTabs).toContain('data-cp-config');
    expect(cpTabs).not.toContain("['categorias', 'Categorias']");
    const crScreen = ui.slice(ui.indexOf('function renderContasReceber'), ui.indexOf('function crRenderBody'));
    expect(crScreen).toContain('data-cr-config');
    expect(crScreen).not.toContain("['classificacoes', 'Classificações']");
  });

  it('ordena Pedidos exatamente como Dashboard, Pedidos, Expedição e Importações', () => {
    const screen = ui.slice(ui.indexOf('function renderPedidos'), ui.indexOf('function bindPedidosDashboard'));
    const dashboard = screen.indexOf("subtab('pedidos', 'dashboard', 'Dashboard')");
    const pedidos = screen.indexOf("subtab('pedidos', 'pedidos', 'Pedidos')");
    const expedicao = screen.indexOf("subtab('pedidos', 'expedicao', 'Expedição')");
    const imports = screen.indexOf("subtab('pedidos', 'import', 'Importações')");
    expect(dashboard).toBeGreaterThanOrEqual(0);
    expect(dashboard).toBeLessThan(pedidos);
    expect(pedidos).toBeLessThan(expedicao);
    expect(expedicao).toBeLessThan(imports);
  });

  it('gera parcelamento em meses e preserva fechamento de mês', () => {
    expect(ui).toContain("if (occ.type === 'PARCELADA') venc = cpAddMonths(first, i);");
    expect(ui).toContain('Math.min(day, last)');
  });

  it('usa o primeiro vencimento como fonte do dia semanal sem deslocamento silencioso', () => {
    expect(ui).toContain("if (occ.type === 'SEMANAL') occ.weekDay = cpWeekdayFromDate(first)");
    expect(ui).toContain('id="cp-occ-week-info"');
    expect(ui).toContain('function cpWeeklyPhrase');
    expect(ui).toContain("return 'Repete ' + article");
    expect(ui).not.toContain('id="cp-occ-week"');
    const generator = ui.slice(ui.indexOf('function cpGenerateOccurrenceDrafts'), ui.indexOf('// ---- importação de XML'));
    expect(generator).not.toContain('cpAlignWeekday');
  });

  it('pede confirmação visual antes de ajustar fim de semana para dia útil', () => {
    expect(ui).toContain('Primeiro vencimento em fim de semana');
    expect(ui).toContain('Ajustar para o próximo dia útil');
    expect(ui).toContain('draft.occurrence.onlyBusinessDays = false; occUteis.checked = false;');
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

  it('conciliação retroativa reutiliza os motores oficiais e bloqueia duplicidade/futuro', () => {
    expect(ui).toContain('function openBankReconciliationModal');
    expect(ui).toContain('reconciliationRefExists(ref)');
    expect(ui).toContain('return crRegistrarBaixa(titleId');
    expect(ui).toContain('return cpRegistrarBaixa(titleId');
    expect(ui).toContain('A data do movimento não pode ser futura.');
    expect(ui).toContain("origin: dto.reconciliation ? 'Conciliação Bancária'");
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
    expect(ui).toContain('function cpCategoryLinks');
    expect(ui).toContain('function crCategoryLinks');
    expect(ui).toContain('function fatorFuncionarioLinks');
  });

  it('modais destrutivos têm foco seguro, Esc e bloqueio de clique duplo', () => {
    expect(ui).toContain('setTimeout(function () { if (!closed && cancelBtn) cancelBtn.focus(); }, 0);');
    expect(ui).toContain("if (e.key !== 'Escape') return;");
    expect(ui).toContain('if (loading) return; // bloqueio de duplo clique');
    expect(shell).toContain('.btn-sm.danger');
  });

  it('valida campos financeiros obrigatórios em um resumo único', () => {
    expect(ui).toContain('function showFormErrors');
    expect(ui).toContain('id="cp-form-errors"');
    expect(ui).toContain('id="crb-err"');
    expect(shell).toContain('.field-invalid');
  });

  it('sugere recebimento em tempo real sem alterar a fórmula oficial', () => {
    expect(ui).toContain('var suggested = r2(saldo - discount + interest + fine + addition);');
    expect(ui).toContain('if (fromModifier && !manualValue)');
    expect(ui).toContain('Principal amortizado');
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

  it('reimporta Income atualizando fatos existentes sem duplicar pedidos', () => {
    expect(ui).toContain('function mrIncomeRowChanged(existing, parsed)');
    expect(ui).toContain('if (mrIncomeRowChanged(exR, row))');
    expect(ui).toContain('stats.rendaUpd++');
    expect(ui).toContain('upd: stats.rendaUpd');
    const changed = functionFromUi('mrIncomeRowChanged');
    const existing = { id: 'op|pedido|Order|||-|0', liberado: 45300 };
    const parsed = { liberado: 45300, afiliado: -9960 };
    expect(changed(existing, parsed)).toBe(true);
    Object.assign(existing, parsed);
    expect(existing).toEqual({ id: 'op|pedido|Order|||-|0', liberado: 45300, afiliado: -9960 });
  });

  it('abre taxa por item em bruto e ajuste comercial sem alterar o total líquido', () => {
    expect(ui).toContain('var serviceAdjustment = mrRow.servico - mrRow.servicoBruta;');
    expect(ui).toContain('var grossItem = svcT.porItem - serviceAdjustment;');
    expect(ui).toContain('svcResolve.found && svcT.porItem && mrRow');
    expect(ui).toContain("key: 'svc_commercial_adjustment'");
    expect(ui).toContain('displayChildren: displayChildren');
    expect(ui).toContain('(sf.displayChildren || sf.children || []).map');
    expect(ui).toContain('var svcDiagChildren = comp.serviceFee ? (comp.serviceFee.displayChildren || comp.serviceFee.children || []) : [];');
    const build = functionFromUi('buildServiceFeeComposition');
    const result = build(
      { servico: -2502, servicoBruta: -3061 },
      {
        found: true,
        totals: { afiliadosVendedor: 0, transacao: -461, porItem: -2041 },
        totalComponentes: -2502,
      },
      null,
    );
    expect(result.total).toBe(-2502);
    expect(result.childrenTotal).toBe(-2502);
    expect(result.displayChildren.map((row: any) => [row.key, row.valor])).toEqual([
      ['svc_affiliate', 0],
      ['svc_transaction', -461],
      ['svc_per_item', -2600],
      ['svc_commercial_adjustment', 559],
    ]);
    expect(result.displayChildren.reduce((sum: number, row: any) => sum + row.valor, 0)).toBe(-2502);

    const withoutItemEvidence = build(
      { servico: -500, servicoBruta: -700 },
      {
        found: true,
        totals: { afiliadosVendedor: -300, transacao: -200, porItem: 0 },
        totalComponentes: -500,
      },
      null,
    );
    expect(withoutItemEvidence.displayChildren.map((row: any) => [row.key, row.valor])).toEqual([
      ['svc_affiliate', -300],
      ['svc_transaction', -200],
      ['svc_per_item', 0],
    ]);
  });
});
