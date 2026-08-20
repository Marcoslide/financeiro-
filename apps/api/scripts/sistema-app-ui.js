/*
 * Sistema Marketplace — Líder · aplicação única (protótipo navegável, 100% local).
 * TODOS os módulos juntos e completos: Produtos (master→variações, filtros, seleção
 * em massa, edição inline, famílias com histórico, paginação), Pedidos, Pós-venda,
 * Dashboard e Inteligência. Usa os MESMOS parsers/regras do backend (window.SISTEMA)
 * e persiste em IndexedDB. Integrações reais: Produtos→(família/custo)→Pedidos (lucro)
 * e Pedidos↔Pós-venda pelo ID do pedido. Nenhum dado sai do navegador.
 *
 * REGRA DO PROJETO: desenvolvimento cumulativo — módulo novo nunca empobrece módulo
 * existente. Este arquivo é sempre a versão acumulada mais completa de TODO o sistema.
 */
(function () {
  'use strict';
  var S = window.SISTEMA;
  var app = document.getElementById('app');
  var crumb = document.getElementById('crumb');
  var periodSel = document.getElementById('period');

  // ---------- estado compartilhado ----------
  var route = 'dashboard', DB = null;
  var orders = [], occ = [], batches = [], plans = [];
  var skuCost = {}; // sku(lower) -> { linked:true, cost:number|null, familyName:string|null }
  var lastImportStamp = null; // "Atualizado com dados até…" (§31)
  var wallet = [];            // extrato da carteira (linhas SHOPEE; reconstruídas são calculadas)
  var walletCls = {};         // classificação INTERNA por id (separada do dado Shopee; preservada na reimportação)
  var walletSub = 'visao';    // sub-aba da Carteira: visao | mov | ajustes
  var walletF = { search: '', cat: '', flow: '' }; // filtros da tabela de movimentações
  var walletStamp = null;     // "atualizado até" da carteira
  var Produtos = null;
  var sub = { pedidos: 'pedidos', posvenda: 'visao' };
  var pedTab = 'ALL';
  var devF = { search: '', internalStatus: '', disputeStatus: '', type: '', status: '', flag: '', jornada: '', motivo: '', fase: '' }, devPage = 1;
  // Shopee Acelera / Antecipação de Recebíveis
  var acelera = [];                 // registros pedido-a-pedido do relatório de antecipação
  var aceleraSummary = null;        // resumo informado pela própria Shopee (para conciliar)
  var aceleraSub = 'visao';         // sub-aba do módulo
  var aceleraPage = 1;
  var aceleraF = { search: '', aliq: '', divCat: '' };
  var aceleraSel = { resgate: null };
  // Refatoração completa do Acelera: fora vai capital/coorte/custo de oportunidade — o módulo vira
  // conciliação pura (Expedição → Antecipação → Taxa → Líquido → Conferência). Únicas premissas que
  // sobrevivem: tolerância de alíquota (deduplicação de arredondamento) e janela de "aguardando
  // antecipação" antes de marcar um pedido expedido como não encontrado (§16 do prompt de refatoração).
  var aceleraCfg = { tolAliquota: 0.0015, aguardandoDias: 3 };
  // Afiliados
  var affConv = [], affRpa = [], affVb = [], affMaster = {};
  var affSub = 'visao', affPage = 1;
  var affF = { search: '', channel: '', status: '', ded: '', region: '', basis: 'venda', rateMin: null };
  var affSel = null;
  var affCfg = { rateAlert: 0.15, tolConcil: 100, minPedidos: 5, margemBoa: 0.15, margemAperta: 0.05 };
  // Minha Renda
  var mrRenda = [], mrShip = [], mrAdj = [], mrSvc = [], mrPdf = [], mrSummary = null;
  var mrSub = 'visao', mrPage = 1, mrF = { search: '', motivo: '', invest: '' };
  // gerada=false → modo planejamento (o usuário ainda está ajustando valor/período, nada "trava").
  // "Gerar Meta" (§33) congela periodMode='custom' com as datas resolvidas naquele momento e grava
  // um retrato da margem/faturamento necessário usados na criação, para detectar deriva depois (§39).
  var mrMetaCfg = { lucroAlvo: 0, periodMode: 'mes_atual', customFrom: null, customTo: null, gerada: false, nome: '', geradaEm: null, margemNaCriacao: null, faturamentoNecessarioNaCriacao: null };
  var mrProdCfg = { margemMeta: 0.10 }; // meta padrão de margem para classificar "abaixo da meta" (§41 do prompt de reorganização)
  var mrProdFilter = 'todos'; // filtro rápido da tabela de Produtos e SKUs (§9-13 do prompt de alterações pontuais)
  var mrTaxasSort = 'valor'; // ordenação da tabela de Taxas Shopee (§6 do prompt de alterações pontuais)
  // Expedição / Bipe (Pedidos): registro de saída física, chave = ID do pedido (idempotente).
  var shipBip = {};   // orderId -> { id, orderId, bipedAt, bipedBy, note, history: [] }
  // §33: Full/FBS é logística da própria Shopee — por padrão NÃO entra na fila de expedição própria
  // (evita confundir "precisa sair fisicamente daqui" com pedidos que o centro de distribuição da
  // Shopee já resolve). "Incluir Full" liga de volta quando for útil analisar tudo junto.
  var pedExpF = { search: '', status: '', includeFull: false };
  var devSel = {};            // seleção múltipla em Casos: id -> true (em memória)
  var devCustomStatus = [];   // status internos personalizados pelo operador: [{key,label}]
  var chat = [];

  // ---------- helpers ----------
  function esc(s) { return (s == null ? '' : String(s)).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function nn(n) { return (n || 0).toLocaleString('pt-BR'); }
  function brl(v) { return (v == null || isNaN(v)) ? 'R$ 0,00' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
  function pct(v) { return v == null ? '—' : (Math.round(v * 100) / 100).toLocaleString('pt-BR') + '%'; }
  function num(s) { return s == null || s === '' ? 0 : Number(s); }
  function dbr(d) { if (!d) return '—'; var x = new Date(d); return isNaN(x) ? '—' : x.toLocaleDateString('pt-BR'); }
  function toast(title, body, err) { var el = document.createElement('div'); el.className = 'toast' + (err ? ' err' : ''); el.innerHTML = '<div class="tt">' + esc(title) + '</div><div>' + esc(body) + '</div>'; document.body.appendChild(el); setTimeout(function () { el.remove(); }, 6000); }

  // ===== Devolução — estado operacional + impacto determinístico (mesmas regras do backend) =====
  var DEV = {
    INTERNAL_STATUS: { NOVA: 'Nova', ANALISE: 'Em análise', AGUARDANDO_EVIDENCIA: 'Aguardando evidência', AGUARDANDO_RETORNO: 'Aguardando retorno', EM_TRANSITO: 'Produto em trânsito', RECEBIDO: 'Produto recebido', EM_DISPUTA: 'Em disputa', AGUARDANDO_RESULTADO: 'Aguardando resultado', RESOLVIDA: 'Resolvida', ENCERRADA: 'Encerrada', EXIGE_ACAO: 'Exige ação' },
    PRIORITY: { BAIXA: 'Baixa', MEDIA: 'Média', ALTA: 'Alta', URGENTE: 'Urgente' },
    RESPONSIBILITY: { OPERACAO: 'Nossa operação', SHOPEE: 'Shopee', LOGISTICA: 'Transportadora / logística', COMPRADOR: 'Comprador', COMPARTILHADA: 'Compartilhada', NAO_IDENTIFICADA: 'Não identificada' },
    MERCH_STATUS: { DESCONHECIDO: 'Não sabemos', CLIENTE_POSSUI: 'Cliente ainda possui', RETORNO_DISPENSADO: 'Retorno dispensado', AGUARDANDO_POSTAGEM: 'Aguardando postagem', EM_TRANSITO: 'Em trânsito', RECEBIDO: 'Recebido', EXTRAVIADO: 'Extraviado', PERDIDO: 'Perdido' },
    MERCH_COND: { REAPROVEITAVEL: 'Reaproveitável', REQUER_RETRABALHO: 'Requer retrabalho', AVARIADO: 'Avariado', PERDA_TOTAL: 'Perda total' },
    DISPUTE_STATUS: { NAO_INICIADA: 'Não iniciada', POSSIVEL: 'Possível contestação', EM_PREPARACAO: 'Em preparação', RESPONDIDA: 'Respondida', AGUARDANDO_SHOPEE: 'Aguardando Shopee', GANHA: 'Ganha', PARCIAL: 'Parcialmente ganha', PERDIDA: 'Perdida', PRAZO_PERDIDO: 'Prazo perdido', CANCELADA: 'Cancelada' },
    CAUSE_LABELS: { AVARIA: 'Avaria / quebra', SEPARACAO: 'Erro de separação', ARREPENDIMENTO: 'Arrependimento', LOGISTICA: 'Logística / extravio', QUALIDADE: 'Qualidade', SEM_MOTIVO: 'Sem motivo identificado' },
  };
  // Status interno EFETIVO = fixos (referenciados por automações) + personalizados pelo operador (§Casos).
  function internalStatusMap() { var m = {}; Object.keys(DEV.INTERNAL_STATUS).forEach(function (k) { m[k] = DEV.INTERNAL_STATUS[k]; }); devCustomStatus.forEach(function (s) { if (s && s.key) m[s.key] = s.label; }); return m; }
  function istLabel(k) { return internalStatusMap()[k] || k; }
  function istSlug(label) { return 'CUSTOM_' + normStatus(label).replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toUpperCase(); }
  function saveDevSettings() { return putMany('settings', [{ id: 'dev', customStatus: devCustomStatus }]); }
  var EVENT_META = {
    REEMBOLSO_SOLICITADO: { label: 'Reembolso solicitado', direction: 'NEUTRAL', bucket: 'none' },
    REEMBOLSO_PAGO: { label: 'Reembolso pago', direction: 'COST', bucket: 'refund' },
    FRETE_REVERSO: { label: 'Frete reverso', direction: 'COST', bucket: 'additional' },
    FRETE_ADICIONAL: { label: 'Frete adicional', direction: 'COST', bucket: 'additional' },
    CUSTO_RETRABALHO: { label: 'Custo de retrabalho', direction: 'COST', bucket: 'additional' },
    PRODUTO_PERDIDO: { label: 'Produto perdido', direction: 'COST', bucket: 'additional' },
    COMPENSACAO_SHOPEE: { label: 'Compensação Shopee', direction: 'RECOVERY', bucket: 'recovery' },
    RECUPERACAO_DISPUTA: { label: 'Recuperação de disputa', direction: 'RECOVERY', bucket: 'recovery' },
    PRODUTO_RECUPERADO: { label: 'Produto recuperado', direction: 'RECOVERY', bucket: 'recovery' },
    AJUSTE_MANUAL: { label: 'Ajuste manual', direction: 'NEUTRAL', bucket: 'none' },
    OUTRO: { label: 'Outro', direction: 'NEUTRAL', bucket: 'none' },
  };
  function r2(n) { return Math.round(n * 100) / 100; }
  function newOcc(uid, type) { return { id: uid, type: type, internalStatus: 'NOVA', priority: 'MEDIA', ownerName: null, internalCause: null, causeFamily: null, responsibility: 'NAO_IDENTIFICADA', merchandiseStatus: 'DESCONHECIDO', merchandiseCondition: null, recoverableValue: null, operatorNotes: null, hasDispute: false, disputeStatus: 'NAO_INICIADA', disputeDeadline: null, disputeRespondedAt: null, hasSellerWindow: false, disputeRecovered: null, disputeContested: null, disputeNote: null, disputeReason: null, reasonRevised: null, resolution: null, returnType: null, sellerNote: null, trackingStatus: null, tracking: null, occurredAt: null, orderCreatedAt: null, returnOpenedAt: null, sourceWatermark: null, lastImportAt: null, lastImportFile: null, isDemo: false, receiptState: null, receiptItems: null, receivedBy: null, receivedAt: null, receiptNote: null, events: [], activities: [], impact: { refundedTotal: 0, additionalCostTotal: 0, recoveredTotal: 0, knownNetImpact: 0, cmvAvailable: false }, lastStatusAdvanceAt: null, lastViewedAt: null, needsReview: false }; }
  // Catálogo de status observados no campo "Status da Devolução / Reembolso" (§5,9,61).
  // Rótulo curto para apresentação; o TEXTO ORIGINAL é sempre preservado em o.status.
  function normStatus(s) { return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase(); }
  var SHOPEE_STATUS_MAP = {
    'em analise pela shopee': { label: 'Em análise', group: 'analise' },
    'em devolucao': { label: 'Em devolução', group: 'devolucao' },
    'aprovada': { label: 'Aprovada', group: 'aprovada' },
    'solicitacao cancelada pelo comprador': { label: 'Cancelada', group: 'cancelada' },
    'retornado - pendente validacao do vendedor': { label: 'Retornado — validar', group: 'validar' },
    'pendente validacao do vendedor': { label: 'Pendente validação', group: 'validar' },
    'organizando a coleta': { label: 'Organizando coleta', group: 'coleta' },
    'reembolso concluido': { label: 'Reembolso concluído', group: 'aprovada' },
    'disputa rejeitada pela shopee': { label: 'Disputa rejeitada', group: 'disputa' },
    'cancelamento solicitado': { label: 'Cancelamento solicitado', group: 'solicitado' },
    'cancelado': { label: 'Cancelado', group: 'cancelado' },
  };
  var SHOPEE_STATUS_KNOWN = SHOPEE_STATUS_MAP; // alias para a checagem de "status novo"
  function statusLabel(raw) { var m = SHOPEE_STATUS_MAP[normStatus(raw)]; return m ? m.label : (raw || '—'); }

  // ---- Motor de transição de estados (§15-21 do prompt de remodelação de Devolução) ----
  // Modelo: dados internos (status/decisão/notas/provas) PERSISTEM entre importações; eventos
  // objetivos vindos da Shopee podem AVANÇAR o fluxo automaticamente, NUNCA retroceder, e só quando
  // o texto do status é reconhecido com segurança (SHOPEE_STATUS_MAP). Status internos personalizados
  // (CUSTOM_...) nunca são tocados pelo motor — fora da ordem conhecida, ficam sob controle manual.
  var IST_ORDER = ['NOVA', 'ANALISE', 'AGUARDANDO_EVIDENCIA', 'EM_DISPUTA', 'AGUARDANDO_RESULTADO', 'AGUARDANDO_RETORNO', 'EM_TRANSITO', 'RECEBIDO', 'RESOLVIDA', 'ENCERRADA'];
  var SHOPEE_GROUP_TO_IST = { analise: 'AGUARDANDO_RESULTADO', solicitado: 'ANALISE', devolucao: 'AGUARDANDO_RETORNO', validar: 'AGUARDANDO_RETORNO', coleta: 'AGUARDANDO_RETORNO', aprovada: 'RESOLVIDA', disputa: 'ENCERRADA', cancelado: 'ENCERRADA', cancelada: 'ENCERRADA' };
  function aplicarTransicaoAutomatica(o) {
    var mapped = SHOPEE_STATUS_MAP[normStatus(o.status)];
    var grp = mapped ? mapped.group : null;
    // §18-19: rejeição de disputa é o único sinal objetivo o bastante para fechar o resultado da
    // disputa sozinho — "aprovada" nunca decide disputa automaticamente (pode não ter sido nossa disputa).
    if (o.hasDispute && grp === 'disputa' && ['POSSIVEL', 'EM_PREPARACAO', 'RESPONDIDA', 'AGUARDANDO_SHOPEE'].indexOf(o.disputeStatus) >= 0) o.disputeStatus = 'PERDIDA';
    var sugestao = grp ? SHOPEE_GROUP_TO_IST[grp] : null;
    if (!sugestao) { o.needsReview = true; return; } // §21: status não reconhecido — nunca decide sozinho, só sinaliza revisão
    var curIdx = IST_ORDER.indexOf(o.internalStatus), sugIdx = IST_ORDER.indexOf(sugestao);
    if (curIdx < 0 || sugIdx < 0) return; // status interno customizado (CUSTOM_...) — motor não mexe
    if (sugIdx > curIdx) { o.internalStatus = sugestao; o.needsReview = false; }
  }
  // Casos DEMO isolados (§10-12): só existem para validar a interface de disputa. isDemo=true.
  // Nunca entram em cálculos, banco real, KPIs, análises. Fáceis de remover: apague este bloco.
  function makeDemoOcc(id, status, deadlineOffset, trkN, trkS, reason, product, sku, amount) {
    var o = newOcc('demo:' + id, 'RETURN_REFUND'); o.isDemo = true; o.returnId = id; o.orderId = 'PED-' + id;
    o.status = status; o.reason = reason; o.disputeReason = 'Avaria no transporte — contesto a responsabilidade da devolução';
    o.sellerNote = 'Enviado com proteção reforçada; a avaria não condiz com nosso padrão de expedição.';
    o.tracking = trkN; o.trackingStatus = trkS; o.requested = amount; o.compensation = 0;
    var now = Date.now(); o.occurredAt = new Date(now - 3 * 864e5).toISOString(); o.orderCreatedAt = new Date(now - 16 * 864e5).toISOString(); o.returnOpenedAt = o.occurredAt;
    if (deadlineOffset != null) { o.disputeDeadline = new Date(now + deadlineOffset * 864e5).toISOString(); o.hasSellerWindow = true; }
    o.items = [{ sku: sku, productName: product, variationName: 'Com vidro', qty: 1, unitPrice: String(amount), skuLinked: false }];
    finalizeOcc(o); return o;
  }
  function DEMO_CASES() {
    return [
      makeDemoOcc('DEMO-DISP-001', 'Em análise pela Shopee', 2, 'BRDEMO01', 'Retirada bem-sucedida', 'Produto chegou quebrado', 'Quadro 80x120 Preto com moldura reforçada', 'DEMO-QD-80120', 320),
      makeDemoOcc('DEMO-DISP-002', 'Em devolução', 0, 'BRDEMO02', 'O remetente está se preparando para enviar', 'Item com defeito de fabricação', 'Espelho Redondo 70cm', 'DEMO-ESP-70', 180),
      makeDemoOcc('DEMO-DISP-003', 'Disputa rejeitada pela Shopee', -1, 'BRDEMO03', 'Devolução concluída', 'Não reconheço a compra', 'Kit 3 Quadros Decorativos', 'DEMO-KIT-3', 260),
      makeDemoOcc('DEMO-DISP-004', 'Aprovada', 5, 'BRDEMO04', 'Retirada bem-sucedida', 'Arrependimento da compra', 'Quadro 60x90 Branco', 'DEMO-QD-6090', 150),
    ];
  }
  // Recebimento físico (§9-§21): estado da devolução na EMPRESA (≠ status Shopee).
  var RECEIPT_LABELS = { AGUARDANDO_POSTAGEM: 'Aguardando postagem', EM_TRANSITO: 'Em trânsito', ATRASADO: 'Atrasado', SEM_RASTREIO: 'Sem rastreio', CHEGOU_CONFERIR: 'Chegou — falta conferir', PARCIAL: 'Recebimento parcial', DIVERGENCIA: 'Divergência', RECEBIDO: 'Recebido e conferido', NAO_RETORNOU: 'Não retornou', EXTRAVIADO: 'Extraviado', DISPENSADO: 'Retorno dispensado' };
  var COND_LABELS = { INTEGRO: 'Íntegro', REAPROVEITAVEL: 'Reaproveitável', RETRABALHO: 'Precisa de retrabalho', AVARIADO: 'Avariado', PERDA_TOTAL: 'Perda total', DIFERENTE: 'Produto diferente', NAO_RECEBIDO: 'Não recebido' };
  function daysWaiting(o) { if (!o.occurredAt) return 0; return Math.max(0, Math.floor((Date.now() - new Date(o.occurredAt).getTime()) / 864e5)); }
  function expectsReturn(o) { return o.type === 'RETURN_REFUND' && o.receiptState !== 'DISPENSADO'; }
  function initReceipt(o) { if (o.receiptState) return; if (o.type !== 'RETURN_REFUND') { o.receiptState = 'DISPENSADO'; return; } var d = daysWaiting(o); o.receiptState = o.tracking ? 'EM_TRANSITO' : (d > 14 ? 'ATRASADO' : 'AGUARDANDO_POSTAGEM'); }
  function receiptDone(o) { return o.receiptState === 'RECEBIDO' || o.receiptState === 'DISPENSADO' || o.receiptState === 'NAO_RETORNOU' || o.receiptState === 'EXTRAVIADO'; }
  function computeImpact(events, recoverable) { var refunded = 0, additional = 0, recovery = 0; (events || []).forEach(function (e) { var m = EVENT_META[e.type] || {}; var b = m.bucket || (e.direction === 'COST' ? 'additional' : e.direction === 'RECOVERY' ? 'recovery' : 'none'); var a = e.amount || 0; if (b === 'refund') refunded += a; else if (b === 'additional') additional += a; else if (b === 'recovery') recovery += a; }); recovery += recoverable || 0; return { refundedTotal: r2(refunded), additionalCostTotal: r2(additional), recoveredTotal: r2(recovery), knownNetImpact: r2(refunded + additional - recovery), cmvAvailable: false }; }
  function recomputeOccImpact(occ) { occ.impact = computeImpact(occ.events, occ.recoverableValue || 0); occ.knownNetImpact = occ.impact.knownNetImpact; return occ.impact; }
  function putEvent(occ, dedupeKey, type, direction, amount, source, note) { occ.events = occ.events || []; var ex = occ.events.find(function (e) { return e.dedupeKey === dedupeKey; }); if (ex) { ex.amount = amount; ex.type = type; ex.direction = direction; } else { occ.events.push({ id: 'e' + Date.now() + Math.round(Math.random() * 1e6), dedupeKey: dedupeKey, type: type, direction: direction, amount: amount, source: source || 'MANUAL', note: note || null, createdByName: source === 'IMPORT' ? 'Importação' : 'Operador', occurredAt: new Date().toISOString() }); } }
  function upsertImportEvents(occ, exposure, requested, compensation) { if (exposure.bucket === 'CONFIRMED' && requested > 0) putEvent(occ, 'import:refund', 'REEMBOLSO_PAGO', 'COST', requested, 'IMPORT'); if (compensation > 0) putEvent(occ, 'import:compensation', 'COMPENSACAO_SHOPEE', 'RECOVERY', compensation, 'IMPORT'); }
  function addActivity(occ, kind, data) { occ.activities = occ.activities || []; occ.activities.unshift(Object.assign({ id: 'a' + Date.now() + Math.round(Math.random() * 1e6), kind: kind, createdAt: new Date().toISOString() }, data)); }
  function occEffectiveLoss(o) { return Math.max(0, (o.impact && o.impact.knownNetImpact) || 0); }
  // Resultado provisório × confirmado (§24): antes da baixa, só temos o impacto financeiro (reembolso
  // menos compensação) — provisório. Depois de conferir e dar baixa (o.recuperacao, gravado em
  // confirmReceive), a perda confirmada usa custo real do produto − valor reaproveitável, mais
  // precisa. occEffectiveLoss() nunca muda de comportamento — isto é aditivo, consumido por quem
  // já sabe ler o campo novo (Ficha, Ficha 360, Financeiro), sem quebrar quem só usa o provisório.
  function occResultadoDevolucao(o) {
    if (o.recuperacao && ['RECEBIDO', 'PARCIAL', 'DIVERGENCIA'].indexOf(o.receiptState) >= 0) return { status: 'confirmado', perda: o.recuperacao.perdaConfirmada, custoTotal: o.recuperacao.custoTotal, valorReaproveitavel: o.recuperacao.valorReaproveitavel };
    return { status: 'provisorio', perda: occEffectiveLoss(o) };
  }
  function occGuessCause(o) { var s = (o.causeFamily || o.internalCause || o.reason || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); if (/quebr|avar|dano|trinc|rachad/.test(s)) return 'AVARIA'; if (/errad|troca|separac|item faltando|faltan|divergent/.test(s)) return 'SEPARACAO'; if (/arrepend|desist|nao quero|gostei/.test(s)) return 'ARREPENDIMENTO'; if (/entreg|extravi|transport|correi|logistic|nao recebi/.test(s)) return 'LOGISTICA'; if (/defeit|qualidade|funciona|apresent/.test(s)) return 'QUALIDADE'; return 'SEM_MOTIVO'; }
  function occApproved(o) { return /conclu|aprovad|reembols|pago|finaliz|sucesso|deferid/.test((o.status || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()); }
  function occGiveup(o) { return /cancel|desist|recus|rejeit/.test((o.status || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()); }
  function saveOcc(o) { if (o.isDemo) return Promise.resolve(); return putMany('occ', [o]); } // demo nunca vai ao banco real (§11)
  // Normaliza ocorrências salvas por versões anteriores (sem impact/events/campos operacionais),
  // para que a análise nunca quebre e o impacto reflita a exposição. Idempotente.
  function migrateOcc(o) {
    var m = Object.assign(newOcc(o.id, o.type), o);
    m.events = o.events || []; m.activities = o.activities || [];
    m.exposure = o.exposure || S.posVenda.classify(o.status || null, o.requested || 0, o.compensation || 0);
    upsertImportEvents(m, m.exposure, m.requested || 0, m.compensation || 0);
    recomputeOccImpact(m); initReceipt(m);
    return m;
  }

  // ---------- IndexedDB (auto-curável: nunca deixa o banco em estado que quebre a importação) ----------
  // Todos os módulos gravam no MESMO banco. Bancos criados por versões anteriores do
  // app (com menos stores, ou com a versão reaproveitada) são curados automaticamente:
  // abrimos SEM fixar versão (pega a versão atual do navegador — nunca dá VersionError),
  // conferimos se todos os stores existem e, se faltar algum, reabrimos bumpando a versão
  // para disparar o onupgradeneeded que cria o que falta. Além disso, toda transação passa
  // por ensureDB(): se o handle estiver nulo, ele reabre antes de usar — assim a importação
  // nunca falha com "Cannot read properties of null (reading 'transaction')".
  var STORES = { orders: 'id', occ: 'id', batches: 'id', products: 'id', variations: 'id', pfamilies: 'id', pimports: 'id', plans: 'id', wallet: 'id', walletcls: 'id', settings: 'id', acelera: 'id', affconv: 'id', affrpa: 'id', affvb: 'id', affmaster: 'id', mrrenda: 'id', mrship: 'id', mradj: 'id', mrsvc: 'id', mrpdf: 'id', shipbip: 'id' };
  var DB_NAME = 'sistema_marketplace';
  function createMissingStores(db) { Object.keys(STORES).forEach(function (s) { if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: STORES[s] }); }); }
  function missingStores(db) { return Object.keys(STORES).filter(function (s) { return !db.objectStoreNames.contains(s); }); }
  // Toda conexão bem-sucedida ganha onversionchange: se OUTRA aba precisar bumpar a versão
  // (ex.: para criar um store novo), esta aba fecha a conexão na hora — assim o upgrade nunca
  // fica bloqueado por uma aba antiga (era isso que travava a tela e a importação em silêncio).
  function attachHandlers(db) {
    db.onversionchange = function () { try { db.close(); } catch (e) { } if (DB === db) DB = null; };
    db.onclose = function () { if (DB === db) DB = null; };
    return db;
  }
  function rawOpen(version) {
    return new Promise(function (res, rej) {
      var r = version ? indexedDB.open(DB_NAME, version) : indexedDB.open(DB_NAME);
      var blockedTimer = null;
      r.onupgradeneeded = function () { createMissingStores(r.result); };
      r.onblocked = function () {
        // outra conexão (outra aba) segura a versão anterior. As abas atualizadas fecham sozinhas
        // (onversionchange); se mesmo assim não liberar em alguns segundos, falha com aviso claro
        // em vez de travar para sempre — a importação então mostra a mensagem no lugar do silêncio.
        if (blockedTimer) return;
        blockedTimer = setTimeout(function () { rej(new Error('Há outra aba deste sistema aberta com uma versão anterior. Feche as outras abas e recarregue esta página.')); }, 8000);
      };
      r.onsuccess = function () { if (blockedTimer) clearTimeout(blockedTimer); res(attachHandlers(r.result)); };
      r.onerror = function () { if (blockedTimer) clearTimeout(blockedTimer); rej(r.error || new Error('Falha ao abrir o banco local (IndexedDB).')); };
    });
  }
  var dbOpening = null; // serializa aberturas concorrentes (evita dois upgrades disputando)
  function openDB() {
    if (DB) return Promise.resolve();
    if (dbOpening) return dbOpening;
    dbOpening = rawOpen().then(function (db) {
      if (!missingStores(db).length) { DB = db; return; }
      var nextV = db.version + 1; db.close(); // força upgrade para criar os stores que faltam
      return rawOpen(nextV).then(function (db2) { DB = db2; });
    });
    var clear = function () { dbOpening = null; };
    dbOpening.then(clear, clear);
    return dbOpening;
  }
  // MODO TEMPORÁRIO (em memória): se o IndexedDB não abrir (corrompido, bloqueado, navegador
  // privado, cota), NUNCA deixamos a tela em branco. Caímos para armazenamento em memória — o
  // sistema todo (Produtos incluso) funciona; só não salva ao recarregar. Um aviso fica visível.
  var DB_MEM = null; // quando ativo: { store: { id: item } }
  function activateMemoryMode(reason) { if (DB_MEM) return; DB_MEM = {}; Object.keys(STORES).forEach(function (s) { DB_MEM[s] = {}; }); memModeReason = reason || ''; try { showMemBanner(); } catch (e) { } }
  var memModeReason = '';
  function ensureDB() {
    if (DB_MEM) return Promise.reject({ __mem: true });
    if (DB) return Promise.resolve(DB);
    return openDB().then(function () { return DB; }).catch(function (e) { activateMemoryMode(e && (e.message || '') || 'IndexedDB indisponível'); return Promise.reject({ __mem: true }); });
  }
  function getAll(store) { return ensureDB().then(function (db) { return new Promise(function (res, rej) { var rq = db.transaction(store).objectStore(store).getAll(); rq.onsuccess = function () { res(rq.result || []); }; rq.onerror = function () { rej(rq.error); }; }); }).catch(function (e) { if (e && e.__mem) return Object.keys(DB_MEM[store] || {}).map(function (k) { return DB_MEM[store][k]; }); throw e; }); }
  function putMany(store, items) { if (!items || !items.length) return Promise.resolve(); return ensureDB().then(function (db) { return new Promise(function (res, rej) { var tx = db.transaction(store, 'readwrite'); var os = tx.objectStore(store); items.forEach(function (it) { os.put(it); }); tx.oncomplete = function () { res(); }; tx.onerror = function () { rej(tx.error); }; }); }).catch(function (e) { if (e && e.__mem) { var key = STORES[store]; DB_MEM[store] = DB_MEM[store] || {}; items.forEach(function (it) { DB_MEM[store][it[key]] = it; }); return; } throw e; }); }
  function delOne(store, id) { return ensureDB().then(function (db) { return new Promise(function (res, rej) { var tx = db.transaction(store, 'readwrite'); tx.objectStore(store).delete(id); tx.oncomplete = function () { res(); }; tx.onerror = function () { rej(tx.error); }; }); }).catch(function (e) { if (e && e.__mem) { if (DB_MEM[store]) delete DB_MEM[store][id]; return; } throw e; }); }
  function clearAll() { if (DB_MEM) { Object.keys(STORES).forEach(function (s) { DB_MEM[s] = {}; }); return Promise.resolve(); } return ensureDB().then(function (db) { return new Promise(function (res, rej) { var names = Object.keys(STORES); var tx = db.transaction(names, 'readwrite'); names.forEach(function (s) { tx.objectStore(s).clear(); }); tx.oncomplete = function () { res(); }; tx.onerror = function () { rej(tx.error); }; }); }).catch(function (e) { if (e && e.__mem) { Object.keys(STORES).forEach(function (s) { DB_MEM[s] = {}; }); return; } throw e; }); }
  function showMemBanner() {
    if (document.getElementById('membanner')) return;
    var el = document.createElement('div'); el.id = 'membanner';
    el.style.cssText = 'position:fixed;bottom:0;left:0;right:0;z-index:9999;background:#7a3b00;color:#fff;padding:8px 14px;font-size:12.5px;display:flex;gap:12px;align-items:center;justify-content:center;flex-wrap:wrap';
    el.innerHTML = '⚠ Trabalhando em <b>modo temporário</b> — o armazenamento local não pôde ser aberto' + (memModeReason ? ' (' + esc(memModeReason) + ')' : '') + '. O sistema funciona normalmente, mas os dados <b>não serão salvos</b> ao recarregar. Feche outras abas do sistema e clique em Reparar. <button id="memrepair" style="background:#fff;color:#7a3b00;border:none;border-radius:6px;padding:4px 10px;font-weight:700;cursor:pointer">Reparar armazenamento</button>';
    document.body.appendChild(el);
    document.getElementById('memrepair').onclick = function () { try { indexedDB.deleteDatabase(DB_NAME); } catch (e) { } setTimeout(function () { location.reload(); }, 300); };
  }

  // ---------- índice SKU → custo (Produtos alimenta Pedidos, §42) ----------
  function rebuildSkuCost() {
    skuCost = {};
    if (!Produtos) return;
    var data = Produtos.getData();
    var famById = {}; data.families.forEach(function (f) { famById[f.id] = f; });
    data.variations.forEach(function (v) {
      if (!v.sku) return;
      var f = v.familyId ? famById[v.familyId] : null;
      skuCost[v.sku.toLowerCase()] = { linked: true, cost: f && f.currentCostAmount != null ? Number(f.currentCostAmount) : null, familyName: f ? f.name : null };
    });
  }

  // ---------- período ----------
  function periodRange() {
    var p = periodSel.value, now = new Date();
    if (p === 'today') return { from: new Date(now.getFullYear(), now.getMonth(), now.getDate()) };
    if (p === 'yesterday') return { from: new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1), to: new Date(now.getFullYear(), now.getMonth(), now.getDate()) };
    if (p === '7d') return { from: new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6) };
    if (p === '15d') return { from: new Date(now.getFullYear(), now.getMonth(), now.getDate() - 14) };
    if (p === '30d') return { from: new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29) };
    if (p === 'month') return { from: new Date(now.getFullYear(), now.getMonth(), 1) };
    if (p === 'prevmonth') return { from: new Date(now.getFullYear(), now.getMonth() - 1, 1), to: new Date(now.getFullYear(), now.getMonth(), 1) };
    if (p === 'custom') { var r = {}; if (customRange.from) r.from = new Date(customRange.from + 'T00:00:00'); if (customRange.to) r.to = new Date(customRange.to + 'T23:59:59'); return r; }
    return {};
  }
  var customRange = { from: null, to: null };
  function inPeriod(iso) { if (!iso) return true; var r = periodRange(); var d = new Date(iso); if (r.from && d < r.from) return false; if (r.to && d > r.to) return false; return true; }
  function pedidosInPeriod() { return orders.filter(function (o) { return inPeriod(o.createdAt); }); }
  // Cálculos, KPIs, análises, financeiro: SEMPRE sobre dados reais (demo nunca entra — §11).
  function occInPeriod() { return occ.filter(function (o) { return !o.isDemo && inPeriod(o.occurredAt); }); }
  // Casos mostra tudo (inclui demo, para validar a interface de disputa — §10).
  function occInPeriodAll() { return occ.filter(function (o) { return inPeriod(o.occurredAt); }); }

  // ---------- financeiro do pedido (recalculado ao vivo com custo atual de Produtos) ----------
  function orderFinance(o) {
    var items = o.items.map(function (it) {
      var c = it.sku ? skuCost[it.sku.toLowerCase()] : null;
      var linked = !!c;
      var costUnit = c && c.cost != null ? c.cost : null;
      return { subtotal: it.subtotal, costTotal: costUnit != null ? costUnit * it.qty : null, costUnknown: !linked || costUnit == null, linked: linked, costUnit: costUnit };
    });
    var fin = S.pedidos.computeFinance({ commissionNet: o.commissionNet, serviceFeeNet: o.serviceFeeNet, transactionFee: o.transactionFee, reverseShippingFee: o.reverseShippingFee, items: items });
    fin._items = items;
    return fin;
  }

  // ============================================================ IMPORTS (Pedidos / Pós-venda)
  function importPedidos(file) {
    return file.arrayBuffer().then(function (ab) {
      var parsed = S.pedidos.parse(ab, file.name);
      if (parsed.notRecognized) throw new Error('Planilha de pedidos não reconhecida (esperado Order.all… da Shopee).');
      var groups = {};
      (parsed.rows || []).forEach(function (r) { if (!r.orderId) return; (groups[r.orderId] = groups[r.orderId] || []).push(r); });
      var byId = {}; orders.forEach(function (o) { byId[o.id] = o; });
      var novo = 0, upd = 0, unch = 0, itemsSeen = 0; var changed = [];
      Object.keys(groups).forEach(function (id) {
        var g = groups[id]; var rep = g.find(function (r) { return r.orderStatus; }) || g[0]; itemsSeen += g.length;
        var items = g.map(function (r) { var qty = r.quantity || 1; var subtotal = r.productSubtotal != null ? num(r.productSubtotal) : num(r.agreedPrice) * qty; return { sku: r.sku, productName: r.productName, variationName: r.variationName, qty: qty, originalPrice: num(r.originalPrice), agreedPrice: num(r.agreedPrice), subtotal: subtotal }; });
        var toIso = function (d) { return d ? new Date(d).toISOString() : null; };
        var next = { id: id, orderStatus: rep.orderStatus, normalizedStatus: S.pedidos.normalizeStatus(rep.orderStatus), tracking: rep.trackingNumber, createdAt: toIso(rep.orderCreatedAt), returnRefundStatus: rep.returnRefundStatus, cancelReason: rep.cancelReason, city: rep.city, uf: rep.uf, recipientName: rep.recipientName, buyerUsername: rep.buyerUsername, shippingOption: rep.shippingOption, shippingMethod: rep.shippingMethod, isFbs: /^\s*(yes|sim|true)\s*$/i.test(rep.isFbs || '') || rep.shippingOption === 'Full', totalAmount: num(rep.totalAmount), grandTotal: num(rep.grandTotal), commissionNet: num(rep.commissionNet), serviceFeeNet: num(rep.serviceFeeNet), transactionFee: num(rep.transactionFee), reverseShippingFee: num(rep.reverseShippingFee), estimatedShipping: num(rep.estimatedShipping), buyerPaidShipping: num(rep.buyerPaidShipping), unitsTotal: rep.unitsTotal || items.reduce(function (s, i) { return s + i.qty; }, 0), items: items,
          // §9-33 do prompt "Alterações — Sistema Marketplace Líder": pagamento/prazo/envio efetivo,
          // usados no Dashboard (pedidos feitos × pagos) e na aba Tempo de Envio.
          paidAt: toIso(rep.paidAt), shipByDate: toIso(rep.shipByDate), shippedAt: toIso(rep.shippedAt), deliveredAt: toIso(rep.deliveredAt), completedAt: toIso(rep.completedAt), cancelledAt: toIso(rep.cancelledAt) };
        var ex = byId[id];
        if (!ex) { novo++; byId[id] = next; } else { var diff = ex.orderStatus !== next.orderStatus || ex.tracking !== next.tracking || ex.totalAmount !== next.totalAmount; if (diff) upd++; else unch++; byId[id] = next; }
        changed.push(next);
      });
      orders = Object.values(byId);
      var batch = { id: 'b' + Date.now() + Math.round(performance.now()), module: 'Pedidos', filename: file.name, createdAt: new Date().toISOString(), seen: Object.keys(groups).length, itemsSeen: itemsSeen, novo: novo, upd: upd, unch: unch, periodStart: parsed.periodStart, periodEnd: parsed.periodEnd };
      batches.unshift(batch);
      return Promise.all([putMany('orders', changed), putMany('batches', [batch])]).then(function () { return batch; });
    });
  }
  // Campos vindos da SHOPEE que o importador controla e compara (§44). Os campos internos
  // (responsável, causa, recebimento, etc.) NUNCA são tocados pela importação (§46).
  var SOURCE_FIELDS = [['status', 'Status Shopee'], ['reason', 'Motivo'], ['tracking', 'Rastreio'], ['trackingStatus', 'Status do rastreio'], ['reasonRevised', 'Motivo revisado'], ['resolution', 'Solução'], ['returnType', 'Tipo'], ['disputeReason', 'Motivo da disputa'], ['sellerNote', 'Observação'], ['disputeDeadline', 'Ação do vendedor até'], ['requested', 'Reembolso solicitado'], ['compensation', 'Compensação']];
  function occMapItems(g) { return g.map(function (r) { return { sku: r.sku, productName: r.productName, variationName: r.variationName, qty: r.quantity, unitPrice: r.unitPrice, skuLinked: !!(r.sku && skuCost[r.sku.toLowerCase()]) }; }); }
  function finalizeOcc(o) { o.exposure = S.posVenda.classify(o.status, o.requested || 0, o.compensation || 0); upsertImportEvents(o, o.exposure, o.requested || 0, o.compensation || 0); recomputeOccImpact(o); initReceipt(o); autoReceiptFromTracking(o); o.hasSellerWindow = !!o.disputeDeadline; }
  // Shopee informou conclusão do retorno → interno vira "conferir" (nunca "recebido"; a baixa é manual §41-42).
  function autoReceiptFromTracking(o) {
    var ts = (o.trackingStatus || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    var locked = ['RECEBIDO', 'PARCIAL', 'DIVERGENCIA'].indexOf(o.receiptState) >= 0; if (locked) return;
    // §84: conclusão COMPROVADA da devolução ao vendedor → pronto para conferência (baixa manual).
    var concluded = /devolucao conclu|conclu.*devolu|entregue ao vendedor|entregue ao remetente|recebid.* pel[oa] vendedor|entregue a loja/.test(ts);
    // "Retirada bem-sucedida"/coleta/em trânsito = ainda a caminho — NÃO é conferência (§84).
    var transit = /retirada bem|coletad|em transito|a caminho|preparando|postad|enviad|em rota|saiu para/.test(ts);
    if (concluded && o.receiptState !== 'CHEGOU_CONFERIR') { o.receiptState = 'CHEGOU_CONFERIR'; addActivity(o, 'RECEIPT', { message: 'Devolução concluída na Shopee — pronto para conferência (baixa manual)', userName: 'Sistema' }); }
    else if (transit && ['CHEGOU_CONFERIR', 'EM_TRANSITO'].indexOf(o.receiptState) < 0) { o.receiptState = 'EM_TRANSITO'; }
  }
  function importPosVenda(type, file) {
    return file.arrayBuffer().then(function (ab) {
      var parsed = S.posVenda.parse(ab, file.name, type);
      if (parsed.notRecognized) throw new Error('Relatório de devolução não reconhecido para o tipo selecionado.');
      var groups = {};
      (parsed.rows || []).forEach(function (r) { var k = r.occurrenceKey; if (!k) return; (groups[k] = groups[k] || []).push(r); });
      var byId = {}; occ.forEach(function (o) { byId[o.id] = o; });
      // §52-53: auditoria de importação / resumo pós-importação — contadores específicos além de
      // novo/upd/unch genéricos, para responder "o que mudou desde ontem?" sem adivinhar.
      var novo = 0, upd = 0, unch = 0, stale = 0, itemsSeen = 0; var changed = []; var newStatuses = {};
      var statusChanged = 0, novaCompensacao = 0, rastreioAtualizado = 0, dadosInternosPreservados = 0;
      var importedAt = new Date().toISOString();
      var batchId = 'b' + Date.now() + Math.round(performance.now());
      // "Fotografia" da fonte: relatório mais recente prevalece; um relatório antigo importado
      // depois NÃO regride o estado (§48-49). Usa o fim do período do relatório como marca-d'água.
      var reportWM = parsed.periodEnd ? new Date(parsed.periodEnd).toISOString() : importedAt;
      var hasStr = function (v) { return v != null && String(v).trim() !== ''; };
      Object.keys(groups).forEach(function (key) {
        var g = groups[key]; var rep = g.find(function (r) { return r.status; }) || g[0]; itemsSeen += g.length;
        var uid = type + ':' + key;
        var incoming = {
          status: rep.status || null, reason: rep.reason || null, reasonRevised: rep.reasonRevised || null,
          resolution: rep.resolution || null, returnType: rep.returnType || null, disputeReason: rep.disputeReason || null,
          sellerNote: rep.sellerNote || null,
          disputeDeadline: (rep.sellerActionDeadline && !isNaN(new Date(rep.sellerActionDeadline))) ? new Date(rep.sellerActionDeadline).toISOString() : null,
          tracking: rep.trackingNumber || null, trackingStatus: rep.trackingStatus || null,
          requested: hasStr(rep.requestedRefundAmount) ? num(rep.requestedRefundAmount) : null,
          compensation: hasStr(rep.sellerCompensationAmount) ? num(rep.sellerCompensationAmount) : null,
          occurredAt: rep.occurredAt ? new Date(rep.occurredAt).toISOString() : null,
          orderCreatedAt: rep.orderCreatedAt ? new Date(rep.orderCreatedAt).toISOString() : null,
          returnOpenedAt: rep.returnOpenedAt ? new Date(rep.returnOpenedAt).toISOString() : null,
        };
        if (incoming.status && !SHOPEE_STATUS_KNOWN[normStatus(incoming.status)]) newStatuses[incoming.status] = true;
        var ex = byId[uid];
        if (!ex) {
          var o = newOcc(uid, type); o.orderId = rep.orderId; o.returnId = rep.returnId;
          SOURCE_FIELDS.forEach(function (f) { if (incoming[f[0]] != null) o[f[0]] = incoming[f[0]]; });
          o.requested = incoming.requested || 0; o.compensation = incoming.compensation || 0;
          o.occurredAt = incoming.occurredAt; o.orderCreatedAt = incoming.orderCreatedAt; o.returnOpenedAt = incoming.returnOpenedAt;
          o.items = occMapItems(g); o.sourceWatermark = reportWM; o.lastImportAt = importedAt; o.lastImportFile = file.name;
          finalizeOcc(o);
          addActivity(o, 'SOURCE', { message: 'Caso importado · Status Shopee: ' + (o.status || '—'), userName: 'Shopee', fileName: file.name, batchId: batchId });
          novo++; byId[uid] = o; changed.push(o); return;
        }
        // relatório mais antigo do que a última fotografia da fonte → não regride (§48-49)
        if (ex.sourceWatermark && reportWM < ex.sourceWatermark) { stale++; return; }
        var diffs = [];
        SOURCE_FIELDS.forEach(function (f) { var k = f[0]; var inv = incoming[k]; if (inv == null) return; /* vazio não apaga (§47) */ var oldv = ex[k]; if ((oldv == null ? '' : String(oldv)) !== String(inv)) { diffs.push({ label: f[1], old: oldv, nw: inv }); ex[k] = inv; } });
        if (incoming.occurredAt) ex.occurredAt = incoming.occurredAt;
        if (incoming.orderCreatedAt) ex.orderCreatedAt = incoming.orderCreatedAt;
        if (incoming.returnOpenedAt) ex.returnOpenedAt = incoming.returnOpenedAt;
        ex.items = occMapItems(g); ex.sourceWatermark = reportWM; ex.lastImportAt = importedAt; ex.lastImportFile = file.name;
        // §14-16: dados internos (status/decisão/notas/provas) já foram preservados acima — só campos
        // de SOURCE_FIELDS + datas foram tocados. O motor de transição pode AVANÇAR o status interno
        // (nunca retroceder) quando o novo Status Shopee for reconhecido com segurança (§15-21).
        if (diffs.some(function (d) { return d.label === 'Status Shopee'; })) { aplicarTransicaoAutomatica(ex); statusChanged++; }
        if (incoming.compensation != null && incoming.compensation > 0 && (ex._prevCompensation || 0) <= 0) novaCompensacao++;
        ex._prevCompensation = ex.compensation;
        if (diffs.some(function (d) { return d.label === 'Rastreio' || d.label === 'Status do rastreio'; })) rastreioAtualizado++;
        if (diffs.length) ex.lastStatusAdvanceAt = importedAt; // §24-25: marca "teve retorno" para o badge/filtro
        dadosInternosPreservados++;
        finalizeOcc(ex);
        if (diffs.length) { diffs.forEach(function (d) { var fmt = function (v) { return v == null || v === '' ? '∅' : (typeof v === 'number' ? brl(v) : String(v)); }; addActivity(ex, 'SOURCE', { field: d.label, oldValue: fmt(d.old), newValue: fmt(d.nw), userName: 'Shopee', fileName: file.name, batchId: batchId }); }); upd++; } else { unch++; }
        byId[uid] = ex; changed.push(ex);
      });
      occ = Object.values(byId);
      var label = { RETURN_REFUND: 'Devoluções', ORDER_CANCELLATION: 'Cancelamentos', FAILED_DELIVERY: 'Falhas de entrega' }[type];
      var batch = { id: batchId, module: 'Devolução · ' + label, filename: file.name, createdAt: importedAt, seen: Object.keys(groups).length, itemsSeen: itemsSeen, novo: novo, upd: upd, unch: unch, stale: stale, periodStart: parsed.periodStart ? new Date(parsed.periodStart).toISOString() : null, periodEnd: parsed.periodEnd ? new Date(parsed.periodEnd).toISOString() : null, newStatuses: Object.keys(newStatuses), statusChanged: statusChanged, novaCompensacao: novaCompensacao, rastreioAtualizado: rastreioAtualizado, dadosInternosPreservados: dadosInternosPreservados };
      batches.unshift(batch); lastImportStamp = importedAt;
      return Promise.all([putMany('occ', changed), putMany('batches', [batch])]).then(function () { return { batch: batch, changed: changed }; });
    });
  }
  function fileInput(cb) { var inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.xlsx,.xls,.csv'; inp.onchange = function () { if (inp.files[0]) cb(inp.files[0]); }; inp.click(); }

  // ============================================================ RENDER (roteamento)
  function setActive() { document.querySelectorAll('#nav a').forEach(function (a) { a.classList.toggle('active', a.dataset.route === route); }); crumb.textContent = { dashboard: 'Dashboard', produtos: 'Produtos', pedidos: 'Pedidos', posvenda: 'Devolução', carteira: 'Saldo da Carteira', acelera: 'Shopee Acelera', afiliados: 'Afiliados', minharenda: 'Minha Renda', ia: 'Inteligência' }[route] || ''; }
  function render() {
    setActive();
    // Cada módulo é isolado: um erro em um deles mostra a mensagem no lugar de deixar a tela em branco
    // (era isso que fazia "clico e não aparece nada"). Produtos depende do módulo carregado no boot.
    try {
      if (route === 'produtos') { if (!Produtos) { app.innerHTML = renderErrBox('O módulo Produtos ainda não terminou de carregar. Recarregue a página.'); return; } Produtos.render(); return; }
      if (route === 'dashboard') return renderDashboard();
      if (route === 'pedidos') return renderPedidos();
      if (route === 'posvenda') return renderPosVenda();
      if (route === 'carteira') return renderCarteira();
      if (route === 'acelera') return renderAcelera();
      if (route === 'afiliados') return renderAfiliados();
      if (route === 'minharenda') return renderMinhaRenda();
      if (route === 'ia') return renderIA();
    } catch (e) { app.innerHTML = renderErrBox('Erro ao abrir esta tela: ' + esc(e && (e.message || e)) + '. Os dados estão salvos — recarregue a página.'); }
  }
  function renderErrBox(msg) { return '<div class="form-err" style="max-width:640px;margin:24px auto"><b>Ops.</b><br>' + msg + '<div style="margin-top:12px"><button class="btn-sm primary" onclick="location.reload()">Recarregar</button></div></div>'; }

  // ---------- DASHBOARD global ----------
  function computeOrderAgg(list) {
    list = list || pedidosInPeriod();
    var agg = { orders: list.length, units: 0, revenue: 0, fees: 0, cost: 0, result: 0, costPending: 0, unlinked: 0, byStatus: {} };
    list.forEach(function (o) { var f = orderFinance(o); agg.units += o.items.reduce(function (s, i) { return s + i.qty; }, 0); agg.revenue += f.revenue; agg.fees += f.marketplaceFeesTotal; agg.cost += f.productCostTotal; if (f.estimatedResult != null) agg.result += f.estimatedResult; else agg.costPending++; if (f._items.some(function (i) { return !i.linked; })) agg.unlinked++; agg.byStatus[o.normalizedStatus] = (agg.byStatus[o.normalizedStatus] || 0) + 1; });
    return agg;
  }
  // §12-18: "pedidos feitos" (Data de criação) ≠ "pedidos pagos" (Hora do pagamento) — pedido sem
  // pagamento real ("-" na planilha) nunca conta como pago. As duas métricas ficam sempre visíveis
  // juntas; o toggle de base temporal só decide qual delas alimenta os cards que precisam de UMA base.
  // §9: indicadores financeiros/de venda usam PAGAMENTO por padrão; indicadores de entrada
  // operacional (pedidos feitos, fila de expedição, tempo de envio) sempre usam CRIAÇÃO — essa
  // segunda parte nunca passou pelo seletor, então só o default abaixo muda.
  var pedDashBasis = 'pagamento'; // 'criacao' | 'pagamento'
  function pedidosPagosInPeriod() { return orders.filter(function (o) { return o.paidAt && inPeriod(o.paidAt); }); }
  // §10: "Dados atualizados até" — maior timestamp válido encontrado nos Pedidos importados, para o
  // sistema nunca parecer "errado" por não ser tempo real (a Shopee só exporta até o momento do download).
  var PED_TS_FIELDS = ['createdAt', 'paidAt', 'shippedAt', 'deliveredAt', 'completedAt', 'cancelledAt'];
  function dadosAtualizadosAte() {
    var max = null;
    orders.forEach(function (o) { PED_TS_FIELDS.forEach(function (k) { var v = o[k]; if (v && (!max || v > max)) max = v; }); });
    return max;
  }
  function dadosAtualizadosAteBadge() {
    var ts = dadosAtualizadosAte();
    return '<div class="footnote" style="margin:4px 0 12px">📅 Dados atualizados até: <b>' + (ts ? new Date(ts).toLocaleString('pt-BR') : 'sem pedidos importados') + '</b> — a Shopee só exporta até o momento do download, este sistema não é tempo real.</div>';
  }
  function renderDashboard() {
    var a = computeOrderAgg(); var o = occInPeriod(); var exposure = sumExposure(o);
    var empty = orders.length === 0 && occ.length === 0 && (!Produtos || Produtos.getData().products.length === 0);
    app.innerHTML =
      '<div class="page-head"><div><h2>Visão geral</h2><p>Panorama de vendas e devoluções — números auditáveis, sem estimativas inventadas.</p></div></div>' +
      (empty ? banner('Comece importando planilhas em <b>Produtos</b>, <b>Pedidos</b> e <b>Devolução</b>. Os módulos se conectam automaticamente (SKU→família→custo e pedido↔devolução).') : '') +
      '<div class="cards6">' + fcard('Venda real', brl(a.revenue), 'blue', nn(a.orders) + ' pedidos') + fcard('Unidades', nn(a.units), '') + fcard('Taxas marketplace', brl(a.fees), 'red') + fcard('Custo produtos', brl(a.cost), 'amber') + fcard('Resultado estimado', brl(a.result), 'green', a.costPending ? a.costPending + ' pedidos c/ custo pendente' : 'custo completo') + fcard('Margem estimada', a.revenue ? pct((a.result / a.revenue) * 100) : '—', '') + '</div>' +
      '<div class="cards6">' + fcard('A enviar', nn(a.byStatus.A_ENVIAR || 0), 'amber') + fcard('Enviados', nn(a.byStatus.ENVIADO || 0), 'blue') + fcard('Concluídos', nn(a.byStatus.CONCLUIDO || 0), 'green') + fcard('Cancelados', nn(a.byStatus.CANCELADO || 0), 'red') + fcard('Devoluções', nn(o.length), '') + fcard('Prejuízo confirmado', brl(exposure.confirmedLoss), 'red') + '</div>' +
      '<div class="cards6">' + fcard('SKUs sem vínculo', nn(a.unlinked) + ' pedidos', 'amber') + fcard('Custo pendente', nn(a.costPending) + ' pedidos', 'amber') + fcard('Em risco (devolução)', brl(exposure.atRisk), 'amber') + '</div>' +
      panelImports();
  }

  // ---------- PEDIDOS ----------
  function renderPedidos() {
    app.innerHTML =
      '<div class="page-head"><div><h2>Pedidos</h2><p>Núcleo transacional. Importação idempotente (upsert), sem duplicar vendas.</p></div>' +
      '<button class="btn-sm primary" id="imp-ped">Importar planilha de pedidos</button></div>' +
      dadosAtualizadosAteBadge() +
      devPeriodBar() +
      '<div class="subtabs">' + subtab('pedidos', 'pedidos', 'Pedidos') + subtab('pedidos', 'expedicao', 'Expedição') + subtab('pedidos', 'tempoenvio', 'Tempo de Envio') + subtab('pedidos', 'dashboard', 'Dashboard') + subtab('pedidos', 'import', 'Importações') + '</div>' +
      (sub.pedidos === 'dashboard' ? pedidosDashboard() : sub.pedidos === 'import' ? importsFor('Pedidos') : sub.pedidos === 'expedicao' ? pedidosExpedicao() : sub.pedidos === 'tempoenvio' ? pedidosTempoEnvio() : pedidosList());
    document.getElementById('imp-ped').onclick = function () { fileInput(function (f) { importPedidos(f).then(function (b) { render(); toast('Pedidos importados', b.seen + ' pedidos · ' + b.novo + ' novos · ' + b.upd + ' atualizados · ' + b.unch + ' sem alteração'); }).catch(function (e) { toast('Falha', e.message, true); }); }); };
    bindSubtabs('pedidos');
    bindDevPeriodBar();
    if (sub.pedidos === 'pedidos') bindPedidosList();
    if (sub.pedidos === 'expedicao') bindPedidosExpedicao();
    if (sub.pedidos === 'dashboard') bindPedidosDashboard();
    if (sub.pedidos === 'tempoenvio') bindPedidosTempoEnvio();
  }
  function bindPedidosDashboard() { var s = document.getElementById('peddashbasis'); if (s) s.onchange = function () { pedDashBasis = s.value; render(); }; }
  // ---------- Expedição / Bipe (§1 do prompt de reorganização): "vendido" ≠ "expedido" ----------
  // Bipe = leitor de código de barras USB/Bluetooth (emite como teclado) ou digitação manual do ID.
  // Leitura por câmera exigiria uma biblioteca de decodificação de código de barras não empacotada
  // neste HTML autônomo — não implementada agora para não fingir uma funcionalidade não testada.
  // §9-11 do prompt "Alterações — Sistema Marketplace Líder": a etiqueta bipada traz o BR
  // (rastreamento), não o ID do pedido — a resolução precisa ser segura: 1 pedido encontrado
  // associa automaticamente; 0 ou mais de 1 NUNCA associa silenciosamente.
  function findOrdersByBR(br) {
    var q = (br || '').trim().toUpperCase(); if (!q) return [];
    return orders.filter(function (o) { return (o.tracking || '').trim().toUpperCase() === q; });
  }
  function resolveBipeInput(raw) {
    var v = (raw || '').trim(); if (!v) return { ok: false, reason: 'VAZIO', message: 'Informe o ID do pedido ou o BR (rastreamento).' };
    var direct = orders.find(function (o) { return o.id === v; });
    if (direct) return { ok: true, order: direct, via: 'ID' };
    var byBR = findOrdersByBR(v);
    if (byBR.length === 1) return { ok: true, order: byBR[0], via: 'BR' };
    if (byBR.length > 1) return { ok: false, reason: 'AMBIGUO', message: 'Rastreamento associado a mais de um pedido — revisar.', matches: byBR };
    return { ok: false, reason: 'NAO_LOCALIZADO', message: 'BR não localizado nos pedidos importados.' };
  }
  function bipRegister(rawInput, note) {
    var res = resolveBipeInput(rawInput);
    if (!res.ok) return Promise.reject(new Error(res.message));
    var orderId = res.order.id;
    var now = new Date().toISOString(); var ex = shipBip[orderId];
    if (ex) { ex.history = ex.history || []; ex.history.unshift({ at: now, note: note || '' }); ex.lastScanAt = now; if (note) ex.note = note; }
    else { ex = shipBip[orderId] = { id: orderId, orderId: orderId, bipedAt: now, lastScanAt: now, bipedBy: 'Operador', note: note || '', scannedVia: res.via, scannedValue: rawInput, history: [] }; }
    return putMany('shipbip', [ex]).then(function () { return ex; });
  }
  function pedIsExpedido(orderId) { return !!shipBip[orderId]; }
  // Status de conciliação financeira de um pedido, cruzando Minha Renda × Acelera × Carteira × Devolução.
  // Usado na fila de Expedição e na Ficha Financeira 360º (mesma definição nos dois lugares).
  function pedidoConciliacaoStatus(orderId) {
    var hasRenda = mrRenda.some(function (r) { return r.orderId === orderId && r.ver === 'Order'; });
    var accEng = acelera.length ? acelera.some(function (r) { return r.pedido === orderId; }) : null;
    var hasWallet = wallet.some(function (t) { return t.orderId === orderId; });
    var hasDevol = occ.some(function (o) { return !o.isDemo && o.orderId === orderId; });
    var found = [hasRenda, accEng, hasWallet].filter(function (x) { return x === true; }).length;
    var expected = 1 + (acelera.length ? 1 : 0) + (wallet.length ? 1 : 0); // Renda sempre esperado se módulo tem dados; Acelera/Carteira só contam se o módulo tiver algum dado importado
    if (!mrRenda.length && !acelera.length && !wallet.length) return { code: 'AGUARDANDO', label: '⚪ Aguardando informações', hasRenda: hasRenda, hasAcelera: accEng, hasWallet: hasWallet, hasDevol: hasDevol };
    if (found === 0) return { code: 'DIVERGENTE', label: '🔴 Divergência', hasRenda: hasRenda, hasAcelera: accEng, hasWallet: hasWallet, hasDevol: hasDevol };
    if (expected > 0 && found >= expected) return { code: 'CONCILIADO', label: '🟢 Conciliado', hasRenda: hasRenda, hasAcelera: accEng, hasWallet: hasWallet, hasDevol: hasDevol };
    return { code: 'PARCIAL', label: '🟡 Parcialmente conciliado', hasRenda: hasRenda, hasAcelera: accEng, hasWallet: hasWallet, hasDevol: hasDevol };
  }
  function pedidosExpedicao() {
    var head = secHead('PEDIDOS · EXPEDIÇÃO', 'Vendido × Expedido', 'A expedição é registrada pelo bipe da etiqueta (leitor USB/Bluetooth ou digitação do ID) — é um evento diferente da venda. "Vendido" não significa "saiu da empresa".');
    var vendidosHoje = orders.filter(function (o) { return o.createdAt && o.createdAt.slice(0, 10) === new Date().toISOString().slice(0, 10); }).length;
    var expedidosHoje = Object.values(shipBip).filter(function (b) { return b.bipedAt.slice(0, 10) === new Date().toISOString().slice(0, 10); }).length;
    var totalExpedidos = Object.keys(shipBip).length;
    var pendentes = orders.filter(function (o) { return !pedIsExpedido(o.id) && o.normalizedStatus !== 'CANCELADO'; }).length;
    var pctExp = orders.length ? r2(totalExpedidos / orders.length * 100) : 0;
    var semConf = 0, comDiverg = 0;
    Object.keys(shipBip).forEach(function (oid) { var st = pedidoConciliacaoStatus(oid); if (st.code === 'AGUARDANDO' || st.code === 'PARCIAL') semConf++; if (st.code === 'DIVERGENTE') comDiverg++; });
    var strip = kstrip([
      { l: 'Vendidos hoje', v: nn(vendidosHoje), cls: 'blue' },
      { l: 'Expedidos hoje', v: nn(expedidosHoje), cls: 'green' },
      { l: 'Pendentes de expedição', v: nn(pendentes), cls: pendentes ? 'amber' : 'green' },
      { l: '% expedido (total)', v: pct(pctExp), cls: 'blue', s: nn(totalExpedidos) + ' de ' + nn(orders.length) },
      { l: 'Expedidos sem conferência', v: nn(semConf), cls: semConf ? 'amber' : 'green' },
      { l: 'Expedidos com divergência', v: nn(comDiverg), cls: comDiverg ? 'red' : 'green' },
    ]);
    var bipe = '<div class="panel"><div class="ph"><h3>Bipar etiqueta</h3><span class="footnote" style="margin:0">leitor USB/Bluetooth (emite como teclado) ou digite o BR/ID e pressione Enter</span></div><div class="pb"><div style="display:flex;gap:8px;max-width:480px"><input class="input" id="bipinput" placeholder="BR (rastreamento) ou ID do pedido" autofocus style="flex:1"><button class="btn-sm primary" id="bipbtn">Registrar saída</button></div><div class="footnote" style="margin-top:8px">Aceita o BR da etiqueta (resolvido para o pedido pelo rastreamento) ou o ID do pedido digitado direto. Se o BR não for encontrado, ou aparecer em mais de um pedido, nada é registrado automaticamente — você revisa antes. Leitura por câmera não está implementada nesta versão — exigiria uma biblioteca de decodificação de código de barras, que não incluímos para não declarar um recurso não testado.</div></div></div>';
    if (!orders.length) return head + bipe + emptyBox('Importe os Pedidos para começar a controlar a expedição.');
    var q = pedExpF.search.toLowerCase();
    var fullCount = orders.filter(function (o) { return o.isFbs; }).length;
    var list = orders.filter(function (o) { if (!pedExpF.includeFull && o.isFbs) return false; if (pedExpF.status === 'expedido' && !pedIsExpedido(o.id)) return false; if (pedExpF.status === 'pendente' && (pedIsExpedido(o.id) || o.normalizedStatus === 'CANCELADO')) return false; if (q && o.id.toLowerCase().indexOf(q) < 0 && (o.tracking || '').toLowerCase().indexOf(q) < 0) return false; return true; }).sort(function (a, b) { var ba = shipBip[a.id], bb = shipBip[b.id]; if (ba && bb) return bb.bipedAt.localeCompare(ba.bipedAt); if (ba) return -1; if (bb) return 1; return (b.createdAt || '').localeCompare(a.createdAt || ''); });
    var chips = [['', 'Todos'], ['expedido', 'Expedidos'], ['pendente', 'Pendentes']];
    var rows = list.slice(0, 200).map(function (o) { var b = shipBip[o.id]; var st = b ? pedidoConciliacaoStatus(o.id) : null; return '<tr' + (b ? '' : ' style="background:#fff8ef"') + '><td class="mono">' + esc(o.id) + '</td><td class="mono">' + esc(o.tracking || '—') + '</td><td class="nowrap">' + dbr(o.createdAt) + '</td><td><span class="pill ' + o.normalizedStatus + '">' + esc(S.pedidos.labels[o.normalizedStatus] || o.normalizedStatus) + '</span></td><td>' + (b ? '<span class="tag ok">expedido</span> <span class="footnote" style="margin:0">' + new Date(b.bipedAt).toLocaleString('pt-BR') + '</span>' : '<span class="tag warn">pendente</span>') + '</td><td>' + (st ? '<span class="tag">' + esc(st.label) + '</span>' : '—') + '</td><td><button class="btn-sm" data-goped360="' + esc(o.id) + '">Ficha 360º</button></td></tr>'; }).join('');
    return head + strip + bipe +
      '<div class="chips">' + chips.map(function (c) { return '<span class="chip' + (pedExpF.status === c[0] ? ' chip-on' : '') + '" data-expst="' + c[0] + '">' + c[1] + '</span>'; }).join('') + '<span class="chip' + (pedExpF.includeFull ? ' chip-on' : '') + '" data-expfull="1" title="Full/FBS é despachado pelo centro de distribuição da Shopee — por padrão fica fora desta fila própria">Incluir Full (' + nn(fullCount) + ')</span></div>' +
      '<div class="toolbar2" style="margin-top:8px"><input class="input sm" id="expq" style="width:260px" placeholder="Buscar ID do pedido ou BR…" value="' + esc(pedExpF.search) + '"></div>' +
      '<div class="count-line"><b>' + nn(list.length) + '</b> pedidos' + (!pedExpF.includeFull && fullCount ? ' <span class="footnote">(' + nn(fullCount) + ' Full/FBS fora da fila — expedidos pela Shopee)</span>' : '') + '</div>' +
      '<div class="panel"><div class="table-wrap"><table class="report"><thead><tr><th>Pedido</th><th>BR</th><th>Data venda</th><th>Status</th><th>Expedição</th><th>Conciliação</th><th></th></tr></thead><tbody>' + (rows || '<tr><td colspan="7" class="empty">Nenhum pedido neste filtro.</td></tr>') + '</tbody></table></div></div>';
  }
  function bindPedidosExpedicao() {
    var bi = document.getElementById('bipinput'); var doRegister = function () { var v = bi.value; bipRegister(v).then(function (rec) { bi.value = ''; render(); var el = document.getElementById('bipinput'); if (el) el.focus(); toast('Expedição registrada', rec.orderId); }).catch(function (e) { toast('Falha', e.message, true); }); };
    if (bi) bi.onkeydown = function (e) { if (e.key === 'Enter') doRegister(); };
    var bb = document.getElementById('bipbtn'); if (bb) bb.onclick = doRegister;
    app.querySelectorAll('[data-expst]').forEach(function (c) { c.onclick = function () { pedExpF.status = c.dataset.expst; render(); }; });
    var ef = app.querySelector('[data-expfull]'); if (ef) ef.onclick = function () { pedExpF.includeFull = !pedExpF.includeFull; render(); };
    var q = document.getElementById('expq'); if (q) { var t; q.oninput = function () { clearTimeout(t); t = setTimeout(function () { var v = q.value; pedExpF.search = v; render(); var el = document.getElementById('expq'); if (el) { el.focus(); el.value = v; el.setSelectionRange(v.length, v.length); } }, 220); }; }
    app.querySelectorAll('[data-goped360]').forEach(function (b) { b.onclick = function () { openPedidoFicha360(b.dataset.goped360); }; });
  }
  // Correção do usuário (§1): a aba OFICIAL precisa espelhar exatamente a contagem de status da
  // Shopee — nunca um agrupamento mais amplo por baixo do mesmo número. "Cancelado" mostra só
  // normalizedStatus===CANCELADO (idêntico ao texto de status da Shopee). Pedidos com devolução/
  // motivo associado mas outro status Shopee (ex.: Entregue com Status da Devolução preenchido)
  // ficam num filtro ADICIONAL opt-in, nunca somados por baixo do count oficial da aba.
  function pedidoTemRetornoAssociado(o) { return o.normalizedStatus !== 'CANCELADO' && !!((o.returnRefundStatus && o.returnRefundStatus.trim()) || (o.cancelReason && o.cancelReason.trim())); }
  function pedidoIsRetornoCancelado(o) { return o.normalizedStatus === 'CANCELADO' || pedidoTemRetornoAssociado(o); }
  var pedIncluirRetornoAssociado = false; // toggle opt-in, nunca liga sozinho — não altera a contagem oficial da aba
  function pedidosList() {
    var occByOrder = {}; occ.forEach(function (o) { if (o.orderId) occByOrder[o.orderId] = true; });
    var all = pedidosInPeriod();
    // §2/§12: contadores SEMPRE por ID de pedido único — "orders" já é 1 registro por pedido
    // (agrupado na importação), nunca por linha/item da planilha. Todos os counts abaixo usam
    // normalizedStatus puro — o mesmo texto de status que a Shopee mostra, contagem idêntica.
    var counts = { ALL: all.length };
    ['NAO_PAGO', 'A_ENVIAR', 'ENVIADO', 'CONCLUIDO', 'CANCELADO'].forEach(function (k) { counts[k] = all.filter(function (o) { return o.normalizedStatus === k; }).length; });
    var comRetornoAssociado = all.filter(pedidoTemRetornoAssociado);
    var TAB_DEFS = S.pedidos.tabs;
    var tabs = TAB_DEFS.map(function (t) { return '<div class="tab ' + (pedTab === t.key ? 'active' : '') + '" data-ptab="' + t.key + '">' + t.label + ' <span class="tag">' + nn(counts[t.key] || 0) + '</span></div>'; }).join('');
    var baseList = pedTab === 'ALL' ? all : all.filter(function (o) { return o.normalizedStatus === pedTab; });
    var retornoToggle = (pedTab === 'CANCELADO' && comRetornoAssociado.length) ? '<div class="chips" style="margin-top:6px"><span class="chip' + (pedIncluirRetornoAssociado ? ' chip-on' : '') + '" data-pedretorno="1">+ Com devolução/motivo associado (status Shopee diferente) — ' + nn(comRetornoAssociado.length) + '</span></div>' : '';
    var list = (pedTab === 'CANCELADO' && pedIncluirRetornoAssociado) ? baseList.concat(comRetornoAssociado) : baseList;
    var qel = document.getElementById('ped-q'); var q = qel ? qel.value : '';
    if (q) { var ql = q.toLowerCase(); list = list.filter(function (o) { return (o.id || '').toLowerCase().indexOf(ql) >= 0 || (o.tracking || '').toLowerCase().indexOf(ql) >= 0 || o.items.some(function (i) { return (i.sku || '').toLowerCase().indexOf(ql) >= 0 || (i.productName || '').toLowerCase().indexOf(ql) >= 0; }); }); }
    if (!all.length) return emptyBox('Nenhum pedido. Importe a planilha "Order.all…" da Shopee.');
    var rows = list.slice(0, 300).map(function (o) {
      var f = orderFinance(o); var prod = o.items.length > 1 ? o.items.length + ' produtos' : (o.items[0] ? esc((o.items[0].productName || '').slice(0, 40)) : '—');
      return '<tr><td class="mono">' + esc(o.id) + '</td><td class="mono">' + esc(o.tracking || '—') + '</td><td>' + dbr(o.createdAt) + '</td><td><span class="pill ' + o.normalizedStatus + '">' + esc(S.pedidos.labels[o.normalizedStatus] || o.normalizedStatus) + '</span></td>' +
        '<td>' + prod + (o.items.length > 1 ? ' <span class="tag">multi</span>' : '') + '</td><td>' + (o.isFbs ? '<span class="tag info">Full</span>' : esc(o.shippingOption || '—')) + '</td><td>' + brl(f.revenue) + '</td><td style="color:var(--err)">' + brl(f.marketplaceFeesTotal) + '</td>' +
        '<td>' + (f.estimatedResult == null ? '<span class="tag warn">pendente</span>' : '<b style="color:var(--ok)">' + brl(f.estimatedResult) + '</b>') + '</td><td>' + (f.estimatedMarginPct == null ? '—' : pct(f.estimatedMarginPct)) + '</td>' +
        '<td>' + (occByOrder[o.id] ? '<span class="tag warn">devolução</span>' : '') + '</td><td><button class="btn-sm" data-open="' + esc(o.id) + '">Abrir</button></td></tr>';
    }).join('');
    return '<div class="tabs">' + tabs + '</div>' + retornoToggle + '<div class="toolbar2"><input class="input sm" id="ped-q" style="width:280px" placeholder="Buscar ID, BR, SKU, produto…" value="' + esc(q) + '"></div>' +
      '<div class="count-line"><b>' + nn(list.length) + '</b> pedidos' + (list.length > 300 ? ' (mostrando 300)' : '') + (pedTab === 'CANCELADO' ? ' <span class="footnote">— ' + nn(counts.CANCELADO) + ' com status "Cancelado" da Shopee' + (pedIncluirRetornoAssociado ? ' + ' + nn(comRetornoAssociado.length) + ' com devolução/motivo associado' : '') + '</span>' : '') +
      '</div>' +
      '<div class="panel"><div class="table-wrap"><table><thead><tr><th>Pedido</th><th>BR</th><th>Data</th><th>Status</th><th>Produto</th><th>Modalidade</th><th>Venda</th><th>Taxas</th><th>Lucro est.</th><th>Margem</th><th>Devolução</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div></div>';
  }
  function bindPedidosList() {
    app.querySelectorAll('[data-ptab]').forEach(function (t) { t.onclick = function () { pedTab = t.dataset.ptab; render(); }; });
    var rt = document.querySelector('[data-pedretorno]'); if (rt) rt.onclick = function () { pedIncluirRetornoAssociado = !pedIncluirRetornoAssociado; render(); };
    var q = document.getElementById('ped-q'); if (q) { var deb; q.oninput = function () { clearTimeout(deb); deb = setTimeout(function () { var v = q.value; renderPedidos(); var el = document.getElementById('ped-q'); if (el) { el.focus(); el.value = v; el.setSelectionRange(v.length, v.length); } }, 200); }; }
    app.querySelectorAll('[data-open]').forEach(function (b) { b.onclick = function () { openOrder(b.dataset.open); }; });
  }
  function pedidosDashboard() {
    var feitos = pedidosInPeriod(); var pagos = pedidosPagosInPeriod();
    var aBase = computeOrderAgg(pedDashBasis === 'pagamento' ? pagos : feitos);
    var aFeitos = computeOrderAgg(feitos); var aPagos = computeOrderAgg(pagos);
    var ticket = aBase.orders ? aBase.revenue / aBase.orders : 0;
    var conversao = feitos.length ? r2(pagos.length / feitos.length * 100) : 0;
    var naoPagos = feitos.length - pagos.length;
    var expedidos = feitos.filter(function (o) { return pedIsExpedido(o.id); }).length;
    var cancelados = feitos.filter(pedidoIsRetornoCancelado).length;
    var basisSel = '<div class="panel"><div class="pb" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><b style="font-size:12.5px;color:var(--muted)">Base temporal para venda/margem:</b><select class="select sm" id="peddashbasis"><option value="criacao"' + (pedDashBasis === 'criacao' ? ' selected' : '') + '>Pela criação do pedido</option><option value="pagamento"' + (pedDashBasis === 'pagamento' ? ' selected' : '') + '>Pelo pagamento</option></select><span class="footnote">"Pedidos feitos" e "Pedidos pagos" sempre usam sua própria data — o seletor só decide a base de Venda/Margem/Ticket abaixo.</span></div></div>';
    return basisSel + '<div class="cards6">' +
      fcard('Pedidos feitos', nn(aFeitos.orders), 'blue', 'pela data de criação') +
      fcard('Pedidos pagos', nn(aPagos.orders), 'green', 'pela hora do pagamento') +
      fcard('Taxa de conversão em pagamento', pct(conversao), 'blue', 'pagos ÷ feitos') +
      fcard('Valor dos pedidos feitos', brl(aFeitos.revenue), '', 'todos, pagos ou não') +
      fcard('Venda paga (real)', brl(aPagos.revenue), 'green', 'só pedidos efetivamente pagos') +
      fcard('Não pagos', nn(naoPagos), naoPagos ? 'amber' : 'green') +
      '</div>' +
      '<div class="cards6">' + fcard('Ticket médio', brl(ticket), '') + fcard('Unidades vendidas', nn(aBase.units), '') + fcard('Taxas marketplace', brl(aBase.fees), 'red') + fcard('Custo produtos', brl(aBase.cost), 'amber') + fcard('Resultado estimado', brl(aBase.result), 'green') + fcard('Margem estimada', aBase.revenue ? pct((aBase.result / aBase.revenue) * 100) : '—', '') + '</div>' +
      '<div class="cards6">' + fcard('A enviar', nn(aFeitos.byStatus.A_ENVIAR || 0), 'amber') + fcard('Expedidos (bipados)', nn(expedidos), 'blue') + fcard('Enviados', nn(aFeitos.byStatus.ENVIADO || 0), 'blue') + fcard('Concluídos', nn(aFeitos.byStatus.CONCLUIDO || 0), 'green') + fcard('Retornos e cancelados', nn(cancelados), 'red') + fcard('SKUs sem custo', nn(aBase.costPending) + ' pedidos', 'amber') + '</div>' +
      pedidosFullPanel(feitos) + pedidosModalidadesPanel(feitos) + topSkusPanel();
  }
  // §29-33: Full/FBS precisa de visibilidade própria (duas formas de identificar na planilha:
  // "Pedido FBS = Yes" e "Opção de envio = Full" — já combinadas em o.isFbs na importação) e as
  // modalidades da operação (dinâmicas — nunca hardcode a lista, novas modalidades aparecem sozinhas).
  function pedidosFullPanel(list) {
    var occByOrder = {}; occ.forEach(function (o) { if (o.orderId) occByOrder[o.orderId] = true; });
    function agg(l) { var units = 0, revenue = 0, pagos = 0, concl = 0, devol = 0; l.forEach(function (o) { units += o.items.reduce(function (s, i) { return s + i.qty; }, 0); revenue += orderFinance(o).revenue; if (o.paidAt) pagos++; if (o.normalizedStatus === 'CONCLUIDO') concl++; if (occByOrder[o.id]) devol++; }); return { n: l.length, units: units, revenue: revenue, pagos: pagos, concl: concl, devol: devol }; }
    var full = list.filter(function (o) { return o.isFbs; }); var outros = list.filter(function (o) { return !o.isFbs; });
    var aFull = agg(full), aOut = agg(outros); var total = list.length;
    var row = function (label, x) { return '<tr><td><b>' + esc(label) + '</b></td><td>' + nn(x.n) + '</td><td>' + pct(total ? r2(x.n / total * 100) : 0) + '</td><td>' + nn(x.units) + '</td><td class="nowrap">' + brl(x.revenue) + '</td><td>' + nn(x.pagos) + '</td><td>' + nn(x.concl) + '</td><td>' + nn(x.devol) + '</td></tr>'; };
    return '<div class="panel"><div class="ph"><h3>Full/FBS × demais modalidades</h3><span class="footnote" style="margin:0">pedidos únicos, no período (pedidos feitos)</span></div><div class="table-wrap"><table class="report"><thead><tr><th></th><th>Pedidos</th><th>% do total</th><th>Unidades</th><th>Faturamento</th><th>Pagos</th><th>Concluídos</th><th>Devoluções</th></tr></thead><tbody>' + row('Full/FBS', aFull) + row('Demais modalidades', aOut) + '</tbody></table></div></div>';
  }
  function pedidosModalidadesPanel(list) {
    var occByOrder = {}; occ.forEach(function (o) { if (o.orderId) occByOrder[o.orderId] = true; });
    var map = {};
    list.forEach(function (o) { var k = o.shippingOption || '(sem modalidade)'; var g = map[k] = map[k] || { k: k, n: 0, units: 0, revenue: 0, pagos: 0, concluidos: 0, devol: 0 }; g.n++; g.units += o.items.reduce(function (s, i) { return s + i.qty; }, 0); g.revenue += orderFinance(o).revenue; if (o.paidAt) g.pagos++; if (o.normalizedStatus === 'CONCLUIDO') g.concluidos++; if (occByOrder[o.id]) g.devol++; });
    var rows = Object.values(map).sort(function (a, b) { return b.n - a.n; }); var total = list.length;
    var trs = rows.map(function (g) { return '<tr><td>' + esc(g.k) + '</td><td>' + nn(g.n) + '</td><td>' + pct(total ? r2(g.n / total * 100) : 0) + '</td><td>' + nn(g.units) + '</td><td class="nowrap">' + brl(g.revenue) + '</td><td>' + nn(g.pagos) + '</td><td>' + nn(g.concluidos) + '</td><td>' + nn(g.devol) + '</td></tr>'; }).join('');
    return '<div class="panel"><div class="ph"><h3>Pedidos por modalidade</h3><span class="footnote" style="margin:0">pedidos únicos, no período</span></div><div class="table-wrap"><table class="report"><thead><tr><th>Modalidade</th><th>Pedidos</th><th>% do total</th><th>Unidades</th><th>Faturamento</th><th>Pagos</th><th>Concluídos</th><th>Devoluções</th></tr></thead><tbody>' + (trs || '<tr><td colspan="8" class="empty">—</td></tr>') + '</tbody></table></div></div>';
  }
  function topSkusPanel() {
    var map = {};
    pedidosInPeriod().forEach(function (o) { var f = orderFinance(o); o.items.forEach(function (it, i) { if (!it.sku) return; var m = map[it.sku] = map[it.sku] || { sku: it.sku, product: it.productName, units: 0, revenue: 0, result: 0 }; m.units += it.qty; m.revenue += it.subtotal; var r = f._items[i]; if (r && f.estimatedResult != null) m.result += (r.subtotal - r.allocatedFees - (r.costTotal || 0)); }); });
    var top = Object.values(map).sort(function (a, b) { return b.revenue - a.revenue; }).slice(0, 15);
    if (!top.length) return '';
    return '<div class="panel"><div class="ph"><h3>Top SKUs por venda</h3></div><div class="table-wrap"><table><thead><tr><th>SKU</th><th>Produto</th><th>Unid.</th><th>Venda</th><th>Lucro est.</th></tr></thead><tbody>' + top.map(function (m) { return '<tr><td class="mono">' + esc(m.sku) + '</td><td>' + esc((m.product || '').slice(0, 46)) + '</td><td>' + nn(m.units) + '</td><td>' + brl(m.revenue) + '</td><td>' + brl(m.result) + '</td></tr>'; }).join('') + '</tbody></table></div></div>';
  }

  // ---------- PEDIDOS · TEMPO DE ENVIO (§21-28) ----------
  // Evita pedidos atrasados e penalização da Shopee. A data-limite real (Data prevista de envio)
  // sempre vem da planilha — os limites visuais (2h/hoje/48h) são só classificação de exibição.
  var TE_LABELS = { ATRASADO: ['🔴 Atrasado', 'warn'], VENCE_MUITO_EM_BREVE: ['🔴 Vence muito em breve', 'warn'], VENCE_HOJE: ['🟠 Vence hoje', 'warn'], PROXIMO_DO_PRAZO: ['🟡 Próximo do prazo', 'warn'], DENTRO_DO_PRAZO: ['🟢 Dentro do prazo', 'ok'], ENVIADO_NO_PRAZO: ['✅ Enviado no prazo', 'ok'], ENVIADO_ATRASADO: ['⚠️ Enviado atrasado', 'warn'], SEM_PRAZO: ['— sem prazo informado', 'neutral'] };
  function teClassifica(o) {
    if (!o.shipByDate) return 'SEM_PRAZO';
    var prazo = new Date(o.shipByDate);
    if (o.shippedAt) { return new Date(o.shippedAt) <= prazo ? 'ENVIADO_NO_PRAZO' : 'ENVIADO_ATRASADO'; }
    var now = new Date(); var diffMs = prazo - now; var diffH = diffMs / 36e5;
    if (diffMs < 0) return 'ATRASADO';
    if (diffH <= 2) return 'VENCE_MUITO_EM_BREVE';
    if (prazo.toDateString() === now.toDateString()) return 'VENCE_HOJE';
    if (diffH <= 48) return 'PROXIMO_DO_PRAZO';
    return 'DENTRO_DO_PRAZO';
  }
  function teCountdownTxt(o) {
    if (!o.shipByDate || o.shippedAt) return '—';
    var ms = new Date(o.shipByDate) - new Date(); var neg = ms < 0; ms = Math.abs(ms);
    var h = Math.floor(ms / 36e5), m = Math.floor((ms % 36e5) / 6e4);
    return (neg ? '-' : '') + h + 'h' + (m < 10 ? '0' : '') + m + 'min';
  }
  // Fila operacional: só pedidos com prazo de envio informado e ainda não cancelados/devolvidos.
  function teQueue() { return pedidosInPeriod().filter(function (o) { return o.shipByDate && !pedidoIsRetornoCancelado(o); }); }
  var teF = { classe: '', preset: '', full: '', modalidade: '', search: '', sort: 'prazo' };
  function pedidosTempoEnvio() {
    var head = secHead('PEDIDOS · TEMPO DE ENVIO', 'Evitar atraso e penalização da Shopee', 'Prazo real vem da planilha (Data prevista de envio). Ordena por padrão quem vence primeiro.');
    var base = teQueue();
    if (!base.length) return head + emptyBox('Nenhum pedido com prazo de envio informado no período. Importe/atualize a planilha de Pedidos.');
    var now = new Date();
    var list = base;
    if (teF.preset === 'hoje') list = list.filter(function (o) { return new Date(o.shipByDate).toDateString() === now.toDateString(); });
    else if (teF.preset === 'amanha') { var amanha = new Date(now.getTime() + 864e5); list = list.filter(function (o) { return new Date(o.shipByDate).toDateString() === amanha.toDateString(); }); }
    else if (teF.preset === '24h') list = list.filter(function (o) { var d = new Date(o.shipByDate) - now; return d >= 0 && d <= 24 * 36e5; });
    else if (teF.preset === '48h') list = list.filter(function (o) { var d = new Date(o.shipByDate) - now; return d >= 0 && d <= 48 * 36e5; });
    if (teF.classe) list = list.filter(function (o) { return teClassifica(o) === teF.classe; });
    if (teF.full === 'full') list = list.filter(function (o) { return o.isFbs; });
    else if (teF.full === 'nfull') list = list.filter(function (o) { return !o.isFbs; });
    if (teF.modalidade) list = list.filter(function (o) { return o.shippingOption === teF.modalidade; });
    if (teF.search) { var q = teF.search.toLowerCase(); list = list.filter(function (o) { return o.id.toLowerCase().indexOf(q) >= 0 || (o.tracking || '').toLowerCase().indexOf(q) >= 0 || o.items.some(function (i) { return (i.sku || '').toLowerCase().indexOf(q) >= 0 || (i.productName || '').toLowerCase().indexOf(q) >= 0; }); }); }
    var SORTS = {
      prazo: function (a, b) { return new Date(a.shipByDate) - new Date(b.shipByDate); },
      pagamento: function (a, b) { return (a.paidAt || '').localeCompare(b.paidAt || ''); },
      produto: function (a, b) { return ((a.items[0] && a.items[0].productName) || '').localeCompare((b.items[0] && b.items[0].productName) || ''); },
      modalidade: function (a, b) { return (a.shippingOption || '').localeCompare(b.shippingOption || ''); },
      full: function (a, b) { return (b.isFbs ? 1 : 0) - (a.isFbs ? 1 : 0); },
      status: function (a, b) { return (a.normalizedStatus || '').localeCompare(b.normalizedStatus || ''); },
    };
    list = list.slice().sort(SORTS[teF.sort] || SORTS.prazo);
    // cards
    var counts = {}; base.forEach(function (o) { var c = teClassifica(o); counts[c] = (counts[c] || 0) + 1; });
    var pendentes = base.filter(function (o) { return !o.shippedAt; });
    var enviadosNoPrazo = counts.ENVIADO_NO_PRAZO || 0, enviadosAtrasado = counts.ENVIADO_ATRASADO || 0;
    var pctPrazo = (enviadosNoPrazo + enviadosAtrasado) ? r2(enviadosNoPrazo / (enviadosNoPrazo + enviadosAtrasado) * 100) : null;
    var strip = kstrip([
      { l: 'A enviar (com prazo)', v: nn(pendentes.length), cls: 'blue' },
      { l: 'Atrasados', v: nn(counts.ATRASADO || 0), cls: (counts.ATRASADO ? 'red' : 'green') },
      { l: 'Vencem hoje', v: nn(counts.VENCE_HOJE || 0), cls: (counts.VENCE_HOJE ? 'amber' : 'green') },
      { l: 'Próximos do vencimento', v: nn(counts.PROXIMO_DO_PRAZO || 0), cls: 'amber' },
      { l: 'Enviados no prazo', v: nn(enviadosNoPrazo), cls: 'green' },
      { l: 'Enviados atrasados', v: nn(enviadosAtrasado), cls: (enviadosAtrasado ? 'red' : 'green') },
      { l: '% enviados no prazo', v: pctPrazo != null ? pct(pctPrazo) : '—', cls: 'blue' },
    ]);
    var classeChips = '<div class="chips"><span class="chip' + (!teF.classe ? ' chip-on' : '') + '" data-teclasse="">Todas</span>' + Object.keys(TE_LABELS).filter(function (k) { return counts[k]; }).map(function (k) { return '<span class="chip' + (teF.classe === k ? ' chip-on' : '') + '" data-teclasse="' + k + '">' + TE_LABELS[k][0] + ' <b>' + nn(counts[k]) + '</b></span>'; }).join('') + '</div>';
    var presetChips = [['', 'Todos'], ['hoje', 'Hoje'], ['amanha', 'Amanhã'], ['24h', 'Próximas 24h'], ['48h', 'Próximas 48h']];
    var modOptions = {}; base.forEach(function (o) { if (o.shippingOption) modOptions[o.shippingOption] = 1; });
    var rows = list.slice(0, 300).map(function (o) {
      var it = (o.items || [])[0] || {}; var cl = teClassifica(o); var lb = TE_LABELS[cl];
      return '<tr class="rowlink" data-open="' + esc(o.id) + '"><td class="mono">' + esc(o.id) + '</td><td class="mono">' + esc(o.tracking || '—') + '</td><td class="cell-text">' + esc((it.productName || '—').slice(0, 30)) + '</td><td class="mono">' + esc(it.sku || '—') + '</td><td class="nowrap">' + (o.paidAt ? dbr(o.paidAt) : '—') + '</td><td class="nowrap">' + (o.shipByDate ? new Date(o.shipByDate).toLocaleString('pt-BR') : '—') + '</td><td class="nowrap">' + (o.shippedAt ? new Date(o.shippedAt).toLocaleString('pt-BR') : teCountdownTxt(o)) + '</td><td>' + esc(o.shippingOption || '—') + '</td><td>' + (o.isFbs ? '<span class="tag info">Full</span>' : '—') + '</td><td class="cell-text">' + esc(S.pedidos.labels[o.normalizedStatus] || o.orderStatus || '—') + '</td><td><span class="tag ' + lb[1] + '">' + lb[0] + '</span></td></tr>';
    }).join('');
    return head + strip + classeChips +
      '<div class="chips" style="margin-top:6px"><span class="footnote" style="margin:0 4px 0 0;align-self:center">Janela:</span>' + presetChips.map(function (c) { return '<span class="chip' + (teF.preset === c[0] ? ' chip-on' : '') + '" data-tepreset="' + c[0] + '">' + c[1] + '</span>'; }).join('') + '</div>' +
      '<div class="toolbar2" style="margin-top:8px"><input class="input sm" id="teq" style="width:240px" placeholder="Buscar pedido, BR, SKU, produto…" value="' + esc(teF.search) + '">' +
      '<select class="select sm" id="tefull"><option value=""' + (!teF.full ? ' selected' : '') + '>Full e não Full</option><option value="full"' + (teF.full === 'full' ? ' selected' : '') + '>Só Full</option><option value="nfull"' + (teF.full === 'nfull' ? ' selected' : '') + '>Só não Full</option></select>' +
      '<select class="select sm" id="temod"><option value="">Todas as modalidades</option>' + Object.keys(modOptions).map(function (m) { return '<option value="' + esc(m) + '"' + (teF.modalidade === m ? ' selected' : '') + '>' + esc(m) + '</option>'; }).join('') + '</select>' +
      '<select class="select sm" id="tesort"><option value="prazo"' + (teF.sort === 'prazo' ? ' selected' : '') + '>Quem vence primeiro</option><option value="pagamento"' + (teF.sort === 'pagamento' ? ' selected' : '') + '>Pagamento mais antigo</option><option value="produto"' + (teF.sort === 'produto' ? ' selected' : '') + '>Produto</option><option value="modalidade"' + (teF.sort === 'modalidade' ? ' selected' : '') + '>Modalidade</option><option value="full"' + (teF.sort === 'full' ? ' selected' : '') + '>Full primeiro</option><option value="status"' + (teF.sort === 'status' ? ' selected' : '') + '>Status</option></select></div>' +
      '<div class="count-line"><b>' + nn(list.length) + '</b> pedidos' + (list.length > 300 ? ' (mostrando 300)' : '') + '</div>' +
      '<div class="panel"><div class="table-wrap"><table class="report"><thead><tr><th>Pedido</th><th>BR</th><th>Produto</th><th>SKU</th><th>Pagamento</th><th>Prazo de envio</th><th>Enviado / restante</th><th>Modalidade</th><th>Full?</th><th>Status Shopee</th><th>Situação do prazo</th></tr></thead><tbody>' + (rows || '<tr><td colspan="11" class="empty">Nenhum pedido neste filtro.</td></tr>') + '</tbody></table></div></div>';
  }
  function bindPedidosTempoEnvio() {
    app.querySelectorAll('[data-teclasse]').forEach(function (c) { c.onclick = function () { teF.classe = c.dataset.teclasse; render(); }; });
    app.querySelectorAll('[data-tepreset]').forEach(function (c) { c.onclick = function () { teF.preset = c.dataset.tepreset; render(); }; });
    var fu = document.getElementById('tefull'); if (fu) fu.onchange = function () { teF.full = fu.value; render(); };
    var md = document.getElementById('temod'); if (md) md.onchange = function () { teF.modalidade = md.value; render(); };
    var so = document.getElementById('tesort'); if (so) so.onchange = function () { teF.sort = so.value; render(); };
    var q = document.getElementById('teq'); if (q) { var deb; q.oninput = function () { clearTimeout(deb); deb = setTimeout(function () { var v = q.value; teF.search = v; render(); var el = document.getElementById('teq'); if (el) { el.focus(); el.value = v; el.setSelectionRange(v.length, v.length); } }, 200); }; }
    app.querySelectorAll('[data-open]').forEach(function (b) { b.onclick = function () { openOrder(b.dataset.open); }; });
  }
  function openOrder(id) {
    var o = orders.find(function (x) { return x.id === id; }); if (!o) return;
    var f = orderFinance(o); var occs = occ.filter(function (x) { return x.orderId === id; });
    var itemsHtml = o.items.map(function (it, i) {
      var r = f._items[i];
      var lucro = (f.estimatedResult == null || r.costTotal == null) ? '<span class="tag warn">lucro estimado pendente</span>' : '<b style="color:var(--ok)">' + brl(r.subtotal - r.allocatedFees - r.costTotal) + '</b>';
      var custo = r.costUnit == null ? (r.linked ? '<span class="tag warn">custo não cadastrado</span>' : '<span class="tag warn">SKU não vinculado</span>') : brl(r.costUnit) + ' × ' + it.qty + ' = ' + brl(r.costTotal);
      return '<div class="ro" style="margin-bottom:8px"><b>' + esc((it.productName || '—')) + '</b>' + (it.variationName ? ' · ' + esc(it.variationName) : '') + '<div class="footnote" style="margin-top:4px">SKU <span class="mono">' + esc(it.sku || '—') + '</span> · qtd ' + it.qty + '</div>' +
        '<div class="fin-line"><span>Preço acordado (venda real)</span><span>' + brl(it.agreedPrice) + '</span></div><div class="fin-line"><span>Subtotal</span><span>' + brl(it.subtotal) + '</span></div>' +
        '<div class="fin-line"><span>Taxas rateadas <span class="tag">rateada</span></span><span class="neg">-' + brl(r.allocatedFees) + '</span></div><div class="fin-line"><span>Custo</span><span>' + custo + '</span></div>' +
        '<div class="fin-line total"><span>Lucro estimado</span><span>' + lucro + '</span></div></div>';
    }).join('');
    var d = document.createElement('div'); d.className = 'drawer drawer-wide';
    d.innerHTML = '<div class="drawer-panel"><div class="dh"><div><b>Pedido ' + esc(o.id) + '</b><div class="footnote" style="margin-top:2px">Shopee · lidermolduras · ' + dbr(o.createdAt) + '</div></div><div style="display:flex;gap:8px;align-items:center"><button class="btn-sm" id="go360">Ficha Financeira 360º</button><button class="x">&times;</button></div></div><div class="dbd">' +
      '<div class="cards6">' + fcard('Venda real', brl(f.revenue), 'blue') + fcard('Valor Total', brl(o.totalAmount), '') + fcard('Taxas marketplace', brl(f.marketplaceFeesTotal), 'red') + fcard('Custo produtos', f.costPending ? '—' : brl(f.productCostTotal), 'amber') + fcard('Lucro estimado', f.estimatedResult == null ? 'pendente' : brl(f.estimatedResult), 'green') + fcard('Margem', f.estimatedMarginPct == null ? '—' : pct(f.estimatedMarginPct), '') + '</div>' +
      '<div class="split"><div><div class="panel"><div class="ph"><h3>Itens do pedido</h3><span class="footnote" style="margin:0">' + o.items.length + '</span></div><div class="pb">' + itemsHtml + '</div></div></div>' +
      '<div><div class="panel"><div class="ph"><h3>Composição financeira</h3></div><div class="pb">' + finLine('Venda real (Σ preço acordado)', f.revenue) + finLine('Valor Total (Shopee)', o.totalAmount) + finLine('Comissão líquida', -o.commissionNet, true) + finLine('Taxa de serviço líquida', -o.serviceFeeNet, true) + finLine('Taxa de transação', -o.transactionFee, true) + finLine('Frete reverso', -o.reverseShippingFee, true) + finLine('Custo produtos', f.costPending ? null : -f.productCostTotal, true) + '<div class="fin-line total"><span>Resultado estimado</span><span class="' + (f.estimatedResult >= 0 ? 'pos' : 'neg') + '">' + (f.estimatedResult == null ? 'pendente (custo)' : brl(f.estimatedResult)) + '</span></div></div></div>' +
      '<div class="panel"><div class="ph"><h3>Logística & cliente</h3></div><div class="pb">' + kv('Status Shopee', o.orderStatus) + kv('BR / Rastreamento', o.tracking) + kv('Envio', (o.shippingOption || '') + ' ' + (o.shippingMethod || '')) + (o.isFbs ? kv('Full/FBS', 'Sim') : '') + kv('Pagamento', o.paidAt ? new Date(o.paidAt).toLocaleString('pt-BR') : 'não pago') + kv('Prazo de envio', dbr(o.shipByDate)) + kv('Enviado em', o.shippedAt ? new Date(o.shippedAt).toLocaleString('pt-BR') : '—') + kv('Cidade/UF', (o.city || '—') + '/' + (o.uf || '—')) + kv('Devolução', o.returnRefundStatus || '—') + '</div></div>' +
      (occs.length ? '<div class="panel"><div class="ph"><h3>Devolução vinculada</h3></div><div class="pb">' + occs.map(function (x) { return '<div class="ro" style="margin-bottom:6px">' + esc(x.type) + ' · ' + esc(x.status || '—') + ' · ' + brl(x.requested) + ' <span class="tag">' + x.exposure.bucket + '</span></div>'; }).join('') + '</div></div>' : '') +
      '</div></div></div></div>';
    d.onclick = function (e) { if (e.target === d) d.remove(); }; d.querySelector('.x').onclick = function () { d.remove(); };
    d.querySelector('#go360').onclick = function () { openPedidoFicha360(o.id); };
    document.body.appendChild(d);
  }

  // ---------- FICHA FINANCEIRA 360º DO PEDIDO ----------
  // O ID do pedido é a chave central: consolida Pedidos, Produtos (custo), Minha Renda (taxas
  // detalhadas), Shopee Acelera, Afiliados, Saldo da Carteira e Devoluções em uma única visão.
  // §2 do prompt de reorganização financeira e operacional.
  function fLine(label, cents, opt) { opt = opt || {}; if (cents == null) return '<div class="fin-line"><span>' + esc(label) + '</span><span class="tag warn">' + (opt.missingLabel || 'não disponível') + '</span></div>'; return '<div class="fin-line' + (opt.total ? ' total' : '') + '"><span>' + esc(label) + '</span><span class="' + (cents < 0 ? 'neg' : cents > 0 && opt.pos ? 'pos' : '') + '">' + brlC(cents) + '</span></div>'; }
  function openPedidoFicha360(orderId) {
    var ord = orders.find(function (x) { return x.id === orderId; });
    var mr = mrEngine(); var mrRow = mr.orders.find(function (r) { return r.orderId === orderId; });
    var svcRows = mrSvc.filter(function (v) { return v.orderId === orderId; });
    var shipRow = mrShip.find(function (s) { return s.id === orderId; });
    var acRows = acelera.filter(function (r) { return r.pedido === orderId; });
    var affEng = affEngine(); var affRow = affEng.orderMap[orderId];
    var wtx = wallet.filter(function (t) { return t.orderId === orderId; });
    var occs = occ.filter(function (x) { return !x.isDemo && x.orderId === orderId; });
    var bip = shipBip[orderId];
    var st = pedidoConciliacaoStatus(orderId);

    var d = document.createElement('div'); d.className = 'drawer'; var panel = document.createElement('div'); panel.className = 'drawer-panel'; panel.style.width = '860px'; panel.style.maxWidth = '98vw';
    d.appendChild(panel); d.onclick = function (e) { if (e.target === d) d.remove(); }; document.body.appendChild(d);

    // ---- Receita e custo (base: Minha Renda se disponível — mais detalhado; senão Pedidos) ----
    var receitaC = mrRow ? mrRow.preco : (ord ? Math.round(orderFinance(ord).revenue * 100) : null);
    var custoProdC = null, custoPendente = false;
    if (ord) { var fOrd = orderFinance(ord); if (fOrd.costPending) custoPendente = true; else custoProdC = Math.round((fOrd.productCostTotal || 0) * 100); }

    // ---- Taxas Shopee detalhadas ----
    var taxasRows;
    if (mrRow) {
      taxasRows = [['Comissão', mrRow.comissao], ['Taxa de serviço líquida', mrRow.servico], ['Taxa de transação', mrRow.transacao], ['Afiliados (Minha Renda)', mrRow.afiliado], ['Frete cobrado pelo parceiro', mrRow.freteParceiro], ['Desconto de frete (Shopee)', mrRow.descontoFrete], ['Envio reverso', mrRow.envioReverso], ['Cupom', mrRow.cupom], ['Ajuste PIX', mrRow.pix], ['Reembolso', mrRow.reembolso]];
    } else if (ord) {
      taxasRows = [['Comissão líquida', -Math.round((ord.commissionNet || 0) * 100)], ['Taxa de serviço líquida', -Math.round((ord.serviceFeeNet || 0) * 100)], ['Taxa de transação', -Math.round((ord.transactionFee || 0) * 100)], ['Frete reverso', -Math.round((ord.reverseShippingFee || 0) * 100)]];
    } else taxasRows = [];
    var taxasSomaC = taxasRows.reduce(function (s, r) { return s + (r[1] || 0); }, 0);
    // Conferência matemática determinística (§6): total informado × soma dos componentes.
    // Nunca usa IA — só soma os campos já importados de Minha Renda/Service Fee Details.
    function conferencia(total, soma) { if (total == null) return ''; var dif = total - soma; var bate = Math.abs(dif) <= 100; return '<span class="tag ' + (bate ? 'ok' : 'warn') + '">' + (bate ? '🟢 Conferido' : '🔴 Divergência de ' + brlC(dif)) + '</span>'; }
    var svcComposicao = '';
    if (svcRows.length) {
      var svcT = { afil: 0, trans: 0, item: 0 }; svcRows.forEach(function (v) { svcT.afil += v.afiliadosVendedor; svcT.trans += v.transacao; svcT.item += v.porItem; });
      var svcSoma = svcT.afil + svcT.trans + svcT.item; var svcTotal = mrRow ? mrRow.servico : null;
      svcComposicao = '<div class="panel"><div class="ph"><h3>Taxa de serviço líquida — composição</h3>' + conferencia(svcTotal, svcSoma) + '</div><div class="pb">' + fLine('Taxa de serviço líquida (total)', svcTotal) + '<div class="footnote" style="margin:6px 0">Componentes (Service Fee Details, mesmo pedido — não somados por cima do total):</div>' + fLine('↳ Afiliados do vendedor', svcT.afil) + fLine('↳ Transação', svcT.trans) + fLine('↳ Por item vendido', svcT.item) + '<div class="footnote" style="margin-top:6px">Origem: Minha Renda (Service Fee Details) · Pedido ' + esc(orderId) + '</div></div></div>';
    }
    // Composição da comissão (§3-6): bruta → líquida, usando colunas já importadas e não usadas
    // em nenhuma outra tela (comissaoBruta/servicoBruta) — nada inventado, só exposto.
    var comComposicao = '';
    if (mrRow && mrRow.comissaoBruta != null && mrRow.comissaoBruta !== 0 && mrRow.comissaoBruta !== mrRow.comissao) {
      var comDesc = mrRow.comissao - mrRow.comissaoBruta;
      comComposicao = '<div class="panel"><div class="ph"><h3>Comissão — composição</h3>' + conferencia(mrRow.comissao, mrRow.comissaoBruta + comDesc) + '</div><div class="pb">' + fLine('Comissão bruta', mrRow.comissaoBruta) + fLine('↳ Desconto/ajuste aplicado pela Shopee', comDesc) + fLine('Comissão líquida (total)', mrRow.comissao, { total: true }) + '<div class="footnote" style="margin-top:6px">Origem: Minha Renda · Pedido ' + esc(orderId) + '</div></div></div>';
    }
    // Ajustes (Adjustment) ligados a este pedido — mesmo campo orderId da Minha Renda, sem inventar vínculo.
    var adjRows = mrAdj.filter(function (a) { return a.orderId === orderId; });
    var adjTotalC = adjRows.reduce(function (s, a) { return s + a.valor; }, 0);
    var adjBlock = adjRows.length ? '<div class="panel"><div class="ph"><h3>Ajustes (Minha Renda · Adjustment)</h3></div><div class="pb">' + adjRows.map(function (a) { return fLine(a.desc || 'Ajuste', a.valor); }).join('') + fLine('Total de ajustes deste pedido', adjTotalC, { total: true }) + '<div class="footnote" style="margin-top:6px">Origem: Minha Renda (Adjustment) · Pedido ' + esc(orderId) + '</div></div></div>' : '';

    // ---- Acelera ----
    var acBlock = '';
    if (acRows.length) { var acAntec = acRows.reduce(function (s, r) { return s + r.antecipado; }, 0), acTaxa = acRows.reduce(function (s, r) { return s + r.taxa; }, 0), acReceb = acRows.reduce(function (s, r) { return s + r.recebido; }, 0); acBlock = '<div class="panel"><div class="ph"><h3>Shopee Acelera</h3></div><div class="pb">' + fLine('Valor antecipado', acAntec) + fLine('Taxa de antecipação', -Math.abs(acTaxa)) + fLine('Líquido recebido', acReceb, { total: true }) + '<button class="btn-sm" style="margin-top:8px" data-acped360="' + esc(orderId) + '">Abrir no Acelera</button></div></div>'; }
    else acBlock = '<div class="panel"><div class="ph"><h3>Shopee Acelera</h3></div><div class="pb"><span class="tag neutral">não encontrado no Acelera</span> — pedido não antecipado, ou relatório do Acelera ainda não cobre este pedido.</div></div>';

    // ---- Afiliados ----
    var afBlock = '';
    if (affRow) afBlock = '<div class="panel"><div class="ph"><h3>Afiliados</h3></div><div class="pb">' + kv('Afiliado', affRow.affUser) + '<div class="fin-line"><span>Comissão</span><span class="neg">' + brlU(affRow.comAff) + '</span></div><div class="fin-line"><span>Taxa de serviço afiliados</span><span class="neg">' + brlU(affRow.svcFee) + '</span></div>' + (mrRow ? '<div class="footnote" style="margin-top:6px">Já incluído em "Afiliados (Minha Renda)" nas taxas acima — não somado de novo no resultado, para evitar dupla contagem.</div>' : '') + '<button class="btn-sm" style="margin-top:8px" data-affped360="' + esc(orderId) + '">Abrir em Afiliados</button></div></div>';

    // ---- Carteira ----
    var wBlock = '';
    if (wtx.length) { var wSum = wtx.reduce(function (s, t) { return s + t.amount; }, 0); wBlock = '<div class="panel"><div class="ph"><h3>Saldo da Carteira</h3><span class="footnote" style="margin:0">' + nn(wtx.length) + ' movimentação(ões)</span></div><div class="pb"><div class="fin-line total"><span>Líquido na carteira</span><span class="' + (wSum < 0 ? 'neg' : 'pos') + '">' + brl(wSum) + '</span></div></div></div>'; }
    else wBlock = '<div class="panel"><div class="ph"><h3>Saldo da Carteira</h3></div><div class="pb"><span class="tag neutral">nenhuma movimentação localizada</span></div></div>';

    // ---- Devolução ----
    var devBlock = '';
    if (occs.length) devBlock = '<div class="panel"><div class="ph"><h3>Devolução</h3></div><div class="pb">' + occs.map(function (x) { var r = occResultadoDevolucao(x); return kv('Status', statusLabel(x.status)) + kv('Motivo', x.reason || '—') + '<div class="fin-line"><span>Resultado (<span class="tag ' + (r.status === 'confirmado' ? 'ok' : 'info') + '">' + (r.status === 'confirmado' ? 'confirmado' : 'provisório') + '</span>)</span><span class="neg">' + brl(r.perda) + '</span></div><button class="btn-sm" style="margin-top:6px" data-godev360="' + esc(x.id) + '">Abrir devolução</button>'; }).join('<hr style="border:none;border-top:1px solid var(--line);margin:10px 0">') + '</div></div>';

    // ---- Resultado final ----
    // Evita dupla contagem (§ regra de não duplicidade): quando Minha Renda já cobre o pedido, o
    // campo "Afiliados" da própria Renda já está dentro de taxasSomaC — não soma de novo do relatório de Afiliados.
    var custoAfilCents = (!mrRow && affRow) ? Math.round((affRow.comAff + affRow.svcFee) / 100) : 0;
    var acTaxaCents = acRows.length ? acRows.reduce(function (s, r) { return s + r.taxa; }, 0) : 0; // já em cents
    // Usa o resultado CONFIRMADO da baixa quando existir (custo real − reaproveitável), senão o
    // provisório (§22-24) — occResultadoDevolucao() cai para occEffectiveLoss() automaticamente.
    var devImpactoCents = occs.length ? Math.round(occs.reduce(function (s, x) { return s + occResultadoDevolucao(x).perda; }, 0) * 100) : 0;
    var devConfirmadoN = occs.filter(function (x) { return occResultadoDevolucao(x).status === 'confirmado'; }).length;
    var lucroConhecido = receitaC != null && (custoProdC != null || !custoPendente);
    var resultadoC = null;
    if (receitaC != null && custoProdC != null) { resultadoC = receitaC + taxasSomaC - custoProdC - custoAfilCents - acTaxaCents - devImpactoCents + adjTotalC; }
    var margemPct = (resultadoC != null && receitaC) ? r2(resultadoC / receitaC * 100) : null;
    var taxasConf = mrRow ? conferencia(mrRow.liberado, mrRow.preco + taxasSomaC) : '';

    var idBlock = '<div class="panel"><div class="ph"><h3>Identificação</h3></div><div class="pb">' + kv('Pedido', orderId) + kv('BR / Rastreamento', ord ? ord.tracking : '—') + kv('Data da venda', ord ? dbr(ord.createdAt) : '—') + kv('Data de conclusão (Minha Renda)', mrRow ? dbr(mrRow.dataConclusao) : '—') + kv('Data de expedição (bipe)', bip ? new Date(bip.bipedAt).toLocaleString('pt-BR') : 'ainda não expedido') + kv('Status', ord ? (S.pedidos.labels[ord.normalizedStatus] || ord.orderStatus) : '—') + (ord && ord.isFbs ? kv('Full/FBS', 'Sim') : '') + '</div></div>';

    panel.innerHTML = '<div class="dh"><div><b>Ficha Financeira 360º</b> — <span class="mono">' + esc(orderId) + '</span></div><button class="x">&times;</button></div><div class="dbd">' +
      '<div class="kstrip" style="margin-bottom:12px">' +
      '<div class="kc"><div class="kl">Status de conciliação</div><div class="kv" style="font-size:15px">' + st.label + '</div></div>' +
      '<div class="kc"><div class="kl">Receita</div><div class="kv" style="font-size:16px">' + (receitaC != null ? brlC(receitaC) : '—') + '</div></div>' +
      '<div class="kc"><div class="kl">Custo produto</div><div class="kv" style="font-size:16px">' + (custoProdC != null ? brlC(custoProdC) : (custoPendente ? '<span class="tag warn">pendente</span>' : '—')) + '</div></div>' +
      '<div class="kc"><div class="kl">Lucro real do pedido</div><div class="kv" style="font-size:16px;color:' + (resultadoC != null && resultadoC < 0 ? 'var(--err)' : 'var(--ok)') + '">' + (resultadoC != null ? brlC(resultadoC) : '<span class="tag warn">custo pendente</span>') + '</div></div>' +
      '<div class="kc"><div class="kl">Margem</div><div class="kv" style="font-size:16px">' + (margemPct != null ? pct(margemPct) : '—') + '</div></div>' +
      '</div>' +
      idBlock +
      '<div class="panel"><div class="ph"><h3>Taxas Shopee (detalhado, individualizado)</h3>' + taxasConf + '</div><div class="pb"><span class="footnote">' + (mrRow ? 'Origem: Minha Renda · Pedido ' + esc(orderId) : ord ? 'Origem: Pedidos (aproximado — sem Minha Renda para este pedido)' : 'sem fonte') + '</span>' + (taxasRows.length ? taxasRows.map(function (r) { return fLine(r[0], r[1]); }).join('') + fLine('Total de taxas', taxasSomaC, { total: true }) : '<span class="tag neutral">sem dados de taxas para este pedido</span>') + '</div></div>' +
      comComposicao + svcComposicao + adjBlock +
      (shipRow ? '<div class="panel"><div class="ph"><h3>Frete — divergência</h3></div><div class="pb">' + fLine('Esperado', shipRow.esperado) + fLine('Real', shipRow.real) + fLine('Diferença', shipRow.real - shipRow.esperado, { total: true }) + '</div></div>' : '') +
      acBlock + afBlock + wBlock + devBlock +
      '<div class="panel"><div class="ph"><h3>Resultado</h3></div><div class="pb">' +
      fLine('Receita', receitaC) + fLine('+ Taxas Shopee (líquido, já negativo, inclui afiliados quando há Minha Renda)', taxasSomaC) + fLine('− Custo do produto', custoProdC != null ? -custoProdC : null) + (custoAfilCents ? fLine('− Custo de afiliados (sem Minha Renda para este pedido)', -custoAfilCents) : '') + fLine('− Taxa Acelera', -Math.abs(acTaxaCents)) + fLine('− Impacto de devolução (' + (devConfirmadoN === occs.length && occs.length ? 'confirmado' : occs.length ? 'parcialmente confirmado' : 'provisório') + ')', -devImpactoCents) + (adjRows.length ? fLine('+ Ajustes (Minha Renda)', adjTotalC) : '') +
      '<div class="fin-line total"><span>Lucro real do pedido</span><span class="' + (resultadoC != null && resultadoC < 0 ? 'neg' : 'pos') + '">' + (resultadoC != null ? brlC(resultadoC) : 'aguardando custo do produto') + '</span></div>' +
      '</div></div>' +
      '<div class="footnote" style="padding:8px 0">Fontes usadas: Pedidos' + (mrRow ? ' · Minha Renda' : '') + (svcRows.length ? ' · Service Fee Details' : '') + (adjRows.length ? ' · Adjustment' : '') + (acRows.length ? ' · Shopee Acelera' : '') + (affRow ? ' · Afiliados' : '') + (wtx.length ? ' · Saldo da Carteira' : '') + (occs.length ? ' · Devoluções' : '') + '.</div>' +
      (ord ? '<button class="btn-sm" data-goped="' + esc(orderId) + '">Ver na lista de Pedidos</button>' : '') +
      '</div>';
    panel.querySelector('.x').onclick = function () { d.remove(); };
    var gp = panel.querySelector('[data-goped]'); if (gp) gp.onclick = function () { d.remove(); route = 'pedidos'; sub.pedidos = 'pedidos'; render(); };
    var gd = panel.querySelector('[data-godev360]'); if (gd) gd.onclick = function () { var id2 = gd.dataset.godev360; d.remove(); route = 'posvenda'; sub.posvenda = 'casos'; render(); setTimeout(function () { openFicha(id2); }, 60); };
    var ga = panel.querySelector('[data-acped360]'); if (ga) ga.onclick = function () { d.remove(); route = 'acelera'; aceleraSub = 'antecipacoes'; render(); setTimeout(function () { openAceleraPedido(orderId); }, 60); };
    var gf = panel.querySelector('[data-affped360]'); if (gf) gf.onclick = function () { d.remove(); route = 'afiliados'; affSub = 'pedidos'; render(); setTimeout(function () { openAffPedido(orderId); }, 60); };
  }

  // ---------- PÓS-VENDA ----------
  function sumExposure(list) { var a = { requested: 0, confirmedLoss: 0, atRisk: 0, recovered: 0, cancelled: 0 }; list.forEach(function (o) { var e = o.exposure; a.requested += e.requested; a.confirmedLoss += e.confirmedLoss; a.atRisk += e.atRisk; if (e.bucket === 'RECOVERED') a.recovered += e.compensation; if (e.bucket === 'CANCELLED') a.cancelled += e.requested; }); Object.keys(a).forEach(function (k) { a[k] = Math.round(a[k] * 100) / 100; }); return a; }
  // Estado das novas abas operacionais da Devolução.
  var arF = 'todos';            // filtro da fila de Recebimentos
  var recSearch = '';           // busca da fila de Recebimentos
  var analiseSub = 'problemas'; // sub-aba de "Análises": problemas | financeiro | evolucao | inteligencia
  var dispChip = 'recorrer';    // filtro operacional de "Disputas" (padrão: para recorrer)
  var finDrill = null;          // categoria de "Financeiro" em drill-down
  var finSub = 'impacto';       // sub-aba do Financeiro: impacto | taxas | areceber | concil
  var analiseReason = null;     // motivo selecionado na investigação (Motivo → Produtos)
  var analiseProduct = null;    // produto selecionado na investigação (Produto → Motivos)
  var TYPE_LABELS = { RETURN_REFUND: 'Devolução', ORDER_CANCELLATION: 'Cancelamento', FAILED_DELIVERY: 'Falha de entrega' };
  // Situação do caso em linguagem do usuário (sem termos técnicos como "bucket"/"exposure").
  function situacaoCaso(o) {
    var b = o.exposure ? o.exposure.bucket : null;
    if (b === 'CONFIRMED') return ['Perda confirmada', 'warn'];
    if (b === 'AT_RISK') return ['Em risco', 'info'];
    if (b === 'RECOVERED') return ['Recuperado', 'ok'];
    if (b === 'CANCELLED') return ['Cancelado', 'ok'];
    return ['Sem impacto', 'ok'];
  }

  function devReceiptSituation(o) { return RECEIPT_LABELS[o.receiptState] || '—'; }
  function devReturnList() { return occInPeriod().filter(expectsReturn); }

  // ---- Jornada operacional (§10-24 do prompt de alterações pontuais) ----
  // A ETAPA (onde o caso está) é sempre CALCULADA — nunca digitada — a partir dos campos que já são
  // fonte da verdade (receiptState, exposure.bucket, disputeStatus, internalStatus/hasSellerWindow).
  // Isso separa etapa de MOTIVO (o.reason) — os dois nunca aparecem misturados no mesmo filtro — e
  // se adapta ao tipo do caso: devolução tem etapas que cancelamento não tem, e vice-versa (§18).
  var JORNADA_META = {
    NOVA: 'Nova solicitação', AVALIACAO: 'Em avaliação', ACAO_NECESSARIA: 'Ação necessária / Recurso', AGUARDANDO_SHOPEE: 'Aguardando Shopee',
    COLETA: 'Aprovada — Organizar coleta', FALHA_IDENTIFICADA: 'Falha identificada', CONCILIACAO: 'Aprovado — Conciliar financeiro',
    TRANSPORTE: 'Em devolução / transporte', VALIDAR: 'Retornada — Validar', BAIXADA: 'Baixada / Concluída', REJEITADA: 'Rejeitada / Cancelada',
  };
  var JORNADA_POR_TIPO = {
    RETURN_REFUND: ['NOVA', 'AVALIACAO', 'ACAO_NECESSARIA', 'AGUARDANDO_SHOPEE', 'COLETA', 'TRANSPORTE', 'VALIDAR', 'BAIXADA', 'REJEITADA'],
    FAILED_DELIVERY: ['NOVA', 'AVALIACAO', 'FALHA_IDENTIFICADA', 'TRANSPORTE', 'VALIDAR', 'BAIXADA', 'REJEITADA'],
    ORDER_CANCELLATION: ['NOVA', 'AVALIACAO', 'CONCILIACAO', 'BAIXADA', 'REJEITADA'],
  };
  function casoJornada(o) {
    var b = o.exposure ? o.exposure.bucket : null;
    if (b === 'CANCELLED') return 'REJEITADA';
    if (['RECEBIDO', 'PARCIAL', 'DIVERGENCIA'].indexOf(o.receiptState) >= 0) return 'BAIXADA';
    if (o.receiptState === 'CHEGOU_CONFERIR') return 'VALIDAR';
    if (o.receiptState === 'EM_TRANSITO') return 'TRANSPORTE';
    if (o.type === 'ORDER_CANCELLATION') { if (b === 'RECOVERED') return 'BAIXADA'; if (b === 'CONFIRMED') return 'CONCILIACAO'; return o.internalStatus === 'NOVA' ? 'NOVA' : 'AVALIACAO'; }
    if (b === 'CONFIRMED') return o.type === 'FAILED_DELIVERY' ? 'FALHA_IDENTIFICADA' : 'COLETA';
    if (o.disputeStatus && ['RESPONDIDA', 'AGUARDANDO_SHOPEE'].indexOf(o.disputeStatus) >= 0) return 'AGUARDANDO_SHOPEE';
    if (o.internalStatus === 'AGUARDANDO_RESULTADO') return 'AGUARDANDO_SHOPEE';
    if (o.type !== 'FAILED_DELIVERY' && o.hasSellerWindow && o.disputeDeadline) return 'ACAO_NECESSARIA';
    if (o.internalStatus === 'NOVA') return 'NOVA';
    return 'AVALIACAO';
  }
  var JORNADA_PROXIMA_ACAO = {
    NOVA: 'Analisar a solicitação e classificar o motivo', AVALIACAO: 'Continuar avaliação — sem ação externa pendente agora',
    ACAO_NECESSARIA: 'Enviar evidências/recurso à Shopee', AGUARDANDO_SHOPEE: 'Aguardar decisão/resposta da Shopee',
    COLETA: 'Organizar a coleta/postagem da devolução', FALHA_IDENTIFICADA: 'Verificar com a transportadora e organizar o retorno',
    CONCILIACAO: 'Conferir o reembolso na Carteira/Financeiro', TRANSPORTE: 'Aguardar o retorno da mercadoria',
    VALIDAR: 'Conferir o produto e dar baixa', BAIXADA: 'Concluído — nenhuma ação pendente', REJEITADA: 'Encerrado — nenhuma ação pendente',
  };
  function casoProximaAcao(o) {
    var j = casoJornada(o); var text = JORNADA_PROXIMA_ACAO[j] || '—'; var prazo = (j === 'ACAO_NECESSARIA' && o.disputeDeadline) ? o.disputeDeadline : null;
    if (prazo) text += ' até ' + dbr(prazo);
    return { jornada: j, label: JORNADA_META[j] || j, text: text, prazo: prazo };
  }
  // MOTIVO (causa declarada pelo cliente/Shopee, o.reason) — dimensão SEPARADA da jornada (§16-17).
  // "Motivo não informado" só aparece quando a fonte importada realmente não trouxe motivo — nunca
  // inventamos um motivo que não existe nos dados.
  function casoMotivo(o) { return (o.reason || '').trim() || 'Motivo não informado'; }

  // ---- Duas visões de tempo (§3-6 do prompt de remodelação de Devolução) — NUNCA confundir: ----
  // "Data da venda/pagamento" vem do módulo PEDIDOS (cruzada por ID do pedido, preferindo a hora do
  // pagamento) — responde "quando esse pedido pertenceu à operação de vendas". "Devolução aberta em"
  // é o campo próprio da base de devolução (Tempo de envio de devolução → returnOpenedAt) — responde
  // "quando o problema chegou até nós". São dimensões diferentes: a primeira alimenta a coorte de
  // vendas (qualidade/produto/SKU), a segunda alimenta a carga operacional do período.
  function occVendaData(o) {
    var ord = orders.find(function (x) { return x.id === o.orderId; });
    if (ord) return ord.paidAt || ord.createdAt || o.orderCreatedAt || null;
    return o.orderCreatedAt || null;
  }
  function occAberturaData(o) { return o.returnOpenedAt || o.occurredAt || null; }
  function occDiasVendaAteAbertura(o) {
    var v = occVendaData(o), a = occAberturaData(o); if (!v || !a) return null;
    var d = Math.round((new Date(a) - new Date(v)) / 864e5); return d >= 0 ? d : null;
  }
  var DIAS_FAIXAS = [[0, 7, '0–7 dias'], [8, 15, '8–15 dias'], [16, 30, '16–30 dias'], [31, 45, '31–45 dias'], [46, Infinity, '+45 dias']];
  function occFaixaDias(dias) { if (dias == null) return null; for (var i = 0; i < DIAS_FAIXAS.length; i++) { if (dias >= DIAS_FAIXAS[i][0] && dias <= DIAS_FAIXAS[i][1]) return DIAS_FAIXAS[i][2]; } return null; }

  // ---- Resultado do caso (§17-19) — SEPARADO de Status Shopee / Status interno / Disputa. Nunca
  // confundir "Aprovada" (Shopee aprovou a devolução/reembolso) com "Disputa ganha" (nós recorremos
  // e a Shopee nos deu razão) — só o campo disputeStatus decide se houve disputa e qual foi o resultado.
  var RESULTADO_META = {
    EM_ABERTO: 'Em aberto', SEM_DISPUTA: 'Sem disputa', DISPUTA_GANHA: 'Disputa ganha', DISPUTA_PERDIDA: 'Disputa perdida',
    APROVADA_SHOPEE: 'Solicitação aprovada pela Shopee', REJEITADA: 'Solicitação rejeitada', CANCELADA_COMPRADOR: 'Cancelada pelo comprador',
    COMPENSADO: 'Compensado pela Shopee', ENCERRADO_SEM_COMPENSACAO: 'Encerrado sem compensação',
  };
  function casoResultado(o) {
    var st = normStatus(o.status || ''); var b = o.exposure ? o.exposure.bucket : null; var ds = o.disputeStatus;
    if (/comprador/.test(st) && /cancel/.test(st)) return 'CANCELADA_COMPRADOR';
    if (ds === 'GANHA' || ds === 'PARCIAL') return 'DISPUTA_GANHA';
    if (ds === 'PERDIDA' || ds === 'PRAZO_PERDIDO') return 'DISPUTA_PERDIDA';
    if (b === 'CANCELLED') return 'REJEITADA';
    if (b === 'RECOVERED') return 'COMPENSADO';
    if (b === 'CONFIRMED') { if (ds && ds !== 'NAO_INICIADA') return 'DISPUTA_PERDIDA'; return o.hasDispute ? 'ENCERRADO_SEM_COMPENSACAO' : (ds === 'NAO_INICIADA' ? 'APROVADA_SHOPEE' : 'SEM_DISPUTA'); }
    return 'EM_ABERTO';
  }

  // ---- Prioridade operacional determinística (§55) — nunca LLM; só prazo + etapa da jornada. ----
  var PRIORIDADE_META = { CRITICA: '🔴 Crítica', ALTA: '🟠 Alta', MEDIA: '🟡 Média', ACOMPANHAMENTO: '🔵 Acompanhamento', ENCERRADA: '⚪ Encerrada' };
  function casoPrioridade(o) {
    var j = casoJornada(o);
    if (j === 'BAIXADA' || j === 'REJEITADA') return 'ENCERRADA';
    if (j === 'ACAO_NECESSARIA' && o.disputeDeadline) {
      var dias = Math.ceil((new Date(o.disputeDeadline) - Date.now()) / 864e5);
      if (dias <= 0) return 'CRITICA';
      if (dias <= 2) return 'ALTA';
    }
    if (j === 'NOVA') return 'MEDIA';
    return 'ACOMPANHAMENTO';
  }

  // ---- Controle de prazo (§26-28) — "Ação do Vendedor solicitada até" comanda a fila. Prazo vencido
  // NUNCA vira "disputa perdida" sozinho — é só um alerta operacional (§28).
  function prazoDiasRestantes(deadlineIso) { if (!deadlineIso) return null; return Math.ceil((new Date(deadlineIso) - new Date(new Date().toDateString())) / 864e5); }
  function prazoTexto(deadlineIso) {
    var d = prazoDiasRestantes(deadlineIso); if (d == null) return 'Sem prazo informado';
    if (d < 0) return 'Prazo vencido há ' + Math.abs(d) + ' dia' + (Math.abs(d) === 1 ? '' : 's');
    if (d === 0) return 'Vence hoje';
    if (d === 1) return 'Vence amanhã';
    return 'Faltam ' + d + ' dias';
  }
  function prazoChip(o) {
    if (!expectsAction(o)) return null;
    var d = prazoDiasRestantes(o.disputeDeadline);
    if (d == null) return 'sem_prazo';
    if (d < 0) return 'vencido';
    if (d === 0) return 'hoje';
    if (d === 1) return 'amanha';
    if (d <= 3) return 'ate3';
    return null;
  }
  // Só pedidos que ainda pedem uma decisão nossa (janela do vendedor aberta) entram no controle de prazo.
  function expectsAction(o) { return o.type !== 'FAILED_DELIVERY' && o.hasSellerWindow && !!o.disputeDeadline && casoJornada(o) === 'ACAO_NECESSARIA'; }

  // ---- Fase operacional (§8-9,39-41) — a jornada mental de Casos: caixa de entrada → acompanhamento
  // → encerrado. Calculada a partir da jornada já existente, nunca digitada.
  var FASE_META = { SOLICITACOES: 'Solicitações', EM_ANDAMENTO: 'Em andamento', ENCERRADOS: 'Encerrados' };
  function casoFase(o) {
    var j = casoJornada(o);
    if (j === 'BAIXADA' || j === 'REJEITADA') return 'ENCERRADOS';
    if (j === 'NOVA' || j === 'ACAO_NECESSARIA') return 'SOLICITACOES';
    if (j === 'AVALIACAO' && o.internalStatus === 'NOVA') return 'SOLICITACOES';
    return 'EM_ANDAMENTO';
  }

  // ---- "Novo retorno" (§24-25) — a Shopee respondeu desde a última vez que o operador abriu o caso?
  // o.lastStatusAdvanceAt é carimbado pelo motor de transição (§15-16, em importPosVenda) sempre que
  // um evento objetivo da Shopee muda algo relevante; o.lastViewedAt é carimbado ao abrir a Ficha.
  // Os dois persistem entre importações (nunca fazem parte de SOURCE_FIELDS).
  function casoNovoRetorno(o) { return !!o.lastStatusAdvanceAt && (!o.lastViewedAt || o.lastStatusAdvanceAt > o.lastViewedAt); }
  // §36 — situação financeira em linguagem simples, derivada do resultado + impacto já calculados.
  function casoSituacaoFinanceira(o) {
    var r = casoResultado(o); var net = o.impact ? o.impact.knownNetImpact : null;
    if (r === 'DISPUTA_GANHA' || r === 'COMPENSADO') return (o.impact && o.impact.recoveredTotal > 0) ? 'Recuperado' : 'Compensação identificada';
    if (r === 'CANCELADA_COMPRADOR') return 'Sem impacto';
    if (r === 'EM_ABERTO') return net > 0 ? 'Valor em risco' : 'Em aberto';
    if (net == null) return 'Em aberto';
    if (net > 0) return 'Perdido';
    if (net < 0) return 'Recuperado';
    return 'Reembolso realizado';
  }

  // §53: resumo pós-importação — o que mudou nesta importação, com atalho para abrir cada caso.
  // Reconstruído a partir das activities com este batchId — não depende de guardar o array de
  // objetos alterados, então funciona também a partir do histórico de importações (§20/§61-63).
  function openDevImportResumo(batch) {
    var changed = occ.filter(function (o) { return (o.activities || []).some(function (a) { return a.batchId === batch.id; }); });
    var d = document.createElement('div'); d.className = 'drawer'; var panel = document.createElement('div'); panel.className = 'drawer-panel'; panel.style.width = '640px'; panel.style.maxWidth = '96vw';
    d.appendChild(panel); d.onclick = function (e) { if (e.target === d) d.remove(); }; document.body.appendChild(d);
    var atualizados = changed.filter(function (o) { return o.activities && o.activities.some(function (a) { return a.kind === 'SOURCE' && a.batchId === batch.id && a.field; }); });
    var strip = kstrip([
      { l: 'Casos novos', v: nn(batch.novo), cls: 'blue' },
      { l: 'Casos atualizados', v: nn(batch.upd), cls: 'blue' },
      { l: 'Mudança de status', v: nn(batch.statusChanged || 0), cls: (batch.statusChanged ? 'amber' : '') },
      { l: 'Novas compensações', v: nn(batch.novaCompensacao || 0), cls: (batch.novaCompensacao ? 'green' : '') },
      { l: 'Rastreio atualizado', v: nn(batch.rastreioAtualizado || 0), cls: '' },
      { l: 'Dados internos preservados', v: nn(batch.dadosInternosPreservados || 0), cls: 'green', s: 'notas/status/decisões nunca apagados' },
    ]);
    var rows = atualizados.slice(0, 200).map(function (o) {
      var diffsTxt = (o.activities || []).filter(function (a) { return a.kind === 'SOURCE' && a.batchId === batch.id && a.field; }).map(function (a) { return a.field + ': ' + a.oldValue + ' → ' + a.newValue; }).join(' · ');
      return '<tr class="rowlink" data-oc="' + esc(o.id) + '"><td class="mono">' + esc(o.orderId || o.returnId || o.id) + '</td><td class="cell-text">' + esc(diffsTxt || '—') + '</td></tr>';
    }).join('');
    panel.innerHTML = '<div class="dh"><div><b>Atualização concluída</b></div><button class="x">&times;</button></div><div class="dbd">' + strip +
      (rows ? '<div class="panel"><div class="ph"><h3>O que mudou</h3></div><div class="table-wrap"><table class="report"><thead><tr><th>Pedido</th><th>Alterações</th></tr></thead><tbody>' + rows + '</tbody></table></div></div>' : callout('green', '✓ Nenhum caso existente teve alteração de dados da Shopee', 'Só casos novos entraram nesta importação.')) +
      '</div>';
    panel.querySelector('.x').onclick = function () { d.remove(); };
    panel.querySelectorAll('[data-oc]').forEach(function (b) { b.onclick = function () { d.remove(); openFicha(b.dataset.oc); }; });
  }

  function renderPosVenda() {
    var tabs = [['visao', 'Visão Geral'], ['casos', 'Casos'], ['recebimentos', 'Recebimentos'], ['analises', 'Análises'], ['planos', 'Plano de Ação'], ['import', 'Importações']];
    // compat com chaves antigas
    if (sub.posvenda === 'ocorrencias' || sub.posvenda === 'disputas') sub.posvenda = 'casos';
    if (sub.posvenda === 'areceber' || sub.posvenda === 'conferir') sub.posvenda = 'recebimentos';
    if (sub.posvenda === 'financeiro') { sub.posvenda = 'analises'; analiseSub = 'financeiro'; }
    app.innerHTML = devPeriodBar() + '<div class="subtabs">' + tabs.map(function (t) { return subtab('posvenda', t[0], t[1]); }).join('') + '</div><div id="devbody"></div>';
    var body = document.getElementById('devbody'); var t = sub.posvenda;
    try {
      if (t === 'import') body.innerHTML = devImportacoes();
      else if (t === 'recebimentos') body.innerHTML = devRecebimentos();
      else if (t === 'casos') body.innerHTML = devOcc();
      else if (t === 'analises') body.innerHTML = devAnalises();
      else if (t === 'planos') body.innerHTML = devPlanos();
      else body.innerHTML = devExec();
    } catch (e) { body.innerHTML = '<div class="form-err">Erro ao renderizar esta aba: ' + esc(e.message || e) + '</div>'; }
    bindDevPeriodBar();
    app.querySelectorAll('[data-pv]').forEach(function (b) { b.onclick = function () { fileInput(function (f) { importPosVenda(b.dataset.pv, f).then(function (res) { render(); toast('Importação concluída', res.batch.novo + ' novos · ' + res.batch.upd + ' atualizados · ' + res.batch.unch + ' sem alteração' + (res.batch.statusChanged ? ' · ' + res.batch.statusChanged + ' c/ status alterado' : '') + (res.batch.stale ? ' · ' + res.batch.stale + ' ignorados (relatório antigo)' : '')); }).catch(function (e) { toast('Falha', e.message, true); }); }); }; });
    bindSubtabs('posvenda');
    app.querySelectorAll('[data-oc]').forEach(function (b) { b.onclick = function () { openFicha(b.dataset.oc, b.dataset.focus); }; });
    app.querySelectorAll('[data-go]').forEach(function (b) { b.onclick = function () {
      var dest = b.dataset.go;
      if (dest === 'ocorrencias') dest = 'casos';
      if (dest === 'areceber' || dest === 'conferir') dest = 'recebimentos';
      if (dest === 'financeiro') { analiseSub = 'financeiro'; dest = 'analises'; }
      if (dest === 'disputas') { dest = 'casos'; devF.type = 'RETURN_REFUND'; devF.status = ''; devF.flag = 'prazo'; devF.search = ''; devPage = 1; }
      if (b.dataset.arf) arF = b.dataset.arf;
      if (b.dataset.asub) analiseSub = b.dataset.asub;
      if (dest === 'casos' && b.dataset.go !== 'disputas') { devF.internalStatus = ''; devF.disputeStatus = ''; devF.search = ''; devF.type = b.dataset.oct || ''; devF.status = ''; devF.flag = b.dataset.ocf || ''; devPage = 1; }
      if (dest === 'analises') { if (b.dataset.reason != null) analiseReason = b.dataset.reason || null; }
      sub.posvenda = dest; render();
    }; });
    app.querySelectorAll('[data-conf]').forEach(function (b) { b.onclick = function () { openConferir(b.dataset.conf); }; });
    app.querySelectorAll('[data-goped360]').forEach(function (b) { b.onclick = function () { openPedidoFicha360(b.dataset.goped360); }; });
    if (t === 'recebimentos') bindRecebimentos();
    if (t === 'casos') bindDevOcc();
    if (t === 'analises') bindAnalises();
    if (t === 'import') bindDevImportacoes();
    if (t === 'planos') bindPlanos();
  }
  // Barra de período compartilhada por todo o módulo Devolução (§18-19) + selo "atualizado até".
  function devPeriodBar() {
    var opts = [['all', 'Todo o período'], ['today', 'Hoje'], ['yesterday', 'Ontem'], ['7d', 'Últimos 7 dias'], ['15d', 'Últimos 15 dias'], ['30d', 'Últimos 30 dias'], ['month', 'Este mês'], ['prevmonth', 'Mês anterior'], ['custom', 'Personalizado']];
    var sel = '<select class="select sm" id="devperiod">' + opts.map(function (o) { return '<option value="' + o[0] + '"' + (periodSel.value === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>';
    var dates = '<span class="datein' + (periodSel.value === 'custom' ? ' on' : '') + '" id="devdates"><input class="input sm" type="date" id="devfrom" value="' + esc(customRange.from || '') + '"><span style="color:var(--muted);font-size:12px">até</span><input class="input sm" type="date" id="devto" value="' + esc(customRange.to || '') + '"><button class="btn-sm primary" id="devapply">Aplicar</button></span>';
    var stamp = lastImportStamp ? '<span class="footnote" style="margin:0">Atualizado com dados até ' + new Date(lastImportStamp).toLocaleString('pt-BR') + '</span>' : '<span class="footnote" style="margin:0">Sem importações ainda</span>';
    return '<div class="toolbar2" style="justify-content:space-between;align-items:center;margin-bottom:12px"><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><b style="font-size:12.5px;color:var(--muted)">Período:</b>' + sel + dates + '</div>' + stamp + '</div>';
  }
  function bindDevPeriodBar() {
    var s = document.getElementById('devperiod'); if (s) s.onchange = function () { periodSel.value = s.value; if (s.value === 'custom' && !customRange.from && !customRange.to) { render(); return; } render(); };
    var ap = document.getElementById('devapply'); if (ap) ap.onclick = function () { customRange.from = (document.getElementById('devfrom') || {}).value || null; customRange.to = (document.getElementById('devto') || {}).value || null; render(); };
  }

  // ===================== RECEBIMENTOS (fila + conferência/baixa manual num só lugar) =====================
  function findOccByCode(code) {
    var q = (code || '').trim().toLowerCase(); if (!q) return [];
    return occ.filter(function (o) {
      return (o.returnId && o.returnId.toLowerCase() === q) || (o.orderId && o.orderId.toLowerCase() === q) || (o.tracking && o.tracking.toLowerCase() === q)
        || (o.returnId && o.returnId.toLowerCase().indexOf(q) >= 0) || (o.orderId && o.orderId.toLowerCase().indexOf(q) >= 0) || (o.tracking && o.tracking.toLowerCase().indexOf(q) >= 0);
    });
  }
  // Agrupa os estados técnicos de recebimento nos 6 estados visíveis (§14).
  function recGroup(o) { var s = o.receiptState; if (s === 'RECEBIDO') return 'recebidos'; if (s === 'CHEGOU_CONFERIR') return 'conferir'; if (s === 'DIVERGENCIA' || s === 'PARCIAL') return 'divergencia'; if (s === 'EM_TRANSITO') return 'transito'; if (s === 'NAO_RETORNOU' || s === 'EXTRAVIADO') return 'naoretornou'; return 'aguardando'; }
  var REC_LABEL = { aguardando: ['Aguardando', 'info'], transito: ['Em trânsito', 'info'], conferir: ['Conferir', 'warn'], recebidos: ['Recebido', 'ok'], divergencia: ['Divergência', 'warn'], naoretornou: ['Não retornou', 'warn'] };
  function devRecebimentos() {
    var list = devReturnList(); var total = list.length;
    var counts = { aguardando: 0, transito: 0, conferir: 0, recebidos: 0, divergencia: 0, naoretornou: 0 };
    list.forEach(function (o) { counts[recGroup(o)]++; });
    var confPct = total ? Math.round(counts.recebidos / total * 100) : 0;
    var head = secHead('RECEBIMENTOS', 'Recebimentos de devolução', 'O que ainda precisa chegar e a baixa manual de quem chegou — no mesmo fluxo. A baixa é sempre manual: "Concluído" na Shopee não é "recebido na empresa".');
    var search = '<div class="panel"><div class="pb"><div style="display:flex;gap:8px;max-width:640px"><input class="input" id="recq" placeholder="Buscar ID da devolução, pedido ou rastreio" style="flex:1" value="' + esc(recSearch) + '"><button class="btn-sm primary" id="recbtn">Buscar</button>' + (recSearch ? '<button class="btn-sm" id="recclear">Limpar</button>' : '') + '</div></div></div>';
    if (!total) return head + search + emptyBox('Nenhuma devolução com retorno físico esperado no período. Importe os relatórios de Devoluções/Reembolsos.');
    var chips = [['todos', 'Todos'], ['aguardando', 'Aguardando'], ['transito', 'Em trânsito'], ['conferir', 'Chegou / conferir'], ['recebidos', 'Recebidos'], ['divergencia', 'Divergência'], ['naoretornou', 'Não retornou']];
    var view = list.filter(function (o) {
      if (arF !== 'todos' && recGroup(o) !== arF) return false;
      if (recSearch) { var q = recSearch.toLowerCase(); if (!((o.returnId && o.returnId.toLowerCase().indexOf(q) >= 0) || (o.orderId && o.orderId.toLowerCase().indexOf(q) >= 0) || (o.tracking && o.tracking.toLowerCase().indexOf(q) >= 0))) return false; }
      return true;
    }).sort(function (a, b) { return daysWaiting(b) - daysWaiting(a); });
    var action = function (o) { var g = recGroup(o); if (g === 'conferir') return '<button class="btn-sm primary" data-conf="' + esc(o.id) + '">Conferir</button>'; if (g === 'divergencia') return '<button class="btn-sm" data-oc="' + esc(o.id) + '">Resolver</button>'; if (g === 'recebidos') return '<button class="btn-sm" data-oc="' + esc(o.id) + '">Ver recebimento</button>'; return '<button class="btn-sm" data-conf="' + esc(o.id) + '">Conferir</button>'; };
    var rows = view.length ? view.slice(0, 400).map(function (o) {
      var it = (o.items || [])[0] || {}; var qt = (o.items || []).reduce(function (s, x) { return s + (x.qty || 1); }, 0); var g = recGroup(o); var rl = REC_LABEL[g];
      var prod = (it.productName || '—') + (it.variationName ? ' · ' + it.variationName : '') + ((o.items || []).length > 1 ? ' (+' + (o.items.length - 1) + ' itens)' : '');
      return '<tr><td class="mono">' + esc(o.returnId || (o.id.split(':')[1] || '—')) + '</td><td class="mono">' + esc(o.orderId || '—') + '</td><td class="cell-text">' + esc(prod) + '<div class="footnote" style="margin:0">' + esc(it.sku || '—') + '</div></td><td>' + qt + '</td><td class="nowrap">' + esc(o.status || '—') + '</td><td><span class="tag ' + rl[1] + '">' + rl[0] + '</span></td><td class="mono footnote" style="margin:0">' + esc(o.tracking || '—') + '</td><td>' + daysWaiting(o) + '</td><td class="nowrap">' + brl(o.requested) + '</td><td>' + action(o) + '</td></tr>';
    }).join('') : '<tr><td colspan="10" class="empty">Nenhuma devolução neste filtro.</td></tr>';
    return head + search +
      kstrip([
        { l: 'Deveriam retornar', v: nn(total), cls: 'blue' },
        { l: 'Recebidas', v: nn(counts.recebidos), cls: 'green' },
        { l: 'A caminho', v: nn(counts.aguardando + counts.transito), cls: 'blue' },
        { l: 'Chegaram / conferir', v: nn(counts.conferir), cls: 'amber' },
        { l: 'Divergência', v: nn(counts.divergencia), cls: 'red' },
      ]) +
      '<div class="chartcard"><div class="cch"><h4>Recebimento físico</h4><div class="cleg">' + confPct + '% recebido / conferido</div></div><div style="height:14px;border-radius:8px;background:var(--line);overflow:hidden"><div style="height:100%;width:' + confPct + '%;background:var(--ok)"></div></div></div>' +
      '<div class="panel"><div class="chips" style="padding:12px 12px 4px">' + chips.map(function (c) { return '<span class="chip' + (arF === c[0] ? ' chip-on' : '') + '" data-arf="' + c[0] + '">' + c[1] + (c[0] !== 'todos' ? ' <b>' + nn(counts[c[0]] || 0) + '</b>' : '') + '</span>'; }).join('') + '</div>' +
      '<div class="table-wrap"><table class="report"><thead><tr><th>Devolução</th><th>Pedido</th><th>Produto / SKU</th><th>Qtd</th><th>Status Shopee</th><th>Status físico</th><th>Rastreio</th><th>Dias</th><th>Valor</th><th>Ação</th></tr></thead><tbody>' + rows + '</tbody></table></div></div>';
  }
  function bindRecebimentos() {
    app.querySelectorAll('[data-arf]').forEach(function (c) { c.onclick = function () { arF = c.dataset.arf; render(); }; });
    var q = document.getElementById('recq'); if (q) q.onkeydown = function (e) { if (e.key === 'Enter') doRecSearch(); };
    var b = document.getElementById('recbtn'); if (b) b.onclick = doRecSearch;
    var cl = document.getElementById('recclear'); if (cl) cl.onclick = function () { recSearch = ''; render(); };
  }
  function doRecSearch() {
    var q = document.getElementById('recq'); if (!q) return; var v = q.value.trim(); if (!v) { recSearch = ''; render(); return; }
    var m = findOccByCode(v);
    if (m.length === 1) { openConferir(m[0].id); }
    else if (m.length === 0) { recSearch = v; render(); toast('Nada encontrado', 'Nenhuma devolução para "' + v + '"', true); }
    else { recSearch = v; render(); }
  }
  // Conferência item a item num drawer (§12): abre sobre qualquer aba, não exige tela nova.
  // §21: reaproveitamento/destino do item conferido — controle interno de recuperação (§22-24).
  var REAPROV_LABELS = { SIM: 'Sim', PARCIAL: 'Parcialmente', NAO: 'Não' };
  var DESTINO_LABELS = { ESTOQUE: 'Voltar ao estoque', RETRABALHO: 'Retrabalho', SEGUNDA_LINHA: 'Segunda linha', DESCARTE: 'Descarte', OUTRO: 'Outro' };
  function itemCustoUnit(sku) { var c = sku ? skuCost[sku.toLowerCase()] : null; return c && c.cost != null ? c.cost : null; }
  function openConferir(idOrCode, onDone) {
    var o = occ.find(function (x) { return x.id === idOrCode; });
    if (!o) { var m = findOccByCode(idOrCode); if (m.length) o = m[0]; }
    if (!o) { toast('Nada encontrado', 'Devolução não localizada.', true); return; }
    var items = (o.items && o.items.length ? o.items : [{ sku: null, productName: '(item único)', qty: 1 }]).map(function (it, i) {
      var custoUnit = itemCustoUnit(it.sku); var custoTotal = custoUnit != null ? Math.round(custoUnit * (it.qty || 1) * 100) / 100 : null;
      return { idx: i, sku: it.sku, productName: it.productName, variationName: it.variationName, expected: it.qty || 1, received: it.qty || 1, condition: 'REAPROVEITAVEL', reaproveitavel: 'SIM', destino: 'ESTOQUE', custoUnit: custoUnit, custoTotal: custoTotal, valorReaproveitavel: custoTotal };
    });
    var d = document.createElement('div'); d.className = 'drawer'; var panel = document.createElement('div'); panel.className = 'drawer-panel'; panel.style.width = '860px'; panel.style.maxWidth = '98vw';
    d.appendChild(panel); d.onclick = function (e) { if (e.target === d) d.remove(); }; document.body.appendChild(d);
    // valor sugerido de reaproveitamento a partir de reaproveitável+condição — o operador pode sobrescrever.
    function sugestaoReaproveitavel(it) { if (it.custoTotal == null) return null; if (it.reaproveitavel === 'NAO') return 0; if (it.reaproveitavel === 'PARCIAL') return Math.round(it.custoTotal / 2 * 100) / 100; return it.custoTotal; }
    function draw() {
      var totExp = items.reduce(function (s, i) { return s + i.expected; }, 0), totRec = items.reduce(function (s, i) { return s + i.received; }, 0);
      var custoTotalGeral = items.reduce(function (s, i) { return s + (i.custoTotal || 0); }, 0);
      var reaprovTotalGeral = items.reduce(function (s, i) { return s + (i.valorReaproveitavel || 0); }, 0);
      var perdaGeral = Math.max(0, custoTotalGeral - reaprovTotalGeral);
      var semCusto = items.some(function (i) { return i.custoTotal == null; });
      var rows = items.map(function (it) {
        return '<tr><td class="cell-text">' + esc(it.productName || '—') + (it.variationName ? ' · ' + esc(it.variationName) : '') + '<div class="footnote" style="margin:0">' + esc(it.sku || '—') + '</div></td><td>' + it.expected + '</td>' +
          '<td class="nowrap"><button class="btn-sm" data-dec="' + it.idx + '">−</button> <b>' + it.received + '</b> <button class="btn-sm" data-inc="' + it.idx + '">+</button></td>' +
          '<td><select class="select sm" data-cond="' + it.idx + '">' + Object.keys(COND_LABELS).map(function (k) { return '<option value="' + k + '"' + (it.condition === k ? ' selected' : '') + '>' + COND_LABELS[k] + '</option>'; }).join('') + '</select></td>' +
          '<td><select class="select sm" data-reap="' + it.idx + '">' + Object.keys(REAPROV_LABELS).map(function (k) { return '<option value="' + k + '"' + (it.reaproveitavel === k ? ' selected' : '') + '>' + REAPROV_LABELS[k] + '</option>'; }).join('') + '</select></td>' +
          '<td><select class="select sm" data-dest="' + it.idx + '">' + Object.keys(DESTINO_LABELS).map(function (k) { return '<option value="' + k + '"' + (it.destino === k ? ' selected' : '') + '>' + DESTINO_LABELS[k] + '</option>'; }).join('') + '</select></td>' +
          '<td class="nowrap">' + (it.custoTotal != null ? brl(it.custoTotal) : '<span class="tag warn">sem custo</span>') + '</td>' +
          '<td><input class="input sm" data-valreap="' + it.idx + '" style="width:90px" value="' + (it.valorReaproveitavel != null ? it.valorReaproveitavel : '') + '" placeholder="—"></td></tr>';
      }).join('');
      panel.innerHTML = '<div class="dh"><div><b>Conferir e dar baixa · devolução ' + esc(o.returnId || o.id) + '</b> <span class="tag info" style="margin-left:6px">Shopee: ' + esc(o.status || '—') + '</span></div><button class="x">&times;</button></div><div class="dbd">' +
        '<div class="footnote" style="margin:0 0 10px">Pedido ' + esc(o.orderId || '—') + ' · Valor envolvido ' + brl(o.requested) + ' · Motivo: ' + esc(o.reason || '—') + '</div>' +
        '<div class="table-wrap"><table><thead><tr><th>Produto / SKU</th><th>Esperado</th><th>Recebido</th><th>Condição</th><th>Reaproveitável?</th><th>Destino</th><th>Custo do produto</th><th>Valor reaproveitável</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
        (semCusto ? '<div class="footnote" style="margin-top:6px">⚠ Algum item não tem custo cadastrado em Produtos — o valor de perda confirmada abaixo fica parcial para esses itens.</div>' : '') +
        '<div class="kstrip" style="margin-top:12px"><div class="kc"><div class="kl">Custo total dos itens</div><div class="kv">' + brl(custoTotalGeral) + '</div></div><div class="kc"><div class="kl">Valor reaproveitável</div><div class="kv">' + brl(reaprovTotalGeral) + '</div></div><div class="kc"><div class="kl">Perda confirmada (se der baixa agora)</div><div class="kv" style="color:var(--err)">' + brl(perdaGeral) + '</div></div></div>' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:14px;flex-wrap:wrap;gap:10px"><div><b>Esperado ' + totExp + '</b> · <b>Recebido ' + totRec + '</b></div>' +
        '<div style="display:flex;gap:8px"><input class="input sm" id="cnote" placeholder="Observação (opcional)" style="width:220px"><button class="btn-sm primary" id="cok">Confirmar recebimento e dar baixa</button></div></div>' +
        '<div class="footnote" style="margin-top:8px">A baixa é manual. O produto só fica "recebido" quando você confirma aqui — e o resultado da devolução passa de provisório para confirmado.</div></div>';
      panel.querySelector('.x').onclick = function () { d.remove(); };
      panel.querySelectorAll('[data-dec]').forEach(function (b) { b.onclick = function () { var it = items[+b.dataset.dec]; it.received = Math.max(0, it.received - 1); draw(); }; });
      panel.querySelectorAll('[data-inc]').forEach(function (b) { b.onclick = function () { var it = items[+b.dataset.inc]; it.received = it.received + 1; draw(); }; });
      panel.querySelectorAll('[data-cond]').forEach(function (s) { s.onchange = function () { items[+s.dataset.cond].condition = s.value; }; });
      panel.querySelectorAll('[data-reap]').forEach(function (s) { s.onchange = function () { var it = items[+s.dataset.reap]; it.reaproveitavel = s.value; it.valorReaproveitavel = sugestaoReaproveitavel(it); draw(); }; });
      panel.querySelectorAll('[data-dest]').forEach(function (s) { s.onchange = function () { items[+s.dataset.dest].destino = s.value; }; });
      panel.querySelectorAll('[data-valreap]').forEach(function (inp) { inp.onchange = function () { var it = items[+inp.dataset.valreap]; var v = parseFloat((inp.value || '').replace(',', '.')); it.valorReaproveitavel = isNaN(v) ? null : v; draw(); }; });
      panel.querySelector('#cok').onclick = function () { confirmReceive(o, items, (panel.querySelector('#cnote') || {}).value || null, d, onDone); };
    }
    draw();
  }
  function confirmReceive(o, items, note, drawerEl, onDone) {
    var totExp = items.reduce(function (s, i) { return s + i.expected; }, 0), totRec = items.reduce(function (s, i) { return s + i.received; }, 0);
    var diff = items.some(function (i) { return i.condition === 'DIFERENTE'; });
    var state = diff ? 'DIVERGENCIA' : (totRec === 0 ? 'DIVERGENCIA' : (totRec >= totExp ? 'RECEBIDO' : 'PARCIAL'));
    o.receiptState = state; o.receiptItems = items.slice(); o.receivedBy = 'Operador'; o.receivedAt = new Date().toISOString(); o.receiptNote = note;
    o.merchandiseStatus = (state === 'RECEBIDO' || state === 'PARCIAL') ? 'RECEBIDO' : o.merchandiseStatus;
    o.merchandiseCondition = (items[0] && items[0].condition) || o.merchandiseCondition;
    // Controle interno de recuperação (§22): nasce aqui, na baixa; consumido por Financeiro/Minha
    // Renda via occResultadoDevolucao(). Só considera itens com custo cadastrado — "sem custo" nunca
    // vira R$ 0 de perda, fica de fora da soma (mesma disciplina do resto do sistema).
    var custoTotal = items.reduce(function (s, i) { return s + (i.custoTotal || 0); }, 0);
    var valorReaproveitavel = items.reduce(function (s, i) { return s + (i.valorReaproveitavel || 0); }, 0);
    o.recuperacao = { itens: items.map(function (i) { return { sku: i.sku, received: i.received, condition: i.condition, reaproveitavel: i.reaproveitavel, destino: i.destino, custoTotal: i.custoTotal, valorReaproveitavel: i.valorReaproveitavel }; }), custoTotal: custoTotal, valorReaproveitavel: valorReaproveitavel, perdaConfirmada: Math.max(0, custoTotal - valorReaproveitavel), calculadoEm: new Date().toISOString() };
    if (state === 'RECEBIDO' && o.internalStatus === 'NOVA') o.internalStatus = 'RECEBIDO';
    addActivity(o, 'RECEIPT', { message: 'Recebimento: ' + totRec + ' de ' + totExp + ' item(ns) · ' + RECEIPT_LABELS[state] + ' · perda confirmada ' + brl(o.recuperacao.perdaConfirmada) + (note ? ' · ' + note : ''), userName: 'Operador' });
    recomputeOccImpact(o);
    saveOcc(o).then(function () {
      if (drawerEl) drawerEl.remove(); render();
      toast('Recebimento registrado', (o.returnId || o.id) + ' · ' + totRec + ' de ' + totExp + ' · ' + RECEIPT_LABELS[state]);
      if (onDone) onDone();
    });
  }

  // ===================== ANÁLISES (agrupa Motivos/Causas/Produtos/Achados) =====================
  function devAnalises() {
    // compat com sub-abas antigas
    if (['motivos', 'produtos', 'causas'].indexOf(analiseSub) >= 0) analiseSub = 'problemas';
    if (analiseSub === 'achados') analiseSub = 'inteligencia';
    var subs = [['problemas', 'Problemas'], ['financeiro', 'Financeiro'], ['evolucao', 'Evolução'], ['inteligencia', 'Inteligência']];
    var inner = analiseSub === 'financeiro' ? devFinanceiro() : analiseSub === 'evolucao' ? devEvolucao() : analiseSub === 'inteligencia' ? devAchados() : devProblemas();
    return '<div class="subtabs">' + subs.map(function (x) { return '<div class="subtab' + (analiseSub === x[0] ? ' active' : '') + '" data-asub2="' + x[0] + '">' + x[1] + '</div>'; }).join('') + '</div><div>' + inner + '</div>';
  }
  function bindAnalises() {
    app.querySelectorAll('[data-asub2]').forEach(function (b) { b.onclick = function () { analiseSub = b.dataset.asub2; analiseReason = null; analiseProduct = null; render(); }; });
    app.querySelectorAll('[data-prod]').forEach(function (b) { b.onclick = function () { analiseProduct = b.dataset.prod; analiseReason = null; render(); }; });
    app.querySelectorAll('[data-reason2]').forEach(function (b) { b.onclick = function () { analiseReason = b.dataset.reason2 || null; analiseProduct = null; render(); }; });
    app.querySelectorAll('[data-cleardrill]').forEach(function (b) { b.onclick = function () { analiseReason = null; analiseProduct = null; render(); }; });
    if (analiseSub === 'financeiro') bindFinanceiro();
    if (analiseSub === 'inteligencia') bindAchados();
  }
  // ANÁLISE · PROBLEMAS — investigação contínua motivo → produto → SKU → causa (e o inverso).
  function devProblemas() {
    var base = occInPeriod(); if (!base.length) return secHead('ANÁLISE · PROBLEMAS', 'Por que estamos perdendo dinheiro?', '') + emptyBox('Sem ocorrências no período.');
    var head = secHead('ANÁLISE · PROBLEMAS', 'Por que estamos perdendo dinheiro?', 'Motivo → produto → SKU → causa numa investigação contínua. Clique numa linha para aprofundar.');
    // --- caminho MOTIVO → produtos/SKUs/causa ---
    if (analiseReason) {
      var lr = base.filter(function (o) { return (o.reason || '(sem motivo informado)').trim() === analiseReason; });
      var prod = devCriticosData(lr); var byProd = {}; prod.forEach(function (s) { var k = s.product || s.sku; var p = byProd[k] = byProd[k] || { label: k, value: 0 }; p.value += s.loss; });
      var prodBars = Object.values(byProd).sort(function (a, b) { return b.value - a.value; }).slice(0, 8);
      var caus = devCausasData(lr);
      return head + callout('warn', 'Investigando o motivo: ' + esc(analiseReason), '<b>' + nn(lr.length) + '</b> casos · perda <b>' + brl(devLoss(lr)) + '</b> · <button class="link-btn" data-cleardrill="1">voltar aos motivos</button>') +
        (prodBars.length ? chartCard('Produtos mais ligados a "' + analiseReason + '"', legendSwatch([['Perda R$', '#2b4bd6']]), svgHBars(prodBars, { color: '#2b4bd6', fmt: function (v) { return brl(v); } })) : '') +
        '<div class="panel"><div class="ph"><h3>SKUs envolvidos</h3></div><div class="table-wrap"><table class="report"><thead><tr><th>Produto</th><th>SKU</th><th>Casos</th><th>Perda</th><th>Causa dominante</th></tr></thead><tbody>' + prod.slice(0, 30).map(function (s) { return '<tr class="rowlink" data-prod="' + esc(s.product || s.sku) + '"><td class="cell-text">' + esc(s.product || '—') + '</td><td class="mono footnote" style="margin:0">' + esc(s.sku) + '</td><td>' + nn(s.occ) + '</td><td><b>' + brl(s.loss) + '</b></td><td>' + esc(s.dominant) + '</td></tr>'; }).join('') + '</tbody></table></div></div>' +
        '<div class="panel"><div class="ph"><h3>Causas internas deste motivo</h3></div><div class="table-wrap"><table class="report"><thead><tr><th>Causa</th><th>Casos</th><th>Perda</th><th>% da perda</th></tr></thead><tbody>' + caus.map(function (c) { return '<tr><td><b>' + esc(c.label) + '</b></td><td>' + nn(c.cases) + '</td><td>' + brl(c.loss) + '</td><td><span class="tag">' + pct(c.share) + '</span></td></tr>'; }).join('') + '</tbody></table></div></div>';
    }
    // --- caminho PRODUTO → motivos/causas (§36) ---
    if (analiseProduct) {
      var lp = base.filter(function (o) { return (o.items || []).some(function (i) { return (i.productName || i.sku) === analiseProduct; }); });
      var mot = devMotivosData(lp); var totM = lp.length || 1; var caus2 = devCausasData(lp);
      return head + callout('warn', 'Investigando o produto: ' + esc(analiseProduct), '<b>' + nn(lp.length) + '</b> devoluções · perda <b>' + brl(devLoss(lp)) + '</b> · <button class="link-btn" data-cleardrill="1">voltar</button>') +
        (mot.length ? chartCard('Motivos deste produto', legendSwatch([['% das devoluções', '#d13b3b']]), svgHBars(mot.slice(0, 8).map(function (m) { return { label: m.reason, value: r2(m.cases / totM * 100) }; }), { color: '#d13b3b', fmt: function (v) { return pct(v); } })) : '') +
        '<div class="panel"><div class="ph"><h3>Causas internas</h3></div><div class="table-wrap"><table class="report"><thead><tr><th>Causa</th><th>Casos</th><th>Perda</th><th>% da perda</th></tr></thead><tbody>' + caus2.map(function (c) { return '<tr><td><b>' + esc(c.label) + '</b></td><td>' + nn(c.cases) + '</td><td>' + brl(c.loss) + '</td><td><span class="tag">' + pct(c.share) + '</span></td></tr>'; }).join('') + '</tbody></table></div></div>';
    }
    // --- visão inicial: motivos + produtos + causas ---
    var mot0 = devMotivosData(base); var crit = devCriticosData(base); var caus0 = devCausasData(base);
    var byProd0 = {}; crit.forEach(function (s) { var k = s.product || s.sku; var p = byProd0[k] = byProd0[k] || { label: k, value: 0 }; p.value += s.loss; });
    var prodBars0 = Object.values(byProd0).sort(function (a, b) { return b.value - a.value; }).slice(0, 8);
    return head +
      chartCard('Por que estão devolvendo? (perda por motivo)', legendSwatch([['Perda R$', '#d13b3b']]) + ' <span class="footnote">clique numa linha p/ investigar</span>', svgHBars(mot0.slice(0, 8).map(function (m) { return { label: m.reason, value: m.loss, color: '#d13b3b' }; }), { fmt: function (v) { return brl(v); } })) +
      '<div class="panel"><div class="ph"><h3>Motivos — clique para investigar</h3></div><div class="table-wrap"><table class="report"><thead><tr><th>Motivo</th><th>Casos</th><th>Perda</th><th>Em risco</th></tr></thead><tbody>' + mot0.slice(0, 12).map(function (m) { return '<tr class="rowlink" data-reason2="' + esc(m.reason) + '"><td class="cell-text"><b>' + esc(m.reason) + '</b></td><td>' + nn(m.cases) + '</td><td>' + brl(m.loss) + '</td><td>' + brl(m.atRisk) + '</td></tr>'; }).join('') + '</tbody></table></div></div>' +
      (prodBars0.length ? chartCard('Produtos com maior impacto', legendSwatch([['Perda R$', '#2b4bd6']]), svgHBars(prodBars0, { color: '#2b4bd6', fmt: function (v) { return brl(v); } })) : '') +
      '<div class="panel"><div class="ph"><h3>Produtos — clique para investigar</h3></div><div class="table-wrap"><table class="report"><thead><tr><th>Produto</th><th>SKU</th><th>Casos</th><th>Perda</th><th>Causa</th></tr></thead><tbody>' + crit.slice(0, 12).map(function (s) { return '<tr class="rowlink" data-prod="' + esc(s.product || s.sku) + '"><td class="cell-text">' + esc(s.product || '—') + '</td><td class="mono footnote" style="margin:0">' + esc(s.sku) + '</td><td>' + nn(s.occ) + '</td><td><b>' + brl(s.loss) + '</b></td><td>' + esc(s.dominant) + '</td></tr>'; }).join('') + '</tbody></table></div></div>' +
      chartCard('Onde estamos errando? (perda por causa)', legendSwatch([['Perda R$', '#8a93a3']]), svgHBars(caus0.map(function (c) { return { label: c.label, value: c.loss, color: c.key === 'AVARIA' ? '#d13b3b' : c.key === 'SEPARACAO' ? '#2b4bd6' : '#8a93a3' }; }), { fmt: function (v) { return brl(v); } }));
  }
  // Evolução por COORTE (mês do pedido). Barras = devoluções; linha = taxa % (ou perda se não houver pedidos).
  function devEvolucao() {
    if (!occInPeriod().length) return secHead('ANÁLISE · EVOLUÇÃO', 'Estamos melhorando?', '') + emptyBox('Sem ocorrências no período.');
    var cohort = devCohortData(); var hasTaxa = cohort.some(function (m) { return m.taxa != null; });
    var head = secHead('ANÁLISE · EVOLUÇÃO', 'Estamos melhorando?', 'Cada devolução é atribuída ao mês do pedido que a originou — a única forma de comparar com as vendas. Barras = devoluções, linha = ' + (hasTaxa ? 'taxa de devolução' : 'perda R$') + '.');
    if (cohort.length < 2) return head + callout('', 'Ainda não dá para desenhar a tendência', 'São necessários pelo menos 2 meses com data. Meses disponíveis: <b>' + nn(cohort.length) + '</b>. Importe mais períodos de Pedidos e Devoluções.');
    var rows = cohort.map(function (m) { return { label: monthLabel(m.k), bar: m.occ, line: hasTaxa ? (m.taxa || 0) : m.loss }; });
    var chart = chartCard('Volume e ' + (hasTaxa ? 'taxa' : 'perda') + ' por mês do pedido', legendSwatch([['Devoluções', '#2b4bd6'], [hasTaxa ? 'Taxa %' : 'Perda R$', '#d13b3b']]), svgBarLine(rows, { barFmt: nn, lineFmt: hasTaxa ? function (v) { return pct(v); } : function (v) { return brl(v); } }));
    var f = cohort[0], l = cohort[cohort.length - 1];
    var dOcc = l.occ - f.occ; var dTaxa = (hasTaxa && f.taxa != null && l.taxa != null) ? r2(l.taxa - f.taxa) : null;
    var strip = kstrip([
      { l: 'Devoluções (1º→último)', v: (dOcc > 0 ? '+' : '') + nn(dOcc), cls: dOcc > 0 ? 'red' : dOcc < 0 ? 'green' : '', s: monthLabel(f.k) + ' → ' + monthLabel(l.k) },
      hasTaxa ? { l: 'Taxa (1º→último)', v: dTaxa == null ? '—' : (dTaxa > 0 ? '+' : '') + pct(dTaxa), cls: dTaxa > 0 ? 'red' : dTaxa < 0 ? 'green' : '' } : { l: 'Perda (1º→último)', v: brl(r2(l.loss - f.loss)), cls: l.loss > f.loss ? 'red' : 'green' },
      { l: 'Meses na série', v: nn(cohort.length), cls: 'blue' },
    ]);
    var matur = callout('', 'Cuidado com o mês mais recente', 'O último mês tende a parecer melhor do que é: parte das devoluções daquele pedido ainda não foi aberta (a defasagem mediana costuma passar de 10 dias). Só compare meses já “fechados”.');
    var tbl = '<div class="panel"><div class="ph"><h3>Mês a mês (por mês do pedido)</h3></div><div class="table-wrap"><table class="report"><thead><tr><th>Mês do pedido</th><th>Pedidos</th><th>Devoluções</th><th>Taxa</th><th>Perda</th></tr></thead><tbody>' +
      cohort.map(function (m) { return '<tr><td>' + monthLabel(m.k) + '</td><td>' + (m.orders ? nn(m.orders) : '—') + '</td><td>' + nn(m.occ) + '</td><td>' + (m.taxa != null ? pct(m.taxa) : '—') + '</td><td>' + brl(m.loss) + '</td></tr>'; }).join('') + '</tbody></table></div></div>';
    return head + strip + chart + matur + tbl;
  }

  // ===================== IMPORTAÇÕES (Devolução) =====================
  function devImportacoes() {
    var TYPES = [['RETURN_REFUND', 'Devoluções / Reembolsos'], ['ORDER_CANCELLATION', 'Cancelamentos'], ['FAILED_DELIVERY', 'Falhas de Entrega']];
    var list = batches.filter(function (b) { return b.module.indexOf('Devolução') === 0 || b.module.indexOf('Pós-venda') === 0; });
    return secHead('DADOS', 'Importações', 'Carregue os três relatórios da Shopee. A reimportação é idempotente — nunca duplica ocorrências.') +
      '<div class="cards6">' + TYPES.map(function (x) { return '<div class="fcard"><div class="lbl">' + x[1] + '</div><button class="btn-sm primary" style="margin-top:10px" data-pv="' + x[0] + '">Importar</button></div>'; }).join('') + '</div>' +
      '<div class="panel"><div class="ph"><h3>Histórico de importações</h3></div><div class="table-wrap"><table><thead><tr><th>Relatório</th><th>Arquivo</th><th>Ocorrências</th><th>Novas</th><th>Atualizadas</th><th>Mudança de status</th><th>Itens</th><th>Data</th><th></th></tr></thead><tbody>' +
      (list.length ? list.map(function (b, i) { return '<tr><td>' + esc(b.module.replace(/^Devolução · |^Pós-venda · /, '')) + '</td><td>' + esc(b.filename) + '</td><td>' + nn(b.seen) + '</td><td>' + nn(b.novo) + '</td><td>' + nn(b.upd) + '</td><td>' + nn(b.statusChanged || 0) + '</td><td>' + nn(b.itemsSeen || 0) + '</td><td class="footnote" style="margin:0">' + new Date(b.createdAt).toLocaleString('pt-BR') + '</td><td>' + (b.upd ? '<button class="btn-sm" data-devresumo="' + i + '">Ver o que mudou</button>' : '') + '</td></tr>'; }).join('') : '<tr><td colspan="9" class="empty">Nenhuma importação ainda.</td></tr>') +
      '</tbody></table></div></div>' +
      '<div class="footnote">Saúde dos dados: ' + nn(occ.length) + ' ocorrências · ' + nn(occ.filter(function (o) { return (o.items || []).some(function (i) { return i.sku && !i.skuLinked; }); }).length) + ' com SKU não vinculado.</div>';
  }
  function bindDevImportacoes() {
    var list = batches.filter(function (b) { return b.module.indexOf('Devolução') === 0 || b.module.indexOf('Pós-venda') === 0; });
    app.querySelectorAll('[data-devresumo]').forEach(function (b) { b.onclick = function () { openDevImportResumo(list[parseInt(b.dataset.devresumo, 10)]); }; });
  }

  // ---- Causas, Achados e Plano de Ação (client-side, mesmas regras do backend) ----
  function devCausasData(list) {
    var total = devLoss(list) || 1; var map = {};
    list.forEach(function (o) { var key = o.causeFamily || occGuessCause(o); var c = map[key] = map[key] || { key: key, label: DEV.CAUSE_LABELS[key] || key, cases: 0, loss: 0, atRisk: 0, additional: 0, recovered: 0, reasons: {} }; c.cases++; c.loss += occEffectiveLoss(o); c.atRisk += o.exposure.atRisk; c.additional += o.impact.additionalCostTotal || 0; c.recovered += o.impact.recoveredTotal || 0; var rr = (o.reason || '—').trim(); c.reasons[rr] = (c.reasons[rr] || 0) + 1; });
    return Object.values(map).map(function (c) { var dom = Object.entries(c.reasons).sort(function (a, b) { return b[1] - a[1]; })[0]; return { key: c.key, label: c.label, cases: c.cases, loss: r2(c.loss), atRisk: r2(c.atRisk), additional: r2(c.additional), recovered: r2(c.recovered), net: r2(c.loss + c.additional - c.recovered), dom: dom ? dom[0] : '—', share: r2(c.loss / total * 100) }; }).sort(function (a, b) { return b.loss - a.loss; });
  }
  function devCausas() {
    var list = occInPeriod(); if (!list.length) return secHead('ANÁLISE · CAUSAS', 'Onde estamos errando?', '') + emptyBox('Sem ocorrências no período.');
    var d = devCausasData(list); var np = devAchadosData(list).notProblems;
    var head = secHead('ANÁLISE · CAUSAS', 'Onde estamos errando?', 'A causa interna (nossa leitura) pode diferir do motivo declarado pelo cliente. É aqui que mora a ação.');
    var chart = d.length ? chartCard('Perda por causa', legendSwatch([['Perda R$', '#d13b3b']]), svgHBars(d.map(function (c) { return { label: c.label, value: c.loss, color: c.key === 'AVARIA' ? '#d13b3b' : c.key === 'SEPARACAO' ? '#2b4bd6' : '#8a93a3' }; }), { fmt: function (v) { return brl(v); } })) : '';
    var naoE = np && np.length ? callout('green', 'O que o problema NÃO é', np.map(function (x) { return '<div class="fin-line"><span><b>' + esc(x.dim) + '</b></span><span class="footnote" style="margin:0">' + esc(x.note) + '</span></div>'; }).join('')) : '';
    return head + chart +
      '<div class="panel"><div class="ph"><h3>Causas, uma a uma</h3></div><div class="table-wrap"><table class="report"><thead><tr><th>Causa</th><th>Casos</th><th>Perda</th><th>Custo adic.</th><th>Recuperado</th><th>Impacto líq.</th><th>Motivo dominante</th><th>% da perda</th></tr></thead><tbody>' + d.map(function (c) { return '<tr><td><b>' + esc(c.label) + '</b></td><td>' + nn(c.cases) + '</td><td>' + brl(c.loss) + '</td><td>' + brl(c.additional) + '</td><td>' + brl(c.recovered) + '</td><td><b>' + brl(c.net) + '</b></td><td>' + esc((c.dom || '—').slice(0, 28)) + '</td><td><span class="tag">' + pct(c.share) + '</span></td></tr>'; }).join('') + '</tbody></table></div><div class="footnote" style="padding:0 16px 14px">Classifique a causa interna e a família da causa na ficha da ocorrência.</div></div>' + naoE;
  }

  function devAchadosData(list) {
    var n = list.length; var conf = n >= 30 ? 'ALTA' : n >= 10 ? 'MEDIA' : 'BAIXA'; var findings = [], notProblems = [];
    if (!n) return { findings: findings, notProblems: notProblems, sample: 0, conf: conf };
    var totalLoss = devLoss(list) || 1; var crit = devCriticosData(list); var top3 = crit.slice(0, 3); var top3Share = top3.reduce(function (s, x) { return s + x.loss; }, 0) / totalLoss;
    if (top3.length && top3Share >= 0.4) findings.push({ type: 'CONCENTRACAO_SKU', title: top3.length + ' SKUs concentram ' + Math.round(top3Share * 100) + '% da perda', desc: 'Poucos SKUs respondem pela maior parte da perda — priorizar ação neles.', conf: conf, action: 'Plano de ação para os SKUs concentradores', skus: top3.map(function (t) { return t.sku; }) });
    var causes = devCausasData(list); if (causes.length && causes[0].share >= 40) findings.push({ type: 'CONCENTRACAO_CAUSA', title: 'Causa "' + causes[0].label + '" responde por ' + causes[0].share + '% da perda', desc: 'Uma família de causa domina — atacar a raiz tende a ter alto retorno.', conf: conf, action: 'Plano de ação para a causa ' + causes[0].label, skus: [] });
    var additional = list.reduce(function (s, o) { return s + (o.impact.additionalCostTotal || 0); }, 0); if (additional > 0) findings.push({ type: 'CUSTO_ADICIONAL', title: 'Custos adicionais somam ' + brl(r2(additional)), desc: 'Há custo além do reembolso (frete reverso/retrabalho). Reduzir erros que geram frete reverso.', conf: conf, action: 'Revisar separação/embalagem', skus: [] });
    var disp = devDisputesData(list); if (disp.abertas > 0 && disp.respondidas === 0) findings.push({ type: 'DISPUTA_SEM_RESPOSTA', title: disp.abertas + ' disputas abertas sem resposta', desc: 'Oportunidades de recuperação não respondidas — risco de perda por prazo.', conf: conf, action: 'Responder disputas antes do prazo', skus: [] });
    var semRetorno = list.filter(function (o) { return ['PERDIDO', 'EXTRAVIADO'].indexOf(o.merchandiseStatus) >= 0 || (o.merchandiseStatus === 'DESCONHECIDO' && occApproved(o)); }).length; if (semRetorno / n >= 0.3) findings.push({ type: 'PRODUTO_SEM_RETORNO', title: Math.round(semRetorno / n * 100) + '% das ocorrências sem retorno do produto', desc: 'Reembolso pago sem o produto voltar — avaliar exigência de retorno e recuperação na reversa.', conf: conf, action: 'Rever política de retorno e rastreio da reversa', skus: [] });
    var mot = devMotivosData(list); var hg = mot.filter(function (m) { return m.cases >= 5 && m.giveupRate >= 40; })[0]; if (hg) findings.push({ type: 'DESISTENCIA', title: 'Motivo "' + hg.reason + '" tem ' + hg.giveupRate + '% de desistência', desc: 'Muitas solicitações desse motivo são desistidas — há espaço para retenção.', conf: conf, action: 'Fluxo de retenção para esse motivo', skus: [] });
    if (crit.length >= 8 && (crit[0].loss / totalLoss) < 0.1) notProblems.push({ dim: 'SKU específico', note: 'A perda está pulverizada entre muitos SKUs — não há um SKU vilão claro.' });
    if (causes.length >= 3 && causes[0].share < 35) notProblems.push({ dim: 'Causa única', note: 'Nenhuma causa domina — o problema é multifatorial, não uma causa isolada.' });
    return { findings: findings, notProblems: notProblems, sample: n, conf: conf };
  }
  // ===================== ANÁLISES · INTELIGÊNCIA (achado → evidência → ação → sugestão de plano) =====================
  function devAchados() {
    var list = occInPeriod(); var d = devAchadosData(list);
    var head = secHead('ANÁLISE · INTELIGÊNCIA', 'O que o sistema descobriu', 'Cada achado traz evidência, por que importa e a ação sugerida. "Sugerir plano" cria um rascunho em Plano de Ação — nada é implantado sem sua aprovação.');
    if (!list.length) return head + emptyBox('Sem ocorrências no período.');
    var already = {}; plans.forEach(function (p) { (p.relatedFindings || []).forEach(function (t) { already[t] = true; }); });
    return head +
      '<div class="count-line">Base analisada: <b>' + nn(d.sample) + '</b> ocorrências · confiança geral <b>' + d.conf + '</b></div>' +
      (d.findings.length ? d.findings.map(function (f, i) {
        var m = suggestMetric(f.type + ' ' + f.action + ' ' + f.title);
        return '<div class="panel"><div class="ph"><h3>' + esc(f.title) + '</h3><span class="tag ' + (f.conf === 'ALTA' ? 'ok' : f.conf === 'MEDIA' ? 'info' : 'warn') + '">confiança ' + f.conf + '</span></div><div class="pb">' +
          '<p style="margin-top:0"><b>Por que importa:</b> ' + esc(f.desc) + '</p>' +
          '<div class="fin-line"><span>Ação sugerida</span><b>' + esc(f.action) + '</b></div>' +
          '<div class="fin-line"><span>Indicador sugerido</span><span>' + esc(m.indicator) + '</span></div>' +
          (f.skus && f.skus.length ? '<div class="fin-line"><span>Escopo</span><span class="mono footnote" style="margin:0">' + esc(f.skus.join(', ')) + '</span></div>' : '') +
          '<div style="margin-top:10px">' + (already[f.type] ? '<span class="tag ok">já virou plano</span>' : '<button class="btn-sm primary" data-suggest="' + i + '">Sugerir plano</button>') + '</div></div></div>';
      }).join('') : '<div class="panel"><div class="empty">Nenhum achado relevante no período. 🎉</div></div>') +
      (d.notProblems.length ? callout('green', 'O que o problema NÃO é', d.notProblems.map(function (np) { return '<div class="fin-line"><span><b>' + esc(np.dim) + '</b></span><span class="footnote" style="margin:0">' + esc(np.note) + '</span></div>'; }).join('')) : '');
  }
  function bindAchados() {
    var d = devAchadosData(occInPeriod());
    app.querySelectorAll('[data-suggest]').forEach(function (b) { b.onclick = function () { var f = d.findings[+b.dataset.suggest]; if (!f) return; var m = suggestMetric(f.type + ' ' + f.action + ' ' + f.title); createPlan({ title: f.action, problem: f.title, origin: 'suggestion', status: 'SUGGESTED', relatedFindings: [f.type], scopeSkus: f.skus || [], indicator: m.indicator, indicatorKind: m.kind, causeKey: m.causeKey }).then(function () { toast('Sugestão criada', 'Aprove em Plano de Ação → Sugestões'); sub.posvenda = 'planos'; render(); }); }; });
  }

  // ===================== PLANO DE AÇÃO (4 status + sugestões da IA + medição antes/depois) =====================
  // Métrica sugerida a partir da origem do plano (§56).
  function suggestMetric(seed) {
    var s = (seed || '').toString().toLowerCase();
    if (/avar|quebr|embal/.test(s)) return { indicator: 'Taxa de avaria (% dos pedidos)', kind: 'taxa_causa', causeKey: 'AVARIA' };
    if (/separ|errad|faltan/.test(s)) return { indicator: 'Taxa de erro de separação (% dos pedidos)', kind: 'taxa_causa', causeKey: 'SEPARACAO' };
    if (/disput/.test(s)) return { indicator: '% de disputas respondidas no prazo', kind: 'disputa', causeKey: null };
    if (/retorn|receb/.test(s)) return { indicator: '% de produtos recebidos', kind: 'recebido', causeKey: null };
    return { indicator: 'Impacto líquido do escopo (R$)', kind: 'liquido', causeKey: null };
  }
  var INDICATOR_HIGHER = { disputa: true, recebido: true }; // maior é melhor
  function planMatch(p, o) { if (p.scopeSkus && p.scopeSkus.length) { var set = p._set || (p._set = p.scopeSkus.reduce(function (a, s) { a[s.toLowerCase()] = 1; return a; }, {})); if (!(o.items || []).some(function (i) { return i.sku && set[i.sku.toLowerCase()]; })) return false; } if (p.causeKey) { var ck = o.causeFamily || occGuessCause(o); if (ck !== p.causeKey) return false; } return true; }
  function measureIndicator(p) {
    var list = occ.filter(function (o) { return planMatch(p, o); });
    if (p.indicatorKind === 'taxa_causa') { return orders.length ? r2(list.length / orders.length * 100) : null; }
    if (p.indicatorKind === 'disputa') { var w = occ.filter(function (o) { return o.hasSellerWindow || (o.disputeStatus && o.disputeStatus !== 'NAO_INICIADA'); }); var resp = w.filter(function (o) { return ['RESPONDIDA', 'AGUARDANDO_SHOPEE', 'GANHA', 'PARCIAL', 'PERDIDA'].indexOf(o.disputeStatus) >= 0; }).length; return w.length ? r2(resp / w.length * 100) : null; }
    if (p.indicatorKind === 'recebido') { var exp = occ.filter(expectsReturn); var rec = exp.filter(function (o) { return o.receiptState === 'RECEBIDO'; }).length; return exp.length ? r2(rec / exp.length * 100) : null; }
    return r2(list.reduce(function (s, o) { return s + occEffectiveLoss(o); }, 0));
  }
  function fmtInd(p, v) { if (v == null) return '—'; return (p.indicatorKind && p.indicatorKind !== 'liquido') ? pct(v) : brl(v); }
  // Medição contínua por janela (§29-34): compara N dias pós-implantação com N dias imediatamente anteriores.
  function occInRange(from, to) { return occ.filter(function (o) { if (o.isDemo || !o.occurredAt) return false; var d = new Date(o.occurredAt); if (from && d < from) return false; if (to && d >= to) return false; return true; }); }
  function ordersInRange(from, to) { return orders.filter(function (o) { if (!o.createdAt) return false; var d = new Date(o.createdAt); if (from && d < from) return false; if (to && d >= to) return false; return true; }).length; }
  function measureWindow(p, from, to) {
    if (p.indicatorKind === 'disputa' || p.indicatorKind === 'recebido') return measureIndicator(p);
    var list = occInRange(from, to).filter(function (o) { return planMatch(p, o); });
    if (p.indicatorKind === 'taxa_causa') { var ord = ordersInRange(from, to); return ord ? r2(list.length / ord * 100) : null; }
    return r2(list.reduce(function (s, o) { return s + occEffectiveLoss(o); }, 0));
  }
  function planWindows(p) {
    if (!p.implementedAt) return [];
    var impl = new Date(p.implementedAt).getTime(); var now = Date.now(); var day0 = new Date(new Date().toDateString()).getTime();
    var obsDays = Math.max(0, Math.floor((now - impl) / 864e5));
    var mk = function (label, n) {
      var to = Math.min(impl + n * 864e5, now); var postFrom = impl; var preFrom = impl - n * 864e5;
      var post = measureWindow(p, new Date(postFrom), new Date(to)); var pre = measureWindow(p, new Date(preFrom), new Date(impl));
      var obs = Math.min(n, obsDays); var preliminary = obs < n;
      return { label: label, n: n, post: post, pre: pre, obs: obs, preliminary: preliminary };
    };
    return [
      { label: 'Hoje', n: 1, post: measureWindow(p, new Date(day0), new Date(now)), pre: measureWindow(p, new Date(day0 - 864e5), new Date(day0)), obs: 1, preliminary: false },
      mk('7 dias', 7), mk('15 dias', 15), mk('30 dias', 30),
      { label: 'Desde a implantação', n: obsDays || 1, post: measureIndicator(p), pre: p.baselineValue, obs: obsDays, preliminary: false },
    ];
  }
  // Medição com DENOMINADOR explícito (§27): retorna valor + numerador (ocorrências) + denominador (pedidos).
  function measureWindowFull(p, from, to) {
    var list = occInRange(from, to).filter(function (o) { return planMatch(p, o); });
    if (p.indicatorKind === 'taxa_causa') { var ord = ordersInRange(from, to); return { val: ord ? r2(list.length / ord * 100) : null, num: list.length, den: ord, isRate: true }; }
    if (p.indicatorKind === 'disputa' || p.indicatorKind === 'recebido') { return { val: measureIndicator(p), num: list.length, den: null, isRate: true }; }
    return { val: r2(list.reduce(function (s, o) { return s + occEffectiveLoss(o); }, 0)), num: list.length, den: null, isRate: false };
  }
  // Série diária do indicador em torno da implantação, para o gráfico grande (§22-23).
  function planDailyPoints(p, fromDate, toDate, mode, smooth) {
    var pts = []; var start = new Date(new Date(fromDate).toDateString()); var end = new Date(new Date(toDate).toDateString());
    for (var d = new Date(start); d <= end; d = new Date(d.getTime() + 864e5)) {
      var d1 = new Date(d), d2 = new Date(d.getTime() + 864e5);
      var occD = occ.filter(function (o) { return !o.isDemo && o.occurredAt && new Date(o.occurredAt) >= d1 && new Date(o.occurredAt) < d2 && planMatch(p, o); });
      var val;
      if (mode === 'fin') val = r2(occD.reduce(function (s, o) { return s + occEffectiveLoss(o); }, 0));
      else if (p.indicatorKind === 'taxa_causa') { var ordD = ordersInRange(d1, d2); val = ordD ? r2(occD.length / ordD * 100) : null; }
      else val = occD.length;
      pts.push({ date: new Date(d1), val: val });
    }
    if (smooth) pts = pts.map(function (pt, i) { var w = pts.slice(Math.max(0, i - 6), i + 1).map(function (x) { return x.val; }).filter(function (v) { return v != null; }); return { date: pt.date, val: w.length ? r2(w.reduce(function (s, v) { return s + v; }, 0) / w.length) : null }; });
    return pts;
  }
  function svgPlanChart(p, win, mode, smooth) {
    if (!p.implementedAt) return '<div class="footnote">Inicie a medição (defina a data de implantação) para ver o gráfico antes × depois.</div>';
    var impl = new Date(p.implementedAt); var now = new Date(); var n = win === 'hoje' ? 1 : win === '7' ? 7 : win === '15' ? 15 : win === '30' ? 30 : null;
    var from = n ? new Date(impl.getTime() - n * 864e5) : new Date(impl.getTime() - 30 * 864e5);
    var to = n ? new Date(Math.min(impl.getTime() + n * 864e5, now.getTime())) : now;
    var pts = planDailyPoints(p, from, to, mode, smooth);
    var valid = pts.filter(function (x) { return x.val != null; });
    if (valid.length < 2) return '<div class="footnote">Poucos dados no intervalo para desenhar o gráfico (' + valid.length + ' ponto(s)). Amplie a janela ou aguarde novas importações.</div>';
    var W = 760, H = 260, padL = 52, padR = 20, padB = 34, padT = 18;
    var meta = (mode !== 'fin' && p.targetValue != null) ? p.targetValue : null;
    var vals = pts.map(function (x) { return x.val; }).filter(function (v) { return v != null; }).concat(meta != null ? [meta] : []);
    var mn = Math.min.apply(null, vals.concat([0])), mx = Math.max.apply(null, vals); if (mx === mn) mx = mn + 1;
    var x = function (i) { return padL + i * (W - padL - padR) / (pts.length - 1); };
    var y = function (v) { return H - padB - (v - mn) / (mx - mn) * (H - padB - padT); };
    var implIdx = 0; pts.forEach(function (pt, i) { if (pt.date <= impl) implIdx = i; }); var implX = x(implIdx);
    var shadeBefore = '<rect x="' + padL + '" y="' + padT + '" width="' + (implX - padL).toFixed(1) + '" height="' + (H - padB - padT) + '" fill="#eef1f7"/>';
    var shadeAfter = '<rect x="' + implX.toFixed(1) + '" y="' + padT + '" width="' + (W - padR - implX).toFixed(1) + '" height="' + (H - padB - padT) + '" fill="#eaf6ef"/>';
    var implLine = '<line x1="' + implX.toFixed(1) + '" y1="' + padT + '" x2="' + implX.toFixed(1) + '" y2="' + (H - padB) + '" stroke="#0f9d6b" stroke-width="2"/><text x="' + implX.toFixed(1) + '" y="' + (padT - 4) + '" font-size="10" font-weight="700" fill="#0f9d6b" text-anchor="middle">▲ implantação ' + dbr(p.implementedAt) + '</text>';
    var metaLine = meta != null ? '<line x1="' + padL + '" y1="' + y(meta).toFixed(1) + '" x2="' + (W - padR) + '" y2="' + y(meta).toFixed(1) + '" stroke="#e0662a" stroke-width="1.5" stroke-dasharray="5 4"/><text x="' + (W - padR) + '" y="' + (y(meta) - 4).toFixed(1) + '" font-size="10" fill="#e0662a" text-anchor="end">meta ' + fmtInd(p, meta) + '</text>' : '';
    var segs = []; var cur = [];
    pts.forEach(function (pt, i) { if (pt.val == null) { if (cur.length > 1) segs.push(cur); cur = []; } else cur.push(x(i).toFixed(1) + ',' + y(pt.val).toFixed(1)); });
    if (cur.length > 1) segs.push(cur);
    var line = segs.map(function (s) { return '<polyline points="' + s.join(' ') + '" fill="none" stroke="#2b4bd6" stroke-width="2.5"/>'; }).join('');
    var dots = pts.map(function (pt, i) { return pt.val == null ? '' : '<circle cx="' + x(i).toFixed(1) + '" cy="' + y(pt.val).toFixed(1) + '" r="2.5" fill="#2b4bd6"><title>' + dbr(pt.date.toISOString()) + ': ' + fmtInd(p, pt.val) + '</title></circle>'; }).join('');
    var labels = ''; var step = Math.ceil(pts.length / 7); pts.forEach(function (pt, i) { if (i % step === 0 || i === pts.length - 1) labels += '<text x="' + x(i).toFixed(1) + '" y="' + (H - 8) + '" font-size="9.5" fill="#64708a" text-anchor="middle">' + monthDayLabel(pt.date.toISOString().slice(0, 10)) + '</text>'; });
    var yl = '<text x="6" y="' + (y(mx) + 4).toFixed(1) + '" font-size="9.5" fill="#64708a">' + fmtInd(p, mx) + '</text><text x="6" y="' + (y(mn) + 4).toFixed(1) + '" font-size="9.5" fill="#64708a">' + fmtInd(p, mn) + '</text>';
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" style="max-width:' + W + 'px">' + shadeBefore + shadeAfter + implLine + metaLine + line + dots + labels + yl + '</svg>';
  }
  function planMeasureBlock(p) {
    var win = planWinById[p.id] || '7'; var mode = planModeById[p.id] || 'taxa'; var smooth = !!planSmoothById[p.id];
    var impl = new Date(p.implementedAt).getTime(); var now = Date.now();
    var obsAll = Math.max(0, Math.floor((now - impl) / 864e5));
    var n = win === 'hoje' ? 1 : win === '7' ? 7 : win === '15' ? 15 : win === '30' ? 30 : Math.max(1, obsAll);
    var pre = measureWindowFull(p, new Date(impl - n * 864e5), new Date(impl));
    var to = Math.min(impl + n * 864e5, now); var post = measureWindowFull(p, new Date(impl), new Date(to));
    var obs = Math.max(0, Math.min(n, obsAll)); var preliminary = obs < n;
    var higher = !!INDICATOR_HIGHER[p.indicatorKind];
    var deltaPct = (pre.val != null && post.val != null && Math.abs(pre.val) > 0.001) ? r2((higher ? (post.val - pre.val) : (pre.val - post.val)) / Math.abs(pre.val) * 100) : null;
    var mat = planMaturity(p);
    var winChips = [['hoje', 'Hoje'], ['7', '7 dias'], ['15', '15 dias'], ['30', '30 dias'], ['desde', 'Desde impl.']];
    var pval = mode === 'fin' ? measureWindowFull(p, new Date(impl - n * 864e5), new Date(impl)) : pre; // fin uses money in window
    var fmtV = function (m) { return mode === 'fin' ? brl(m.val || 0) : (m.val != null ? fmtInd(p, m.val) : '—'); };
    var denom = function (m) { return (p.indicatorKind === 'taxa_causa') ? (nn(m.num) + ' ocorr. / ' + nn(m.den) + ' pedidos') : (nn(m.num) + ' ocorrência(s)'); };
    var clsLabel = deltaPct == null ? 'Sem dados suficientes' : ((deltaPct > 2 ? 'Melhorando' : deltaPct < -2 ? 'Piorando' : 'Estável') + (preliminary ? ' — preliminar' : ''));
    var clsCls = deltaPct == null ? 'neutral' : deltaPct > 2 ? 'green' : deltaPct < -2 ? 'red' : 'amber';
    var controls = '<span class="cleg">' + winChips.map(function (c) { return '<span class="chip' + (win === c[0] ? ' chip-on' : '') + '" style="font-size:10.5px;padding:3px 8px" data-plwin="' + p.id + '|' + c[0] + '">' + c[1] + '</span>'; }).join('') +
      ' <span class="chip' + (mode === 'taxa' ? ' chip-on' : '') + '" style="font-size:10.5px;padding:3px 8px" data-plmode="' + p.id + '|taxa">Taxa/volume</span><span class="chip' + (mode === 'fin' ? ' chip-on' : '') + '" style="font-size:10.5px;padding:3px 8px" data-plmode="' + p.id + '|fin">Financeiro</span>' +
      ' <span class="chip' + (smooth ? ' chip-on' : '') + '" style="font-size:10.5px;padding:3px 8px" data-plsmooth="' + p.id + '">Média 7d</span></span>';
    return '<div class="chartcard"><div class="cch"><h4>' + esc(mode === 'fin' ? 'Impacto financeiro do escopo' : p.indicator) + '</h4>' + controls + '</div>' + svgPlanChart(p, win, mode, smooth) + '</div>' +
      '<div class="kstrip"><div class="kc"><div class="kl">Antes (' + (win === 'desde' ? obsAll + 'd' : n + 'd') + ')</div><div class="kv" style="font-size:17px">' + fmtV(mode === 'fin' ? pval : pre) + '</div><div class="ks">' + denom(pre) + '</div></div>' +
      '<div class="kc"><div class="kl">Depois</div><div class="kv" style="font-size:17px">' + fmtV(post) + '</div><div class="ks">' + denom(post) + ' · ' + obs + '/' + n + ' dias' + (preliminary ? ' · preliminar' : '') + '</div></div>' +
      '<div class="kc ' + (deltaPct == null ? '' : deltaPct > 0 ? 'green' : 'red') + '"><div class="kl">Variação</div><div class="kv" style="font-size:17px">' + (deltaPct == null ? '—' : (deltaPct > 0 ? '↓ ' : '↑ ') + Math.abs(deltaPct) + '%') + '</div><div class="ks">' + (higher ? 'maior é melhor' : 'menor é melhor') + '</div></div>' +
      '<div class="kc"><div class="kl">Meta</div><div class="kv" style="font-size:17px">' + (p.targetValue != null ? fmtInd(p, p.targetValue) : '—') + '</div></div>' +
      '<div class="kc ' + clsCls + '"><div class="kl">Classificação</div><div class="kv" style="font-size:14px">' + clsLabel + '</div><div class="ks">maturidade ' + mat + '%</div></div></div>' +
      '<div class="fin-line"><span>Implantado em</span><span>' + dbr(p.implementedAt) + ' · marco zero da medição</span></div>';
  }
  function planMaturity(p) { if (!p.implementedAt) return 0; var days = Math.floor((Date.now() - new Date(p.implementedAt).getTime()) / 864e5); return Math.max(0, Math.min(100, Math.round(days / (p.windowAfterDays || 30) * 100))); }
  function planResult(p) {
    if (!p.implementedAt) return { k: 'AGUARDANDO', label: 'Aguardando implantação', cls: 'neutral' };
    var higher = !!INDICATOR_HIGHER[p.indicatorKind];
    var impl = new Date(p.implementedAt).getTime(); var now = Date.now(); var obs = Math.max(1, Math.floor((now - impl) / 864e5));
    // antes = janela imediatamente anterior à implantação (não a foto no dia da criação, §19)
    var b = measureWindow(p, new Date(impl - obs * 864e5), new Date(impl));
    var c = measureWindow(p, new Date(impl), new Date(now));
    if (b == null || c == null) return { k: 'INCONCLUSIVO', label: 'Inconclusivo', cls: 'neutral' };
    var rel = Math.abs(c - b) < Math.max(0.5, Math.abs(b) * 0.05);
    if (rel) return { k: 'SEM', label: 'Sem mudança relevante', cls: 'warn' };
    var improved = higher ? c > b : c < b;
    return improved ? { k: 'MELHOROU', label: 'Melhorou', cls: 'ok' } : { k: 'PIOROU', label: 'Piorou', cls: 'warn' };
  }
  function createPlan(dto) {
    var now = new Date().toISOString();
    var p = { id: 'p' + Date.now() + Math.round(Math.random() * 1e6), title: dto.title, problem: dto.problem || null, origin: dto.origin || 'user', status: dto.status || 'PLANEJADO', ownerName: dto.ownerName || null,
      indicator: dto.indicator || 'Impacto líquido do escopo (R$)', indicatorKind: dto.indicatorKind || 'liquido', causeKey: dto.causeKey || null,
      scopeSkus: dto.scopeSkus || dto.relatedSkus || [], targetValue: dto.targetValue != null ? dto.targetValue : null, windowBeforeDays: 30, windowAfterDays: 30,
      relatedFindings: dto.relatedFindings || [], checklist: [], implementedAt: null, baselineValue: null, createdAt: now };
    p.baselineValue = measureIndicator(p); // fotografia do "antes" no momento da criação
    plans.unshift(p); return putMany('plans', [p]);
  }
  function savePlan(p) { return putMany('plans', [p]); }
  var PLAN_STATUS = { PLANEJADO: 'Planejado', EM_EXECUCAO: 'Em execução', MEDINDO: 'Medindo', ENCERRADO: 'Encerrado' };
  var planFilter = 'todos';
  var planWinById = {}, planModeById = {}, planSmoothById = {}; // seleção do gráfico por plano (transiente)
  function planCard(p) {
    var b = p.baselineValue, c = measureIndicator(p), res = planResult(p), mat = planMaturity(p);
    var higher = !!INDICATOR_HIGHER[p.indicatorKind];
    var deltaTxt = (b != null && c != null) ? (fmtInd(p, c) + (c === b ? '' : ' (' + (higher ? (c > b ? '↑' : '↓') : (c < b ? '↓' : '↑')) + ' de ' + fmtInd(p, b) + ')')) : '—';
    return '<div class="panel"><div class="ph"><h3>' + esc(p.title) + '</h3><span class="tag ' + (p.status === 'ENCERRADO' ? 'ok' : p.status === 'MEDINDO' ? 'info' : 'neutral') + '">' + (PLAN_STATUS[p.status] || p.status) + '</span></div><div class="pb">' +
      (p.problem ? '<div class="fin-line"><span>Problema</span><b>' + esc(p.problem) + '</b></div>' : '') +
      '<div class="fin-line"><span>Como vamos medir?</span><span>' + esc(p.indicator) + (p.secondary && p.secondary.length ? ' <span class="footnote">(+ ' + p.secondary.length + ' secundário' + (p.secondary.length > 1 ? 's' : '') + ')</span>' : '') + '</span></div>' +
      (p.implementedAt ? planMeasureBlock(p) : callout('', 'Ainda não implantado', 'A medição antes × depois começa quando você registrar a data de implantação (marco zero). Clique em “Iniciar medição”.')) +
      (p.scopeSkus && p.scopeSkus.length ? '<div class="footnote">Escopo: ' + esc(p.scopeSkus.join(', ')) + '</div>' : '<div class="footnote">Escopo: operação inteira</div>') +
      '<div style="margin-top:8px">' + p.checklist.map(function (it) { return '<label style="display:flex;gap:8px;align-items:center;padding:3px 0"><input type="checkbox" data-plchk="' + p.id + '|' + it.id + '"' + (it.done ? ' checked' : '') + '> <span style="text-decoration:' + (it.done ? 'line-through' : 'none') + ';color:' + (it.done ? 'var(--muted)' : 'inherit') + '">' + esc(it.text) + '</span></label>'; }).join('') + '</div>' +
      '<div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;align-items:center"><input class="input sm" data-plitem="' + p.id + '" style="width:180px" placeholder="+ item do checklist"><input class="input sm" data-pltarget="' + p.id + '" style="width:110px" placeholder="meta" value="' + (p.targetValue != null ? p.targetValue : '') + '"><input class="input sm" data-plowner="' + p.id + '" style="width:130px" placeholder="responsável" value="' + esc(p.ownerName || '') + '"><select class="select sm" data-plstatus="' + p.id + '">' + Object.keys(PLAN_STATUS).map(function (k) { return '<option value="' + k + '"' + (p.status === k ? ' selected' : '') + '>' + PLAN_STATUS[k] + '</option>'; }).join('') + '</select>' + (!p.implementedAt ? '<button class="btn-sm primary" data-plmeasure="' + p.id + '">Iniciar medição</button>' : '') + '<button class="btn-sm" data-pldel="' + p.id + '">Excluir</button></div></div></div>';
  }
  function devPlanos() {
    var suggestions = plans.filter(function (p) { return p.status === 'SUGGESTED'; });
    var official = plans.filter(function (p) { return p.status !== 'SUGGESTED'; });
    var counts = { PLANEJADO: 0, EM_EXECUCAO: 0, MEDINDO: 0, ENCERRADO: 0 }; official.forEach(function (p) { counts[p.status] = (counts[p.status] || 0) + 1; });
    var confirmados = official.filter(function (p) { return planResult(p).k === 'MELHOROU'; });
    var semEfeito = official.filter(function (p) { var r = planResult(p).k; return r === 'SEM' || r === 'PIOROU'; });
    var chips = [['todos', 'Todos'], ['PLANEJADO', 'Planejado'], ['EM_EXECUCAO', 'Em execução'], ['MEDINDO', 'Medindo'], ['ENCERRADO', 'Encerrado']];
    var view = planFilter === 'todos' ? official : official.filter(function (p) { return p.status === planFilter; });
    return secHead('CORREÇÃO', 'Plano de ação', 'Corrija e meça. Metas em percentual, medição antes/depois com maturidade, e sugestões da inteligência para aprovar.') +
      kstrip([
        { l: 'Sugestões da IA', v: nn(suggestions.length), cls: 'orange' },
        { l: 'Planejado', v: nn(counts.PLANEJADO), cls: 'blue' },
        { l: 'Em execução', v: nn(counts.EM_EXECUCAO), cls: 'blue' },
        { l: 'Medindo', v: nn(counts.MEDINDO), cls: 'amber' },
        { l: 'Encerrado', v: nn(counts.ENCERRADO), cls: 'green' },
      ]) +
      (suggestions.length ? '<div class="panel"><div class="ph"><h3>Sugestões da inteligência</h3><span class="footnote" style="margin:0">rascunhos — não são planos oficiais até aprovar</span></div><div class="pb">' + suggestions.map(function (p) { return '<div class="callout warn" style="margin-bottom:10px"><div class="ct">' + esc(p.title) + '</div><div class="cbody">' + (p.problem ? '<div class="fin-line"><span>Problema</span><b>' + esc(p.problem) + '</b></div>' : '') + '<div class="fin-line"><span>Indicador</span><span>' + esc(p.indicator) + '</span></div>' + (p.scopeSkus && p.scopeSkus.length ? '<div class="fin-line"><span>Escopo</span><span class="mono footnote" style="margin:0">' + esc(p.scopeSkus.join(', ')) + '</span></div>' : '') + '<div style="display:flex;gap:8px;margin-top:8px"><button class="btn-sm primary" data-plapprove="' + p.id + '">Aprovar plano</button><button class="btn-sm" data-plignore="' + p.id + '">Ignorar</button></div></div></div>'; }).join('') + '</div></div>' : '') +
      '<div class="importbar"><div style="flex:1;display:flex;gap:8px;flex-wrap:wrap"><input class="input sm" id="plt" style="flex:2;min-width:200px" placeholder="Nova ação (ex.: novo padrão de embalagem 80x120)"><input class="input sm" id="pls" style="flex:1;min-width:150px" placeholder="SKUs (vírgula) — escopo"><button class="btn-sm primary" id="plnew">Criar plano</button></div></div>' +
      '<div class="chips" style="padding:0 0 10px">' + chips.map(function (c) { return '<span class="chip' + (planFilter === c[0] ? ' chip-on' : '') + '" data-plfilter="' + c[0] + '">' + c[1] + (c[0] !== 'todos' ? ' <b>' + nn(counts[c[0]] || 0) + '</b>' : '') + '</span>'; }).join('') + '</div>' +
      (view.length ? view.map(planCard).join('') : '<div class="panel"><div class="empty">Nenhum plano ' + (planFilter === 'todos' ? '' : 'neste status') + '. Crie um ou aprove uma sugestão da inteligência.</div></div>') +
      (confirmados.length ? '<div class="panel"><div class="ph"><h3>✅ Resultados confirmados</h3></div><div class="pb">' + confirmados.map(function (p) { var b = p.baselineValue, c = measureIndicator(p); return '<div class="fin-line"><span><b>' + esc(p.title) + '</b> — ' + esc(p.indicator) + '</span><span class="pos">' + fmtInd(p, b) + ' → ' + fmtInd(p, c) + '</span></div>'; }).join('') + '</div></div>' : '') +
      (semEfeito.length ? '<div class="panel"><div class="ph"><h3>⚠️ Sem efeito (não esconder)</h3></div><div class="pb">' + semEfeito.map(function (p) { var b = p.baselineValue, c = measureIndicator(p); return '<div class="fin-line"><span><b>' + esc(p.title) + '</b> — ' + esc(p.indicator) + '</span><span>' + fmtInd(p, b) + ' → ' + fmtInd(p, c) + '</span></div>'; }).join('') + '</div></div>' : '');
  }
  function bindPlanos() {
    app.querySelectorAll('[data-plfilter]').forEach(function (c) { c.onclick = function () { planFilter = c.dataset.plfilter; render(); }; });
    app.querySelectorAll('[data-plwin]').forEach(function (c) { c.onclick = function () { var pr = c.dataset.plwin.split('|'); planWinById[pr[0]] = pr[1]; render(); }; });
    app.querySelectorAll('[data-plmode]').forEach(function (c) { c.onclick = function () { var pr = c.dataset.plmode.split('|'); planModeById[pr[0]] = pr[1]; render(); }; });
    app.querySelectorAll('[data-plsmooth]').forEach(function (c) { c.onclick = function () { planSmoothById[c.dataset.plsmooth] = !planSmoothById[c.dataset.plsmooth]; render(); }; });
    var nb = document.getElementById('plnew'); if (nb) nb.onclick = function () { var t = document.getElementById('plt').value.trim(); if (!t) return; var skus = (document.getElementById('pls').value || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean); var m = suggestMetric(t); createPlan({ title: t, scopeSkus: skus, indicator: m.indicator, indicatorKind: m.kind, causeKey: m.causeKey }).then(function () { render(); toast('Plano criado', t); }); };
    app.querySelectorAll('[data-plapprove]').forEach(function (b) { b.onclick = function () { var p = plans.find(function (x) { return x.id === b.dataset.plapprove; }); if (!p) return; p.status = 'PLANEJADO'; p.origin = 'suggestion'; p.baselineValue = measureIndicator(p); savePlan(p).then(render); toast('Plano aprovado', p.title); }; });
    app.querySelectorAll('[data-plignore]').forEach(function (b) { b.onclick = function () { var id = b.dataset.plignore; plans = plans.filter(function (x) { return x.id !== id; }); delOne('plans', id).then(render); }; });
    app.querySelectorAll('[data-plchk]').forEach(function (c) { c.onchange = function () { var pr = c.dataset.plchk.split('|'); var p = plans.find(function (x) { return x.id === pr[0]; }); if (!p) return; var it = p.checklist.find(function (x) { return x.id === pr[1]; }); if (it) { it.done = c.checked; savePlan(p).then(render); } }; });
    app.querySelectorAll('[data-plitem]').forEach(function (inp) { inp.onkeydown = function (e) { if (e.key === 'Enter' && inp.value.trim()) { var p = plans.find(function (x) { return x.id === inp.dataset.plitem; }); if (p) { p.checklist.push({ id: 'c' + Date.now() + Math.round(Math.random() * 1e6), text: inp.value.trim(), done: false }); savePlan(p).then(render); } } }; });
    app.querySelectorAll('[data-pltarget]').forEach(function (inp) { inp.onblur = function () { var p = plans.find(function (x) { return x.id === inp.dataset.pltarget; }); if (!p) return; var v = inp.value.trim(); p.targetValue = v === '' ? null : Number(v.replace(',', '.')); savePlan(p); }; });
    app.querySelectorAll('[data-plowner]').forEach(function (inp) { inp.onblur = function () { var p = plans.find(function (x) { return x.id === inp.dataset.plowner; }); if (!p) return; p.ownerName = inp.value.trim() || null; savePlan(p); }; });
    app.querySelectorAll('[data-plmeasure]').forEach(function (b) { b.onclick = function () { var p = plans.find(function (x) { return x.id === b.dataset.plmeasure; }); if (!p) return; var today = new Date().toISOString().slice(0, 10); var dt = prompt('Essa ação entrou em operação em qual data? (AAAA-MM-DD)', today); if (!dt) return; var d = new Date(dt + 'T00:00:00'); if (isNaN(d)) { toast('Data inválida', dt, true); return; } p.implementedAt = d.toISOString(); p.status = 'MEDINDO'; if (p.baselineValue == null) p.baselineValue = measureIndicator(p); savePlan(p).then(render); toast('Medição iniciada', 'Implantado em ' + dbr(p.implementedAt)); }; });
    app.querySelectorAll('[data-plstatus]').forEach(function (s) { s.onchange = function () { var p = plans.find(function (x) { return x.id === s.dataset.plstatus; }); if (!p) return; p.status = s.value; if (s.value === 'MEDINDO' && !p.implementedAt) p.implementedAt = new Date().toISOString(); savePlan(p).then(render); }; });
    app.querySelectorAll('[data-pldel]').forEach(function (b) { b.onclick = function () { var id = b.dataset.pldel; plans = plans.filter(function (x) { return x.id !== id; }); delOne('plans', id).then(render); }; });
  }
  // ---- análise client-side (mesmas regras determinísticas do backend) ----
  function devLoss(list) { return list.reduce(function (s, o) { return s + occEffectiveLoss(o); }, 0); }
  function devCauseBreakdown(list) { var map = {}; var total = devLoss(list) || 1; list.forEach(function (o) { var key = o.causeFamily || occGuessCause(o); var c = map[key] = map[key] || { key: key, label: DEV.CAUSE_LABELS[key] || key, cases: 0, loss: 0, atRisk: 0 }; c.cases++; c.loss += occEffectiveLoss(o); c.atRisk += o.exposure.atRisk; }); return Object.values(map).map(function (c) { c.share = r2(c.loss / total * 100); c.loss = r2(c.loss); c.atRisk = r2(c.atRisk); return c; }).sort(function (a, b) { return b.loss - a.loss; }); }
  function devMotivosData(list) { var map = {}; list.forEach(function (o) { var reason = (o.reason || '(sem motivo informado)').trim(); var c = map[reason] = map[reason] || { reason: reason, cases: 0, approved: 0, analyzing: 0, giveups: 0, loss: 0, atRisk: 0, compensation: 0, ticket: 0, returned: 0 }; c.cases++; if (occApproved(o)) c.approved++; else if (occGiveup(o)) c.giveups++; else c.analyzing++; c.loss += occEffectiveLoss(o); c.atRisk += o.exposure.atRisk; c.compensation += o.compensation; c.ticket += o.requested; if (o.merchandiseStatus === 'RECEBIDO') c.returned++; }); return Object.values(map).map(function (r) { r.giveupRate = r.cases ? r2(r.giveups / r.cases * 100) : 0; r.avgTicket = r.cases ? r2(r.ticket / r.cases) : 0; r.loss = r2(r.loss); r.atRisk = r2(r.atRisk); r.compensation = r2(r.compensation); return r; }).sort(function (a, b) { return b.loss - a.loss || b.cases - a.cases; }); }
  function devCriticosData(list) { var map = {}; var total = devLoss(list) || 1; list.forEach(function (o) { var seen = {}; var skus = []; (o.items || []).forEach(function (i) { if (i.sku && !seen[i.sku]) { seen[i.sku] = 1; skus.push(i.sku); } }); var share = skus.length || 1; var cause = o.causeFamily || occGuessCause(o); skus.forEach(function (sku) { var item = (o.items || []).find(function (i) { return i.sku === sku; }); var c = map[sku] = map[sku] || { sku: sku, product: item ? item.productName : null, occ: 0, loss: 0, additional: 0, recovered: 0, causes: {}, linked: !!(item && item.skuLinked) }; c.occ++; c.loss += occEffectiveLoss(o) / share; c.additional += (o.impact.additionalCostTotal || 0) / share; c.recovered += (o.impact.recoveredTotal || 0) / share; c.causes[cause] = (c.causes[cause] || 0) + 1; }); }); return Object.values(map).map(function (s) { var dom = Object.entries(s.causes).sort(function (a, b) { return b[1] - a[1]; })[0]; return { sku: s.sku, product: s.product, occ: s.occ, loss: r2(s.loss), additional: r2(s.additional), recovered: r2(s.recovered), dominant: dom ? (DEV.CAUSE_LABELS[dom[0]] || dom[0]) : '—', share: r2(s.loss / total * 100), linked: s.linked }; }).sort(function (a, b) { return b.loss - a.loss || b.occ - a.occ; }).slice(0, 50); }
  function devFinanceiroData(list) { var r = { refunded: 0, additional: 0, recovered: 0, compensation: 0, disputeRec: 0, confirmed: 0, atRisk: 0, net: 0 }; list.forEach(function (o) { r.refunded += o.impact.refundedTotal || 0; r.additional += o.impact.additionalCostTotal || 0; r.recovered += o.impact.recoveredTotal || 0; r.compensation += o.compensation; r.disputeRec += o.disputeRecovered || 0; r.confirmed += occEffectiveLoss(o); r.atRisk += o.exposure.atRisk; r.net += occEffectiveLoss(o); }); Object.keys(r).forEach(function (k) { r[k] = r2(r[k]); }); return r; }
  function devDisputesData(list) { var now = new Date(); var soon = new Date(now.getTime() + 3 * 864e5); var d = { possiveis: 0, abertas: 0, vencendo: 0, vencidas: 0, respondidas: 0, ganhas: 0, perdidas: 0, contestado: 0, recuperado: 0 }; list.forEach(function (o) { var st = o.disputeStatus; if (st === 'POSSIVEL') d.possiveis++; if (['POSSIVEL', 'EM_PREPARACAO', 'RESPONDIDA', 'AGUARDANDO_SHOPEE'].indexOf(st) >= 0) d.abertas++; if (['EM_PREPARACAO', 'AGUARDANDO_SHOPEE', 'POSSIVEL'].indexOf(st) >= 0 && o.disputeDeadline) { var dl = new Date(o.disputeDeadline); if (dl < now) d.vencidas++; else if (dl <= soon) d.vencendo++; } if (st === 'RESPONDIDA' || o.disputeRespondedAt) d.respondidas++; if (st === 'GANHA' || st === 'PARCIAL') d.ganhas++; if (st === 'PERDIDA') d.perdidas++; d.contestado += o.disputeContested || 0; d.recuperado += o.disputeRecovered || 0; }); var resp = d.possiveis + d.respondidas + d.ganhas + d.perdidas; d.taxaResposta = resp ? r2((d.respondidas + d.ganhas + d.perdidas) / resp * 100) : 0; d.contestado = r2(d.contestado); d.recuperado = r2(d.recuperado); return d; }

  // Coorte por MÊS DO PEDIDO (playbook §4): atribui a devolução ao mês do pedido que a
  // originou (não ao mês em que a solicitação foi aberta). Taxa = devoluções ÷ pedidos do mês.
  // §44-47 do prompt de remodelação de Devolução: "taxa de devolução por período de VENDA" — nunca
  // por data de abertura. Um pedido pago em julho que devolve em agosto conta como devolução DA
  // COORTE DE JULHO (§4-5). occVendaData() já prefere a data de pagamento (Pedidos), cruzada por ID.
  function devCohortData() {
    var ordByMonth = {};
    orders.forEach(function (o) { var v = o.paidAt || o.createdAt; if (v) { var k = v.slice(0, 7); ordByMonth[k] = (ordByMonth[k] || 0) + 1; } });
    var map = {};
    occ.forEach(function (o) {
      if (o.isDemo) return;
      var iso = occVendaData(o) || o.occurredAt; if (!iso) return;
      var k = iso.slice(0, 7);
      var m = map[k] = map[k] || { k: k, occ: 0, loss: 0 };
      m.occ++; m.loss += occEffectiveLoss(o);
    });
    // §44: coorte imatura — meses recentes ainda não tiveram tempo hábil para gerar todas as devoluções.
    var hojeKey = new Date().toISOString().slice(0, 7);
    return Object.values(map).sort(function (a, b) { return a.k.localeCompare(b.k); }).map(function (m) {
      var ord = ordByMonth[m.k] || 0; m.orders = ord; m.taxa = ord ? r2(m.occ / ord * 100) : null; m.loss = r2(m.loss);
      m.imatura = m.k >= hojeKey; return m;
    });
  }
  function monthLabel(k) { var p = k.split('-'); var mm = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']; return p[1] ? (mm[+p[1] - 1] + '/' + p[0].slice(2)) : k; }

  function devExec() {
    var list = occInPeriod(); if (!list.length) return secHead('PANORAMA', 'Devolução', 'Receba, confira e defenda suas devoluções.') + emptyBox('Nenhuma ocorrência. Importe os relatórios na aba Importações.');
    var agg = computeOrderAgg();
    var confirmed = r2(devLoss(list)); var atRisk = r2(list.reduce(function (s, o) { return s + o.exposure.atRisk; }, 0)); var recovered = r2(list.reduce(function (s, o) { return s + (o.impact.recoveredTotal || 0); }, 0));
    var motivos = devMotivosData(list); var crit = devCriticosData(list); var fin = devFinanceiroData(list);
    // Panorama de gestão (§17-22): 4 indicadores + evolução + motivos + produtos + resumo financeiro + até 3 achados.
    var denomWarn = !agg.orders ? callout('red', 'Sem base de pedidos', 'Importe os <b>Pedidos</b> para calcular a taxa real de devolução. Sem o total de pedidos, a contagem mede volume, não qualidade.') : '';
    var cohort = devCohortData(); var hasTaxa = cohort.some(function (m) { return m.taxa != null; });
    var chartRows = cohort.map(function (m) { return { label: monthLabel(m.k) + (m.imatura ? '*' : ''), bar: m.occ, line: hasTaxa ? (m.taxa || 0) : m.loss }; });
    var imaturaNote = cohort.some(function (m) { return m.imatura; }) ? '<div class="footnote" style="padding:4px 16px 0">* coorte ainda imatura — vendas recentes ainda não tiveram tempo hábil para gerar todas as devoluções.</div>' : '';
    var trend = cohort.length >= 2 ? chartCard('Taxa de devolução por período de venda (coorte)',
      legendSwatch([['Devoluções', '#2b4bd6'], [hasTaxa ? 'Taxa de devolução %' : 'Perda R$', '#d13b3b']]) + ' <button class="link-btn" data-go="analises" data-asub="evolucao">detalhar</button>',
      svgBarLine(chartRows, { barFmt: nn, lineFmt: hasTaxa ? function (v) { return pct(v); } : function (v) { return brl(v); } })) + imaturaNote : '';
    var motChart = motivos.length ? chartCard('Principais motivos', legendSwatch([['Perda R$', '#d13b3b']]) + ' <button class="link-btn" data-go="analises" data-asub="problemas">investigar</button>', svgHBars(motivos.slice(0, 6).map(function (m) { return { label: m.reason, value: m.loss, color: '#d13b3b' }; }), { fmt: function (v) { return brl(v); } })) : '';
    var byProd = {}; crit.forEach(function (s) { var k = s.product || s.sku; var p = byProd[k] = byProd[k] || { label: k, value: 0 }; p.value += s.loss; });
    var prodBars = Object.values(byProd).sort(function (a, b) { return b.value - a.value; }).slice(0, 6);
    var prodChart = prodBars.length ? chartCard('Produtos com maior impacto', legendSwatch([['Perda R$', '#2b4bd6']]) + ' <button class="link-btn" data-go="analises" data-asub="problemas">investigar</button>', svgHBars(prodBars, { color: '#2b4bd6', fmt: function (v) { return brl(v); } })) : '';
    var finResumo = '<div class="panel"><div class="ph"><h3>Resumo financeiro</h3><button class="link-btn" data-go="analises" data-asub="financeiro">Financeiro completo</button></div><div class="pb">' +
      '<div class="fin-line"><span>Reembolsos pagos</span><span class="neg">' + brl(fin.refunded) + '</span></div>' +
      '<div class="fin-line"><span>Frete reverso / outros custos</span><span class="neg">' + brl(fin.additional) + '</span></div>' +
      '<div class="fin-line"><span>Compensações Shopee</span><span class="pos">-' + brl(fin.compensation) + '</span></div>' +
      '<div class="fin-line"><span>Recuperação de disputas</span><span class="pos">-' + brl(fin.disputeRec) + '</span></div>' +
      '<div class="fin-line total"><span>Impacto líquido conhecido</span><span class="neg">' + brl(fin.net) + '</span></div>' +
      '<div class="fin-line"><span>Ainda em risco</span><span>' + brl(fin.atRisk) + '</span></div></div></div>';
    var achados = devAchadosData(list).findings.slice(0, 3);
    var achadosHtml = achados.length ? callout('warn', 'O que o sistema descobriu', achados.map(function (f) { return '<div class="fin-line"><span>' + esc(f.title) + '</span><button class="btn-sm" data-go="analises" data-asub="inteligencia">ver</button></div>'; }).join('')) : '';

    // Devolução × Expedição (§4 do prompt de reorganização): quanto representa sobre o que
    // realmente SAIU da empresa (bipe), não só sobre o que foi vendido.
    var totalExpedidos = Object.keys(shipBip).length;
    var expKpi = totalExpedidos ? (function () { var devExpedidos = list.filter(function (o) { return o.orderId && pedIsExpedido(o.orderId); }).length; return { l: 'Taxa sobre expedidos', v: pct(r2(devExpedidos / totalExpedidos * 100)), cls: 'blue', s: nn(devExpedidos) + ' de ' + nn(totalExpedidos) + ' expedidos' }; })() : null;
    // §43: em poucos segundos — "tenho N casos novos, X vencem hoje, Y aguardando Shopee..."
    var opStrip = kstrip([
      { l: 'Novos casos', v: nn(list.filter(function (o) { return casoJornada(o) === 'NOVA'; }).length), cls: 'blue' },
      { l: 'Precisam de ação', v: nn(list.filter(function (o) { return casoJornada(o) === 'ACAO_NECESSARIA'; }).length), cls: 'amber' },
      { l: 'Prazo vencendo (≤3d)', v: nn(list.filter(function (o) { return ['hoje', 'amanha', 'ate3'].indexOf(prazoChip(o)) >= 0; }).length), cls: 'red' },
      { l: 'Em disputa', v: nn(list.filter(function (o) { return o.hasDispute && ['POSSIVEL', 'EM_PREPARACAO', 'RESPONDIDA', 'AGUARDANDO_SHOPEE'].indexOf(o.disputeStatus) >= 0; }).length), cls: 'blue' },
      { l: 'Aguardando Shopee', v: nn(list.filter(function (o) { return casoJornada(o) === 'AGUARDANDO_SHOPEE'; }).length), cls: 'blue' },
      { l: '🟣 Novo retorno', v: nn(list.filter(casoNovoRetorno).length), cls: 'amber', s: 'desde a última vez que você abriu o caso' },
    ]);
    var opStrip2 = kstrip([
      { l: 'Compensações identificadas', v: nn(list.filter(function (o) { return o.compensation > 0; }).length), cls: 'green', s: brl(list.reduce(function (s, o) { return s + (o.compensation || 0); }, 0)) },
      { l: 'Aguardando retorno físico', v: nn(list.filter(function (o) { return ['EM_TRANSITO', 'CHEGOU_CONFERIR'].indexOf(o.receiptState) >= 0; }).length), cls: 'amber' },
      { l: 'Valor em risco', v: brl(atRisk), cls: 'amber' },
      { l: 'Valor recuperado', v: brl(recovered), cls: 'green' },
      { l: 'Valor perdido (confirmado)', v: brl(confirmed), cls: 'red' },
    ]);
    return secHead('PANORAMA', 'Como estamos?', 'Estamos melhorando ou piorando, quanto perdemos, por quê e quanto recuperamos.') +
      opStrip + opStrip2 +
      kstrip([
        { l: 'Taxa sobre vendidos', v: agg.orders ? pct(list.length / agg.orders * 100) : '—', cls: 'blue', s: agg.orders ? nn(list.length) + ' de ' + nn(agg.orders) + ' pedidos' : 'sem base de pedidos' },
      ].concat(expKpi ? [expKpi] : []).concat([
        { l: 'Perda confirmada', v: brl(confirmed), cls: 'red', s: agg.revenue ? pct(confirmed / agg.revenue * 100) + ' do faturamento' : '' },
        { l: 'Em risco', v: brl(atRisk), cls: 'amber' },
        { l: 'Recuperado', v: brl(recovered), cls: 'green' },
      ])) +
      (!totalExpedidos ? callout('', 'Taxa sobre expedidos ainda não disponível', 'Registre a expedição (bipe) em Pedidos → Expedição para ver a devolução como % do que realmente saiu da empresa — não só do que foi vendido.') : '') +
      denomWarn + achadosHtml + trend +
      '<div class="split2">' + motChart + prodChart + '</div>' +
      finResumo;
  }

  var FLAG_LABELS = { semcausa: 'Sem causa', nova: 'Novas', semresp: 'Sem responsável', naovinc: 'SKU não vinculado', prazo: 'Prazo p/ recorrer' };
  function prazoBadge(o) { if (!o.hasSellerWindow || !o.disputeDeadline) return ''; var dl = new Date(o.disputeDeadline); var days = Math.ceil((dl - Date.now()) / 864e5); if (days < 0) return ' <span class="tag warn">🔴 prazo vencido</span>'; if (days <= 0) return ' <span class="tag warn">⚠️ responder hoje</span>'; if (days <= 3) return ' <span class="tag warn">⚠️ ' + days + 'd p/ recorrer</span>'; return ' <span class="tag info">recorrer até ' + dbr(o.disputeDeadline) + '</span>'; }
  function devOcc() {
    var all = occInPeriodAll().slice();
    if (!all.length) return secHead('CASOS', 'Casos', 'Todos os casos de devolução, cancelamento e falha de entrega em um só lugar.') + emptyBox('Nenhum caso. Importe os relatórios na aba Importações.');
    // Contagem nos cabeçalhos por tipo (§11), sempre respeitando o período selecionado (§42).
    var typeCounts = { RETURN_REFUND: 0, ORDER_CANCELLATION: 0, FAILED_DELIVERY: 0 }; all.forEach(function (o) { if (typeCounts[o.type] != null) typeCounts[o.type]++; });
    var typed = devF.type ? all.filter(function (o) { return o.type === devF.type; }) : all;
    // §8-9,39-41: FASE operacional — a jornada mental de Casos (caixa de entrada → acompanhamento →
    // encerrado), sempre abaixo da categoria (tipo) na hierarquia de navegação.
    var faseCounts = { SOLICITACOES: 0, EM_ANDAMENTO: 0, ENCERRADOS: 0 }; typed.forEach(function (o) { faseCounts[casoFase(o)]++; });
    var faseList = devF.fase ? typed.filter(function (o) { return casoFase(o) === devF.fase; }) : typed;
    // Segunda linha DINÂMICA: status reais presentes na fonte selecionada (§4-15) — nunca inventa.
    var statusCounts = {}; var novoStatus = {}; faseList.forEach(function (o) { var raw = o.status || '(sem status)'; statusCounts[raw] = (statusCounts[raw] || 0) + 1; if (o.status && !SHOPEE_STATUS_MAP[normStatus(o.status)]) novoStatus[o.status] = true; });
    var statusList = Object.keys(statusCounts).sort();
    // Etapa da jornada (§10-15,18) — SEMPRE calculada, nunca digitada; nunca mistura com motivo/pendência.
    var jornadaCounts = {}; faseList.forEach(function (o) { var j = casoJornada(o); jornadaCounts[j] = (jornadaCounts[j] || 0) + 1; });
    var JORNADA_ORDEM = ['NOVA', 'AVALIACAO', 'ACAO_NECESSARIA', 'AGUARDANDO_SHOPEE', 'COLETA', 'FALHA_IDENTIFICADA', 'CONCILIACAO', 'TRANSPORTE', 'VALIDAR', 'BAIXADA', 'REJEITADA'];
    var jornadaKeys = JORNADA_ORDEM.filter(function (k) { return jornadaCounts[k]; });
    // Motivo (§16-17) — dimensão separada da jornada, construída só com o que existe em o.reason.
    var motivoCounts = {}; faseList.forEach(function (o) { var mv = casoMotivo(o); motivoCounts[mv] = (motivoCounts[mv] || 0) + 1; });
    var motivoKeys = Object.keys(motivoCounts).sort(function (a, b) { return motivoCounts[b] - motivoCounts[a]; });
    var motivoTop = motivoKeys.slice(0, 8), motivoRest = motivoKeys.length - motivoTop.length;
    // §24-25: desde a última importação — teve atualização / novo retorno / compensação nova / rastreio.
    var devLastBatch = batches.filter(function (b) { return b.module && b.module.indexOf('Devolução') === 0; }).sort(function (a, b) { return (b.createdAt || '').localeCompare(a.createdAt || ''); })[0];
    function occTeveAtualizacao(o) { return !!devLastBatch && o.lastStatusAdvanceAt === devLastBatch.createdAt; }
    var list = faseList;
    if (devF.status) list = list.filter(function (o) { return (o.status || '(sem status)') === devF.status; });
    if (devF.jornada) list = list.filter(function (o) { return casoJornada(o) === devF.jornada; });
    if (devF.motivo) list = list.filter(function (o) { return casoMotivo(o) === devF.motivo; });
    if (devF.flag === 'prazo') list = list.filter(function (o) { return o.hasSellerWindow && o.disputeDeadline; });
    else if (devF.flag === 'semcausa') list = list.filter(function (o) { return !o.internalCause && !o.causeFamily; });
    else if (devF.flag === 'semresp') list = list.filter(function (o) { return !o.ownerName; });
    else if (devF.flag === 'naovinc') list = list.filter(function (o) { return (o.items || []).some(function (i) { return i.sku && !i.skuLinked; }); });
    // §27: filtros de prazo (chips prioritários dentro de Solicitações). §28: vencido nunca é lido
    // como "disputa perdida" — é só o alerta de prazo, o resultado continua exigindo revisão manual.
    else if (devF.flag === 'venceHoje') list = list.filter(function (o) { return prazoChip(o) === 'hoje'; });
    else if (devF.flag === 'venceAmanha') list = list.filter(function (o) { return prazoChip(o) === 'amanha'; });
    else if (devF.flag === 'ate3') list = list.filter(function (o) { return ['hoje', 'amanha', 'ate3'].indexOf(prazoChip(o)) >= 0; });
    else if (devF.flag === 'vencido') list = list.filter(function (o) { return prazoChip(o) === 'vencido'; });
    else if (devF.flag === 'semprazo') list = list.filter(function (o) { return expectsAction(o) && prazoChip(o) === 'sem_prazo'; });
    // §24-25: "o que mudou desde ontem?" — desde a última importação.
    else if (devF.flag === 'novoretorno') list = list.filter(casoNovoRetorno);
    else if (devF.flag === 'atualizado') list = list.filter(occTeveAtualizacao);
    // Filtro de status interno com MULTI-SELEÇÃO (§Casos): devF.istSet = {key:true}; compat com devF.internalStatus (único).
    var istSet = devF.istSet || {}; var istKeys = Object.keys(istSet).filter(function (k) { return istSet[k]; });
    if (!istKeys.length && devF.internalStatus) istKeys = [devF.internalStatus];
    if (istKeys.length) list = list.filter(function (o) { return istKeys.indexOf(o.internalStatus) >= 0; });
    if (devF.search) { var s = devF.search.toLowerCase(); list = list.filter(function (o) { return (o.orderId || '').toLowerCase().indexOf(s) >= 0 || (o.returnId || '').toLowerCase().indexOf(s) >= 0 || (o.reason || '').toLowerCase().indexOf(s) >= 0 || (o.items || []).some(function (i) { return (i.sku || '').toLowerCase().indexOf(s) >= 0 || (i.productName || '').toLowerCase().indexOf(s) >= 0; }); }); }
    // prazo mais curto primeiro quando filtrando prazo; senão mais recentes
    if (devF.flag === 'prazo') list = list.slice().sort(function (a, b) { return (a.disputeDeadline || '9999').localeCompare(b.disputeDeadline || '9999'); });
    else list = list.slice().sort(devF.sort === 'impact' ? function (a, b) { return occEffectiveLoss(b) - occEffectiveLoss(a); } : function (a, b) { return (b.occurredAt || '').localeCompare(a.occurredAt || ''); });
    var pages = Math.max(1, Math.ceil(list.length / 25)); if (devPage > pages) devPage = pages;
    var slice = list.slice((devPage - 1) * 25, devPage * 25);
    var ISTMAP = internalStatusMap();
    var typeChips = [['', 'Todas', all.length], ['RETURN_REFUND', 'Devoluções', typeCounts.RETURN_REFUND], ['ORDER_CANCELLATION', 'Cancelamentos', typeCounts.ORDER_CANCELLATION], ['FAILED_DELIVERY', 'Falhas de entrega', typeCounts.FAILED_DELIVERY]];
    var demoN = faseList.filter(function (o) { return o.isDemo; }).length;
    var faseTabs = '<div class="tabs" style="margin-top:8px">' + [['', 'Todos', typed.length], ['SOLICITACOES', 'Solicitações', faseCounts.SOLICITACOES], ['EM_ANDAMENTO', 'Em andamento', faseCounts.EM_ANDAMENTO], ['ENCERRADOS', 'Encerrados', faseCounts.ENCERRADOS]].map(function (c) { return '<div class="tab' + (devF.fase === c[0] ? ' active' : '') + '" data-ocfase="' + c[0] + '">' + c[1] + ' <span class="tag">' + nn(c[2]) + '</span></div>'; }).join('') + '</div>';
    var statusRow = '<div class="chips" style="margin-top:6px"><span class="footnote" style="margin:0 4px 0 0;align-self:center">Status Shopee (bruto):</span><span class="chip' + (devF.status === '' ? ' chip-on' : '') + '" data-ocstatus="">Todos</span>' + statusList.map(function (raw) { var isNew = raw !== '(sem status)' && !SHOPEE_STATUS_MAP[normStatus(raw)]; return '<span class="chip' + (devF.status === raw ? ' chip-on' : '') + '" data-ocstatus="' + esc(raw) + '" title="' + esc(raw) + '">' + esc(statusLabel(raw)) + (isNew ? ' ✦' : '') + ' <b>' + nn(statusCounts[raw]) + '</b></span>'; }).join('') + '</div>';
    var jornadaChips = '<div class="chips" style="margin-top:6px"><span class="footnote" style="margin:0 4px 0 0;align-self:center">Etapa da jornada:</span><span class="chip' + (!devF.jornada ? ' chip-on' : '') + '" data-ocjorn="">Todas <b>' + nn(faseList.length) + '</b></span>' + jornadaKeys.map(function (k) { return '<span class="chip' + (devF.jornada === k ? ' chip-on' : '') + '" data-ocjorn="' + k + '">' + esc(JORNADA_META[k]) + ' <b>' + nn(jornadaCounts[k]) + '</b></span>'; }).join('') + '</div>';
    var motivoChips = '<div class="chips" style="margin-top:6px"><span class="footnote" style="margin:0 4px 0 0;align-self:center">Motivo:</span><span class="chip' + (!devF.motivo ? ' chip-on' : '') + '" data-ocmotivo="">Todos</span>' + motivoTop.map(function (mv) { return '<span class="chip' + (devF.motivo === mv ? ' chip-on' : '') + '" data-ocmotivo="' + esc(mv) + '" title="' + esc(mv) + '">' + esc(mv.length > 26 ? mv.slice(0, 26) + '…' : mv) + ' <b>' + nn(motivoCounts[mv]) + '</b></span>'; }).join('') + (motivoRest > 0 ? '<span class="footnote" style="margin:0 0 0 6px">+' + motivoRest + ' outro(s) motivo(s)</span>' : '') + '</div>';
    // "Pendências operacionais" (§12,27): qualidade de dado/prazo — NUNCA misturado com etapa ou motivo.
    var flagChips = [['', 'Sem filtro'], ['prazo', '⚠️ Precisa de ação'], ['venceHoje', 'Vence hoje'], ['venceAmanha', 'Vence amanhã'], ['ate3', 'Até 3 dias'], ['vencido', '🔴 Prazo vencido'], ['semprazo', 'Sem prazo'], ['novoretorno', '🟣 Novo retorno'], ['atualizado', 'Teve atualização'], ['semcausa', 'Sem causa interna classificada'], ['semresp', 'Sem responsável'], ['naovinc', 'SKU não vinculado']];
    // Filtro de status interno como chips de multi-seleção (marque quantos quiser).
    var istCounts = {}; faseList.forEach(function (o) { istCounts[o.internalStatus] = (istCounts[o.internalStatus] || 0) + 1; });
    var istOrder = Object.keys(ISTMAP).filter(function (k) { return istCounts[k]; }).sort(function (a, b) { return istCounts[b] - istCounts[a]; });
    devCustomStatus.forEach(function (s) { if (s && s.key && istOrder.indexOf(s.key) < 0) istOrder.push(s.key); }); // status personalizados sempre visíveis como filtro
    var istChips = '<div class="chips" style="margin-top:6px"><span class="footnote" style="margin:0 4px 0 0;align-self:center">Status interno (livre, editável):</span><span class="chip' + (!istKeys.length ? ' chip-on' : '') + '" data-ocist="">Todos</span>' + istOrder.map(function (k) { return '<span class="chip' + (istKeys.indexOf(k) >= 0 ? ' chip-on' : '') + '" data-ocist="' + esc(k) + '">' + esc(ISTMAP[k]) + ' <b>' + nn(istCounts[k]) + '</b></span>'; }).join('') + '<span class="chip" data-ocmanage="1" title="Criar, renomear ou remover status internos personalizados">⚙ Gerenciar status</span></div>';
    var novoNote = Object.keys(novoStatus).length ? callout('warn', 'Novo status da Shopee detectado', 'Valores nunca vistos antes (mostrados com ✦): ' + Object.keys(novoStatus).map(function (s) { return '<b>' + esc(s) + '</b>'; }).join(', ') + '. Estão preservados e visíveis; ainda não foram agrupados.') : '';
    var demoNote = demoN ? '<div class="callout warn" style="padding:8px 14px"><div class="cbody">🧪 ' + nn(demoN) + ' caso(s) demonstrativos para validação da interface — não entram em KPIs, financeiro nem análises.</div></div>' : '';
    // Ações em massa: aplicam sobre os casos reais selecionados (demo não é selecionável nem persistido).
    var selIds = Object.keys(devSel).filter(function (id) { return devSel[id]; });
    var istOpt = function (sel) { return '<option value="">— manter —</option>' + Object.keys(ISTMAP).map(function (k) { return '<option value="' + k + '"' + (sel === k ? ' selected' : '') + '>' + ISTMAP[k] + '</option>'; }).join(''); };
    var mapOpt = function (m) { return '<option value="">— manter —</option>' + Object.keys(m).map(function (k) { return '<option value="' + k + '">' + m[k] + '</option>'; }).join(''); };
    var bulkBar = selIds.length ? '<div class="panel" style="border:1.5px solid var(--brand);background:var(--brand-soft,#f2f5ff)"><div class="pb" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><b style="font-size:13px">' + nn(selIds.length) + ' selecionado(s):</b>' +
      '<select class="select sm" id="blkist">' + istOpt('') + '</select>' +
      '<select class="select sm" id="blkresp"><option value="">Responsabilidade — manter —</option>' + Object.keys(DEV.RESPONSIBILITY).map(function (k) { return '<option value="' + k + '">' + DEV.RESPONSIBILITY[k] + '</option>'; }).join('') + '</select>' +
      '<select class="select sm" id="blkprio"><option value="">Prioridade — manter —</option>' + Object.keys(DEV.PRIORITY).map(function (k) { return '<option value="' + k + '">' + DEV.PRIORITY[k] + '</option>'; }).join('') + '</select>' +
      '<input class="input sm" id="blkowner" style="width:150px" placeholder="Responsável (opcional)">' +
      '<button class="btn-sm primary" id="blkapply">Aplicar aos ' + nn(selIds.length) + '</button><button class="btn-sm" id="blkclear">Limpar seleção</button></div></div>' : '';
    var allSelectable = slice.filter(function (o) { return !o.isDemo; });
    var allChecked = allSelectable.length && allSelectable.every(function (o) { return devSel[o.id]; });
    return secHead('CASOS', 'Casos', 'Todos os casos de devolução, cancelamento e falha de entrega em um só lugar. Etapa e motivo são filtros separados; a próxima ação diz o que fazer agora.') +
      '<div class="chips">' + typeChips.map(function (c) { return '<span class="chip' + (devF.type === c[0] ? ' chip-on' : '') + '" data-octype="' + c[0] + '">' + c[1] + ' <b>' + nn(c[2]) + '</b></span>'; }).join('') + '</div>' +
      faseTabs +
      jornadaChips + motivoChips + statusRow +
      '<div class="chips" style="margin-top:6px"><span class="footnote" style="margin:0 4px 0 0;align-self:center">Pendências operacionais:</span>' + flagChips.map(function (c) { return '<span class="chip' + (devF.flag === c[0] ? ' chip-on' : '') + '" data-ocflag="' + c[0] + '">' + c[1] + '</span>'; }).join('') + '</div>' +
      istChips +
      '<div class="toolbar2" style="margin-top:8px"><input class="input sm" id="devq" style="width:260px" placeholder="Buscar ID da devolução, pedido, produto ou SKU…" value="' + esc(devF.search) + '">' +
      '<select class="select sm" id="devsort"><option value="recent"' + (devF.sort === 'recent' ? ' selected' : '') + '>Mais recentes</option><option value="impact"' + (devF.sort === 'impact' ? ' selected' : '') + '>Maior impacto</option></select></div>' +
      novoNote + demoNote + '<div class="count-line"><b>' + nn(list.length) + '</b> casos' + (selIds.length ? ' · <b>' + nn(selIds.length) + '</b> selecionado(s)' : '') + '</div>' + bulkBar +
      '<div class="panel"><div class="table-wrap"><table class="report"><thead><tr><th style="width:34px"><input type="checkbox" id="devselall"' + (allChecked ? ' checked' : '') + ' title="Selecionar os desta página"></th><th>Pedido / Devolução</th><th>Tipo</th><th>Produto</th><th>Motivo</th><th>Etapa</th><th>Próxima ação</th><th>Status Shopee</th><th>Status interno</th><th>Recebimento</th><th>Valor</th><th>Ação</th></tr></thead><tbody>' +
      slice.map(function (o) { var it = (o.items || [])[0] || {}; var prod = (it.productName || '—') + (it.variationName ? ' · ' + it.variationName : '') + ((o.items || []).length > 1 ? ' (+' + (o.items.length - 1) + ')' : ''); var rl = REC_LABEL[recGroup(o)]; var pa = casoProximaAcao(o);
        var chk = o.isDemo ? '<span class="footnote" style="margin:0">—</span>' : '<input type="checkbox" class="devrowsel" data-selid="' + esc(o.id) + '"' + (devSel[o.id] ? ' checked' : '') + '>';
        var istCell = o.isDemo ? '<span class="pill st-int">' + esc(istLabel(o.internalStatus)) + '</span>' : '<select class="select sm devinlinest" data-inlid="' + esc(o.id) + '" style="min-width:150px">' + Object.keys(ISTMAP).map(function (k) { return '<option value="' + k + '"' + (o.internalStatus === k ? ' selected' : '') + '>' + ISTMAP[k] + '</option>'; }).join('') + '</select>';
        return '<tr' + (o.isDemo ? ' style="background:#fff8ef"' : (devSel[o.id] ? ' style="background:var(--brand-soft,#f2f5ff)"' : '')) + '><td>' + chk + '</td><td class="mono">' + (casoNovoRetorno(o) ? '<span class="tag" style="background:#8a5cf6;color:#fff">🟣</span> ' : '') + esc(o.orderId || '—') + (o.returnId ? '<div class="footnote" style="margin:0">' + esc(o.returnId) + '</div>' : '') + '</td><td>' + esc(TYPE_LABELS[o.type] || '—') + (o.isDemo ? ' <span class="tag warn">demo</span>' : '') + '</td><td class="cell-text">' + esc(prod) + '<div class="footnote" style="margin:0">' + esc(it.sku || '—') + '</div></td><td class="cell-text">' + esc(casoMotivo(o)) + '</td><td class="cell-text"><span class="tag ' + (pa.jornada === 'BAIXADA' ? 'ok' : pa.jornada === 'REJEITADA' ? 'neutral' : pa.jornada === 'ACAO_NECESSARIA' ? 'warn' : 'info') + '">' + esc(pa.label) + '</span></td><td class="cell-text">' + esc(pa.text) + '</td><td class="cell-text"><span class="tag ' + (normStatus(o.status).indexOf('disputa') >= 0 ? 'info' : 'neutral') + '">' + esc(statusLabel(o.status)) + '</span>' + prazoBadge(o) + '</td><td>' + istCell + '</td><td><span class="tag ' + rl[1] + '">' + rl[0] + '</span></td><td class="nowrap">' + brl(o.requested) + '</td><td><button class="btn-sm primary" data-oc="' + esc(o.id) + '">Abrir</button></td></tr>'; }).join('') +
      '</tbody></table></div></div>' + (pages > 1 ? '<div style="display:flex;gap:8px;justify-content:flex-end;align-items:center"><button class="btn-sm" id="devprev"' + (devPage <= 1 ? ' disabled' : '') + '>Anterior</button><span class="footnote" style="margin:0">página ' + devPage + ' de ' + pages + '</span><button class="btn-sm" id="devnext"' + (devPage >= pages ? ' disabled' : '') + '>Próxima</button></div>' : '');
  }
  function bulkApplyDev(selIds, patch, ownerName) {
    var changed = []; var labels = [];
    if (patch.internalStatus) labels.push('status → ' + istLabel(patch.internalStatus));
    if (patch.responsibility) labels.push('responsabilidade → ' + DEV.RESPONSIBILITY[patch.responsibility]);
    if (patch.priority) labels.push('prioridade → ' + DEV.PRIORITY[patch.priority]);
    if (ownerName) labels.push('responsável → ' + ownerName);
    selIds.forEach(function (id) { var o = occ.find(function (x) { return x.id === id && !x.isDemo; }); if (!o) return;
      Object.keys(patch).forEach(function (k) { if (patch[k]) o[k] = patch[k]; });
      if (ownerName) o.ownerName = ownerName;
      addActivity(o, 'BULK', { message: 'Edição em massa: ' + labels.join(' · '), userName: 'Operador' });
      changed.push(o); });
    return putMany('occ', changed).then(function () { return changed.length; });
  }
  function openManageStatus() {
    var d = document.createElement('div'); d.className = 'drawer'; var panel = document.createElement('div'); panel.className = 'drawer-panel'; panel.style.width = '520px'; panel.style.maxWidth = '96vw';
    d.appendChild(panel); d.onclick = function (e) { if (e.target === d) d.remove(); }; document.body.appendChild(d);
    function draw() {
      var fixed = Object.keys(DEV.INTERNAL_STATUS).map(function (k) { return '<div class="fin-line"><span>' + esc(DEV.INTERNAL_STATUS[k]) + '</span><span class="footnote" style="margin:0">fixo</span></div>'; }).join('');
      var custom = devCustomStatus.length ? devCustomStatus.map(function (s, i) { return '<div class="fin-line"><span>' + esc(s.label) + ' <span class="tag info">personalizado</span></span><button class="btn-sm" data-delst="' + i + '">Remover</button></div>'; }).join('') : '<div class="footnote">Nenhum status personalizado ainda.</div>';
      panel.innerHTML = '<div class="dh"><div><b>Gerenciar status internos</b></div><button class="x">&times;</button></div><div class="dbd">' +
        callout('', 'Como funciona', 'Os status <b>fixos</b> são usados por automações (recebimento, disputa) e não podem ser removidos. Crie <b>status personalizados</b> para o fluxo da sua operação — eles aparecem em Casos (linha, filtro e ações em massa) e na ficha.') +
        '<div class="panel"><div class="ph"><h3>Status fixos</h3></div><div class="pb">' + fixed + '</div></div>' +
        '<div class="panel"><div class="ph"><h3>Personalizados</h3></div><div class="pb">' + custom + '<div style="display:flex;gap:8px;margin-top:10px"><input class="input sm" id="newst" style="flex:1" placeholder="Nome do novo status (ex.: Aguardando NF)"><button class="btn-sm primary" id="addst">Adicionar</button></div></div></div>' +
        '</div>';
      panel.querySelector('.x').onclick = function () { d.remove(); };
      panel.querySelector('#addst').onclick = function () {
        var v = (panel.querySelector('#newst').value || '').trim(); if (!v) return;
        var key = istSlug(v); var map = internalStatusMap();
        if (map[key] || Object.keys(DEV.INTERNAL_STATUS).indexOf(key) >= 0) { toast('Já existe', 'Um status com esse nome já existe.', true); return; }
        devCustomStatus.push({ key: key, label: v });
        saveDevSettings().then(function () { draw(); render(); toast('Status criado', v); });
      };
      panel.querySelectorAll('[data-delst]').forEach(function (b) { b.onclick = function () {
        var i = +b.dataset.delst; var s = devCustomStatus[i]; if (!s) return;
        var inUse = occ.filter(function (o) { return !o.isDemo && o.internalStatus === s.key; }).length;
        if (inUse && !confirm(inUse + ' caso(s) usam "' + s.label + '". Ao remover, eles voltam para "Nova". Continuar?')) return;
        if (inUse) { var ch = []; occ.forEach(function (o) { if (!o.isDemo && o.internalStatus === s.key) { o.internalStatus = 'NOVA'; ch.push(o); } }); putMany('occ', ch); }
        devCustomStatus.splice(i, 1);
        saveDevSettings().then(function () { draw(); render(); toast('Status removido', s.label); });
      }; });
    }
    draw();
  }
  function bindDevOcc() {
    var q = document.getElementById('devq'); if (q) { var t; q.oninput = function () { clearTimeout(t); t = setTimeout(function () { var v = q.value; devF.search = v; devPage = 1; render(); var el = document.getElementById('devq'); if (el) { el.focus(); el.value = v; el.setSelectionRange(v.length, v.length); } }, 220); }; }
    app.querySelectorAll('[data-octype]').forEach(function (c) { c.onclick = function () { devF.type = c.dataset.octype; devF.status = ''; devF.jornada = ''; devF.motivo = ''; devPage = 1; render(); }; });
    app.querySelectorAll('[data-ocfase]').forEach(function (c) { c.onclick = function () { devF.fase = c.dataset.ocfase; devF.status = ''; devF.jornada = ''; devF.motivo = ''; devPage = 1; render(); }; });
    app.querySelectorAll('[data-ocstatus]').forEach(function (c) { c.onclick = function () { devF.status = c.dataset.ocstatus; devPage = 1; render(); }; });
    app.querySelectorAll('[data-ocjorn]').forEach(function (c) { c.onclick = function () { devF.jornada = c.dataset.ocjorn; devPage = 1; render(); }; });
    app.querySelectorAll('[data-ocmotivo]').forEach(function (c) { c.onclick = function () { devF.motivo = c.dataset.ocmotivo; devPage = 1; render(); }; });
    app.querySelectorAll('[data-ocflag]').forEach(function (c) { c.onclick = function () { devF.flag = c.dataset.ocflag; devPage = 1; render(); }; });
    app.querySelectorAll('[data-ocist]').forEach(function (c) { c.onclick = function () { var k = c.dataset.ocist; devF.internalStatus = ''; if (!k) { devF.istSet = {}; } else { devF.istSet = devF.istSet || {}; devF.istSet[k] = !devF.istSet[k]; } devPage = 1; render(); }; });
    var mg = app.querySelector('[data-ocmanage]'); if (mg) mg.onclick = function () { openManageStatus(); };
    var so = document.getElementById('devsort'); if (so) so.onchange = function () { devF.sort = so.value; render(); };
    var pv = document.getElementById('devprev'); if (pv) pv.onclick = function () { if (devPage > 1) { devPage--; render(); } };
    var nx = document.getElementById('devnext'); if (nx) nx.onclick = function () { devPage++; render(); };
    // seleção múltipla
    app.querySelectorAll('.devrowsel').forEach(function (c) { c.onchange = function () { if (c.checked) devSel[c.dataset.selid] = true; else delete devSel[c.dataset.selid]; render(); }; });
    var sa = document.getElementById('devselall'); if (sa) sa.onchange = function () { app.querySelectorAll('.devrowsel').forEach(function (c) { if (sa.checked) devSel[c.dataset.selid] = true; else delete devSel[c.dataset.selid]; }); render(); };
    // edição inline de status interno
    app.querySelectorAll('.devinlinest').forEach(function (s) { s.onchange = function () { var o = occ.find(function (x) { return x.id === s.dataset.inlid && !x.isDemo; }); if (!o) return; var prev = o.internalStatus; o.internalStatus = s.value; addActivity(o, 'STATUS', { field: 'internalStatus', oldValue: prev, newValue: s.value, message: 'Status interno → ' + istLabel(s.value), userName: 'Operador' }); putMany('occ', [o]).then(function () { toast('Status atualizado', istLabel(s.value)); }); }; });
    // ações em massa
    var ba = document.getElementById('blkapply'); if (ba) ba.onclick = function () {
      var selIds = Object.keys(devSel).filter(function (id) { return devSel[id]; });
      var patch = { internalStatus: (document.getElementById('blkist') || {}).value || '', responsibility: (document.getElementById('blkresp') || {}).value || '', priority: (document.getElementById('blkprio') || {}).value || '' };
      var owner = ((document.getElementById('blkowner') || {}).value || '').trim();
      if (!patch.internalStatus && !patch.responsibility && !patch.priority && !owner) { toast('Nada a aplicar', 'Escolha ao menos um campo para alterar.', true); return; }
      bulkApplyDev(selIds, patch, owner).then(function (n) { devSel = {}; render(); toast('Aplicado', n + ' caso(s) atualizados'); });
    };
    var bc = document.getElementById('blkclear'); if (bc) bc.onclick = function () { devSel = {}; render(); };
  }
  function devMotivos() {
    var list = occInPeriod(); if (!list.length) return secHead('ANÁLISE · MOTIVOS', 'Por que os clientes devolvem?', '') + emptyBox('Sem ocorrências no período.');
    var agg = computeOrderAgg(); var d = devMotivosData(list);
    var chart = d.length ? chartCard('Perda por motivo', legendSwatch([['Perda R$', '#d13b3b']]), svgHBars(d.slice(0, 8).map(function (r) { return { label: r.reason, value: r.loss, color: '#d13b3b' }; }), { fmt: function (v) { return brl(v); } })) : '';
    var giveups = d.reduce(function (s, r) { return s + r.giveups; }, 0); var giveRate = list.length ? r2(giveups / list.length * 100) : 0;
    var head = secHead('ANÁLISE · MOTIVOS', 'Por que os clientes estão devolvendo?', 'Cada motivo do relatório da Shopee — casos, perda e taxa de desistência. Clique num motivo para ver os produtos.');
    var hide = callout('', 'Custo escondido: ' + pct(giveRate) + ' desistem sozinhos', 'Um comprador que abre e depois cancela a solicitação não gera perda financeira, mas consome atendimento e reputação. São <b>' + nn(giveups) + '</b> casos no período.');
    var thPct = agg.orders ? '<th>% dos pedidos</th>' : '';
    return head + kstrip([
      { l: 'Motivos distintos', v: nn(d.length), cls: 'blue' },
      { l: 'Motivo que mais custa', v: d.length ? esc((d[0].reason || '—').slice(0, 18)) : '—', cls: 'red', s: d.length ? brl(d[0].loss) : '' },
      { l: 'Desistência do comprador', v: pct(giveRate), cls: 'amber', s: nn(giveups) + ' casos' },
    ]) + chart + hide +
      '<div class="panel"><div class="ph"><h3>Motivos, um a um</h3><span class="footnote" style="margin:0">clique para ver os produtos</span></div><div class="table-wrap"><table class="report"><thead><tr><th>Motivo</th><th>Casos</th>' + thPct + '<th>Desist.</th><th>Taxa desist.</th><th>Perda</th><th>Em risco</th><th>Ticket médio</th><th>Retornou</th></tr></thead><tbody>' +
      d.map(function (r) { var tdPct = agg.orders ? '<td>' + pct(r2(r.cases / agg.orders * 100)) + '</td>' : ''; return '<tr class="rowlink" title="Ver produtos deste motivo" data-go="analises" data-asub="produtos" data-reason="' + esc(r.reason) + '"><td><b>' + esc(r.reason) + '</b></td><td>' + nn(r.cases) + '</td>' + tdPct + '<td>' + nn(r.giveups) + '</td><td>' + pct(r.giveupRate) + '</td><td>' + brl(r.loss) + '</td><td>' + brl(r.atRisk) + '</td><td>' + brl(r.avgTicket) + '</td><td>' + nn(r.returned) + '</td></tr>'; }).join('') + '</tbody></table></div></div>';
  }
  function devCriticos() {
    var full = occInPeriod();
    if (!full.length) return secHead('ANÁLISE · PRODUTOS', 'Quais produtos dão mais problema?', '') + emptyBox('Sem ocorrências no período.');
    var list = analiseReason ? full.filter(function (o) { return (o.reason || '(sem motivo informado)').trim() === analiseReason; }) : full;
    var d = devCriticosData(list);
    var head = secHead('ANÁLISE · PRODUTOS', 'Quais produtos estão dando problema?', 'Produto e variação primeiro; o SKU é o detalhe. Perda, ocorrências e causa dominante.');
    var banner = analiseReason ? callout('', 'Filtrando por motivo: ' + esc(analiseReason), '<button class="link-btn" data-go="analises" data-asub="produtos" data-reason="">limpar filtro</button>') : '';
    // agrega por PRODUTO (não por SKU) para o gráfico — mais legível para o gestor
    var byProd = {}; d.forEach(function (s) { var k = s.product || s.sku; var p = byProd[k] = byProd[k] || { label: k, value: 0 }; p.value += s.loss; });
    var prodBars = Object.values(byProd).sort(function (a, b) { return b.value - a.value; }).slice(0, 8);
    var chart = prodBars.length ? chartCard('Perda por produto (top ' + prodBars.length + ')', legendSwatch([['Perda R$', '#2b4bd6']]), svgHBars(prodBars, { color: '#2b4bd6', fmt: function (v) { return brl(v); } })) : '';
    return head + banner + chart +
      '<div class="panel"><div class="ph"><h3>Produtos & SKUs, um a um</h3></div><div class="table-wrap"><table class="report"><thead><tr><th>Produto</th><th>SKU</th><th>Ocor.</th><th>Perda</th><th>Custo adic.</th><th>Recuperado</th><th>% da perda</th><th>Causa dominante</th></tr></thead><tbody>' + (d.length ? d.map(function (s) { return '<tr><td>' + esc((s.product || '—').slice(0, 40)) + '</td><td class="mono footnote" style="margin:0">' + esc(s.sku) + (s.linked ? '' : ' <span class="tag warn">não vinc.</span>') + '</td><td>' + nn(s.occ) + '</td><td><b>' + brl(s.loss) + '</b></td><td>' + brl(s.additional) + '</td><td>' + brl(s.recovered) + '</td><td><span class="tag">' + pct(s.share) + '</span></td><td>' + esc(s.dominant) + '</td></tr>'; }).join('') : '<tr><td colspan="8" class="empty">Nenhum produto para este filtro.</td></tr>') + '</tbody></table></div></div>';
  }
  // Categorias clicáveis do Financeiro → drill-down para as ocorrências que compõem o valor.
  var FIN_CATS = {
    refunded: { label: 'Reembolso pago', cls: 'red', val: function (o) { return o.impact.refundedTotal || 0; } },
    additional: { label: 'Custos adicionais', cls: 'amber', val: function (o) { return o.impact.additionalCostTotal || 0; } },
    compensation: { label: 'Compensação Shopee', cls: 'green', val: function (o) { return o.compensation || 0; } },
    disputeRec: { label: 'Recuperação de disputa', cls: 'green', val: function (o) { return o.disputeRecovered || 0; } },
    net: { label: 'Impacto líquido conhecido', cls: 'red', val: function (o) { return occEffectiveLoss(o); } },
    atRisk: { label: 'Em risco', cls: 'amber', val: function (o) { return o.exposure.atRisk || 0; } },
  };
  // Sub-abas do Financeiro (§Financeiro real): impacto das devoluções · taxas da venda · a receber da Shopee · conciliação.
  function devFinanceiro() {
    var subs = [['impacto', 'Impacto das devoluções'], ['taxas', 'Taxas da venda'], ['areceber', 'A Receber da Shopee'], ['concil', 'Conciliação'], ['pedidos', 'Pedido a Pedido']];
    if (['impacto', 'taxas', 'areceber', 'concil', 'pedidos'].indexOf(finSub) < 0) finSub = 'impacto';
    var inner = finSub === 'taxas' ? devFinTaxas() : finSub === 'areceber' ? devFinAReceber() : finSub === 'concil' ? devFinConcil() : finSub === 'pedidos' ? devFinPedidoAPedido() : devFinImpacto();
    return '<div class="subtabs" style="margin-bottom:12px">' + subs.map(function (x) { return '<div class="subtab' + (finSub === x[0] ? ' active' : '') + '" data-finsub="' + x[0] + '">' + x[1] + '</div>'; }).join('') + '</div><div>' + inner + '</div>';
  }
  // Financeiro = auditoria PEDIDO A PEDIDO (granular). Minha Renda = visão gerencial/consolidada.
  // Mesma missão que a Ficha 360, em formato de tabela — cada linha abre a mesma ficha. §13/§18.
  function devFinPedidoAPedido() {
    var head = secHead('FINANCEIRO · PEDIDO A PEDIDO', 'Tabela completa por pedido', 'Auditoria detalhada — cada pedido com sua composição financeira. Minha Renda mostra a visão gerencial consolidada; aqui é o detalhe, linha a linha. Clique em qualquer pedido para abrir a Ficha Financeira 360º.');
    var list = pedidosInPeriod(); if (!list.length) return head + emptyBox('Nenhum pedido no período.');
    var profitOf = mrOrderProfitEngine(); var mr = mrEngine(); var mrByOrder = {}; mr.orders.forEach(function (r) { mrByOrder[r.orderId] = r; });
    var affEng = affEngine(); var acByOrder = {}; acelera.forEach(function (r) { (acByOrder[r.pedido] = acByOrder[r.pedido] || []).push(r); });
    var renda = walletRendaByOrder();
    var slice = list.slice(0, 300);
    var rows = slice.map(function (o) {
      var f = orderFinance(o); var it = o.items[0] || {}; var mrRow = mrByOrder[o.id]; var affRow = affEng.orderMap[o.id]; var acRecs = acByOrder[o.id]; var st = pedidoConciliacaoStatus(o.id);
      var vendaC = Math.round(f.revenue * 100);
      var custoC = f.costPending ? null : Math.round((f.productCostTotal || 0) * 100);
      var taxaTransC = mrRow ? mrRow.transacao : -Math.round((o.transactionFee || 0) * 100);
      var comissaoC = mrRow ? mrRow.comissao : -Math.round((o.commissionNet || 0) * 100);
      var afilC = mrRow ? mrRow.afiliado : (affRow ? -Math.round((affRow.comAff + affRow.svcFee) / 100) : null);
      var acC = acRecs ? -Math.abs(acRecs.reduce(function (s, r) { return s + r.taxa; }, 0)) : null;
      // Usa o resultado confirmado da baixa quando existir (§22-24), senão o provisório.
      var occHere = occ.filter(function (x) { return !x.isDemo && x.orderId === o.id; }); var devC = occHere.length ? -Math.round(occHere.reduce(function (s, x) { return s + occResultadoDevolucao(x).perda; }, 0) * 100) : null;
      var outrosC = mrRow ? (mrRow.freteParceiro + mrRow.descontoFrete + mrRow.envioReverso + mrRow.cupom + mrRow.pix + mrRow.reembolso) : null;
      var receitaLiqC = mrRow ? mrRow.liberado : (vendaC + Math.round((f.marketplaceFeesTotal || 0) * -100));
      var p = profitOf(o); var lucroC = p.known ? p.lucro : null; var margem = (lucroC != null && vendaC) ? r2(lucroC / vendaC * 100) : null;
      var recWallet = renda[o.id]; var recebidoC = recWallet ? Math.round(recWallet.sum * 100) : null;
      var difC = (receitaLiqC != null && recebidoC != null) ? receitaLiqC - recebidoC : null;
      var stTag = st.code === 'CONCILIADO' ? 'ok' : st.code === 'PARCIAL' ? 'warn' : st.code === 'DIVERGENTE' ? 'warn' : 'neutral';
      return '<tr class="rowlink" data-goped360="' + esc(o.id) + '"><td class="nowrap">' + dbr(o.createdAt) + '</td><td class="mono">' + esc(o.id) + '</td><td class="cell-text">' + esc((it.sku || '—')) + '</td><td class="nowrap">' + brlC(vendaC) + '</td><td class="nowrap">' + (custoC != null ? brlC(custoC) : '<span class="tag warn">pendente</span>') + '</td><td class="nowrap">' + brlC(taxaTransC) + '</td><td class="nowrap">' + brlC(comissaoC) + '</td><td class="nowrap">' + (afilC != null ? brlC(afilC) : '—') + '</td><td class="nowrap">' + (acC != null ? brlC(acC) : '—') + '</td><td class="nowrap">' + (devC != null ? brlC(devC) : '—') + '</td><td class="nowrap">' + (outrosC != null ? brlC(outrosC) : '—') + '</td><td class="nowrap">' + (receitaLiqC != null ? brlC(receitaLiqC) : '—') + '</td><td class="nowrap ' + (lucroC != null && lucroC < 0 ? 'neg' : 'pos') + '">' + (lucroC != null ? '<b>' + brlC(lucroC) + '</b>' : '<span class="tag warn">custo pendente</span>') + '</td><td>' + (margem != null ? pct(margem) : '—') + '</td><td class="nowrap">' + (recebidoC != null ? brlC(recebidoC) : '—') + '</td><td class="nowrap">' + (difC != null ? brlC(difC) : '—') + '</td><td><span class="tag ' + stTag + '">' + st.label + '</span></td></tr>';
    }).join('');
    return head + '<div class="count-line"><b>' + nn(list.length) + '</b> pedidos' + (list.length > 300 ? ' · mostrando os 300 mais recentes' : '') + '</div>' +
      '<div class="panel"><div class="table-wrap"><table class="report"><thead><tr><th>Data</th><th>Pedido</th><th>SKU</th><th>Venda Bruta</th><th>Custo Produto</th><th>Tx. Transação</th><th>Comissão</th><th>Afiliado</th><th>Acelera</th><th>Devolução</th><th>Outros</th><th>Receita Líquida</th><th>Lucro</th><th>Margem</th><th>Recebido</th><th>Diferença</th><th>Conciliação</th></tr></thead><tbody>' + rows + '</tbody></table></div></div>';
  }
  // Taxas que a Shopee cobra por venda e o que acontece com elas quando há devolução. Fontes: Pedidos (taxas) × Devoluções.
  function orderFeeBreakdown(o) { return { comissao: r2(o.commissionNet || 0), servico: r2(o.serviceFeeNet || 0), transacao: r2(o.transactionFee || 0), freteRev: r2(o.reverseShippingFee || 0), total: r2((o.commissionNet || 0) + (o.serviceFeeNet || 0) + (o.transactionFee || 0) + (o.reverseShippingFee || 0)) }; }
  function devFinTaxas() {
    var head = secHead('FINANCEIRO · TAXAS DA VENDA', 'O que a Shopee cobra — e o que acontece na devolução', 'Cruzamos cada devolução com as taxas reais do pedido em Pedidos. O que não existe na fonte é declarado, não estimado.');
    if (!orders.length) return head + emptyBox('Importe os Pedidos (Order.all…) para conectar as devoluções às taxas reais de cada venda.');
    var list = occInPeriod();
    var withOrder = [], noOrder = 0;
    list.forEach(function (o) { var ord = o.orderId ? orders.find(function (x) { return x.id === o.orderId; }) : null; if (ord) withOrder.push({ o: o, ord: ord, f: orderFeeBreakdown(ord) }); else noOrder++; });
    var sum = { req: 0, comissao: 0, servico: 0, transacao: 0, freteRev: 0, total: 0 };
    withOrder.forEach(function (x) { sum.req += x.o.requested || 0; sum.comissao += x.f.comissao; sum.servico += x.f.servico; sum.transacao += x.f.transacao; sum.freteRev += x.f.freteRev; sum.total += x.f.total; });
    Object.keys(sum).forEach(function (k) { sum[k] = r2(sum[k]); });
    var strip = kstrip([
      { l: 'Devoluções com pedido', v: nn(withOrder.length), cls: 'blue', s: noOrder ? nn(noOrder) + ' sem pedido importado' : 'todas conectadas' },
      { l: 'Reembolso solicitado', v: brl(sum.req), cls: 'red' },
      { l: 'Taxas do pedido (total)', v: brl(sum.total), cls: 'amber', s: 'comissão+serviço+transação+frete rev.' },
      { l: 'Comissão', v: brl(sum.comissao), cls: 'amber' },
      { l: 'Frete reverso', v: brl(sum.freteRev), cls: 'amber' },
    ]);
    var gaps = callout('warn', 'O que ainda não temos fonte para afirmar (não inventamos)',
      '<div class="fin-line"><span><b>Estorno de taxas na devolução</b> — a Shopee às vezes devolve a comissão/taxa quando reembolsa um pedido.</span><span class="tag warn">AGUARDANDO FONTE</span></div>' +
      '<div class="footnote" style="margin:2px 0 8px">Nenhuma coluna dos relatórios atuais informa esse estorno por pedido. Quando ele existe, aparece como <b>crédito no extrato da carteira</b> — a aba <b>Conciliação</b> aponta candidatos, mas não confirmamos por caso.</div>' +
      '<div class="fin-line"><span><b>Comissão de afiliado</b> e <b>Antecipação de recebíveis</b></span><span class="tag warn">NÃO DISPONÍVEL</span></div>' +
      '<div class="footnote" style="margin:2px 0 0">Não há coluna para esses valores nas planilhas importadas. Ficam como lacuna explícita — nunca como “R$ 0”.</div>');
    var noOrderNote = noOrder ? callout('', nn(noOrder) + ' devolução(ões) sem o pedido em Pedidos', 'Para essas, as taxas da venda são desconhecidas até importar o pedido correspondente. Elas não entram nos totais acima.') : '';
    var rows = withOrder.sort(function (a, b) { return b.f.total - a.f.total; }).slice(0, 300).map(function (x) {
      var it = (x.o.items || [])[0] || {};
      return '<tr><td class="mono">' + esc(x.o.returnId || '—') + '<div class="footnote" style="margin:0">' + esc(x.o.orderId || '') + '</div></td><td class="cell-text">' + esc(it.productName || '—') + '</td><td class="nowrap">' + brl(x.o.requested) + '</td><td class="nowrap">' + brl(x.f.comissao) + '</td><td class="nowrap">' + brl(x.f.servico) + '</td><td class="nowrap">' + brl(x.f.transacao) + '</td><td class="nowrap">' + brl(x.f.freteRev) + '</td><td class="nowrap"><b>' + brl(x.f.total) + '</b></td><td><span class="tag warn">aguardando fonte</span></td><td><button class="btn-sm" data-oc="' + esc(x.o.id) + '">Abrir</button></td></tr>';
    }).join('');
    var table = '<div class="panel"><div class="ph"><h3>Taxas por devolução</h3><span class="footnote" style="margin:0">taxas reais do pedido · estorno pendente de fonte</span></div><div class="table-wrap"><table class="report"><thead><tr><th>Devolução / Pedido</th><th>Produto</th><th>Reembolso</th><th>Comissão</th><th>Serviço</th><th>Transação</th><th>Frete rev.</th><th>Taxas total</th><th>Estorno</th><th></th></tr></thead><tbody>' + (rows || '<tr><td colspan="10" class="empty">Nenhuma devolução com pedido importado no período.</td></tr>') + '</tbody></table></div></div>';
    return head + strip + gaps + noOrderNote + table;
  }
  // A Receber da Shopee: cruza Pedidos (o que deveria pingar) × Carteira (renda efetivamente creditada). Sem prazo oficial → "há X dias", nunca "atrasado".
  function walletRendaByOrder() { var map = {}; wallet.forEach(function (t) { if (t.category === 'RENDA' && t.amount > 0 && t.orderId) { var g = map[t.orderId] = map[t.orderId] || { sum: 0, lines: 0, last: '' }; g.sum = r2(g.sum + t.amount); g.lines++; if ((t.date || '') > g.last) g.last = t.date; } }); return map; }
  function daysSince(d) { if (!d) return null; var x = new Date(d); if (isNaN(x)) return null; return Math.max(0, Math.floor((Date.now() - x.getTime()) / 864e5)); }
  function devFinAReceber() {
    var head = secHead('FINANCEIRO · A RECEBER DA SHOPEE', 'O que já entrou e o que ainda falta pingar', 'Cruzamos os pedidos com a renda creditada no extrato da carteira. Sem o prazo oficial de liberação da Shopee, mostramos “há X dias”, nunca “atrasado”.');
    if (!orders.length) return head + emptyBox('Importe os Pedidos para saber o que deveria ser recebido.');
    if (!wallet.length) return head + callout('warn', 'Importe o extrato da carteira', 'A conciliação de recebimentos precisa do relatório de transações do saldo Shopee (módulo <b>Saldo da Carteira</b>). Sem ele, não dá para dizer o que já pingou — e não vamos supor.');
    var renda = walletRendaByOrder();
    var list = pedidosInPeriod();
    var recebidos = [], areceber = [];
    list.forEach(function (o) { var r = renda[o.id]; var val = o.totalAmount || o.grandTotal || 0; if (r && r.sum > 0) recebidos.push({ o: o, r: r, val: val }); else areceber.push({ o: o, val: val, dias: daysSince(o.createdAt) }); });
    var totRecebido = r2(recebidos.reduce(function (s, x) { return s + x.r.sum; }, 0));
    var totAReceberVal = r2(areceber.reduce(function (s, x) { return s + x.val; }, 0));
    // renda na carteira sem pedido importado (dedup: por orderId)
    var semPedido = 0, semPedidoVal = 0; Object.keys(renda).forEach(function (oid) { if (!orders.find(function (x) { return x.id === oid; })) { semPedido++; semPedidoVal += renda[oid].sum; } });
    var strip = kstrip([
      { l: 'Pedidos no período', v: nn(list.length), cls: 'blue' },
      { l: 'Já recebidos (carteira)', v: nn(recebidos.length), cls: 'green', s: brl(totRecebido) + ' creditados' },
      { l: 'Ainda sem renda', v: nn(areceber.length), cls: 'amber', s: brl(totAReceberVal) + ' em valor de pedido' },
      { l: 'Renda sem pedido', v: nn(semPedido), cls: semPedido ? 'red' : 'green', s: brl(r2(semPedidoVal)) },
    ]);
    var honesty = callout('', 'Como ler estes números (com honestidade)', 'O <b>valor de pedido</b> é o total da venda, não o líquido exato que a Shopee libera (o líquido depende de taxas e de estornos que não temos por pedido). Por isso comparamos <b>presença</b> de renda na carteira, não centavo a centavo. Vários créditos do mesmo pedido são somados (dedup por pedido).');
    var agingRow = function (x) { var it = (x.o.items || [])[0] || {}; var dias = x.dias; var tag = dias == null ? '' : (dias > 30 ? ' <span class="tag warn">há ' + dias + ' dias</span>' : ' <span class="tag">há ' + dias + ' dias</span>'); return '<tr><td class="mono">' + esc(x.o.id) + '</td><td class="cell-text">' + esc(it.productName || '—') + '</td><td>' + esc(S.pedidos.labels[x.o.normalizedStatus] || x.o.orderStatus || '—') + '</td><td class="nowrap">' + brl(x.val) + '</td><td class="nowrap">' + dbr(x.o.createdAt) + tag + '</td></tr>'; };
    var arRows = areceber.sort(function (a, b) { return (b.dias || 0) - (a.dias || 0); }).slice(0, 300).map(agingRow).join('');
    var arTable = '<div class="panel"><div class="ph"><h3>Ainda sem renda na carteira</h3><span class="footnote" style="margin:0">ordenado por tempo de espera</span></div><div class="table-wrap"><table class="report"><thead><tr><th>Pedido</th><th>Produto</th><th>Status</th><th>Valor do pedido</th><th>Aberto</th></tr></thead><tbody>' + (arRows || '<tr><td colspan="5" class="empty">Todos os pedidos do período têm renda na carteira. 🎉</td></tr>') + '</tbody></table></div></div>';
    var recRows = recebidos.sort(function (a, b) { return b.r.sum - a.r.sum; }).slice(0, 200).map(function (x) { var it = (x.o.items || [])[0] || {}; return '<tr><td class="mono">' + esc(x.o.id) + '</td><td class="cell-text">' + esc(it.productName || '—') + '</td><td class="nowrap">' + brl(x.val) + '</td><td class="nowrap"><b>' + brl(x.r.sum) + '</b>' + (x.r.lines > 1 ? ' <span class="tag">' + x.r.lines + ' créditos</span>' : '') + '</td><td class="nowrap">' + dbr(x.r.last) + '</td></tr>'; }).join('');
    var recTable = '<details class="panel" style="padding:0"><summary style="cursor:pointer;padding:12px 16px;font-weight:700">Já recebidos (' + nn(recebidos.length) + ') — renda creditada na carteira</summary><div class="table-wrap"><table class="report"><thead><tr><th>Pedido</th><th>Produto</th><th>Valor do pedido</th><th>Recebido (carteira)</th><th>Último crédito</th></tr></thead><tbody>' + (recRows || '<tr><td colspan="5" class="empty">—</td></tr>') + '</tbody></table></div></details>';
    var semPedNote = semPedido ? callout('warn', nn(semPedido) + ' crédito(s) de renda sem pedido importado (' + brl(r2(semPedidoVal)) + ')', 'A carteira registrou renda de pedidos que não estão em Pedidos. Importe o relatório de pedidos correspondente para conciliar. Ver detalhe na aba <b>Conciliação</b>.') : '';
    return head + strip + honesty + arTable + semPedNote + recTable;
  }
  // Conciliação determinística em duas frentes: Pedidos×Renda(carteira) e Devoluções×Débito(carteira). Sem inventar regra.
  function walletDevDebitByOrder() { var map = {}; wallet.forEach(function (t) { if (t.category === 'DEVOLUCAO' && t.amount < 0 && t.orderId) { var g = map[t.orderId] = map[t.orderId] || { sum: 0, lines: 0 }; g.sum = r2(g.sum + t.amount); g.lines++; } }); return map; }
  function devFinConcil() {
    var head = secHead('FINANCEIRO · CONCILIAÇÃO', 'Tudo bate? Pedidos, carteira e devoluções lado a lado', 'Conciliação determinística: o que casa, o que sobra de cada lado. Nenhuma regra financeira é inventada — o que não casa é mostrado para investigação.');
    if (!wallet.length || !orders.length) return head + callout('warn', 'Faltam fontes para conciliar', 'A conciliação cruza <b>Pedidos</b> × <b>extrato da Carteira</b> × <b>Devoluções</b>. Importe ' + (!orders.length ? 'os Pedidos' : '') + (!orders.length && !wallet.length ? ' e ' : '') + (!wallet.length ? 'o extrato da carteira' : '') + ' para começar.');
    var renda = walletRendaByOrder();
    var orderIds = {}; orders.forEach(function (o) { orderIds[o.id] = o; });
    // Frente 1: Pedidos × Renda
    var pedComRenda = 0, pedSemRenda = 0, rendaSemPed = 0, rendaSemPedVal = 0;
    orders.forEach(function (o) { if (renda[o.id]) pedComRenda++; else pedSemRenda++; });
    var rendaSemPedList = [];
    Object.keys(renda).forEach(function (oid) { if (!orderIds[oid]) { rendaSemPed++; rendaSemPedVal += renda[oid].sum; rendaSemPedList.push({ oid: oid, r: renda[oid] }); } });
    // Frente 2: Devoluções × Débito na carteira
    var deb = walletDevDebitByOrder();
    var occByOrder = {}; occ.forEach(function (o) { if (!o.isDemo && o.orderId) occByOrder[o.orderId] = o; });
    var devComDeb = 0, devSemDeb = 0; occInPeriod().forEach(function (o) { if (o.orderId && deb[o.orderId]) devComDeb++; else devSemDeb++; });
    var debSemDev = 0, debSemDevVal = 0, debSemDevList = []; Object.keys(deb).forEach(function (oid) { if (!occByOrder[oid]) { debSemDev++; debSemDevVal += deb[oid].sum; debSemDevList.push({ oid: oid, d: deb[oid] }); } });
    var strip = kstrip([
      { l: 'Pedidos com renda', v: nn(pedComRenda), cls: 'green' },
      { l: 'Pedidos sem renda', v: nn(pedSemRenda), cls: 'amber' },
      { l: 'Renda sem pedido', v: nn(rendaSemPed), cls: rendaSemPed ? 'red' : 'green', s: brl(r2(rendaSemPedVal)) },
      { l: 'Devoluções com débito', v: nn(devComDeb), cls: 'blue' },
      { l: 'Débito sem devolução', v: nn(debSemDev), cls: debSemDev ? 'red' : 'green', s: brl(r2(debSemDevVal)) },
    ]);
    var f1 = '<div class="panel"><div class="ph"><h3>Pedidos × Renda da carteira</h3></div><div class="pb">' +
      '<div class="fin-line"><span>Pedidos com renda creditada</span><b>' + nn(pedComRenda) + '</b></div>' +
      '<div class="fin-line"><span>Pedidos ainda sem renda</span><span><b>' + nn(pedSemRenda) + '</b> <button class="btn-sm" data-finsubgo="areceber">ver</button></span></div>' +
      '<div class="fin-line"><span>Renda na carteira sem pedido importado</span><span class="' + (rendaSemPed ? 'neg' : '') + '"><b>' + nn(rendaSemPed) + '</b> · ' + brl(r2(rendaSemPedVal)) + '</span></div></div>' +
      (rendaSemPedList.length ? '<div class="table-wrap"><table class="report"><thead><tr><th>Pedido (na carteira)</th><th>Renda recebida</th><th>Créditos</th></tr></thead><tbody>' + rendaSemPedList.sort(function (a, b) { return b.r.sum - a.r.sum; }).slice(0, 100).map(function (x) { return '<tr><td class="mono">' + esc(x.oid) + '</td><td class="nowrap"><b>' + brl(x.r.sum) + '</b></td><td>' + nn(x.r.lines) + '</td></tr>'; }).join('') + '</tbody></table></div>' : '') + '</div>';
    var f2 = '<div class="panel"><div class="ph"><h3>Devoluções × Débito na carteira</h3></div><div class="pb">' +
      '<div class="fin-line"><span>Devoluções (período) com débito na carteira</span><b>' + nn(devComDeb) + '</b></div>' +
      '<div class="fin-line"><span>Devoluções sem débito localizado</span><b>' + nn(devSemDeb) + '</b></div>' +
      '<div class="fin-line"><span>Débito de devolução sem caso importado</span><span class="' + (debSemDev ? 'neg' : '') + '"><b>' + nn(debSemDev) + '</b> · ' + brl(r2(debSemDevVal)) + '</span></div></div>' +
      (debSemDevList.length ? '<div class="table-wrap"><table class="report"><thead><tr><th>Pedido (débito na carteira)</th><th>Descontado</th><th>Lançamentos</th></tr></thead><tbody>' + debSemDevList.sort(function (a, b) { return a.d.sum - b.d.sum; }).slice(0, 100).map(function (x) { return '<tr><td class="mono">' + esc(x.oid) + '</td><td class="nowrap neg"><b>' + brl(x.d.sum) + '</b></td><td>' + nn(x.d.lines) + '</td></tr>'; }).join('') + '</tbody></table></div>' : '') + '</div>';
    var note = '<div class="info-banner">Conciliação por <b>ID do pedido</b> (dedup: vários lançamentos do mesmo pedido são somados). Diferenças não são “erros” automáticos — são pontos para investigar: um pedido sem renda pode estar dentro do prazo; um débito sem caso pode ser uma devolução ainda não importada. Nada aqui altera valores.</div>';
    return head + strip + '<div class="split2">' + f1 + f2 + '</div>' + note;
  }
  function devFinImpacto() {
    var list = occInPeriod(); if (!list.length) return emptyBox('Sem ocorrências no período.'); var f = devFinanceiroData(list);
    var card = function (key, valor, sub2) { return '<div class="fcard ' + FIN_CATS[key].cls + '" style="cursor:pointer' + (finDrill === key ? ';outline:2px solid var(--brand)' : '') + '" data-fin="' + key + '"><div class="lbl">' + esc(FIN_CATS[key].label) + '</div><div class="val">' + brl(valor) + '</div>' + (sub2 ? '<div class="footnote" style="margin-top:4px">' + esc(sub2) + '</div>' : '') + '<div class="footnote" style="margin-top:4px">clique p/ detalhar</div></div>'; };
    var head = secHead('FINANCEIRO', 'Quanto isso está nos custando?', 'Custos conhecidos menos recuperações conhecidas. Clique numa categoria para ver as ocorrências que a compõem.');
    var compBars = chartCard('Composição do impacto', legendSwatch([['Custo', '#d13b3b'], ['Recuperação', '#0f9d6b']]), svgHBars([
      { label: 'Reembolso pago', value: f.refunded, color: '#d13b3b' },
      { label: 'Custos adicionais', value: f.additional, color: '#e0662a' },
      { label: 'Compensação Shopee', value: f.compensation, color: '#0f9d6b' },
      { label: 'Recuperação de disputa', value: f.disputeRec, color: '#0f9d6b' },
    ], { fmt: function (v) { return brl(v); } }));
    var cards = head + compBars + '<div class="cards6">' + card('refunded', f.refunded) + card('additional', f.additional, 'frete reverso, retrabalho') + card('compensation', f.compensation) + card('disputeRec', f.disputeRec) + card('net', f.net) + card('atRisk', f.atRisk) + '</div>';
    var drill = '';
    if (finDrill && FIN_CATS[finDrill]) {
      var cat = FIN_CATS[finDrill];
      var rows = list.map(function (o) { return { o: o, v: r2(cat.val(o)) }; }).filter(function (x) { return x.v > 0; }).sort(function (a, b) { return b.v - a.v; });
      drill = '<div class="panel"><div class="ph"><h3>' + esc(cat.label) + ' — ' + nn(rows.length) + ' ocorrência' + (rows.length === 1 ? '' : 's') + ' compõe' + (rows.length === 1 ? '' : 'm') + ' ' + brl(rows.reduce(function (s, x) { return s + x.v; }, 0)) + '</h3><button class="link-btn" id="finclose">fechar</button></div><div class="table-wrap"><table class="report"><thead><tr><th>Pedido</th><th>Produto / SKU</th><th>Motivo</th><th>' + esc(cat.label) + '</th><th></th></tr></thead><tbody>' +
        (rows.length ? rows.slice(0, 200).map(function (x) { var it = (x.o.items || [])[0] || {}; return '<tr><td class="mono">' + esc(x.o.orderId || '—') + '</td><td class="cell-text">' + esc(it.productName || '—') + '<div class="footnote" style="margin:0">' + esc(it.sku || '—') + '</div></td><td class="cell-text">' + esc(x.o.reason || '—') + '</td><td class="nowrap"><b>' + brl(x.v) + '</b></td><td><button class="btn-sm" data-oc="' + esc(x.o.id) + '">Abrir</button></td></tr>'; }).join('') : '<tr><td colspan="5" class="empty">Nada nesta categoria.</td></tr>') +
        '</tbody></table></div></div>';
    }
    return cards + '<div class="info-banner">Impacto líquido = custos conhecidos (reembolso + frete reverso + retrabalho…) − recuperações conhecidas (compensação + recuperação de disputa + valor recuperável). O custo da mercadoria perdida ainda não está disponível — não é estimado.</div>' + drill;
  }
  function bindFinanceiro() {
    app.querySelectorAll('[data-finsub]').forEach(function (c) { c.onclick = function () { finSub = c.dataset.finsub; finDrill = null; render(); }; });
    app.querySelectorAll('[data-finsubgo]').forEach(function (c) { c.onclick = function () { finSub = c.dataset.finsubgo; render(); }; });
    app.querySelectorAll('[data-fin]').forEach(function (c) { c.onclick = function () { finDrill = finDrill === c.dataset.fin ? null : c.dataset.fin; render(); }; });
    var cl = document.getElementById('finclose'); if (cl) cl.onclick = function () { finDrill = null; render(); };
  }
  function devDisputas() {
    var all = occInPeriod();
    // Só é DISPUTA quem tem janela formal de recurso (vinda da Shopee) ou uma disputa já iniciada (§25).
    var list = all.filter(function (o) { return o.hasSellerWindow || (o.disputeStatus && o.disputeStatus !== 'NAO_INICIADA'); });
    var head = secHead('DEFESA', 'Quais casos precisamos recorrer?', 'Somente casos com prazo/possibilidade formal de recurso. Onde a loja usa o canal a tempo, recupera; fora do prazo, perde.');
    if (!list.length) return head + emptyBox('Nenhum caso com prazo de recurso no período. O sistema identifica automaticamente pela coluna "Ação do Vendedor solicitada até" da Shopee.');
    var d = devDisputesData(list);
    var now = new Date(), soon = new Date(now.getTime() + 3 * 864e5);
    var openWindow = function (o) { return !o.disputeDeadline || new Date(o.disputeDeadline) >= now; };
    var actionable = function (o) { return ['RESPONDIDA', 'AGUARDANDO_SHOPEE', 'GANHA', 'PARCIAL', 'PERDIDA', 'PRAZO_PERDIDO', 'CANCELADA'].indexOf(o.disputeStatus) < 0 && openWindow(o) && (o.hasSellerWindow || o.disputeStatus === 'POSSIVEL' || o.disputeStatus === 'EM_PREPARACAO'); };
    var FIL = {
      recorrer: actionable,
      hoje: function (o) { return actionable(o) && o.disputeDeadline && new Date(o.disputeDeadline).toDateString() === now.toDateString(); },
      tresdias: function (o) { return actionable(o) && o.disputeDeadline && new Date(o.disputeDeadline) > now && new Date(o.disputeDeadline) <= soon; },
      respondidas: function (o) { return o.disputeStatus === 'RESPONDIDA'; },
      aguardando: function (o) { return o.disputeStatus === 'AGUARDANDO_SHOPEE'; },
      historico: function (o) { return ['GANHA', 'PARCIAL', 'PERDIDA', 'PRAZO_PERDIDO'].indexOf(o.disputeStatus) >= 0; },
    };
    if (!FIL[dispChip]) dispChip = 'recorrer';
    var chips = [['recorrer', 'Para recorrer'], ['hoje', 'Vence hoje'], ['tresdias', 'Próximos 3 dias'], ['respondidas', 'Respondidas'], ['aguardando', 'Aguardando decisão'], ['historico', 'Histórico']];
    var count = function (k) { return list.filter(FIL[k]).length; };
    var view = list.filter(FIL[dispChip]).sort(function (a, b) { var da = a.disputeDeadline || '9999', db = b.disputeDeadline || '9999'; return da.localeCompare(db); });
    var venc = function (o) { if (!o.disputeDeadline) return '—'; var dl = new Date(o.disputeDeadline); var days = Math.ceil((dl - now) / 864e5); return dbr(o.disputeDeadline) + (days < 0 ? ' <span class="tag warn">vencido</span>' : days === 0 ? ' <span class="tag warn">hoje</span>' : days <= 3 ? ' <span class="tag warn">' + days + 'd</span>' : ''); };
    var isHist = dispChip === 'historico';
    var linha = function (o) { var it = (o.items || [])[0] || {}; return '<tr><td class="nowrap">' + venc(o) + '</td><td class="mono">' + esc(o.returnId || o.id.split(':')[1] || '—') + '</td><td class="mono">' + esc(o.orderId || '—') + '</td><td class="cell-text">' + esc(it.productName || '—') + '</td><td class="cell-text">' + esc(o.reason || '—') + '</td><td class="nowrap">' + brl(o.requested) + '</td><td>' + (isHist ? '<span class="tag ' + (['GANHA', 'PARCIAL'].indexOf(o.disputeStatus) >= 0 ? 'ok' : 'warn') + '">' + DEV.DISPUTE_STATUS[o.disputeStatus] + '</span>' : DEV.DISPUTE_STATUS[o.disputeStatus] || o.disputeStatus) + (isHist && o.disputeRecovered ? '<div class="footnote" style="margin:0">recuperado ' + brl(o.disputeRecovered) + '</div>' : '') + '</td><td><button class="btn-sm primary" data-oc="' + esc(o.id) + '" data-focus="disputa">' + (isHist ? 'Ver' : 'Recorrer / Trabalhar') + '</button></td></tr>'; };
    return head +
      kstrip([
        { l: 'Para recorrer', v: nn(count('recorrer')), cls: 'blue' },
        { l: 'Vencem em 3 dias', v: nn(count('tresdias')), cls: 'amber' },
        { l: 'Respondidas', v: nn(count('respondidas')), cls: 'blue' },
        { l: 'Taxa de vitória', v: (d.ganhas + d.perdidas) ? pct(r2(d.ganhas / (d.ganhas + d.perdidas) * 100)) : '—', cls: 'green' },
        { l: 'Recuperado', v: brl(d.recuperado), cls: 'green' },
      ]) +
      '<div class="chips" style="padding:0 0 10px">' + chips.map(function (c) { return '<span class="chip' + (dispChip === c[0] ? ' chip-on' : '') + '" data-disp2="' + c[0] + '">' + c[1] + ' <b>' + count(c[0]) + '</b></span>'; }).join('') + '</div>' +
      '<div class="panel" style="margin-top:8px"><div class="table-wrap"><table class="report"><thead><tr><th>Prazo</th><th>Devolução</th><th>Pedido</th><th>Produto</th><th>Motivo</th><th>Valor</th><th>Status</th><th>Ação</th></tr></thead><tbody>' +
      (view.length ? view.map(linha).join('') : '<tr><td colspan="8" class="empty">Nenhuma disputa neste filtro.</td></tr>') + '</tbody></table></div></div>' +
      '<div class="footnote">"Recorrer / Trabalhar" abre a ficha direto no bloco Disputa para registrar a resposta e depois o resultado.</div>';
  }
  function bindDisputas() { app.querySelectorAll('[data-disp2]').forEach(function (c) { c.onclick = function () { dispChip = c.dataset.disp2; render(); }; }); }

  // ---- Ficha operacional editável (§8-§19) ----
  function openFicha(id, focusBlock) {
    var o = occ.find(function (x) { return x.id === id; }); if (!o) return;
    // §25: abrir a Ficha marca o "novo retorno" como visto — o badge não persegue o operador depois
    // que ele já revisou o caso, mas o histórico do que mudou continua na Timeline.
    if (casoNovoRetorno(o) || o.needsReview) { o.lastViewedAt = new Date().toISOString(); o.needsReview = false; saveOcc(o); }
    var d = document.createElement('div'); d.className = 'drawer drawer-wide';
    var panel = document.createElement('div'); panel.className = 'drawer-panel'; panel.style.width = '940px'; panel.style.maxWidth = '97vw';
    d.appendChild(panel); d.onclick = function (e) { if (e.target === d) d.remove(); }; document.body.appendChild(d);
    function persist(activity) { if (activity) addActivity(o, activity.kind, activity); recomputeOccImpact(o); saveOcc(o).then(draw); }
    function setField(field, value) { var old = o[field]; if ((old == null ? '' : old) === (value == null ? '' : value)) return; o[field] = value; addActivity(o, 'CHANGE', { field: field, oldValue: old == null ? '' : String(old), newValue: value == null ? '' : String(value), userName: 'Operador' }); recomputeOccImpact(o); saveOcc(o).then(function () { draw(); render(); }); }
    function draw() {
      var ord = orders.find(function (x) { return x.id === o.orderId; });
      var sel = function (label, val, map, field) { return '<label class="fld">' + label + '</label><select class="select" data-set="' + field + '" style="width:100%">' + Object.keys(map).map(function (k) { return '<option value="' + k + '"' + (val === k ? ' selected' : '') + '>' + map[k] + '</option>'; }).join('') + '</select>'; };
      var inp = function (label, val, field, ph) { return '<label class="fld">' + label + '</label><input class="input" data-inp="' + field + '" style="width:100%" value="' + esc(val || '') + '" placeholder="' + (ph || '') + '">'; };
      var it0 = (o.items || [])[0] || {};
      var fam = it0.sku ? (skuCost[it0.sku.toLowerCase()] && skuCost[it0.sku.toLowerCase()].familyName) : null;
      var vendaData = occVendaData(o), aberturaData = occAberturaData(o), diasDepois = occDiasVendaAteAbertura(o);
      var resultado = casoResultado(o); var jornadaTxt = casoProximaAcao(o);
      var prazoTxt = o.disputeDeadline ? prazoTexto(o.disputeDeadline) : null;
      panel.innerHTML = '<div class="dh"><div><b>Ficha — ' + esc(o.orderId || o.id) + '</b> <span class="pill st-int" style="margin-left:8px">' + istLabel(o.internalStatus) + '</span>' + (casoNovoRetorno(o) ? ' <span class="tag" style="background:#8a5cf6;color:#fff">🟣 Novo retorno</span>' : '') + '</div><button class="x">&times;</button></div><div class="dbd">' +
        (function () { var pa = casoProximaAcao(o); return callout(pa.jornada === 'BAIXADA' || pa.jornada === 'REJEITADA' ? 'green' : 'warn', 'Etapa: ' + pa.label, 'Próxima ação: <b>' + esc(pa.text) + '</b>' + (o.needsReview ? ' · <span class="tag warn">⚠ Mudança Shopee detectada — revisar caso</span>' : '')); })() +
        '<div class="split"><div>' +
        // ---- VENDA ----
        '<div class="panel"><div class="ph"><h3>Venda</h3></div><div class="pb">' + kv('Pedido', o.orderId) + kv('Data de criação', dbr(o.orderCreatedAt)) + kv('Data de pagamento', vendaData ? dbr(vendaData) : 'não localizada em Pedidos') + kv('Produto', it0.productName || '—') + kv('SKU', it0.sku || '—') + kv('Família', fam || '—') + kv('Valor', brl(o.requested)) + (ord ? kv('Status do pedido', S.pedidos.labels[ord.normalizedStatus] || ord.orderStatus || '—') : '') + '</div></div>' +
        // ---- DEVOLUÇÃO ----
        '<div class="panel"><div class="ph"><h3>Devolução</h3><span class="tag ' + situacaoCaso(o)[1] + '">' + situacaoCaso(o)[0] + '</span></div><div class="pb">' + kv('Devolução aberta em', aberturaData ? dbr(aberturaData) : 'não informado') + kv('Venda → devolução', diasDepois != null ? diasDepois + ' dias (' + occFaixaDias(diasDepois) + ')' : 'não calculável') + kv('Motivo Shopee', o.reason) + (o.internalCause || o.causeFamily ? kv('Classificação interna', [o.causeFamily, o.internalCause].filter(Boolean).join(' — ')) : '') + kv('Solução', o.resolution || '—') + (o.returnType ? kv('Tipo', o.returnType) : '') + '<label class="fld">Itens</label>' + (o.items || []).map(function (i) { return '<div class="ro" style="margin-bottom:4px"><span class="mono">' + esc(i.sku || '—') + '</span> ' + esc(i.productName || '') + (i.variationName ? ' · ' + esc(i.variationName) : '') + (i.skuLinked ? '' : ' <span class="tag warn">não vinc.</span>') + '</div>'; }).join('') + '</div></div>' +
        // ---- SITUAÇÃO SHOPEE ----
        '<div class="panel"><div class="ph"><h3>Situação Shopee</h3></div><div class="pb">' + kv('Status atual', o.status) + (o.reasonRevised ? kv('Motivo revisado', o.reasonRevised) : '') + (o.sellerNote ? kv('Observação', o.sellerNote) : '') + kv('Ação do vendedor solicitada até', o.disputeDeadline ? dbr(o.disputeDeadline) : 'sem prazo informado') + (prazoTxt ? kv('Tempo restante', prazoTxt) : '') + '</div></div>' +
        '</div><div>' +
        // ---- NOSSA AÇÃO ----
        '<div class="panel"><div class="ph"><h3>Nossa ação</h3></div><div class="pb">' + sel('Status operacional', o.internalStatus, internalStatusMap(), 'internalStatus') + sel('Prioridade', o.priority, DEV.PRIORITY, 'priority') + inp('Responsável', o.ownerName, 'ownerName', 'nome do responsável') + '<label class="fld">Resultado</label><div class="ro">' + esc(RESULTADO_META[resultado] || resultado) + '</div>' + inp('Causa interna', o.internalCause, 'internalCause', 'ex.: proteção insuficiente do vidro') + inp('Família da causa', o.causeFamily, 'causeFamily', 'ex.: Avaria / Embalagem') + sel('Responsabilidade', o.responsibility, DEV.RESPONSIBILITY, 'responsibility') + '<label class="fld">Notas internas</label><textarea class="input" data-inp="operatorNotes" rows="3" style="width:100%;resize:vertical" placeholder="Observações da equipe — nunca apagadas por reimportação">' + esc(o.operatorNotes || '') + '</textarea></div></div>' +
        '<div class="panel" id="fichaDisputa"><div class="ph"><h3>Disputa</h3><span class="tag info">' + DEV.DISPUTE_STATUS[o.disputeStatus] + '</span></div><div class="pb"><select class="select" id="dispsel" style="width:100%">' + Object.keys(DEV.DISPUTE_STATUS).map(function (k) { return '<option value="' + k + '"' + (o.disputeStatus === k ? ' selected' : '') + '>' + DEV.DISPUTE_STATUS[k] + '</option>'; }).join('') + '</select><div id="dispextra"></div><button class="btn-sm primary" id="dispsave" style="margin-top:8px">Salvar disputa</button></div></div>' +
        // ---- RETORNO FÍSICO ----
        '<div class="panel"><div class="ph"><h3>Retorno físico</h3></div><div class="pb">' + kv('Número de rastreamento', o.tracking || '—') + kv('Status de rastreamento', o.trackingStatus || '—') + kv('Situação na empresa', RECEIPT_LABELS[o.receiptState] || 'Não iniciado') + (o.receivedAt ? kv('Recebido em', new Date(o.receivedAt).toLocaleString('pt-BR')) : '') + sel('Condição (se recebida)', o.merchandiseCondition || '', Object.assign({ '': '—' }, DEV.MERCH_COND), 'merchandiseCondition') + (expectsReturn(o) && !receiptDone(o) ? '<button class="btn-sm primary" id="fichabaixa" style="margin-top:8px">📦 Dar baixa / Conferir recebimento</button>' : (o.recuperacao ? '<div class="footnote" style="margin-top:8px">Baixa registrada em ' + new Date(o.receivedAt).toLocaleString('pt-BR') + '. <button class="btn-sm" id="fichabaixa2">Reabrir conferência</button></div>' : '')) + '</div></div>' +
        // ---- FINANCEIRO ----
        '<div class="panel"><div class="ph"><h3>Financeiro</h3></div><div class="pb">' +
        (function () { var r = occResultadoDevolucao(o); return '<div class="fin-line total"><span>Resultado da devolução — <span class="tag ' + (r.status === 'confirmado' ? 'ok' : 'info') + '">' + (r.status === 'confirmado' ? 'Confirmado (baixa feita)' : 'Provisório (aguardando baixa)') + '</span></span><span class="neg">' + brl(r.perda) + '</span></div>' + (r.status === 'confirmado' ? '<div class="footnote" style="margin:2px 0 8px">Custo do produto ' + brl(r.custoTotal) + ' − valor reaproveitável ' + brl(r.valorReaproveitavel) + ' = perda confirmada ' + brl(r.perda) + '.</div>' : '<div class="footnote" style="margin:2px 0 8px">Baseado no reembolso pago menos compensação — vira "confirmado" quando a mercadoria voltar e você conferir/der baixa.</div>'); })() +
        '<div class="fin-line"><span>Situação financeira</span><span class="tag">' + esc(casoSituacaoFinanceira(o)) + '</span></div>' +
        '<div class="fin-line"><span>Valor reembolsado</span><span class="neg">' + brl(o.impact.refundedTotal) + '</span></div><div class="fin-line"><span>Compensação</span><span class="pos">-' + brl(o.impact.recoveredTotal) + '</span></div><div class="fin-line"><span>Custos adicionais</span><span class="neg">' + brl(o.impact.additionalCostTotal) + '</span></div><div class="fin-line total"><span>Impacto líquido conhecido</span><span class="neg">' + (o.impact.knownNetImpact == null ? '—' : brl(o.impact.knownNetImpact)) + '</span></div>' +
        inp('Valor recuperável (R$)', o.recoverableValue, 'recoverableValue', '0,00') +
        '<div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap;align-items:center"><select class="select sm" id="evtype">' + Object.keys(EVENT_META).map(function (k) { return '<option value="' + k + '">' + EVENT_META[k].label + '</option>'; }).join('') + '</select><input class="input sm" id="evamt" style="width:100px" placeholder="valor"><button class="btn-sm primary" id="evadd">+ Movimentação</button></div>' +
        (o.events && o.events.length ? '<div style="margin-top:10px">' + o.events.map(function (e) { return '<div class="fin-line"><span>' + (EVENT_META[e.type] ? EVENT_META[e.type].label : e.type) + (e.note ? ' · ' + esc(e.note) : '') + '</span><span class="' + (e.direction === 'RECOVERY' ? 'pos' : 'neg') + '">' + (e.direction === 'RECOVERY' ? '-' : '') + brl(e.amount) + '</span></div>'; }).join('') + '</div>' : '') + '</div></div>' +
        '</div></div>' +
        // ---- HISTÓRICO ----
        '<div class="panel"><div class="ph"><h3>Histórico</h3></div><div class="pb"><div style="display:flex;gap:6px;margin-bottom:10px"><input class="input sm" id="cmt" style="flex:1" placeholder="Adicionar comentário…"><button class="btn-sm" id="cmtadd">Comentar</button></div>' +
        ((o.activities || []).length ? o.activities.map(function (a) {
          var body = a.kind === 'COMMENT' ? '💬 ' + esc(a.message)
            : a.kind === 'FINANCIAL' ? '💰 ' + esc(a.message)
            : a.kind === 'RECEIPT' ? '📦 ' + esc(a.message || 'Recebimento')
            : a.kind === 'SOURCE' ? '🛰️ Automático — Shopee' + (a.field ? ' · ' + esc(a.field) + ': ' + esc(a.oldValue || '∅') + ' → ' + esc(a.newValue || '∅') : ' · ' + esc(a.message || '')) + (a.fileName ? ' <span class="footnote" style="margin:0">(' + esc(a.fileName) + ')</span>' : '')
            : a.kind === 'DISPUTE' ? '⚖️ Manual — Operação · ' + esc(a.field || '') + ': ' + esc(a.oldValue || '∅') + ' → ' + esc(a.newValue || '∅') + (a.message ? ' · ' + esc(a.message) : '')
            : '✏️ Manual — Operação · ' + esc(a.field || '') + ': ' + esc(a.oldValue || '∅') + ' → ' + esc(a.newValue || '∅');
          var who = a.userName === 'Shopee' ? '' : (a.userName ? ' — ' + esc(a.userName) : '');
          return '<div class="fin-line"><span>' + body + who + '</span><span class="footnote" style="margin:0">' + new Date(a.createdAt).toLocaleString('pt-BR') + '</span></div>';
        }).join('') : '<div class="footnote">Sem atividade ainda.</div>') + '</div></div>' +
        '</div>';
      panel.querySelector('.x').onclick = function () { d.remove(); };
      var fb = panel.querySelector('#fichabaixa'); if (fb) fb.onclick = function () { openConferir(o.id, draw); };
      var fb2 = panel.querySelector('#fichabaixa2'); if (fb2) fb2.onclick = function () { openConferir(o.id, draw); };
      panel.querySelectorAll('[data-set]').forEach(function (s) { s.onchange = function () { setField(s.dataset.set, s.value || (s.dataset.set === 'merchandiseCondition' ? null : s.value)); }; });
      panel.querySelectorAll('[data-inp]').forEach(function (i) { var ev = i.tagName === 'TEXTAREA' ? 'onblur' : 'onblur'; i[ev] = function () { var field = i.dataset.inp; var val = field === 'recoverableValue' ? (i.value === '' ? null : Number(i.value.replace(',', '.'))) : (i.value || null); setField(field, val); }; });
      var evadd = panel.querySelector('#evadd'); evadd.onclick = function () { var type = panel.querySelector('#evtype').value; var amt = Number((panel.querySelector('#evamt').value || '').replace(',', '.')); if (!amt || amt < 0) { toast('Valor inválido', 'Informe um valor.', true); return; } putEvent(o, 'manual:' + type + ':' + Date.now(), type, EVENT_META[type].direction, amt, 'MANUAL'); persist({ kind: 'FINANCIAL', message: (EVENT_META[type].label) + ': ' + brl(amt), userName: 'Operador' }); toast('Movimentação lançada', EVENT_META[type].label + ' · ' + brl(amt)); };
      var dispsel = panel.querySelector('#dispsel'); var dispExtra = panel.querySelector('#dispextra');
      function drawDisp() { dispExtra.innerHTML = (dispsel.value === 'GANHA' || dispsel.value === 'PARCIAL') ? '<div style="display:flex;gap:6px;margin-top:6px"><input class="input sm" id="drec" style="flex:1" placeholder="valor recuperado"><input class="input sm" id="dcomp" style="flex:1" placeholder="compensação"></div>' : ''; }
      dispsel.onchange = drawDisp; drawDisp();
      panel.querySelector('#dispsave').onclick = function () { var res = dispsel.value; var prev = o.disputeStatus; o.hasDispute = true; o.disputeStatus = res; var rec = panel.querySelector('#drec'); var comp = panel.querySelector('#dcomp'); if (rec && rec.value) { o.disputeRecovered = Number(rec.value.replace(',', '.')); putEvent(o, 'dispute:recovery', 'RECUPERACAO_DISPUTA', 'RECOVERY', o.disputeRecovered, 'MANUAL', 'Recuperação de disputa'); } if (comp && comp.value) { putEvent(o, 'dispute:compensation', 'COMPENSACAO_SHOPEE', 'RECOVERY', Number(comp.value.replace(',', '.')), 'MANUAL', 'Compensação (disputa)'); } if (['GANHA', 'PARCIAL', 'PERDIDA', 'PRAZO_PERDIDO'].indexOf(res) >= 0) o.internalStatus = 'RESOLVIDA'; else if (['POSSIVEL', 'EM_PREPARACAO', 'RESPONDIDA', 'AGUARDANDO_SHOPEE'].indexOf(res) >= 0) o.internalStatus = 'EM_DISPUTA'; addActivity(o, 'DISPUTE', { field: 'disputeStatus', oldValue: prev, newValue: res, message: o.disputeRecovered ? 'Recuperado ' + brl(o.disputeRecovered) : '', userName: 'Operador' }); recomputeOccImpact(o); saveOcc(o).then(function () { draw(); render(); }); toast('Disputa atualizada', DEV.DISPUTE_STATUS[res]); };
      var cmtadd = panel.querySelector('#cmtadd'); var cmt = panel.querySelector('#cmt'); cmtadd.onclick = function () { if (!cmt.value.trim()) return; addActivity(o, 'COMMENT', { message: cmt.value.trim(), userName: 'Operador' }); saveOcc(o).then(draw); }; cmt.onkeydown = function (e) { if (e.key === 'Enter' && cmt.value.trim()) { addActivity(o, 'COMMENT', { message: cmt.value.trim(), userName: 'Operador' }); saveOcc(o).then(draw); } };
    }
    draw();
    if (focusBlock === 'disputa') { var fd = panel.querySelector('#fichaDisputa'); if (fd) fd.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
  }

  // ==================================================================================
  // SALDO DA CARTEIRA — mostrar + medir + rastrear + reconciliar (determinístico)
  // ==================================================================================
  var WCAT = { RENDA: 'Renda de pedido', DEVOLUCAO: 'Devolução / Reembolso', CANCELAMENTO: 'Cancelamento', INDENIZACAO: 'Indenização', PIX: 'Pix', SAQUE: 'Saque', ADS: 'Ads', ACELERA: 'Shopee Acelera', PAGAMENTO: 'Pagamento', LOGISTICA: 'Logística', AJUSTE: 'Ajuste', COMPENSACAO: 'Compensação', CREDITO: 'Crédito', TAXA: 'Taxa', SEMLINHA: 'Ajuste sem linha', OUTRO: 'Outro' };
  function wcatLabel(c) { return WCAT[c] || c; }
  // Classificação INTERNA (nunca altera o dado Shopee, §MOV): responsabilidade, status, observação, vínculos.
  var WRESP = { OPERACAO: 'Nossa operação', SHOPEE: 'Shopee', LOGISTICA: 'Logística / Transporte', CLIENTE: 'Cliente', TERCEIRO: 'Terceiro', NAO_DEFINIDO: 'Não definido' };
  var WSTATUS = { NAO_REVISADO: 'Não revisado', EM_ANALISE: 'Em análise', EXPLICADO: 'Explicado', CONTESTACAO: 'Contestação necessária', RESOLVIDO: 'Resolvido' };
  var RESP_FROM_OCC = { OPERACAO: 'OPERACAO', SHOPEE: 'SHOPEE', LOGISTICA: 'LOGISTICA', COMPRADOR: 'CLIENTE', COMPARTILHADA: 'TERCEIRO', NAO_IDENTIFICADA: 'NAO_DEFINIDO' };
  function wgetCls(id) { return walletCls[id] || null; }
  function wsetCls(id, patch, obs, userName) {
    var c = walletCls[id] || { id: id, history: [] };
    var changes = [];
    Object.keys(patch).forEach(function (k) { var old = c[k]; if ((old == null ? '' : String(old)) !== (patch[k] == null ? '' : String(patch[k]))) { changes.push({ field: k, old: old == null ? '' : String(old), nw: patch[k] == null ? '' : String(patch[k]) }); c[k] = patch[k]; } });
    if (changes.length || obs) { c.history = c.history || []; c.history.unshift({ at: new Date().toISOString(), user: userName || 'Operador', changes: changes, obs: obs || '' }); }
    if (obs != null) c.note = obs;
    walletCls[id] = c; return putMany('walletcls', [c]);
  }
  // Categoria efetiva (manual sobrepõe automática); responsabilidade (manual → devolução vinculada → não definida).
  function wEffCat(t) { var c = wgetCls(t.id); return (c && c.catManual) ? c.catManual : t.category; }
  function wLinkedOcc(t) { var c = wgetCls(t.id); if (c && c.linkedOccId) { var o = occ.find(function (x) { return x.id === c.linkedOccId; }); if (o) return o; } var oid = (c && c.linkedOrderId) || t.orderId; if (!oid) return null; return occ.find(function (x) { return !x.isDemo && x.orderId === oid; }) || null; }
  function wLinkedOrder(t) { var c = wgetCls(t.id); var oid = (c && c.linkedOrderId) || t.orderId; if (!oid) return null; return orders.find(function (x) { return x.id === oid; }) || null; }
  function wResp(t) { var c = wgetCls(t.id); if (c && c.responsibility) return c.responsibility; var oc = wLinkedOcc(t); if (oc && oc.responsibility && oc.responsibility !== 'NAO_IDENTIFICADA') return RESP_FROM_OCC[oc.responsibility] || 'NAO_DEFINIDO'; return 'NAO_DEFINIDO'; }
  function wStatus(t) { var c = wgetCls(t.id); return (c && c.internalStatus) || 'NAO_REVISADO'; }
  function wIsExplained(t) { var s = wStatus(t); return s === 'EXPLICADO' || s === 'RESOLVIDO'; }
  // Assinatura determinística: normaliza IDs, pedidos, datas, valores, códigos → padrão textual (§7).
  function wSignature(desc) {
    var s = normStatus(desc || '');
    s = s.replace(/#?\s*[a-z0-9]{6,}/g, '#').replace(/\b\d{4}-\d{2}-\d{2}\b/g, '#data').replace(/r\$?\s*[\d.,]+/g, '#valor').replace(/\b\d+[.,]\d+\b/g, '#valor').replace(/\b\d{3,}\b/g, '#').replace(/\s+/g, ' ').trim();
    return s || '(sem descrição)';
  }
  function wRecurring(txs) {
    var map = {};
    txs.forEach(function (t) { if (t.amount >= 0) return; var sig = wSignature(t.desc); var m = map[sig] = map[sig] || { sig: sig, n: 0, total: 0, last: '', cats: {}, sample: t.desc, unclass: 0 }; m.n++; m.total += t.amount; if ((t.date || '') > m.last) m.last = t.date; var c = wEffCat(t); m.cats[c] = (m.cats[c] || 0) + 1; if (!wgetCls(t.id) || !wgetCls(t.id).catManual) m.unclass++; });
    return Object.values(map).map(function (m) { var dom = Object.entries(m.cats).sort(function (a, b) { return b[1] - a[1]; })[0]; m.domCat = dom ? dom[0] : 'OUTRO'; return m; }).filter(function (m) { return m.n >= 3; }).sort(function (a, b) { return a.total - b.total; });
  }
  function walletNum(v) { if (v == null) return null; var s = String(v).trim(); if (s === '' || s === '-') return null; s = s.replace(/\s/g, ''); if (s.indexOf(',') >= 0 && s.indexOf('.') >= 0) s = s.replace(/\./g, '').replace(',', '.'); else if (s.indexOf(',') >= 0) s = s.replace(',', '.'); var n = Number(s); return isNaN(n) ? null : n; }
  function parseWalletDate(d) { var x = new Date(String(d).replace(' ', 'T')); return isNaN(x) ? null : x.toISOString(); }
  function walletCat(tipo, desc, amount) {
    var t = normStatus(tipo), s = normStatus(desc), entrada = amount >= 0;
    if (/renda do pedido|renda de pedido|renda|liberacao/.test(t)) return 'RENDA';
    if (/pix/.test(t)) return 'PIX';
    if (/saque/.test(t)) return 'SAQUE';
    if (/acelera/.test(t)) return 'ACELERA';
    if (/pagamento/.test(t)) { if (/ads|anuncio|publicidade|impuls|recarga/.test(s)) return 'ADS'; return 'PAGAMENTO'; }
    if (/ajuste/.test(t)) { if (/reembolso|devolucao|debito referente ao pedido/.test(s)) return 'DEVOLUCAO'; if (/perdido|danificado|indeniz|compensa|credito por item/.test(s)) return 'INDENIZACAO'; return entrada ? 'CREDITO' : 'AJUSTE'; }
    if (/reembolso|devolucao/.test(s)) return 'DEVOLUCAO';
    if (/indeniz|perdido|danificado|compensa/.test(s)) return 'INDENIZACAO';
    if (/ads|anuncio|publicidade/.test(s)) return 'ADS';
    if (/pix/.test(s)) return 'PIX';
    return 'OUTRO';
  }
  function extractWalletOrderId(colVal, desc) { if (colVal) return colVal; var m = (desc || '').match(/#\s*([A-Za-z0-9]{6,})/) || (desc || '').match(/pedido\s+([A-Za-z0-9]{6,})/i); return m ? m[1] : ''; }
  function walletKey(row) { return 'w:' + (row.date || row.dateRaw) + '|' + row.amount + '|' + (row.balance == null ? '' : row.balance) + '|' + (row.orderId || '') + '|' + (row.desc || '').slice(0, 48); }
  function parseWallet(ab, filename) {
    var res = { notRecognized: true, rows: [] };
    var wb; try { wb = XLSX.read(new Uint8Array(ab), { type: 'array' }); } catch (e) { return res; }
    var findCol = function (head, aliases) { for (var j = 0; j < head.length; j++) { var h = normStatus(head[j]); for (var a = 0; a < aliases.length; a++) { if (h === aliases[a] || h.indexOf(aliases[a]) >= 0) return j; } } return -1; };
    for (var si = 0; si < wb.SheetNames.length; si++) {
      var aoa = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[si]], { header: 1, raw: false, defval: '' });
      var hi = -1;
      for (var i = 0; i < Math.min(aoa.length, 40); i++) { var hn = (aoa[i] || []).map(function (c) { return normStatus(c); }); if (hn.indexOf('data') >= 0 && hn.some(function (x) { return x.indexOf('valor') >= 0; }) && hn.some(function (x) { return x.indexOf('balanca') >= 0 || x.indexOf('saldo') >= 0; })) { hi = i; break; } }
      if (hi < 0) continue;
      var head = (aoa[hi] || []).map(function (c) { return String(c).trim(); });
      var ci = { date: findCol(head, ['data']), tipo: findCol(head, ['tipo de transacao', 'tipo']), desc: findCol(head, ['descricao', 'detalhes']), order: findCol(head, ['id do pedido', 'numero do pedido', 'codigo do pedido']), dir: findCol(head, ['direcao do dinheiro', 'direcao']), val: findCol(head, ['valor']), status: findCol(head, ['status']), bal: findCol(head, ['balanca apos', 'saldo apos', 'saldo']), adj: findCol(head, ['valor a ser ajustado', 'valor a ajustar']) };
      if (ci.date < 0 || ci.val < 0) continue;
      for (var r = hi + 1; r < aoa.length; r++) { var row = aoa[r] || []; var d = String(row[ci.date] || '').trim(); if (!d) continue; var amount = walletNum(row[ci.val]); if (amount == null) continue; var oid = ci.order >= 0 ? String(row[ci.order] || '').trim() : ''; if (oid === '-' || oid === '') oid = ''; res.rows.push({ dateRaw: d, date: parseWalletDate(d), tipo: ci.tipo >= 0 ? String(row[ci.tipo] || '').trim() : '', desc: ci.desc >= 0 ? String(row[ci.desc] || '').trim() : '', orderId: oid, dir: ci.dir >= 0 ? String(row[ci.dir] || '').trim() : '', amount: amount, status: ci.status >= 0 ? String(row[ci.status] || '').trim() : '', balance: ci.bal >= 0 ? walletNum(row[ci.bal]) : null, adjust: ci.adj >= 0 ? walletNum(row[ci.adj]) : null }); }
      res.notRecognized = res.rows.length === 0; break;
    }
    return res;
  }
  function importWallet(file) {
    return file.arrayBuffer().then(function (ab) {
      var parsed = parseWallet(ab, file.name);
      if (parsed.notRecognized) throw new Error('Extrato da carteira não reconhecido (esperado o relatório de transações do saldo Shopee).');
      var byId = {}; wallet.forEach(function (t) { byId[t.id] = t; });
      var novo = 0, unch = 0, changed = []; var importedAt = new Date().toISOString();
      var maxSeq = wallet.reduce(function (m, t) { return Math.max(m, t.seq || 0); }, 0);
      // O extrato vem do mais NOVO para o mais antigo; invertendo obtemos a ordem cronológica real,
      // que é a sequência autoritativa para a reconciliação (mesmo com timestamps repetidos).
      parsed.rows.slice().reverse().forEach(function (row) { var id = walletKey(row); if (byId[id]) { unch++; return; } var cat = walletCat(row.tipo, row.desc, row.amount); var orderId = extractWalletOrderId(row.orderId, row.desc); var t = { id: id, seq: ++maxSeq, origin: 'SHOPEE', date: row.date, dateRaw: row.dateRaw, tipo: row.tipo, desc: row.desc, category: cat, orderId: orderId, dir: row.dir, amount: row.amount, balance: row.balance, adjust: row.adjust, status: row.status, fileName: file.name, importedAt: importedAt }; byId[id] = t; changed.push(t); novo++; });
      wallet = Object.values(byId);
      var batch = { id: 'wb' + Date.now() + Math.round(performance.now()), module: 'Carteira', filename: file.name, createdAt: importedAt, seen: parsed.rows.length, novo: novo, upd: 0, unch: unch, itemsSeen: parsed.rows.length };
      batches.unshift(batch); walletStamp = importedAt; lastImportStamp = importedAt;
      return Promise.all([putMany('wallet', changed), putMany('batches', [batch])]).then(function () { return batch; });
    });
  }
  // Reconciliação: saldo anterior + movimentação = saldo esperado; diferença = gap → movimentação reconstruída.
  function reconcileWallet() {
    var chrono = wallet.slice().sort(function (a, b) { return (a.seq || 0) - (b.seq || 0) || (a.date || '').localeCompare(b.date || ''); });
    var out = [], diffs = [], prevBal = null, prevAdj = null;
    chrono.forEach(function (t) {
      t.gap = null; t.expectedBalance = null;
      if (t.balance != null && prevBal != null && t.amount != null) {
        var expected = r2(prevBal + t.amount); var gap = r2(t.balance - expected); t.expectedBalance = expected; t.gap = gap;
        if (Math.abs(gap) > 0.01) {
          var adjDelta = (prevAdj != null && t.adjust != null) ? r2(t.adjust - prevAdj) : null;
          var explained = adjDelta != null && (Math.abs(adjDelta - gap) < 0.02 || Math.abs(adjDelta + gap) < 0.02);
          var rec = { id: 'rec:' + t.id, origin: 'SISTEMA', date: t.date, dateRaw: t.dateRaw, category: 'SEMLINHA', orderId: t.orderId, amount: gap, balance: t.balance, expectedBalance: expected, informed: t.balance, adjDelta: adjDelta, reconStatus: explained ? 'PROVAVEL' : 'DIVERGENTE', relatedId: t.id, desc: 'Diferença de saldo reconstruída pela reconciliação matemática' };
          out.push(rec); diffs.push({ date: t.date, expected: expected, informed: t.balance, gap: gap, status: explained ? 'PROVAVEL' : 'DIVERGENTE', rec: rec, tx: t });
        }
      }
      out.push(t);
      if (t.balance != null) prevBal = t.balance;
      if (t.adjust != null) prevAdj = t.adjust;
    });
    return { txs: out, diffs: diffs };
  }
  // ---- Fase 1 da arquitetura (§26-30/§53-55): motor de origem por ID ----
  // Para cada lançamento, busca a origem esperada no próprio sistema, por prioridade determinística:
  // (1) ID exato — pedido ligado a um registro do Acelera/Devolução/Minha Renda com o mesmo ID;
  // (2) relacionamento conhecido — sem ID exato no lançamento, mas valor+janela de data batem com um
  // resgate consolidado do Acelera (o extrato da carteira lança o resgate inteiro, não pedido a pedido);
  // (3) sem origem — vira pendência. NUNCA substitui reconcileWallet() (que audita a matemática do
  // saldo do extrato) — é uma camada adicional que audita CADA LANÇAMENTO contra as fontes internas.
  // Aditivo: não altera wgetCls/wEffCat/wLinkedOcc nem qualquer classificação manual já aprovada.
  // confidence: 'alta' → fonte que a própria Shopee já fechou (Acelera "recebido", Income "Pagamento
  // Liberado") — entra na dicotomia estrita 🟢 conciliado / 🔴 divergente. confidence: 'estimativa' →
  // fonte ainda provisória (Devolução usa o valor SOLICITADO, que o próprio módulo já rotula como
  // "resultado provisório" até a baixa/conferência) — NUNCA vira "divergência", só "correspondência
  // encontrada, valor a conferir": comparar um extrato real contra uma estimativa e chamar de erro
  // seria inventar divergência, o que a regra de ouro do sistema proíbe.
  function walletOrigin(t) {
    var cat = wEffCat(t); var oid = (wgetCls(t.id) && wgetCls(t.id).linkedOrderId) || t.orderId;
    var amtC = Math.round(t.amount * 100);
    if (oid) {
      if (cat === 'ACELERA' && acelera.length) {
        var acRecs = acelera.filter(function (r) { return r.pedido === oid; });
        if (acRecs.length) { var recebC = acRecs.reduce(function (s, r) { return s + r.recebido; }, 0); return { tier: 'ID exato', confidence: 'alta', fonte: 'Shopee Acelera · pedido ' + oid, esperado: recebC / 100, encontrado: t.amount, diff: r2(t.amount - recebC / 100), ok: Math.abs(amtC - recebC) <= 100 }; }
      }
      if ((cat === 'DEVOLUCAO' || cat === 'CANCELAMENTO') && occ.length) {
        var oc = occ.find(function (o) { return !o.isDemo && o.orderId === oid; });
        if (oc && oc.impact && oc.impact.refundedTotal > 0) { return { tier: 'ID exato', confidence: 'estimativa', fonte: 'Devolução ' + oc.id + ' (valor solicitado, provisório até a baixa)', esperado: -oc.impact.refundedTotal, encontrado: t.amount, diff: r2(t.amount + oc.impact.refundedTotal), ok: null }; }
      }
      if (cat === 'INDENIZACAO' && occ.length) {
        var oc2 = occ.find(function (o) { return !o.isDemo && o.orderId === oid; });
        if (oc2 && oc2.impact && oc2.impact.recoveredTotal > 0) { return { tier: 'ID exato', confidence: 'estimativa', fonte: 'Compensação — Devolução ' + oc2.id + ' (provisório)', esperado: oc2.impact.recoveredTotal, encontrado: t.amount, diff: r2(t.amount - oc2.impact.recoveredTotal), ok: null }; }
      }
      if (cat === 'RENDA' && mrRenda.length) {
        var mr = mrEngine(); var mrow = mr.orders.find(function (r) { return r.orderId === oid; });
        if (mrow) { return { tier: 'ID exato', confidence: 'alta', fonte: 'Minha Renda / Income · pedido ' + oid, esperado: mrow.liberado / 100, encontrado: t.amount, diff: r2(t.amount - mrow.liberado / 100), ok: Math.abs(amtC - mrow.liberado) <= 100 }; }
      }
    }
    // Tier 2: sem ID de pedido no lançamento — Acelera lança o RESGATE inteiro (soma de vários
    // pedidos), então tenta casar por valor recebido do resgate consolidado + janela de 5 dias.
    // Correção do usuário: correspondência por valor+data é só CANDIDATO — nunca fecha conciliação
    // sozinha. confidence:'candidato' nunca entra no 🟢/🔴 automático; exige confirmação manual.
    if (cat === 'ACELERA' && acelera.length) {
      var resgates = aceleraByResgate(acelera);
      var cand = resgates.find(function (g) { if (Math.abs(g.receb - amtC) > 100) return false; if (!t.date) return true; var gd = acLocalDate(g.data); if (!gd) return true; return Math.abs(new Date(t.date) - gd) <= 5 * 864e5; });
      if (cand) return { tier: 'Valor + janela de data', confidence: 'candidato', fonte: 'Resgate ' + cand.resgate + ' (candidato — confirmar manualmente)', esperado: cand.receb / 100, encontrado: t.amount, diff: 0, ok: null };
    }
    return null;
  }
  // Correção do usuário (§3): não contar lançamento sem origem como "pendência real" se a fonte
  // relevante ainda não cobre o período do lançamento — só o que está DENTRO da janela coberta e
  // mesmo assim não bate é pendência de verdade. Cobertura = intervalo [min,max] de datas realmente
  // importadas em cada fonte (não o período declarado no cabeçalho de um único arquivo).
  function walletSourceCoverage() {
    var acDates = acelera.map(function (r) { return r.data; }).filter(Boolean).sort();
    var acRange = acDates.length ? { min: acLocalDate(acDates[0]), max: acLocalDate(acDates[acDates.length - 1]) } : null;
    var mr = mrRenda.length ? mrEngine() : null;
    var mrDates = mr ? mr.orders.map(function (r) { return r.dataConclusao || r.dataCriacao; }).filter(Boolean).sort() : [];
    var mrRange = mrDates.length ? { min: new Date(mrDates[0]), max: new Date(mrDates[mrDates.length - 1]) } : null;
    var occDates = occ.filter(function (o) { return !o.isDemo; }).map(function (o) { return o.occurredAt; }).filter(Boolean).sort();
    var occRange = occDates.length ? { min: new Date(occDates[0]), max: new Date(occDates[occDates.length - 1]) } : null;
    return { ACELERA: acRange, RENDA: mrRange, DEVOLUCAO: occRange, CANCELAMENTO: occRange, INDENIZACAO: occRange };
  }
  // true = dentro da cobertura (pendência real se não achou origem); false = fora (fonte ainda não
  // chega até essa data — não é pendência, é lacuna de importação); null = fonte não tem NENHUM dado
  // ainda (mesmo critério: não classificar como pendência sem ter o que comparar).
  function walletInCoverage(t, cat, coverage) {
    var cov = coverage[cat]; if (!cov || !t.date) return null;
    var d = new Date(t.date); return d >= cov.min && d <= cov.max;
  }
  // Agrupa por (origem esperada normalizada, valor arredondado) — quando um MESMO evento esperado
  // aparece mais vezes do que deveria na carteira, sinaliza possível duplicidade (§31).
  function walletDuplicidade(txsComOrigem) {
    var map = {};
    txsComOrigem.forEach(function (x) { if (!x.origin) return; var key = x.origin.fonte + '|' + Math.round(x.t.amount * 100); var g = map[key] = map[key] || { fonte: x.origin.fonte, valor: x.t.amount, itens: [] }; g.itens.push(x.t); });
    return Object.values(map).filter(function (g) { return g.itens.length > 1; });
  }
  function walletCurrentBalance() { var withBal = wallet.filter(function (t) { return t.balance != null && t.date; }).sort(function (a, b) { return (a.date).localeCompare(b.date); }); return withBal.length ? withBal[withBal.length - 1].balance : 0; }
  function walletCurrentAdjust() { var withAdj = wallet.filter(function (t) { return t.adjust != null && t.date; }).sort(function (a, b) { return (a.date).localeCompare(b.date); }); return withAdj.length ? withAdj[withAdj.length - 1].adjust : 0; }
  function walletTxInPeriod(txs) { return txs.filter(function (t) { return inPeriod(t.date); }); }
  function walletMetrics() {
    var rec = reconcileWallet(); var inP = walletTxInPeriod(rec.txs);
    var real = inP.filter(function (t) { return t.origin === 'SHOPEE'; });
    var reconstructed = inP.filter(function (t) { return t.origin === 'SISTEMA'; });
    var entradas = 0, saidas = 0, maiorEnt = 0, maiorSai = 0, entN = 0, saiN = 0;
    real.forEach(function (t) { if (t.amount > 0) { entradas += t.amount; entN++; if (t.amount > maiorEnt) maiorEnt = t.amount; } else if (t.amount < 0) { saidas += t.amount; saiN++; if (t.amount < maiorSai) maiorSai = t.amount; } });
    var cats = {}; real.forEach(function (t) { var c = cats[t.category] = cats[t.category] || { cat: t.category, n: 0, ent: 0, sai: 0 }; c.n++; if (t.amount > 0) c.ent += t.amount; else c.sai += t.amount; });
    var semLinha = reconstructed.reduce(function (s, t) { return s + t.amount; }, 0);
    if (reconstructed.length) { var c2 = cats['SEMLINHA'] = cats['SEMLINHA'] || { cat: 'SEMLINHA', n: 0, ent: 0, sai: 0 }; reconstructed.forEach(function (t) { c2.n++; if (t.amount > 0) c2.ent += t.amount; else c2.sai += t.amount; }); }
    var devDesc = real.filter(function (t) { return t.category === 'DEVOLUCAO' && t.amount < 0; });
    // dias com valor a ajustar (todo o histórico, snapshot)
    var adjDays = {}; wallet.forEach(function (t) { if (t.adjust != null && Math.abs(t.adjust) > 0.01 && t.date) adjDays[t.date.slice(0, 10)] = 1; });
    var adjVals = wallet.map(function (t) { return t.adjust; }).filter(function (v) { return v != null; });
    var peakAdj = adjVals.length ? adjVals.reduce(function (m, v) { return Math.abs(v) > Math.abs(m) ? v : m; }, 0) : 0;
    return {
      entradas: r2(entradas), saidas: r2(saidas), liquido: r2(entradas + saidas), saldoAtual: r2(walletCurrentBalance()), ajusteAtual: r2(walletCurrentAdjust()), semLinha: r2(semLinha),
      maiorEnt: r2(maiorEnt), maiorSai: r2(maiorSai), entN: entN, saiN: saiN, cats: Object.values(cats), devDesc: devDesc, devTotal: r2(devDesc.reduce(function (s, t) { return s + t.amount; }, 0)),
      diffs: rec.diffs.filter(function (d) { return inPeriod(d.date); }), diffsAll: rec.diffs, adjDays: Object.keys(adjDays).length, peakAdj: r2(peakAdj), reconstructed: reconstructed, real: real, allTxsInP: inP,
    };
  }
  // Diagnóstico: onde está vazando, rastreamento, responsabilidade das devoluções, recorrências (§Raio-X).
  function walletDiag(m) {
    var saidasReal = m.real.filter(function (t) { return t.amount < 0; });
    var totalSai = saidasReal.reduce(function (s, t) { return s + t.amount; }, 0) + m.reconstructed.reduce(function (s, t) { return s + (t.amount < 0 ? t.amount : 0); }, 0);
    // Onde está vazando: por categoria efetiva (inclui reconstruídas como "Ajuste sem linha")
    var leakMap = {}; saidasReal.forEach(function (t) { var c = wEffCat(t); var g = leakMap[c] = leakMap[c] || { cat: c, n: 0, total: 0 }; g.n++; g.total += t.amount; });
    m.reconstructed.forEach(function (t) { if (t.amount >= 0) return; var g = leakMap.SEMLINHA = leakMap.SEMLINHA || { cat: 'SEMLINHA', n: 0, total: 0 }; g.n++; g.total += t.amount; });
    var leaks = Object.values(leakMap).sort(function (a, b) { return a.total - b.total; });
    // Devoluções (débito) e responsabilidade cruzando o módulo Devoluções
    var devDeb = saidasReal.filter(function (t) { return wEffCat(t) === 'DEVOLUCAO'; });
    var devTotal = devDeb.reduce(function (s, t) { return s + t.amount; }, 0);
    var devOrders = {}; devDeb.forEach(function (t) { var oid = (wgetCls(t.id) && wgetCls(t.id).linkedOrderId) || t.orderId; if (oid) devOrders[oid] = 1; });
    var devComOcc = 0, devSemOcc = 0; devDeb.forEach(function (t) { if (wLinkedOcc(t)) devComOcc++; else devSemOcc++; });
    var respMap = {}; devDeb.forEach(function (t) { var r = wResp(t); var g = respMap[r] = respMap[r] || { resp: r, n: 0, total: 0 }; g.n++; g.total += t.amount; });
    var resps = Object.values(respMap).sort(function (a, b) { return a.total - b.total; });
    // Rastreamento (todas as saídas reais)
    var comPedido = { n: 0, v: 0 }, comDev = { n: 0, v: 0 }, semPedido = { n: 0, v: 0 }, semCat = { n: 0, v: 0 }, precisa = { n: 0, v: 0 };
    saidasReal.forEach(function (t) { var oid = (wgetCls(t.id) && wgetCls(t.id).linkedOrderId) || t.orderId; if (oid) { comPedido.n++; comPedido.v += t.amount; } else { semPedido.n++; semPedido.v += t.amount; } if (wLinkedOcc(t)) { comDev.n++; comDev.v += t.amount; } if (wEffCat(t) === 'OUTRO') { semCat.n++; semCat.v += t.amount; } if (!wIsExplained(t) && (wEffCat(t) === 'OUTRO' || wResp(t) === 'NAO_DEFINIDO')) { precisa.n++; precisa.v += t.amount; } });
    var recurring = wRecurring(saidasReal);
    var divergentes = m.diffsAll.filter(function (d) { return inPeriod(d.date) && d.status === 'DIVERGENTE'; });
    return { totalSai: r2(totalSai), leaks: leaks, devTotal: r2(devTotal), devOrders: Object.keys(devOrders).length, devComOcc: devComOcc, devSemOcc: devSemOcc, devN: devDeb.length, resps: resps, comPedido: comPedido, comDev: comDev, semPedido: semPedido, semCat: semCat, precisa: precisa, recurring: recurring, divergentes: divergentes };
  }
  // gráfico de linha simples (saldo × tempo) + 2ª linha opcional (valor a ajustar)
  function svgWalletLine(points, opt) {
    opt = opt || {}; var W = 760, H = 240, padL = 56, padR = 20, padB = 26, padT = 16; if (points.length < 2) return '<div class="footnote">Poucos pontos para desenhar a evolução.</div>';
    var vals = []; points.forEach(function (p) { vals.push(p.a); if (p.b != null) vals.push(p.b); if (opt.three && p.c != null) vals.push(p.c); });
    var mn = Math.min.apply(null, vals.concat([0])), mx = Math.max.apply(null, vals.concat([0])); if (mx === mn) mx = mn + 1;
    var x = function (i) { return padL + i * (W - padL - padR) / (points.length - 1); }; var y = function (v) { return H - padB - (v - mn) / (mx - mn) * (H - padB - padT); };
    var zero = mn < 0 && mx > 0 ? '<line x1="' + padL + '" y1="' + y(0).toFixed(1) + '" x2="' + (W - padR) + '" y2="' + y(0).toFixed(1) + '" stroke="#e2e8f0" stroke-dasharray="3 3"/>' : '';
    var lineA = '<polyline points="' + points.map(function (p, i) { return x(i).toFixed(1) + ',' + y(p.a).toFixed(1); }).join(' ') + '" fill="none" stroke="#2b4bd6" stroke-width="2.5"/>';
    var lineB = opt.two ? '<polyline points="' + points.map(function (p, i) { return x(i).toFixed(1) + ',' + y(p.b || 0).toFixed(1); }).join(' ') + '" fill="none" stroke="#e0662a" stroke-width="2" stroke-dasharray="4 3"/>' : '';
    // Terceira linha opcional (ex.: projeção) — só pontos com c != null são desenhados (mantém "hoje em diante").
    var lineC = '';
    if (opt.three) {
      var segs = []; var cur = [];
      points.forEach(function (p, i) { if (p.c != null) cur.push(x(i).toFixed(1) + ',' + y(p.c).toFixed(1)); else if (cur.length) { segs.push(cur); cur = []; } });
      if (cur.length) segs.push(cur);
      lineC = segs.map(function (s) { return '<polyline points="' + s.join(' ') + '" fill="none" stroke="#8a5cf6" stroke-width="2" stroke-dasharray="2 3"/>'; }).join('');
    }
    var labels = ''; var step = Math.ceil(points.length / 6); points.forEach(function (p, i) { if (i % step === 0 || i === points.length - 1) labels += '<text x="' + x(i).toFixed(1) + '" y="' + (H - 8) + '" font-size="10" fill="#64708a" text-anchor="middle">' + esc(p.label) + '</text>'; });
    var yl = '<text x="8" y="' + (y(mx) + 4).toFixed(1) + '" font-size="10" fill="#64708a">' + brl(mx) + '</text><text x="8" y="' + (y(mn) + 4).toFixed(1) + '" font-size="10" fill="#64708a">' + brl(mn) + '</text>';
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" style="max-width:' + W + 'px">' + zero + lineA + lineB + lineC + labels + yl + '</svg>';
  }
  function walletSaldoSeries() {
    var byDay = {}; wallet.filter(function (t) { return t.date && inPeriod(t.date); }).sort(function (a, b) { return a.date.localeCompare(b.date); }).forEach(function (t) { var d = t.date.slice(0, 10); if (!byDay[d]) byDay[d] = { label: monthDayLabel(d), a: null, b: null }; if (t.balance != null) byDay[d].a = t.balance; if (t.adjust != null) byDay[d].b = t.adjust; });
    var arr = Object.keys(byDay).sort().map(function (k) { return byDay[k]; }); var lastA = 0, lastB = 0; arr.forEach(function (p) { if (p.a == null) p.a = lastA; else lastA = p.a; if (p.b == null) p.b = lastB; else lastB = p.b; }); return arr;
  }
  function monthDayLabel(d) { var p = d.split('-'); return p[2] + '/' + p[1]; }
  var RECON_LABEL = { FECHADO: ['Fechado', 'ok'], EXPLICADO: ['Explicado', 'info'], PROVAVEL: ['Provável ajuste', 'warn'], DIVERGENTE: ['Divergente', 'warn'] };
  // §26-32 — "Origem automática": para cada lançamento real (não reconstruído), tenta achar a origem
  // esperada por ID; classifica 🟢 conciliado / 🔴 diferença de valor / ⚪ sem origem encontrada.
  // Só avalia categorias com fonte de comparação (Acelera/Devolução/Indenização/Renda) — as demais
  // (Pix, Saque, Ads, Ajuste, etc.) não têm um valor esperado no sistema hoje e ficam fora da conta,
  // nunca viram "pendência" por engano.
  var WALLET_ORIGEM_CATS = { ACELERA: 1, DEVOLUCAO: 1, CANCELAMENTO: 1, INDENIZACAO: 1, RENDA: 1 };
  function walletOrigemDiag(m) {
    var elegiveis = m.real.filter(function (t) { return WALLET_ORIGEM_CATS[wEffCat(t)]; });
    var coverage = walletSourceCoverage();
    var comOrigem = [], semMatch = [];
    elegiveis.forEach(function (t) { var o = walletOrigin(t); if (o) comOrigem.push({ t: t, origin: o }); else semMatch.push(t); });
    // fonte definitiva (Acelera/Income) e conciliação FECHADA — só ID exato entra aqui.
    var altaConf = comOrigem.filter(function (x) { return x.origin.confidence === 'alta' && x.origin.tier === 'ID exato'; });
    var conciliados = altaConf.filter(function (x) { return x.origin.ok; });
    var divergentes = altaConf.filter(function (x) { return !x.origin.ok; });
    // candidato por valor+data — nunca fecha sozinho, sempre exige confirmação manual (correção do usuário).
    var candidatos = comOrigem.filter(function (x) { return x.origin.confidence === 'candidato'; });
    var estimativa = comOrigem.filter(function (x) { return x.origin.confidence === 'estimativa'; });
    // sem match: separa o que é pendência REAL (dentro da janela coberta pela fonte) do que está
    // fora da cobertura de conciliação (a fonte ainda não tem dado suficiente para comparar).
    var semOrigem = [], foraCobertura = [];
    semMatch.forEach(function (t) { var inCov = walletInCoverage(t, wEffCat(t), coverage); if (inCov === false || inCov === null) foraCobertura.push(t); else semOrigem.push(t); });
    var dup = walletDuplicidade(altaConf);
    return { elegiveis: elegiveis.length, conciliados: conciliados, divergentes: divergentes, candidatos: candidatos, estimativa: estimativa, semOrigem: semOrigem, foraCobertura: foraCobertura, dup: dup, coverage: coverage };
  }
  function walletOrigemPanel(m) {
    var g = walletOrigemDiag(m);
    if (!g.elegiveis) return '';
    var strip = kstrip([
      { l: '🟢 Origem conciliada (ID exato, fonte definitiva)', v: nn(g.conciliados.length), cls: 'green' },
      { l: '🔴 Diferença de valor (ID exato, fonte definitiva)', v: nn(g.divergentes.length), cls: g.divergentes.length ? 'red' : 'green' },
      { l: '🔵 Candidato provável (valor+data) — confirmar', v: nn(g.candidatos.length), cls: g.candidatos.length ? 'blue' : '', s: 'nunca fecha sozinho — exige confirmação manual' },
      { l: '🟡 Correspondência com estimativa (Devolução/Compensação)', v: nn(g.estimativa.length), cls: 'amber', s: 'valor solicitado, ainda provisório até a baixa — nunca contado como divergência' },
      { l: '⚪ Pendência real (dentro da janela coberta)', v: nn(g.semOrigem.length), cls: g.semOrigem.length ? 'amber' : 'green' },
      { l: '⚫ Fora da cobertura de conciliação', v: nn(g.foraCobertura.length), cls: '', s: 'fonte relevante ainda não importou dado para esse período — não é pendência' },
      { l: '🔴 Possível duplicidade', v: nn(g.dup.length), cls: g.dup.length ? 'red' : 'green' },
    ]);
    var covLine = Object.keys(g.coverage).map(function (k) { var c = g.coverage[k]; return c ? (wcatLabel(k) + ': ' + dbr(c.min.toISOString()) + ' a ' + dbr(c.max.toISOString())) : (wcatLabel(k) + ': sem dado importado ainda'); }).filter(function (v, i, a) { return a.indexOf(v) === i; }).join(' · ');
    var divRows = g.divergentes.slice(0, 100).map(function (x) { return '<tr class="rowlink" data-wtx="' + esc(x.t.id) + '"><td class="nowrap">' + dbr(x.t.date) + '</td><td class="cell-text">' + esc(x.origin.fonte) + '</td><td class="nowrap">' + brl(x.origin.esperado) + '</td><td class="nowrap">' + brl(x.t.amount) + '</td><td class="nowrap neg">' + brl(x.origin.diff) + '</td></tr>'; }).join('');
    var divTable = g.divergentes.length ? '<div class="panel"><div class="ph"><h3>🔴 Diferença de valor (Acelera/Income — fonte definitiva, origem encontrada mas o valor não bate)</h3></div><div class="table-wrap"><table class="report"><thead><tr><th>Data</th><th>Origem esperada</th><th>Valor esperado</th><th>Valor na carteira</th><th>Diferença</th></tr></thead><tbody>' + divRows + '</tbody></table></div></div>' : '';
    var candRows = g.candidatos.slice(0, 100).map(function (x) { return '<tr class="rowlink" data-wtx="' + esc(x.t.id) + '"><td class="nowrap">' + dbr(x.t.date) + '</td><td class="cell-text">' + esc(x.origin.fonte) + '</td><td class="nowrap">' + brl(x.t.amount) + '</td></tr>'; }).join('');
    var candTable = g.candidatos.length ? '<div class="panel"><div class="ph"><h3>🔵 Candidatos prováveis — confirmar manualmente</h3><span class="footnote" style="margin:0">valor e janela de data batem com um resgate, mas sem ID exato no lançamento — nunca conciliado automaticamente</span></div><div class="table-wrap"><table class="report"><thead><tr><th>Data</th><th>Candidato</th><th>Valor na carteira</th></tr></thead><tbody>' + candRows + '</tbody></table></div></div>' : '';
    var estRows = g.estimativa.slice(0, 100).map(function (x) { return '<tr class="rowlink" data-wtx="' + esc(x.t.id) + '"><td class="nowrap">' + dbr(x.t.date) + '</td><td class="cell-text">' + esc(x.origin.fonte) + '</td><td class="nowrap">' + brl(x.origin.esperado) + '</td><td class="nowrap">' + brl(x.t.amount) + '</td></tr>'; }).join('');
    var estTable = g.estimativa.length ? '<div class="panel"><div class="ph"><h3>🟡 Correspondência encontrada — valor estimado, a conferir</h3><span class="footnote" style="margin:0">o valor esperado vem da solicitação de devolução/compensação, ainda não confirmado pela baixa — diferença aqui não é erro, é o normal até a conferência física</span></div><div class="table-wrap"><table class="report"><thead><tr><th>Data</th><th>Origem provável</th><th>Valor solicitado</th><th>Valor na carteira</th></tr></thead><tbody>' + estRows + '</tbody></table></div></div>' : '';
    var semRows = g.semOrigem.slice(0, 100).map(function (t) { return '<tr class="rowlink" data-wtx="' + esc(t.id) + '"><td class="nowrap">' + dbr(t.date) + '</td><td>' + esc(wcatLabel(wEffCat(t))) + '</td><td class="cell-text">' + esc((t.desc || '').slice(0, 60)) + '</td><td class="mono">' + esc(t.orderId || '—') + '</td><td class="nowrap">' + brl(t.amount) + '</td></tr>'; }).join('');
    var semTable = g.semOrigem.length ? '<div class="panel"><div class="ph"><h3>⚪ Pendência real — origem não identificada</h3><span class="footnote" style="margin:0">a fonte relevante já cobre a data deste lançamento e mesmo assim não encontrou correspondência</span></div><div class="table-wrap"><table class="report"><thead><tr><th>Data</th><th>Categoria</th><th>Descrição</th><th>Pedido</th><th>Valor</th></tr></thead><tbody>' + semRows + '</tbody></table></div></div>' : '';
    var foraRows = g.foraCobertura.slice(0, 100).map(function (t) { return '<tr class="rowlink" data-wtx="' + esc(t.id) + '"><td class="nowrap">' + dbr(t.date) + '</td><td>' + esc(wcatLabel(wEffCat(t))) + '</td><td class="cell-text">' + esc((t.desc || '').slice(0, 60)) + '</td><td class="mono">' + esc(t.orderId || '—') + '</td><td class="nowrap">' + brl(t.amount) + '</td></tr>'; }).join('');
    var foraTable = g.foraCobertura.length ? '<div class="panel"><div class="ph"><h3>⚫ Fora da cobertura de conciliação</h3><span class="footnote" style="margin:0">' + esc(covLine || 'sem cobertura calculada') + '</span></div><div class="table-wrap"><table class="report"><thead><tr><th>Data</th><th>Categoria</th><th>Descrição</th><th>Pedido</th><th>Valor</th></tr></thead><tbody>' + foraRows + '</tbody></table></div></div>' : '';
    var dupRows = g.dup.map(function (d) { return '<tr><td class="cell-text">' + esc(d.fonte) + '</td><td class="nowrap">' + brl(d.valor) + '</td><td>' + nn(d.itens.length) + '× na carteira</td></tr>'; }).join('');
    var dupTable = g.dup.length ? '<div class="panel"><div class="ph"><h3>🔴 Possível cobrança duplicada</h3><span class="footnote" style="margin:0">mesma origem esperada (fonte definitiva) apareceu mais de uma vez com o mesmo valor</span></div><div class="table-wrap"><table class="report"><thead><tr><th>Origem esperada</th><th>Valor</th><th>Ocorrências</th></tr></thead><tbody>' + dupRows + '</tbody></table></div></div>' : '';
    var nota = callout('', 'Origem automática', 'Para cada lançamento (Acelera, Devolução, Indenização, Renda), o sistema procura a origem esperada por ID exato do pedido — só ID/chave forte fecha conciliação automaticamente. Quando o lançamento é um resgate inteiro do Acelera (sem ID de pedido único), o sistema só sugere um CANDIDATO por valor+data, que precisa de confirmação manual. Acelera e Minha Renda/Income são fontes definitivas (🟢/🔴); Devolução e Compensação usam o valor solicitado, ainda provisório até a baixa. Lançamentos fora da janela de dados já importada em cada fonte não viram pendência — ficam marcados como fora da cobertura. Nunca soma o mesmo evento duas vezes: a carteira só confirma se o evento esperado aconteceu.' + (covLine ? '<div class="footnote" style="margin-top:6px">Cobertura atual: ' + esc(covLine) + '</div>' : ''));
    return nota + strip + divTable + candTable + estTable + semTable + foraTable + dupTable;
  }

  function renderCarteira() {
    app.innerHTML = devPeriodBar() +
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap"><div class="subtabs" style="margin-bottom:0">' + [['visao', 'Visão Geral'], ['mov', 'Movimentações'], ['ajustes', 'Ajustes e Divergências']].map(function (t) { return '<div class="subtab' + (walletSub === t[0] ? ' active' : '') + '" data-wsub="' + t[0] + '">' + t[1] + '</div>'; }).join('') + '</div><button class="btn-sm primary" data-wimport="1">Importar extrato</button></div><div id="wbody" style="margin-top:14px"></div>';
    var body = document.getElementById('wbody');
    try {
      if (!wallet.length) body.innerHTML = secHead('SALDO DA CARTEIRA', 'Saldo da Carteira', 'Mostrar, medir, rastrear e reconciliar tudo que acontece no saldo da Shopee.') + emptyBox('Nenhum extrato importado. Clique em “Importar extrato” para carregar o relatório de transações do saldo Shopee.') + '<div style="text-align:center;margin-top:-8px"><button class="btn-sm primary" id="wimp">Importar extrato</button></div>';
      else if (walletSub === 'mov') body.innerHTML = walletMov();
      else if (walletSub === 'ajustes') body.innerHTML = walletAjustes();
      else body.innerHTML = walletVisao();
    } catch (e) { body.innerHTML = '<div class="form-err">Erro ao renderizar a Carteira: ' + esc(e.message || e) + '</div>'; }
    bindDevPeriodBar();
    app.querySelectorAll('[data-wsub]').forEach(function (b) { b.onclick = function () { walletSub = b.dataset.wsub; render(); }; });
    var imp = function () { fileInput(function (f) { importWallet(f).then(function (b) { render(); toast('Extrato importado', b.novo + ' novas · ' + b.unch + ' já existentes'); }).catch(function (e) { toast('Falha', e.message, true); }); }); };
    var wi = document.getElementById('wimp'); if (wi) wi.onclick = imp;
    app.querySelectorAll('[data-wimport]').forEach(function (b) { b.onclick = imp; });
    app.querySelectorAll('[data-wtx]').forEach(function (b) { b.onclick = function () { openWalletTx(b.dataset.wtx); }; });
    app.querySelectorAll('[data-wcat]').forEach(function (b) { b.onclick = function () { walletF = { search: '', cat: b.dataset.wcat, flow: '', sig: '' }; walletSub = 'mov'; render(); }; });
    app.querySelectorAll('[data-wflowgo]').forEach(function (b) { b.onclick = function () { walletF = { search: '', cat: '', flow: b.dataset.wflowgo, sig: '' }; walletSub = 'mov'; render(); }; });
    app.querySelectorAll('[data-wsig]').forEach(function (b) { b.onclick = function () { walletF = { search: '', cat: '', flow: '', sig: b.dataset.wsig }; walletSub = 'mov'; render(); }; });
    app.querySelectorAll('[data-wgo]').forEach(function (b) { b.onclick = function () { walletSub = b.dataset.wgo; render(); }; });
    if (walletSub === 'mov') bindWalletMov();
  }
  function walletVisao() {
    var m = walletMetrics(); var g = walletDiag(m);
    var totalSaiAbs = Math.abs(g.totalSai) || 1;
    // BLOCO 1 — Situação + conferência Shopee × Sistema
    var conferido = g.divergentes.length === 0;
    var band = kstrip([
      { l: 'Saldo Shopee', v: brl(m.saldoAtual), cls: m.saldoAtual < 0 ? 'red' : 'blue', s: 'último do extrato' },
      { l: 'Saldo reconstruído', v: brl(m.saldoAtual), cls: 'blue', s: 'via reconciliação' },
      { l: 'Diferença', v: conferido ? 'R$ 0,00' : nn(g.divergentes.length) + ' aberta(s)', cls: conferido ? 'green' : 'red' },
      { l: 'Valor a ser ajustado', v: brl(m.ajusteAtual), cls: 'amber', s: 'snapshot (não somar)' },
      { l: 'Entradas', v: brl(m.entradas), cls: 'green', s: nn(m.entN) + ' créditos' },
      { l: 'Saídas', v: brl(m.saidas), cls: 'red', s: nn(m.saiN) + ' débitos' },
    ]);
    var conf = callout(conferido ? 'green' : 'warn', conferido ? '✓ Saldo conferido' : '⚠ Há movimentação a explicar', 'Shopee informa <b>' + brl(m.saldoAtual) + '</b> · sistema reconstruiu <b>' + brl(m.saldoAtual) + '</b>' + (conferido ? ' — a matemática bate. ' : ' — ') + (m.reconstructed.length ? '<b>' + nn(m.reconstructed.length) + '</b> movimentação(ões) sem linha foram reconstruídas (líquido ' + brl(m.semLinha) + ').' : '') + (conferido ? '' : ' <b>' + nn(g.divergentes.length) + '</b> diferença(s) ainda sem explicação — ver Ajustes e Divergências.'));
    // BLOCO 2 — Onde está saindo o dinheiro
    var leakRow = function (l) { var pctv = r2(Math.abs(l.total) / totalSaiAbs * 100); var isSem = l.cat === 'OUTRO'; return '<tr class="rowlink" data-wcat="' + l.cat + '"' + (isSem ? ' style="background:#fdf1e9"' : '') + '><td>' + esc(wcatLabel(l.cat)) + (l.cat === 'SEMLINHA' ? ' <span class="tag warn">sistema</span>' : '') + (isSem ? ' <span class="tag warn">sem classificação</span>' : '') + '</td><td>' + nn(l.n) + '</td><td class="neg"><b>' + brl(l.total) + '</b></td><td><span class="tag">' + pct(pctv) + '</span></td></tr>'; };
    var bloco2 = '<div class="panel"><div class="ph"><h3>Onde está saindo o dinheiro</h3><button class="link-btn" data-wgo="mov">Ver movimentações</button></div><div class="table-wrap"><table class="report"><thead><tr><th>Origem do desconto</th><th>Casos</th><th>Total</th><th>% das saídas</th></tr></thead><tbody>' + (g.leaks.length ? g.leaks.map(leakRow).join('') : '<tr><td colspan="4" class="empty">Sem saídas no período.</td></tr>') + '</tbody></table></div></div>';
    // BLOCO 3 — Impacto das devoluções + responsabilidade
    var respRow = function (rr) { return '<tr><td>' + esc(WRESP[rr.resp] || rr.resp) + (rr.resp === 'NAO_DEFINIDO' ? ' <span class="tag warn">definir</span>' : '') + '</td><td>' + nn(rr.n) + '</td><td class="neg"><b>' + brl(rr.total) + '</b></td></tr>'; };
    var bloco3 = '<div class="split2"><div class="panel"><div class="ph"><h3>Impacto das devoluções na carteira</h3><button class="link-btn" data-wcat="DEVOLUCAO">Ver</button></div><div class="pb">' +
      '<div class="fin-line"><span>Total descontado por devoluções</span><span class="neg"><b>' + brl(g.devTotal) + '</b></span></div>' +
      '<div class="fin-line"><span>Pedidos afetados</span><b>' + nn(g.devOrders) + '</b></div>' +
      '<div class="fin-line"><span>Valor médio descontado</span><span>' + brl(g.devN ? r2(g.devTotal / g.devN) : 0) + '</span></div>' +
      '<div class="fin-line"><span>Com devolução encontrada</span><b>' + nn(g.devComOcc) + '</b></div>' +
      '<div class="fin-line"><span>Sem devolução encontrada</span><b>' + nn(g.devSemOcc) + '</b></div></div></div>' +
      '<div class="panel"><div class="ph"><h3>Responsabilidade das devoluções</h3><span class="footnote" style="margin:0">do módulo Devoluções</span></div><div class="table-wrap"><table class="report"><thead><tr><th>Responsabilidade</th><th>Casos</th><th>Descontado</th></tr></thead><tbody>' + (g.resps.length ? g.resps.map(respRow).join('') : '<tr><td colspan="3" class="empty">Sem devoluções com débito.</td></tr>') + '</tbody></table></div></div></div>';
    // BLOCO 4 — Rastreamento
    var trk = function (label, o, flow) { return '<div class="kc" style="cursor:pointer" data-wflowgo="' + flow + '"><div class="kl">' + label + '</div><div class="kv" style="font-size:16px">' + nn(o.n) + '</div><div class="ks">' + brl(o.v) + '</div></div>'; };
    var totSaiN = g.comPedido.n + g.semPedido.n || 1;
    var bloco4 = '<div class="panel"><div class="ph"><h3>Rastreamento dos descontos</h3><span class="footnote" style="margin:0">' + pct(r2(g.comPedido.n / totSaiN * 100)) + ' com pedido · ' + pct(r2(g.comDev.n / totSaiN * 100)) + ' com devolução</span></div><div class="pb"><div class="kstrip" style="box-shadow:none;border:none">' + trk('Ligados a pedido', g.comPedido, 'pedido') + trk('Ligados a devolução', g.comDev, 'devolucao') + trk('Sem pedido', g.semPedido, 'sempedido') + trk('Sem categoria', g.semCat, 'semcat') + trk('Precisam de análise', g.precisa, 'precisa') + '</div></div></div>';
    // BLOCO 5 — Recorrentes
    var recRow = function (rp) { var un = rp.unclass > 0; return '<tr class="rowlink" data-wsig="' + esc(rp.sig) + '"><td class="cell-text">' + esc((rp.sample || rp.sig).slice(0, 60)) + (un ? ' <span class="tag warn">sem classe</span>' : '') + '</td><td>' + nn(rp.n) + '</td><td class="neg"><b>' + brl(rp.total) + '</b></td><td>' + esc(wcatLabel(rp.domCat)) + '</td><td class="footnote" style="margin:0">' + dbr(rp.last) + '</td></tr>'; };
    var bloco5 = g.recurring.length ? '<div class="panel"><div class="ph"><h3>Descontos recorrentes</h3><span class="footnote" style="margin:0">padrões repetidos (id/valor/data normalizados)</span></div><div class="table-wrap"><table class="report"><thead><tr><th>Padrão</th><th>Ocorrências</th><th>Total</th><th>Categoria</th><th>Última vez</th></tr></thead><tbody>' + g.recurring.slice(0, 10).map(recRow).join('') + '</tbody></table></div></div>' : '';
    // BLOCO 6 — Precisa de atenção
    var alerts = [];
    if (g.semCat.v < -0.5) alerts.push({ t: brl(Math.abs(g.semCat.v)) + ' em descontos sem categoria', f: 'semcat' });
    if (g.divergentes.length) alerts.push({ t: nn(g.divergentes.length) + ' diferença(s) de saldo ainda em aberto', go: 'ajustes' });
    var devSemResp = g.resps.filter(function (r) { return r.resp === 'NAO_DEFINIDO'; })[0]; if (devSemResp) alerts.push({ t: nn(devSemResp.n) + ' devoluções com débito sem responsabilidade definida', f: 'devolucao' });
    var recUn = g.recurring.filter(function (r) { return r.unclass > 0; })[0]; if (recUn) alerts.push({ t: 'Padrão recorrente sem classificação: "' + (recUn.sample || recUn.sig).slice(0, 40) + '" (' + recUn.n + '×, ' + brl(Math.abs(recUn.total)) + ')', sig: recUn.sig });
    var bloco6 = alerts.length ? callout('warn', 'Precisa da sua atenção', alerts.map(function (a) { return '<div class="fin-line"><span>' + esc(a.t) + '</span><button class="btn-sm" ' + (a.go ? 'data-wgo="' + a.go + '"' : a.sig ? 'data-wsig="' + esc(a.sig) + '"' : 'data-wflowgo="' + a.f + '"') + '>abrir</button></div>'; }).join('')) : '';
    // BLOCO 7 — gráfico
    var series = walletSaldoSeries();
    var chart = chartCard('Fluxo da carteira — evolução do saldo', legendSwatch([['Saldo', '#2b4bd6'], ['Valor a ajustar', '#e0662a']]), svgWalletLine(series, { two: true }));
    var origemPanel = walletOrigemPanel(m);
    return secHead('SALDO DA CARTEIRA', 'Raio-X da carteira', 'Onde o dinheiro está vazando: quanto, quantas vezes, por quê, em quais pedidos, de quem é a responsabilidade e o que ainda não conseguimos explicar.') +
      band + conf + bloco2 + bloco3 + bloco4 + bloco5 + bloco6 + chart + origemPanel;
  }
  var WFLOW_LABEL = { pedido: 'Ligados a um pedido', devolucao: 'Ligados a uma devolução', sempedido: 'Saídas sem pedido', semcat: 'Saídas sem categoria', precisa: 'Precisam de análise' };
  function walletMov() {
    var m = walletMetrics(); var txs = m.allTxsInP.slice();
    if (walletF.cat) txs = txs.filter(function (t) { return wEffCat(t) === walletF.cat; });
    if (walletF.sig) txs = txs.filter(function (t) { return t.amount < 0 && wSignature(t.desc) === walletF.sig; });
    var fl = walletF.flow;
    if (fl === 'ent') txs = txs.filter(function (t) { return t.amount > 0; });
    else if (fl === 'sai') txs = txs.filter(function (t) { return t.amount < 0; });
    else if (fl === 'recon') txs = txs.filter(function (t) { return t.origin === 'SISTEMA'; });
    else if (fl === 'ajuste') txs = txs.filter(function (t) { return t.adjust != null && Math.abs(t.adjust) > 0.01; });
    else if (fl === 'diverg') txs = txs.filter(function (t) { return (t.gap != null && Math.abs(t.gap) > 0.01) || t.origin === 'SISTEMA'; });
    else if (fl === 'pedido') txs = txs.filter(function (t) { return !!((wgetCls(t.id) && wgetCls(t.id).linkedOrderId) || t.orderId); });
    else if (fl === 'devolucao') txs = txs.filter(function (t) { return !!wLinkedOcc(t); });
    else if (fl === 'sempedido') txs = txs.filter(function (t) { return t.amount < 0 && !((wgetCls(t.id) && wgetCls(t.id).linkedOrderId) || t.orderId); });
    else if (fl === 'semcat') txs = txs.filter(function (t) { return t.amount < 0 && wEffCat(t) === 'OUTRO'; });
    else if (fl === 'precisa') txs = txs.filter(function (t) { return t.amount < 0 && !wIsExplained(t) && (wEffCat(t) === 'OUTRO' || wResp(t) === 'NAO_DEFINIDO'); });
    if (walletF.search) { var s = walletF.search.toLowerCase(); txs = txs.filter(function (t) { return (t.orderId || '').toLowerCase().indexOf(s) >= 0 || (t.desc || '').toLowerCase().indexOf(s) >= 0 || (wcatLabel(wEffCat(t))).toLowerCase().indexOf(s) >= 0 || (WRESP[wResp(t)] || '').toLowerCase().indexOf(s) >= 0 || String(Math.abs(t.amount)).indexOf(s) >= 0; }); }
    txs.sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
    var flows = [['', 'Todas'], ['ent', 'Entradas'], ['sai', 'Saídas'], ['recon', 'Reconstruídas'], ['ajuste', 'Com valor a ajustar'], ['diverg', 'Divergência']];
    var cats = [['', 'Categoria: todas']].concat(Object.keys(WCAT).map(function (k) { return [k, wcatLabel(k)]; }));
    var slice = txs.slice(0, 400);
    var special = (WFLOW_LABEL[fl] ? fl : '') || (walletF.sig ? 'sig' : '');
    var banner = special ? callout('', 'Filtro do Raio-X', (walletF.sig ? 'Mostrando o padrão recorrente: <b>' + esc((walletF.sig || '').slice(0, 60)) + '</b>.' : 'Mostrando: <b>' + esc(WFLOW_LABEL[fl]) + '</b>.') + ' <button class="link-btn" id="wclearsp">limpar filtro</button>') : '';
    return secHead('CARTEIRA · MOVIMENTAÇÕES', 'Movimentações', 'Rastreie cada valor: de onde veio, para onde foi, qual pedido, de quem é a responsabilidade e se o saldo fecha. Clique em “Classificar” para corrigir a categoria e definir a responsabilidade — sem alterar o dado da Shopee.') +
      banner +
      '<div class="chips">' + flows.map(function (c) { return '<span class="chip' + (walletF.flow === c[0] ? ' chip-on' : '') + '" data-wflow="' + c[0] + '">' + c[1] + '</span>'; }).join('') + '</div>' +
      '<div class="toolbar2" style="margin-top:8px"><input class="input sm" id="wq" style="width:280px" placeholder="Buscar pedido, descrição, valor, categoria ou responsável…" value="' + esc(walletF.search) + '"><select class="select sm" id="wcatsel">' + cats.map(function (c) { return '<option value="' + c[0] + '"' + (walletF.cat === c[0] ? ' selected' : '') + '>' + c[1] + '</option>'; }).join('') + '</select>' + (walletF.cat || walletF.flow || walletF.search || walletF.sig ? '<button class="link-btn" id="wclear">limpar tudo</button>' : '') + '</div>' +
      '<div class="count-line"><b>' + nn(txs.length) + '</b> movimentações' + (txs.length > slice.length ? ' · mostrando as ' + nn(slice.length) + ' mais recentes' : '') + '</div>' +
      '<div class="panel"><div class="table-wrap"><table class="report"><thead><tr><th>Data</th><th>Categoria</th><th>Responsável</th><th>Pedido</th><th>Descrição</th><th>Entrada</th><th>Saída</th><th>Saldo após</th><th>Situação</th><th></th></tr></thead><tbody>' +
      (slice.length ? slice.map(function (t) {
        var isRec = t.origin === 'SISTEMA'; var c = wgetCls(t.id); var man = c && c.catManual; var st = wStatus(t); var stl = WSTATUS[st];
        var stTag = st === 'EXPLICADO' || st === 'RESOLVIDO' ? 'ok' : (st === 'CONTESTACAO' ? 'warn' : (st === 'EM_ANALISE' ? 'info' : 'neutral'));
        var resp = wResp(t); var respTxt = resp === 'NAO_DEFINIDO' && t.amount >= 0 ? '—' : (WRESP[resp] || '—');
        return '<tr' + (isRec ? ' style="background:#fff5ee"' : '') + '><td class="nowrap">' + esc(dbr(t.date)) + '</td><td>' + esc(wcatLabel(wEffCat(t))) + (man ? ' <span class="tag info">manual</span>' : '') + '</td><td class="cell-text">' + esc(respTxt) + (resp === 'NAO_DEFINIDO' && t.amount < 0 ? ' <span class="tag warn">definir</span>' : '') + '</td><td class="mono">' + esc((c && c.linkedOrderId) || t.orderId || '—') + '</td><td class="cell-text">' + esc(isRec ? 'Diferença de saldo reconstruída' : (t.desc || '—')) + '</td><td class="nowrap">' + (t.amount > 0 ? '<span class="pos">' + brl(t.amount) + '</span>' : '—') + '</td><td class="nowrap">' + (t.amount < 0 ? '<span class="neg">' + brl(t.amount) + '</span>' : '—') + '</td><td class="nowrap">' + (t.balance != null ? brl(t.balance) : '—') + '</td><td class="nowrap"><span class="tag ' + stTag + '">' + esc(stl) + '</span></td><td class="nowrap"><button class="btn-sm" data-wtx="' + esc(t.id) + '">Classificar</button></td></tr>';
      }).join('') : '<tr><td colspan="10" class="empty">Nenhuma movimentação neste filtro.</td></tr>') + '</tbody></table></div></div>';
  }
  function bindWalletMov() {
    var q = document.getElementById('wq'); if (q) { var tt; q.oninput = function () { clearTimeout(tt); tt = setTimeout(function () { var v = q.value; walletF.search = v; render(); var el = document.getElementById('wq'); if (el) { el.focus(); el.value = v; el.setSelectionRange(v.length, v.length); } }, 220); }; }
    app.querySelectorAll('[data-wflow]').forEach(function (c) { c.onclick = function () { walletF.flow = c.dataset.wflow; walletF.sig = ''; render(); }; });
    var cs = document.getElementById('wcatsel'); if (cs) cs.onchange = function () { walletF.cat = cs.value; render(); };
    var cl = document.getElementById('wclear'); if (cl) cl.onclick = function () { walletF = { search: '', cat: '', flow: '', sig: '' }; render(); };
    var csp = document.getElementById('wclearsp'); if (csp) csp.onclick = function () { walletF.flow = ''; walletF.sig = ''; render(); };
  }
  function walletAjustes() {
    var m = walletMetrics(); var diffs = m.diffsAll.filter(function (d) { return inPeriod(d.date); });
    var series = walletSaldoSeries();
    var abat = m.diffsAll.filter(function (d) { return d.status === 'PROVAVEL'; }).reduce(function (s, d) { return s + Math.abs(d.gap); }, 0);
    var divergentes = diffs.filter(function (d) { return d.status === 'DIVERGENTE'; });
    // Diferenças já tratadas manualmente pelo operador (explicado / contestação / resolvido) — não altera a matemática.
    var tratadas = diffs.filter(function (d) { return wIsExplained(d.rec) || wStatus(d.rec) === 'CONTESTACAO' || wStatus(d.rec) === 'EM_ANALISE'; }).length;
    var abertas = diffs.filter(function (d) { return d.status === 'DIVERGENTE' && !wIsExplained(d.rec) && wStatus(d.rec) !== 'CONTESTACAO' && wStatus(d.rec) !== 'EM_ANALISE'; });
    var conferido = abertas.length === 0;
    // BLOCO — Conferência Shopee × Sistema (nunca altera a matemática; apenas mostra e deixa classificar)
    var conf = callout(conferido ? 'green' : 'warn', conferido ? '✓ Saldo conferido' : '⚠ Há diferenças a explicar',
      'A Shopee informa o saldo final de <b>' + brl(m.saldoAtual) + '</b>. Somando saldo anterior + cada movimentação, o sistema reconstrói o mesmo saldo — as linhas fecham em <b>' + nn(diffs.length ? diffs.length : 0) + '</b> ponto(s) de diferença' + (diffs.length ? '' : ' (nenhum)') + '. ' +
      (diffs.length ? '<b>' + nn(m.diffsAll.filter(function (d) { return d.status === 'PROVAVEL'; }).length) + '</b> são compatíveis com a variação do “Valor a Ser Ajustado” (provável abatimento), <b>' + nn(tratadas) + '</b> você já classificou e <b>' + nn(abertas.length) + '</b> seguem sem explicação. A conferência <b>não muda nenhum número</b> — só registra o porquê.' : 'A matemática bate integralmente.'));
    return secHead('CARTEIRA · AJUSTES E DIVERGÊNCIAS', 'Ajustes e Divergências', 'Conferência do saldo Shopee × sistema. Tudo que não fecha perfeitamente é mostrado e pode ser classificado (explicado, contestação, resolvido) — sem nunca alterar a matemática.') +
      kstrip([
        { l: 'Valor atual a ser ajustado', v: brl(m.ajusteAtual), cls: 'amber', s: 'snapshot (não somar)' },
        { l: 'Maior valor do período', v: brl(m.peakAdj), cls: 'amber' },
        { l: 'Dias com valor a ajustar', v: nn(m.adjDays), cls: 'blue' },
        { l: 'Prováveis abatimentos', v: brl(r2(abat)), cls: 'green' },
        { l: 'Diferenças em aberto', v: nn(abertas.length), cls: abertas.length ? 'red' : 'green' },
      ]) +
      conf +
      chartCard('Evolução do valor a ser ajustado (é estoque — não somar)', legendSwatch([['Valor a ajustar', '#e0662a']]), svgWalletLine(series.map(function (p) { return { label: p.label, a: p.b }; }), { two: false })) +
      '<div class="panel"><div class="ph"><h3>Diferenças de saldo</h3><span class="footnote" style="margin:0">saldo esperado × informado pela Shopee — clique em “Classificar” para explicar sem alterar a matemática</span></div><div class="table-wrap"><table class="report"><thead><tr><th>Data</th><th>Saldo esperado</th><th>Saldo informado</th><th>Diferença</th><th>Situação</th><th>Classificação</th><th></th></tr></thead><tbody>' +
      (diffs.length ? diffs.slice().sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); }).slice(0, 300).map(function (d) { var rl = RECON_LABEL[d.status] || RECON_LABEL.DIVERGENTE; var st = wStatus(d.rec); var stl = WSTATUS[st]; var stTag = st === 'EXPLICADO' || st === 'RESOLVIDO' ? 'ok' : (st === 'CONTESTACAO' ? 'warn' : (st === 'EM_ANALISE' ? 'info' : 'neutral')); return '<tr><td class="nowrap">' + esc(dbr(d.date)) + '</td><td class="nowrap">' + brl(d.expected) + '</td><td class="nowrap">' + brl(d.informed) + '</td><td class="nowrap ' + (d.gap < 0 ? 'neg' : 'pos') + '"><b>' + brl(d.gap) + '</b></td><td><span class="tag ' + rl[1] + '">' + rl[0] + '</span></td><td class="nowrap"><span class="tag ' + stTag + '">' + esc(stl) + '</span></td><td><button class="btn-sm" data-wtx="' + esc(d.rec.id) + '">Classificar</button></td></tr>'; }).join('') : '<tr><td colspan="7" class="empty">Nenhuma diferença de saldo no período. 🎉 A matemática bate.</td></tr>') + '</tbody></table></div>' +
      '<div class="footnote" style="padding:0 16px 14px">Situação (matemática, automática): <b>Provável ajuste</b> a diferença é compatível com a variação do “Valor a Ser Ajustado” · <b>Divergente</b> ainda não explicada. Classificação (sua, manual): registre <b>Explicado</b>, <b>Contestação necessária</b> ou <b>Resolvido</b> — nada disso altera os valores.</div></div>';
  }
  function walletExplain(t) {
    if (t.origin === 'SISTEMA') {
      var base = 'A movimentação registrada não fecha o saldo: o esperado era ' + brl(t.expectedBalance) + ' e a Shopee informou ' + brl(t.informed) + ', uma diferença de ' + brl(t.amount) + '. ';
      if (t.reconStatus === 'PROVAVEL' && t.adjDelta != null) return base + 'O sistema encontrou uma variação equivalente no “Valor a Ser Ajustado” (' + brl(t.adjDelta) + '). Classificação: provável ajuste de saldo pendente — não há linha explícita da Shopee.';
      return base + 'Ainda não foi possível relacionar essa diferença a outro evento com segurança. Precisa de investigação.';
    }
    var parts = ['Movimentação de ' + (t.amount >= 0 ? '+' : '') + brl(t.amount) + ' classificada como ' + wcatLabel(t.category) + '.'];
    if (t.orderId) { var ord = orders.find(function (o) { return o.id === t.orderId; }); var oc = occ.find(function (o) { return !o.isDemo && o.orderId === t.orderId; }); parts.push('Relacionada ao pedido ' + t.orderId + (ord ? ' (status ' + (S.pedidos.labels[ord.normalizedStatus] || ord.orderStatus || '—') + ')' : ' (não importado em Pedidos)') + '.'); if (oc) parts.push('O mesmo pedido possui uma devolução registrada no sistema (' + (statusLabel(oc.status)) + ').'); }
    if (t.gap != null && Math.abs(t.gap) > 0.01) parts.push('Atenção: o saldo após esta movimentação não fechou exatamente — veja a diferença reconstruída próxima a esta data.'); else if (t.gap === 0) parts.push('O saldo fechou matematicamente após esta movimentação.');
    return parts.join(' ');
  }
  function openWalletTx(id) {
    var rec = reconcileWallet(); var t = rec.txs.find(function (x) { return x.id === id; }); if (!t) return;
    var isRec = t.origin === 'SISTEMA';
    var d = document.createElement('div'); d.className = 'drawer'; var panel = document.createElement('div'); panel.className = 'drawer-panel'; panel.style.width = '640px'; panel.style.maxWidth = '96vw';
    d.appendChild(panel); d.onclick = function (e) { if (e.target === d) d.remove(); }; document.body.appendChild(d);
    var ord = t.orderId ? orders.find(function (o) { return o.id === t.orderId; }) : null;
    var oc = t.orderId ? occ.find(function (o) { return !o.isDemo && o.orderId === t.orderId; }) : null;
    var recon = (t.expectedBalance != null) ? '<div class="panel"><div class="ph"><h3>Reconciliação</h3></div><div class="pb"><div class="fin-line"><span>Saldo anterior</span><span>' + brl(r2((t.expectedBalance) - (t.amount || 0))) + '</span></div><div class="fin-line"><span>' + (t.amount >= 0 ? '+ movimentação' : '− movimentação') + '</span><span>' + brl(t.amount) + '</span></div><div class="fin-line"><span>Saldo esperado</span><span>' + brl(t.expectedBalance) + '</span></div><div class="fin-line"><span>Saldo informado</span><span>' + brl(isRec ? t.informed : t.balance) + '</span></div><div class="fin-line total"><span>Diferença</span><span class="' + ((t.gap || 0) < 0 ? 'neg' : 'pos') + '">' + brl(isRec ? 0 : (t.gap || 0)) + '</span></div></div></div>' : '';
    var pedido = (t.orderId && ord) ? '<div class="panel"><div class="ph"><h3>Pedido relacionado</h3></div><div class="pb"><div class="fin-line"><span>Pedido ' + esc(t.orderId) + '</span><span>' + esc(S.pedidos.labels[ord.normalizedStatus] || ord.orderStatus || '—') + '</span></div><div class="fin-line"><span>Valor</span><span>' + brl(ord.totalAmount || 0) + '</span></div><button class="btn-sm" data-goped="' + esc(t.orderId) + '">Ver pedido</button></div></div>' : (t.orderId ? '<div class="footnote">Pedido ' + esc(t.orderId) + ' não encontrado no módulo Pedidos.</div>' : '');
    var devol = (t.orderId && oc) ? '<div class="panel"><div class="ph"><h3>Devolução relacionada</h3><span class="tag info">' + esc(statusLabel(oc.status)) + '</span></div><div class="pb"><div class="fin-line"><span>Pedido</span><span class="mono">' + esc(t.orderId) + '</span></div><div class="fin-line"><span>Motivo</span><span class="cell-text">' + esc(oc.reason || '—') + '</span></div><div class="fin-line"><span>Valor descontado da carteira</span><span class="neg">' + brl(t.amount) + '</span></div><button class="btn-sm" data-godev="' + esc(oc.id) + '">Ver devolução</button></div></div>' : '';
    var c = wgetCls(t.id) || {};
    var opt = function (map, sel, autoLbl) { return (autoLbl ? '<option value="">' + autoLbl + '</option>' : '') + Object.keys(map).map(function (k) { return '<option value="' + k + '"' + (sel === k ? ' selected' : '') + '>' + map[k] + '</option>'; }).join(''); };
    var classify = '<div class="panel"><div class="ph"><h3>Classificar / corrigir</h3><span class="footnote" style="margin:0">interno — não altera o dado Shopee</span></div><div class="pb">' +
      '<label class="fld">Categoria</label><select class="select" id="wcls-cat" style="width:100%">' + opt(WCAT, c.catManual, '(automática: ' + wcatLabel(t.category) + ')') + '</select>' +
      '<label class="fld">Subcategoria (opcional)</label><input class="input" id="wcls-sub" style="width:100%" value="' + esc(c.subcat || '') + '" placeholder="ex.: Produto avariado">' +
      '<label class="fld">Responsabilidade</label><select class="select" id="wcls-resp" style="width:100%">' + opt(WRESP, c.responsibility || wResp(t)) + '</select>' +
      '<label class="fld">Status da análise</label><select class="select" id="wcls-st" style="width:100%">' + opt(WSTATUS, c.internalStatus || 'NAO_REVISADO') + '</select>' +
      '<label class="fld">Vincular pedido (ID)</label><input class="input" id="wcls-ord" style="width:100%" value="' + esc(c.linkedOrderId || '') + '" placeholder="' + (t.orderId ? 'auto: ' + esc(t.orderId) : 'ID do pedido') + '">' +
      '<label class="fld">Observação interna</label><input class="input" id="wcls-note" style="width:100%" value="' + esc(c.note || '') + '" placeholder="ex.: confirmado como erro de embalagem da operação">' +
      '<div style="margin-top:10px"><button class="btn-sm primary" id="wcls-save">Salvar classificação</button></div>' +
      ((c.history && c.history.length) ? '<div class="footnote" style="margin-top:10px">Histórico:</div>' + c.history.slice(0, 6).map(function (h) { return '<div class="fin-line"><span>' + (h.changes && h.changes.length ? h.changes.map(function (ch) { return esc(ch.field) + ': ' + esc(ch.old || '∅') + '→' + esc(ch.nw); }).join(' · ') : esc(h.obs || 'obs')) + '</span><span class="footnote" style="margin:0">' + new Date(h.at).toLocaleString('pt-BR') + ' · ' + esc(h.user) + '</span></div>'; }).join('') : '') +
      '</div></div>';
    panel.innerHTML = '<div class="dh"><div><b>' + (isRec ? 'Ajuste reconstruído' : 'Movimentação') + '</b> ' + (isRec ? '<span class="tag warn" style="margin-left:6px">SISTEMA</span>' : '<span class="tag ok" style="margin-left:6px">SHOPEE</span>') + ' <span class="tag ' + (wStatus(t) === 'EXPLICADO' || wStatus(t) === 'RESOLVIDO' ? 'ok' : 'neutral') + '" style="margin-left:6px">' + (WSTATUS[wStatus(t)]) + '</span></div><button class="x">&times;</button></div><div class="dbd">' +
      '<div class="kstrip" style="margin-bottom:12px"><div class="kc"><div class="kl">Valor</div><div class="kv" style="font-size:20px;color:' + (t.amount < 0 ? 'var(--err)' : 'var(--ok)') + '">' + brl(t.amount) + '</div></div><div class="kc"><div class="kl">Categoria</div><div class="kv" style="font-size:15px">' + esc(wcatLabel(wEffCat(t))) + (c.catManual ? ' <span class="tag info">manual</span>' : '') + '</div></div><div class="kc"><div class="kl">Responsabilidade</div><div class="kv" style="font-size:14px">' + esc(WRESP[wResp(t)]) + '</div></div></div>' +
      callout('', '✨ Explicar', walletExplain(t)) +
      classify +
      '<div class="panel"><div class="ph"><h3>Movimentação (Shopee)</h3></div><div class="pb">' + kv('Tipo (Shopee)', t.tipo || (isRec ? 'Reconstruído pelo sistema' : '—')) + kv('Categoria automática', wcatLabel(t.category)) + kv('Saldo após', t.balance != null ? brl(t.balance) : '—') + kv('Valor a ser ajustado', t.adjust != null ? brl(t.adjust) : '—') + '</div></div>' +
      (isRec ? '' : '<details class="panel" style="padding:0"><summary style="cursor:pointer;padding:12px 16px;font-weight:700">Descrição original da Shopee</summary><div class="pb"><div class="ro">' + esc(t.desc || '—') + '</div></div></details>') +
      recon + pedido + devol + '</div>';
    panel.querySelector('.x').onclick = function () { d.remove(); };
    panel.querySelector('#wcls-save').onclick = function () {
      var patch = { catManual: panel.querySelector('#wcls-cat').value || null, subcat: panel.querySelector('#wcls-sub').value.trim() || null, responsibility: panel.querySelector('#wcls-resp').value || null, internalStatus: panel.querySelector('#wcls-st').value || null, linkedOrderId: panel.querySelector('#wcls-ord').value.trim() || null };
      wsetCls(t.id, patch, panel.querySelector('#wcls-note').value.trim() || null, 'Operador').then(function () { d.remove(); render(); toast('Classificação salva', ''); });
    };
    var gp = panel.querySelector('[data-goped]'); if (gp) gp.onclick = function () { d.remove(); route = 'pedidos'; sub.pedidos = 'pedidos'; render(); };
    var gd = panel.querySelector('[data-godev]'); if (gd) gd.onclick = function () { var id2 = gd.dataset.godev; d.remove(); route = 'posvenda'; sub.posvenda = 'casos'; render(); setTimeout(function () { openFicha(id2); }, 60); };
  }

  // ======================= SHOPEE ACELERA / ANTECIPAÇÃO DE RECEBÍVEIS =======================
  // Motor 100% determinístico. Dinheiro sempre em CENTAVOS inteiros (evita erro de ponto flutuante).
  // IDs longos sempre string. Nada de LLM em cálculo financeiro. Nada inventado: lacuna é declarada.
  function brlC(c) { return brl((c || 0) / 100); }
  function acCleanId(s) { return String(s == null ? '' : s).replace(/^\s*=?\s*"?/, '').replace(/"?\s*$/, '').trim(); }
  function acMoneyCents(s) {
    if (s == null) return 0; var t = String(s).replace(/^\s*=?\s*"?/, '').replace(/"?\s*$/, '').replace(/r\$/i, '').replace(/\s/g, '').trim();
    if (t === '' || t === '-') return 0; var neg = /^-/.test(t); t = t.replace(/^-/, '');
    if (t.indexOf(',') >= 0 && t.indexOf('.') >= 0) t = t.replace(/\./g, '').replace(',', '.'); else if (t.indexOf(',') >= 0) t = t.replace(',', '.');
    var n = parseFloat(t); if (isNaN(n)) return 0; return Math.round(n * 100) * (neg ? -1 : 1);
  }
  function acPct(s) { if (s == null) return null; var t = String(s).replace('%', '').replace(',', '.').trim(); var n = parseFloat(t); return isNaN(n) ? null : n / 100; }
  function acDays(a, b) { if (!a || !b) return null; var da = new Date(a), db = new Date(b); if (isNaN(da) || isNaN(db)) return null; return Math.round((db - da) / 864e5); }
  function acAgeDays(d) { if (!d) return null; var x = new Date(d); if (isNaN(x)) return null; return Math.floor((Date.now() - x.getTime()) / 864e5); }
  function acIsReemb(r) { return /reembols/.test(normStatus(r.status)); }
  function acIsFullyPaid(r) { return normStatus(r.status).indexOf('totalmente pago') >= 0; }
  function acIsSettled(r) { return acIsFullyPaid(r) || acIsReemb(r); }
  // Alíquota agrupada pela taxa efetiva encontrada nos dados (taxa ÷ antecipado) — nunca assumimos
  // faixas fixas como 2,5%/3,5%: a distribuição é sempre a dos dados reais (§21 da refatoração).
  function acAliqKey(rate) { return (rate == null) ? '—' : pct(r2(rate * 100)); }
  var AC_STATUS_LABELS = { 'antecipacao paga': 'Antecipação paga', 'totalmente pago': 'Totalmente pago', 'antecipacao parcialmente reembolsada': 'Parcialmente reembolsada', 'antecipacao totalmente reembolsada': 'Totalmente reembolsada' };
  function acStatusLabel(s) { return AC_STATUS_LABELS[normStatus(s)] || s || '—'; }
  // Líquido calculado deterministicamente (antecipado − taxa), conferido contra o líquido informado
  // pela própria Shopee (campo "Recebido") — tolerância de 2 centavos por arredondamento.
  function acLiquidoCalc(r) { return r.antecipado - r.taxa; }
  function acLiquidoDiff(r) { return r.recebido - acLiquidoCalc(r); }
  function acLiquidoDivergente(r) { return Math.abs(acLiquidoDiff(r)) > 2; }
  // §15 da correção: "Data do resgate rápido" chega como string pura YYYY-MM-DD, sem hora. new Date(str)
  // interpreta isso como UTC meia-noite, que em fusos negativos (America/Sao_Paulo) pode exibir o dia
  // anterior. Este helper força a interpretação como data LOCAL (nunca UTC) — usado só dentro do Acelera,
  // nunca substitui o dbr() global (usado por outros módulos já aprovados).
  function acLocalDate(dstr) { if (!dstr) return null; var x = new Date(String(dstr).slice(0, 10) + 'T00:00:00'); return isNaN(x) ? null : x; }
  function acDbr(dstr) { var x = acLocalDate(dstr); return x ? x.toLocaleDateString('pt-BR') : '—'; }
  // Mesma lógica de periodRange()/inPeriod(), mas usando acLocalDate() para nunca sofrer o desvio de
  // fuso horário de datas sem hora — critério de aceite explícito para America/Sao_Paulo (§15).
  function acInPeriod(dstr) { var r = periodRange(); var d = acLocalDate(dstr); if (!d) return true; if (r.from && d < r.from) return false; if (r.to && d > r.to) return false; return true; }

  // Parser do CSV/planilha real da Shopee (localiza cabeçalho dinamicamente; guarda o resumo da Shopee).
  function parseAceleraText(text) {
    var res = { notRecognized: true, rows: [], summary: null, periodDeclared: null, periodReal: null };
    var lines = String(text).replace(/^﻿/, '').split(/\r?\n/);
    var split = function (l) { return l.split(','); }; // formato real: sem vírgula dentro de campos (o ="..." não tem vírgula)
    var hi = -1;
    for (var i = 0; i < Math.min(lines.length, 40); i++) { var ln = normStatus(lines[i]); if (ln.indexOf('data do resgate') >= 0 && ln.indexOf('id do pedido') >= 0 && ln.indexOf('status') >= 0) { hi = i; break; } }
    if (hi < 0) return res;
    // Resumo Shopee (linhas antes do cabeçalho): pares rótulo,valor
    var sum = {}; var declared = null;
    for (var j = 0; j < hi; j++) {
      var cells = split(lines[j]); for (var k = 0; k < cells.length - 1; k++) {
        var lab = normStatus(cells[k]);
        if (lab.indexOf('periodo') >= 0) declared = (cells[k + 1] || '').trim();
        if (lab.indexOf('numero de resgates') >= 0) sum.nResgates = parseInt(cells[k + 1], 10) || 0;
        if (lab === 'taxa de servico:' || (lab.indexOf('taxa de servico') >= 0 && sum.taxa == null)) sum.taxa = acMoneyCents(cells[k + 1]);
        if (lab.indexOf('resgates rapidos reembolsados') >= 0) sum.nReembolsados = parseInt(cells[k + 1], 10) || 0;
        if (lab.indexOf('resgates a reembolsar') >= 0) sum.nAReembolsar = parseInt(cells[k + 1], 10) || 0;
        if (lab === 'vencido:' || lab.indexOf('vencido') === 0) sum.nVencido = parseInt(cells[k + 1], 10) || 0;
        if (lab.indexOf('valor total dos resgates') >= 0) sum.volume = acMoneyCents(cells[k + 1]);
        if (lab.indexOf('valor recebido') >= 0) sum.recebido = acMoneyCents(cells[k + 1]);
        if (lab.indexOf('valor da pendencia') >= 0) sum.reembolsado = acMoneyCents(cells[k + 1]);
        if (lab === 'valor pendente:' || (lab.indexOf('valor pendente') >= 0 && lab.indexOf('vencid') < 0)) sum.pendente = acMoneyCents(cells[k + 1]);
        if (lab.indexOf('pendencias vencidas') >= 0) sum.vencidoValor = acMoneyCents(cells[k + 1]);
      }
    }
    var rows = [], minD = null, maxD = null;
    for (var r = hi + 1; r < lines.length; r++) {
      var c = split(lines[r]); if (c.length < 15) continue; var data = (c[0] || '').trim(); var resg = acCleanId(c[1]); var ped = acCleanId(c[2]); if (!data || !resg || !ped) continue;
      var rec = { data: data, resgate: resg, pedido: ped, disponivel: acMoneyCents(c[3]), pctAntecip: acPct(c[4]), antecipado: acMoneyCents(c[5]), taxa: acMoneyCents(c[6]), recebido: acMoneyCents(c[7]), restante: acMoneyCents(c[8]), reembolsado: acMoneyCents(c[9]), faturamento: acMoneyCents(c[10]), pendente: acMoneyCents(c[11]), status: (c[12] || '').trim(), ultimaTransacao: (c[13] || '').trim(), vencimento: (c[14] || '').trim() };
      rows.push(rec); if (!minD || data < minD) minD = data; if (!maxD || data > maxD) maxD = data;
    }
    if (!rows.length) return res;
    res.notRecognized = false; res.rows = rows; res.summary = sum; res.periodDeclared = declared; res.periodReal = { min: minD, max: maxD };
    return res;
  }
  function importAcelera(file) {
    return file.arrayBuffer().then(function (ab) {
      var name = (file.name || '').toLowerCase(); var text;
      if (name.slice(-5) === '.xlsx' || name.slice(-4) === '.xls') { var wb = XLSX.read(new Uint8Array(ab), { type: 'array' }); text = XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]]); }
      else { text = new TextDecoder('utf-8').decode(ab).replace(/^﻿/, ''); }
      var parsed = parseAceleraText(text);
      if (parsed.notRecognized) throw new Error('Relatório do Shopee Acelera não reconhecido (esperado o CSV de antecipação de recebíveis da Shopee).');
      var byId = {}; acelera.forEach(function (x) { byId[x.id] = x; });
      var novo = 0, upd = 0, unch = 0, changed = []; var importedAt = new Date().toISOString();
      parsed.rows.forEach(function (row) {
        var id = 'default|' + row.resgate + '|' + row.pedido; var ex = byId[id];
        if (!ex) { var rec = Object.assign({ id: id, storeId: 'default', firstImportAt: importedAt, lastImportAt: importedAt, fileName: file.name, history: [] }, row); byId[id] = rec; changed.push(rec); novo++; return; }
        var same = ex.antecipado === row.antecipado && ex.taxa === row.taxa && ex.recebido === row.recebido && ex.reembolsado === row.reembolsado && ex.pendente === row.pendente && normStatus(ex.status) === normStatus(row.status) && ex.ultimaTransacao === row.ultimaTransacao;
        if (same) { unch++; return; }
        // registro evolui: preserva histórico e atualiza estado atual (§6-7)
        ex.history = ex.history || []; ex.history.unshift({ at: importedAt, file: file.name, statusOld: ex.status, statusNew: row.status, reembOld: ex.reembolsado, reembNew: row.reembolsado, pendOld: ex.pendente, pendNew: row.pendente, ultima: row.ultimaTransacao });
        ex.status = row.status; ex.recebido = row.recebido; ex.restante = row.restante; ex.reembolsado = row.reembolsado; ex.pendente = row.pendente; ex.faturamento = row.faturamento; ex.ultimaTransacao = row.ultimaTransacao; ex.vencimento = row.vencimento; ex.taxa = row.taxa; ex.antecipado = row.antecipado; ex.lastImportAt = importedAt;
        changed.push(ex); upd++;
      });
      acelera = Object.values(byId);
      aceleraSummary = { summary: parsed.summary, periodDeclared: parsed.periodDeclared, periodReal: parsed.periodReal, importedAt: importedAt, fileName: file.name, rowsSeen: parsed.rows.length };
      // §20: metadados do ARQUIVO (não do resgate) para a aba Importações — computados uma vez aqui,
      // a partir de TODAS as linhas deste arquivo (novas + atualizadas + sem alteração).
      var pedSet = {}, resgSet = {}; parsed.rows.forEach(function (row) { pedSet[row.pedido] = 1; resgSet[row.resgate] = 1; });
      var batch = { id: 'ac' + Date.now() + Math.round(performance.now()), module: 'Shopee Acelera', filename: file.name, createdAt: importedAt, seen: parsed.rows.length, novo: novo, upd: upd, unch: unch, itemsSeen: parsed.rows.length, pedidosUnicos: Object.keys(pedSet).length, resgatesUnicos: Object.keys(resgSet).length, periodMin: parsed.periodReal ? parsed.periodReal.min : null, periodMax: parsed.periodReal ? parsed.periodReal.max : null };
      batches.unshift(batch); lastImportStamp = importedAt;
      return Promise.all([putMany('acelera', changed), putMany('batches', [batch]), putMany('settings', [{ id: 'aceleraSummary', data: aceleraSummary }])]).then(function () { return { batch: batch, novo: novo, upd: upd, unch: unch }; });
    });
  }
  function saveAceleraCfg() { return putMany('settings', [{ id: 'aceleraCfg', data: aceleraCfg }]); }

  // ---- motor determinístico ----
  // §11-13 da correção: chave lógica LOJA + ID_RESGATE + ID_PEDIDO. Agrupar por resgate NUNCA
  // deduplica por data — vários resgates podem cair no mesmo dia, cada um contado uma vez. A data
  // consolidada do resgate é a MÁXIMA entre as linhas do resgate (nunca a mínima) — validado contra
  // a tela oficial da Shopee: um resgate aparece na UI oficial na data da sua ÚLTIMA linha, não da
  // primeira. Usar o mínimo fragmenta visualmente resgates cujas linhas cruzam vários dias (§13).
  function aceleraByResgate(recs) {
    var map = {}; recs.forEach(function (r) { var g = map[r.resgate] = map[r.resgate] || { resgate: r.resgate, data: r.data, n: 0, antec: 0, taxa: 0, receb: 0, reemb: 0, pend: 0, disp: 0, maxUlt: '' }; g.n++; g.antec += r.antecipado; g.taxa += r.taxa; g.receb += r.recebido; g.reemb += r.reembolsado; g.pend += r.pendente; g.disp += (r.disponivel || 0); if (r.data > g.data) g.data = r.data; if ((r.ultimaTransacao || '') > g.maxUlt) g.maxUlt = r.ultimaTransacao; });
    return Object.keys(map).map(function (k) { var g = map[k]; g.rate = g.antec ? g.taxa / g.antec : 0; g.aliqLabel = acAliqKey(g.rate); g.liquidoCalc = g.antec - g.taxa; g.liquidoDiff = g.receb - g.liquidoCalc; g.divergente = Math.abs(g.liquidoDiff) > 2; return g; }).sort(function (a, b) { return (a.data || '').localeCompare(b.data || ''); });
  }
  // §14 da correção: agregação por DIA — usada só para agrupar visualmente o gráfico/resumo "dia a
  // dia"; nunca é a chave de deduplicação (essa é loja+resgate+pedido). Consolida por RESGATE
  // primeiro (via aceleraByResgate) e só então agrupa por dia — um resgate nunca aparece dividido
  // em dois dias diferentes, mesmo que suas linhas individuais carreguem datas distintas.
  function aceleraByDia(recs) {
    var resgates = aceleraByResgate(recs);
    var map = {};
    resgates.forEach(function (g) {
      var d = map[g.data] = map[g.data] || { data: g.data, nResgates: 0, pedidosSet: {}, antec: 0, taxa: 0, receb: 0, reemb: 0, pend: 0 };
      d.nResgates++; d.antec += g.antec; d.taxa += g.taxa; d.receb += g.receb; d.reemb += g.reemb; d.pend += g.pend;
    });
    // reconstruir pedidosSet corretamente: para cada resgate consolidado, contar os pedidos das
    // linhas originais que pertencem a ele (não redistribuir por linha — a data já é a do resgate).
    var recsByResgate = {}; recs.forEach(function (r) { (recsByResgate[r.resgate] = recsByResgate[r.resgate] || []).push(r); });
    Object.keys(map).forEach(function (k) { map[k].pedidosSet = {}; });
    resgates.forEach(function (g) { (recsByResgate[g.resgate] || []).forEach(function (r) { map[g.data].pedidosSet[r.pedido] = 1; }); });
    return Object.keys(map).sort().map(function (k) {
      var g = map[k]; var pedidos = Object.keys(g.pedidosSet).length;
      var liquidoCalc = g.antec - g.taxa;
      return { data: g.data, pedidos: pedidos, resgates: g.nResgates, antec: g.antec, taxa: g.taxa, receb: g.receb, liquidoCalc: liquidoCalc, liquidoDiff: g.receb - liquidoCalc, reemb: g.reemb, pend: g.pend, aliquota: g.antec ? g.taxa / g.antec : 0 };
    });
  }
  function aceleraMetrics(recs) {
    var m = { n: recs.length, volume: 0, taxa: 0, receb: 0, reemb: 0, pend: 0, restante: 0 };
    var status = {}, anomalies = [];
    var pedidosSet = {}, resgatesSet = {};
    recs.forEach(function (r) {
      m.volume += r.antecipado; m.taxa += r.taxa; m.receb += r.recebido; m.reemb += r.reembolsado; m.pend += r.pendente; m.restante += r.restante;
      pedidosSet[r.pedido] = 1; resgatesSet[r.resgate] = 1;
      status[normStatus(r.status)] = (status[normStatus(r.status)] || 0) + 1;
      var an = null;
      if (r.antecipado <= 0) an = 'Valor antecipado zero ou negativo';
      else if (r.reembolsado > r.antecipado + 1) an = 'Reembolso maior que o antecipado';
      else if (r.pendente > r.antecipado + 1) an = 'Pendência maior que o antecipado';
      else if (r.taxa < 0) an = 'Taxa negativa';
      else if (acLiquidoDivergente(r)) an = 'Líquido informado diverge do calculado (antecipado − taxa)';
      if (an) anomalies.push({ r: r, type: an });
    });
    m.nPedidos = Object.keys(pedidosSet).length; m.nResgates = Object.keys(resgatesSet).length;
    m.liquidoCalc = m.volume - m.taxa; m.liquidoDiff = m.receb - m.liquidoCalc;
    m.aliquota = m.volume ? m.taxa / m.volume : 0;
    m.status = status; m.anomalies = anomalies;
    m.byResgate = aceleraByResgate(recs); m.byDia = aceleraByDia(recs);
    return m;
  }
  // §11-13/§27 da correção: CORRIGIDO — o bug original filtrava as LINHAS cruas pela data individual
  // ANTES de agrupar, o que fragmentava um resgate cujas linhas cruzam a borda do período (ex.: um
  // resgate com linhas de 18/08 e 19/08 aparecia com poucos pedidos em 18/08 e o resto sumia). A
  // ordem correta é: (1) agrupar TODAS as linhas (sem filtro) por resgate, (2) determinar a data
  // consolidada de cada resgate (máxima das linhas), (3) filtrar os RESGATES consolidados pelo
  // período, (4) só então devolver as linhas cruas que pertencem aos resgates que sobraram — um
  // resgate nunca é cortado ao meio pelo filtro de período.
  function aceleraInPeriod() {
    var resgatesOk = {};
    aceleraByResgate(acelera).forEach(function (g) { if (acInPeriod(g.data)) resgatesOk[g.resgate] = true; });
    return acelera.filter(function (r) { return resgatesOk[r.resgate]; });
  }

  function renderAcelera() {
    // Refatoração completa do módulo (prompt "REFATORAÇÃO COMPLETA DO MÓDULO SHOPEE ACELERA"):
    // função única — Expedição → Antecipação → Taxa → Líquido recebido → Conferência. Fora ficam
    // capital, coorte, custo de oportunidade e qualquer recomendação de decisão financeira.
    var tabs = [['visao', 'Visão Geral'], ['antecipacoes', 'Antecipações'], ['expedidos', 'Expedidos × Acelera'], ['divergencias', 'Divergências'], ['auditoria', 'Auditoria'], ['import', 'Importações']];
    app.innerHTML = devPeriodBar() + '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap"><div class="subtabs" style="margin-bottom:0;overflow-x:auto">' + tabs.map(function (t) { return '<div class="subtab' + (aceleraSub === t[0] ? ' active' : '') + '" data-acsub="' + t[0] + '">' + t[1] + '</div>'; }).join('') + '</div><button class="btn-sm primary" data-acimport="1">Importar Shopee Acelera</button></div><div id="acbody" style="margin-top:14px"></div>';
    var body = document.getElementById('acbody');
    try {
      if (!acelera.length && aceleraSub !== 'expedidos' && aceleraSub !== 'import') body.innerHTML = secHead('SHOPEE ACELERA', 'Antecipação de Recebíveis', 'Expedição → Antecipação → Taxa → Líquido recebido → Conferência.') + emptyBox('Nenhum relatório Shopee Acelera importado. Clique em “Importar Shopee Acelera” e envie o CSV de antecipação de recebíveis.') + '<div style="text-align:center;margin-top:-8px"><button class="btn-sm primary" id="acimp">Importar primeiro relatório</button></div>';
      else body.innerHTML = ({ visao: aceleraVisao, antecipacoes: aceleraAntecipacoes, expedidos: aceleraExpedidos, divergencias: aceleraDivergencias, auditoria: aceleraAuditoria, import: aceleraImportacoes }[aceleraSub] || aceleraVisao)();
    } catch (e) { body.innerHTML = '<div class="form-err">Erro ao renderizar o Shopee Acelera: ' + esc(e.message || e) + '</div>'; }
    bindDevPeriodBar();
    app.querySelectorAll('[data-acsub]').forEach(function (b) { b.onclick = function () { aceleraSub = b.dataset.acsub; aceleraPage = 1; render(); }; });
    var imp = function () { fileInput(function (f) { importAcelera(f).then(function (b) { render(); toast('Importação concluída', b.novo + ' novos · ' + b.upd + ' atualizados · ' + b.unch + ' sem alteração'); }).catch(function (e) { toast('Falha', e.message, true); }); }); };
    app.querySelectorAll('[data-acimport]').forEach(function (b) { b.onclick = imp; });
    var ai = document.getElementById('acimp'); if (ai) ai.onclick = imp;
    app.querySelectorAll('[data-acgo]').forEach(function (b) { b.onclick = function () { aceleraSub = b.dataset.acgo; render(); }; });
    app.querySelectorAll('[data-acresg]').forEach(function (b) { b.onclick = function () { aceleraSel.resgate = b.dataset.acresg; openAceleraResgate(b.dataset.acresg); }; });
    app.querySelectorAll('[data-acped]').forEach(function (b) { b.onclick = function () { openAceleraPedido(b.dataset.acped); }; });
    app.querySelectorAll('[data-acdia]').forEach(function (b) { b.onclick = function () { openAceleraDia(b.dataset.acdia); }; });
    if (aceleraSub === 'antecipacoes') bindAceleraAntec();
    if (aceleraSub === 'expedidos') bindAceleraExpedidos();
    if (aceleraSub === 'divergencias') bindAceleraDivergencias();
    if (aceleraSub === 'import') bindAceleraImportacoes();
  }
  // §4/§6/§7 da refatoração: KPIs + gráfico "Antecipações dia a dia" + resumo dia a dia. Sem
  // recomendação de capital/coorte/custo de oportunidade — só os fatos calculados dos dados.
  function aceleraVisao() {
    var recs = aceleraInPeriod(); var m = aceleraMetrics(recs);
    var head = secHead('SHOPEE ACELERA', 'Antecipação de Recebíveis', 'Quanto a Shopee antecipou, quanto cobrou de taxa e quanto entrou líquido — dia a dia, resgate a resgate.');
    var strip1 = kstrip([
      { l: 'Pedidos antecipados', v: nn(m.nPedidos), cls: 'blue', s: nn(m.nResgates) + ' resgate(s)' },
      { l: 'Valor bruto resgatado', v: brlC(m.volume), cls: 'blue', s: 'soma dos resgates rápidos (antes da taxa)' },
      { l: 'Taxa de serviço', v: brlC(m.taxa), cls: 'red' },
      { l: 'Alíquota efetiva', v: pct(r2(m.aliquota * 100)), cls: 'amber', s: 'taxa ÷ antecipado' },
    ]);
    var liqDivergente = Math.abs(m.liquidoDiff) > 100;
    var strip2 = kstrip([
      { l: 'Valor líquido recebido', v: brlC(m.receb), cls: 'green', s: liqDivergente ? '⚠ calculado (antecipado − taxa): ' + brlC(m.liquidoCalc) : 'confere com antecipado − taxa' },
      { l: 'Valor reembolsado', v: brlC(m.reemb), cls: m.reemb ? 'amber' : '' },
      { l: 'Pendente', v: brlC(m.pend), cls: m.pend ? 'blue' : '' },
      { l: 'Resgates', v: nn(m.nResgates), cls: 'blue' },
    ]);
    var liqWarn = liqDivergente ? callout('warn', '⚠ Líquido recebido diverge do calculado', 'A Shopee informou <b>' + brlC(m.receb) + '</b> de líquido recebido no período; antecipado − taxa calculado pelo sistema dá <b>' + brlC(m.liquidoCalc) + '</b> — diferença de <b>' + brlC(m.liquidoDiff) + '</b>. Veja o detalhe em Divergências.') : '';
    var chart = m.byDia.length ? chartCard('Antecipações dia a dia', legendSwatch([['Líquido recebido', '#1fa971'], ['Taxa', '#d13b3b']]), svgAcDia(m.byDia)) : '';
    var resumo = aceleraResumoDiaTable(m.byDia);
    return head + strip1 + strip2 + liqWarn + chart + resumo;
  }
  // Gráfico de barras empilhadas (líquido + taxa = antecipado) por data do resgate, com tooltip
  // nativo (<title>) mostrando data, valor antecipado, taxa, líquido, pedidos, resgates e alíquota.
  function svgAcDia(days) {
    if (!days.length) return '<div class="footnote">Sem dados no período.</div>';
    var W = Math.max(560, days.length * 46), H = 260, padL = 56, padR = 20, padB = 34, padT = 16;
    var max = Math.max.apply(null, days.map(function (d) { return d.antec / 100; }).concat([1]));
    var step = (W - padL - padR) / days.length, bw = Math.min(34, step * 0.62);
    var y0 = H - padB, ih = H - padB - padT;
    var body = days.map(function (d, i) {
      var x = padL + i * step + (step - bw) / 2;
      var liq = Math.max(0, d.liquidoCalc / 100), taxa = Math.max(0, d.taxa / 100);
      var hLiq = (liq / max) * ih, hTaxa = (taxa / max) * ih;
      var yLiq = y0 - hLiq, yTaxa = yLiq - hTaxa;
      var tip = acDbr(d.data) + '\n\nValor bruto resgatado: ' + brl(d.antec / 100) + '\nTaxa: -' + brl(d.taxa / 100) + '\nLíquido recebido: ' + brl(d.receb / 100) + '\n\n' + d.pedidos + ' pedido' + (d.pedidos === 1 ? '' : 's') + '\n' + d.resgates + ' resgate' + (d.resgates === 1 ? '' : 's') + '\nAlíquota efetiva: ' + pct(r2(d.aliquota * 100));
      return '<g style="cursor:pointer" data-acdia="' + esc(d.data) + '">' +
        '<rect x="' + x.toFixed(1) + '" y="' + yLiq.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + Math.max(0, hLiq).toFixed(1) + '" fill="#1fa971" opacity="0.9"/>' +
        '<rect x="' + x.toFixed(1) + '" y="' + yTaxa.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + Math.max(0, hTaxa).toFixed(1) + '" fill="#d13b3b" opacity="0.9"/>' +
        '<rect x="' + x.toFixed(1) + '" y="' + padT + '" width="' + bw.toFixed(1) + '" height="' + (y0 - padT) + '" fill="transparent"><title>' + esc(tip) + '</title></rect>' +
        '</g>';
    }).join('');
    var step2 = Math.max(1, Math.ceil(days.length / 10));
    var labels = days.map(function (d, i) { if (i % step2 !== 0 && i !== days.length - 1) return ''; var x = padL + i * step + step / 2; return '<text x="' + x.toFixed(1) + '" y="' + (H - 10) + '" font-size="10" fill="#64708a" text-anchor="middle">' + esc(monthDayLabel(d.data)) + '</text>'; }).join('');
    var yl = '<text x="6" y="' + (padT + 4) + '" font-size="10" fill="#64708a">' + brl(max) + '</text><text x="6" y="' + (y0 + 4) + '" font-size="10" fill="#64708a">R$ 0</text>';
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" style="max-width:' + W + 'px">' + body + labels + yl + '</svg>';
  }
  // §7: "mais de um resgate no mesmo dia não significa duplicação" — a tabela nunca deduplica por
  // data; ela só agrupa visualmente, mostrando explicitamente a contagem de resgates por dia.
  function aceleraResumoDiaTable(days) {
    if (!days.length) return emptyBox('Nenhum resgate no período selecionado.');
    var sorted = days.slice().sort(function (a, b) { return b.data.localeCompare(a.data); });
    var rows = sorted.map(function (d) {
      return '<tr class="rowlink" data-acdia="' + esc(d.data) + '"><td class="nowrap">' + esc(acDbr(d.data)) + '</td><td>' + nn(d.pedidos) + '</td><td>' + nn(d.resgates) + '</td><td class="nowrap">' + brlC(d.antec) + '</td><td class="nowrap">' + brlC(d.taxa) + '</td><td>' + pct(r2(d.aliquota * 100)) + '</td><td class="nowrap">' + brlC(d.receb) + '</td><td class="nowrap' + (d.reemb ? ' neg' : '') + '">' + brlC(d.reemb) + '</td><td><button class="btn-sm" data-acdia="' + esc(d.data) + '">Abrir</button></td></tr>';
    }).join('');
    return '<div class="panel"><div class="ph"><h3>Resumo dia a dia</h3><span class="footnote" style="margin:0">mais de um resgate no mesmo dia não é duplicidade — a Shopee pode gerar vários lotes na mesma data</span></div><div class="table-wrap"><table class="report"><thead><tr><th>Data</th><th>Pedidos</th><th>Resgates</th><th>Antecipado</th><th>Taxa</th><th>Alíquota</th><th>Líquido</th><th>Reembolsado</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div></div>';
  }
  // §8-9/§22-24: expansão do dia → resgates do dia → pedidos do resgate (reaproveita openAceleraResgate).
  // dateStr é sempre a DATA CONSOLIDADA do resgate (máxima das suas linhas) — por isso os resgates
  // deste dia são obtidos filtrando aceleraByResgate por g.data, e as linhas cruas são as de TODOS
  // os resgates que caíram neste dia (mesmo que alguma linha individual do resgate tenha outra data).
  function openAceleraDia(dateStr) {
    var gs = aceleraByResgate(acelera).filter(function (g) { return g.data === dateStr; });
    var resgSet = {}; gs.forEach(function (g) { resgSet[g.resgate] = true; });
    var recs = acelera.filter(function (r) { return resgSet[r.resgate]; });
    var pedidosSet = {}; recs.forEach(function (r) { pedidosSet[r.pedido] = 1; });
    var antecTot = recs.reduce(function (s, r) { return s + r.antecipado; }, 0);
    var d = document.createElement('div'); d.className = 'drawer'; var panel = document.createElement('div'); panel.className = 'drawer-panel'; panel.style.width = '760px'; panel.style.maxWidth = '97vw';
    d.appendChild(panel); d.onclick = function (e) { if (e.target === d) d.remove(); }; document.body.appendChild(d);
    var resgateBlocks = gs.map(function (g) {
      return '<div class="panel"><div class="ph"><h3>Resgate <span class="mono">' + esc(g.resgate) + '</span></h3><span class="tag' + (g.divergente ? ' warn' : '') + '">alíquota ' + pct(r2(g.rate * 100)) + '</span></div><div class="pb">' +
        kv('Pedidos', nn(g.n)) + kv('Antecipado', brlC(g.antec)) + kv('Taxa', brlC(g.taxa)) + kv('Líquido', brlC(g.receb)) + (g.reemb ? kv('Reembolsado', brlC(g.reemb)) : '') + (g.pend ? kv('Pendente', brlC(g.pend)) : '') +
        '<button class="btn-sm primary" data-acresg="' + esc(g.resgate) + '" style="margin-top:8px">Ver pedidos deste resgate</button>' +
        '</div></div>';
    }).join('');
    panel.innerHTML = '<div class="dh"><div><b>' + esc(acDbr(dateStr)) + '</b></div><button class="x">&times;</button></div><div class="dbd">' +
      '<div class="kstrip" style="margin-bottom:12px"><div class="kc"><div class="kl">Pedidos</div><div class="kv" style="font-size:18px">' + nn(Object.keys(pedidosSet).length) + '</div></div><div class="kc"><div class="kl">Resgates</div><div class="kv" style="font-size:18px">' + nn(gs.length) + '</div></div><div class="kc"><div class="kl">Antecipado</div><div class="kv" style="font-size:18px">' + brlC(antecTot) + '</div></div></div>' +
      resgateBlocks + '</div>';
    panel.querySelector('.x').onclick = function () { d.remove(); };
    panel.querySelectorAll('[data-acresg]').forEach(function (b) { b.onclick = function () { d.remove(); openAceleraResgate(b.dataset.acresg); }; });
  }
  // §1 pergunta 10: os valores calculados pelo sistema batem com o resumo que a própria Shopee
  // escreveu no cabeçalho do arquivo? (usado na aba Auditoria, não mais na Visão Geral.)
  function aceleraReconcile(m) {
    if (!aceleraSummary || !aceleraSummary.summary) return '';
    var s = aceleraSummary.summary; var rows = [];
    var cmp = function (label, sys, shopee) { if (shopee == null) return; var diff = sys - shopee; rows.push({ label: label, sys: sys, shopee: shopee, diff: diff }); };
    cmp('Volume antecipado', m.volume, s.volume); cmp('Taxa de serviço', m.taxa, s.taxa); cmp('Recebido', m.receb, s.recebido); cmp('Reembolsado', m.reemb, s.reembolsado); cmp('Pendente', m.pend, s.pendente);
    var maxDiff = rows.reduce(function (mx, r) { return Math.max(mx, Math.abs(r.diff)); }, 0);
    var ok = maxDiff <= 100; // até R$1,00 de arredondamento
    var pr = aceleraSummary.periodReal || {}; var audit = '';
    if (aceleraSummary.periodDeclared && pr.min && (pr.min < (aceleraSummary.periodDeclared.split(' - ')[0] || ''))) audit = ' O período declarado pela Shopee (' + esc(aceleraSummary.periodDeclared) + ') começa depois do registro mais antigo (' + esc(pr.min) + ') — normal quando reembolsos trazem pedidos antigos de volta; nenhum registro foi descartado.';
    var body = '<div class="table-wrap"><table class="report"><thead><tr><th>Indicador</th><th>Sistema</th><th>Shopee (resumo)</th><th>Diferença</th></tr></thead><tbody>' + rows.map(function (r) { return '<tr><td>' + esc(r.label) + '</td><td class="nowrap">' + brlC(r.sys) + '</td><td class="nowrap">' + brlC(r.shopee) + '</td><td class="nowrap ' + (Math.abs(r.diff) > 100 ? 'neg' : '') + '">' + (r.diff === 0 ? 'R$ 0,00' : brlC(r.diff)) + '</td></tr>'; }).join('') + '</tbody></table></div>';
    return callout(ok ? 'green' : 'warn', ok ? '✓ Conciliado com o resumo da Shopee' : '⚠ Divergência com o resumo da Shopee', 'Comparação entre o que o sistema somou linha a linha e o resumo que a própria Shopee escreveu no arquivo.' + audit + body);
  }

  // §21: distribuição das alíquotas dentro de Antecipações (não é mais aba isolada) — calculada dos
  // dados reais, nunca assumindo faixas fixas.
  function aceleraAliquotaDist(recs) {
    var gs = aceleraByResgate(recs);
    var byResgateKey = {}; gs.forEach(function (g) { byResgateKey[g.resgate] = g.aliqLabel; });
    var map = {};
    gs.forEach(function (g) { var key = g.aliqLabel; var b = map[key] = map[key] || { label: key, pedidosSet: {}, resgates: 0, antec: 0, taxa: 0, order: g.rate }; b.resgates++; b.antec += g.antec; b.taxa += g.taxa; });
    recs.forEach(function (r) { var key = byResgateKey[r.resgate]; if (!key || !map[key]) return; map[key].pedidosSet[r.pedido] = 1; });
    return Object.values(map).map(function (b) { return { label: b.label, pedidos: Object.keys(b.pedidosSet).length, resgates: b.resgates, antec: b.antec, taxa: b.taxa, order: b.order }; }).sort(function (a, b) { return a.order - b.order; });
  }
  function aceleraAntecipacoes() {
    var recs = aceleraInPeriod();
    var gs = aceleraByResgate(recs).sort(function (a, b) { return (b.data || '').localeCompare(a.data || ''); });
    if (aceleraF.aliq) gs = gs.filter(function (g) { return g.aliqLabel === aceleraF.aliq; });
    if (aceleraF.search) { var q = aceleraF.search.toLowerCase(); gs = gs.filter(function (g) { return g.resgate.toLowerCase().indexOf(q) >= 0; }); }
    var pages = Math.max(1, Math.ceil(gs.length / 25)); if (aceleraPage > pages) aceleraPage = pages; var slice = gs.slice((aceleraPage - 1) * 25, aceleraPage * 25);
    var head = secHead('ACELERA · ANTECIPAÇÕES', 'Auditoria por resgate', 'Cada lote de antecipação: valor, taxa, alíquota efetiva, líquido, reembolsado e pendente. Clique para ver os pedidos.');
    var rows = slice.map(function (g) { return '<tr class="rowlink" data-acresg="' + esc(g.resgate) + '"><td class="nowrap">' + esc(acDbr(g.data)) + '</td><td class="mono">' + esc(g.resgate) + '</td><td>' + nn(g.n) + '</td><td class="nowrap">' + brlC(g.disp) + '</td><td class="nowrap">' + brlC(g.antec) + '</td><td class="nowrap">' + brlC(g.taxa) + '</td><td><span class="tag' + (g.divergente ? ' warn' : '') + '">' + g.aliqLabel + '</span></td><td class="nowrap">' + brlC(g.receb) + '</td><td class="nowrap ' + (g.reemb ? 'neg' : '') + '">' + brlC(g.reemb) + '</td><td class="nowrap">' + brlC(g.pend) + '</td><td><button class="btn-sm" data-acresg="' + esc(g.resgate) + '">Abrir</button></td></tr>'; }).join('');
    var dist = aceleraAliquotaDist(recs);
    var aliqOptions = '<option value="">Todas</option>' + dist.map(function (a) { return '<option value="' + esc(a.label) + '"' + (aceleraF.aliq === a.label ? ' selected' : '') + '>' + esc(a.label) + '</option>'; }).join('');
    var distRows = dist.map(function (a) { return '<tr><td><span class="tag">' + esc(a.label) + '</span></td><td>' + nn(a.pedidos) + '</td><td>' + nn(a.resgates) + '</td><td class="nowrap">' + brlC(a.antec) + '</td><td class="nowrap">' + brlC(a.taxa) + '</td></tr>'; }).join('');
    var distTable = '<div class="panel"><div class="ph"><h3>Distribuição das alíquotas</h3><span class="footnote" style="margin:0">calculada a partir dos dados — não assume faixas fixas</span></div><div class="table-wrap"><table class="report"><thead><tr><th>Alíquota</th><th>Pedidos</th><th>Resgates</th><th>Antecipado</th><th>Taxa</th></tr></thead><tbody>' + (distRows || '<tr><td colspan="5" class="empty">Sem dados.</td></tr>') + '</tbody></table></div></div>';
    return head +
      '<div class="toolbar2" style="margin-top:8px;gap:10px;flex-wrap:wrap"><input class="input sm" id="acq" style="width:280px" placeholder="Buscar ID do resgate…" value="' + esc(aceleraF.search) + '"><select class="select sm" id="acaliqf" style="width:160px">' + aliqOptions + '</select></div>' +
      '<div class="count-line"><b>' + nn(gs.length) + '</b> resgates</div>' +
      '<div class="panel"><div class="table-wrap"><table class="report"><thead><tr><th>Data</th><th>ID resgate</th><th>Pedidos</th><th>Disponível</th><th>Bruto resgatado</th><th>Taxa</th><th>Alíquota</th><th>Líquido</th><th>Reembolsado</th><th>Pendente</th><th></th></tr></thead><tbody>' + (rows || '<tr><td colspan="11" class="empty">Nenhum resgate neste filtro.</td></tr>') + '</tbody></table></div></div>' +
      (pages > 1 ? '<div style="display:flex;gap:8px;justify-content:flex-end;align-items:center"><button class="btn-sm" id="acprev"' + (aceleraPage <= 1 ? ' disabled' : '') + '>Anterior</button><span class="footnote" style="margin:0">página ' + aceleraPage + ' de ' + pages + '</span><button class="btn-sm" id="acnext"' + (aceleraPage >= pages ? ' disabled' : '') + '>Próxima</button></div>' : '') +
      distTable;
  }
  function bindAceleraAntec() {
    var q = document.getElementById('acq'); if (q) { var t; q.oninput = function () { clearTimeout(t); t = setTimeout(function () { var v = q.value; aceleraF.search = v; aceleraPage = 1; render(); var el = document.getElementById('acq'); if (el) { el.focus(); el.value = v; el.setSelectionRange(v.length, v.length); } }, 220); }; }
    var af = document.getElementById('acaliqf'); if (af) af.onchange = function () { aceleraF.aliq = af.value; aceleraPage = 1; render(); };
    var pv = document.getElementById('acprev'); if (pv) pv.onclick = function () { if (aceleraPage > 1) { aceleraPage--; render(); } };
    var nx = document.getElementById('acnext'); if (nx) nx.onclick = function () { aceleraPage++; render(); };
  }
  function openAceleraResgate(rid) {
    var recs = acelera.filter(function (r) { return r.resgate === rid; });
    var d = document.createElement('div'); d.className = 'drawer'; var panel = document.createElement('div'); panel.className = 'drawer-panel'; panel.style.width = '820px'; panel.style.maxWidth = '97vw';
    d.appendChild(panel); d.onclick = function (e) { if (e.target === d) d.remove(); }; document.body.appendChild(d);
    var g = aceleraByResgate(recs)[0] || { antec: 0, taxa: 0, rate: 0, receb: 0, reemb: 0, pend: 0, aliqLabel: '—', divergente: false };
    var rows = recs.sort(function (a, b) { return b.antecipado - a.antecipado; }).slice(0, 400).map(function (r) { return '<tr class="rowlink" data-acped="' + esc(r.pedido) + '"><td class="mono">' + esc(r.pedido) + '</td><td class="nowrap">' + brlC(r.antecipado) + '</td><td class="nowrap">' + brlC(r.taxa) + '</td><td class="nowrap">' + brlC(r.recebido) + '</td><td class="nowrap ' + (r.reembolsado ? 'neg' : '') + '">' + brlC(r.reembolsado) + '</td><td class="nowrap">' + brlC(r.pendente) + '</td><td><span class="tag ' + (acIsReemb(r) ? 'warn' : acIsFullyPaid(r) ? 'ok' : 'neutral') + '">' + esc(acStatusLabel(r.status)) + '</span></td></tr>'; }).join('');
    panel.innerHTML = '<div class="dh"><div><b>Resgate ' + esc(rid) + '</b> <span class="tag' + (g.divergente ? ' warn' : '') + '" style="margin-left:6px">alíquota ' + g.aliqLabel + '</span></div><button class="x">&times;</button></div><div class="dbd">' +
      '<div class="kstrip" style="margin-bottom:12px"><div class="kc"><div class="kl">Disponível</div><div class="kv" style="font-size:16px">' + brlC(g.disp) + '</div></div><div class="kc"><div class="kl">Bruto resgatado</div><div class="kv" style="font-size:16px">' + brlC(g.antec) + '</div></div><div class="kc"><div class="kl">Taxa</div><div class="kv" style="font-size:16px">' + brlC(g.taxa) + '</div></div><div class="kc"><div class="kl">Líquido</div><div class="kv" style="font-size:16px">' + brlC(g.receb) + '</div></div><div class="kc"><div class="kl">Reembolsado</div><div class="kv" style="font-size:16px">' + brlC(g.reemb) + '</div></div></div>' +
      '<div class="panel"><div class="ph"><h3>' + nn(recs.length) + ' pedidos neste resgate</h3></div><div class="table-wrap"><table class="report"><thead><tr><th>Pedido</th><th>Bruto resgatado</th><th>Taxa</th><th>Recebido</th><th>Reembolsado</th><th>Pendente</th><th>Status</th></tr></thead><tbody>' + rows + '</tbody></table></div></div></div>';
    panel.querySelector('.x').onclick = function () { d.remove(); };
    panel.querySelectorAll('[data-acped]').forEach(function (b) { b.onclick = function () { openAceleraPedido(b.dataset.acped); }; });
  }
  // §9/§18/§22: detalhe de um pedido — antecipação (ou "não encontrado", útil para as divergências
  // "expedido sem Acelera"), depois-da-antecipação (reembolso §24), pedido central e Ficha 360º.
  function openAceleraPedido(pid) {
    var recs = acelera.filter(function (r) { return r.pedido === pid; }); var r = recs[0];
    var ord = orders.find(function (o) { return o.id === pid; }); var oc = occ.find(function (o) { return !o.isDemo && o.orderId === pid; }); var bip = shipBip[pid];
    var d = document.createElement('div'); d.className = 'drawer'; var panel = document.createElement('div'); panel.className = 'drawer-panel'; panel.style.width = '640px'; panel.style.maxWidth = '96vw';
    d.appendChild(panel); d.onclick = function (e) { if (e.target === d) d.remove(); }; document.body.appendChild(d);
    var antBlock;
    if (r) {
      var liqCalc = acLiquidoCalc(r); var liqDiff = acLiquidoDiff(r); var diverge = acLiquidoDivergente(r);
      antBlock = '<div class="panel"><div class="ph"><h3>Antecipação</h3></div><div class="pb">' + kv('Resgate', r.resgate) + kv('Data', acDbr(r.data)) + kv('Valor disponível para resgate rápido', brlC(r.disponivel)) + kv('Valor bruto resgatado', brlC(r.antecipado)) + kv('Taxa', brlC(r.taxa)) + kv('Alíquota', pct(r2((r.antecipado ? r.taxa / r.antecipado : 0) * 100))) + kv('Líquido informado (Shopee)', brlC(r.recebido)) + kv('Líquido calculado (antecipado − taxa)', brlC(liqCalc)) + (diverge ? kv('Diferença', brlC(liqDiff)) : '') + '</div></div>' +
        (diverge ? callout('warn', '⚠ Líquido divergente', 'A Shopee informou um líquido diferente do calculado por antecipado − taxa. Diferença de ' + brlC(liqDiff) + '.') : '') +
        '<div class="panel"><div class="ph"><h3>Depois da antecipação</h3></div><div class="pb">' + kv('Reembolsado', brlC(r.reembolsado)) + kv('Pendente', brlC(r.pendente)) + kv('Última transação', acDbr(r.ultimaTransacao)) + kv('Vencimento', acDbr(r.vencimento)) + (r.reembolsado > 0 ? '<div style="margin-top:4px"><span class="tag warn">Pedido posteriormente reembolsado</span></div>' : '') + '</div></div>' +
        ((r.history && r.history.length) ? '<div class="panel"><div class="ph"><h3>Linha do tempo</h3></div><div class="pb">' + [{ at: r.firstImportAt, txt: 'Importado — ' + acStatusLabel(r.status) }].concat(r.history.map(function (h) { return { at: h.at, txt: acStatusLabel(h.statusOld) + ' → ' + acStatusLabel(h.statusNew) }; })).map(function (e) { return '<div class="fin-line"><span>' + esc(e.txt) + '</span><span class="footnote" style="margin:0">' + (e.at ? new Date(e.at).toLocaleDateString('pt-BR') : '') + '</span></div>'; }).join('') + '</div></div>' : '');
    } else {
      antBlock = callout('warn', 'Pedido não encontrado no Acelera', bip ? 'Expedido em ' + dbr(bip.bipedAt) + ', mas sem registro correspondente no relatório do Shopee Acelera importado.' : 'Sem registro no Shopee Acelera importado.');
    }
    var it = ord ? (ord.items || [])[0] || {} : {};
    var pedBlock = ord ? '<div class="panel"><div class="ph"><h3>Pedido (do módulo Pedidos)</h3></div><div class="pb">' + kv('Produto', it.productName || '—') + kv('SKU', it.sku || '—') + kv('Status', S.pedidos.labels[ord.normalizedStatus] || ord.orderStatus || '—') + kv('Valor', brl(ord.totalAmount || 0)) + kv('Expedido', bip ? dbr(bip.bipedAt) : 'não registrado') + '<div style="display:flex;gap:8px;margin-top:8px"><button class="btn-sm" data-goped="' + esc(pid) + '">Ver pedido</button><button class="btn-sm primary" data-goped360="' + esc(pid) + '">Ficha Financeira 360º</button></div></div></div>' : '<div class="footnote">Pedido ' + esc(pid) + ' não importado no módulo Pedidos — SKU/produto indisponíveis.</div>';
    var devBlock = oc ? '<div class="panel"><div class="ph"><h3>Devolução vinculada</h3><span class="tag info">' + esc(statusLabel(oc.status)) + '</span></div><div class="pb">' + kv('Motivo', oc.reason || '—') + kv('Responsabilidade', (DEV.RESPONSIBILITY[oc.responsibility] || '—')) + '<button class="btn-sm" data-godev="' + esc(oc.id) + '">Ver devolução</button></div></div>' : '';
    panel.innerHTML = '<div class="dh"><div><b>Pedido ' + esc(pid) + '</b>' + (r ? ' <span class="tag ' + (acIsReemb(r) ? 'warn' : acIsFullyPaid(r) ? 'ok' : 'neutral') + '" style="margin-left:6px">' + esc(acStatusLabel(r.status)) + '</span>' : '') + '</div><button class="x">&times;</button></div><div class="dbd">' + antBlock + pedBlock + devBlock + '</div>';
    panel.querySelector('.x').onclick = function () { d.remove(); };
    var gp = panel.querySelector('[data-goped]'); if (gp) gp.onclick = function () { d.remove(); route = 'pedidos'; sub.pedidos = 'pedidos'; render(); };
    var g360 = panel.querySelector('[data-goped360]'); if (g360) g360.onclick = function () { d.remove(); openPedidoFicha360(pid); };
    var gd = panel.querySelector('[data-godev]'); if (gd) gd.onclick = function () { var id2 = gd.dataset.godev; d.remove(); route = 'posvenda'; sub.posvenda = 'casos'; render(); setTimeout(function () { openFicha(id2); }, 60); };
  }

  // §2/§13 da refatoração — Expedidos × Acelera é a função mais importante do módulo: os pedidos
  // que saíram da empresa foram antecipados? Cruza pela ID do pedido, reaproveitando shipBip (a
  // MESMA fonte de expedição usada em Pedidos → Expedição — nunca uma segunda fonte paralela).
  // §28-32: funil de 3 estágios, sempre mantidos conceitualmente distintos — nunca fundidos:
  // (1) A Enviar = pedidos com status A_ENVIAR em Pedidos (ainda não bipados, portanto nunca podem
  // estar no Acelera); (2) Bipado/Expedido = shipBip (confirmação de expedição própria); (3)
  // Encontrado no Acelera = cruzamento por ID do pedido. Um pedido só avança de estágio por evento
  // objetivo (bipe registrado, ou aparição no relatório do Acelera) — nunca é assumido.
  function aceleraFunilStages() {
    var aEnviar = orders.filter(function (o) { return o.normalizedStatus === 'A_ENVIAR'; }).length;
    var bipados = Object.keys(shipBip).length;
    var acPedidosSet = {}; acelera.forEach(function (r) { acPedidosSet[r.pedido] = 1; });
    var encontrados = Object.keys(shipBip).filter(function (oid) { return acPedidosSet[oid]; }).length;
    return { aEnviar: aEnviar, bipados: bipados, encontrados: encontrados };
  }
  function aceleraExpedidos() {
    var head = secHead('SHOPEE ACELERA · EXPEDIDOS × ACELERA', 'Os pedidos expedidos foram antecipados?', 'Cruza a expedição (bipe, em Pedidos → Expedição) com os registros do Acelera pelo ID do pedido.');
    var fun = aceleraFunilStages();
    var funil = '<div class="panel"><div class="ph"><h3>Funil de conciliação (3 estágios, nunca fundidos)</h3></div><div class="pb"><div class="kstrip"><div class="kc"><div class="kl">① A Enviar (Pedidos)</div><div class="kv" style="font-size:16px">' + nn(fun.aEnviar) + '</div></div><div class="kc"><div class="kl">② Bipado/Expedido</div><div class="kv" style="font-size:16px">' + nn(fun.bipados) + '</div></div><div class="kc"><div class="kl">③ Encontrado no Acelera</div><div class="kv" style="font-size:16px">' + nn(fun.encontrados) + '</div></div></div><span class="footnote">① nunca aparece no Acelera (ainda não foi enviado); ② confirmação própria de despacho; ③ cruzamento por ID do pedido no relatório do Acelera — os três estágios nunca são somados nem confundidos entre si.</span></div></div>';
    var bips = Object.keys(shipBip);
    if (!bips.length) return head + funil + emptyBox('Nenhum pedido expedido (bipado) ainda. Registre a expedição em Pedidos → Expedição para habilitar este cruzamento.');
    var acByOrder = {}; acelera.forEach(function (r) { (acByOrder[r.pedido] = acByOrder[r.pedido] || []).push(r); });
    var tolMs = (aceleraCfg.aguardandoDias || 3) * 864e5;
    var rows = bips.map(function (oid) {
      var b = shipBip[oid]; var recs = acByOrder[oid]; var situacao, badge;
      if (recs && recs.length) { situacao = 'CONCILIADO'; badge = '🟢 Conciliado'; }
      else {
        var idade = Date.now() - new Date(b.bipedAt).getTime();
        // §16: janela operacional antes de marcar como problema — não é um prazo oficial da Shopee,
        // é uma tolerância ajustável (aceleraCfg.aguardandoDias) para não gerar alarme falso cedo demais.
        if (idade < tolMs) { situacao = 'AGUARDANDO'; badge = '🟡 Aguardando antecipação'; }
        else { situacao = 'NAO_ENCONTRADO'; badge = '🔴 Expedido, não encontrado no Acelera'; }
      }
      return { oid: oid, bipedAt: b.bipedAt, recs: recs || [], situacao: situacao, badge: badge };
    });
    var acSemExp = Object.keys(acByOrder).filter(function (oid) { return !shipBip[oid]; });
    var conciliados = rows.filter(function (r) { return r.situacao === 'CONCILIADO'; });
    var naoEncontrados = rows.filter(function (r) { return r.situacao === 'NAO_ENCONTRADO'; });
    var pctConc = bips.length ? r2(conciliados.length / bips.length * 100) : 0;
    var strip = kstrip([
      { l: 'Pedidos expedidos/bipados', v: nn(bips.length), cls: 'blue' },
      { l: 'Encontrados no Acelera', v: nn(conciliados.length), cls: 'green' },
      { l: 'Não encontrados no Acelera', v: nn(naoEncontrados.length), cls: naoEncontrados.length ? 'red' : 'green' },
      { l: 'Acelera sem confirmação de expedição', v: nn(acSemExp.length), cls: acSemExp.length ? 'amber' : 'green' },
      { l: '% conciliado', v: pct(pctConc), cls: 'blue', s: nn(conciliados.length) + ' de ' + nn(bips.length) + ' expedidos (denominador = todos os expedidos)' },
    ]);
    var tableRows = rows.sort(function (a, b) { var ord = { NAO_ENCONTRADO: 0, AGUARDANDO: 1, CONCILIADO: 2 }; return ord[a.situacao] - ord[b.situacao] || b.bipedAt.localeCompare(a.bipedAt); }).slice(0, 400).map(function (r) {
      var rec = r.recs[0]; var o2 = orders.find(function (o) { return o.id === r.oid; });
      return '<tr><td class="mono">' + esc(r.oid) + '</td><td class="nowrap">' + dbr(r.bipedAt) + '</td><td class="nowrap">' + (rec ? acDbr(rec.data) : '—') + '</td><td class="nowrap">' + (rec ? brlC(rec.antecipado) : '—') + '</td><td class="nowrap">' + (rec ? brlC(rec.taxa) : '—') + '</td><td class="nowrap">' + (rec ? brlC(rec.recebido) : '—') + '</td><td class="mono">' + (rec ? esc(rec.resgate) : '—') + '</td><td>' + (o2 ? esc(S.pedidos.labels[o2.normalizedStatus] || o2.orderStatus) : '—') + '</td><td><span class="tag' + (r.situacao === 'NAO_ENCONTRADO' ? ' warn' : '') + '">' + r.badge + '</span></td><td><button class="btn-sm" data-acped="' + esc(r.oid) + '">Abrir</button></td></tr>';
    }).join('');
    var table = '<div class="panel"><div class="table-wrap"><table class="report"><thead><tr><th>Pedido</th><th>Data expedição</th><th>Data antecipação</th><th>Valor antecipado</th><th>Taxa</th><th>Líquido</th><th>ID resgate</th><th>Status</th><th>Situação</th><th></th></tr></thead><tbody>' + (tableRows || '<tr><td colspan="10" class="empty">Nenhum pedido.</td></tr>') + '</tbody></table></div></div>';
    var acSemExpTable = acSemExp.length ? '<div class="panel"><div class="ph"><h3>⚠️ Acelera sem expedição localizada</h3><span class="footnote" style="margin:0">' + nn(acSemExp.length) + ' pedido(s) antecipados sem registro de expedição/bipe</span></div><div class="table-wrap"><table class="report"><thead><tr><th>Pedido</th><th>Data antecipação</th><th>Valor antecipado</th><th></th></tr></thead><tbody>' + acSemExp.slice(0, 200).map(function (oid) { var rr = acByOrder[oid][0]; return '<tr><td class="mono">' + esc(oid) + '</td><td class="nowrap">' + acDbr(rr.data) + '</td><td class="nowrap">' + brlC(rr.antecipado) + '</td><td><button class="btn-sm" data-acped="' + esc(oid) + '">Abrir</button></td></tr>'; }).join('') + '</tbody></table></div></div>' : '';
    return head + funil + strip + table + acSemExpTable;
  }
  function bindAceleraExpedidos() { /* usa data-acped, já ligado globalmente em renderAcelera() */ }

  // §17-18 da refatoração: tela operacional de exceções, categorizada — nunca marca "possível
  // duplicidade" só porque existem dois resgates na mesma data.
  function aceleraDivergencias() {
    var recs = aceleraInPeriod();
    var head = secHead('ACELERA · DIVERGÊNCIAS', 'Exceções que precisam de revisão', 'Separadas por categoria — nunca marcamos "possível duplicidade" só porque existem dois resgates na mesma data.');
    var acByOrder = {}; acelera.forEach(function (r) { (acByOrder[r.pedido] = acByOrder[r.pedido] || []).push(r); });
    var bips = Object.keys(shipBip);
    var expedidosSemAcelera = bips.filter(function (oid) { return !acByOrder[oid]; });
    var aceleraSemExpedicao = Object.keys(acByOrder).filter(function (oid) { return !shipBip[oid]; });
    var liquidoDivergente = recs.filter(acLiquidoDivergente);
    var taxaDivergente = recs.filter(function (r) { return r.taxa < 0 || (r.antecipado > 0 && r.taxa > r.antecipado); });
    var incompletos = acelera.filter(function (r) { return !r.pedido || !r.resgate || !r.data || !r.antecipado; });
    // Possível duplicidade real na chave loja+resgate+pedido — a importação já impede (upsert por
    // essa chave), então isto só aparece se dois registros distintos colidirem (ex.: multiloja futura).
    var byKey = {}; var duplicados = [];
    acelera.forEach(function (r) { var k = (r.storeId || 'default') + '|' + r.resgate + '|' + r.pedido; if (byKey[k]) duplicados.push(r); else byKey[k] = r; });
    // §54: Income × Acelera — reaproveita aceleraConciliacaoPedido() (nunca reimporta Income aqui).
    var pedidosSet = {}; recs.forEach(function (r) { pedidosSet[r.pedido] = true; });
    var mrE = mrEngine(); var mrByOrderD = {}; mrE.orders.forEach(function (r) { mrByOrderD[r.orderId] = r; });
    var incomeDivergente = Object.keys(pedidosSet).map(function (pid) { return aceleraConciliacaoPedido(pid, mrByOrderD); }).filter(function (r) { return r.status.code === 'DIVERGENTE' && r.temIncome; });
    var cats = [
      { key: 'expSemAc', label: 'Expedidos sem Acelera', n: expedidosSemAcelera.length, icon: '🔴' },
      { key: 'acSemExp', label: 'Acelera sem expedição', n: aceleraSemExpedicao.length, icon: '⚠️' },
      { key: 'liq', label: 'Líquido divergente', n: liquidoDivergente.length, icon: '🔴' },
      { key: 'taxa', label: 'Taxa divergente', n: taxaDivergente.length, icon: '🔴' },
      { key: 'incompleto', label: 'Registro incompleto', n: incompletos.length, icon: '🟡' },
      { key: 'dup', label: 'Possível duplicidade', n: duplicados.length, icon: '🟡' },
      { key: 'income', label: 'Income × Acelera não bate', n: incomeDivergente.length, icon: '🔴' },
    ];
    var strip = kstrip(cats.map(function (c) { return { l: c.icon + ' ' + c.label, v: nn(c.n), cls: c.n ? 'amber' : 'green' }; }));
    var sel = aceleraF.divCat || 'liq';
    var chips = cats.map(function (c) { return '<span class="chip' + (sel === c.key ? ' chip-on' : '') + '" data-acdivcat="' + c.key + '">' + c.icon + ' ' + c.label + ' (' + nn(c.n) + ')</span>'; }).join('');
    var body;
    if (sel === 'expSemAc') body = aceleraDivTable(expedidosSemAcelera.map(function (oid) { return { pedido: oid, motivo: 'Expedido em ' + dbr(shipBip[oid].bipedAt) + ', sem registro no Acelera' }; }));
    else if (sel === 'acSemExp') body = aceleraDivTable(aceleraSemExpedicao.map(function (oid) { var r = acByOrder[oid][0]; return { pedido: oid, motivo: 'Antecipado em ' + acDbr(r.data) + ', sem expedição/bipe registrado' }; }));
    else if (sel === 'liq') body = aceleraDivTable(liquidoDivergente.map(function (r) { return { pedido: r.pedido, resgate: r.resgate, motivo: 'Líquido informado ' + brlC(r.recebido) + ' ≠ calculado ' + brlC(acLiquidoCalc(r)) + ' (diferença ' + brlC(acLiquidoDiff(r)) + ')' }; }));
    else if (sel === 'taxa') body = aceleraDivTable(taxaDivergente.map(function (r) { return { pedido: r.pedido, resgate: r.resgate, motivo: r.taxa < 0 ? 'Taxa negativa: ' + brlC(r.taxa) : 'Taxa (' + brlC(r.taxa) + ') maior que o antecipado (' + brlC(r.antecipado) + ')' }; }));
    else if (sel === 'incompleto') body = aceleraDivTable(incompletos.map(function (r) { var faltando = []; if (!r.pedido) faltando.push('ID do pedido'); if (!r.resgate) faltando.push('ID do resgate'); if (!r.data) faltando.push('data'); if (!r.antecipado) faltando.push('valor antecipado'); return { pedido: r.pedido || '—', resgate: r.resgate || '—', motivo: 'Faltando: ' + faltando.join(', ') }; }));
    else if (sel === 'income') body = aceleraDivTable(incomeDivergente.map(function (r) { return { pedido: r.pedido, resgate: '—', motivo: r.motivo }; }));
    else body = aceleraDivTable(duplicados.map(function (r) { return { pedido: r.pedido, resgate: r.resgate, motivo: 'Conflito na chave loja+resgate+pedido' }; }));
    return head + strip + '<div class="chips" style="margin-top:8px">' + chips + '</div>' + body;
  }
  function aceleraDivTable(items) {
    if (!items.length) return callout('green', '✓ Nenhuma divergência nesta categoria', '');
    var rows = items.slice(0, 300).map(function (it) { return '<tr class="rowlink" data-acped="' + esc(it.pedido) + '"><td class="mono">' + esc(it.pedido) + '</td><td class="mono">' + esc(it.resgate || '—') + '</td><td class="cell-text">' + esc(it.motivo) + '</td></tr>'; }).join('');
    return '<div class="panel" style="margin-top:8px"><div class="table-wrap"><table class="report"><thead><tr><th>Pedido</th><th>Resgate</th><th>Motivo</th></tr></thead><tbody>' + rows + '</tbody></table></div><div class="footnote" style="padding:8px 16px">Clique numa linha para ver o detalhe (esperado × encontrado).</div></div>';
  }
  function bindAceleraDivergencias() { app.querySelectorAll('[data-acdivcat]').forEach(function (c) { c.onclick = function () { aceleraF.divCat = c.dataset.acdivcat; render(); }; }); }

  // §19 da refatoração: auditoria financeira (antecipado−taxa=líquido calculado × informado),
  // de contagem (brutos/únicos/novos/atualizados/inválidos) e de conciliação (expedição × Acelera).
  // §33-60 da correção: "Conciliação Financeira por Pedido" — cruza Pedidos + Minha Renda/Income
  // (reaproveitando a base já normalizada por mrEngine(), NUNCA reimportando Income dentro do
  // Acelera — não existe "Income Acelera" como fonte separada) + Acelera pelo ID do pedido. Cascata:
  // Venda [Income] → Líquido esperado [Income "Pagamento Liberado"] → Disponível p/ resgate rápido
  // [Acelera] → Bruto resgatado → Taxa Acelera → Recebido. Duas verificações independentes e
  // deterministas: (1) interna do Acelera (bruto − taxa = recebido, já usada em toda a Visão Geral),
  // (2) cruzada Income × Acelera (líquido esperado × disponível para resgate). §47: pedido sem
  // cobertura de Income NUNCA vira 🔴 — vira ⚪ "sem dados suficientes", nunca inventamos divergência
  // por falta de dado.
  function aceleraConciliacaoPedido(pid, mrByOrder) {
    var acRecs = acelera.filter(function (r) { return r.pedido === pid; });
    var mrRow = mrByOrder[pid];
    var out = { pedido: pid, temAcelera: acRecs.length > 0, temIncome: !!mrRow };
    if (!acRecs.length) { out.status = { code: 'SEM_ACELERA', label: '—' }; return out; }
    var acAgg = acRecs.reduce(function (s, r) { s.disp += (r.disponivel || 0); s.antec += r.antecipado; s.taxa += r.taxa; s.receb += r.recebido; s.reemb += r.reembolsado; return s; }, { disp: 0, antec: 0, taxa: 0, receb: 0, reemb: 0 });
    out.disponivel = acAgg.disp; out.bruto = acAgg.antec; out.taxaAcelera = acAgg.taxa; out.recebido = acAgg.receb;
    out.internalOk = Math.abs(acAgg.receb - (acAgg.antec - acAgg.taxa)) <= 2;
    if (!out.internalOk) { out.status = { code: 'DIVERGENTE', label: '🔴 Divergência financeira', motivo: 'Bruto resgatado − taxa ≠ recebido (verificação interna do próprio Acelera)' }; return out; }
    if (!mrRow) { out.status = { code: 'SEM_DADOS', label: '⚪ Sem dados suficientes' }; return out; }
    out.venda = mrRow.preco; out.liquidoEsperado = mrRow.liberado;
    var diffLiq = acAgg.disp - mrRow.liberado; out.diffLiquido = diffLiq;
    var tolerancia = Math.max(50, Math.round(Math.abs(mrRow.liberado) * 0.02)); // R$0,50 ou 2% — o maior
    if (Math.abs(diffLiq) <= tolerancia) { out.status = { code: 'OK', label: '🟢 100% conciliado' }; return out; }
    if (acAgg.reemb > 0) { out.status = { code: 'RESSALVA', label: '🟡 Conciliado com ressalva', motivo: 'Diferença explicada por reembolso identificado no Acelera (R$ ' + brl(acAgg.reemb / 100) + ')' }; return out; }
    out.status = { code: 'DIVERGENTE', label: '🔴 Divergência financeira', motivo: 'Líquido esperado (Income) diverge do valor disponível para resgate rápido (Acelera) em R$ ' + brl(Math.abs(diffLiq) / 100) + ', sem evento explicativo (reembolso) encontrado' };
    return out;
  }
  function aceleraConciliacaoTable() {
    var recs = aceleraInPeriod();
    var pedidosSet = {}; recs.forEach(function (r) { pedidosSet[r.pedido] = true; });
    var pedidos = Object.keys(pedidosSet);
    var mr = mrEngine(); var mrByOrder = {}; mr.orders.forEach(function (r) { mrByOrder[r.orderId] = r; });
    var results = pedidos.map(function (pid) { return aceleraConciliacaoPedido(pid, mrByOrder); });
    var counts = { OK: 0, RESSALVA: 0, DIVERGENTE: 0, SEM_DADOS: 0 };
    results.forEach(function (r) { if (counts[r.status.code] != null) counts[r.status.code]++; });
    var strip = kstrip([
      { l: '🟢 100% conciliado', v: nn(counts.OK), cls: 'green' },
      { l: '🟡 Conciliado com ressalva', v: nn(counts.RESSALVA), cls: counts.RESSALVA ? 'amber' : '' },
      { l: '🔴 Divergência financeira', v: nn(counts.DIVERGENTE), cls: counts.DIVERGENTE ? 'red' : 'green' },
      { l: '⚪ Sem dados suficientes (sem Income)', v: nn(counts.SEM_DADOS), cls: 'blue', s: 'não é erro — Income ainda não importado/não cobre o pedido' },
    ]);
    var divergentes = results.filter(function (r) { return r.status.code === 'DIVERGENTE' || r.status.code === 'RESSALVA'; }).slice(0, 300);
    var rows = divergentes.map(function (r) {
      return '<tr class="rowlink" data-acped="' + esc(r.pedido) + '"><td class="mono">' + esc(r.pedido) + '</td><td class="nowrap">' + (r.venda != null ? brlC(r.venda) : '—') + '</td><td class="nowrap">' + (r.liquidoEsperado != null ? brlC(r.liquidoEsperado) : '—') + '</td><td class="nowrap">' + brlC(r.disponivel) + '</td><td class="nowrap">' + brlC(r.bruto) + '</td><td class="nowrap">' + brlC(r.taxaAcelera) + '</td><td class="nowrap">' + brlC(r.recebido) + '</td><td>' + esc(r.status.label) + '</td><td class="cell-text">' + esc(r.motivo || '') + '</td></tr>';
    }).join('');
    var table = '<div class="panel"><div class="ph"><h3>Pedidos com ressalva ou divergência</h3><span class="footnote" style="margin:0">' + nn(divergentes.length) + ' de ' + nn(pedidos.length) + ' pedidos com Acelera no período (limitado a 300 na tabela)</span></div><div class="table-wrap"><table class="report"><thead><tr><th>Pedido</th><th>Venda (Income)</th><th>Líquido esperado (Income)</th><th>Disponível (Acelera)</th><th>Bruto resgatado</th><th>Taxa Acelera</th><th>Recebido</th><th>Status</th><th>Motivo</th></tr></thead><tbody>' + (rows || '<tr><td colspan="9" class="empty">Nenhum pedido com ressalva ou divergência. 🎉</td></tr>') + '</tbody></table></div></div>';
    var nota = callout('', 'Conciliação Financeira por Pedido', 'Cruza Venda e Líquido esperado (Minha Renda/Income — reaproveitado, nunca reimportado aqui) com Disponível para resgate rápido, Bruto resgatado, Taxa e Recebido (Acelera), pedido a pedido. Pedidos sem cobertura de Income aparecem como ⚪ "sem dados suficientes" — nunca como divergência inventada.');
    return nota + strip + table;
  }
  function aceleraAuditoria() {
    var recs = aceleraInPeriod(); var m = aceleraMetrics(recs);
    var head = secHead('ACELERA · AUDITORIA', 'Rastreabilidade e qualidade dos dados', 'De onde saiu cada número — financeira, contagem e conciliação.');
    var finDivergentes = recs.filter(acLiquidoDivergente); var finOk = recs.length - finDivergentes.length;
    var diffAcumulada = recs.reduce(function (s, r) { return s + acLiquidoDiff(r); }, 0);
    var finBlock = '<div class="panel"><div class="ph"><h3>Auditoria financeira</h3><span class="footnote" style="margin:0">antecipado − taxa = líquido calculado, comparado ao líquido informado pela Shopee (tolerância de 2 centavos)</span></div><div class="pb">' + kv('Registros corretos', nn(finOk)) + kv('Registros divergentes', nn(finDivergentes.length)) + kv('Diferença acumulada', brlC(diffAcumulada)) + '</div></div>';
    var imps = batches.filter(function (b) { return b.module === 'Shopee Acelera'; });
    var totalNovo = imps.reduce(function (s, b) { return s + (b.novo || 0); }, 0); var totalUpd = imps.reduce(function (s, b) { return s + (b.upd || 0); }, 0);
    var incompletos = acelera.filter(function (r) { return !r.pedido || !r.resgate || !r.data || !r.antecipado; });
    var cntBlock = '<div class="panel"><div class="ph"><h3>Auditoria de contagem</h3></div><div class="pb">' + kv('Registros brutos importados (total)', nn(acelera.length)) + kv('Pedidos únicos (no período)', nn(m.nPedidos)) + kv('Resgates únicos (no período)', nn(m.nResgates)) + kv('Registros novos (histórico de importações)', nn(totalNovo)) + kv('Registros atualizados', nn(totalUpd)) + kv('Registros inválidos/incompletos', nn(incompletos.length)) + '</div></div>';
    var bips = Object.keys(shipBip); var acByOrder = {}; acelera.forEach(function (r) { (acByOrder[r.pedido] = acByOrder[r.pedido] || []).push(r); });
    var encontrados = bips.filter(function (oid) { return acByOrder[oid]; }).length; var naoEncontrados = bips.length - encontrados;
    var acSemExp = Object.keys(acByOrder).filter(function (oid) { return !shipBip[oid]; }).length;
    var concBlock = '<div class="panel"><div class="ph"><h3>Auditoria de conciliação</h3></div><div class="pb">' + kv('Expedidos', nn(bips.length)) + kv('Encontrados no Acelera', nn(encontrados)) + kv('Não encontrados', nn(naoEncontrados)) + kv('Acelera sem expedição', nn(acSemExp)) + '<button class="btn-sm" data-acgo="expedidos" style="margin-top:8px">Ver Expedidos × Acelera</button></div></div>';
    var recon = aceleraReconcile(m); // §1 pergunta 10: bate com o resumo que a Shopee escreveu no arquivo?
    var an = m.anomalies;
    var anRows = an.slice(0, 200).map(function (x) { return '<tr><td class="mono">' + esc(x.r.pedido) + '</td><td class="cell-text">' + esc(x.type) + '</td><td class="nowrap">' + brlC(x.r.antecipado) + '</td><td class="nowrap">' + brlC(x.r.reembolsado) + '</td><td class="nowrap">' + brlC(x.r.pendente) + '</td><td><button class="btn-sm" data-acped="' + esc(x.r.pedido) + '">Abrir</button></td></tr>'; }).join('');
    var qual = '<div class="panel"><div class="ph"><h3>Qualidade dos dados — anomalias</h3><span class="footnote" style="margin:0">' + nn(an.length) + ' registro(s) marcados · nunca descartados</span></div><div class="table-wrap"><table class="report"><thead><tr><th>Pedido</th><th>Anomalia</th><th>Antecipado</th><th>Reembolsado</th><th>Pendente</th><th></th></tr></thead><tbody>' + (anRows || '<tr><td colspan="6" class="empty">Nenhuma anomalia detectada. 🎉</td></tr>') + '</tbody></table></div></div>';
    var pr = aceleraSummary ? aceleraSummary.periodReal : null;
    var periodo = aceleraSummary ? callout('', 'Auditoria de período', 'Declarado pela Shopee: <b>' + esc(aceleraSummary.periodDeclared || '—') + '</b> · Registros de <b>' + esc((pr && pr.min) || '—') + '</b> a <b>' + esc((pr && pr.max) || '—') + '</b> · Importado em ' + new Date(aceleraSummary.importedAt).toLocaleString('pt-BR') + '. Nenhum registro foi descartado por causa do período do cabeçalho.') : '';
    var conciliacaoPedido = aceleraConciliacaoTable();
    return head + finBlock + cntBlock + concBlock + recon + periodo + qual + conciliacaoPedido;
  }

  // §20 da refatoração: fala sobre ARQUIVOS (CSV/XLS), não sobre resgates — um mesmo arquivo pode
  // conter vários dias, vários resgates e vários pedidos.
  function aceleraImportacoes() {
    var head = secHead('ACELERA · IMPORTAÇÕES', 'Arquivos importados', 'Um arquivo pode conter vários dias, vários resgates e vários pedidos — arquivo (CSV/XLS) e resgate (lote financeiro) são conceitos diferentes.');
    var imps = batches.filter(function (b) { return b.module === 'Shopee Acelera'; });
    if (!imps.length) return head + emptyBox('Nenhum arquivo importado ainda.');
    var rows = imps.map(function (b, i) { return '<tr class="rowlink" data-acimpopen="' + i + '"><td class="nowrap">' + new Date(b.createdAt).toLocaleString('pt-BR') + '</td><td class="cell-text">' + esc(b.filename) + '</td><td>' + nn(b.seen) + '</td><td>' + nn(b.novo) + '</td><td>' + nn(b.upd) + '</td><td>' + nn(b.unch) + '</td><td>' + nn(b.erros || 0) + '</td><td><button class="btn-sm">Detalhe</button></td></tr>'; }).join('');
    var table = '<div class="panel"><div class="table-wrap"><table class="report"><thead><tr><th>Data importação</th><th>Arquivo</th><th>Registros lidos</th><th>Novos</th><th>Atualizados</th><th>Ignorados</th><th>Erros</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div></div>';
    return head + table;
  }
  function bindAceleraImportacoes() {
    var imps = batches.filter(function (b) { return b.module === 'Shopee Acelera'; });
    app.querySelectorAll('[data-acimpopen]').forEach(function (b) { b.onclick = function () { openAceleraImportDetail(imps[parseInt(b.dataset.acimpopen, 10)]); }; });
  }
  function openAceleraImportDetail(batch) {
    if (!batch) return;
    var d = document.createElement('div'); d.className = 'drawer'; var panel = document.createElement('div'); panel.className = 'drawer-panel'; panel.style.width = '480px'; panel.style.maxWidth = '96vw';
    d.appendChild(panel); d.onclick = function (e) { if (e.target === d) d.remove(); }; document.body.appendChild(d);
    panel.innerHTML = '<div class="dh"><div><b>' + esc(batch.filename) + '</b></div><button class="x">&times;</button></div><div class="dbd">' +
      kv('Importado em', new Date(batch.createdAt).toLocaleString('pt-BR')) + kv('Linhas lidas', nn(batch.seen)) + kv('Pedidos únicos (neste arquivo)', batch.pedidosUnicos != null ? nn(batch.pedidosUnicos) : '—') + kv('Resgates únicos (neste arquivo)', batch.resgatesUnicos != null ? nn(batch.resgatesUnicos) : '—') + kv('Intervalo de datas', (batch.periodMin ? acDbr(batch.periodMin) : '—') + ' a ' + (batch.periodMax ? acDbr(batch.periodMax) : '—')) + kv('Novos', nn(batch.novo)) + kv('Atualizados', nn(batch.upd)) + kv('Sem alteração', nn(batch.unch)) +
      '</div>';
    panel.querySelector('.x').onclick = function () { d.remove(); };
  }

  // ============================= AFILIADOS =============================
  // Motor determinístico. Dinheiro em DÉCIMOS DE MILÉSIMO (u4 = R$ ×10000) para não perder precisão
  // das comissões com 4 casas (ex.: 29,7555). Nada de LLM em cálculo. Dado ausente ≠ R$ 0.
  function brlU(u) { return brl((u || 0) / 10000); }
  function affNum(s) { if (s == null) return 0; var t = String(s).replace(/^\s*=?\s*"?/, '').replace(/"?\s*$/, '').replace(/r\$/i, '').replace(/\s/g, '').trim(); if (t === '' || t === '-') return 0; if (t.indexOf(',') >= 0 && t.indexOf('.') >= 0) t = t.replace(/\./g, '').replace(',', '.'); else if (t.indexOf(',') >= 0) t = t.replace(',', '.'); var n = parseFloat(t); return isNaN(n) ? 0 : n; }
  function affU4(s) { return Math.round(affNum(s) * 10000); }
  function affPctVal(s) { if (s == null || s === '') return null; var t = String(s).replace('%', '').replace(',', '.').trim(); var n = parseFloat(t); return isNaN(n) ? null : n / 100; }
  function affCleanId(s) { return String(s == null ? '' : s).replace(/^\s*=?\s*"?/, '').replace(/"?\s*$/, '').trim(); }
  // parser CSV robusto (aspas, vírgulas internas, "" e o idioma ="..." da Shopee)
  function parseCSVText(text) {
    text = String(text).replace(/^﻿/, ''); var rows = [], row = [], f = '', q = false;
    for (var i = 0; i < text.length; i++) { var c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
      else { if (c === '"') q = true; else if (c === ',') { row.push(f); f = ''; } else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; } else if (c === '\r') { } else f += c; } }
    if (f !== '' || row.length) { row.push(f); rows.push(row); } return rows;
  }
  var UF_REGIAO = { AC: 'Norte', AM: 'Norte', AP: 'Norte', PA: 'Norte', RO: 'Norte', RR: 'Norte', TO: 'Norte', AL: 'Nordeste', BA: 'Nordeste', CE: 'Nordeste', MA: 'Nordeste', PB: 'Nordeste', PE: 'Nordeste', PI: 'Nordeste', RN: 'Nordeste', SE: 'Nordeste', DF: 'Centro-Oeste', GO: 'Centro-Oeste', MT: 'Centro-Oeste', MS: 'Centro-Oeste', ES: 'Sudeste', MG: 'Sudeste', RJ: 'Sudeste', SP: 'Sudeste', PR: 'Sul', RS: 'Sul', SC: 'Sul' };
  function affDetectType(headerNorm) {
    var has = function (s) { return headerNorm.some(function (h) { return h.indexOf(s) >= 0; }); };
    if (has('id do pedido') && has('nome do afiliado') && has('id de atribuicao da comissao')) return 'conversion';
    if (has('id do afiliado') && has('comissao') && has('mes de conclusao')) return 'rpa';
    if (has('id de validacao') && has('despesa mensal')) return 'validationbill';
    return null;
  }
  function affParse(text) {
    var rows = parseCSVText(text); if (!rows.length) return { type: null };
    var header = rows[0].map(function (h) { return h.replace(/^﻿/, '').trim(); });
    var hn = header.map(function (h) { return normStatus(h); });
    var type = affDetectType(hn); if (!type) return { type: null };
    var idx = {}; hn.forEach(function (h, i) { if (!(h in idx)) idx[h] = i; });
    var g = function (r, label) { var i = idx[normStatus(label)]; return i == null ? '' : (r[i] == null ? '' : r[i]); };
    var out = [];
    for (var k = 1; k < rows.length; k++) {
      var r = rows[k]; if (!r || r.length < 3) continue;
      if (type === 'conversion') {
        var orderId = affCleanId(g(r, 'ID do pedido')); if (!orderId) continue;
        out.push({ orderId: orderId, orderStatus: g(r, 'Status do Pedido'), statusVerif: g(r, 'Status verificado'), orderTime: g(r, 'Horário do pedido'), completion: g(r, 'Período de Conclusão do Pedido'), productId: affCleanId(g(r, 'ID do Produto')), productName: g(r, 'Nome do Produto'), modelId: affCleanId(g(r, 'ID do modelo')), catL1: g(r, 'Categoria Global L1'), catL2: g(r, 'Categoria Global L2'), catL3: g(r, 'Categoria Global L3'), price: affU4(g(r, 'Preço(R$)')), qty: parseInt(g(r, 'Qtd'), 10) || 0, affName: (g(r, 'Nome do afiliado') || '').trim(), affUser: (g(r, 'Nome de usuário do afiliado') || '').trim(), attrId: affCleanId(g(r, 'Id de atribuição da comissão')), campaign: g(r, 'Campanha do parceiro'), campaignType: g(r, 'Tipo de Campanha'), purchase: affU4(g(r, 'Valor da Compra(R$)')), refund: affU4(g(r, 'Valor do reembolso(R$)')), orderType: g(r, 'Tipo de Pedido'), comItemAff: affU4(g(r, 'Comissão do item da marca para o Afiliado(R$)')), rateItemAff: affPctVal(g(r, 'Taxa de Comissão do item da marca para o Afiliado')), comOrderAff: affU4(g(r, 'Comissão do pedido da marca para o Afiliado(R$)')), channel: (g(r, 'Canal') || '').trim(), svcPct: affPctVal(g(r, '% da taxa de serviço de Afiliados do Vendedor')), svcFee: affU4(g(r, 'Taxa de serviço de Afiliados do Vendedor(R$)')), despesaStated: affU4(g(r, 'despesas(R$)')), despesaHas: (g(r, 'despesas(R$)') || '').trim() !== '', dedState: (g(r, 'Estado de dedução') || '').trim(), dedMethod: (g(r, 'Método de dedução') || '').trim(), chargePeriod: g(r, 'Período de cobrança da comissão') });
      } else if (type === 'rpa') {
        var affId = affCleanId(g(r, 'ID do Afiliado')); if (!affId) continue;
        out.push({ month: (g(r, 'Mês de conclusão') || '').trim(), legalName: (g(r, 'Nome completo do afiliado') || '').trim(), affId: affId, gross: affU4(g(r, 'Comissão  bruta') || g(r, 'Comissão bruta')), cpf: g(r, 'CPF'), email: g(r, 'Email'), phone: g(r, 'Telefone'), birth: g(r, 'Data de nascimento'), address: g(r, 'Endereço') });
      } else {
        var vid = affCleanId(g(r, 'ID de Validação')); if (!vid) continue;
        out.push({ validationId: vid, month: (g(r, 'Mês de Validade') || '').trim(), monthlyExpense: affU4(g(r, 'Despesa Mensal(R$)')), status: (g(r, 'Status Deduzido') || '').trim(), totalDeducted: affU4(g(r, 'Quantia Total Deduzida(R$)')), amsCredit: affU4(g(r, 'AMS Credit Deducted Amount(R$)')), totalPending: affU4(g(r, 'Quantia Total Pendente(R$)')) });
      }
    }
    return { type: type, rows: out };
  }
  function importAfiliados(file) {
    return file.arrayBuffer().then(function (ab) {
      var name = (file.name || '').toLowerCase(); var text;
      if (name.slice(-5) === '.xlsx' || name.slice(-4) === '.xls') { var wb = XLSX.read(new Uint8Array(ab), { type: 'array' }); text = XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]]); }
      else text = new TextDecoder('utf-8').decode(ab).replace(/^﻿/, '');
      var parsed = affParse(text);
      if (!parsed.type) throw new Error('Relatório de afiliados não reconhecido (esperado Conversão de Pedidos, RPA ou Validation Bill da Shopee).');
      var importedAt = new Date().toISOString(); var novo = 0, upd = 0, unch = 0, changed = []; var store, typeLabel;
      if (parsed.type === 'conversion') {
        store = 'affconv'; typeLabel = 'Afiliados — Conversão de Pedidos'; var byId = {}; affConv.forEach(function (x) { byId[x.id] = x; });
        parsed.rows.forEach(function (row) { var id = row.orderId + '|' + row.productId + '|' + row.modelId + '|' + row.attrId + '|' + row.orderTime; var ex = byId[id];
          if (!ex) { var rec = Object.assign({ id: id, firstImportAt: importedAt, lastImportAt: importedAt, fileName: file.name, history: [] }, row); byId[id] = rec; changed.push(rec); novo++; return; }
          var same = ex.orderStatus === row.orderStatus && ex.dedState === row.dedState && ex.comItemAff === row.comItemAff && ex.svcFee === row.svcFee && ex.refund === row.refund && ex.chargePeriod === row.chargePeriod;
          if (same) { unch++; return; }
          ex.history = ex.history || []; ex.history.unshift({ at: importedAt, statusOld: ex.orderStatus, statusNew: row.orderStatus, dedOld: ex.dedState, dedNew: row.dedState });
          ex.orderStatus = row.orderStatus; ex.statusVerif = row.statusVerif; ex.completion = row.completion; ex.dedState = row.dedState; ex.dedMethod = row.dedMethod; ex.chargePeriod = row.chargePeriod; ex.refund = row.refund; ex.comItemAff = row.comItemAff; ex.svcFee = row.svcFee; ex.despesaStated = row.despesaStated; ex.lastImportAt = importedAt; changed.push(ex); upd++; });
        affConv = Object.values(byId);
      } else if (parsed.type === 'rpa') {
        store = 'affrpa'; typeLabel = 'Afiliados — RPA / Fechamento Mensal'; var byId2 = {}; affRpa.forEach(function (x) { byId2[x.id] = x; });
        parsed.rows.forEach(function (row) { var id = row.month + '|' + row.affId; var ex = byId2[id];
          if (!ex) { var rec = Object.assign({ id: id, firstImportAt: importedAt, lastImportAt: importedAt, fileName: file.name, history: [] }, row); byId2[id] = rec; changed.push(rec); novo++; return; }
          if (ex.gross === row.gross && ex.legalName === row.legalName) { unch++; return; }
          ex.history = ex.history || []; ex.history.unshift({ at: importedAt, grossOld: ex.gross, grossNew: row.gross }); ex.gross = row.gross; ex.legalName = row.legalName; ex.lastImportAt = importedAt; changed.push(ex); upd++; });
        affRpa = Object.values(byId2);
      } else {
        store = 'affvb'; typeLabel = 'Afiliados — Comissão Extra / Validation Bill'; var byId3 = {}; affVb.forEach(function (x) { byId3[x.id] = x; });
        parsed.rows.forEach(function (row) { var id = row.validationId; var ex = byId3[id];
          if (!ex) { var rec = Object.assign({ id: id, firstImportAt: importedAt, lastImportAt: importedAt, fileName: file.name, history: [] }, row); byId3[id] = rec; changed.push(rec); novo++; return; }
          if (ex.totalDeducted === row.totalDeducted && ex.totalPending === row.totalPending && ex.status === row.status) { unch++; return; }
          ex.history = ex.history || []; ex.history.unshift({ at: importedAt, dedOld: ex.totalDeducted, dedNew: row.totalDeducted }); ex.monthlyExpense = row.monthlyExpense; ex.status = row.status; ex.totalDeducted = row.totalDeducted; ex.amsCredit = row.amsCredit; ex.totalPending = row.totalPending; ex.lastImportAt = importedAt; changed.push(ex); upd++; });
        affVb = Object.values(byId3);
      }
      var batch = { id: 'af' + Date.now() + Math.round(performance.now()), module: 'Afiliados', filename: file.name, typeLabel: typeLabel, createdAt: importedAt, seen: parsed.rows.length, novo: novo, upd: upd, unch: unch, itemsSeen: parsed.rows.length };
      batches.unshift(batch); lastImportStamp = importedAt;
      return Promise.all([putMany(store, changed), putMany('batches', [batch])]).then(function () { return { batch: batch, type: parsed.type, typeLabel: typeLabel, novo: novo, upd: upd, unch: unch }; });
    });
  }

  // ---- motor determinístico Afiliados ----
  function affOrderUF(orderId) { var o = orders.find(function (x) { return x.id === orderId; }); return o ? (o.uf || null) : null; }
  function affAliceStatus(s) { var n = normStatus(s); if (n.indexOf('cancel') >= 0) return 'cancelado'; if (n.indexOf('conclu') >= 0) return 'concluido'; if (n.indexOf('pendente') >= 0) return 'pendente'; if (n.indexOf('nao pago') >= 0) return 'naopago'; return 'outro'; }
  function affKey(rec) { return (rec.affUser || normStatus(rec.affName) || '—'); }
  // Afiliados filtrado pelo período GLOBAL (topo da tela) — mesma fonte usada por Devolução/Carteira/Acelera.
  function affConvP() { return affConv.filter(function (r) { return inPeriod(r.orderTime); }); }
  function affEngine() {
    var conv = affConvP();
    // consolida ITENS → PEDIDOS (comissão do afiliado = soma dos itens do pedido, §3)
    var orderMap = {};
    conv.forEach(function (r) { var o = orderMap[r.orderId]; if (!o) { o = orderMap[r.orderId] = { orderId: r.orderId, items: [], affUser: affKey(r), affName: r.affName, channel: r.channel, campaign: r.campaign, campaignType: r.campaignType, status: r.orderStatus, dedState: r.dedState, dedMethod: r.dedMethod, chargePeriod: r.chargePeriod, orderTime: r.orderTime, completion: r.completion, purchase: 0, comAff: 0, svcFee: 0, despesaStated: 0, despesaHas: false, refund: 0, rateSum: 0, rateN: 0 }; } o.items.push(r); o.purchase += r.purchase; o.comAff += r.comItemAff; o.svcFee += r.svcFee; o.despesaStated += r.despesaStated; if (r.despesaHas) o.despesaHas = true; o.refund += r.refund; if (r.rateItemAff != null) { o.rateSum += r.rateItemAff; o.rateN++; } });
    var ordersArr = Object.keys(orderMap).map(function (k) { return orderMap[k]; });
    ordersArr.forEach(function (o) { o.despesaRecon = o.comAff + o.svcFee; o.uf = affOrderUF(o.orderId); o.region = o.uf ? (UF_REGIAO[o.uf] || 'Outra') : null; o.st = affAliceStatus(o.status); });
    // por afiliado
    var affMap = {};
    ordersArr.forEach(function (o) { var a = affMap[o.affUser]; if (!a) a = affMap[o.affUser] = { user: o.affUser, name: o.affName, orders: 0, sales: 0, comAff: 0, svcFee: 0, despesa: 0, units: 0, cancelled: 0, refund: 0, concluded: 0, channels: {}, dedDeduzido: 0, dedPendente: 0 }; a.orders++; a.sales += o.purchase; a.comAff += o.comAff; a.svcFee += o.svcFee; a.despesa += (o.despesaHas ? o.despesaStated : o.despesaRecon); a.refund += o.refund; o.items.forEach(function (it) { a.units += it.qty; }); if (o.st === 'cancelado') a.cancelled++; if (o.st === 'concluido') a.concluded++; a.channels[o.channel || '—'] = (a.channels[o.channel || '—'] || 0) + 1; var nd = normStatus(o.dedState); if (nd.indexOf('deduzido') >= 0) a.dedDeduzido += (o.despesaHas ? o.despesaStated : o.despesaRecon); else if (nd.indexOf('pendente') >= 0) a.dedPendente += (o.despesaHas ? o.despesaStated : o.despesaRecon); });
    var affs = Object.values(affMap).map(function (a) { a.rateAvg = a.sales ? a.comAff / a.sales : 0; a.cancelRate = a.orders ? a.cancelled / a.orders : 0; a.custoReceita = a.sales ? a.despesa / a.sales : 0; a.ticket = a.orders ? a.sales / a.orders : 0; return a; });
    // totais
    var tot = { orders: ordersArr.length, sales: 0, comAff: 0, svcFee: 0, despesa: 0, despesaStated: 0, refund: 0, cancelled: 0, concluded: 0, deduzido: 0, pendente: 0, units: 0 };
    ordersArr.forEach(function (o) { tot.sales += o.purchase; tot.comAff += o.comAff; tot.svcFee += o.svcFee; tot.despesa += (o.despesaHas ? o.despesaStated : o.despesaRecon); tot.despesaStated += o.despesaStated; tot.refund += o.refund; if (o.st === 'cancelado') tot.cancelled++; if (o.st === 'concluido') tot.concluded++; o.items.forEach(function (it) { tot.units += it.qty; }); var nd = normStatus(o.dedState); if (nd.indexOf('deduzido') >= 0) tot.deduzido += (o.despesaHas ? o.despesaStated : o.despesaRecon); else if (nd.indexOf('pendente') >= 0) tot.pendente += (o.despesaHas ? o.despesaStated : o.despesaRecon); });
    tot.despesaRecon = tot.comAff + tot.svcFee;
    return { orderMap: orderMap, ordersArr: ordersArr, affs: affs, tot: tot };
  }
  function affLucroPedido(o) {
    // lucro real do pedido: usa financeiro do módulo Pedidos quando o pedido existe; senão indisponível
    var ord = orders.find(function (x) { return x.id === o.orderId; }); if (!ord) return { known: false };
    var f = orderFinance(ord); if (f.costPending) return { known: false, partial: true, ord: ord, f: f };
    var custoAff = (o.despesaHas ? o.despesaStated : o.despesaRecon) / 10000;
    var lucro = (f.estimatedResult || 0) - custoAff; // resultado do pedido já desconta taxas marketplace e custo produto
    return { known: true, lucro: Math.round(lucro * 10000), margem: o.purchase ? (lucro / (o.purchase / 10000)) : 0, ord: ord, f: f };
  }

  function renderAfiliados() {
    var tabs = [['visao', 'Visão Geral'], ['afiliados', 'Afiliados'], ['pedidos', 'Pedidos / Conversões'], ['financeiro', 'Financeiro & Conciliação'], ['extra', 'Comissão Extra'], ['devolucoes', 'Devoluções & Estornos'], ['ia', 'Inteligência']];
    app.innerHTML = devPeriodBar() + '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap"><div class="subtabs" style="margin-bottom:0;overflow-x:auto">' + tabs.map(function (t) { return '<div class="subtab' + (affSub === t[0] ? ' active' : '') + '" data-affsub="' + t[0] + '">' + t[1] + '</div>'; }).join('') + '</div><button class="btn-sm primary" data-affimport="1">Importar relatório de afiliados</button></div><div id="affbody" style="margin-top:14px"></div>';
    var body = document.getElementById('affbody');
    try {
      if (!affConv.length && !affRpa.length && !affVb.length) body.innerHTML = secHead('AFILIADOS', 'Afiliados', 'Aquisição, performance, rentabilidade, financeiro, conciliação e auditoria das vendas por afiliados.') + emptyBox('Nenhum relatório de afiliados importado. Envie a Conversão de Pedidos, o RPA (fechamento mensal) e/ou a Comissão Extra (Validation Bill) — o tipo é detectado pelo cabeçalho.') + '<div style="text-align:center;margin-top:-8px"><button class="btn-sm primary" id="affimp">Importar primeiro relatório</button></div>';
      else body.innerHTML = ({ visao: affVisao, afiliados: affAfiliados, pedidos: affPedidos, financeiro: affFinanceiro, extra: affExtra, devolucoes: affDevolucoes, ia: affIA }[affSub] || affVisao)();
    } catch (e) { body.innerHTML = '<div class="form-err">Erro ao renderizar Afiliados: ' + esc(e.message || e) + '</div>'; }
    app.querySelectorAll('[data-affsub]').forEach(function (b) { b.onclick = function () { affSub = b.dataset.affsub; affPage = 1; render(); }; });
    var imp = function () { fileInput(function (f) { importAfiliados(f).then(function (b) { render(); toast(b.typeLabel + ' importado', b.novo + ' novos · ' + b.upd + ' atualizados · ' + b.unch + ' sem alteração'); }).catch(function (e) { toast('Falha', e.message, true); }); }); };
    app.querySelectorAll('[data-affimport]').forEach(function (b) { b.onclick = imp; });
    var ai = document.getElementById('affimp'); if (ai) ai.onclick = imp;
    app.querySelectorAll('[data-affgo]').forEach(function (b) { b.onclick = function () { affSub = b.dataset.affgo; if (b.dataset.afffilter) { try { var f = JSON.parse(b.dataset.afffilter); Object.keys(f).forEach(function (k) { affF[k] = f[k]; }); } catch (e) { } } affPage = 1; render(); }; });
    app.querySelectorAll('[data-affprof]').forEach(function (b) { b.onclick = function () { openAffProfile(b.dataset.affprof); }; });
    app.querySelectorAll('[data-affped]').forEach(function (b) { b.onclick = function () { openAffPedido(b.dataset.affped); }; });
    bindDevPeriodBar();
    if (affSub === 'pedidos') bindAffPedidos();
  }

  function affVisao() {
    var e = affEngine(); var t = e.tot;
    var head = secHead('AFILIADOS', 'Visão Geral', 'Quanto vendemos com afiliados, quanto pagamos, quanto a Shopee ainda vai descontar, quem vende, quem custa, quem dá lucro — e onde há divergência.');
    var custoTotal = t.despesa; var lucroKnown = 0, lucroN = 0; e.ordersArr.forEach(function (o) { var l = affLucroPedido(o); if (l.known) { lucroKnown += l.lucro; lucroN++; } });
    var strip1 = kstrip([
      { l: 'Vendas atribuídas', v: brlU(t.sales), cls: 'blue', s: nn(t.orders) + ' pedidos · ' + nn(e.affs.length) + ' afiliados' },
      { l: 'Comissão gerada', v: brlU(t.comAff), cls: 'red', s: 'nível do item' },
      { l: 'Taxa serviço afiliados', v: brlU(t.svcFee), cls: 'amber' },
      { l: 'Despesa total afiliados', v: brlU(t.despesa), cls: 'red', s: 'custo/receita ' + pct(r2(t.sales ? t.despesa / t.sales * 100 : 0)) },
      { l: 'Já deduzido', v: brlU(t.deduzido), cls: 'green' },
      { l: 'Pendente de dedução', v: brlU(t.pendente), cls: 'amber' },
    ]);
    var strip2 = kstrip([
      { l: 'Pedidos cancelados', v: nn(t.cancelled), cls: 'amber', s: pct(r2(t.orders ? t.cancelled / t.orders * 100 : 0)) },
      { l: 'Reembolso', v: brlU(t.refund), cls: 'red' },
      { l: 'Concluídos', v: nn(t.concluded), cls: 'green' },
      { l: 'Lucro real (pedidos c/ custo)', v: lucroN ? brlU(lucroKnown) : 'sem base', cls: lucroKnown >= 0 ? 'green' : 'red', s: lucroN ? nn(lucroN) + ' pedidos' : 'importe custos em Produtos' },
      { l: 'Comissão média/pedido', v: brlU(t.orders ? Math.round(t.comAff / t.orders) : 0), cls: 'blue' },
      { l: 'Taxa média ponderada', v: pct(r2(t.sales ? t.comAff / t.sales * 100 : 0)), cls: 'amber' },
    ]);
    // top afiliados
    var topSales = e.affs.slice().sort(function (a, b) { return b.sales - a.sales; }).slice(0, 10);
    var topChart = topSales.length ? chartCard('Top afiliados por vendas', legendSwatch([['Vendas', '#2b4bd6']]), svgHBars(topSales.map(function (a) { return { label: a.user, value: a.sales / 10000 }; }), { fmt: function (v) { return brl(v); } })) : '';
    // canais
    var chMap = {}; e.ordersArr.forEach(function (o) { var c = o.channel || '—'; var g = chMap[c] = chMap[c] || { c: c, sales: 0, orders: 0, com: 0 }; g.sales += o.purchase; g.orders++; g.com += o.comAff; });
    var chans = Object.values(chMap).sort(function (a, b) { return b.sales - a.sales; });
    var chChart = chans.length ? chartCard('Vendas por canal', legendSwatch([['Vendas', '#0f9d6b']]), svgHBars(chans.slice(0, 10).map(function (c) { return { label: c.c, value: c.sales / 10000, color: '#0f9d6b' }; }), { fmt: function (v) { return brl(v); } })) : '';
    // taxas
    var rateMap = {}; affConvP().forEach(function (r) { if (r.rateItemAff == null) return; var k = (r2(r.rateItemAff * 100)) + '%'; var g = rateMap[k] = rateMap[k] || { k: k, rate: r.rateItemAff, sales: 0, com: 0, n: 0 }; g.sales += r.purchase; g.com += r.comItemAff; g.n++; });
    var rates = Object.values(rateMap).sort(function (a, b) { return b.rate - a.rate; });
    var altas = rates.filter(function (x) { return x.rate >= affCfg.rateAlert; }); var altasSales = altas.reduce(function (s, x) { return s + x.sales; }, 0);
    var rateRows = rates.map(function (x) { return '<tr' + (x.rate >= affCfg.rateAlert ? ' style="background:#fdf1e9"' : '') + '><td>' + esc(x.k) + (x.rate >= affCfg.rateAlert ? ' <span class="tag warn">alta</span>' : '') + '</td><td>' + nn(x.n) + '</td><td class="nowrap">' + brlU(x.sales) + '</td><td class="nowrap">' + brlU(x.com) + '</td></tr>'; }).join('');
    var rateTable = '<div class="panel"><div class="ph"><h3>Distribuição das vendas por taxa de comissão</h3>' + (altasSales > 0 ? '<span class="tag warn">' + brlU(altasSales) + ' em vendas com taxa ≥ ' + pct(r2(affCfg.rateAlert * 100)) + '</span>' : '') + '</div><div class="table-wrap"><table class="report"><thead><tr><th>Taxa</th><th>Itens</th><th>Vendas</th><th>Comissão</th></tr></thead><tbody>' + rateRows + '</tbody></table></div></div>';
    // regiões
    var regChart = affRegionPanel(e);
    // divergência despesa
    var difDesp = t.despesaStated - t.despesaRecon;
    var recon = Math.abs(difDesp) > affCfg.tolConcil ? callout('warn', '⚠ Despesa informada × reconstruída difere', 'A Shopee informou <b>' + brlU(t.despesaStated) + '</b> em despesas; a soma dos componentes conhecidos (comissão do afiliado + taxa de serviço) é <b>' + brlU(t.despesaRecon) + '</b> — diferença de <b>' + brlU(difDesp) + '</b>. Mostrada para conciliação; nada foi corrigido automaticamente.') : callout('green', '✓ Despesa informada bate com a reconstruída', 'Despesa Shopee ' + brlU(t.despesaStated) + ' ≈ componentes conhecidos ' + brlU(t.despesaRecon) + '.');
    return head + strip1 + strip2 + recon + topChart + chChart + rateTable + regChart;
  }
  function affRegionPanel(e) {
    var regMap = {}, semReg = { sales: 0, orders: 0 };
    e.ordersArr.forEach(function (o) { if (!o.region) { semReg.sales += o.purchase; semReg.orders++; return; } var g = regMap[o.region] = regMap[o.region] || { region: o.region, sales: 0, orders: 0, com: 0 }; g.sales += o.purchase; g.orders++; g.com += o.comAff; });
    var regs = Object.values(regMap).sort(function (a, b) { return b.sales - a.sales; });
    if (!regs.length && semReg.orders) return callout('', 'Regiões das vendas', 'Nenhum pedido de afiliado foi encontrado no módulo Pedidos para identificar a região de entrega. Importe os Pedidos correspondentes para ver vendas por região. <b>' + nn(semReg.orders) + '</b> pedidos sem região identificada.');
    var chart = chartCard('Vendas de afiliados por região (via endereço de entrega do Pedido)', legendSwatch([['Vendas', '#2b4bd6']]), svgHBars(regs.map(function (r) { return { label: r.region, value: r.sales / 10000 }; }), { fmt: function (v) { return brl(v); } }));
    var note = semReg.orders ? '<div class="footnote" style="margin-top:-6px">' + nn(semReg.orders) + ' pedidos sem pedido correspondente em Pedidos → região não identificada (' + brlU(semReg.sales) + ').</div>' : '';
    return chart + note;
  }

  function affAfiliados() {
    var e = affEngine(); var affs = e.affs.slice();
    if (affF.search) { var q = affF.search.toLowerCase(); affs = affs.filter(function (a) { return (a.user || '').toLowerCase().indexOf(q) >= 0 || (a.name || '').toLowerCase().indexOf(q) >= 0; }); }
    affs.sort(function (a, b) { return b.sales - a.sales; });
    var head = secHead('AFILIADOS · LISTA', 'Afiliados', 'Quem vende, quem custa e quem realmente dá lucro. Clique para abrir o perfil.');
    // concentração
    var totSales = e.tot.sales || 1; var acc = function (n) { return e.affs.slice().sort(function (a, b) { return b.sales - a.sales; }).slice(0, n).reduce(function (s, a) { return s + a.sales; }, 0); };
    var conc = kstrip([
      { l: 'Afiliados ativos', v: nn(e.affs.length), cls: 'blue' },
      { l: 'Concentração Top 1', v: pct(r2(acc(1) / totSales * 100)), cls: 'amber' },
      { l: 'Top 3', v: pct(r2(acc(3) / totSales * 100)), cls: 'amber' },
      { l: 'Top 5', v: pct(r2(acc(5) / totSales * 100)), cls: 'amber' },
      { l: 'Top 10', v: pct(r2(acc(10) / totSales * 100)), cls: 'amber' },
    ]);
    var rows = affs.slice(0, 300).map(function (a) { var cls = affClassify(a, e); return '<tr class="rowlink" data-affprof="' + esc(a.user) + '"><td class="cell-text"><b>' + esc(a.user) + '</b><div class="footnote" style="margin:0">' + esc(a.name || '') + '</div></td><td>' + nn(a.orders) + '</td><td class="nowrap">' + brlU(a.sales) + '</td><td class="nowrap">' + brlU(a.despesa) + '</td><td>' + pct(r2(a.custoReceita * 100)) + '</td><td>' + pct(r2(a.rateAvg * 100)) + '</td><td>' + nn(a.cancelled) + ' (' + pct(r2(a.cancelRate * 100)) + ')</td><td><span class="tag ' + cls.tag + '">' + cls.label + '</span></td><td><button class="btn-sm" data-affprof="' + esc(a.user) + '">Perfil</button></td></tr>'; }).join('');
    return head + conc +
      '<div class="toolbar2" style="margin-top:8px"><input class="input sm" id="affq" style="width:280px" placeholder="Buscar afiliado ou username…" value="' + esc(affF.search) + '"></div>' +
      '<div class="count-line"><b>' + nn(affs.length) + '</b> afiliados</div>' +
      '<div class="panel"><div class="table-wrap"><table class="report"><thead><tr><th>Afiliado</th><th>Pedidos</th><th>Vendas</th><th>Despesa</th><th>Custo/Rec.</th><th>Taxa média</th><th>Cancel.</th><th>Classe</th><th></th></tr></thead><tbody>' + (rows || '<tr><td colspan="9" class="empty">Nenhum afiliado.</td></tr>') + '</tbody></table></div></div>';
  }
  function affClassify(a, e) {
    var l = affAffLucro(a, e); if (l.known == null || l.n === 0) return { tag: 'neutral', label: 'sem custo' };
    var margem = l.sales ? l.lucro / l.sales : 0;
    if (margem < 0) return { tag: 'warn', label: 'Prejuízo' };
    if (margem < affCfg.margemAperta) return { tag: 'warn', label: 'Margem apertada' };
    if (margem < affCfg.margemBoa) return { tag: 'info', label: 'Rentável' };
    return { tag: 'ok', label: 'Muito rentável' };
  }
  function affAffLucro(a, e) {
    var lucro = 0, sales = 0, n = 0, known = false;
    e.ordersArr.forEach(function (o) { if (o.affUser !== a.user) return; var l = affLucroPedido(o); if (l.known) { lucro += l.lucro / 10000; sales += o.purchase / 10000; n++; known = true; } });
    return { known: known ? true : null, lucro: lucro, sales: sales, n: n };
  }
  function openAffProfile(user) {
    var e = affEngine(); var a = e.affs.find(function (x) { return x.user === user; }); if (!a) return;
    var d = document.createElement('div'); d.className = 'drawer'; var panel = document.createElement('div'); panel.className = 'drawer-panel'; panel.style.width = '780px'; panel.style.maxWidth = '97vw';
    d.appendChild(panel); d.onclick = function (ev) { if (ev.target === d) d.remove(); }; document.body.appendChild(d);
    var l = affAffLucro(a, e); var rpaMatch = affRpa.filter(function (r) { return normStatus(r.legalName) === normStatus(a.name); });
    var myOrders = e.ordersArr.filter(function (o) { return o.affUser === user; });
    var prods = {}; myOrders.forEach(function (o) { o.items.forEach(function (it) { var g = prods[it.productName || '—'] = prods[it.productName || '—'] || { name: it.productName, sales: 0, com: 0 }; g.sales += it.purchase; g.com += it.comItemAff; }); });
    var topProds = Object.values(prods).sort(function (x, y) { return y.sales - x.sales; }).slice(0, 6);
    var chMap = {}; myOrders.forEach(function (o) { chMap[o.channel || '—'] = (chMap[o.channel || '—'] || 0) + 1; });
    panel.innerHTML = '<div class="dh"><div><b>' + esc(a.user) + '</b> <span class="footnote" style="margin-left:6px">' + esc(a.name || '') + '</span></div><button class="x">&times;</button></div><div class="dbd">' +
      '<div class="kstrip" style="margin-bottom:12px"><div class="kc"><div class="kl">Vendas</div><div class="kv" style="font-size:16px">' + brlU(a.sales) + '</div></div><div class="kc"><div class="kl">Pedidos</div><div class="kv" style="font-size:16px">' + nn(a.orders) + '</div></div><div class="kc"><div class="kl">Despesa</div><div class="kv" style="font-size:16px">' + brlU(a.despesa) + '</div></div><div class="kc"><div class="kl">Taxa média</div><div class="kv" style="font-size:16px">' + pct(r2(a.rateAvg * 100)) + '</div></div></div>' +
      kstrip([{ l: 'Ticket médio', v: brlU(Math.round(a.ticket)), cls: 'blue' }, { l: 'Cancelados', v: nn(a.cancelled) + ' (' + pct(r2(a.cancelRate * 100)) + ')', cls: 'amber' }, { l: 'Reembolso', v: brlU(a.refund), cls: 'red' }, { l: 'Lucro (c/ custo)', v: l.n ? brl(l.lucro) : 'sem base', cls: l.lucro >= 0 ? 'green' : 'red', s: l.n ? nn(l.n) + ' pedidos' : '' }, { l: 'Deduzido', v: brlU(a.dedDeduzido), cls: 'green' }, { l: 'Pendente', v: brlU(a.dedPendente), cls: 'amber' }]) +
      '<div class="split2"><div class="panel"><div class="ph"><h3>Melhores produtos</h3></div><div class="table-wrap"><table class="report"><thead><tr><th>Produto</th><th>Vendas</th><th>Comissão</th></tr></thead><tbody>' + topProds.map(function (p) { return '<tr><td class="cell-text">' + esc((p.name || '—').slice(0, 40)) + '</td><td class="nowrap">' + brlU(p.sales) + '</td><td class="nowrap">' + brlU(p.com) + '</td></tr>'; }).join('') + '</tbody></table></div></div>' +
      '<div class="panel"><div class="ph"><h3>Canais</h3></div><div class="pb">' + Object.keys(chMap).sort(function (x, y) { return chMap[y] - chMap[x]; }).map(function (c) { return '<div class="fin-line"><span>' + esc(c) + '</span><b>' + nn(chMap[c]) + ' pedidos</b></div>'; }).join('') + '</div></div></div>' +
      '<div class="panel"><div class="ph"><h3>Conciliação com RPA</h3></div><div class="pb">' + (rpaMatch.length ? rpaMatch.map(function (r) { return '<div class="fin-line"><span>' + esc(r.month) + ' · RPA reconhece</span><b>' + brlU(r.gross) + '</b></div>'; }).join('') + '<div class="footnote">Comparação por nome; para vínculo firme use ID do afiliado (RPA) confirmado manualmente.</div>' : '<div class="footnote">Nenhum registro de RPA com este nome. Pode ser diferença de grafia — vincule a identidade manualmente quando houver o RPA.</div>') + '</div></div>' +
      '<div style="margin-top:8px"><button class="btn-sm" data-affgoped="' + esc(user) + '">Ver pedidos deste afiliado</button></div></div>';
    panel.querySelector('.x').onclick = function () { d.remove(); };
    var gp = panel.querySelector('[data-affgoped]'); if (gp) gp.onclick = function () { d.remove(); affF.search = user; affSub = 'pedidos'; render(); };
  }

  function affPedidos() {
    var e = affEngine(); var list = e.ordersArr.slice();
    if (affF.channel) list = list.filter(function (o) { return (o.channel || '—') === affF.channel; });
    if (affF.status) list = list.filter(function (o) { return o.st === affF.status; });
    if (affF.ded) list = list.filter(function (o) { return normStatus(o.dedState).indexOf(affF.ded) >= 0; });
    if (affF.region) list = list.filter(function (o) { return o.region === affF.region; });
    if (affF.search) { var q = affF.search.toLowerCase(); list = list.filter(function (o) { return (o.orderId || '').toLowerCase().indexOf(q) >= 0 || (o.affUser || '').toLowerCase().indexOf(q) >= 0 || (o.affName || '').toLowerCase().indexOf(q) >= 0; }); }
    list.sort(function (a, b) { return (b.orderTime || '').localeCompare(a.orderTime || ''); });
    var pages = Math.max(1, Math.ceil(list.length / 25)); if (affPage > pages) affPage = pages; var slice = list.slice((affPage - 1) * 25, affPage * 25);
    var channels = [''].concat(Object.keys(e.ordersArr.reduce(function (m, o) { m[o.channel || '—'] = 1; return m; }, {})));
    var head = secHead('AFILIADOS · PEDIDOS / CONVERSÕES', 'Pedidos / Conversões', 'Cada pedido atribuído a afiliado com comissão consolidada por item. Clique para ver a composição e o pedido original.');
    var rows = slice.map(function (o) { var st = o.st; var stTag = st === 'concluido' ? 'ok' : st === 'cancelado' ? 'warn' : 'neutral'; return '<tr class="rowlink" data-affped="' + esc(o.orderId) + '"><td class="mono">' + esc(o.orderId) + '</td><td class="nowrap">' + esc((o.orderTime || '').slice(0, 10)) + '</td><td class="cell-text">' + esc(o.affUser) + '</td><td>' + nn(o.items.length) + '</td><td class="nowrap">' + brlU(o.purchase) + '</td><td class="nowrap">' + brlU(o.comAff) + '</td><td>' + pct(r2(o.rateN ? o.rateSum / o.rateN * 100 : 0)) + '</td><td class="cell-text">' + esc(o.channel || '—') + '</td><td><span class="tag ' + stTag + '">' + esc(o.status) + '</span></td><td class="cell-text">' + esc(o.dedState || '—') + '</td><td><button class="btn-sm" data-affped="' + esc(o.orderId) + '">Abrir</button></td></tr>'; }).join('');
    return head +
      '<div class="chips">' + channels.map(function (c) { return '<span class="chip' + (affF.channel === c ? ' chip-on' : '') + '" data-affchan="' + esc(c) + '">' + (c === '' ? 'Todos os canais' : esc(c)) + '</span>'; }).join('') + '</div>' +
      '<div class="toolbar2" style="margin-top:8px"><input class="input sm" id="affpq" style="width:260px" placeholder="Buscar pedido ou afiliado…" value="' + esc(affF.search) + '"><select class="select sm" id="affstatus"><option value="">Status: todos</option>' + [['pendente', 'Pendente'], ['concluido', 'Concluído'], ['cancelado', 'Cancelado'], ['naopago', 'Não pago']].map(function (s) { return '<option value="' + s[0] + '"' + (affF.status === s[0] ? ' selected' : '') + '>' + s[1] + '</option>'; }).join('') + '</select><select class="select sm" id="affded"><option value="">Dedução: todas</option><option value="deduzido"' + (affF.ded === 'deduzido' ? ' selected' : '') + '>Deduzido</option><option value="pendente"' + (affF.ded === 'pendente' ? ' selected' : '') + '>Pendente</option></select>' + (affF.channel || affF.status || affF.ded || affF.search || affF.region ? '<button class="link-btn" id="affclear">limpar</button>' : '') + '</div>' +
      '<div class="count-line"><b>' + nn(list.length) + '</b> pedidos</div>' +
      '<div class="panel"><div class="table-wrap"><table class="report"><thead><tr><th>Pedido</th><th>Data</th><th>Afiliado</th><th>Itens</th><th>Compra</th><th>Comissão</th><th>Taxa</th><th>Canal</th><th>Status</th><th>Dedução</th><th></th></tr></thead><tbody>' + (rows || '<tr><td colspan="11" class="empty">Nenhum pedido neste filtro.</td></tr>') + '</tbody></table></div></div>' +
      (pages > 1 ? '<div style="display:flex;gap:8px;justify-content:flex-end;align-items:center"><button class="btn-sm" id="affprev"' + (affPage <= 1 ? ' disabled' : '') + '>Anterior</button><span class="footnote" style="margin:0">página ' + affPage + ' de ' + pages + '</span><button class="btn-sm" id="affnext"' + (affPage >= pages ? ' disabled' : '') + '>Próxima</button></div>' : '');
  }
  function bindAffPedidos() {
    app.querySelectorAll('[data-affchan]').forEach(function (c) { c.onclick = function () { affF.channel = c.dataset.affchan; affPage = 1; render(); }; });
    var q = document.getElementById('affpq'); if (q) { var t; q.oninput = function () { clearTimeout(t); t = setTimeout(function () { var v = q.value; affF.search = v; affPage = 1; render(); var el = document.getElementById('affpq'); if (el) { el.focus(); el.value = v; el.setSelectionRange(v.length, v.length); } }, 220); }; }
    var st = document.getElementById('affstatus'); if (st) st.onchange = function () { affF.status = st.value; affPage = 1; render(); };
    var dd = document.getElementById('affded'); if (dd) dd.onchange = function () { affF.ded = dd.value; affPage = 1; render(); };
    var cl = document.getElementById('affclear'); if (cl) cl.onclick = function () { affF = { search: '', channel: '', status: '', ded: '', region: '', basis: 'venda', rateMin: null }; render(); };
    var pv = document.getElementById('affprev'); if (pv) pv.onclick = function () { if (affPage > 1) { affPage--; render(); } };
    var nx = document.getElementById('affnext'); if (nx) nx.onclick = function () { affPage++; render(); };
  }
  function openAffPedido(orderId) {
    var e = affEngine(); var o = e.orderMap[orderId]; if (!o) return;
    var d = document.createElement('div'); d.className = 'drawer'; var panel = document.createElement('div'); panel.className = 'drawer-panel'; panel.style.width = '680px'; panel.style.maxWidth = '96vw';
    d.appendChild(panel); d.onclick = function (ev) { if (ev.target === d) d.remove(); }; document.body.appendChild(d);
    var ord = orders.find(function (x) { return x.id === orderId; }); var oc = occ.find(function (x) { return !x.isDemo && x.orderId === orderId; });
    var l = affLucroPedido(o);
    var itemRows = o.items.map(function (it) { return '<tr><td class="cell-text">' + esc((it.productName || '—').slice(0, 40)) + '</td><td>' + nn(it.qty) + '</td><td class="nowrap">' + brlU(it.purchase) + '</td><td class="nowrap">' + brlU(it.comItemAff) + '</td><td>' + (it.rateItemAff != null ? pct(r2(it.rateItemAff * 100)) : '—') + '</td></tr>'; }).join('');
    var comp = '<div class="panel"><div class="ph"><h3>Composição da despesa (auditoria)</h3></div><div class="pb">' + kv('Comissão do afiliado (Σ itens)', brlU(o.comAff)) + kv('Taxa de serviço afiliados', brlU(o.svcFee)) + kv('Despesa reconstruída', brlU(o.despesaRecon)) + kv('Despesa informada (Shopee)', o.despesaHas ? brlU(o.despesaStated) : '<span class="tag warn">não informado</span>') + (o.despesaHas && Math.abs(o.despesaStated - o.despesaRecon) > affCfg.tolConcil ? '<div class="footnote neg">diferença ' + brlU(o.despesaStated - o.despesaRecon) + '</div>' : '') + '</div></div>';
    var pedBlock = ord ? '<div class="panel"><div class="ph"><h3>Pedido (módulo Pedidos)</h3></div><div class="pb">' + kv('Status', S.pedidos.labels[ord.normalizedStatus] || ord.orderStatus || '—') + kv('Valor', brl(ord.totalAmount || 0)) + kv('Cidade/UF', (ord.city || '—') + '/' + (ord.uf || '—')) + kv('Lucro real do pedido (após afiliado)', l.known ? brlU(l.lucro) : (l.partial ? 'custo do produto pendente' : 'indisponível')) + '<button class="btn-sm" data-goped="' + esc(orderId) + '">Ver pedido</button></div></div>' : '<div class="footnote">Pedido não importado no módulo Pedidos — região e lucro real indisponíveis.</div>';
    var devBlock = oc ? '<div class="panel"><div class="ph"><h3>Devolução vinculada</h3><span class="tag info">' + esc(statusLabel(oc.status)) + '</span></div><div class="pb">' + kv('Motivo', oc.reason || '—') + '<button class="btn-sm" data-godev="' + esc(oc.id) + '">Ver devolução</button></div></div>' : '';
    panel.innerHTML = '<div class="dh"><div><b>Pedido ' + esc(orderId) + '</b> <span class="tag ' + (o.st === 'concluido' ? 'ok' : o.st === 'cancelado' ? 'warn' : 'neutral') + '" style="margin-left:6px">' + esc(o.status) + '</span></div><button class="x">&times;</button></div><div class="dbd">' +
      '<div class="panel"><div class="ph"><h3>Afiliado</h3></div><div class="pb">' + kv('Afiliado', o.affUser) + kv('Nome', o.affName || '—') + kv('Canal', o.channel || '—') + kv('Campanha', o.campaign || '—') + kv('Tipo de conversão', o.campaignType || o.items[0].orderType || '—') + kv('Estado da dedução', o.dedState || '—') + kv('Método', o.dedMethod || '—') + kv('Cobrança', o.chargePeriod || '—') + '</div></div>' +
      '<div class="panel"><div class="ph"><h3>Itens (' + nn(o.items.length) + ')</h3></div><div class="table-wrap"><table class="report"><thead><tr><th>Produto</th><th>Qtd</th><th>Compra</th><th>Comissão</th><th>Taxa</th></tr></thead><tbody>' + itemRows + '</tbody></table></div></div>' +
      comp + pedBlock + devBlock + '</div>';
    panel.querySelector('.x').onclick = function () { d.remove(); };
    var gp = panel.querySelector('[data-goped]'); if (gp) gp.onclick = function () { d.remove(); route = 'pedidos'; sub.pedidos = 'pedidos'; render(); };
    var gd = panel.querySelector('[data-godev]'); if (gd) gd.onclick = function () { var id2 = gd.dataset.godev; d.remove(); route = 'posvenda'; sub.posvenda = 'casos'; render(); setTimeout(function () { openFicha(id2); }, 60); };
  }

  function affFinanceiro() {
    var e = affEngine(); var t = e.tot;
    var head = secHead('AFILIADOS · FINANCEIRO & CONCILIAÇÃO', 'As quatro visões financeiras + conciliação', 'Comissão gerada, taxa de serviço, despesa total e valor efetivamente deduzido — mais a conciliação com o RPA. Sem dupla contagem, sem correção silenciosa.');
    var quatro = kstrip([
      { l: 'Comissão gerada', v: brlU(t.comAff), cls: 'blue', s: 'pelas vendas' },
      { l: 'Taxa de serviço afiliados', v: brlU(t.svcFee), cls: 'amber', s: 'cobrada pela Shopee' },
      { l: 'Despesa total afiliados', v: brlU(t.despesa), cls: 'red' },
      { l: 'Efetivamente deduzido', v: brlU(t.deduzido), cls: 'green' },
      { l: 'Pendente de dedução', v: brlU(t.pendente), cls: 'amber' },
    ]);
    var doubleWarn = callout('', 'Sem dupla contagem', 'Comissão gerada, RPA e Comissão Extra (Validation Bill) NÃO são somados como despesas independentes — podem ser o mesmo dinheiro em fechamentos diferentes. Cada um é conciliado separadamente e a origem é rastreada.');
    // conciliação por afiliado × RPA (mês do RPA)
    var rpaByName = {}; affRpa.forEach(function (r) { var k = normStatus(r.legalName); (rpaByName[k] = rpaByName[k] || { gross: 0, months: {} }); rpaByName[k].gross += r.gross; });
    var rows = e.affs.slice().sort(function (a, b) { return b.comAff - a.comAff; }).slice(0, 300).map(function (a) {
      var rpa = rpaByName[normStatus(a.name)]; var rpaV = rpa ? rpa.gross : null; var dif = rpaV != null ? (a.comAff - rpaV) : null;
      var status = rpaV == null ? ['⚪ Sem vínculo', 'neutral'] : (Math.abs(dif) <= affCfg.tolConcil ? ['🟢 Conciliado', 'ok'] : ['🔴 Divergência', 'warn']);
      return '<tr><td class="cell-text">' + esc(a.user) + '<div class="footnote" style="margin:0">' + esc(a.name || '') + '</div></td><td class="nowrap">' + brlU(a.comAff) + '</td><td class="nowrap">' + (rpaV != null ? brlU(rpaV) : '—') + '</td><td class="nowrap ' + (dif && Math.abs(dif) > affCfg.tolConcil ? 'neg' : '') + '">' + (dif != null ? brlU(dif) : '—') + '</td><td><span class="tag ' + status[1] + '">' + status[0] + '</span></td></tr>';
    }).join('');
    var totRpa = affRpa.reduce(function (s, r) { return s + r.gross; }, 0);
    var rpaHead = affRpa.length ? kstrip([{ l: 'RPA — comissão bruta total', v: brlU(totRpa), cls: 'blue', s: nn(affRpa.length) + ' registros' }, { l: 'Comissão calculada (pedidos)', v: brlU(t.comAff), cls: 'blue' }, { l: 'Diferença', v: brlU(t.comAff - totRpa), cls: Math.abs(t.comAff - totRpa) > affCfg.tolConcil ? 'red' : 'green', s: 'não é erro automático — investigar' }]) : callout('', 'RPA não importado', 'Importe o relatório RPA (fechamento mensal) para conciliar o que a Shopee reconheceu por afiliado com o calculado pelos pedidos.');
    var conciTable = affRpa.length ? '<div class="panel"><div class="ph"><h3>Conciliação por afiliado — comissão calculada × RPA</h3><span class="footnote" style="margin:0">vínculo por nome; confirme identidade quando necessário</span></div><div class="table-wrap"><table class="report"><thead><tr><th>Afiliado</th><th>Calculada (pedidos)</th><th>RPA</th><th>Diferença</th><th>Status</th></tr></thead><tbody>' + rows + '</tbody></table></div></div>' : '';
    return head + quatro + doubleWarn + rpaHead + conciTable;
  }

  function affExtra() {
    var head = secHead('AFILIADOS · COMISSÃO EXTRA', 'Comissão Extra / Validation Bill', 'Fechamentos mensais de dedução. Relacionados aos pedidos cujo método de dedução é “Crédito Comissão Extra” — sem rateio artificial.');
    if (!affVb.length) return head + emptyBox('Nenhum Validation Bill importado. Envie o relatório de Comissão Extra da Shopee.');
    var vb = affVb.slice().sort(function (a, b) { return (b.month || '').localeCompare(a.month || ''); });
    var totDesp = vb.reduce(function (s, r) { return s + r.monthlyExpense; }, 0), totDed = vb.reduce(function (s, r) { return s + r.totalDeducted; }, 0), totPend = vb.reduce(function (s, r) { return s + r.totalPending; }, 0), totAms = vb.reduce(function (s, r) { return s + r.amsCredit; }, 0);
    var strip = kstrip([
      { l: 'Despesa mensal (Σ)', v: brlU(totDesp), cls: 'red', s: nn(vb.length) + ' meses' },
      { l: 'Total deduzido', v: brlU(totDed), cls: 'green' },
      { l: 'Crédito AMS utilizado', v: brlU(totAms), cls: 'blue' },
      { l: 'Pendente', v: brlU(totPend), cls: totPend ? 'amber' : 'green' },
    ]);
    var chart = chartCard('Comissão Extra por mês', legendSwatch([['Despesa', '#d13b3b'], ['Deduzido', '#0f9d6b']]), svgGroupBars(vb.slice().reverse().map(function (r) { return r.month; }), [{ name: 'Despesa', color: '#d13b3b', vals: vb.slice().reverse().map(function (r) { return r.monthlyExpense / 10000; }) }, { name: 'Deduzido', color: '#0f9d6b', vals: vb.slice().reverse().map(function (r) { return r.totalDeducted / 10000; }) }], { fmt: function (v) { return brl(v); } }));
    var rows = vb.map(function (r, i) { var prev = vb[i + 1]; var varr = prev && prev.monthlyExpense ? (r.monthlyExpense - prev.monthlyExpense) / prev.monthlyExpense : null; return '<tr><td>' + esc(r.month) + '</td><td class="mono">' + esc(r.validationId) + '</td><td class="nowrap">' + brlU(r.monthlyExpense) + '</td><td class="nowrap">' + brlU(r.totalDeducted) + '</td><td class="nowrap">' + brlU(r.amsCredit) + '</td><td class="nowrap ' + (r.totalPending ? 'neg' : '') + '">' + brlU(r.totalPending) + '</td><td><span class="tag ' + (normStatus(r.status).indexOf('complet') >= 0 ? 'ok' : 'warn') + '">' + esc(r.status) + '</span></td><td>' + (varr == null ? '—' : (varr >= 0 ? '+' : '') + pct(r2(varr * 100))) + '</td></tr>'; }).join('');
    // pedidos com método Crédito Comissão Extra
    var creditOrders = affConvP().filter(function (r) { return normStatus(r.dedMethod).indexOf('credito comissao extra') >= 0; });
    var creditNote = callout('', 'Ligação com pedidos', creditOrders.length ? '<b>' + nn(creditOrders.length) + '</b> linha(s) de conversão têm método de dedução <b>Crédito Comissão Extra</b> — essas são as candidatas a compor os fechamentos acima. Não fazemos rateio artificial de um valor mensal entre pedidos sem chave comprovada.' : 'Nenhuma linha de conversão com método “Crédito Comissão Extra” foi encontrada nos dados atuais.');
    return head + strip + chart + creditNote + '<div class="panel"><div class="ph"><h3>Histórico mensal</h3></div><div class="table-wrap"><table class="report"><thead><tr><th>Mês</th><th>ID validação</th><th>Despesa</th><th>Deduzido</th><th>Crédito AMS</th><th>Pendente</th><th>Status</th><th>Var. vs mês ant.</th></tr></thead><tbody>' + rows + '</tbody></table></div></div>';
  }

  function affDevolucoes() {
    var e = affEngine();
    var head = secHead('AFILIADOS · DEVOLUÇÕES & ESTORNOS', 'Comissão em pedidos cancelados/devolvidos', 'Pedidos de afiliados que cancelaram, devolveram ou reembolsaram — e se a comissão/taxa foi recuperada. Nunca afirmamos um estorno sem evidência da fonte.');
    var affected = e.ordersArr.filter(function (o) { return o.st === 'cancelado' || o.refund > 0 || occ.find(function (x) { return !x.isDemo && x.orderId === o.orderId; }); });
    var comReemb = 0, svcReemb = 0, salesReemb = 0; affected.forEach(function (o) { comReemb += o.comAff; svcReemb += o.svcFee; salesReemb += o.purchase; });
    var strip = kstrip([
      { l: 'Pedidos afetados', v: nn(affected.length), cls: 'amber', s: 'cancelado / devolvido / reembolso' },
      { l: 'Vendas envolvidas', v: brlU(salesReemb), cls: 'blue' },
      { l: 'Comissão relacionada', v: brlU(comReemb), cls: 'red' },
      { l: 'Taxa serviço relacionada', v: brlU(svcReemb), cls: 'amber' },
    ]);
    var honest = callout('warn', 'Estorno de comissão — requer conciliação', 'Os relatórios de afiliados não trazem uma coluna que confirme o estorno da comissão após a devolução. Marcamos esses valores como <b>potencialmente não recuperados</b> — candidatos a crédito no extrato da carteira — mas <b>não afirmamos</b> que a Shopee "deve" um valor sem a regra/fonte. Classificação: <span class="tag warn">potencial divergência / requer conciliação</span>.');
    var rows = affected.sort(function (a, b) { return b.comAff - a.comAff; }).slice(0, 300).map(function (o) { var hasOcc = occ.find(function (x) { return !x.isDemo && x.orderId === o.orderId; }); return '<tr class="rowlink" data-affped="' + esc(o.orderId) + '"><td class="mono">' + esc(o.orderId) + '</td><td class="cell-text">' + esc(o.affUser) + '</td><td class="nowrap">' + brlU(o.purchase) + '</td><td class="nowrap">' + brlU(o.refund) + '</td><td class="nowrap">' + brlU(o.comAff) + '</td><td><span class="tag ' + (o.st === 'cancelado' ? 'warn' : 'neutral') + '">' + esc(o.status) + '</span>' + (hasOcc ? ' <span class="tag info">devolução</span>' : '') + '</td><td><span class="tag warn">estorno a conciliar</span></td></tr>'; }).join('');
    // ranking afiliados por devolução (com mínimo de pedidos)
    var byAff = {}; e.ordersArr.forEach(function (o) { var a = byAff[o.affUser] = byAff[o.affUser] || { user: o.affUser, orders: 0, dev: 0 }; a.orders++; if (o.st === 'cancelado' || o.refund > 0) a.dev++; });
    var ranking = Object.values(byAff).filter(function (a) { return a.orders >= affCfg.minPedidos; }).map(function (a) { a.rate = a.dev / a.orders; return a; }).sort(function (a, b) { return b.rate - a.rate; }).slice(0, 10);
    var rankTable = '<div class="panel"><div class="ph"><h3>Afiliados com maior taxa de devolução/cancelamento</h3><span class="footnote" style="margin:0">mínimo ' + affCfg.minPedidos + ' pedidos para comparação justa</span></div><div class="table-wrap"><table class="report"><thead><tr><th>Afiliado</th><th>Pedidos</th><th>Cancel./Devol.</th><th>Taxa</th></tr></thead><tbody>' + ranking.map(function (a) { return '<tr class="rowlink" data-affprof="' + esc(a.user) + '"><td>' + esc(a.user) + '</td><td>' + nn(a.orders) + '</td><td>' + nn(a.dev) + '</td><td>' + pct(r2(a.rate * 100)) + '</td></tr>'; }).join('') + '</tbody></table></div></div>';
    return head + strip + honest + '<div class="panel"><div class="ph"><h3>Pedidos afetados</h3></div><div class="table-wrap"><table class="report"><thead><tr><th>Pedido</th><th>Afiliado</th><th>Venda</th><th>Reembolso</th><th>Comissão</th><th>Status</th><th>Estorno</th></tr></thead><tbody>' + (rows || '<tr><td colspan="7" class="empty">Nenhum pedido afetado.</td></tr>') + '</tbody></table></div></div>' + rankTable;
  }

  function affIA() {
    var e = affEngine(); var t = e.tot;
    var head = secHead('AFILIADOS · INTELIGÊNCIA', 'Leitura dos números (calculados pelo sistema)', 'Interpretação determinística sobre os valores já calculados — a IA nunca inventa números.');
    var ins = [];
    var top3 = e.affs.slice().sort(function (a, b) { return b.sales - a.sales; }).slice(0, 3); var top3Sales = top3.reduce(function (s, a) { return s + a.sales; }, 0);
    if (t.sales) ins.push('Os 3 afiliados com maior faturamento representam <b>' + pct(r2(top3Sales / t.sales * 100)) + '</b> das vendas de afiliados (' + top3.map(function (a) { return esc(a.user); }).join(', ') + ').');
    var chMap = {}; e.ordersArr.forEach(function (o) { var g = chMap[o.channel || '—'] = chMap[o.channel || '—'] || { sales: 0 }; g.sales += o.purchase; }); var topCh = Object.keys(chMap).sort(function (a, b) { return chMap[b].sales - chMap[a].sales; })[0];
    if (topCh) ins.push('O canal <b>' + esc(topCh) + '</b> concentra ' + pct(r2(chMap[topCh].sales / (t.sales || 1) * 100)) + ' das vendas atribuídas a afiliados.');
    var altas = affConvP().filter(function (r) { return r.rateItemAff != null && r.rateItemAff >= affCfg.rateAlert; }); var altasSales = altas.reduce(function (s, r) { return s + r.purchase; }, 0);
    if (altasSales > 0) ins.push('<b>' + brlU(altasSales) + '</b> em vendas foram feitas com comissão ≥ ' + pct(r2(affCfg.rateAlert * 100)) + ' — revise se a taxa se justifica.');
    var difDesp = t.despesaStated - t.despesaRecon; if (Math.abs(difDesp) > affCfg.tolConcil) ins.push('Há diferença de <b>' + brlU(difDesp) + '</b> entre a despesa informada pela Shopee e a reconstruída pelos componentes conhecidos — vale conciliar.');
    var totRpa = affRpa.reduce(function (s, r) { return s + r.gross; }, 0); if (affRpa.length && Math.abs(t.comAff - totRpa) > affCfg.tolConcil) ins.push('Divergência de <b>' + brlU(t.comAff - totRpa) + '</b> entre a comissão calculada pelos pedidos e o total reconhecido no RPA.');
    var affected = e.ordersArr.filter(function (o) { return o.st === 'cancelado' || o.refund > 0; }); var comAfet = affected.reduce(function (s, o) { return s + o.comAff; }, 0); if (comAfet > 0) ins.push('Existem <b>' + brlU(comAfet) + '</b> de comissão ligados a pedidos cancelados/reembolsados cujo estorno ainda não foi localizado — requer conciliação com a carteira.');
    var body = ins.length ? '<div class="panel"><div class="pb">' + ins.map(function (x) { return '<div class="fin-line"><span>• ' + x + '</span></div>'; }).join('') + '</div></div>' : emptyBox('Importe os relatórios para gerar leituras.');
    return head + body + callout('', 'Como isto é gerado', 'Cada frase acima usa apenas números calculados pelo motor determinístico (somas, percentuais, diferenças). Nenhum valor foi estimado pela IA.');
  }

  // ============================= MINHA RENDA =============================
  // Camada de consolidação financeira do Income Shopee (XLSX detalhado) + Declaração (PDF).
  // Dinheiro em CENTAVOS. Regra ORDER×SKU: financeiro só das linhas "Order" (SKU não re-soma). §5
  // Aceita US (316,638.35) e BR (1.677,86): o separador que aparece por ÚLTIMO é o decimal.
  function mrCents(s) {
    if (s == null) return 0; var t = String(s).replace(/r\$/i, '').replace(/[−–]/g, '-').replace(/\s/g, '').trim(); if (t === '' || t === '-') return 0;
    var neg = /^-/.test(t); t = t.replace(/^-/, ''); var lc = t.lastIndexOf(','), ld = t.lastIndexOf('.');
    if (lc >= 0 && ld >= 0) { if (lc > ld) t = t.replace(/\./g, '').replace(',', '.'); else t = t.replace(/,/g, ''); }
    else if (lc >= 0) { t = (t.length - lc - 1 === 2) ? t.replace(',', '.') : t.replace(/,/g, ''); }
    var n = parseFloat(t); return isNaN(n) ? 0 : Math.round(n * 100) * (neg ? -1 : 1);
  }
  function mrIsIncome(wb) { var n = wb.SheetNames.map(function (x) { return normStatus(x); }); return n.indexOf('renda') >= 0 || n.some(function (x) { return x.indexOf('shipping fee') >= 0; }) || n.some(function (x) { return x.indexOf('service fee') >= 0; }); }
  // §38: mapa de campos da aba "Renda" do Income — índice da coluna → campo normalizado. Índices
  // 0-10/35/37/38/40-42/45 são identificadores/texto (sem valor monetário) e ficam em MR_TEXT_COLS
  // para não entrar em "Campos ainda não classificados" por engano. Qualquer coluna numérica FORA
  // destes dois mapas (ex.: uma coluna nova em versão futura do relatório) cai automaticamente em
  // outros{} — nunca é descartada silenciosamente (§46).
  var MR_NAMED_COLS = { 11: 'liberado', 12: 'preco', 13: 'reembolso', 14: 'pix', 15: 'cupom', 16: 'fretePagoComprador', 17: 'freteParceiro', 18: 'descontoFrete', 19: 'envioReverso', 20: 'taxaDevolucaoVendedor', 21: 'incentivoAcaoComercial', 22: 'voucherSeller', 23: 'voucherCompartilhado', 24: 'incentivoCupom', 25: 'coinCashbackSeller', 26: 'coinCashbackCompartilhado', 27: 'comissao', 28: 'servico', 29: 'transacao', 30: 'afiliado', 31: 'taxaDevolucaoFacil', 32: 'amp', 33: 'deducaoAmp', 34: 'taxaRecargaAutomatica', 36: 'quantiaPagaComprador', 39: 'promocaoDescontoFrete', 43: 'comissaoBruta', 44: 'servicoBruta', 46: 'ajusteAcaoComercial', 47: 'compensacaoPerdida', 48: 'reembolsoComprador', 49: 'moedasResgatadasDevolucao', 50: 'cupomDevolucao', 51: 'promoBancoDevolucao', 52: 'promoShopeeDevolucao', 53: 'pixAjusteAdicional' };
  var MR_TEXT_COLS = { 8: 1, 9: 1, 10: 1, 35: 1, 37: 1, 38: 1, 40: 1, 41: 1, 42: 1, 45: 1 };
  var MR_FIELD_MAP = [
    ['ID do pedido', 'orderId', 'cruzamento com Pedidos/Financeiro'], ['SKU', 'sku', 'Produtos e SKUs'], ['Data de criação do pedido', 'dataCriacao', 'referência (Visão Geral/DRE usam a data de PAGAMENTO do pedido, do módulo Pedidos)'], ['Data de conclusão do pagamento', 'dataConclusao', 'drill-down'],
    ['Quantia total lançada (R$)', 'liberado', 'Receita Líquida / Pagamento Liberado'], ['Preço do produto', 'preco', 'Categorias · Receitas'], ['Valor do Reembolso', 'reembolso', 'DRE · Devoluções e Reembolsos'], ['Ajuste por pagamento via PIX', 'pix', 'DRE · Descontos Comerciais'], ['Cupom', 'cupom', 'DRE · Descontos Comerciais'],
    ['Frete cobrado pelo parceiro logístico', 'freteParceiro', 'Taxas Shopee'], ['Desconto de frete pela Shopee', 'descontoFrete', 'Taxas Shopee'], ['Taxa de envio reverso', 'envioReverso', 'Taxas Shopee'],
    ['Taxa de comissão líquida', 'comissao', 'Taxas Shopee'], ['Taxa de serviço líquida', 'servico', 'Taxas Shopee'], ['Taxa de transação', 'transacao', 'Taxas Shopee'], ['Taxa de comissão Afiliados do Vendedor', 'afiliado', 'Afiliados'],
    ['Taxa de comissão bruta', 'comissaoBruta', 'Ficha 360º — composição bruta→líquida'], ['Taxa de serviço bruta', 'servicoBruta', 'Ficha 360º — composição bruta→líquida'],
    ['Incentivo Shopee para ação comercial', 'incentivoAcaoComercial', 'Taxas Shopee · Ação comercial'], ['Ajuste por participação em ação comercial', 'ajusteAcaoComercial', 'Taxas Shopee · Ação comercial'],
    ['Taxa de devolução do vendedor', 'taxaDevolucaoVendedor', 'auditoria (ainda não somado no DRE)'], ['Taxa de Devolução Fácil Shopee', 'taxaDevolucaoFacil', 'auditoria (ainda não somado no DRE)'], ['Acréscimo por Método de Pagamento (AMP)', 'amp', 'auditoria'], ['Dedução de AMP', 'deducaoAmp', 'auditoria'], ['Taxa da Recarga Automática (Pedido)', 'taxaRecargaAutomatica', 'auditoria'], ['Promoção de Desconto no Frete', 'promocaoDescontoFrete', 'auditoria'], ['Compensação perdida', 'compensacaoPerdida', 'auditoria'],
    ['Voucher subsidiado pelo Seller', 'voucherSeller', 'auditoria'], ['Voucher compartilhado subsidiado pelo Seller', 'voucherCompartilhado', 'auditoria'], ['Incentivo de cupom', 'incentivoCupom', 'auditoria'], ['Coin Cashback subsidiado pelo Seller', 'coinCashbackSeller', 'auditoria'], ['Coin Cashback compartilhado subsidiado pelo Seller', 'coinCashbackCompartilhado', 'auditoria'],
    ['Valor Reembolsado ao Comprador', 'reembolsoComprador', 'auditoria'], ['Moedas Resgatadas dos Itens Devolvidos', 'moedasResgatadasDevolucao', 'auditoria'], ['Cupom da Shopee de Itens Devolvidos', 'cupomDevolucao', 'auditoria'], ['Pro-rated Bank/Shopee Payment Channel Promotion (devolução)', 'promoBancoDevolucao/promoShopeeDevolucao', 'auditoria'], ['Ajuste por pagamento via PIX (2ª coluna)', 'pixAjusteAdicional', 'auditoria'], ['Quantia paga pelo comprador', 'quantiaPagaComprador', 'auditoria'],
  ];
  function mrAoa(wb, name) { var sn = wb.SheetNames.filter(function (x) { return normStatus(x) === normStatus(name) || normStatus(x).indexOf(normStatus(name)) >= 0; })[0]; return sn ? XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: false, defval: '' }) : null; }
  function mrParseIncome(ab, filename) {
    var wb = XLSX.read(new Uint8Array(ab), { type: 'array' }); if (!mrIsIncome(wb)) return { notRecognized: true };
    var out = { notRecognized: false, renda: [], ship: [], adj: [], svc: [], summary: {}, period: {} };
    // Summary (totais declarados pela Shopee)
    var sm = mrAoa(wb, 'Summary'); if (sm) { sm.forEach(function (r) { var lab = normStatus(r[0]); var val = null; for (var c = 1; c < r.length; c++) { if (String(r[c]).trim() !== '') { val = r[c]; } } if (lab.indexOf('receita total') >= 0) out.summary.receita = mrCents(r[1]); if (lab.indexOf('quantidade total liberada') >= 0) out.summary.liberado = mrCents(val); if (lab.indexOf('despesas totais') >= 0) out.summary.despesas = mrCents(val); if (lab === 'de') out.period.from = String(r[1]).trim(); if (lab === 'para') out.period.to = String(r[1]).trim(); }); }
    // Renda — §35-38 do prompt "correção crítica Minha Renda": mapeamento por índice de coluna já
    // validado contra o cabeçalho real (não alterado — os campos abaixo já liam certo). Adicionamos
    // SÓ campos novos, financeiros e ainda não usados no sistema (ação comercial, vouchers, cashback,
    // AMP, taxas de devolução, recarga automática, promoção de frete, compensação, reembolso ao
    // comprador, itens da devolução) — nunca descartados, mesmo os que ainda não alimentam nenhuma
    // tela (ficam disponíveis para auditoria em "Campos ainda não classificados", §46).
    var rd = mrAoa(wb, 'Renda');
    if (rd) {
      var hi = rd.findIndex(function (r) { return normStatus(r[2]) === 'id do pedido'; });
      if (hi >= 0) {
        var headerRow = rd[hi] || []; var headerLen = headerRow.length;
        for (var i = hi + 1; i < rd.length; i++) {
          var r = rd[i]; var oid = String(r[2] || '').trim(); if (!oid) continue;
          var ver = /sku/i.test(String(r[1])) ? 'Sku' : 'Order';
          var outros = {};
          for (var ci = 11; ci < headerLen; ci++) {
            if (MR_NAMED_COLS[ci] || MR_TEXT_COLS[ci]) continue;
            var raw = r[ci]; if (raw == null || String(raw).trim() === '') continue;
            var val = mrCents(raw); if (!val) continue;
            var colLabel = String(headerRow[ci] || ('coluna ' + ci)).trim();
            outros[colLabel] = (outros[colLabel] || 0) + val;
          }
          out.renda.push({
            ver: ver, orderId: oid, refundId: String(r[3] || '').trim(), sku: String(r[4] || '').trim(), produto: String(r[5] || '').trim(), dataCriacao: String(r[6] || '').trim(), dataConclusao: String(r[7] || '').trim(), canal: String(r[8] || '').trim(), tipoPedido: String(r[9] || '').trim(),
            liberado: mrCents(r[11]), preco: mrCents(r[12]), reembolso: mrCents(r[13]), pix: mrCents(r[14]), cupom: mrCents(r[15]), fretePagoComprador: mrCents(r[16]), freteParceiro: mrCents(r[17]), descontoFrete: mrCents(r[18]), envioReverso: mrCents(r[19]), comissao: mrCents(r[27]), servico: mrCents(r[28]), transacao: mrCents(r[29]), afiliado: mrCents(r[30]), comissaoBruta: mrCents(r[43]), servicoBruta: mrCents(r[44]),
            // novos — §36-37: ação comercial (incentivo + ajuste) integrada à Taxa de Serviço; demais
            // campos ficam disponíveis para auditoria/consulta, sem entrar no total canônico de taxas.
            taxaDevolucaoVendedor: mrCents(r[20]), incentivoAcaoComercial: mrCents(r[21]), voucherSeller: mrCents(r[22]), voucherCompartilhado: mrCents(r[23]), incentivoCupom: mrCents(r[24]), coinCashbackSeller: mrCents(r[25]), coinCashbackCompartilhado: mrCents(r[26]), taxaDevolucaoFacil: mrCents(r[31]), amp: mrCents(r[32]), deducaoAmp: mrCents(r[33]), taxaRecargaAutomatica: mrCents(r[34]), quantiaPagaComprador: mrCents(r[36]), promocaoDescontoFrete: mrCents(r[39]), ajusteAcaoComercial: mrCents(r[46]), compensacaoPerdida: mrCents(r[47]), reembolsoComprador: mrCents(r[48]), moedasResgatadasDevolucao: mrCents(r[49]), cupomDevolucao: mrCents(r[50]), promoBancoDevolucao: mrCents(r[51]), promoShopeeDevolucao: mrCents(r[52]), pixAjusteAdicional: mrCents(r[53]),
            outros: outros,
          });
        }
      }
    }
    // Shipping Fee Discrepancy
    var sh = mrAoa(wb, 'Shipping Fee Discrepancy'); if (sh) { var shi = sh.findIndex(function (r) { return normStatus(r[0]) === 'id do pedido'; }); if (shi >= 0) { for (var j = shi + 1; j < sh.length; j++) { var s2 = sh[j]; var oid2 = String(s2[0] || '').trim(); if (!oid2) continue; out.ship.push({ orderId: oid2, esperado: mrCents(s2[1]), real: mrCents(s2[2]), motivo: String(s2[3] || '').trim() }); } } }
    // Adjustment
    var ad = mrAoa(wb, 'Adjustment'); if (ad) { var ahi = ad.findIndex(function (r) { return normStatus(r[0]).indexOf('id do pedido') >= 0 || normStatus(r[0]).indexOf('data') >= 0 && r.length > 3; }); ad.forEach(function (r, idx) { var v = null; for (var c = 0; c < r.length; c++) { if (/-?\d+[.,]\d/.test(String(r[c]))) v = r[c]; } var oid3 = ''; r.forEach(function (c) { if (/^\d{6,}[A-Z0-9]+$/.test(String(c).trim())) oid3 = String(c).trim(); }); if (v != null && (oid3 || normStatus(r[0]).indexOf('valor total') >= 0)) { out.adj.push({ seq: idx, orderId: oid3, desc: r.filter(function (x) { return String(x).trim() && !/^-?\d+[.,]\d+$/.test(String(x).trim()); }).join(' ').slice(0, 80), valor: mrCents(v) }); } }); }
    // Service Fee Details
    var sv = mrAoa(wb, 'Service Fee Details'); if (sv) { var vhi = sv.findIndex(function (r) { return normStatus(r[1]) === 'id do pedido'; }); if (vhi >= 0) { for (var k = vhi + 1; k < sv.length; k++) { var v2 = sv[k]; var oid4 = String(v2[1] || '').trim(); if (!oid4) continue; out.svc.push({ seq: k, orderId: oid4, afiliadosVendedor: mrCents(v2[2]), transacao: mrCents(v2[3]), porItem: mrCents(v2[4]) }); } } }
    return out;
  }
  function importMinhaRenda(file) {
    return file.arrayBuffer().then(function (ab) {
      var name = (file.name || '').toLowerCase();
      if (name.slice(-4) === '.pdf') return mrImportPDF(ab, file.name);
      var p = mrParseIncome(ab, file.name);
      if (p.notRecognized) throw new Error('Arquivo não reconhecido como relatório Income da Shopee (esperado abas Renda / Shipping Fee Discrepancy / Adjustment).');
      var importedAt = new Date().toISOString(); var stats = { renda: 0, ship: 0, adj: 0, svc: 0 };
      // Renda (idempotente)
      var byR = {}; mrRenda.forEach(function (x) { byR[x.id] = x; }); var chR = [];
      p.renda.forEach(function (row, i) { var id = row.orderId + '|' + row.ver + '|' + (row.sku || '') + '|' + (row.refundId || '') + '|' + i; if (!byR[id]) { var rec = Object.assign({ id: id, fileName: file.name, importedAt: importedAt }, row); byR[id] = rec; chR.push(rec); stats.renda++; } });
      mrRenda = Object.values(byR);
      // Shipping (preserva investigação manual §21)
      var byS = {}; mrShip.forEach(function (x) { byS[x.id] = x; }); var chS = [];
      p.ship.forEach(function (row) { var id = row.orderId; var ex = byS[id]; if (!ex) { byS[id] = Object.assign({ id: id, invStatus: 'NAO_ANALISADO', invNote: '', invResp: '', importedAt: importedAt, fileName: file.name }, row); chS.push(byS[id]); stats.ship++; } else { ex.esperado = row.esperado; ex.real = row.real; ex.motivo = row.motivo; chS.push(ex); } });
      mrShip = Object.values(byS);
      // Adjustment
      var byA = {}; mrAdj.forEach(function (x) { byA[x.id] = x; }); var chA = [];
      p.adj.forEach(function (row) { var id = (row.orderId || 'sem') + '|' + row.valor + '|' + row.seq; if (!byA[id]) { byA[id] = Object.assign({ id: id, importedAt: importedAt }, row); chA.push(byA[id]); stats.adj++; } });
      mrAdj = Object.values(byA);
      // Service Fee
      var byV = {}; mrSvc.forEach(function (x) { byV[x.id] = x; }); var chV = [];
      p.svc.forEach(function (row) { var id = row.orderId + '|' + row.seq; if (!byV[id]) { byV[id] = Object.assign({ id: id, importedAt: importedAt }, row); chV.push(byV[id]); stats.svc++; } });
      mrSvc = Object.values(byV);
      mrSummary = { summary: p.summary, period: p.period, importedAt: importedAt, fileName: file.name };
      var batch = { id: 'mr' + Date.now() + Math.round(performance.now()), module: 'Minha Renda', filename: file.name, createdAt: importedAt, seen: p.renda.length, novo: stats.renda, upd: 0, unch: p.renda.length - stats.renda, itemsSeen: p.renda.length };
      batches.unshift(batch); lastImportStamp = importedAt;
      // persiste em segundo plano (não bloqueia a UI); a memória já está atualizada, então a tela reflete na hora
      putMany('mrrenda', chR); putMany('mrship', chS); putMany('mradj', chA); putMany('mrsvc', chV); putMany('settings', [{ id: 'mrSummary', data: mrSummary }]); putMany('batches', [batch]);
      return { batch: batch, stats: stats, kind: 'xlsx' };
    });
  }
  // ---- PDF: leitura real via DecompressionStream (zlib) + ToUnicode CMap, sem CDN ----
  function mrInflateFmt(u8, fmt) {
    return new Promise(function (res, rej) {
      try { var ds = new DecompressionStream(fmt); var w = ds.writable.getWriter(); w.write(u8).catch(function () { }); w.close().catch(function () { }); new Response(ds.readable).arrayBuffer().then(function (a) { res(new Uint8Array(a)); }, function (e) { rej(e); }); }
      catch (e) { rej(e); }
    });
  }
  function mrInflate(u8) {
    // FlateDecode do PDF é zlib ('deflate'); alguns geradores usam raw ('deflate-raw'). Tenta ambos; se falhar, retorna cru.
    return mrInflateFmt(u8, 'deflate').catch(function () { return mrInflateFmt(u8, 'deflate-raw'); }).catch(function () { return u8; });
  }
  function mrParseCMap(txt) { var map = {}; var m = txt.match(/beginbfrange([\s\S]*?)endbfrange/); if (!m) return map; var rng = m[1].match(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*\[([\s\S]*?)\]/); if (rng) { var lo = parseInt(rng[1], 16); var arr = rng[3].match(/<([0-9A-Fa-f]+)>/g) || []; arr.forEach(function (x, i) { map[lo + i] = String.fromCharCode(parseInt(x.replace(/[<>]/g, ''), 16)); }); } return map; }
  function mrImportPDF(ab, filename) {
    var bytes = new Uint8Array(ab); var latin = ''; for (var i = 0; i < bytes.length; i++) latin += String.fromCharCode(bytes[i]);
    // localizar streams (offsets em bytes)
    var streams = []; var re = /stream\r?\n/g, m;
    while ((m = re.exec(latin))) { var start = m.index + m[0].length; var end = latin.indexOf('endstream', start); if (end < 0) continue; var e2 = end; if (latin.charCodeAt(e2 - 1) === 10) e2--; if (latin.charCodeAt(e2 - 1) === 13) e2--; streams.push(bytes.slice(start, e2)); }
    return Promise.all(streams.map(mrInflate)).then(function (infl) {
      var texts = infl.map(function (u) { var s = ''; for (var i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return s; });
      var cmaps = texts.filter(function (t) { return t.indexOf('beginbfrange') >= 0; }).map(mrParseCMap);
      var content = texts.filter(function (t) { return t.indexOf('Tj') >= 0 && t.indexOf('Tf') >= 0; });
      // nomes de fonte usados (ex.: F10, F11), na ordem de aparição
      var fontNames = []; content.forEach(function (t) { (t.match(/\/(F\d+)\s+[-\d.]+\s+Tf/g) || []).forEach(function (x) { var n = x.match(/\/(F\d+)/)[1]; if (fontNames.indexOf(n) < 0) fontNames.push(n); }); });
      // decodifica com um mapa nome->cmapIndex
      // NÃO inserir espaço a cada avanço de glifo (Td) — os espaços reais vêm de glifos de espaço.
      // Só separamos em quebras de bloco/linha (Tm/T*), que marcam nova célula/linha do documento.
      function decodeAll(map) { return content.map(function (t) { var out = ''; var cur = cmaps[0]; var tok = /\/(F\d+)\s+[-\d.]+\s+Tf|<([0-9A-Fa-f]+)>\s*Tj|(T\*|Tm)/g, mm; while ((mm = tok.exec(t))) { if (mm[1]) { cur = cmaps[map[mm[1]] != null ? map[mm[1]] : 0]; } else if (mm[2] != null) { var g = parseInt(mm[2], 16); out += (cur && cur[g] != null) ? cur[g] : ''; } else { out += ' '; } } return out; }).join(' ').replace(/\s+/g, ' '); }
      function score(txt) { var s = 0; ['Pagamento', 'liberado', 'Reembolso', 'Subtotal', 'Cupom', 'Taxa', 'comiss', 'servi', 'Afiliad', 'Ajuste', 'mercadoria', 'produto'].forEach(function (k) { if (txt.indexOf(k) >= 0) s++; }); return s; }
      // tenta todas as permutações simples de nome->cmap (poucos fontes) e escolhe a de maior score
      var best = '', bestScore = -1;
      var perms = mrCmapPermutations(fontNames, cmaps.length);
      perms.forEach(function (map) { var txt = decodeAll(map); var sc = score(txt); if (sc > bestScore) { bestScore = sc; best = txt; } });
      if (!best) best = decodeAll({});
      return mrFinishPDF(best, filename, streams.length);
    });
  }
  // Descobre, para cada /Fx, qual cmap (por ordem de aparição dos ToUnicode) usar.
  function mrFontCmapIndex(latin, texts) {
    var map = {};
    // objetos ToUnicode na ordem em que aparecem
    var tuOrder = []; var re = /\/ToUnicode\s+(\d+)\s+0\s+R/g, m; while ((m = re.exec(latin))) tuOrder.push(parseInt(m[1], 10));
    // ordem dos cmaps decodificados = ordem dos streams com beginbfrange; assumimos a mesma ordem de tuOrder
    // /Font << /F10 A 0 R /F11 B 0 R >> ; cada fonte A tem /ToUnicode -> obj; casar
    var fontObj = {}; var fr = latin.match(/\/Font\s*<<([\s\S]*?)>>/g) || []; fr.forEach(function (b) { var r2 = /\/(F\d+)\s+(\d+)\s+0\s+R/g, mm; while ((mm = r2.exec(b))) fontObj[mm[1]] = parseInt(mm[2], 10); });
    Object.keys(fontObj).forEach(function (nm) { var on = fontObj[nm]; var om = latin.match(new RegExp('(?:^|[^0-9])' + on + ' 0 obj([\\s\\S]*?)endobj')); if (om) { var tu = om[1].match(/\/ToUnicode\s+(\d+)\s+0\s+R/); if (tu) { var idx = tuOrder.indexOf(parseInt(tu[1], 10)); map[nm] = idx >= 0 ? idx : 0; } } });
    return map;
  }
  // gera atribuições nome-de-fonte → índice de cmap (poucos fontes/cmaps); limita a combinatória
  function mrCmapPermutations(names, nCmaps) {
    if (!names.length || !nCmaps) return [{}];
    var combos = Math.pow(nCmaps, names.length);
    if (combos > 24) { var m = {}; names.forEach(function (n, i) { m[n] = Math.min(i, nCmaps - 1); }); return [m]; }
    var out = [];
    for (var c = 0; c < combos; c++) { var map = {}, x = c; names.forEach(function (n) { map[n] = x % nCmaps; x = Math.floor(x / nCmaps); }); out.push(map); }
    return out;
  }
  function mrFinishPDF(full, filename, nStreams) {
    var importedAt = new Date().toISOString();
    var NUMRE = /[-−]?\s*R?\$?\s*[-−]?\d[\d.,]*[.,]\d{2}(?!\d)/;
    var grab = function (labels) { for (var i = 0; i < labels.length; i++) { var idx = full.toLowerCase().indexOf(labels[i].toLowerCase()); if (idx >= 0) { var seg = full.slice(idx + labels[i].length, idx + labels[i].length + 60); var mm = seg.match(NUMRE); if (mm) return mrCents(mm[0]); } } return null; };
    var per = full.match(/\d{2}\/\d{2}\/\d{4}\s*[-a]{1,3}\s*\d{2}\/\d{2}\/\d{4}/) || full.match(/\d{4}-\d{2}-\d{2}/g);
    // Total liberado = valor prefixado por R$ (positivo). Ajustes = valor prefixado por -R$ (negativo).
    var mLib = full.match(/(?:^|[^−\-])R\$\s*([\d.,]+[.,]\d{2})/); var mAju = full.match(/[−\-]\s*R\$\s*([\d.,]+[.,]\d{2})/);
    // Subtotal de mercadoria = primeiro número após a LINHA de total ("Pagamento total liberado 256,513.62 …").
    var merc = null; var rowIdx = full.lastIndexOf('Pagamento total liberado'); if (rowIdx >= 0) { var segM = full.slice(rowIdx + 24, rowIdx + 90).match(NUMRE); if (segM) merc = mrCents(segM[0]); }
    var decl = {
      liberado: mLib ? mrCents(mLib[1]) : grab(['Pagamento total liberado', 'total liberado']),
      mercadoria: merc != null ? merc : grab(['Subtotal de mercadoria', 'Subtotal dos Produtos']),
      produto: grab(['Preço do produto', 'Preço original do produto']),
      reembolso: grab(['Valor do Reembolso', 'Reembolso']),
      pix: grab(['Ajuste por pagamento via PIX', 'Ajuste PIX', 'PIX']),
      cupom: grab(['Cupom']),
      frete: grab(['Subtotal do Frete', 'Subtotal de Envio']),
      taxas: grab(['Taxas e Encargos', 'Taxas']),
      comissao: grab(['Taxa de comissão líquida']),
      servico: grab(['Taxa de serviço líquida', 'Taxa de serviço']),
      afiliados: grab(['Afiliados do Vendedor', 'Afiliados', 'Taxa de comissão Afiliados']),
      ajustes: mAju ? -Math.abs(mrCents(mAju[1])) : grab(['Valor total de ajuste', 'Valor total do ajuste'])
    };
    var rec = { id: (per && per[0]) || filename, period: (per && per[0]) || '', decl: decl, importedAt: importedAt, fileName: filename, rawLen: full.length, ok: decl.liberado != null };
    var byId = {}; mrPdf.forEach(function (x) { byId[x.id] = x; }); byId[rec.id] = rec; mrPdf = Object.values(byId);
    var batch = { id: 'mrp' + Date.now() + Math.round(performance.now()), module: 'Minha Renda', filename: filename, createdAt: importedAt, seen: 1, novo: 1, upd: 0, unch: 0 };
    batches.unshift(batch);
    return Promise.all([putMany('mrpdf', [rec]), putMany('batches', [batch])]).then(function () { return { kind: 'pdf', decl: decl, ok: rec.ok }; });
  }

  // ---- motor Minha Renda (ORDER×SKU: financeiro só das linhas Order) ----
  function mrEngine() {
    var orders2 = mrRenda.filter(function (r) { return r.ver === 'Order'; });
    var skuRows = mrRenda.filter(function (r) { return r.ver === 'Sku'; });
    var skuByOrder = {}; skuRows.forEach(function (r) { (skuByOrder[r.orderId] = skuByOrder[r.orderId] || []).push(r); });
    var tot = { liberado: 0, preco: 0, reembolso: 0, pix: 0, cupom: 0, comissao: 0, servico: 0, transacao: 0, afiliado: 0, freteParceiro: 0, descontoFrete: 0, envioReverso: 0, n: orders2.length };
    orders2.forEach(function (o) { tot.liberado += o.liberado; tot.preco += o.preco; tot.reembolso += o.reembolso; tot.pix += o.pix; tot.cupom += o.cupom; tot.comissao += o.comissao; tot.servico += o.servico; tot.transacao += o.transacao; tot.afiliado += o.afiliado; tot.freteParceiro += o.freteParceiro; tot.descontoFrete += o.descontoFrete; tot.envioReverso += o.envioReverso; });
    // shipping por SKU
    var shipTot = { esperado: 0, real: 0, n: mrShip.length }; mrShip.forEach(function (s) { shipTot.esperado += s.esperado; shipTot.real += s.real; }); shipTot.diff = shipTot.real - shipTot.esperado;
    var bySku = {}; mrShip.forEach(function (s) { var sk = skuByOrder[s.orderId]; var key = sk && sk[0] ? sk[0].sku : '(sem sku)'; var prod = sk && sk[0] ? sk[0].produto : ''; var g = bySku[key] = bySku[key] || { sku: key, produto: prod, n: 0, esperado: 0, real: 0, diff: 0, multi: sk && sk.length > 1 }; g.n++; g.esperado += s.esperado; g.real += s.real; g.diff += (s.real - s.esperado); });
    var skuList = Object.values(bySku).sort(function (a, b) { return b.diff - a.diff; });
    var adjTot = mrAdj.reduce(function (s, a) { return s + a.valor; }, 0);
    return { orders: orders2, skuByOrder: skuByOrder, tot: tot, shipTot: shipTot, skuList: skuList, adjTot: adjTot };
  }

  // ---- Agregação por período GLOBAL (§4-14 do prompt de alterações pontuais) ----
  // mrEngine()/mrOrderProfitEngine() continuam intocados (usados por Frete, Ajustes, Ficha 360,
  // Financeiro e Meta & Projeção) — nenhuma tela já aprovada muda de comportamento. Este motor
  // NOVO só alimenta Visão Geral/DRE/Taxas/Categorias/Produtos, filtrando os PEDIDOS (módulo
  // Pedidos) pela data de criação dentro do período recebido — mesmo padrão já usado em
  // mrMetaEngine(). Frete/Ajustes não têm campo de data confiável no relatório Income (não alteramos
  // o parser para inventar um), por isso continuam mostrando o histórico completo nessas abas.
  function mrRange(range) {
    var r = range || periodRange();
    return function (iso) { if (!iso) return true; var d = new Date(iso); if (r.from && d < r.from) return false; if (r.to && d > r.to) return false; return true; };
  }
  function mrPrevRange() {
    var r = periodRange(); if (!r.from) return null; // "Todo o período" não tem período anterior comparável
    var to = r.to || new Date(); var spanMs = Math.max(864e5, to - r.from);
    var prevTo = new Date(r.from.getTime() - 1); var prevFrom = new Date(prevTo.getTime() - spanMs);
    return { from: prevFrom, to: prevTo };
  }
  // §37: "Participação em ação comercial" entra como componente próprio da Taxa de Serviço, com
  // origem real na fonte (incentivo + ajuste, colunas 21/46 do Income) — soma automaticamente junto
  // com os demais campos por já estar no array agregado por mrPeriodEngine().
  var MR_FIELDS = ['preco', 'liberado', 'reembolso', 'pix', 'cupom', 'comissao', 'servico', 'transacao', 'afiliado', 'freteParceiro', 'descontoFrete', 'envioReverso', 'incentivoAcaoComercial', 'ajusteAcaoComercial'];
  function mrPeriodEngine(range) {
    var within = mrRange(range);
    var e = mrEngine(); var mrByOrder = {}; e.orders.forEach(function (r) { mrByOrder[r.orderId] = r; });
    var profitOf = mrOrderProfitEngine();
    // REGRA CENTRAL / §24: "o período é definido pela venda paga" — Visão Geral/DRE/Taxas/Categorias/
    // Produtos usam os PEDIDOS PAGOS no período (Hora do pagamento, nunca a criação). As taxas da
    // Minha Renda são cruzadas por ID a partir desta mesma lista de pedidos pagos.
    var list = orders.filter(function (o) { return o.paidAt && within(o.paidAt); });
    var t = { n: 0, nMR: 0 }; MR_FIELDS.forEach(function (k) { t[k] = 0; });
    // §13/§16: Faturamento Bruto e Custo dos Produtos são calculados direto de Pedidos (preço
    // acordado × quantidade / custo por item cadastrado em Produtos), SEM depender de a Minha Renda
    // cobrir o pedido e SEM exigir que TODOS os itens do pedido tenham custo — custo é cobertura
    // parcial por item, nunca tudo-ou-nada por pedido. Só o Lucro (que precisa do pedido inteiro
    // custeado) continua gated por profitOf/p.known — e isso fica sinalizado como "parcial" na UI.
    var lucro = 0, lucroN = 0, pendN = 0, faturamento = 0;
    var custoProd = 0, custoItemsKnown = 0, custoItemsTotal = 0, custoOrdersFullN = 0;
    var mrRows = [];
    var bySku = {};
    list.forEach(function (o) {
      t.n++;
      var mrRow = mrByOrder[o.id];
      if (mrRow) { t.nMR++; MR_FIELDS.forEach(function (k) { t[k] += mrRow[k]; }); mrRows.push(mrRow); }
      var f = orderFinance(o);
      faturamento += Math.round(f.revenue * 100);
      if (!f.costPending) custoOrdersFullN++;
      f._items.forEach(function (it) { custoItemsTotal++; if (!it.costUnknown && it.costTotal != null) custoItemsKnown++; });
      var cC = Math.round((f.productCostTotal || 0) * 100); custoProd += cC;
      var p = profitOf(o);
      var sk = mrRow ? e.skuByOrder[o.id] : null;
      var key = sk && sk[0] ? sk[0].sku : ((o.items[0] && o.items[0].sku) || '(sem sku)');
      var prod = sk && sk[0] ? sk[0].produto : ((o.items[0] && o.items[0].productName) || '');
      var g = bySku[key] = bySku[key] || { sku: key, produto: prod, familia: null, n: 0, nMR: 0, units: 0, preco: 0, liberado: 0, taxasShopee: 0, custoAfiliado: 0, custoProduto: 0, lucro: 0, lucroN: 0, pendN: 0, devN: 0, devLoss: 0 };
      g.n++;
      g.preco += mrRow ? mrRow.preco : Math.round(f.revenue * 100);
      g.custoProduto += cC;
      if (mrRow) { g.nMR++; g.liberado += mrRow.liberado; g.taxasShopee += (mrRow.comissao + mrRow.servico + mrRow.transacao + mrRow.freteParceiro + mrRow.descontoFrete + mrRow.envioReverso); g.custoAfiliado += mrRow.afiliado; }
      if (p.known) { lucro += p.lucro; lucroN++; g.lucro += p.lucro; g.lucroN++; } else { pendN++; g.pendN++; }
    });
    var cross = mrSkuCrossCheck();
    if (cross.reliable) {
      list.forEach(function (o) { var key0 = (o.items[0] && o.items[0].sku) || '(sem sku)'; var g = bySku[key0]; if (g) o.items.forEach(function (it) { if (it.sku === key0) g.units += it.qty; }); });
      occ.forEach(function (o) { if (o.isDemo || !o.orderId || !within(o.occurredAt)) return; (o.items || []).forEach(function (it) { if (!it.sku) return; var g = bySku[it.sku]; if (!g) return; g.devN++; g.devLoss += Math.round(occEffectiveLoss(o) * 100); }); });
    }
    var skuList = Object.values(bySku).map(function (g) {
      g.margem = (g.lucroN && g.preco) ? r2(g.lucro / g.preco * 100) : null;
      g.lucroUn = (cross.reliable && g.units && g.lucroN) ? Math.round(g.lucro / g.units) : null;
      g.units = cross.reliable ? g.units : null;
      g.taxaDevol = cross.reliable && g.n ? r2(g.devN / g.n * 100) : null;
      g.devLoss = cross.reliable ? g.devLoss : null;
      g.outrosMR = g.nMR === g.n && g.nMR > 0 ? (g.liberado - g.preco - g.taxasShopee - g.custoAfiliado) : null;
      if (cross.reliable) { var fc = skuCost[String(g.sku).toLowerCase()]; g.familia = fc ? (fc.familyName || null) : null; }
      return g;
    });
    // §37: "ação comercial" (incentivo + ajuste, colunas reais do Income) faz parte do total canônico
    // de Taxas Shopee — testado contra o arquivo real: sem esses dois campos a conferência com o
    // Pagamento Liberado tinha um resíduo de ~8,5% do liberado; com eles, cai para ~0,2% (§18 nunca
    // soma total + componente — aqui os dois campos SÃO o componente, somados uma única vez aqui).
    var taxasShopeeTotal = t.comissao + t.servico + t.transacao + t.freteParceiro + t.descontoFrete + t.envioReverso + t.incentivoAcaoComercial + t.ajusteAcaoComercial;
    var descontosComerciais = t.cupom + t.pix;
    var receitaLiquida = t.preco + descontosComerciais + taxasShopeeTotal + t.afiliado + t.reembolso; // deve ≈ t.liberado
    var custoCoveragePct = custoItemsTotal ? r2(custoItemsKnown / custoItemsTotal * 100) : 0;
    return {
      range: within, n: list.length, t: t, faturamento: faturamento, lucro: lucro, lucroN: lucroN, pendN: pendN,
      custoProd: custoProd, custoProdN: custoOrdersFullN, custoItemsKnown: custoItemsKnown, custoItemsTotal: custoItemsTotal, custoCoveragePct: custoCoveragePct,
      skuList: skuList, adjTot: e.adjTot, taxasShopeeTotal: taxasShopeeTotal, descontosComerciais: descontosComerciais, receitaLiquida: receitaLiquida, cross: cross, rows: mrRows,
    };
  }
  // §25: cobertura financeira do período (pedidos pagos × MR localizada × custo cadastrado × taxas
  // completas × devolução conciliada) — mostrado explicitamente para nunca fingir 100% de precisão.
  function mrCoberturaFinanceira(range) {
    var pe = mrPeriodEngine(range); var within = mrRange(range);
    var list = orders.filter(function (o) { return o.paidAt && within(o.paidAt); });
    var comDevolConciliada = 0;
    list.forEach(function (o) {
      var casos = occ.filter(function (c) { return !c.isDemo && c.orderId === o.id; });
      if (!casos.length || casos.every(function (c) { return c.receiptState === 'RECEBIDO'; })) comDevolConciliada++;
    });
    var full = list.filter(function (o) { var f = orderFinance(o); return !f.costPending; }).length;
    var totalDim = list.length ? (pe.t.nMR + full + pe.t.nMR + comDevolConciliada) : 0;
    var coberturaTotal = list.length ? r2(totalDim / (list.length * 4) * 100) : 0;
    return { n: list.length, comMR: pe.t.nMR, comCusto: full, comTaxas: pe.t.nMR, comDevol: comDevolConciliada, coberturaTotal: coberturaTotal };
  }
  function mrCoberturaBox(range) {
    var c = mrCoberturaFinanceira(range);
    if (!c.n) return '';
    return '<div class="panel"><div class="ph"><h3>Cobertura financeira do período</h3><span class="footnote" style="margin:0">quanto dos pedidos pagos tem cada fonte cruzada — a base honesta por trás dos números acima</span></div><div class="table-wrap"><table class="report"><tbody>' +
      '<tr><td>Pedidos pagos</td><td class="nowrap"><b>' + nn(c.n) + '</b></td><td></td></tr>' +
      '<tr><td>Com Minha Renda localizada</td><td class="nowrap">' + nn(c.comMR) + '</td><td>' + pct(c.n ? r2(c.comMR / c.n * 100) : 0) + '</td></tr>' +
      '<tr><td>Com custo cadastrado (todos os itens)</td><td class="nowrap">' + nn(c.comCusto) + '</td><td>' + pct(c.n ? r2(c.comCusto / c.n * 100) : 0) + '</td></tr>' +
      '<tr><td>Com taxas completas (Minha Renda)</td><td class="nowrap">' + nn(c.comTaxas) + '</td><td>' + pct(c.n ? r2(c.comTaxas / c.n * 100) : 0) + '</td></tr>' +
      '<tr><td>Com devolução conciliada</td><td class="nowrap">' + nn(c.comDevol) + '</td><td>' + pct(c.n ? r2(c.comDevol / c.n * 100) : 0) + '</td></tr>' +
      '<tr style="border-top:2px solid var(--line)"><td><b>Cobertura total</b></td><td class="nowrap"><b>' + pct(c.coberturaTotal) + '</b></td><td></td></tr>' +
      '</tbody></table></div></div>';
  }
  function mrTrendArrow(cur, prev) { if (prev == null || prev === 0) return cur > 0 ? '↑' : cur < 0 ? '↓' : '→'; var v = (cur - prev) / Math.abs(prev); return v > 0.01 ? '↑' : v < -0.01 ? '↓' : '→'; }
  function mrTrendPct(cur, prev) { if (prev == null || prev === 0) return null; return r2((cur - prev) / Math.abs(prev) * 100); }

  // ---- Drill-down universal das linhas financeiras (§25-29) ----
  // Clicar em qualquer valor consolidado (Visão Geral, DRE, Taxas Shopee, Categorias) abre a lista
  // real dos lançamentos que o formaram, respeitando o período global já selecionado. Clicar no
  // pedido abre a Ficha Financeira 360º. Nunca soma de novo (mesma leitura de mrPeriodEngine).
  function openMrDrill(kind, label) {
    var pe = mrPeriodEngine(); var e = mrEngine(); var rows = [];
    if (kind === 'taxasShopee') {
      pe.rows.forEach(function (r) {
        var v = r.comissao + r.servico + r.transacao + r.freteParceiro + r.descontoFrete + r.envioReverso; if (!v) return;
        var sk = e.skuByOrder[r.orderId];
        rows.push({ orderId: r.orderId, data: r.dataConclusao || r.dataCriacao, sku: sk && sk[0] ? sk[0].sku : '—', produto: sk && sk[0] ? sk[0].produto : (r.produto || '—'), descricao: 'comissão+serviço+transação+frete parceiro+ajuste de frete+envio reverso', valor: v });
      });
    } else if (MR_FIELDS.indexOf(kind) >= 0 || kind === 'receitaLiquida') {
      // "Receita Líquida" = exatamente o pagamento liberado (soma de mrRow.liberado) — mesma base do
      // card e do DRE. Não depende de custo do produto conhecido (diferente de faturamento/lucro).
      var mrKind = kind === 'receitaLiquida' ? 'liberado' : kind;
      pe.rows.filter(function (r) { return r[mrKind] !== 0; }).forEach(function (r) {
        var sk = e.skuByOrder[r.orderId];
        rows.push({ orderId: r.orderId, data: r.dataConclusao || r.dataCriacao, sku: sk && sk[0] ? sk[0].sku : '—', produto: sk && sk[0] ? sk[0].produto : (r.produto || '—'), descricao: r.tipoPedido || '—', valor: r[mrKind] });
      });
    } else if (kind === 'adjustes') {
      mrAdj.forEach(function (a) { rows.push({ orderId: a.orderId || '—', data: null, sku: '—', produto: '—', descricao: a.desc || 'Ajuste', valor: a.valor }); });
    } else if (kind === 'custoProdutos') {
      // §16/§24: pedidos PAGOS do período, cobertura parcial por item (nunca tudo-ou-nada por pedido)
      // — mesma base de pedidos e mesma soma parcial de mrPeriodEngine().
      orders.filter(function (o) { return o.paidAt && inPeriod(o.paidAt); }).forEach(function (o) { var f = orderFinance(o); var cC = Math.round((f.productCostTotal || 0) * 100); if (!cC) return; rows.push({ orderId: o.id, data: o.paidAt, sku: (o.items[0] && o.items[0].sku) || '—', produto: (o.items[0] && o.items[0].productName) || '—', descricao: f.costPending ? 'Custo do produto (parcial — algum item sem custo)' : 'Custo do produto', valor: -cC }); });
    } else if (kind === 'faturamento') {
      // §13/§24: faturamento é de TODOS os pedidos pagos do período, sem depender de custo/Minha Renda.
      var mrByOrder2 = {}; e.orders.forEach(function (r) { mrByOrder2[r.orderId] = r; });
      orders.filter(function (o) { return o.paidAt && inPeriod(o.paidAt); }).forEach(function (o) {
        var f = orderFinance(o); var mrRow = mrByOrder2[o.id]; var sk = mrRow ? e.skuByOrder[o.id] : null;
        rows.push({ orderId: o.id, data: o.paidAt, sku: sk && sk[0] ? sk[0].sku : ((o.items[0] && o.items[0].sku) || '—'), produto: sk && sk[0] ? sk[0].produto : ((o.items[0] && o.items[0].productName) || '—'), descricao: 'Pedidos (preço acordado × qtd)', valor: Math.round(f.revenue * 100) });
      });
    } else if (kind === 'lucro') {
      var profitOf = mrOrderProfitEngine(); var mrByOrder = {}; e.orders.forEach(function (r) { mrByOrder[r.orderId] = r; });
      orders.filter(function (o) { return o.paidAt && inPeriod(o.paidAt); }).forEach(function (o) {
        var p = profitOf(o); if (!p.known) return;
        var mrRow = mrByOrder[o.id]; var sk = mrRow ? e.skuByOrder[o.id] : null;
        rows.push({ orderId: o.id, data: o.paidAt, sku: sk && sk[0] ? sk[0].sku : ((o.items[0] && o.items[0].sku) || '—'), produto: sk && sk[0] ? sk[0].produto : ((o.items[0] && o.items[0].productName) || '—'), descricao: mrRow ? 'Minha Renda' : 'estimado (Pedidos)', valor: p.lucro });
      });
    }
    rows.sort(function (a, b) { return Math.abs(b.valor) - Math.abs(a.valor); });
    var total = rows.reduce(function (s, r) { return s + r.valor; }, 0);
    var d = document.createElement('div'); d.className = 'drawer'; var panel = document.createElement('div'); panel.className = 'drawer-panel'; panel.style.width = '820px'; panel.style.maxWidth = '97vw';
    d.appendChild(panel); d.onclick = function (ev) { if (ev.target === d) d.remove(); }; document.body.appendChild(d);
    var trs = rows.slice(0, 500).map(function (r) { return '<tr class="rowlink" data-drillped="' + esc(r.orderId) + '"><td class="mono">' + esc(r.orderId) + '</td><td class="nowrap">' + (r.data ? dbr(r.data) : '—') + '</td><td class="mono">' + esc(r.sku) + '</td><td class="cell-text">' + esc((r.produto || '—').slice(0, 26)) + '</td><td class="cell-text">' + esc(r.descricao) + '</td><td class="nowrap ' + (r.valor < 0 ? 'neg' : 'pos') + '">' + brlC(r.valor) + '</td></tr>'; }).join('');
    var periodNote = kind === 'adjustes' ? 'Ajustes (Adjustment) não têm data confiável na fonte — lista mostra o total importado, não filtrado por período.' : 'Respeita o período selecionado no topo da tela.';
    panel.innerHTML = '<div class="dh"><div><b>' + esc(label) + '</b></div><button class="x">&times;</button></div><div class="dbd">' +
      '<div class="kstrip" style="margin-bottom:12px"><div class="kc"><div class="kl">Total exibido</div><div class="kv">' + brlC(total) + '</div></div><div class="kc"><div class="kl">Pedidos envolvidos</div><div class="kv">' + nn(rows.length) + '</div></div></div>' +
      (rows.length ? '<div class="table-wrap"><table class="report"><thead><tr><th>Pedido</th><th>Data</th><th>SKU</th><th>Produto</th><th>Descrição</th><th>Valor</th></tr></thead><tbody>' + trs + '</tbody></table></div>' + (rows.length > 500 ? '<div class="footnote" style="padding:8px 0">Mostrando os 500 maiores lançamentos de ' + nn(rows.length) + '.</div>' : '') : emptyBox('Nenhum lançamento encontrado para este valor no período selecionado.')) +
      '<div class="footnote" style="padding:8px 0">' + esc(periodNote) + ' Clique no pedido para abrir a Ficha Financeira 360º.</div>' +
      '</div>';
    panel.querySelector('.x').onclick = function () { d.remove(); };
    panel.querySelectorAll('[data-drillped]').forEach(function (tr) { tr.onclick = function () { var oid = tr.dataset.drillped; if (oid === '—') return; d.remove(); openPedidoFicha360(oid); }; });
  }

  function renderMinhaRenda() {
    // Ordem fixa pelo prompt de alterações pontuais (§2-3, §19): Visão Geral no topo, Meta & Projeção
    // sempre por último. DRE/Taxas/Categorias/Produtos priorizam a análise financeira real; Frete,
    // Ajustes, Conciliação e Auditoria são as abas já existentes, preservadas sem alteração de posição relativa.
    // §39 do prompt "Alterações — Sistema Marketplace Líder": Visão Geral, DRE, Taxas, Categorias,
    // Produtos/SKUs, Lucro e Prejuízo, Tendências, Meta e Projeção (sempre por último). Frete,
    // Ajustes, Conciliação e Auditoria são abas já existentes, preservadas.
    var tabs = [['visao', 'Visão Geral'], ['dre', 'DRE'], ['taxas', 'Taxas Shopee'], ['categorias', 'Categorias'], ['produto', 'Produtos e SKUs'], ['lucroprejuizo', 'Lucro e Prejuízo'], ['tendencias', 'Tendências'], ['frete', 'Frete & Divergências'], ['ajustes', 'Ajustes'], ['conciliacao', 'Conciliação Declaração'], ['auditoria', 'Auditoria'], ['meta', 'Meta & Projeção']];
    app.innerHTML = dadosAtualizadosAteBadge() + devPeriodBar() + '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap"><div class="subtabs" style="margin-bottom:0;overflow-x:auto">' + tabs.map(function (t) { return '<div class="subtab' + (mrSub === t[0] ? ' active' : '') + '" data-mrsub="' + t[0] + '">' + t[1] + '</div>'; }).join('') + '</div><button class="btn-sm primary" data-mrimport="1">Importar Income / Declaração</button></div><div id="mrbody" style="margin-top:14px"></div>';
    var body = document.getElementById('mrbody');
    try {
      if (!mrRenda.length && !mrShip.length && !mrPdf.length && mrSub !== 'meta') body.innerHTML = secHead('MINHA RENDA', 'Consolidação Financeira Shopee', 'Quanto vendemos, quanto foi descontado, para onde foi o dinheiro e quanto a Shopee liberou — do agregado até o pedido.') + emptyBox('Nenhum relatório importado. Envie o Income (XLSX) da Shopee — é a única fonte necessária. A Declaração de Renda (PDF) é opcional, só para uma conferência extra na aba Conciliação. O tipo é detectado automaticamente.') + '<div style="text-align:center;margin-top:-8px"><button class="btn-sm primary" id="mrimp">Importar primeiro relatório</button></div>';
      else body.innerHTML = ({ visao: mrVisao, dre: mrDRE, taxas: mrTaxas, categorias: mrCategorias, produto: mrProduto, lucroprejuizo: mrLucroPrejuizo, tendencias: mrTendencias, frete: mrFrete, ajustes: mrAjustes, conciliacao: mrConciliacao, auditoria: mrAuditoria, meta: mrMeta }[mrSub] || mrVisao)();
    } catch (e) { body.innerHTML = '<div class="form-err">Erro ao renderizar Minha Renda: ' + esc(e.message || e) + '</div>'; }
    app.querySelectorAll('[data-mrsub]').forEach(function (b) { b.onclick = function () { mrSub = b.dataset.mrsub; mrPage = 1; render(); }; });
    var imp = function () { fileInput(function (f) { importMinhaRenda(f).then(function (b) { render(); if (b.kind === 'pdf') toast(b.ok ? 'Declaração PDF lida' : 'PDF processado parcialmente', b.ok ? 'Pagamento liberado ' + brlC(b.decl.liberado) : 'Não foi possível reconhecer todos os campos do PDF'); else toast('Income importado', b.stats.renda + ' linhas de renda · ' + b.stats.ship + ' fretes · ' + b.stats.adj + ' ajustes'); }).catch(function (e) { toast('Falha', e.message, true); }); }); };
    app.querySelectorAll('[data-mrimport]').forEach(function (b) { b.onclick = imp; });
    var mi = document.getElementById('mrimp'); if (mi) mi.onclick = imp;
    app.querySelectorAll('[data-mrgo]').forEach(function (b) { b.onclick = function () { mrSub = b.dataset.mrgo; render(); }; });
    app.querySelectorAll('[data-mrsku]').forEach(function (b) { b.onclick = function () { openMrSku(b.dataset.mrsku); }; });
    app.querySelectorAll('[data-mrped]').forEach(function (b) { b.onclick = function () { openMrPedido(b.dataset.mrped); }; });
    app.querySelectorAll('[data-goped360]').forEach(function (b) { b.onclick = function () { openPedidoFicha360(b.dataset.goped360); }; });
    app.querySelectorAll('[data-goacbip]').forEach(function (b) { b.onclick = function () { route = 'acelera'; aceleraSub = 'bipados'; render(); }; });
    app.querySelectorAll('[data-gorecb]').forEach(function (b) { b.onclick = function () { route = 'posvenda'; sub.posvenda = 'recebimentos'; render(); }; });
    app.querySelectorAll('[data-gowal]').forEach(function (b) { b.onclick = function () { route = 'carteira'; walletSub = 'mov'; render(); }; });
    app.querySelectorAll('[data-golink]').forEach(function (b) { b.onclick = function () { route = b.dataset.golink; render(); }; });
    app.querySelectorAll('[data-mrdrill]').forEach(function (b) { b.onclick = function () { openMrDrill(b.dataset.mrdrill, b.dataset.mrdrilllabel || b.dataset.mrdrill); }; });
    bindDevPeriodBar();
    if (mrSub === 'frete') bindMrFrete();
    if (mrSub === 'meta') bindMrMeta();
    if (mrSub === 'produto') bindMrProduto();
    if (mrSub === 'taxas') bindMrTaxas();
  }
  function mrWaterfall(t) {
    // do preço (bruto) até o liberado
    var steps = [['Preço do produto', t.preco, 'base'], ['Reembolso', t.reembolso, 'neg'], ['PIX', t.pix, 'neg'], ['Cupom', t.cupom, 'neg'], ['Comissão', t.comissao, 'neg'], ['Serviço', t.servico, 'neg'], ['Ação comercial (incentivo + ajuste)', t.incentivoAcaoComercial + t.ajusteAcaoComercial, 'neg'], ['Afiliados', t.afiliado, 'neg'], ['Frete parceiro', t.freteParceiro, 'neg'], ['Desconto frete (Shopee)', t.descontoFrete, 'pos'], ['Envio reverso', t.envioReverso, 'neg']];
    var rows = steps.map(function (s) { return '<tr class="rowlink"><td>' + esc(s[0]) + '</td><td class="nowrap ' + (s[1] < 0 ? 'neg' : s[1] > 0 ? 'pos' : '') + '">' + brlC(s[1]) + '</td></tr>'; }).join('');
    return '<div class="panel"><div class="ph"><h3>Para onde foi o dinheiro</h3><span class="footnote" style="margin:0">do preço do produto ao pagamento liberado</span></div><div class="table-wrap"><table class="report"><tbody>' + rows + '<tr style="border-top:2px solid var(--line)"><td><b>Pagamento liberado</b></td><td class="nowrap"><b>' + brlC(t.liberado) + '</b></td></tr></tbody></table></div></div>';
  }
  function mrVisao() {
    var pe = mrPeriodEngine(); var t = pe.t;
    var head = secHead('MINHA RENDA', 'Visão Geral', 'Análise financeira real do período selecionado no topo da tela (pedidos PAGOS — hora do pagamento). Pagamento liberado = renda líquida Shopee (não é lucro, ver §23).');
    if (!pe.n) return head + emptyBox('Nenhum pedido pago no período selecionado. Motivo: não há pedidos com "Hora do pagamento do pedido" preenchida dentro deste intervalo — ajuste o período ou importe Pedidos.');
    // §13/§16/§19: Faturamento Bruto e Ticket Médio vêm direto de Pedidos (preço acordado × qtd dos
    // pedidos pagos) e NUNCA dependem de custo/Minha Renda estarem disponíveis. Custo dos Produtos é
    // cobertura parcial por item (nunca tudo-ou-nada). Só Lucro/Lucro Médio/Margem continuam
    // dependendo do pedido inteiro custeado — por isso ficam marcados "parcial" quando pendN > 0,
    // nunca escondidos como "não disponível" enquanto houver ao menos 1 pedido com lucro conhecido.
    var temLucro = pe.lucroN > 0;
    var lucroParcial = pe.pendN > 0;
    var margemLiq = (temLucro && pe.faturamento) ? r2(pe.lucro / pe.faturamento * 100) : null;
    var ticketMedio = pe.n ? Math.round(pe.faturamento / pe.n) : null;
    var lucroMedioPedido = temLucro ? Math.round(pe.lucro / pe.lucroN) : null;
    var custoTemDado = pe.custoItemsKnown > 0;
    var custoParcial = custoTemDado && pe.custoCoveragePct < 100;
    var taxasShopeeAbs = Math.abs(pe.taxasShopeeTotal), afiliadosAbs = Math.abs(t.afiliado), devolucoesAbs = Math.abs(t.reembolso), outrosAbs = Math.abs(t.cupom + t.pix) + Math.abs(pe.adjTot);
    var parcialTag = ' <span class="tag warn">parcial</span>';
    var strip1 = kstrip([
      { l: 'Faturamento Bruto', v: brlC(pe.faturamento), cls: 'blue', s: nn(pe.n) + ' pedidos pagos no período', drill: 'faturamento', drillLabel: 'Faturamento Bruto' },
      { l: 'Receita Líquida (Pagamento Liberado)', v: brlC(t.liberado), cls: 'blue', s: nn(t.nMR) + ' de ' + nn(pe.n) + ' com dados da Shopee — não é faturamento (§23)', drill: t.nMR ? 'receitaLiquida' : null, drillLabel: 'Receita Líquida' },
      { l: 'Lucro' + (temLucro && lucroParcial ? parcialTag : ''), v: temLucro ? brlC(pe.lucro) : 'não disponível', s: temLucro ? null : 'Motivo: nenhum pedido pago do período tem o custo de todos os itens cadastrado em Produtos.', cls: !temLucro ? 'blue' : (pe.lucro >= 0 ? 'green' : 'red'), drill: temLucro ? 'lucro' : null, drillLabel: 'Lucro' },
      { l: 'Margem Líquida %' + (margemLiq != null && lucroParcial ? parcialTag : ''), v: margemLiq != null ? pct(margemLiq) : '—', cls: margemLiq == null ? 'blue' : (margemLiq >= 0 ? 'green' : 'red') },
    ]);
    var strip2 = kstrip([
      { l: 'Pedidos pagos', v: nn(pe.n), cls: 'blue', s: pe.pendN ? nn(pe.pendN) + ' com custo pendente em algum item' : 'todos com custo conhecido' },
      { l: 'Ticket Médio', v: ticketMedio != null ? brlC(ticketMedio) : 'não disponível', cls: 'blue', s: 'faturamento ÷ pedidos pagos' },
      { l: 'Lucro Médio por Pedido' + (temLucro && lucroParcial ? parcialTag : ''), v: lucroMedioPedido != null ? brlC(lucroMedioPedido) : 'não disponível', s: lucroMedioPedido != null ? null : 'Motivo: nenhum pedido pago do período tem lucro calculável (custo incompleto).', cls: lucroMedioPedido == null ? 'blue' : (lucroMedioPedido >= 0 ? 'green' : 'red') },
      { l: 'Custo dos Produtos' + (custoParcial ? parcialTag : ''), v: custoTemDado ? brlC(pe.custoProd) : 'não disponível', cls: 'amber', s: custoTemDado ? (nn(pe.custoItemsKnown) + ' de ' + nn(pe.custoItemsTotal) + ' itens com custo (' + pct(pe.custoCoveragePct) + ')') : 'Motivo: nenhum custo de produto foi encontrado para os pedidos pagos deste período (SKUs sem vínculo em Produtos ou sem custo cadastrado).', drill: custoTemDado ? 'custoProdutos' : null, drillLabel: 'Custo dos Produtos' },
    ]);
    var strip3 = kstrip([
      { l: 'Total Taxas Shopee', v: brlC(taxasShopeeAbs), cls: 'red', drill: t.nMR ? 'taxasShopee' : null, drillLabel: 'Total Taxas Shopee' },
      { l: 'Afiliados', v: brlC(afiliadosAbs), cls: 'amber', drill: t.nMR ? 'afiliado' : null, drillLabel: 'Afiliados' },
      { l: 'Devoluções', v: brlC(devolucoesAbs), cls: 'red', drill: t.nMR ? 'reembolso' : null, drillLabel: 'Devoluções' },
      { l: 'Outros Descontos/Ajustes', v: brlC(outrosAbs), cls: 'amber' },
    ]);
    var coverage = t.nMR < pe.n ? callout('warn', 'Cobertura da Minha Renda no período', '<b>' + nn(t.nMR) + '</b> de <b>' + nn(pe.n) + '</b> pedidos pagos têm dados reais da Shopee (Income) no período. Faturamento Bruto/Ticket Médio já vêm de Pedidos (sempre completos); Taxas Shopee/Afiliados/Devoluções/Receita Líquida acima refletem <b>só</b> os pedidos cobertos pela Minha Renda — nunca estimados.') : '';
    var cobertura = mrCoberturaBox();
    var tendLink = callout('', 'Comparações e tendências', 'A comparação com o período anterior agora tem aba própria. <button class="btn-sm" data-mrgo="tendencias">Ver Tendências</button>');
    var e = mrEngine();
    var dedup = callout('', 'ORDER × SKU (sem dupla contagem)', mrRenda.length ? 'Importadas <b>' + nn(e.orders.length) + '</b> linhas Order (financeiro) e <b>' + nn(mrRenda.length - e.orders.length) + '</b> linhas SKU (atribuição de produto) no total já importado. Os valores financeiros vêm só das linhas Order.' : '');
    var ship = e.shipTot; var shipBox = ship.n ? callout('warn', 'Frete acima do esperado (histórico completo, sem data confiável para filtrar): ' + brlC(ship.diff), '<b>' + nn(ship.n) + '</b> pedidos · esperado ' + brlC(ship.esperado) + ' · real ' + brlC(ship.real) + '. <button class="btn-sm" data-mrgo="frete">Investigar</button>') : '';
    return head + strip1 + strip2 + strip3 + coverage + mrWaterfall(t) + cobertura + tendLink + dedup + shipBox + mrAlertas();
  }
  // ---- Tendências (§39): comparação com o período anterior equivalente, aba própria ----
  function mrTendencias() {
    var pe = mrPeriodEngine(); var t = pe.t; var temLucro = pe.lucroN > 0;
    var head = secHead('MINHA RENDA · TENDÊNCIAS', 'Como o período atual se compara ao anterior', 'Mesma duração do período selecionado no topo da tela (pedidos pagos), deslocada para trás — não é necessariamente o "mês anterior" no calendário.');
    var ticketMedio = pe.n ? Math.round(pe.faturamento / pe.n) : null;
    var lucroMedioPedido = temLucro ? Math.round(pe.lucro / pe.lucroN) : null;
    var taxasShopeeAbs = Math.abs(pe.taxasShopeeTotal), afiliadosAbs = Math.abs(t.afiliado), devolucoesAbs = Math.abs(t.reembolso);
    var prevR = mrPrevRange();
    if (!prevR) return head + callout('', 'Sem período anterior para comparar', 'Selecione um período específico (não "Todo o período") para comparar com o intervalo imediatamente anterior de mesma duração.');
    var pv = mrPeriodEngine(prevR); var pvTem = pv.lucroN > 0;
    var pvFat = pv.n ? pv.faturamento : null, pvLucro = pvTem ? pv.lucro : null, pvTicket = pv.n ? Math.round(pv.faturamento / pv.n) : null, pvLucroPed = pvTem ? Math.round(pv.lucro / pv.lucroN) : null;
    var brlCN = function (v) { return v == null ? 'não disponível' : brlC(v); };
    var items = [['Faturamento Bruto', pe.n ? pe.faturamento : null, pvFat, brlCN], ['Receita Líquida', t.liberado, pv.t.liberado, brlC], ['Lucro', temLucro ? pe.lucro : null, pvLucro, brlCN], ['Pedidos pagos', pe.n, pv.n, nn], ['Ticket Médio', ticketMedio, pvTicket, brlCN], ['Lucro por Pedido', lucroMedioPedido, pvLucroPed, brlCN], ['Total Taxas Shopee', taxasShopeeAbs, Math.abs(pv.taxasShopeeTotal), brlC], ['Afiliados', afiliadosAbs, Math.abs(pv.t.afiliado), brlC], ['Devoluções', devolucoesAbs, Math.abs(pv.t.reembolso), brlC]];
    var rows = items.map(function (it) { var arrow = (it[1] == null || it[2] == null) ? '—' : mrTrendArrow(it[1], it[2]); var vp = (it[1] == null || it[2] == null) ? null : mrTrendPct(it[1], it[2]); return '<tr><td>' + esc(it[0]) + '</td><td class="nowrap">' + it[3](it[2]) + '</td><td class="nowrap"><b>' + it[3](it[1]) + '</b></td><td class="nowrap ' + (arrow === '↑' ? 'pos' : arrow === '↓' ? 'neg' : '') + '">' + arrow + (vp != null ? ' ' + (vp >= 0 ? '+' : '') + pct(vp) : '') + '</td></tr>'; }).join('');
    var table = '<div class="panel"><div class="ph"><h3>Período atual × período anterior</h3></div><div class="table-wrap"><table class="report"><thead><tr><th>Métrica</th><th>Período anterior</th><th>Período atual</th><th>Variação</th></tr></thead><tbody>' + rows + '</tbody></table></div></div>';
    var chart = chartCard('Faturamento e Lucro — atual × anterior', legendSwatch([['Anterior', '#94a3b8'], ['Atual', '#2b4bd6']]), svgGroupBars(['Faturamento', 'Lucro'], [{ name: 'Anterior', color: '#94a3b8', vals: [(pvFat || 0) / 100, (pvLucro || 0) / 100] }, { name: 'Atual', color: '#2b4bd6', vals: [(pe.n ? pe.faturamento : 0) / 100, (temLucro ? pe.lucro : 0) / 100] }], { fmt: function (v) { return brl(v); } }));
    return head + table + chart;
  }
  // Central de alertas determinística (cruza Minha Renda × Acelera × Devoluções × Carteira × Meta).
  function mrAlertas() {
    var alerts = [];
    // pedidos expedidos não localizados no Acelera
    var bips = Object.keys(shipBip); if (bips.length && acelera.length) { var acSet = {}; acelera.forEach(function (r) { acSet[r.pedido] = 1; }); var naoAch = bips.filter(function (oid) { return !acSet[oid]; }); if (naoAch.length) alerts.push({ icon: '🔴', text: nn(naoAch.length) + ' pedido(s) expedidos não encontrados no Acelera.', go: 'acelera-bipados' }); }
    // SKU com margem negativa (Renda por Produto)
    var e = mrEngine(); var bySku = {}; e.orders.forEach(function (o) { var sk = e.skuByOrder[o.orderId]; var key = sk && sk[0] ? sk[0].sku : '(sem sku)'; var g = bySku[key] = bySku[key] || { n: 0, liberado: 0 }; g.n++; g.liberado += o.liberado; });
    var negSkus = Object.keys(bySku).filter(function (k) { return bySku[k].liberado < 0; });
    if (negSkus.length) alerts.push({ icon: '🔴', text: nn(negSkus.length) + ' SKU(s) com pagamento liberado negativo no período.', go: 'produto' });
    // SKU com prejuízo real (lucro após custo do produto, não só o liberado)
    var prejuizoSkus = mrSkuRentabilidade().filter(function (x) { return x.lucroN > 0 && x.lucro < 0; });
    if (prejuizoSkus.length) alerts.push({ icon: '🔴', text: nn(prejuizoSkus.length) + ' SKU(s) com prejuízo real (após custo do produto).', go: 'produto' });
    // devolução sem baixa (recebimento pendente há mais de 7 dias)
    var semBaixa = occ.filter(function (o) { return !o.isDemo && o.type === 'RETURN_REFUND' && (!o.receiptState || o.receiptState === 'DESCONHECIDO') && inPeriod(o.occurredAt); });
    if (semBaixa.length) alerts.push({ icon: '🟠', text: nn(semBaixa.length) + ' devolução(ões) ainda sem baixa de recebimento.', go: 'posvenda-recebimentos' });
    // devolução recebida mas sem classificação de reaproveitamento (§21)
    var semReaprov = occ.filter(function (o) { return !o.isDemo && o.receiptState === 'RECEBIDO' && !o.merchandiseCondition && inPeriod(o.occurredAt); });
    if (semReaprov.length) alerts.push({ icon: '🟠', text: nn(semReaprov.length) + ' devolução(ões) recebida(s) sem classificação de reaproveitamento.', go: 'posvenda-recebimentos' });
    // lançamentos da carteira sem categoria/origem identificada
    var walletUnclass = wallet.filter(function (t) { return (wEffCat ? wEffCat(t) === 'OUTRO' : false) && !t.orderId; });
    if (walletUnclass.length) alerts.push({ icon: '🟡', text: nn(walletUnclass.length) + ' lançamento(s) da carteira sem origem identificada.', go: 'carteira' });
    // ritmo da meta (se configurada)
    if (mrMetaCfg.lucroAlvo > 0) { var mm = mrMetaEngine(); if (mm.ritmoStatus === 'ABAIXO') alerts.push({ icon: '🔴', text: 'Lucro está ' + pct(Math.abs(mm.ritmoDiffPct)) + ' abaixo do ritmo necessário para a meta.', go: 'meta' }); }
    if (!alerts.length) return '';
    return '<div class="panel"><div class="ph"><h3>Alertas</h3></div><div class="pb">' + alerts.map(function (a) { return '<div class="fin-line"><span>' + a.icon + ' ' + esc(a.text) + '</span>' + (a.go === 'acelera-bipados' ? '<button class="btn-sm" data-goacbip="1">abrir</button>' : a.go === 'posvenda-recebimentos' ? '<button class="btn-sm" data-gorecb="1">abrir</button>' : a.go === 'carteira' ? '<button class="btn-sm" data-gowal="1">abrir</button>' : '<button class="btn-sm" data-mrgo="' + a.go + '">abrir</button>'); }).join('') + '</div></div>';
  }
  // ---- DRE (§5 do prompt de alterações pontuais) ----
  // Estrutura em cascata usando só campos reais do Income (linhas Order do período). "Custos
  // Fixos/Internos" não tem fonte no sistema — declarado como não disponível, nunca R$ 0.
  function mrDRE() {
    var pe = mrPeriodEngine(); var t = pe.t;
    var head = secHead('MINHA RENDA · DRE', 'Demonstrativo de Resultado', 'Cascata do período selecionado no topo da tela — pedidos PAGOS (hora do pagamento, REGRA CENTRAL). "Custos Fixos/Internos" não tem fonte de dados no sistema hoje — aparece como não disponível, nunca como R$ 0.');
    if (!pe.n) return head + emptyBox('Nenhum pedido pago no período selecionado. Motivo: não há pedidos com "Hora do pagamento do pedido" preenchida dentro deste intervalo.');
    // §13/§24: Receita Bruta = Faturamento Bruto de TODOS os pedidos pagos do período, calculado
    // direto de Pedidos (preço acordado × qtd) — nunca só o subconjunto coberto pela Minha Renda.
    var receitaBruta = pe.faturamento;
    // §18/§24: as deduções abaixo (descontos/taxas/devoluções) só existem para os pedidos com dados
    // da Minha Renda (Income) cruzados por ID — quando t.nMR < pe.n, a cascata é uma aproximação
    // PARCIAL e isso é sinalizado explicitamente, nunca escondido.
    var descComerciais = t.cupom + t.pix;
    var taxasShopee = pe.taxasShopeeTotal + t.afiliado;
    var devolucoes = t.reembolso;
    var outrosAj = pe.adjTot;
    var receitaLiquida = receitaBruta + descComerciais + taxasShopee + devolucoes + outrosAj;
    // §16/§19: Custo dos Produtos é a soma parcial dos itens com custo cadastrado — nunca
    // tudo-ou-nada por pedido. Só falta o dado quando NENHUM item do período tem custo.
    var custoTemDado = pe.custoItemsKnown > 0;
    var custoProdutos = custoTemDado ? pe.custoProd : null;
    var lucro = custoProdutos == null ? null : receitaLiquida - custoProdutos;
    var margem = (receitaBruta && lucro != null) ? r2(lucro / receitaBruta * 100) : null;
    var mrParcial = t.nMR < pe.n;
    var custoParcial = custoTemDado && pe.custoCoveragePct < 100;
    // Todas as linhas com valor real são clicáveis (§25-29): abrem os lançamentos que a formaram.
    var line = function (label, v, opts) { opts = opts || {}; var drillAttr = opts.drill && v != null ? ' rowlink" data-mrdrill="' + esc(opts.drill) + '" data-mrdrilllabel="' + esc(label) : ''; return '<div class="fin-line' + (opts.total ? ' total' : '') + drillAttr + '"><span>' + (opts.op ? '<b>' + opts.op + '</b> ' : '') + esc(label) + (opts.warn ? ' <span class="tag warn">parcial</span>' : '') + (opts.note ? ' <span class="footnote" style="margin:0">' + esc(opts.note) + '</span>' : '') + '</span><b class="' + (v == null ? '' : v < 0 ? 'neg' : v > 0 ? 'pos' : '') + '">' + (v == null ? 'não disponível' : brlC(v)) + '</b></div>'; };
    var custoNote = !custoTemDado ? 'Motivo: nenhum custo de produto foi encontrado para os pedidos pagos deste período.' : (nn(pe.custoItemsKnown) + ' de ' + nn(pe.custoItemsTotal) + ' itens com custo cadastrado (' + pct(pe.custoCoveragePct) + ')');
    var taxasNote = 'comissão, serviço, transação, frete parceiro, ajuste de frete, envio reverso e afiliados — detalhamento na aba Taxas Shopee. ' + (mrParcial ? nn(t.nMR) + ' de ' + nn(pe.n) + ' pedidos pagos com dados da Minha Renda cruzados.' : 'todos os pedidos pagos cruzados.');
    var cascata = '<div class="panel"><div class="ph"><h3>Cascata</h3><span class="footnote" style="margin:0">clique numa linha para ver os lançamentos</span></div><div class="pb">' +
      line('Receita Bruta (Faturamento)', receitaBruta, { note: nn(pe.n) + ' pedidos pagos no período (Pedidos, preço acordado × qtd)', drill: 'faturamento' }) +
      line('Descontos Comerciais', descComerciais, { op: '−', note: 'cupom + PIX', warn: mrParcial }) +
      line('Taxas Shopee', taxasShopee, { op: '−', note: taxasNote, drill: 'taxasShopee', warn: mrParcial }) +
      line('Devoluções e Reembolsos', devolucoes, { op: '−', drill: 'reembolso', warn: mrParcial }) +
      line('Outros Ajustes/Descontos', outrosAj, { op: '−', note: 'aba Adjustment — total importado, sem data confiável para restringir ao período', drill: 'adjustes' }) +
      line('Receita Líquida', receitaLiquida, { total: true, op: '=', drill: 'receitaLiquida', warn: mrParcial }) +
      line('Custo dos Produtos', custoProdutos, { op: '−', note: custoNote, drill: custoTemDado ? 'custoProdutos' : null, warn: custoParcial }) +
      line('Custos Fixos/Internos', null, { op: '−', note: 'sem fonte de dados no sistema' }) +
      line('Lucro', lucro, { total: true, op: '=', drill: 'lucro', warn: mrParcial || custoParcial }) +
      '<div class="fin-line"><span>Margem sobre a Receita Bruta' + (margem != null && (mrParcial || custoParcial) ? ' <span class="tag warn">parcial</span>' : '') + '</span><b class="' + (margem == null ? '' : margem >= 0 ? 'pos' : 'neg') + '">' + (margem == null ? '—' : pct(margem)) + '</b></div>' +
      '</div></div>';
    var mrCheck = t.liberado - (t.preco + descComerciais + taxasShopee + devolucoes);
    var conf = t.nMR ? callout(Math.abs(mrCheck) <= 100 ? 'green' : 'warn', Math.abs(mrCheck) <= 100 ? '✓ Conferência Minha Renda: bate com o Pagamento Liberado real' : '⚠ Diferença na conferência da Minha Renda', 'Só para os ' + nn(t.nMR) + ' pedidos com dados da Shopee (Income): pagamento liberado real <b>' + brlC(t.liberado) + '</b> · preço − descontos − taxas − devoluções calculado <b>' + brlC(t.preco + descComerciais + taxasShopee + devolucoes) + '</b> · diferença <b>' + brlC(mrCheck) + '</b>. Esta conferência é independente da Receita Bruta acima (que cobre todos os pedidos pagos, não só os com Minha Renda).') : '';
    var cobertura = mrCoberturaBox();
    return head + cascata + conf + cobertura;
  }
  // ---- Meta & Projeção (§7,10,11 do prompt de reorganização) ----
  function saveMrMetaCfg() { return putMany('settings', [{ id: 'mrMetaCfg', data: mrMetaCfg }]); }
  function mrMetaPeriodRange() {
    var now = new Date();
    if (mrMetaCfg.periodMode === 'proximo_mes') { var f = new Date(now.getFullYear(), now.getMonth() + 1, 1); var t2 = new Date(now.getFullYear(), now.getMonth() + 2, 1); return { from: f, to: t2 }; }
    if (mrMetaCfg.periodMode === 'custom' && mrMetaCfg.customFrom && mrMetaCfg.customTo) return { from: new Date(mrMetaCfg.customFrom + 'T00:00:00'), to: new Date(mrMetaCfg.customTo + 'T23:59:59') };
    return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: new Date(now.getFullYear(), now.getMonth() + 1, 1) };
  }
  // Lucro por pedido: usa Minha Renda quando cobre o pedido (mais preciso, líquido Shopee real);
  // senão cai para o resultado estimado do módulo Pedidos. Nunca soma os dois (evita dupla contagem).
  function mrOrderProfitEngine() {
    var mr = mrEngine(); var mrByOrder = {}; mr.orders.forEach(function (r) { mrByOrder[r.orderId] = r; });
    return function (o) {
      var mrRow = mrByOrder[o.id]; var f = orderFinance(o); var custoProdC = f.costPending ? null : Math.round((f.productCostTotal || 0) * 100);
      if (custoProdC == null) return { known: false };
      if (mrRow) { var taxasSomaC = mrRow.comissao + mrRow.servico + mrRow.transacao + mrRow.freteParceiro + mrRow.descontoFrete + mrRow.envioReverso + mrRow.cupom + mrRow.pix + mrRow.reembolso + mrRow.afiliado; return { known: true, receita: mrRow.preco, lucro: mrRow.preco + taxasSomaC - custoProdC }; }
      return { known: true, receita: Math.round(f.revenue * 100), lucro: Math.round((f.estimatedResult || 0) * 100) };
    };
  }
  function mrMetaEngine() {
    var range = mrMetaPeriodRange(); var hoje = new Date();
    var profitOf = mrOrderProfitEngine();
    var list = orders.filter(function (o) { var d = o.createdAt ? new Date(o.createdAt) : null; return d && d >= range.from && d < range.to; });
    var realizado = 0, receitaTot = 0, nConhecido = 0, nPendenteCusto = 0;
    list.forEach(function (o) { var p = profitOf(o); if (p.known) { realizado += p.lucro; receitaTot += p.receita; nConhecido++; } else nPendenteCusto++; });
    var totalDiasMs = range.to - range.from; var totalDias = Math.max(1, Math.round(totalDiasMs / 864e5));
    var decorridosMs = Math.min(hoje - range.from, totalDiasMs); var diasDecorridos = Math.max(0, Math.round(decorridosMs / 864e5));
    var diasRestantes = Math.max(0, totalDias - diasDecorridos);
    var metaC = Math.round((mrMetaCfg.lucroAlvo || 0) * 100);
    var falta = metaC - realizado;
    var necessarioPorDia = diasRestantes > 0 ? Math.round(falta / diasRestantes) : falta;
    var ritmoEsperado = totalDias > 0 ? Math.round(metaC * diasDecorridos / totalDias) : 0;
    var ritmoDiffPct = ritmoEsperado ? r2((realizado - ritmoEsperado) / Math.abs(ritmoEsperado) * 100) : 0;
    var ritmoStatus = realizado >= ritmoEsperado * 1.02 ? 'ACIMA' : realizado >= ritmoEsperado * 0.98 ? 'NO_RITMO' : 'ABAIXO';
    var projecao = diasDecorridos > 0 ? Math.round(realizado / diasDecorridos * totalDias) : realizado;
    var projStatus = metaC > 0 ? (projecao >= metaC ? 'ACIMA' : projecao >= metaC * 0.95 ? 'NO_RITMO' : 'ABAIXO') : 'SEM_META';
    var margemMedia = receitaTot > 0 ? realizado / receitaTot : 0;
    var ticketMedio = nConhecido ? Math.round(receitaTot / nConhecido) : 0;
    var faturamentoNecessario = margemMedia > 0 ? Math.round(falta / margemMedia) : null;
    var pedidosNecessarios = faturamentoNecessario != null && ticketMedio > 0 ? Math.ceil(faturamentoNecessario / ticketMedio) : null;
    // §32: não fingir precisão — cobertura real de pedidos com custo cadastrado no período da meta.
    var coveragePct = list.length ? r2(nConhecido / list.length * 100) : 0;
    // §35: ritmo diário (médio já realizado) e necessidade diária a partir de hoje.
    var vendaMediaDiaria = diasDecorridos > 0 ? Math.round(receitaTot / diasDecorridos) : 0;
    var lucroMedioDiario = diasDecorridos > 0 ? Math.round(realizado / diasDecorridos) : 0;
    var vendaNecessariaPorDia = (faturamentoNecessario != null && diasRestantes > 0) ? Math.round(faturamentoNecessario / diasRestantes) : null;
    // série diária acumulada (para o gráfico meta × realizado × projeção — §38)
    var byDay = {}; list.forEach(function (o) { var p = profitOf(o); if (!p.known) return; var k = o.createdAt.slice(0, 10); byDay[k] = (byDay[k] || 0) + p.lucro; });
    var days = []; for (var i = 0; i < totalDias; i++) { var dt = new Date(range.from.getTime() + i * 864e5); days.push(dt.toISOString().slice(0, 10)); }
    var acumRealizado = 0; var metaDiaria = totalDias ? metaC / totalDias : 0; var ritmoDiario = diasDecorridos > 0 ? realizado / diasDecorridos : 0;
    var serie = days.map(function (k, i) {
      var b = null; if (i < diasDecorridos) { acumRealizado += (byDay[k] || 0); b = acumRealizado; }
      var c = (diasDecorridos > 0 && i >= diasDecorridos - 1) ? Math.round(ritmoDiario * (i + 1)) : null;
      // svgWalletLine formata os rótulos do eixo Y com brl() (reais) — a série vem em centavos
      // (convenção da Minha Renda), então convertemos aqui para não inflar o eixo em 100x.
      return { label: monthDayLabel(k), a: (metaDiaria * (i + 1)) / 100, b: b == null ? null : b / 100, c: c == null ? null : c / 100 };
    });
    return { range: range, totalDias: totalDias, diasDecorridos: diasDecorridos, diasRestantes: diasRestantes, metaC: metaC, realizado: realizado, falta: falta, necessarioPorDia: necessarioPorDia, ritmoEsperado: ritmoEsperado, ritmoDiffPct: ritmoDiffPct, ritmoStatus: ritmoStatus, projecao: projecao, projStatus: projStatus, margemMedia: margemMedia, ticketMedio: ticketMedio, faturamentoNecessario: faturamentoNecessario, pedidosNecessarios: pedidosNecessarios, nConhecido: nConhecido, nPendenteCusto: nPendenteCusto, coveragePct: coveragePct, vendaMediaDiaria: vendaMediaDiaria, lucroMedioDiario: lucroMedioDiario, vendaNecessariaPorDia: vendaNecessariaPorDia, serie: serie };
  }
  function mrMeta() {
    var head = secHead('MINHA RENDA · META & PROJEÇÃO', 'Quanto falta para a meta?', 'Cálculo determinístico sobre os pedidos do período — lucro usa Minha Renda quando cobre o pedido, senão o estimado de Pedidos. Nunca soma os dois.');
    // ---- Modo planejamento (§30-33): ainda não "gerada" — o valor/período pode mudar livremente.
    if (!mrMetaCfg.gerada) {
      var cfgBox = '<div class="panel"><div class="ph"><h3>Nova meta</h3></div><div class="pb"><div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">' +
        '<div><label class="fld">Quero lucrar (R$)</label><input class="input sm" id="metaval" value="' + (mrMetaCfg.lucroAlvo || '') + '" style="width:160px" placeholder="ex.: 100000"></div>' +
        '<div><label class="fld">Período</label><select class="select sm" id="metaperiod"><option value="mes_atual"' + (mrMetaCfg.periodMode === 'mes_atual' ? ' selected' : '') + '>Mês atual</option><option value="proximo_mes"' + (mrMetaCfg.periodMode === 'proximo_mes' ? ' selected' : '') + '>Próximo mês</option><option value="custom"' + (mrMetaCfg.periodMode === 'custom' ? ' selected' : '') + '>Personalizado</option></select></div>' +
        (mrMetaCfg.periodMode === 'custom' ? '<div><label class="fld">De</label><input class="input sm" type="date" id="metafrom" value="' + esc(mrMetaCfg.customFrom || '') + '"></div><div><label class="fld">Até</label><input class="input sm" type="date" id="metato" value="' + esc(mrMetaCfg.customTo || '') + '"></div>' : '') +
        '<div><label class="fld">Nome (opcional)</label><input class="input sm" id="metanome" style="width:180px" placeholder="ex.: Meta de agosto"></div>' +
        '<button class="btn-sm" id="metacalc">Calcular</button></div></div></div>';
      if (!mrMetaCfg.lucroAlvo) return head + cfgBox + emptyBox('Informe quanto quer lucrar para ver o cálculo de faturamento necessário.');
      var mp = mrMetaEngine();
      var covWarn = mp.coveragePct < 100 ? callout('warn', '⚠️ Projeção parcial — existem pedidos sem custo cadastrado', pct(mp.coveragePct) + ' das vendas do período possuem custo completo. O cálculo abaixo usa só os pedidos com custo conhecido — não finge precisão sobre os demais.') : callout('green', '✓ Cobertura completa', pct(mp.coveragePct) + ' das vendas do período têm custo completo.');
      var preview = kstrip([
        { l: 'Margem líquida projetada (do período)', v: pct(r2(mp.margemMedia * 100)), cls: 'blue' },
        { l: 'Lucro já realizado no período', v: brlC(mp.realizado), cls: mp.realizado >= 0 ? 'green' : 'red' },
        { l: 'Falta para a meta', v: brlC(mp.falta), cls: mp.falta > 0 ? 'amber' : 'green' },
        { l: 'Faturamento estimado necessário', v: mp.faturamentoNecessario != null ? brlC(mp.faturamentoNecessario) : 'sem margem para calcular', cls: 'amber' },
      ]);
      var gerarBtn = '<div class="panel"><div class="pb"><button class="btn-sm primary" id="metagerar">Gerar meta</button> <span class="footnote">Congela o período (datas fixas) e passa a acompanhar as vendas reais automaticamente todo dia — sem precisar informar nada manualmente.</span></div></div>';
      return head + cfgBox + covWarn + preview + gerarBtn;
    }
    // ---- Modo acompanhamento (§34-39): meta gerada, datas fixas, alimentada por Pedidos/Minha Renda.
    var m = mrMetaEngine();
    var metaHead = '<div class="panel"><div class="pb" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px"><div><b>' + esc(mrMetaCfg.nome || 'Meta') + '</b> <span class="footnote">gerada em ' + dbr(mrMetaCfg.geradaEm) + ' · período ' + esc(mrMetaCfg.customFrom || '') + ' a ' + esc(mrMetaCfg.customTo || '') + '</span></div><button class="btn-sm" id="metanova">Nova meta</button></div></div>';
    var covWarn2 = m.coveragePct < 100 ? callout('warn', '⚠️ Acompanhamento parcial — existem pedidos sem custo cadastrado', pct(m.coveragePct) + ' das vendas do período têm custo completo (' + nn(m.nConhecido) + ' pedidos conhecidos' + (m.nPendenteCusto ? ' · ' + nn(m.nPendenteCusto) + ' pendentes' : '') + '). O realizado/ritmo abaixo usa só o que já tem custo cadastrado.') : '';
    var strip1 = kstrip([
      { l: 'Meta de lucro', v: brlC(m.metaC), cls: 'blue' },
      { l: 'Lucro já realizado', v: brlC(m.realizado), cls: m.realizado >= 0 ? 'green' : 'red', s: nn(m.nConhecido) + ' pedidos c/ custo conhecido' + (m.nPendenteCusto ? ' · ' + nn(m.nPendenteCusto) + ' com custo pendente' : '') },
      { l: 'Falta', v: brlC(m.falta), cls: m.falta > 0 ? 'amber' : 'green' },
      { l: 'Dias decorridos / restantes', v: nn(m.diasDecorridos) + ' / ' + nn(m.diasRestantes), cls: 'blue' },
      { l: 'Lucro necessário/dia', v: brlC(m.necessarioPorDia), cls: 'amber' },
      { l: 'Lucro necessário/semana', v: brlC(m.necessarioPorDia * 7), cls: 'amber' },
    ]);
    var stripDiaria = kstrip([
      { l: 'Venda média diária (realizada)', v: brlC(m.vendaMediaDiaria), cls: 'blue' },
      { l: 'Lucro médio diário (realizado)', v: brlC(m.lucroMedioDiario), cls: m.lucroMedioDiario >= 0 ? 'green' : 'red' },
      { l: 'Venda necessária por dia (p/ meta)', v: m.vendaNecessariaPorDia != null ? brlC(m.vendaNecessariaPorDia) : '—', cls: 'amber' },
    ]);
    var ritmoIcon = m.ritmoStatus === 'ACIMA' ? '🟢' : m.ritmoStatus === 'NO_RITMO' ? '🟡' : '🔴';
    var ritmoTxt = m.ritmoStatus === 'ACIMA' ? pct(Math.abs(m.ritmoDiffPct)) + ' acima do ritmo necessário.' : m.ritmoStatus === 'NO_RITMO' ? 'No ritmo esperado.' : pct(Math.abs(m.ritmoDiffPct)) + ' abaixo da velocidade necessária.';
    var ritmoBox = callout(m.ritmoStatus === 'ABAIXO' ? 'warn' : 'green', ritmoIcon + ' Ritmo da meta', 'Meta proporcional até hoje: <b>' + brlC(m.ritmoEsperado) + '</b> · Realizado: <b>' + brlC(m.realizado) + '</b> · ' + ritmoTxt);
    var projIcon = m.projStatus === 'ACIMA' ? '🟢' : m.projStatus === 'NO_RITMO' ? '🟡' : '🔴';
    var projBox = callout(m.projStatus === 'ABAIXO' ? 'warn' : 'green', projIcon + ' Projeção de fechamento (mantendo o ritmo atual)', 'Lucro projetado: <b>' + brlC(m.projecao) + '</b> · Meta: <b>' + brlC(m.metaC) + '</b> · Diferença projetada: <b>' + brlC(m.projecao - m.metaC) + '</b>');
    var strip2 = kstrip([
      { l: 'Margem média realizada (atual)', v: pct(r2(m.margemMedia * 100)), cls: 'blue' },
      { l: 'Ticket médio', v: brlC(m.ticketMedio), cls: 'blue' },
      { l: 'Faturamento necessário (com margem atual)', v: m.faturamentoNecessario != null ? brlC(m.faturamentoNecessario) : 'sem margem para calcular', cls: 'amber' },
      { l: 'Pedidos necessários', v: m.pedidosNecessarios != null ? nn(m.pedidosNecessarios) : '—', cls: 'amber' },
    ]);
    // §39: a margem usada na criação da meta é preservada — se a margem real mudar durante o
    // período, mostramos as duas leituras lado a lado, sem alterar a meta original silenciosamente.
    var margemDrift = '';
    if (mrMetaCfg.margemNaCriacao != null) {
      var margemCriacaoPct = r2(mrMetaCfg.margemNaCriacao * 100), margemAtualPct = r2(m.margemMedia * 100);
      var mudou = Math.abs(margemCriacaoPct - margemAtualPct) >= 0.5;
      margemDrift = mudou ? callout('warn', '⚠ A margem mudou desde a criação da meta', 'Na criação: margem de <b>' + pct(margemCriacaoPct) + '</b> → faturamento necessário estimado em <b>' + (mrMetaCfg.faturamentoNecessarioNaCriacao != null ? brlC(mrMetaCfg.faturamentoNecessarioNaCriacao) : '—') + '</b>. Com a margem atual de <b>' + pct(margemAtualPct) + '</b>, o faturamento necessário agora é <b>' + (m.faturamentoNecessario != null ? brlC(m.faturamentoNecessario) : 'sem margem para calcular') + '</b>. A meta de lucro (' + brlC(m.metaC) + ') não muda — só a estimativa de quanto faturar para chegar lá.') : callout('green', '✓ Margem estável desde a criação', 'Margem na criação: ' + pct(margemCriacaoPct) + ' · margem atual: ' + pct(margemAtualPct) + '.');
    }
    var chart = m.serie.length > 1 ? chartCard('Meta acumulada × Realizado acumulado × Projeção', legendSwatch([['Meta acumulada', '#2b4bd6'], ['Realizado acumulado', '#0f9d6b'], ['Projeção (ritmo atual)', '#8a5cf6']]), svgWalletLine(m.serie, { two: true, three: true })) : '';
    // Sugestões automáticas de SKU (§19-20): só leitura, classificação sobre dados já calculados.
    // Explicitamente SEM simulador — nenhum ajuste manual de mix, nenhuma projeção "e se".
    var skuList = mrPeriodEngine(mrMetaPeriodRange()).skuList.filter(function (x) { return x.lucroN > 0; });
    var topLucro = skuList.slice().sort(function (a, b) { return b.lucro - a.lucro; }).slice(0, 5);
    var topMargem = skuList.filter(function (x) { return x.lucro > 0 && x.margem != null; }).sort(function (a, b) { return b.margem - a.margem; }).slice(0, 5);
    var negativos = skuList.filter(function (x) { return x.lucro < 0; }).sort(function (a, b) { return a.lucro - b.lucro; }).slice(0, 5);
    var skuCol = function (title, items, fmt) { if (!items.length) return ''; return '<div class="panel"><div class="ph"><h3>' + esc(title) + '</h3></div><div class="table-wrap"><table class="report"><thead><tr><th>SKU</th><th>Produto</th><th>' + fmt.h + '</th></tr></thead><tbody>' + items.map(function (x) { return '<tr><td class="mono">' + esc(x.sku) + '</td><td class="cell-text">' + esc((x.produto || '—').slice(0, 26)) + '</td><td class="nowrap ' + fmt.cls(x) + '">' + fmt.v(x) + '</td></tr>'; }).join('') + '</tbody></table></div></div>'; };
    var sug = skuList.length ? '<div class="split2">' +
      skuCol('SKUs que mais ajudam a bater a meta (maior lucro)', topLucro, { h: 'Lucro', v: function (x) { return brlC(x.lucro); }, cls: function () { return 'pos'; } }) +
      skuCol('SKUs com melhor margem para priorizar', topMargem, { h: 'Margem', v: function (x) { return pct(x.margem); }, cls: function () { return 'pos'; } }) +
      '</div>' + skuCol('Produtos negativos — não escalar', negativos, { h: 'Resultado', v: function (x) { return brlC(x.lucro); }, cls: function () { return 'neg'; } }) +
      callout('', 'Sem simulador de mix', 'Estas listas só classificam SKUs já vendidos no período da meta — não há ajuste manual de volume nem projeção "e se eu vender mais/menos". Para o detalhamento completo, use a aba Produtos e SKUs.') : '';
    return head + metaHead + covWarn2 + strip1 + stripDiaria + ritmoBox + projBox + strip2 + margemDrift + chart + sug;
  }
  function bindMrMeta() {
    var mp2 = document.getElementById('metaperiod'); if (mp2) mp2.onchange = function () { mrMetaCfg.periodMode = mp2.value; render(); };
    var mc = document.getElementById('metacalc'); if (mc) mc.onclick = function () {
      var v = document.getElementById('metaval').value; mrMetaCfg.lucroAlvo = v ? parseFloat(v.replace(/\./g, '').replace(',', '.')) || 0 : 0;
      var pm = document.getElementById('metaperiod'); if (pm) mrMetaCfg.periodMode = pm.value;
      var mf = document.getElementById('metafrom'), mt = document.getElementById('metato'); if (mf) mrMetaCfg.customFrom = mf.value || null; if (mt) mrMetaCfg.customTo = mt.value || null;
      render();
    };
    var mg = document.getElementById('metagerar'); if (mg) mg.onclick = function () {
      var mv = document.getElementById('metaval'); if (mv) mrMetaCfg.lucroAlvo = mv.value ? parseFloat(mv.value.replace(/\./g, '').replace(',', '.')) || 0 : 0;
      if (!mrMetaCfg.lucroAlvo) { toast('Informe uma meta', 'Preencha "Quero lucrar (R$)" antes de gerar.', true); return; }
      var eng = mrMetaEngine(); var range = eng.range;
      mrMetaCfg.customFrom = range.from.toISOString().slice(0, 10);
      mrMetaCfg.customTo = new Date(range.to.getTime() - 864e5).toISOString().slice(0, 10);
      mrMetaCfg.periodMode = 'custom';
      mrMetaCfg.gerada = true;
      mrMetaCfg.geradaEm = new Date().toISOString();
      mrMetaCfg.margemNaCriacao = eng.margemMedia;
      mrMetaCfg.faturamentoNecessarioNaCriacao = eng.faturamentoNecessario;
      var nomeInp = document.getElementById('metanome');
      mrMetaCfg.nome = (nomeInp && nomeInp.value.trim()) || ('Meta ' + mrMetaCfg.customFrom + ' a ' + mrMetaCfg.customTo);
      saveMrMetaCfg().then(function () { render(); toast('Meta gerada', mrMetaCfg.nome + ' — acompanhamento automático ativado'); });
    };
    var mn = document.getElementById('metanova'); if (mn) mn.onclick = function () {
      if (!confirm('Encerrar esta meta e planejar uma nova? O histórico desta meta não fica salvo.')) return;
      mrMetaCfg = { lucroAlvo: 0, periodMode: 'mes_atual', customFrom: null, customTo: null, gerada: false, nome: '', geradaEm: null, margemNaCriacao: null, faturamentoNecessarioNaCriacao: null };
      saveMrMetaCfg().then(function () { render(); });
    };
  }
  function mrFrete() {
    var e = mrEngine(); var head = secHead('MINHA RENDA · FRETE & DIVERGÊNCIAS', 'Frete cobrado acima do esperado', 'Diferença entre frete real e esperado, por pedido e por SKU. Não é automaticamente "erro da Shopee" — classifique cada caso.');
    if (!mrShip.length) return head + emptyBox('Sem divergências de frete importadas.');
    var s = e.shipTot;
    var top3 = e.skuList.slice(0, 3).reduce(function (a, x) { return a + x.diff; }, 0); var conc = s.diff ? r2(top3 / s.diff * 100) : 0;
    var strip = kstrip([
      { l: 'Pedidos', v: nn(s.n), cls: 'blue' },
      { l: 'Frete esperado', v: brlC(s.esperado), cls: 'blue' },
      { l: 'Frete real', v: brlC(s.real), cls: 'amber' },
      { l: 'Diferença', v: brlC(s.diff), cls: 'red' },
      { l: 'Concentração Top 3 SKUs', v: pct(conc), cls: 'amber', s: brlC(top3) },
    ]);
    var alert = conc >= 50 ? callout('warn', 'Concentração detectada', '3 SKUs concentram <b>' + pct(conc) + '</b> das divergências de frete (' + brlC(top3) + ' de ' + brlC(s.diff) + ').') : '';
    // motivos
    var mot = {}; mrShip.forEach(function (x) { var k = /peso|dimens/i.test(x.motivo) ? 'Peso/dimensões' : /transportadora|ajuste/i.test(x.motivo) ? 'Ajuste da transportadora' : 'Outro'; var g = mot[k] = mot[k] || { k: k, n: 0, v: 0 }; g.n++; g.v += (x.real - x.esperado); });
    var motRows = Object.values(mot).map(function (m2) { return '<tr><td>' + esc(m2.k) + '</td><td>' + nn(m2.n) + '</td><td class="nowrap">' + brlC(m2.v) + '</td></tr>'; }).join('');
    var skuRows = e.skuList.map(function (x) { return '<tr class="rowlink" data-mrsku="' + esc(x.sku) + '"><td class="mono">' + esc(x.sku) + (x.multi ? ' <span class="tag warn">multi-sku</span>' : '') + '</td><td class="cell-text">' + esc((x.produto || '—').slice(0, 34)) + '</td><td>' + nn(x.n) + '</td><td class="nowrap">' + brlC(x.esperado) + '</td><td class="nowrap">' + brlC(x.real) + '</td><td class="nowrap neg"><b>' + brlC(x.diff) + '</b></td><td>' + pct(s.diff ? r2(x.diff / s.diff * 100) : 0) + '</td></tr>'; }).join('');
    return head + strip + alert +
      '<div class="split2"><div class="panel"><div class="ph"><h3>Motivos (da própria Shopee)</h3></div><div class="table-wrap"><table class="report"><thead><tr><th>Motivo</th><th>Pedidos</th><th>Diferença</th></tr></thead><tbody>' + motRows + '</tbody></table></div></div><div class="panel"><div class="ph"><h3>Resumo</h3></div><div class="pb"><div class="fin-line"><span>Total de divergência</span><b class="neg">' + brlC(s.diff) + '</b></div><div class="fin-line"><span>Média por pedido</span><span>' + brlC(s.n ? Math.round(s.diff / s.n) : 0) + '</span></div></div></div></div>' +
      '<div class="panel"><div class="ph"><h3>Divergência por SKU (clique para ver pedidos)</h3></div><div class="table-wrap"><table class="report"><thead><tr><th>SKU</th><th>Produto</th><th>Pedidos</th><th>Esperado</th><th>Real</th><th>Diferença</th><th>% do total</th></tr></thead><tbody>' + skuRows + '</tbody></table></div></div>';
  }
  function bindMrFrete() { }
  function openMrSku(sku) {
    var e = mrEngine(); var orders2 = mrShip.filter(function (s) { var sk = e.skuByOrder[s.orderId]; return (sk && sk[0] ? sk[0].sku : '(sem sku)') === sku; });
    var d = document.createElement('div'); d.className = 'drawer'; var panel = document.createElement('div'); panel.className = 'drawer-panel'; panel.style.width = '760px'; panel.style.maxWidth = '97vw';
    d.appendChild(panel); d.onclick = function (ev) { if (ev.target === d) d.remove(); }; document.body.appendChild(d);
    var INV = { NAO_ANALISADO: 'Não analisado', VERIFICAR_CADASTRO: 'Verificar cadastro', PESO_INCORRETO: 'Peso incorreto', DIMENSAO_INCORRETA: 'Dimensão incorreta', AJUSTE_LEGITIMO: 'Ajuste legítimo transportadora', COBRANCA_INDEVIDA: 'Possível cobrança indevida', CONTESTACAO: 'Contestação aberta', AGUARDANDO_SHOPEE: 'Aguardando Shopee', REEMBOLSADO: 'Shopee reembolsou', NAO_RECUPERAVEL: 'Não recuperável', RESOLVIDO: 'Resolvido' };
    var rows = orders2.map(function (s) { return '<tr><td class="mono">' + esc(s.orderId) + '</td><td class="nowrap">' + brlC(s.esperado) + '</td><td class="nowrap">' + brlC(s.real) + '</td><td class="nowrap neg">' + brlC(s.real - s.esperado) + '</td><td><select class="select sm mrinv" data-oid="' + esc(s.orderId) + '">' + Object.keys(INV).map(function (k) { return '<option value="' + k + '"' + (s.invStatus === k ? ' selected' : '') + '>' + INV[k] + '</option>'; }).join('') + '</select></td></tr>'; }).join('');
    panel.innerHTML = '<div class="dh"><div><b>SKU ' + esc(sku) + '</b> · ' + nn(orders2.length) + ' pedidos com divergência</div><button class="x">&times;</button></div><div class="dbd"><div class="panel"><div class="table-wrap"><table class="report"><thead><tr><th>Pedido</th><th>Esperado</th><th>Real</th><th>Diferença</th><th>Investigação</th></tr></thead><tbody>' + rows + '</tbody></table></div></div><div class="footnote">A classificação de investigação é interna e preservada em novas importações.</div></div>';
    panel.querySelector('.x').onclick = function () { d.remove(); };
    panel.querySelectorAll('.mrinv').forEach(function (sel) { sel.onchange = function () { var rec = mrShip.find(function (x) { return x.id === sel.dataset.oid; }); if (rec) { rec.invStatus = sel.value; putMany('mrship', [rec]).then(function () { toast('Investigação atualizada', INV[sel.value]); }); } }; });
  }
  function openMrPedido(orderId) {
    var e = mrEngine(); var o = e.orders.find(function (x) { return x.orderId === orderId; }); if (!o) { toast('Não encontrado', orderId, true); return; }
    var d = document.createElement('div'); d.className = 'drawer'; var panel = document.createElement('div'); panel.className = 'drawer-panel'; panel.style.width = '620px'; panel.style.maxWidth = '96vw';
    d.appendChild(panel); d.onclick = function (ev) { if (ev.target === d) d.remove(); }; document.body.appendChild(d);
    var ord = orders.find(function (x) { return x.id === orderId; }); var oc = occ.find(function (x) { return !x.isDemo && x.orderId === orderId; }); var ship = mrShip.find(function (x) { return x.id === orderId; });
    var svc = mrSvc.filter(function (x) { return x.orderId === orderId; });
    panel.innerHTML = '<div class="dh"><div><b>Pedido ' + esc(orderId) + '</b> <span class="footnote">Extrato financeiro</span></div><button class="x">&times;</button></div><div class="dbd">' +
      '<div class="panel"><div class="ph"><h3>Renda (Income)</h3></div><div class="pb">' + kv('Preço do produto', brlC(o.preco)) + kv('Reembolso', brlC(o.reembolso)) + kv('PIX', brlC(o.pix)) + kv('Cupom', brlC(o.cupom)) + kv('Comissão', brlC(o.comissao)) + kv('Serviço', brlC(o.servico)) + kv('Afiliado', brlC(o.afiliado)) + kv('Frete parceiro', brlC(o.freteParceiro)) + kv('Pagamento liberado', brlC(o.liberado)) + '</div></div>' +
      (svc.length ? '<div class="panel"><div class="ph"><h3>Composição da taxa de serviço</h3></div><div class="pb">' + svc.map(function (v) { return kv('Afiliados vendedor', brlC(v.afiliadosVendedor)) + kv('Transação', brlC(v.transacao)) + kv('Por item vendido', brlC(v.porItem)); }).join('') + '</div></div>' : '') +
      (ship ? '<div class="panel"><div class="ph"><h3>Frete</h3></div><div class="pb">' + kv('Esperado', brlC(ship.esperado)) + kv('Real', brlC(ship.real)) + kv('Diferença', brlC(ship.real - ship.esperado)) + '</div></div>' : '') +
      (ord ? '<button class="btn-sm" data-goped="' + esc(orderId) + '">Abrir em Pedidos</button> ' : '') + (oc ? '<button class="btn-sm" data-godev="' + esc(oc.id) + '">Abrir em Devoluções</button>' : '') + '</div>';
    panel.querySelector('.x').onclick = function () { d.remove(); };
    var gp = panel.querySelector('[data-goped]'); if (gp) gp.onclick = function () { d.remove(); route = 'pedidos'; sub.pedidos = 'pedidos'; render(); };
    var gd = panel.querySelector('[data-godev]'); if (gd) gd.onclick = function () { var id2 = gd.dataset.godev; d.remove(); route = 'posvenda'; sub.posvenda = 'casos'; render(); setTimeout(function () { openFicha(id2); }, 60); };
  }
  var MR_TAXA_CATS = [['comissao', 'Comissão'], ['servico', 'Serviço'], ['transacao', 'Transação'], ['freteParceiro', 'Programa de frete'], ['descontoFrete', 'Ajuste de frete'], ['envioReverso', 'Envio reverso'], ['afiliado', 'Afiliados'], ['incentivoAcaoComercial', 'Ação comercial (incentivo)'], ['ajusteAcaoComercial', 'Ação comercial (ajuste)']];
  // Categorias reais de taxas Shopee, no período — cada linha traz pedidos afetados, média/pedido
  // e a variação contra o período anterior de mesma duração (§6 do prompt de alterações pontuais).
  function mrTaxasCategorias(pe, prevPe) {
    return MR_TAXA_CATS.map(function (c) {
      var valor = Math.abs(pe.t[c[0]]);
      var n = pe.rows.filter(function (r) { return r[c[0]] !== 0; }).length;
      var prevValor = prevPe ? Math.abs(prevPe.t[c[0]]) : null;
      return { key: c[0], label: c[1], valor: valor, n: n, media: n ? Math.round(valor / n) : 0, prevValor: prevValor };
    });
  }
  function mrTaxas() {
    var pe = mrPeriodEngine(); var t = pe.t; var head = secHead('MINHA RENDA · TAXAS SHOPEE', 'Detalhamento por categoria', 'Categorias reais das linhas Order do Income, no período selecionado. Nenhuma categoria é inventada — só aparece o que existe nos dados importados.');
    if (!t.nMR) return head + emptyBox('Nenhum pedido do período tem dados da Minha Renda (Income) para detalhar as taxas.');
    var prevR = mrPrevRange(); var prevPe = prevR ? mrPeriodEngine(prevR) : null;
    var cats = mrTaxasCategorias(pe, prevPe);
    var totalAbs = cats.reduce(function (s, c) { return s + c.valor; }, 0);
    var SORTS = { valor: function (a, b) { return b.valor - a.valor; }, crescimento: function (a, b) { var va = mrTrendPct(a.valor, a.prevValor) || -999, vb = mrTrendPct(b.valor, b.prevValor) || -999; return vb - va; }, percentual: function (a, b) { return (b.valor / (totalAbs || 1)) - (a.valor / (totalAbs || 1)); }, pedidos: function (a, b) { return b.n - a.n; } };
    var sorted = cats.slice().sort(SORTS[mrTaxasSort] || SORTS.valor);
    var strip = kstrip([
      { l: 'Total Taxas Shopee', v: brlC(totalAbs), cls: 'red', s: pct(t.preco ? r2(totalAbs / t.preco * 100) : 0) + ' da receita bruta' },
      { l: 'Comissão', v: brlC(Math.abs(t.comissao)), cls: 'red' },
      { l: 'Serviço', v: brlC(Math.abs(t.servico)), cls: 'red' },
      { l: 'Afiliados', v: brlC(Math.abs(t.afiliado)), cls: 'amber' },
    ]);
    var sortSel = '<select class="select sm" id="mrtaxsort"><option value="valor"' + (mrTaxasSort === 'valor' ? ' selected' : '') + '>Maior valor</option><option value="crescimento"' + (mrTaxasSort === 'crescimento' ? ' selected' : '') + '>Maior crescimento</option><option value="percentual"' + (mrTaxasSort === 'percentual' ? ' selected' : '') + '>Maior percentual</option><option value="pedidos"' + (mrTaxasSort === 'pedidos' ? ' selected' : '') + '>Mais pedidos afetados</option></select>';
    var rows = sorted.map(function (c) { var varPct = mrTrendPct(c.valor, c.prevValor); var arrow = mrTrendArrow(c.valor, c.prevValor); return '<tr class="rowlink" data-mrdrill="' + esc(c.key) + '" data-mrdrilllabel="' + esc(c.label) + '"><td>' + esc(c.label) + '</td><td class="nowrap"><b>' + brlC(c.valor) + '</b></td><td>' + pct(t.preco ? r2(c.valor / t.preco * 100) : 0) + '</td><td>' + pct(totalAbs ? r2(c.valor / totalAbs * 100) : 0) + '</td><td>' + nn(c.n) + '</td><td class="nowrap">' + brlC(c.media) + '</td><td class="nowrap">' + (c.prevValor == null ? '—' : brlC(c.prevValor)) + '</td><td class="nowrap ' + (arrow === '↑' ? 'neg' : arrow === '↓' ? 'pos' : '') + '">' + (varPct == null ? '—' : arrow + ' ' + (varPct >= 0 ? '+' : '') + pct(varPct)) + '</td></tr>'; }).join('');
    var table = '<div class="panel"><div class="ph"><h3>Categorias de taxas</h3>' + sortSel + '</div><div class="table-wrap"><table class="report"><thead><tr><th>Categoria</th><th>Valor</th><th>% Faturamento</th><th>% das Taxas</th><th>Pedidos afetados</th><th>Média/pedido</th><th>Período anterior</th><th>Variação</th></tr></thead><tbody>' + rows + '</tbody></table></div><div class="footnote" style="padding:8px 16px">Clique numa categoria para ver os lançamentos.</div></div>';
    var svcTot = { afil: 0, trans: 0, item: 0 }; mrSvc.forEach(function (v) { svcTot.afil += v.afiliadosVendedor; svcTot.trans += v.transacao; svcTot.item += v.porItem; });
    var svcBox = mrSvc.length ? callout('', 'Composição da taxa de serviço (Service Fee Details, histórico completo)', 'Componentes somam: taxa de serviço afiliados ' + brlC(svcTot.afil) + ' · transação ' + brlC(svcTot.trans) + ' · por item vendido ' + brlC(svcTot.item) + '. Estes explicam a taxa de serviço — não são somados por cima dela.') : '';
    var chart = chartCard('Composição das taxas no período', legendSwatch([['Valor', '#d13b3b']]), svgHBars(sorted.map(function (c) { return { label: c.label, value: c.valor / 100, color: '#d13b3b' }; }), { fmt: function (v) { return brl(v); } }));
    return head + strip + table + chart + svcBox;
  }
  function bindMrTaxas() { var s = document.getElementById('mrtaxsort'); if (s) s.onchange = function () { mrTaxasSort = s.value; render(); }; }
  function mrAjustes() {
    var head = secHead('MINHA RENDA · AJUSTES', 'Ajustes financeiros', 'Aba Adjustment. Um ajuste de hoje pode se referir a um pedido antigo — a data financeira do ajuste é separada da data do pedido.');
    if (!mrAdj.length) return head + emptyBox('Sem ajustes importados.');
    var tot = mrAdj.reduce(function (s, a) { return s + a.valor; }, 0); var pos = mrAdj.filter(function (a) { return a.valor > 0; }).reduce(function (s, a) { return s + a.valor; }, 0); var neg = mrAdj.filter(function (a) { return a.valor < 0; }).reduce(function (s, a) { return s + a.valor; }, 0);
    var strip = kstrip([{ l: 'Total de ajustes', v: brlC(tot), cls: tot < 0 ? 'red' : 'green' }, { l: 'Créditos', v: brlC(pos), cls: 'green' }, { l: 'Débitos', v: brlC(neg), cls: 'red' }, { l: 'Lançamentos', v: nn(mrAdj.length), cls: 'blue' }]);
    var rows = mrAdj.slice().sort(function (a, b) { return a.valor - b.valor; }).slice(0, 300).map(function (a) { return '<tr' + (a.orderId ? ' class="rowlink" data-mrped="' + esc(a.orderId) + '"' : '') + '><td class="mono">' + esc(a.orderId || '—') + '</td><td class="cell-text">' + esc(a.desc || '—') + '</td><td class="nowrap ' + (a.valor < 0 ? 'neg' : 'pos') + '"><b>' + brlC(a.valor) + '</b></td></tr>'; }).join('');
    return head + strip + '<div class="panel"><div class="table-wrap"><table class="report"><thead><tr><th>Pedido</th><th>Descrição (original Shopee)</th><th>Valor</th></tr></thead><tbody>' + rows + '</tbody></table></div></div>';
  }
  // ---- Categorias financeiras (§7 do prompt de alterações pontuais) ----
  // Agrupamento em 6 blocos, só com o que existe nos dados reais do período — nenhuma categoria
  // sem valor é inventada; "Acelera/Antecipação" fica como link para o módulo (unidades e período
  // diferentes, não somamos por cima para não misturar bases).
  function mrCategorias() {
    var pe = mrPeriodEngine(); var t = pe.t; var head = secHead('MINHA RENDA · CATEGORIAS', 'Para onde foi o dinheiro, por grupo', 'RECEITAS/TAXAS/COMERCIAL/PÓS-VENDA vêm das linhas Order do Income (só pedidos pagos com Minha Renda localizada); CUSTOS INTERNOS vem direto de Pedidos×Produtos, cobertura parcial por item. Grupos com valor zero não aparecem.');
    if (!t.nMR && pe.custoItemsKnown === 0) return head + emptyBox('Nenhum pedido pago do período tem dados da Minha Renda (Income) nem custo de produto cadastrado para categorizar.');
    function grp(title, items) {
      var rows = items.filter(function (it) { return it[1] !== 0; }).map(function (it) { var drillAttr = it[2] ? ' rowlink" data-mrdrill="' + esc(it[2]) + '" data-mrdrilllabel="' + esc(it[0]) : ''; return '<div class="fin-line' + drillAttr + '"><span>' + esc(it[0]) + '</span><b class="' + (it[1] < 0 ? 'neg' : 'pos') + '">' + brlC(it[1]) + '</b></div>'; }).join('');
      var tot = items.reduce(function (s, it) { return s + it[1]; }, 0);
      if (!rows) return '';
      return '<div class="panel"><div class="ph"><h3>' + esc(title) + '</h3><b class="' + (tot < 0 ? 'neg' : 'pos') + '">' + brlC(tot) + '</b></div><div class="pb">' + rows + '</div></div>';
    }
    var receitas = grp('RECEITAS', [['Vendas (preço do produto)', t.preco, 'preco'], ['Desconto de frete recebido da Shopee', t.descontoFrete > 0 ? t.descontoFrete : 0, 'descontoFrete']]);
    var taxas = grp('TAXAS SHOPEE', [['Comissão', t.comissao, 'comissao'], ['Serviço', t.servico, 'servico'], ['Transação', t.transacao, 'transacao'], ['Ação comercial (incentivo)', t.incentivoAcaoComercial, 'incentivoAcaoComercial'], ['Ação comercial (ajuste)', t.ajusteAcaoComercial, 'ajusteAcaoComercial'], ['Programa de frete (frete parceiro)', t.freteParceiro, 'freteParceiro'], ['Ajuste de frete (quando custo)', t.descontoFrete < 0 ? t.descontoFrete : 0, 'descontoFrete']]);
    var comercial = grp('COMERCIAL', [['Afiliados', t.afiliado, 'afiliado'], ['Cupom', t.cupom, 'cupom']]);
    var posVenda = grp('PÓS-VENDA', [['Devoluções/Reembolso', t.reembolso, 'reembolso'], ['PIX', t.pix, 'pix'], ['Envio reverso', t.envioReverso, 'envioReverso']]);
    var financeiro = grp('FINANCEIRO', [['Ajustes (Adjustment, total importado)', pe.adjTot, 'adjustes']]);
    var financeiroNote = callout('', 'Shopee Acelera (antecipação)', 'O custo de antecipação tem base e período próprios no módulo <b>Shopee Acelera</b> — não é somado aqui para não misturar unidades/base de cálculo diferentes. <button class="btn-sm" data-golink="acelera">Abrir Shopee Acelera</button>');
    var custos = pe.custoItemsKnown > 0 ? grp('CUSTOS INTERNOS' + (pe.custoCoveragePct < 100 ? ' (parcial — ' + pct(pe.custoCoveragePct) + ' dos itens)' : ''), [['Custo dos produtos', pe.custoProd, 'custoProdutos']]) : callout('warn', 'CUSTOS INTERNOS — Custo dos produtos não disponível', 'Motivo: nenhum custo de produto foi encontrado para os pedidos pagos deste período — não é R$ 0, é "sem dado".');
    var custosNote = callout('', 'Custos fixos/internos', 'Sem fonte de dados no sistema hoje (aluguel, folha, etc.) — não disponível, não é R$ 0.');
    return head + receitas + taxas + comercial + posVenda + financeiro + financeiroNote + custos + custosNote;
  }
  // Rentabilidade por SKU: lucro/margem usam o mesmo motor da Ficha 360 e do Meta & Projeção
  // (mrOrderProfitEngine) — nunca uma segunda fórmula divergente. Unidades vêm de Pedidos
  // (quantidade real vendida); devolução vem do módulo Devoluções, ligada por pedido+SKU.
  // O "SKU" do Income é o ID numérico interno da Shopee; o "SKU" de Pedidos/Devoluções é a
  // referência do próprio vendedor — são identificadores DIFERENTES, não o mesmo campo. Antes de
  // cruzar unidades/devolução por SKU, verificamos se os dois conjuntos realmente se sobrepõem;
  // se não, declaramos "não disponível" em vez de mostrar zero (nunca inventar vínculo).
  function mrSkuCrossCheck() {
    var e = mrEngine(); var mrSkus = {}; e.skuByOrder && Object.keys(e.skuByOrder).forEach(function (oid) { (e.skuByOrder[oid] || []).forEach(function (r) { if (r.sku) mrSkus[r.sku] = 1; }); });
    var pedSkus = {}; orders.forEach(function (o) { o.items.forEach(function (it) { if (it.sku) pedSkus[it.sku] = 1; }); });
    var mrList = Object.keys(mrSkus); if (!mrList.length) return { reliable: false, overlapPct: 0 };
    var matched = mrList.filter(function (s) { return pedSkus[s]; }).length;
    var overlapPct = r2(matched / mrList.length * 100);
    return { reliable: overlapPct >= 5, overlapPct: overlapPct };
  }
  function mrSkuRentabilidade() {
    var e = mrEngine(); var profitOf = mrOrderProfitEngine(); var cross = mrSkuCrossCheck();
    var bySku = {};
    e.orders.forEach(function (o) {
      var sk = e.skuByOrder[o.orderId]; var key = sk && sk[0] ? sk[0].sku : '(sem sku)'; var prod = sk && sk[0] ? sk[0].produto : '';
      var g = bySku[key] = bySku[key] || { sku: key, produto: prod, n: 0, liberado: 0, preco: 0, lucro: 0, lucroN: 0, pendN: 0, units: 0, devN: 0, devLoss: 0, multi: sk && sk.length > 1 };
      g.n++; g.liberado += o.liberado; g.preco += o.preco;
      var ord = orders.find(function (x) { return x.id === o.orderId; });
      if (ord) { var p = profitOf(ord); if (p.known) { g.lucro += p.lucro; g.lucroN++; } else g.pendN++; if (cross.reliable) ord.items.forEach(function (it) { if (it.sku === key) g.units += it.qty; }); }
      else g.pendN++;
    });
    if (cross.reliable) occ.forEach(function (o) { if (o.isDemo || !o.orderId) return; (o.items || []).forEach(function (it) { if (!it.sku) return; var g = bySku[it.sku]; if (!g) return; g.devN++; g.devLoss += occEffectiveLoss(o); }); });
    var list = Object.values(bySku).map(function (g) {
      g.margem = (g.lucroN && g.preco) ? r2(g.lucro / g.preco * 100) : null;
      g.lucroUn = (cross.reliable && g.units && g.lucroN) ? Math.round(g.lucro / g.units) : null;
      g.units = cross.reliable ? g.units : null;
      g.taxaDevol = cross.reliable && g.n ? r2(g.devN / g.n * 100) : null;
      g.devLoss = cross.reliable ? r2(g.devLoss) : null;
      return g;
    });
    return list;
  }
  var MR_MARGEM_BANDS = [['negativa', 'Negativa', -Infinity, 0], ['0-5', '0% a 5%', 0, 5], ['5-10', '5% a 10%', 5, 10], ['10-20', '10% a 20%', 10, 20], ['20+', 'Acima de 20%', 20, Infinity]];
  function mrMargemBand(m) { if (m == null) return null; for (var i = 0; i < MR_MARGEM_BANDS.length; i++) { var b = MR_MARGEM_BANDS[i]; if (m >= b[2] && m < b[3]) return b[0]; } return '20+'; }
  function mrMotivoPrejuizo(x) {
    var comp = [['Comissão/Taxas Shopee', Math.abs(x.taxasShopee)], ['Afiliados', Math.abs(x.custoAfiliado)], ['Devoluções', x.devLoss || 0], ['Custo do produto', x.custoProduto]];
    comp.sort(function (a, b) { return b[1] - a[1]; });
    return comp[0][1] > 0 ? comp[0][0] : 'Preço de venda abaixo do custo';
  }
  // Filtros rápidos (§9-13): cada um combina um predicado + uma ordenação e recalcula tabela,
  // cards de destaque e o próprio conjunto de dados — não é só um "sort" visual.
  var MR_PROD_FILTERS = {
    todos: { label: 'Todos', pred: function () { return true; }, sort: function (a, b) { return b.preco - a.preco; } },
    comLucro: { label: 'Produtos com lucro', pred: function (x) { return x.lucroN > 0 && x.lucro > 0; }, sort: function (a, b) { return b.lucro - a.lucro; } },
    negativos: { label: 'Produtos negativos', pred: function (x) { return x.lucroN > 0 && x.lucro < 0; }, sort: function (a, b) { return a.lucro - b.lucro; } },
    baixaMargem: { label: 'Baixa margem', pred: function (x) { return x.margem != null && x.margem < mrProdCfg.margemMeta * 100; }, sort: function (a, b) { return (a.margem || 0) - (b.margem || 0); } },
    maiorLucro: { label: 'Maior lucro', pred: function (x) { return x.lucroN > 0; }, sort: function (a, b) { return b.lucro - a.lucro; } },
    maiorMargem: { label: 'Maior margem', pred: function (x) { return x.margem != null; }, sort: function (a, b) { return b.margem - a.margem; } },
    maiorFaturamento: { label: 'Maior faturamento', pred: function () { return true; }, sort: function (a, b) { return b.preco - a.preco; } },
    maiorVolume: { label: 'Maior volume', pred: function (x) { return x.units != null; }, sort: function (a, b) { return (b.units || 0) - (a.units || 0); } },
    maiorCustoShopee: { label: 'Maior custo Shopee', pred: function (x) { return x.taxasShopee !== 0; }, sort: function (a, b) { return Math.abs(b.taxasShopee) - Math.abs(a.taxasShopee); } },
    maiorPerdaDevol: { label: 'Maior perda c/ devolução', pred: function (x) { return x.devLoss != null && x.devLoss > 0; }, sort: function (a, b) { return b.devLoss - a.devLoss; } },
    maiorCustoAfiliado: { label: 'Maior custo de afiliado', pred: function (x) { return x.custoAfiliado !== 0; }, sort: function (a, b) { return Math.abs(b.custoAfiliado) - Math.abs(a.custoAfiliado); } },
  };
  // ---- Lucro e Prejuízo (§39): visão consolidada — detalhamento fica em Produtos e SKUs ----
  function mrLucroPrejuizo() {
    var pe = mrPeriodEngine(); var list = pe.skuList; var cross = pe.cross;
    var head = secHead('MINHA RENDA · LUCRO E PREJUÍZO', 'Onde o resultado do período vem de fato', 'Mesmo motor de lucro da Ficha 360/Meta. Para a tabela completa e filtros por SKU, use Produtos e SKUs.');
    var withProfit = list.filter(function (x) { return x.lucroN > 0; });
    if (!withProfit.length) return head + emptyBox('Nenhum SKU do período tem custo cadastrado em Produtos para calcular lucro/prejuízo.');
    var lucroTotal = withProfit.filter(function (x) { return x.lucro > 0; }).reduce(function (s, x) { return s + x.lucro; }, 0);
    var prejuizoTotal = withProfit.filter(function (x) { return x.lucro < 0; }).reduce(function (s, x) { return s + x.lucro; }, 0);
    var liquido = lucroTotal + prejuizoTotal;
    var comPrejuizo = withProfit.filter(function (x) { return x.lucro < 0; });
    var strip = kstrip([
      { l: 'Lucro bruto (SKUs positivos)', v: brlC(lucroTotal), cls: 'green' },
      { l: 'Prejuízo (SKUs negativos)', v: brlC(prejuizoTotal), cls: 'red' },
      { l: 'Resultado líquido', v: brlC(liquido), cls: liquido >= 0 ? 'green' : 'red' },
      { l: 'SKUs com prejuízo', v: nn(comPrejuizo.length) + ' de ' + nn(withProfit.length), cls: comPrejuizo.length ? 'amber' : 'green' },
    ]);
    var topLucro = withProfit.filter(function (x) { return x.lucro > 0; }).sort(function (a, b) { return b.lucro - a.lucro; }).slice(0, 10);
    var topPrejuizo = comPrejuizo.slice().sort(function (a, b) { return a.lucro - b.lucro; }).slice(0, 10);
    var tblLucro = '<div class="panel"><div class="ph"><h3>🟢 Maiores lucros</h3></div><div class="table-wrap"><table class="report"><thead><tr><th>SKU</th><th>Produto</th><th>Lucro</th><th>Margem</th></tr></thead><tbody>' + (topLucro.map(function (x) { return '<tr><td class="mono">' + esc(x.sku) + '</td><td class="cell-text">' + esc((x.produto || '—').slice(0, 28)) + '</td><td class="nowrap pos"><b>' + brlC(x.lucro) + '</b></td><td>' + (x.margem != null ? pct(x.margem) : '—') + '</td></tr>'; }).join('') || '<tr><td colspan="4" class="empty">—</td></tr>') + '</tbody></table></div></div>';
    var tblPrejuizo = '<div class="panel"><div class="ph"><h3>🔴 Maiores prejuízos</h3></div><div class="table-wrap"><table class="report"><thead><tr><th>SKU</th><th>Produto</th><th>Resultado</th><th>Margem</th><th>Principal motivo</th></tr></thead><tbody>' + (topPrejuizo.map(function (x) { return '<tr><td class="mono">' + esc(x.sku) + '</td><td class="cell-text">' + esc((x.produto || '—').slice(0, 24)) + '</td><td class="nowrap neg"><b>' + brlC(x.lucro) + '</b></td><td class="neg">' + (x.margem != null ? pct(x.margem) : '—') + '</td><td>' + esc(mrMotivoPrejuizo(x)) + '</td></tr>'; }).join('') || '<tr><td colspan="5" class="empty">Nenhum SKU com prejuízo no período. 🎉</td></tr>') + '</tbody></table></div></div>';
    var bands = MR_MARGEM_BANDS.map(function (b) { var items = withProfit.filter(function (x) { return mrMargemBand(x.margem) === b[0]; }); return { b: b, n: items.length, fat: items.reduce(function (s, x) { return s + x.preco; }, 0), lucro: items.reduce(function (s, x) { return s + x.lucro; }, 0) }; });
    var bandRows = bands.map(function (g) { return '<tr><td>' + esc(g.b[1]) + '</td><td>' + nn(g.n) + '</td><td class="nowrap">' + brlC(g.fat) + '</td><td class="nowrap ' + (g.lucro < 0 ? 'neg' : 'pos') + '">' + brlC(g.lucro) + '</td></tr>'; }).join('');
    var tblBandas = '<div class="panel"><div class="ph"><h3>Faixas de margem</h3></div><div class="table-wrap"><table class="report"><thead><tr><th>Faixa</th><th>SKUs</th><th>Faturamento</th><th>Lucro</th></tr></thead><tbody>' + bandRows + '</tbody></table></div></div>';
    var goProd = callout('', 'Quer ver todos os SKUs, com filtros?', '<button class="btn-sm" data-mrgo="produto">Abrir Produtos e SKUs</button>');
    return head + strip + tblLucro + tblPrejuizo + tblBandas + goProd;
  }
  function mrProduto() {
    var pe = mrPeriodEngine(); var list = pe.skuList; var cross = pe.cross;
    var head = secHead('MINHA RENDA · PRODUTOS E SKUS', 'Rentabilidade por SKU no período', 'Lucro e margem usam o mesmo motor da Ficha 360/Meta (custo de Produtos + taxas reais). Unidades e Família só aparecem quando o SKU do Income coincide de fato com o SKU de Pedidos/Produtos — "custo pendente" nunca é tratado como zero.');
    if (!list.length) return head + emptyBox('Sem pedidos no período para montar a rentabilidade por SKU.');
    var crossNote = !cross.reliable ? callout('warn', '⚠ Unidades, família e devolução por SKU não disponíveis', 'O "SKU" do Income é o ID numérico interno da Shopee; o SKU de Pedidos/Produtos é a referência do próprio vendedor — só ' + pct(cross.overlapPct) + ' coincidem neste conjunto de arquivos. Para não inventar vínculo, unidades, família, lucro/unidade e devolução por SKU ficam "não disponível". Lucro, margem e faturamento continuam corretos — usam o ID do <b>pedido</b>, igual em todas as fontes.') : '';
    var withProfit = list.filter(function (x) { return x.lucroN > 0; });
    var semCusto = list.length - withProfit.length;
    var lucroTotal = withProfit.reduce(function (s, x) { return s + Math.max(0, x.lucro); }, 0);
    var fkey = MR_PROD_FILTERS[mrProdFilter] ? mrProdFilter : 'todos'; var F = MR_PROD_FILTERS[fkey];
    var filtered = list.filter(F.pred).sort(F.sort);
    var chips = '<div style="display:flex;gap:6px;flex-wrap:wrap;margin:10px 0">' + Object.keys(MR_PROD_FILTERS).map(function (k) { return '<button class="btn-sm' + (k === fkey ? ' primary' : '') + '" data-mrprodf="' + k + '">' + esc(MR_PROD_FILTERS[k].label) + '</button>'; }).join('') + '</div>';
    var hi = function (label, x, extra) { return x ? '<div class="kc"><div class="kl">' + esc(label) + '</div><div class="kv" style="font-size:14px">' + esc((x.sku || '—')) + '</div><div class="ks">' + esc(extra) + '</div></div>' : ''; };
    var maisLucrativo = withProfit.slice().sort(function (a, b) { return b.lucro - a.lucro; })[0];
    var maiorMargemX = withProfit.filter(function (x) { return x.margem != null; }).sort(function (a, b) { return b.margem - a.margem; })[0];
    var maiorFat = list.slice().sort(function (a, b) { return b.preco - a.preco; })[0];
    var maiorVol = cross.reliable ? list.slice().sort(function (a, b) { return (b.units || 0) - (a.units || 0); })[0] : null;
    var maiorPerdaDevol = cross.reliable ? list.filter(function (x) { return x.devLoss > 0; }).sort(function (a, b) { return b.devLoss - a.devLoss; })[0] : null;
    var highlights = '<div class="kstrip">' + hi('SKU mais lucrativo', maisLucrativo, maisLucrativo ? brlC(maisLucrativo.lucro) : '') + hi('Maior margem', maiorMargemX, maiorMargemX ? pct(maiorMargemX.margem) : '') + hi('Maior faturamento', maiorFat, brlC(maiorFat ? maiorFat.preco : 0)) + hi('Maior volume', maiorVol, maiorVol ? nn(maiorVol.units) + ' un.' : '') + hi('Maior perda em devolução', maiorPerdaDevol, maiorPerdaDevol ? brlC(maiorPerdaDevol.devLoss) : '') + '</div>';
    var custoNote = semCusto ? callout('warn', nn(semCusto) + ' SKU(s) com custo pendente', 'Não entram nos rankings de lucro/margem — cadastre o custo em Produtos para liberá-los.') : '';
    var body;
    if (fkey === 'comLucro') {
      var rowsL = filtered.map(function (x) { var partic = lucroTotal > 0 ? r2(Math.max(0, x.lucro) / lucroTotal * 100) : 0; return '<tr><td class="mono">' + esc(x.sku) + '</td><td class="cell-text">' + esc((x.produto || '—').slice(0, 30)) + '</td><td class="nowrap">' + brlC(x.preco) + '</td><td class="nowrap pos"><b>' + brlC(x.lucro) + '</b></td><td>' + (x.margem != null ? pct(x.margem) : '—') + '</td><td class="nowrap">' + (x.lucroUn != null ? brlC(x.lucroUn) : '—') + '</td><td>' + pct(partic) + '</td></tr>'; }).join('');
      body = '<div class="panel"><div class="ph"><h3>Produtos com lucro</h3></div><div class="table-wrap"><table class="report"><thead><tr><th>SKU</th><th>Produto</th><th>Faturamento</th><th>Lucro</th><th>Margem</th><th>Lucro/un.</th><th>% do lucro total</th></tr></thead><tbody>' + (rowsL || '<tr><td colspan="7" class="empty">Nenhum SKU com lucro positivo no período.</td></tr>') + '</tbody></table></div></div>';
    } else if (fkey === 'negativos') {
      var rowsN = filtered.map(function (x) { return '<tr><td class="mono">' + esc(x.sku) + '</td><td class="cell-text">' + esc((x.produto || '—').slice(0, 24)) + '</td><td>' + (x.units != null ? nn(x.units) : '—') + '</td><td class="nowrap">' + brlC(x.preco) + '</td><td class="nowrap">' + (x.nMR ? brlC(x.liberado) : '—') + '</td><td class="nowrap">' + brlC(x.custoProduto) + '</td><td class="nowrap">' + brlC(Math.abs(x.taxasShopee)) + '</td><td class="nowrap">' + brlC(Math.abs(x.custoAfiliado)) + '</td><td class="nowrap">' + (x.devLoss != null ? brlC(x.devLoss) : '—') + '</td><td class="nowrap neg"><b>' + brlC(x.lucro) + '</b></td><td class="neg">' + (x.margem != null ? pct(x.margem) : '—') + '</td><td>' + esc(mrMotivoPrejuizo(x)) + '</td></tr>'; }).join('');
      body = '<div class="panel"><div class="ph"><h3>🔴 Produtos negativos</h3></div><div class="table-wrap"><table class="report"><thead><tr><th>SKU</th><th>Produto</th><th>Unid.</th><th>Faturamento</th><th>Receita líq.</th><th>Custo produto</th><th>Taxas Shopee</th><th>Afiliados</th><th>Devolução</th><th>Resultado</th><th>Margem</th><th>Principal motivo</th></tr></thead><tbody>' + (rowsN || '<tr><td colspan="12" class="empty">Nenhum SKU com prejuízo no período.</td></tr>') + '</tbody></table></div></div>';
    } else if (fkey === 'baixaMargem') {
      var bands = MR_MARGEM_BANDS.map(function (b) { var items = withProfit.filter(function (x) { return mrMargemBand(x.margem) === b[0]; }); return { b: b, n: items.length, fat: items.reduce(function (s, x) { return s + x.preco; }, 0) }; });
      var bandRows = bands.map(function (g) { return '<tr><td>' + esc(g.b[1]) + '</td><td>' + nn(g.n) + '</td><td class="nowrap">' + brlC(g.fat) + '</td></tr>'; }).join('');
      var rowsB = filtered.map(function (x) { return '<tr><td class="mono">' + esc(x.sku) + '</td><td class="cell-text">' + esc((x.produto || '—').slice(0, 30)) + '</td><td class="nowrap">' + brlC(x.preco) + '</td><td class="nowrap">' + brlC(x.lucro) + '</td><td>' + pct(x.margem) + '</td></tr>'; }).join('');
      body = '<div class="panel"><div class="ph"><h3>Faixas de margem</h3><span class="footnote" style="margin:0">meta configurada: ' + pct(r2(mrProdCfg.margemMeta * 100)) + '</span></div><div class="table-wrap"><table class="report"><thead><tr><th>Faixa</th><th>SKUs</th><th>Faturamento</th></tr></thead><tbody>' + bandRows + '</tbody></table></div></div>' +
        '<div class="panel"><div class="ph"><h3>🟠 Vende muito, sobra pouco (abaixo da meta de margem)</h3></div><div class="table-wrap"><table class="report"><thead><tr><th>SKU</th><th>Produto</th><th>Faturamento</th><th>Lucro</th><th>Margem</th></tr></thead><tbody>' + (rowsB || '<tr><td colspan="5" class="empty">Nenhum SKU abaixo da meta de margem.</td></tr>') + '</tbody></table></div></div>';
    } else {
      var rows4 = filtered.slice(0, 300).map(function (x) { return '<tr' + (x.lucroN === 0 ? ' style="background:#fff8ef"' : '') + '><td class="mono">' + esc(x.sku) + '</td><td class="cell-text">' + esc((x.produto || '—').slice(0, 22)) + '</td><td>' + (x.familia ? esc(x.familia) : '—') + '</td><td>' + (x.units != null ? nn(x.units) : '—') + '</td><td>' + nn(x.n) + '</td><td class="nowrap">' + brlC(x.preco) + '</td><td class="nowrap">' + (x.nMR ? brlC(x.liberado) : '—') + '</td><td class="nowrap">' + brlC(x.custoProduto) + '</td><td class="nowrap">' + brlC(Math.abs(x.taxasShopee)) + '</td><td class="nowrap">' + brlC(Math.abs(x.custoAfiliado)) + '</td><td class="nowrap">' + (x.devLoss != null ? brlC(x.devLoss) : '—') + '</td><td class="nowrap">' + (x.outrosMR != null ? brlC(x.outrosMR) : '—') + '</td><td class="nowrap ' + (x.lucroN === 0 ? '' : x.lucro < 0 ? 'neg' : 'pos') + '">' + (x.lucroN ? '<b>' + brlC(x.lucro) + '</b>' : '<span class="tag warn">custo pendente</span>') + '</td><td>' + (x.margem != null ? pct(x.margem) : '—') + '</td><td class="nowrap">' + (x.lucroUn != null ? brlC(x.lucroUn) : '—') + '</td><td>' + (x.taxaDevol != null ? pct(x.taxaDevol) : '—') + '</td></tr>'; }).join('');
      body = '<div class="panel"><div class="ph"><h3>Por SKU (' + esc(F.label) + ')</h3></div><div class="table-wrap"><table class="report"><thead><tr><th>SKU</th><th>Produto</th><th>Família</th><th>Unid.</th><th>Pedidos</th><th>Faturamento</th><th>Receita líq.</th><th>Custo produto</th><th>Taxas Shopee</th><th>Afiliados</th><th>Devolução</th><th>Outros</th><th>Lucro</th><th>Margem</th><th>Lucro/un.</th><th>Tx. devol.</th></tr></thead><tbody>' + (rows4 || '<tr><td colspan="16" class="empty">Nenhum SKU neste filtro.</td></tr>') + '</tbody></table></div></div>';
    }
    return head + crossNote + chips + highlights + custoNote + body;
  }
  function bindMrProduto() { app.querySelectorAll('[data-mrprodf]').forEach(function (b) { b.onclick = function () { mrProdFilter = b.dataset.mrprodf; render(); }; }); }
  function mrConciliacao() {
    var e = mrEngine(); var t = e.tot; var head = secHead('MINHA RENDA · CONCILIAÇÃO DA DECLARAÇÃO', 'XLSX × Declaração (PDF) — 100% opcional', 'A planilha Income (XLSX) é a única fonte do Minha Renda — esta aba só serve para uma conferência EXTRA e opcional contra a Declaração PDF da Shopee. Nenhum outro indicador do sistema depende deste PDF.');
    if (!mrPdf.length) return head + callout('', 'PDF não importado — e não é necessário', 'O Minha Renda funciona por completo só com o Income (XLSX). Envie o PDF da Declaração de Renda da Shopee aqui apenas se quiser uma conferência extra opcional. A leitura do PDF é feita no próprio navegador (sem enviar a lugar nenhum).');
    var pdf = mrPdf[0]; var d = pdf.decl;
    var xlsxPeriod = mrSummary && mrSummary.period ? (mrSummary.period.from + ' a ' + mrSummary.period.to) : '—';
    var periodMismatch = pdf.period && mrSummary && mrSummary.period && (pdf.period.indexOf('07') >= 0);
    var cmp = function (label, sys, decl) { if (decl == null) return '<tr><td>' + esc(label) + '</td><td class="nowrap">' + brlC(sys) + '</td><td class="nowrap">—</td><td><span class="tag neutral">sem no PDF</span></td></tr>'; var dif = sys - decl; var st = Math.abs(dif) <= 100 ? ['✅ Conciliado', 'ok'] : Math.abs(dif) <= Math.abs(decl) * 0.02 ? ['🟡 Pequena diferença', 'warn'] : ['🔴 Divergência', 'warn']; return '<tr><td>' + esc(label) + '</td><td class="nowrap">' + brlC(sys) + '</td><td class="nowrap">' + brlC(decl) + '</td><td class="nowrap ' + (Math.abs(dif) > 100 ? 'neg' : '') + '">' + brlC(dif) + ' <span class="tag ' + st[1] + '">' + st[0] + '</span></td></tr>'; };
    var note = periodMismatch ? callout('warn', '⚠ Períodos diferentes', 'O XLSX Income cobre <b>' + esc(xlsxPeriod) + '</b> e a Declaração PDF é de <b>' + esc(pdf.period || 'julho/2026') + '</b>. Como os períodos não coincidem, as diferenças abaixo são <b>esperadas</b> — não são erro. Para conciliar exatamente, importe o Income do mesmo mês da Declaração.') : '';
    var rows = cmp('Pagamento liberado', t.liberado, d.liberado) + cmp('Preço do produto', t.preco, d.produto) + cmp('Reembolso', -Math.abs(t.reembolso), d.reembolso) + cmp('PIX', -Math.abs(t.pix), d.pix) + cmp('Cupom', -Math.abs(t.cupom), d.cupom) + cmp('Comissão', -Math.abs(t.comissao), d.comissao) + cmp('Serviço', -Math.abs(t.servico), d.servico) + cmp('Afiliados', -Math.abs(t.afiliado), d.afiliados);
    return head + note + '<div class="panel"><div class="ph"><h3>Declaração Shopee (PDF) × Sistema (XLSX)</h3><span class="footnote" style="margin:0">PDF: ' + esc(pdf.fileName) + '</span></div><div class="table-wrap"><table class="report"><thead><tr><th>Componente</th><th>Sistema (XLSX)</th><th>Declaração (PDF)</th><th>Diferença</th></tr></thead><tbody>' + rows + '</tbody></table></div>' + (pdf.ok ? '' : '<div class="footnote" style="padding:0 16px 12px">⚠ Alguns campos do PDF não foram reconhecidos automaticamente (layout diferente). Os que foram lidos estão acima.</div>') + '</div>';
  }
  // §39: agrega o outros{} (colunas financeiras do Income sem destino ainda) de todas as linhas
  // Order — nunca descartado, sempre auditável (§46).
  function mrCamposNaoClassificados() {
    var e = mrEngine(); var agg = {};
    e.orders.forEach(function (o) { if (!o.outros) return; Object.keys(o.outros).forEach(function (k) { var g = agg[k] = agg[k] || { nome: k, soma: 0, n: 0 }; g.soma += o.outros[k]; g.n++; }); });
    return Object.values(agg).sort(function (a, b) { return Math.abs(b.soma) - Math.abs(a.soma); });
  }
  // §40: "o arquivo foi importado, mas os números chegaram ao dashboard?" — compara o total BRUTO
  // de todas as linhas Order do Income com o total que efetivamente aparece no dashboard (pedidos
  // pagos + Minha Renda cruzada por ID, todo o período). A diferença é esperada quando um pedido do
  // Income não tem correspondência em Pedidos, ou não tem data de pagamento — e fica declarada.
  function mrDiagnosticoIntegridade() {
    var e = mrEngine();
    var brutoPreco = 0, brutoLiberado = 0; e.orders.forEach(function (o) { brutoPreco += o.preco; brutoLiberado += o.liberado; });
    var peAll = mrPeriodEngine({});
    return { linhasLidas: mrRenda.length, pedidosUnicosIncome: e.orders.length, brutoPreco: brutoPreco, brutoLiberado: brutoLiberado, dashPreco: peAll.t.preco, dashLiberado: peAll.t.liberado, pedidosNoDash: peAll.t.nMR, diffPreco: brutoPreco - peAll.t.preco, diffLiberado: brutoLiberado - peAll.t.liberado };
  }
  function mrAuditoria() {
    var head = secHead('MINHA RENDA · AUDITORIA', 'Proveniência, mapa de campos e integridade', 'Cada número tem origem rastreável: arquivo, aba, tipo, pedido. A Declaração PDF é só uma conciliação opcional — nenhum indicador do Minha Renda depende dela.');
    var imps = batches.filter(function (b) { return b.module === 'Minha Renda'; });
    var impRows = imps.slice(0, 30).map(function (b) { return '<tr><td class="nowrap">' + new Date(b.createdAt).toLocaleString('pt-BR') + '</td><td class="cell-text">' + esc(b.filename) + '</td><td>' + nn(b.seen) + '</td><td>' + nn(b.novo) + '</td></tr>'; }).join('');
    var e = mrEngine();
    var counts = kstrip([{ l: 'Linhas Order', v: nn(e.orders.length), cls: 'blue' }, { l: 'Linhas SKU', v: nn(mrRenda.length - e.orders.length), cls: 'blue' }, { l: 'Divergências de frete', v: nn(mrShip.length), cls: 'amber' }, { l: 'Ajustes', v: nn(mrAdj.length), cls: 'amber' }, { l: 'Service Fee (linhas)', v: nn(mrSvc.length), cls: 'blue' }, { l: 'Declarações PDF (opcional)', v: nn(mrPdf.length), cls: 'green' }]);
    // §39 — Auditoria da planilha Income
    var pedidosUnicosIncome = {}; e.orders.forEach(function (o) { pedidosUnicosIncome[o.orderId] = 1; });
    var datas = e.orders.map(function (o) { return o.dataConclusao || o.dataCriacao; }).filter(Boolean).sort();
    var incomeAudit = mrSummary ? '<div class="panel"><div class="ph"><h3>Auditoria da planilha Income</h3></div><div class="pb">' +
      kv('Arquivo carregado', mrSummary.fileName || '—') + kv('Importado em', mrSummary.importedAt ? new Date(mrSummary.importedAt).toLocaleString('pt-BR') : '—') + kv('Linhas lidas (Order + Sku)', nn(mrRenda.length)) + kv('Pedidos únicos (linhas Order)', nn(Object.keys(pedidosUnicosIncome).length)) + kv('Período encontrado', datas.length ? (dbr(datas[0]) + ' a ' + dbr(datas[datas.length - 1])) : '—') + kv('Campos financeiros reconhecidos', nn(MR_FIELD_MAP.length) + ' mapeados por nome') +
      '</div></div>' : '';
    // §38 — mapa de campos
    var mapRows = MR_FIELD_MAP.map(function (f) { return '<tr><td class="cell-text">' + esc(f[0]) + '</td><td class="mono">' + esc(f[1]) + '</td><td class="cell-text">' + esc(f[2]) + '</td></tr>'; }).join('');
    var fieldMap = '<details class="panel" style="padding:0"><summary style="cursor:pointer;padding:12px 16px;font-weight:700">Mapa de campos — Income → sistema (' + nn(MR_FIELD_MAP.length) + ')</summary><div class="table-wrap"><table class="report"><thead><tr><th>Campo original (Income)</th><th>Campo normalizado</th><th>Usado em</th></tr></thead><tbody>' + mapRows + '</tbody></table></div></details>';
    // §46 — campos ainda não classificados
    var naoClass = mrCamposNaoClassificados();
    var naoClassBlock = naoClass.length ? '<div class="panel"><div class="ph"><h3>Campos ainda não classificados</h3><span class="footnote" style="margin:0">colunas financeiras do Income com valor real, ainda sem destino em nenhuma tela — não descartadas</span></div><div class="table-wrap"><table class="report"><thead><tr><th>Coluna original</th><th>Registros com valor</th><th>Soma</th></tr></thead><tbody>' + naoClass.map(function (c) { return '<tr><td class="cell-text">' + esc(c.nome) + '</td><td>' + nn(c.n) + '</td><td class="nowrap">' + brlC(c.soma) + '</td></tr>'; }).join('') + '</tbody></table></div></div>' : callout('green', '✓ Nenhuma coluna financeira sem classificação', 'Todas as colunas com valor real encontradas nesta planilha já têm um destino mapeado.');
    // §40 — diagnóstico de integridade
    var diag = e.orders.length ? mrDiagnosticoIntegridade() : null;
    var diagBlock = diag ? (function () {
      var okPreco = Math.abs(diag.diffPreco) <= diag.brutoPreco * 0.02 + 100; // tolerância: 2% + arredondamento
      return '<div class="panel"><div class="ph"><h3>Diagnóstico de integridade — o arquivo chegou ao dashboard?</h3></div><div class="pb">' +
        '<div class="fin-line"><span><b>Income (bruto, todas as linhas Order importadas)</b></span></div>' +
        kv('Linhas lidas', nn(diag.linhasLidas)) + kv('Pedidos únicos', nn(diag.pedidosUnicosIncome)) + kv('Preço do produto (bruto)', brlC(diag.brutoPreco)) + kv('Pagamento liberado (bruto)', brlC(diag.brutoLiberado)) +
        '<div class="fin-line" style="margin-top:8px"><span><b>Dashboard (todo o período — pedidos pagos cruzados com Minha Renda)</b></span></div>' +
        kv('Pedidos cruzados no dashboard', nn(diag.pedidosNoDash)) + kv('Preço do produto (usado no dashboard)', brlC(diag.dashPreco)) + kv('Pagamento liberado (usado no dashboard)', brlC(diag.dashLiberado)) +
        '</div></div>' +
        callout(okPreco ? 'green' : 'warn', okPreco ? '✓ Sem divergência relevante de processamento' : '🔴 Divergência de processamento', 'Diferença de Preço do produto: <b>' + brlC(diag.diffPreco) + '</b> · diferença de Pagamento Liberado: <b>' + brlC(diag.diffLiberado) + '</b>. ' + (okPreco ? 'Dentro da tolerância esperada.' : 'Motivo provável: pedidos do Income sem pedido correspondente em Pedidos, ou sem "Hora do pagamento do pedido" preenchida (não entram na base de pedidos pagos).'));
    })() : '';
    return head + counts + incomeAudit + diagBlock + fieldMap + naoClassBlock + '<div class="panel"><div class="ph"><h3>Importações</h3></div><div class="table-wrap"><table class="report"><thead><tr><th>Quando</th><th>Arquivo</th><th>Linhas</th><th>Novos</th></tr></thead><tbody>' + (impRows || '<tr><td colspan="4" class="empty">—</td></tr>') + '</tbody></table></div></div>';
  }

  // ---------- INTELIGÊNCIA ----------
  function renderIA() {
    app.innerHTML =
      '<div class="page-head"><div><h2>Inteligência</h2><p>Chat sobre os dados com <b>Preview</b> ao lado. Respostas auditáveis — a IA nunca inventa números nem calcula dinheiro.</p></div></div>' +
      '<div class="aicfg"><b>Como funciona:</b> as respostas abaixo são calculadas localmente a partir dos dados importados (evidências no Preview). No sistema completo (backend), a mesma camada aciona um provedor de LLM real — com credencial cifrada no servidor, <b>nunca no navegador</b> (§46) — para gerar a narrativa; os números permanecem sempre calculados a partir dos seus dados.</div>' +
      '<div class="split"><div class="chatbox"><div class="chatlog" id="clog"></div>' +
      '<div class="chips">' + ['Qual meu resultado estimado?', 'Quais SKUs estão sem custo?', 'Quais produtos vendem muito e lucram pouco?', 'Quais SKUs têm mais devoluções?', 'Qual a exposição financeira?'].map(function (c) { return '<span class="chip" data-q="' + esc(c) + '">' + esc(c) + '</span>'; }).join('') + '</div>' +
      '<div class="chatin"><input class="input" id="cin" placeholder="Pergunte sobre vendas, lucro, custos, devoluções…"><button class="btn-sm primary" id="csend">Enviar</button></div></div><div class="prev" id="prev"></div></div>';
    renderChat(); renderPreview();
    document.getElementById('csend').onclick = sendChat; document.getElementById('cin').onkeydown = function (e) { if (e.key === 'Enter') sendChat(); };
    app.querySelectorAll('.chip').forEach(function (c) { c.onclick = function () { document.getElementById('cin').value = c.dataset.q; sendChat(); }; });
  }
  function renderChat() { var log = document.getElementById('clog'); if (!log) return; if (!chat.length) { log.innerHTML = '<div class="msg a">Olá! Pergunte sobre seus dados. Ex.: <i>"quais SKUs estão sem custo?"</i>. Vou responder com base nas evidências do Preview ao lado.</div>'; return; } log.innerHTML = chat.map(function (m) { return '<div class="msg ' + m.role + '">' + esc(m.text).replace(/\n/g, '<br>') + (m.cites ? '<div class="cites">Evidências: ' + esc(m.cites) + '</div>' : '') + '</div>'; }).join(''); log.scrollTop = log.scrollHeight; }
  function sendChat() { var inp = document.getElementById('cin'); var q = inp.value.trim(); if (!q) return; chat.push({ role: 'u', text: q }); inp.value = ''; var ans = answer(q); chat.push({ role: 'a', text: ans.text, cites: ans.cites }); renderChat(); renderPreview(); }
  function evidence() { var a = computeOrderAgg(); var o = occInPeriod(); var e = sumExposure(o); var noCost = {}; pedidosInPeriod().forEach(function (ord) { orderFinance(ord)._items.forEach(function (r, i) { var it = ord.items[i]; if (it.sku && r.costUnknown) noCost[it.sku] = (noCost[it.sku] || 0) + 1; }); }); return { a: a, o: o, e: e, noCost: noCost }; }
  function renderPreview() { var el = document.getElementById('prev'); if (!el) return; var ev = evidence(); var a = ev.a; el.innerHTML = '<h4>Preview · evidências (cálculo local)</h4>' + rowline('Pedidos (período)', nn(a.orders)) + rowline('Venda real', brl(a.revenue)) + rowline('Taxas marketplace', brl(a.fees)) + rowline('Custo produtos', brl(a.cost)) + rowline('Resultado estimado', brl(a.result)) + rowline('Margem estimada', a.revenue ? pct((a.result / a.revenue) * 100) : '—') + rowline('Pedidos c/ custo pendente', nn(a.costPending)) + rowline('SKUs distintos sem custo', nn(Object.keys(ev.noCost).length)) + rowline('Ocorrências pós-venda', nn(ev.o.length)) + rowline('Prejuízo confirmado', brl(ev.e.confirmedLoss)) + rowline('Em risco', brl(ev.e.atRisk)) + '<div class="footnote" style="margin-top:10px">Estes números são a base factual das respostas do chat.</div>'; }
  function answer(q) {
    var ql = q.toLowerCase(); var ev = evidence(); var a = ev.a;
    if (/sem custo|nao vinculad|não vinculad|pendente/.test(ql)) { var skus = Object.keys(ev.noCost).slice(0, 15); return { text: (skus.length ? 'Há ' + Object.keys(ev.noCost).length + ' SKUs distintos sem custo cadastrado (vínculo ou custo da família ausente). Isso deixa ' + a.costPending + ' pedidos com lucro pendente. Exemplos: ' + skus.slice(0, 8).join(', ') + '. Cadastre a família e o custo em Produtos para liberar o lucro estimado.' : 'Todos os SKUs vendidos no período têm custo cadastrado.'), cites: a.costPending + ' pedidos pendentes · ' + Object.keys(ev.noCost).length + ' SKUs' }; }
    if (/margem|lucro pouco|vendem muito/.test(ql)) { var map = {}; pedidosInPeriod().forEach(function (o) { var f = orderFinance(o); o.items.forEach(function (it, i) { if (!it.sku) return; var m = map[it.sku] = map[it.sku] || { sku: it.sku, rev: 0, res: 0, hasCost: true }; m.rev += it.subtotal; var r = f._items[i]; if (r.costUnknown) m.hasCost = false; else m.res += (r.subtotal - r.allocatedFees - (r.costTotal || 0)); }); }); var arr = Object.values(map).filter(function (m) { return m.hasCost && m.rev > 0; }).map(function (m) { m.margin = (m.res / m.rev) * 100; return m; }).sort(function (x, y) { return x.margin - y.margin; }); var low = arr.slice(0, 6); return { text: low.length ? 'SKUs que vendem mas têm margem baixa (com custo cadastrado):\n' + low.map(function (m) { return '• ' + m.sku + ' — venda ' + brl(m.rev) + ', margem ' + pct(m.margin); }).join('\n') : 'Ainda não há SKUs suficientes com custo cadastrado para avaliar margem. Cadastre custos em Produtos.', cites: arr.length + ' SKUs com custo avaliados' }; }
    if (/devolu|reembolso|pós-venda|pos-venda|perda|prejuíz|prejuiz/.test(ql)) { var skuMap = {}; ev.o.forEach(function (o) { (o.items || []).forEach(function (i) { if (i.sku) skuMap[i.sku] = (skuMap[i.sku] || 0) + 1; }); }); var top = Object.entries(skuMap).sort(function (x, y) { return y[1] - x[1]; }).slice(0, 6); return { text: 'No período há ' + ev.o.length + ' ocorrências de devolução. Prejuízo confirmado ' + brl(ev.e.confirmedLoss) + ', em risco ' + brl(ev.e.atRisk) + '. SKUs com mais ocorrências: ' + (top.map(function (t) { return t[0] + ' (' + t[1] + ')'; }).join(', ') || '—') + '.', cites: ev.o.length + ' ocorrências · confirmado ' + brl(ev.e.confirmedLoss) }; }
    if (/resultado|lucro|ganhei|faturamento|venda|receita/.test(ql)) { return { text: 'No período: venda real ' + brl(a.revenue) + ' em ' + a.orders + ' pedidos, taxas ' + brl(a.fees) + ', custo ' + brl(a.cost) + '. Resultado estimado ' + brl(a.result) + ' (margem ' + (a.revenue ? pct((a.result / a.revenue) * 100) : '—') + ').' + (a.costPending ? ' Atenção: ' + a.costPending + ' pedidos ainda têm custo pendente.' : ''), cites: 'venda ' + brl(a.revenue) + ' · resultado ' + brl(a.result) }; }
    return { text: 'Posso responder sobre venda, resultado/margem, SKUs sem custo e devoluções — sempre com base nos dados importados (veja o Preview).', cites: 'evidências no Preview' };
  }

  // ---------- componentes de "relatório" (dashboards visuais) ----------
  function secHead(eyebrow, title, sub) { return '<div class="rhead"><div class="eyebrow">' + esc(eyebrow) + '</div><h3 class="rtitle">' + esc(title) + '</h3>' + (sub ? '<p class="rsub">' + esc(sub) + '</p>' : '') + '<div class="rule"></div></div>'; }
  function kstrip(items) { return '<div class="kstrip">' + items.map(function (k) { return '<div class="kc ' + (k.cls || '') + (k.drill ? ' rowlink' : '') + '"' + (k.drill ? ' data-mrdrill="' + esc(k.drill) + '" data-mrdrilllabel="' + esc(k.drillLabel || k.l) + '"' : '') + '><div class="kl">' + esc(k.l) + '</div><div class="kv">' + k.v + '</div>' + (k.s ? '<div class="ks">' + esc(k.s) + '</div>' : '') + '</div>'; }).join('') + '</div>'; }
  function callout(kind, title, bodyHtml) { return '<div class="callout ' + (kind || '') + '"><div class="ct">' + esc(title) + '</div><div class="cbody">' + bodyHtml + '</div></div>'; }
  function chartCard(title, legendHtml, svg) { return '<div class="chartcard"><div class="cch"><h4>' + esc(title) + '</h4>' + (legendHtml ? '<div class="cleg">' + legendHtml + '</div>' : '') + '</div><div style="overflow-x:auto">' + svg + '</div></div>'; }
  // Gráfico combinado barras + linha (barras = eixo esq., linha = eixo dir.). rows: [{label,bar,line}].
  function svgBarLine(rows, opt) {
    opt = opt || {}; var W = 760, H = 260, padL = 44, padR = 44, padB = 30, padT = 22;
    var bc = opt.barColor || '#2b4bd6', lc = opt.lineColor || '#d13b3b';
    var bf = opt.barFmt || function (v) { return nn(v); }, lf = opt.lineFmt || function (v) { return nn(v); };
    var maxBar = Math.max.apply(null, rows.map(function (r) { return r.bar || 0; }).concat([1]));
    var maxLine = Math.max.apply(null, rows.map(function (r) { return r.line || 0; }).concat([1]));
    var n = rows.length, step = (W - padL - padR) / Math.max(1, n), bw = step * 0.5;
    var y0 = H - padB, ih = H - padB - padT;
    var bars = rows.map(function (r, i) { var h = (r.bar / maxBar) * ih; var x = padL + i * step + (step - bw) / 2; var y = y0 - h; return '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + Math.max(0, h).toFixed(1) + '" rx="3" fill="' + bc + '" opacity="0.85"><title>' + esc(r.label) + ': ' + bf(r.bar) + '</title></rect>' + '<text x="' + (x + bw / 2).toFixed(1) + '" y="' + (y - 5).toFixed(1) + '" font-size="11" font-weight="700" fill="' + bc + '" text-anchor="middle">' + bf(r.bar) + '</text>'; }).join('');
    var pts = rows.map(function (r, i) { var x = padL + i * step + step / 2; var y = y0 - (r.line / maxLine) * ih; return [x, y]; });
    var poly = '<polyline points="' + pts.map(function (p) { return p[0].toFixed(1) + ',' + p[1].toFixed(1); }).join(' ') + '" fill="none" stroke="' + lc + '" stroke-width="2.5"/>';
    var dots = rows.map(function (r, i) { return '<circle cx="' + pts[i][0].toFixed(1) + '" cy="' + pts[i][1].toFixed(1) + '" r="3.5" fill="' + lc + '"><title>' + esc(r.label) + ': ' + lf(r.line) + '</title></circle><text x="' + pts[i][0].toFixed(1) + '" y="' + (pts[i][1] - 8).toFixed(1) + '" font-size="10.5" font-weight="700" fill="' + lc + '" text-anchor="middle">' + lf(r.line) + '</text>'; }).join('');
    var labels = rows.map(function (r, i) { var x = padL + i * step + step / 2; return '<text x="' + x.toFixed(1) + '" y="' + (H - 8) + '" font-size="11" fill="#64708a" text-anchor="middle">' + esc(r.label) + '</text>'; }).join('');
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" style="max-width:' + W + 'px"><line x1="' + padL + '" y1="' + y0 + '" x2="' + (W - padR) + '" y2="' + y0 + '" stroke="#e5e9f2"/>' + bars + poly + dots + labels + '</svg>';
  }
  // Barras horizontais ordenadas. rows: [{label,value,color?}].
  function svgHBars(rows, opt) {
    opt = opt || {}; var fmt = opt.fmt || function (v) { return nn(v); }; var W = 720, rowH = 30, padL = 170, padR = 90, padT = 6;
    var H = padT * 2 + rows.length * rowH; var max = Math.max.apply(null, rows.map(function (r) { return r.value || 0; }).concat([1]));
    var body = rows.map(function (r, i) { var y = padT + i * rowH; var w = (r.value / max) * (W - padL - padR); var col = r.color || opt.color || '#2b4bd6'; return '<text x="' + (padL - 8) + '" y="' + (y + rowH / 2 + 4) + '" font-size="12" fill="#1a2233" text-anchor="end">' + esc(String(r.label).slice(0, 26)) + '</text>' + '<rect x="' + padL + '" y="' + (y + 5) + '" width="' + Math.max(1, w).toFixed(1) + '" height="' + (rowH - 12) + '" rx="3" fill="' + col + '" opacity="0.85"><title>' + esc(r.label) + ': ' + fmt(r.value) + '</title></rect>' + '<text x="' + (padL + w + 6).toFixed(1) + '" y="' + (y + rowH / 2 + 4) + '" font-size="11.5" font-weight="700" fill="#1a2233">' + fmt(r.value) + '</text>'; }).join('');
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" style="max-width:' + W + 'px">' + body + '</svg>';
  }
  // Barras agrupadas (várias séries por categoria). cats:[label]; series:[{name,color,vals:[]}].
  function svgGroupBars(cats, series, opt) {
    opt = opt || {}; var fmt = opt.fmt || function (v) { return v; }; var W = 760, H = 260, padL = 40, padR = 20, padB = 30, padT = 20;
    var all = []; series.forEach(function (s) { s.vals.forEach(function (v) { all.push(v || 0); }); }); var max = Math.max.apply(null, all.concat([1]));
    var y0 = H - padB, ih = H - padB - padT, step = (W - padL - padR) / Math.max(1, cats.length), gw = step * 0.72, bw = gw / series.length;
    var body = cats.map(function (c, ci) { var gx = padL + ci * step + (step - gw) / 2; return series.map(function (s, si) { var v = s.vals[ci] || 0; var h = (v / max) * ih; var x = gx + si * bw; var y = y0 - h; return '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + (bw - 2).toFixed(1) + '" height="' + Math.max(0, h).toFixed(1) + '" rx="2" fill="' + s.color + '"><title>' + esc(c) + ' · ' + esc(s.name) + ': ' + fmt(v) + '</title></rect>' + (h > 16 ? '<text x="' + (x + (bw - 2) / 2).toFixed(1) + '" y="' + (y - 3).toFixed(1) + '" font-size="9.5" font-weight="700" fill="' + s.color + '" text-anchor="middle">' + fmt(v) + '</text>' : ''); }).join(''); }).join('');
    var labels = cats.map(function (c, ci) { var x = padL + ci * step + step / 2; return '<text x="' + x.toFixed(1) + '" y="' + (H - 8) + '" font-size="11" fill="#64708a" text-anchor="middle">' + esc(c) + '</text>'; }).join('');
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" style="max-width:' + W + 'px"><line x1="' + padL + '" y1="' + y0 + '" x2="' + (W - padR) + '" y2="' + y0 + '" stroke="#e5e9f2"/>' + body + labels + '</svg>';
  }
  function legendSwatch(items) { return items.map(function (it) { return '<span class="sw" style="background:' + it[1] + '"></span>' + esc(it[0]); }).join(''); }

  // ---------- componentes comuns ----------
  function fcard(lbl, val, cls, sub2) { return '<div class="fcard ' + (cls || '') + '"><div class="lbl">' + esc(lbl) + '</div><div class="val">' + val + '</div>' + (sub2 ? '<div class="footnote" style="margin-top:4px">' + esc(sub2) + '</div>' : '') + '</div>'; }
  function finLine(lbl, val, neg) { if (val == null) return '<div class="fin-line"><span>' + esc(lbl) + '</span><span class="tag warn">pendente</span></div>'; return '<div class="fin-line"><span>' + esc(lbl) + '</span><span class="' + (neg ? 'neg' : '') + '">' + brl(val) + '</span></div>'; }
  function kv(k, v) { return '<label class="fld">' + esc(k) + '</label><div class="ro">' + esc(v || '—') + '</div>'; }
  function rowline(k, v) { return '<div class="row"><span>' + esc(k) + '</span><b>' + v + '</b></div>'; }
  function banner(html) { return '<div class="info-banner">' + html + '</div>'; }
  function emptyBox(t) { return '<div class="panel"><div class="empty"><div class="ico">📄</div><div style="margin-top:8px">' + esc(t) + '</div></div></div>'; }
  function subtab(mod, key, label) { return '<div class="subtab ' + (sub[mod] === key ? 'active' : '') + '" data-sub="' + mod + ':' + key + '">' + esc(label) + '</div>'; }
  function bindSubtabs(mod) { app.querySelectorAll('[data-sub^="' + mod + ':"]').forEach(function (t) { t.onclick = function () { var p = t.dataset.sub.split(':'); sub[p[0]] = p[1]; render(); }; }); }
  function panelImports() { return '<div class="panel"><div class="ph"><h3>Importações recentes</h3><span class="footnote" style="margin:0">' + batches.length + '</span></div><div class="table-wrap"><table><thead><tr><th>Módulo</th><th>Arquivo</th><th>Registros</th><th>Novos</th><th>Atualizados</th><th>Sem alteração</th><th>Data</th></tr></thead><tbody>' + (batches.length ? batches.slice(0, 20).map(impRow).join('') : '<tr><td colspan="7" class="empty">Nenhuma importação ainda.</td></tr>') + '</tbody></table></div></div>'; }
  function importsFor(mod) { var list = batches.filter(function (b) { return b.module.indexOf(mod) === 0; }); return '<div class="panel"><div class="ph"><h3>Histórico de importações — ' + esc(mod) + '</h3></div><div class="table-wrap"><table><thead><tr><th>Arquivo</th><th>Registros</th><th>Novos</th><th>Atualizados</th><th>Sem alteração</th><th>Período</th><th>Data</th></tr></thead><tbody>' + (list.length ? list.map(function (b) { return '<tr><td>' + esc(b.filename) + '</td><td>' + nn(b.seen) + (b.itemsSeen ? ' <span class="footnote">(' + nn(b.itemsSeen) + ' itens)</span>' : '') + '</td><td>' + nn(b.novo) + '</td><td>' + nn(b.upd) + '</td><td>' + nn(b.unch || 0) + '</td><td class="footnote">' + (b.periodStart ? dbr(b.periodStart) + '–' + dbr(b.periodEnd) : '—') + '</td><td class="footnote">' + new Date(b.createdAt).toLocaleString('pt-BR') + '</td></tr>'; }).join('') : '<tr><td colspan="7" class="empty">Nenhuma importação neste módulo.</td></tr>') + '</tbody></table></div></div>'; }
  function impRow(b) { return '<tr><td>' + esc(b.module) + '</td><td>' + esc(b.filename) + '</td><td>' + nn(b.seen) + '</td><td>' + nn(b.novo) + '</td><td>' + nn(b.upd) + '</td><td>' + nn(b.unch || 0) + '</td><td class="footnote">' + new Date(b.createdAt).toLocaleString('pt-BR') + '</td></tr>'; }

  // ============================================================ MÓDULO PRODUTOS (completo, isolado)
  // Restaurado da versão completa: master→variações, KPIs clicáveis, busca em tempo
  // real que esconde não-correspondentes, filtros no nível do SKU, conjunto filtrado
  // único (view=contagem=seleção=ação), checkbox master/variação com indeterminado,
  // seleção de página / de todos, barra de ação em massa, classificação de família
  // (individual/master/massa), preço Shopee + preço de fechamento, edição inline
  // (dropdown/input — nunca prompt()), custo herdado da família, Famílias com
  // histórico de custo, Importações e paginação real. Integra com Pedidos via custo.
  function makeProdutos(opts) {
    var appEl = opts.container, dbPut = opts.put, dbGetAll = opts.getAll, parse = opts.parse, onChange = opts.onChange;
    var EMPTY = { search: '', familyId: '', family: '', closingPrice: '', stock: '', variations: '', status: '', sort: 'name_asc' };
    var S2 = { tab: 'produtos', products: [], variations: [], families: [], imports: [], varByProduct: {}, filters: Object.assign({}, EMPTY), page: 1, pageSize: 25, expanded: new Set(), selected: new Set(), allFiltered: false };

    function normalize(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim(); }
    function parseNum(s) { if (s == null) return null; var t = String(s).replace(/\s|R\$/gi, '').trim(); if (t === '') return null; if (t.indexOf('.') >= 0 && t.indexOf(',') >= 0) t = t.replace(/\./g, '').replace(',', '.'); else if (t.indexOf(',') >= 0) t = t.replace(',', '.'); var n = Number(t); return isFinite(n) ? n : null; }
    function uuid() { return (crypto && crypto.randomUUID) ? crypto.randomUUID() : 'f' + Date.now() + Math.random().toString(16).slice(2); }
    var debTimer = null; function debounce(fn, ms) { return function () { clearTimeout(debTimer); debTimer = setTimeout(fn, ms); }; }
    function q(sel) { return appEl.querySelector(sel); }
    function reindex() { S2.varByProduct = {}; S2.variations.forEach(function (v) { (S2.varByProduct[v.productId] = S2.varByProduct[v.productId] || []).push(v); }); }
    function famById() { var m = {}; S2.families.forEach(function (f) { m[f.id] = f; }); return m; }
    function saveVars(vs) { return dbPut('variations', vs).then(function () { onChange(); }); }
    function afterFamChange(items) { return dbPut('pfamilies', items).then(function () { onChange(); }); }

    function syncRows(rows, filename) {
      var now = new Date().toISOString();
      var errors = rows.filter(function (r) { return r.error; }).length;
      var valid = rows.filter(function (r) { return !r.error && r.shopeeProductId; });
      var prodById = {}; S2.products.forEach(function (p) { prodById[p.id] = p; });
      var varById = {}; S2.variations.forEach(function (v) { varById[v.id] = v; });
      var nameById = {}; valid.forEach(function (r) { if (nameById[r.shopeeProductId] == null && r.productName) nameById[r.shopeeProductId] = r.productName; });
      var res = { total: rows.length, productsSeen: 0, variationsSeen: 0, newProducts: 0, newVariations: 0, updated: 0, unchanged: 0, errors: errors, filename: filename };
      var seen = {}, lastRowByKey = {};
      valid.forEach(function (r) { seen[r.shopeeProductId] = 1; lastRowByKey[r.shopeeProductId + '::' + r.variationKey] = r; });
      res.productsSeen = Object.keys(seen).length;
      var cp = [], cv = [];
      Object.keys(seen).forEach(function (pid) { var name = nameById[pid] || pid, ex = prodById[pid]; if (!ex) { var p = { id: pid, shopeeProductId: pid, name: name, principalSku: null, status: 'ACTIVE', firstSeenAt: now, lastSeenAt: now }; prodById[pid] = p; S2.products.push(p); cp.push(p); res.newProducts++; } else { ex.lastSeenAt = now; if (ex.name !== name) { ex.name = name; res.updated++; } cp.push(ex); } });
      Object.keys(lastRowByKey).forEach(function (key) { var r = lastRowByKey[key]; res.variationsSeen++; var id = r.shopeeProductId + '::' + r.variationKey, ex = varById[id], price = r.shopeeFullPrice == null ? null : Number(r.shopeeFullPrice); var prod = prodById[r.shopeeProductId]; if (prod && !prod.principalSku && r.referenceSku) prod.principalSku = r.referenceSku; if (!ex) { var v = { id: id, productId: r.shopeeProductId, shopeeVariationId: r.shopeeVariationId || '', variationKey: r.variationKey, variationName: r.variationName, sku: r.sku, referenceSku: r.referenceSku, gtin: r.gtin, shopeeFullPrice: price, sellerStock: r.sellerStock, failReason: r.failReason, familyId: null, closingPrice: null, firstSeenAt: now, lastSeenAt: now }; varById[id] = v; S2.variations.push(v); cv.push(v); res.newVariations++; } else { var chg = ex.variationName !== r.variationName || ex.sku !== r.sku || ex.referenceSku !== r.referenceSku || ex.gtin !== r.gtin || ex.sellerStock !== r.sellerStock || (ex.shopeeFullPrice == null ? null : Number(ex.shopeeFullPrice)) !== price; ex.lastSeenAt = now; if (chg) { ex.variationName = r.variationName; ex.sku = r.sku; ex.referenceSku = r.referenceSku; ex.gtin = r.gtin; ex.shopeeFullPrice = price; ex.sellerStock = r.sellerStock; ex.shopeeVariationId = r.shopeeVariationId || ''; res.updated++; } else res.unchanged++; cv.push(ex); } });
      reindex();
      return Promise.all([dbPut('products', cp), dbPut('variations', cv)]).then(function () { var b = { id: uuid(), createdAt: now, filename: filename || 'planilha.xlsx', total: res.total, productsSeen: res.productsSeen, variationsSeen: res.variationsSeen, newProducts: res.newProducts, newVariations: res.newVariations, updated: res.updated, unchanged: res.unchanged, errors: res.errors }; S2.imports.unshift(b); return dbPut('pimports', [b]).then(function () { onChange(); return res; }); });
    }
    function stats() { return { products: S2.products.length, variations: S2.variations.length, withoutFamily: S2.variations.filter(function (v) { return !v.familyId; }).length, withoutClosing: S2.variations.filter(function (v) { return v.closingPrice == null; }).length, families: S2.families.length }; }

    function variationScoped(v, p, query, titleMatch, f) { if (query && !titleMatch) { if (!(normalize(v.sku).indexOf(query) >= 0 || normalize(v.variationName).indexOf(query) >= 0 || String(v.shopeeVariationId).indexOf(query) >= 0)) return false; } if (f.familyId && v.familyId !== f.familyId) return false; if (f.family === 'with' && !v.familyId) return false; if (f.family === 'without' && v.familyId) return false; if (f.closingPrice === 'with' && v.closingPrice == null) return false; if (f.closingPrice === 'without' && v.closingPrice != null) return false; if (f.stock === 'with' && !((v.sellerStock || 0) > 0)) return false; if (f.stock === 'zero' && v.sellerStock !== 0) return false; if (f.stock === 'without' && (v.sellerStock || 0) > 0) return false; return true; }
    function computeFiltered() {
      var f = S2.filters, query = normalize(f.search); var varLevel = !!(f.search || f.familyId || f.family || f.closingPrice || f.stock); var fm = famById(); var masters = [], ids = [];
      S2.products.forEach(function (p) { var all = S2.varByProduct[p.id] || []; if (f.status && p.status !== f.status) return; if (f.variations === 'single' && all.length !== 1) return; if (f.variations === 'multiple' && all.length <= 1) return; var shown; if (!varLevel) shown = all; else { var titleMatch = query && (normalize(p.name).indexOf(query) >= 0 || String(p.shopeeProductId).indexOf(query) >= 0 || (p.principalSku && normalize(p.principalSku).indexOf(query) >= 0)); shown = all.filter(function (v) { return variationScoped(v, p, query, titleMatch, f); }); if (!shown.length) return; } masters.push({ p: p, all: all, shown: shown, a: aggOf(all, shown, fm) }); shown.forEach(function (v) { ids.push(v.id); }); });
      var C = { name_asc: function (a, b) { return a.p.name.localeCompare(b.p.name); }, name_desc: function (a, b) { return b.p.name.localeCompare(a.p.name); }, stock_desc: function (a, b) { return b.a.totalStock - a.a.totalStock; }, stock_asc: function (a, b) { return a.a.totalStock - b.a.totalStock; }, price_desc: function (a, b) { return (b.a.maxPrice || 0) - (a.a.maxPrice || 0); }, price_asc: function (a, b) { return (a.a.minPrice == null ? 1e15 : a.a.minPrice) - (b.a.minPrice == null ? 1e15 : b.a.minPrice); }, variations_desc: function (a, b) { return b.shown.length - a.shown.length; }, variations_asc: function (a, b) { return a.shown.length - b.shown.length; }, without_family: function (a, b) { return b.a.woFam - a.a.woFam; }, without_closing: function (a, b) { return b.a.woClose - a.a.woClose; } };
      masters.sort(C[f.sort] || C.name_asc); return { masters: masters, ids: ids, varLevel: varLevel };
    }
    function aggOf(all, shown, fm) { var prices = shown.map(function (v) { return v.shopeeFullPrice; }).filter(function (n) { return n != null; }); var fams = uniq(shown.map(function (v) { return v.familyId || null; })); var closes = uniq(shown.map(function (v) { return v.closingPrice == null ? null : v.closingPrice; })); var costs = uniq(shown.map(function (v) { var f = v.familyId ? fm[v.familyId] : null; return f && f.currentCostAmount != null ? f.currentCostAmount : null; })); return { totalStock: shown.reduce(function (s, v) { return s + (v.sellerStock || 0); }, 0), minPrice: prices.length ? Math.min.apply(null, prices) : null, maxPrice: prices.length ? Math.max.apply(null, prices) : null, woFam: shown.filter(function (v) { return !v.familyId; }).length, woClose: shown.filter(function (v) { return v.closingPrice == null; }).length, famSummary: fams.length === 0 ? 'none' : fams.length === 1 ? (fams[0] ? 'single:' + fams[0] : 'none') : 'multi', close: agg1(closes), cost: agg1(costs) }; }
    function uniq(a) { var s = {}, o = []; a.forEach(function (x) { var k = x == null ? ' ' : String(x); if (!s[k]) { s[k] = 1; o.push(x); } }); return o; }
    function agg1(vals) { if (!vals.length) return { kind: 'none' }; if (vals.length === 1) return vals[0] == null ? { kind: 'none' } : { kind: 'one', v: vals[0] }; var nn2 = vals.filter(function (x) { return x != null; }); if (!nn2.length) return { kind: 'none' }; return { kind: 'multi', min: Math.min.apply(null, nn2), max: Math.max.apply(null, nn2) }; }

    function pruneSelection(ids) { var set = {}; ids.forEach(function (id) { set[id] = 1; }); Array.from(S2.selected).forEach(function (id) { if (!set[id]) S2.selected.delete(id); }); }

    function render() { if (S2.tab === 'produtos') renderProdutos(); else if (S2.tab === 'familias') renderFamilias(); else renderImportacoes(); }
    function tabsHtml(a) { return '<div class="tabs">' + [['produtos', 'Produtos'], ['familias', 'Famílias'], ['importacoes', 'Importações']].map(function (t) { return '<div class="tab ' + (a === t[0] ? 'active' : '') + '" data-ptab2="' + t[0] + '">' + t[1] + '</div>'; }).join('') + '</div>'; }
    function head(subt) { return '<div class="page-head"><div><h2>Produtos</h2><p>' + subt + '</p></div></div>'; }
    function wireTabs() { appEl.querySelectorAll('[data-ptab2]').forEach(function (t) { t.onclick = function () { S2.tab = t.dataset.ptab2; render(); }; }); }

    function renderProdutos() {
      var s = stats(), last = S2.imports[0];
      appEl.innerHTML = head('Catálogo Shopee: anúncios, variações/SKUs, famílias e custos.') + tabsHtml('produtos') +
        '<div class="importbar"><div><div class="ib-title">Atualizar catálogo Shopee</div><div class="ib-meta">' + (last ? 'Última atualização: ' + new Date(last.createdAt).toLocaleString('pt-BR') + ' · ' : '') + nn(s.products) + ' anúncios · ' + nn(s.variations) + ' SKUs</div></div><div class="spacer"></div><button class="link-btn" id="goImports">Ver histórico</button><button class="btn-sm primary" id="openImport">Importar planilha</button></div>' +
        '<div class="kpi-grid">' + kpi('Anúncios', nn(s.products), 'k-all') + kpi('Variações / SKUs', nn(s.variations), 'k-all') + kpi('SKUs sem família', nn(s.withoutFamily), 'k-nofam', s.withoutFamily > 0) + kpi('SKUs sem preço de fechamento', nn(s.withoutClosing), 'k-noclose', s.withoutClosing > 0) + '</div>' +
        '<div class="panel"><div class="pb">' + toolbarHtml() + '<div id="countline"></div><div id="selbanner"></div></div><div class="pb" style="padding:0" id="results"></div><div class="pb" id="pager"></div></div><div id="bulk"></div>';
      q('#openImport').onclick = openImportModal; q('#goImports').onclick = function () { S2.tab = 'importacoes'; render(); };
      wireTabs(); appEl.querySelectorAll('.kpi.clickable').forEach(function (k) { k.onclick = function () { onKpi(k.dataset.k); }; });
      wireToolbar(); refresh();
    }
    function kpi(l, v, k, warn) { return '<div class="kpi clickable ' + (kpiOn(k) ? 'on' : '') + '" data-k="' + k + '"><div class="lbl">' + l + '</div><div class="val" style="' + (warn ? 'color:var(--warn)' : '') + '">' + v + '</div></div>'; }
    function kpiOn(k) { return (k === 'k-nofam' && S2.filters.family === 'without') || (k === 'k-noclose' && S2.filters.closingPrice === 'without'); }
    function onKpi(k) { if (k === 'k-all') S2.filters = Object.assign({}, EMPTY); else if (k === 'k-nofam') S2.filters = Object.assign({}, EMPTY, { family: 'without', sort: 'without_family' }); else if (k === 'k-noclose') S2.filters = Object.assign({}, EMPTY, { closingPrice: 'without', sort: 'without_closing' }); S2.page = 1; S2.allFiltered = false; render(); }
    function toolbarHtml() { var f = S2.filters; function sel(id, val, opts2) { return '<select class="select sm" data-f="' + id + '">' + opts2.map(function (o) { return '<option value="' + o[0] + '"' + (val === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>'; } return '<div class="toolbar2"><input class="input sm" id="psearch" style="width:260px" placeholder="Buscar título, SKU, variação ou ID…" value="' + esc(f.search) + '">' + sel('familyId', f.familyId, [['', 'Família: todas']].concat(S2.families.map(function (fm) { return [fm.id, fm.name]; }))) + sel('family', f.family, [['', 'Classificação: todos'], ['with', 'Com família'], ['without', 'Sem família']]) + sel('closingPrice', f.closingPrice, [['', 'Preço fechamento: todos'], ['with', 'Configurado'], ['without', 'Não configurado']]) + sel('stock', f.stock, [['', 'Estoque: todos'], ['with', 'Com estoque'], ['without', 'Sem estoque'], ['zero', 'Zerado']]) + sel('variations', f.variations, [['', 'Variações: todas'], ['single', 'Sem variação'], ['multiple', 'Com variações']]) + sel('status', f.status, [['', 'Status: todos'], ['ACTIVE', 'Ativo'], ['INACTIVE', 'Inativo']]) + sel('sort', f.sort, [['name_asc', 'Nome A–Z'], ['name_desc', 'Nome Z–A'], ['stock_desc', 'Maior estoque'], ['stock_asc', 'Menor estoque'], ['price_desc', 'Maior preço'], ['price_asc', 'Menor preço'], ['variations_desc', 'Mais variações'], ['variations_asc', 'Menos variações'], ['without_family', 'Sem família 1º'], ['without_closing', 'Sem fechamento 1º']]) + '<button class="link-btn" id="clearF">Limpar filtros</button></div>'; }
    function wireToolbar() { var si = q('#psearch'); si.oninput = debounce(function () { S2.filters.search = si.value; S2.page = 1; S2.allFiltered = false; refresh(); }, 220); appEl.querySelectorAll('select[data-f]').forEach(function (se) { se.onchange = function () { var k = se.dataset.f; S2.filters[k] = se.value; if (k === 'familyId' && se.value) S2.filters.family = ''; if (k === 'family') S2.filters.familyId = ''; S2.page = 1; S2.allFiltered = false; render(); }; }); q('#clearF').onclick = function () { S2.filters = Object.assign({}, EMPTY); S2.page = 1; S2.allFiltered = false; render(); }; }

    function refresh() {
      var R = computeFiltered(), s = stats(); pruneSelection(R.ids);
      var pages = Math.max(1, Math.ceil(R.masters.length / S2.pageSize)); if (S2.page > pages) S2.page = pages;
      var pageMasters = R.masters.slice((S2.page - 1) * S2.pageSize, S2.page * S2.pageSize);
      var pageIds = []; pageMasters.forEach(function (m) { m.shown.forEach(function (v) { pageIds.push(v.id); }); });
      var pageAll = pageIds.length > 0 && pageIds.every(function (id) { return S2.selected.has(id); });
      appEl.querySelectorAll('.kpi.clickable').forEach(function (k) { k.classList.toggle('on', kpiOn(k.dataset.k)); });
      var filteredView = JSON.stringify(S2.filters) !== JSON.stringify(EMPTY);
      q('#countline').className = 'count-line';
      q('#countline').innerHTML = (filteredView ? '<b>' + nn(R.masters.length) + '</b> de ' + nn(s.products) + ' anúncios' : '<b>' + nn(R.masters.length) + '</b> anúncios') + ' · <b>' + nn(R.ids.length) + '</b> SKUs correspondentes · <button class="link-btn" id="expAll">Expandir</button> / <button class="link-btn" id="colAll">Recolher</button>';
      q('#expAll').onclick = function () { pageMasters.forEach(function (m) { S2.expanded.add(m.p.id); }); refresh(); }; q('#colAll').onclick = function () { S2.expanded.clear(); refresh(); };
      var sb = q('#selbanner'); sb.innerHTML = '';
      if (S2.allFiltered && S2.selected.size) sb.innerHTML = '<div class="selbanner"><span>Todos os <b>' + nn(S2.selected.size) + '</b> SKUs do resultado estão selecionados.</span><button class="link-btn" id="clrSel">Limpar seleção</button></div>';
      else if (pageAll && R.ids.length > pageIds.length) sb.innerHTML = '<div class="selbanner"><span>' + pageIds.length + ' SKUs desta página selecionados.</span><button class="link-btn" id="selAllF">Selecionar todos os ' + nn(R.ids.length) + ' SKUs do resultado</button></div>';
      var b1 = q('#clrSel'); if (b1) b1.onclick = function () { S2.selected.clear(); S2.allFiltered = false; refresh(); };
      var b2 = q('#selAllF'); if (b2) b2.onclick = function () { R.ids.forEach(function (id) { S2.selected.add(id); }); S2.allFiltered = true; refresh(); };
      q('#results').innerHTML = renderTable(pageMasters, pageAll); wireResults(pageMasters);
      q('#pager').innerHTML = pagerHtml(pages);
      appEl.querySelectorAll('[data-ps]').forEach(function (b) { b.onclick = function () { S2.pageSize = +b.dataset.ps; S2.page = 1; refresh(); }; });
      var pv = q('#pprev'), nx = q('#pnext'); if (pv) pv.onclick = function () { if (S2.page > 1) { S2.page--; refresh(); } }; if (nx) nx.onclick = function () { if (S2.page < pages) { S2.page++; refresh(); } };
      renderBulk();
    }
    function pagerHtml(pages) { return '<div style="display:flex;gap:10px;justify-content:space-between;align-items:center;flex-wrap:wrap"><div class="seg">' + [25, 50, 100].map(function (n) { return '<button class="' + (S2.pageSize === n ? 'on' : '') + '" data-ps="' + n + '">' + n + '/pág</button>'; }).join('') + '</div><div style="display:flex;gap:8px;align-items:center"><button class="btn-sm" id="pprev"' + (S2.page <= 1 ? ' disabled' : '') + '>Anterior</button><span class="footnote" style="margin:0">página ' + S2.page + ' de ' + pages + '</span><button class="btn-sm" id="pnext"' + (S2.page >= pages ? ' disabled' : '') + '>Próxima</button></div></div>'; }
    function famName(id) { var f = famById()[id]; return f ? f.name : ''; }
    function famCell(sum) { if (sum === 'none') return '<span class="tag warn">sem família</span>'; if (sum === 'multi') return '<span class="tag info">múltiplas</span>'; if (sum.indexOf('single:') === 0) return '<span class="tag ok">' + esc(famName(sum.slice(7))) + '</span>'; return '—'; }
    function money1(a) { if (a.kind === 'none') return '<span class="tag warn">não informado</span>'; if (a.kind === 'one') return brl(a.v); return brl(a.min) + ' — ' + brl(a.max); }
    function cost1(a) { if (a.kind === 'none') return '—'; if (a.kind === 'one') return brl(a.v) + ' <span class="inh-cost">herdado</span>'; return brl(a.min) + ' — ' + brl(a.max); }
    function renderTable(masters, pageAll) {
      if (!masters.length) return '<div class="empty"><div class="ico">◫</div><p>' + (S2.products.length ? 'Nenhum resultado para os filtros atuais.' : 'Catálogo vazio. Clique em “Importar planilha” e envie o arquivo .xlsx da Shopee.') + '</p></div>';
      var body = masters.map(function (m) {
        var p = m.p, a = m.a, shown = m.shown; var sel = shown.filter(function (v) { return S2.selected.has(v.id); }).length, allSel = shown.length && sel === shown.length, indet = sel > 0 && !allSel, open = S2.expanded.has(p.id);
        var range = a.minPrice == null ? '—' : (a.minPrice === a.maxPrice ? brl(a.minPrice) : brl(a.minPrice) + ' — ' + brl(a.maxPrice));
        var refVar = (shown.find(function (v) { return v.sku; }) || m.all.find(function (v) { return v.sku; }));
        var refSku = p.principalSku || (refVar && refVar.sku) || null;
        var refLabel = refSku ? ((p.principalSku ? 'SKU principal: ' : 'SKU exemplo: ') + '<span class="mono">' + esc(refSku) + '</span> · ') : '';
        var varCountLabel = shown.length + ' ' + (shown.length === 1 ? 'variação' : 'variações') + (shown.length < m.all.length ? ' <span class="footnote" style="margin:0">de ' + m.all.length + '</span>' : '');
        var master = '<tr class="master-row" data-pid="' + p.id + '"><td><input type="checkbox" class="chk chk-m" data-pid="' + p.id + '"' + (allSel ? ' checked' : '') + ' data-indet="' + (indet ? 1 : 0) + '"></td><td><button class="expander" data-exp="' + p.id + '">' + (open ? '▾' : '▸') + '</button></td><td><div class="pname">' + esc(p.name) + (p.status === 'INACTIVE' ? ' <span class="tag">inativo</span>' : '') + '</div><div class="footnote" style="margin:0">' + refLabel + 'ID Shopee: <span class="mono">' + esc(p.shopeeProductId) + '</span></div></td><td>' + varCountLabel + '</td><td class="cell-fam" data-mfam="' + p.id + '">' + famCell(a.famSummary) + '</td><td>' + range + '</td><td class="cell-close" data-mclose="' + p.id + '">' + money1(a.close) + '</td><td class="cell-cost" data-mcost="' + p.id + '">' + cost1(a.cost) + '</td><td>' + nn(a.totalStock) + '</td></tr>';
        var subs = '';
        if (open) { subs = '<tr class="subwrap"><td colspan="9" style="padding:0"><table><thead><tr><th style="width:30px"></th><th>Variação</th><th>Família</th><th>Preço Shopee</th><th>Preço Fechamento</th><th>Custo (herdado)</th><th>Estoque</th></tr></thead><tbody>' + shown.map(function (v) { var f = v.familyId ? famById()[v.familyId] : null; return '<tr class="subrow" data-vid="' + v.id + '"><td><input type="checkbox" class="chk chk-v" data-vid="' + v.id + '"' + (S2.selected.has(v.id) ? ' checked' : '') + '></td><td class="vname">' + esc(v.variationName || '(única)') + '<div class="footnote" style="margin:0">SKU: <span class="mono">' + esc(v.sku || '—') + '</span></div></td><td class="cell-fam" data-vfam="' + v.id + '">' + (f ? '<span class="tag info">' + esc(f.name) + '</span>' : '<span class="tag warn">sem família</span>') + '</td><td>' + brl(v.shopeeFullPrice) + '</td><td class="cell-close" data-vclose="' + v.id + '">' + (v.closingPrice != null ? brl(v.closingPrice) : '<span class="tag warn">não informado</span>') + '</td><td class="cell-cost" data-vcost="' + v.id + '">' + (f && f.currentCostAmount != null ? brl(f.currentCostAmount) + ' <span class="inh-cost">herdado</span>' : '<span class="tag warn">definir custo</span>') + '</td><td>' + (v.sellerStock == null ? '—' : v.sellerStock) + '</td></tr>'; }).join('') + '</tbody></table></td></tr>'; }
        return master + subs;
      }).join('');
      return '<div class="table-wrap"><table><thead><tr><th style="width:30px"><input type="checkbox" class="chk" id="chkPage"' + (pageAll ? ' checked' : '') + '></th><th style="width:26px"></th><th>Produto</th><th>SKUs</th><th>Família</th><th>Preço Shopee</th><th>Preço Fechamento</th><th>Custo</th><th>Estoque</th></tr></thead><tbody>' + body + '</tbody></table></div>';
    }
    function wireResults(masters) {
      appEl.querySelectorAll('[data-exp]').forEach(function (b) { b.onclick = function () { var id = b.dataset.exp; if (S2.expanded.has(id)) S2.expanded.delete(id); else S2.expanded.add(id); refresh(); }; });
      appEl.querySelectorAll('.chk-v').forEach(function (c) { c.onchange = function () { if (c.checked) S2.selected.add(c.dataset.vid); else S2.selected.delete(c.dataset.vid); S2.allFiltered = false; refresh(); }; });
      appEl.querySelectorAll('.chk-m').forEach(function (c) { if (+c.dataset.indet) c.indeterminate = true; c.onchange = function () { var m = masters.find(function (x) { return x.p.id === c.dataset.pid; }); if (m) m.shown.forEach(function (v) { if (c.checked) S2.selected.add(v.id); else S2.selected.delete(v.id); }); S2.allFiltered = false; refresh(); }; });
      var cp = q('#chkPage'); if (cp) cp.onchange = function () { masters.forEach(function (m) { m.shown.forEach(function (v) { if (cp.checked) S2.selected.add(v.id); else S2.selected.delete(v.id); }); }); S2.allFiltered = false; refresh(); };
      appEl.querySelectorAll('[data-vfam]').forEach(function (c) { c.onclick = function () { editVarFamily(c, c.dataset.vfam); }; });
      appEl.querySelectorAll('[data-vclose]').forEach(function (c) { c.onclick = function () { editVarClose(c, c.dataset.vclose); }; });
      appEl.querySelectorAll('[data-mfam]').forEach(function (c) { c.onclick = function () { editMasterFamily(c, c.dataset.mfam, masters); }; });
      appEl.querySelectorAll('[data-mclose]').forEach(function (c) { c.onclick = function () { editMasterClose(c, c.dataset.mclose, masters); }; });
      appEl.querySelectorAll('[data-vcost]').forEach(function (c) { c.onclick = function () { openCostEditor([c.dataset.vcost]); }; });
      appEl.querySelectorAll('[data-mcost]').forEach(function (c) { c.onclick = function () { var m = masters.find(function (x) { return x.p.id === c.dataset.mcost; }); openCostEditor(m ? m.shown.map(function (v) { return v.id; }) : []); }; });
    }
    function editVarFamily(cell, vid) { var v = S2.variations.find(function (x) { return x.id === vid; }); if (!v) return; var actives = S2.families.filter(function (f) { return f.status === 'ACTIVE' || f.id === v.familyId; }); cell.innerHTML = '<select class="select sm inl"><option value="">— sem família —</option>' + actives.map(function (f) { return '<option value="' + f.id + '"' + (v.familyId === f.id ? ' selected' : '') + '>' + esc(f.name) + '</option>'; }).join('') + '<option value="__new">+ criar nova família…</option></select>'; var se = cell.querySelector('select'); se.focus(); se.onchange = function () { if (se.value === '__new') { familyEditor(null, function (f) { v.familyId = f.id; saveVars([v]).then(function () { refresh(); toast('Família criada e aplicada', f.name); }); }); return; } v.familyId = se.value || null; saveVars([v]).then(function () { refresh(); toast('Salvo', 'Família da variação atualizada.'); }); }; se.onkeydown = function (e) { if (e.key === 'Escape') refresh(); }; se.onblur = function () { setTimeout(function () { if (document.body.contains(se) && se.value !== '__new') refresh(); }, 150); }; }
    function editVarClose(cell, vid) { var v = S2.variations.find(function (x) { return x.id === vid; }); if (!v) return; cell.innerHTML = '<input class="input sm inl" style="width:110px" value="' + (v.closingPrice != null ? v.closingPrice : '') + '" placeholder="0,00">'; var inp = cell.querySelector('input'); inp.focus(); inp.select(); function commit(next) { v.closingPrice = parseNum(inp.value); saveVars([v]).then(function () { refresh(); toast('Salvo', 'Preço de fechamento atualizado.'); if (next) focusNextClose(vid); }); } inp.onkeydown = function (e) { if (e.key === 'Enter') { e.preventDefault(); commit(false); } else if (e.key === 'Tab') { e.preventDefault(); commit(true); } else if (e.key === 'Escape') refresh(); }; inp.onblur = function () { setTimeout(function () { if (document.body.contains(inp)) commit(false); }, 120); }; }
    function focusNextClose(vid) { var cells = Array.from(appEl.querySelectorAll('[data-vclose]')); var i = cells.findIndex(function (c) { return c.dataset.vclose === vid; }); if (i >= 0 && i + 1 < cells.length) editVarClose(cells[i + 1], cells[i + 1].dataset.vclose); }
    function editMasterFamily(cell, pid, masters) { var m = masters.find(function (x) { return x.p.id === pid; }); if (!m) return; var actives = S2.families.filter(function (f) { return f.status === 'ACTIVE'; }); cell.innerHTML = '<select class="select sm inl"><option value="">— sem família —</option>' + actives.map(function (f) { return '<option value="' + f.id + '">' + esc(f.name) + '</option>'; }).join('') + '<option value="__new">+ criar nova família…</option></select>'; var se = cell.querySelector('select'); se.focus(); se.onkeydown = function (e) { if (e.key === 'Escape') refresh(); }; se.onchange = function () { if (se.value === '__new') { familyEditor(null, function (f) { m.shown.forEach(function (v) { v.familyId = f.id; }); saveVars(m.shown).then(function () { refresh(); toast('Família criada e aplicada', m.shown.length + ' SKUs em “' + f.name + '”.'); }); }); return; } var fid = se.value || null; var shown = m.shown, mixed = uniq(shown.map(function (v) { return v.familyId || null; })); var needConfirm = shown.length > 1 && (mixed.length > 1 || (mixed.length === 1 && mixed[0] !== fid && mixed[0] != null)); var apply = function () { shown.forEach(function (v) { v.familyId = fid; }); saveVars(shown).then(function () { refresh(); toast('Família aplicada', shown.length + ' SKUs classificados' + (fid ? ' em “' + famName(fid) + '”' : '') + '.'); }); }; if (needConfirm) confirmModal('Aplicar família a ' + shown.length + ' variações?', 'Este anúncio possui variações com classificações diferentes. Aplicar “' + (fid ? famName(fid) : 'sem família') + '” substituirá as famílias atuais.', apply, refresh); else apply(); }; }
    function editMasterClose(cell, pid, masters) { var m = masters.find(function (x) { return x.p.id === pid; }); if (!m) return; cell.innerHTML = '<input class="input sm inl" style="width:120px" placeholder="0,00">'; var inp = cell.querySelector('input'); inp.focus(); function done() { var val = parseNum(inp.value), shown = m.shown, hasIndiv = shown.some(function (v) { return v.closingPrice != null; }) && uniq(shown.map(function (v) { return v.closingPrice == null ? null : v.closingPrice; })).length > 1; var apply = function () { shown.forEach(function (v) { v.closingPrice = val; }); saveVars(shown).then(function () { refresh(); toast('Preço aplicado', shown.length + ' SKUs com ' + brl(val) + '.'); }); }; if (shown.length > 1 && hasIndiv) confirmModal('Aplicar ' + brl(val) + ' a ' + shown.length + ' variações?', 'Existem preços de fechamento individuais neste anúncio. Eles serão substituídos.', apply, refresh); else apply(); } inp.onkeydown = function (e) { if (e.key === 'Enter') { e.preventDefault(); done(); } else if (e.key === 'Escape') refresh(); }; inp.onblur = function () { setTimeout(function () { if (document.body.contains(inp)) refresh(); }, 120); }; }
    function confirmModal(title, body, onYes, onNo) { var o = overlay('<div class="mh"><h3>' + esc(title) + '</h3><button class="x">×</button></div><div class="mbd"><p style="margin-top:0">' + esc(body) + '</p></div><div class="mf"><button class="btn-sm" id="no">Cancelar</button><button class="btn-sm primary" id="yes">Aplicar</button></div>'); o.querySelector('.x').onclick = o.querySelector('#no').onclick = function () { o.remove(); if (onNo) onNo(); }; o.querySelector('#yes').onclick = function () { o.remove(); onYes(); }; }
    function renderBulk() { var el = q('#bulk'); if (!S2.selected.size) { el.innerHTML = ''; return; } el.innerHTML = '<div class="bulkbar"><b>' + nn(S2.selected.size) + ' SKUs selecionados</b><div class="spacer"></div><button class="btn-sm primary" id="bAssign">Classificar família</button><button class="btn-sm" id="bPrice">Preço de fechamento</button><button class="btn-sm" id="bOff">Inativar</button><button class="btn-sm" id="bOn">Ativar</button><button class="btn-sm" id="bClr">Limpar</button></div>'; q('#bAssign').onclick = openAssign; q('#bPrice').onclick = openBulkPrice; q('#bClr').onclick = function () { S2.selected.clear(); S2.allFiltered = false; refresh(); }; q('#bOff').onclick = function () { statusBulk('INACTIVE'); }; q('#bOn').onclick = function () { statusBulk('ACTIVE'); }; }
    function selIds() { return Array.from(S2.selected); }
    function statusBulk(st) { var pset = {}; selIds().forEach(function (id) { var v = S2.variations.find(function (x) { return x.id === id; }); if (v) pset[v.productId] = 1; }); var ch = []; S2.products.forEach(function (p) { if (pset[p.id]) { p.status = st; ch.push(p); } }); dbPut('products', ch).then(function () { S2.selected.clear(); S2.allFiltered = false; refresh(); toast('Status alterado', 'Anúncios ' + (st === 'ACTIVE' ? 'ativados' : 'inativados') + '.'); }); }
    function openAssign() {
      var ids = selIds(), actives = S2.families.filter(function (f) { return f.status === 'ACTIVE'; });
      var o = overlay('<div class="mh"><h3>Classificar família</h3><button class="x">×</button></div><div class="mbd"><p class="footnote" style="margin-top:0"><b>' + ids.length + '</b> SKUs serão alterados.</p><div id="ab"></div></div><div class="mf" id="af"></div>');
      o.querySelector('.x').onclick = function () { o.remove(); };
      var creating = false, chosen = '';
      function draw() { var body = o.querySelector('#ab'), foot = o.querySelector('#af'); if (creating) { body.innerHTML = '<div id="qe"></div><label class="fld">Nome da família *</label><input class="input" id="qn" placeholder="Ex.: Quadro 40x60 Premium com Vidro"><div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><div><label class="fld">Código</label><input class="input" id="qc"></div><div><label class="fld">Custo (R$)</label><input class="input" id="qcost" placeholder="0,00"></div></div>'; foot.innerHTML = '<button class="btn-sm" id="qb">Voltar</button><button class="btn-sm primary" id="qcr">Criar e usar</button>'; o.querySelector('#qb').onclick = function () { creating = false; draw(); }; o.querySelector('#qcr').onclick = function () { var n = o.querySelector('#qn').value.trim(); if (!n) { o.querySelector('#qe').innerHTML = '<div class="form-err">Informe o nome.</div>'; return; } createFamily({ name: n, internalCode: o.querySelector('#qc').value.trim(), cost: o.querySelector('#qcost').value }).then(function (f) { creating = false; chosen = f.id; draw(); }); }; return; } var cf = S2.families.find(function (f) { return f.id === chosen; }); body.innerHTML = '<label class="fld">Família</label><select class="select" id="fs" style="width:100%"><option value="">— remover família —</option>' + actives.map(function (f) { return '<option value="' + f.id + '"' + (chosen === f.id ? ' selected' : '') + '>' + esc(f.name) + (f.currentCostAmount != null ? ' (' + brl(f.currentCostAmount) + ')' : ' (sem custo)') + '</option>'; }).join('') + '</select><div style="display:flex;gap:12px;margin-top:8px"><button class="link-btn" id="nf">+ Criar nova família</button></div>' + (cf ? '<div class="ro" style="margin-top:12px">Custo herdado: <b>' + (cf.currentCostAmount != null ? brl(cf.currentCostAmount) : 'não informado') + '</b></div>' : ''); foot.innerHTML = '<button class="btn-sm" id="ac">Cancelar</button><button class="btn-sm primary" id="ap">Aplicar a ' + ids.length + ' SKUs</button>'; o.querySelector('#fs').onchange = function () { chosen = this.value; draw(); }; o.querySelector('#nf').onclick = function () { creating = true; draw(); }; o.querySelector('#ac').onclick = function () { o.remove(); }; o.querySelector('#ap').onclick = function () { applyFamily(ids, chosen || null); o.remove(); }; }
      draw();
    }
    function applyFamily(ids, fid) { var ch = []; ids.forEach(function (id) { var v = S2.variations.find(function (x) { return x.id === id; }); if (v) { v.familyId = fid; ch.push(v); } }); saveVars(ch).then(function () { S2.selected.clear(); S2.allFiltered = false; refresh(); toast('Família atribuída', ids.length + ' SKUs' + (fid ? ' em “' + famName(fid) + '”' : '') + '.'); }); }
    function openBulkPrice() { var ids = selIds(), o = overlay('<div class="mh"><h3>Preço de fechamento em massa</h3><button class="x">×</button></div><div class="mbd"><p class="footnote" style="margin-top:0"><b>' + ids.length + '</b> SKUs serão alterados. O preço Shopee não muda.</p><label class="fld">Preço de fechamento (R$)</label><input class="input" id="bp" placeholder="0,00"></div><div class="mf"><button class="btn-sm" id="c">Cancelar</button><button class="btn-sm primary" id="ok">Aplicar a ' + ids.length + ' SKUs</button></div>'); o.querySelector('.x').onclick = o.querySelector('#c').onclick = function () { o.remove(); }; o.querySelector('#ok').onclick = function () { var val = parseNum(o.querySelector('#bp').value), ch = []; ids.forEach(function (id) { var v = S2.variations.find(function (x) { return x.id === id; }); if (v) { v.closingPrice = val; ch.push(v); } }); saveVars(ch).then(function () { S2.selected.clear(); S2.allFiltered = false; o.remove(); refresh(); toast('Preço aplicado', ids.length + ' SKUs com ' + brl(val) + '.'); }); }; }
    // Editor de CUSTO direto na célula: escolher OU criar família e informar o custo unitário (§26 — custo mora na família).
    function openCostEditor(vids) {
      var vs = vids.map(function (id) { return S2.variations.find(function (v) { return v.id === id; }); }).filter(Boolean);
      if (!vs.length) return;
      var famIds = uniq(vs.map(function (v) { return v.familyId || null; }));
      var curFam = famIds.length === 1 && famIds[0] ? famById()[famIds[0]] : null;
      var actives = S2.families.filter(function (f) { return f.status === 'ACTIVE'; });
      var o = overlay('<div class="mh"><h3>Custo do produto</h3><button class="x">×</button></div><div class="mbd">' +
        '<p class="footnote" style="margin-top:0">O custo pertence à <b>família</b> e é herdado por todos os SKUs vinculados. ' + vs.length + ' SKU(s) selecionado(s).</p>' +
        '<div id="ce"></div>' +
        '<label class="fld">Família</label><select class="select" id="csel" style="width:100%"><option value="">— escolher família —</option>' +
        actives.map(function (f) { return '<option value="' + f.id + '"' + (curFam && curFam.id === f.id ? ' selected' : '') + '>' + esc(f.name) + (f.currentCostAmount != null ? ' (' + brl(f.currentCostAmount) + ')' : ' (sem custo)') + '</option>'; }).join('') +
        '<option value="__new">+ Criar nova família…</option></select><div id="cnew"></div>' +
        '<label class="fld">Custo unitário (R$)</label><input class="input" id="ccost" placeholder="0,00" value="' + (curFam && curFam.currentCostAmount != null ? curFam.currentCostAmount : '') + '"><div class="footnote" id="chint">' + (curFam && curFam.currentCostAmount != null ? 'Herdado da família' : '') + '</div>' +
        '<div class="footnote">Ao salvar, o custo passa a valer para todos os SKUs da família (histórico preservado) e o lucro dos Pedidos é recalculado.</div>' +
        '</div><div class="mf"><button class="btn-sm" id="cx">Cancelar</button><button class="btn-sm primary" id="cok">Salvar custo</button></div>');
      var sel = o.querySelector('#csel');
      function drawNew() { var box = o.querySelector('#cnew'); box.innerHTML = sel.value === '__new' ? '<label class="fld">Nome da nova família *</label><input class="input" id="cnn" placeholder="Ex.: Quadro 40x60 Premium">' : ''; }
      // Ao escolher uma família existente, preenche o custo herdado dela imediatamente (§ correção custo).
      function fillCost() { if (sel.value && sel.value !== '__new') { var fm = famById()[sel.value]; var ci = o.querySelector('#ccost'); var hint = o.querySelector('#chint'); if (fm && fm.currentCostAmount != null) { ci.value = fm.currentCostAmount; if (hint) hint.textContent = 'Herdado da família'; } else { ci.value = ''; if (hint) hint.textContent = fm ? 'Família sem custo — informe o custo' : ''; } } }
      sel.onchange = function () { drawNew(); fillCost(); }; drawNew();
      o.querySelector('.x').onclick = o.querySelector('#cx').onclick = function () { o.remove(); };
      o.querySelector('#cok').onclick = function () {
        var cost = o.querySelector('#ccost').value, costNum = parseNum(cost);
        if (costNum == null) { o.querySelector('#ce').innerHTML = '<div class="form-err">Informe o custo unitário.</div>'; return; }
        var val = sel.value, chain;
        if (val === '__new') { var nm = (o.querySelector('#cnn').value || '').trim(); if (!nm) { o.querySelector('#ce').innerHTML = '<div class="form-err">Informe o nome da nova família.</div>'; return; } chain = createFamily({ name: nm, cost: cost }).then(function (f) { return f.id; }); }
        else if (val) { chain = updateFamily(famById()[val], { cost: cost }).then(function () { return val; }); }
        else { o.querySelector('#ce').innerHTML = '<div class="form-err">Escolha ou crie uma família.</div>'; return; }
        chain.then(function (fid) { vs.forEach(function (v) { v.familyId = fid; }); return saveVars(vs); }).then(function () { o.remove(); refresh(); toast('Custo salvo', vs.length + ' SKU(s) · custo unitário ' + brl(costNum) + '.'); });
      };
    }
    function overlay(html, w) { var o = document.createElement('div'); o.className = 'overlay'; o.innerHTML = '<div class="modal" style="width:' + (w || 520) + 'px">' + html + '</div>'; o.onclick = function (e) { if (e.target === o) o.remove(); }; document.body.appendChild(o); return o; }
    function openImportModal() { var o = overlay('<div class="mh"><h3>Importar planilha da Shopee</h3><button class="x">×</button></div><div class="mbd"><div class="dz" id="dz"><div style="font-size:26px;opacity:.4">⭱</div><div class="footnote" id="dzt" style="margin-top:6px">Arraste o arquivo .xlsx ou clique para selecionar</div><input type="file" accept=".xlsx" class="hidden" id="file"></div><div class="footnote">Reimportar sincroniza nome/preço/estoque da Shopee sem duplicar; família, preço de fechamento e custo são preservados.</div><div id="ie"></div></div><div class="mf"><button class="btn-sm" id="c">Cancelar</button><button class="btn-sm primary" id="go" disabled>Importar</button></div>'); var file = null, dz = o.querySelector('#dz'), inp = o.querySelector('#file'); o.querySelector('.x').onclick = o.querySelector('#c').onclick = function () { o.remove(); }; dz.onclick = function () { inp.click(); }; dz.ondragover = function (e) { e.preventDefault(); dz.classList.add('over'); }; dz.ondragleave = function () { dz.classList.remove('over'); }; dz.ondrop = function (e) { e.preventDefault(); dz.classList.remove('over'); file = e.dataTransfer.files[0]; show(); }; inp.onchange = function () { file = inp.files[0]; show(); }; function show() { if (file) { o.querySelector('#dzt').innerHTML = '<b>' + esc(file.name) + '</b> · ' + (file.size / 1024).toFixed(0) + ' KB'; o.querySelector('#go').disabled = false; } } o.querySelector('#go').onclick = function () { file.arrayBuffer().then(function (ab) { try { var parsed = parse(ab, file.name); if (parsed.notRecognized) { o.querySelector('#ie').innerHTML = '<div class="form-err">Cabeçalho de produtos não encontrado nesta planilha.</div>'; return; } syncRows(parsed.rows, file.name).then(function (res) { o.remove(); render(); toast(res.errors ? 'Importação concluída com erros' : 'Importação concluída', res.total + ' SKUs · ' + (res.newProducts + res.newVariations) + ' novos · ' + res.updated + ' atualizados · ' + res.unchanged + ' sem alteração · ' + res.errors + ' erros', res.errors > 0); }); } catch (e) { o.querySelector('#ie').innerHTML = '<div class="form-err">' + esc(e.message || e) + '</div>'; } }); }; }

    function createFamily(dto) { var cost = parseNum(dto.cost), now = new Date().toISOString(), f = { id: uuid(), name: dto.name, normalizedName: normalize(dto.name), internalCode: dto.internalCode || null, notes: dto.notes || null, status: dto.status || 'ACTIVE', currentCostAmount: cost, currentCostEffectiveFrom: cost != null ? now : null, costUpdatedAt: cost != null ? now : null, costHistory: cost != null ? [{ costAmount: cost, effectiveFrom: now, createdAt: now }] : [] }; S2.families.push(f); return afterFamChange([f]).then(function () { return f; }); }
    function updateFamily(f, dto) { var now = new Date().toISOString(); if (dto.name != null) { f.name = dto.name; f.normalizedName = normalize(dto.name); } if (dto.internalCode !== undefined) f.internalCode = dto.internalCode || null; if (dto.notes !== undefined) f.notes = dto.notes || null; if (dto.status) f.status = dto.status; var cost = parseNum(dto.cost); if (cost != null && cost !== f.currentCostAmount) { f.currentCostAmount = cost; f.currentCostEffectiveFrom = now; f.costUpdatedAt = now; f.costHistory = (f.costHistory || []).concat([{ costAmount: cost, effectiveFrom: now, createdAt: now }]); } return afterFamChange([f]); }
    function renderFamilias() {
      appEl.innerHTML = head('A família é a unidade interna de custo. Vários SKUs apontam para uma família; o custo mora aqui, com histórico.') + tabsHtml('familias') + '<div class="page-head" style="margin-top:-6px"><div></div><button class="btn-sm primary" id="nf">+ Nova família</button></div><div class="panel"><div class="pb"><div class="toolbar2"><input class="input sm" id="fq" style="width:260px" placeholder="Buscar família"><select class="select sm" id="fst"><option value="">Todas</option><option value="ACTIVE">Ativas</option><option value="INACTIVE">Inativas</option><option value="NOCOST">Sem custo</option></select></div></div><div class="pb" style="padding:0" id="fl"></div></div>';
      wireTabs(); q('#nf').onclick = function () { familyEditor(null); }; q('#fq').oninput = debounce(drawFam, 180); q('#fst').onchange = drawFam; drawFam();
      function drawFam() { var qv = normalize(q('#fq').value), st = q('#fst').value, counts = {}; S2.variations.forEach(function (v) { if (v.familyId) counts[v.familyId] = (counts[v.familyId] || 0) + 1; }); var list = S2.families.filter(function (f) { return (!qv || normalize(f.name).indexOf(qv) >= 0) && (st === '' || (st === 'NOCOST' ? f.currentCostAmount == null : f.status === st)); }).sort(function (a, b) { return a.name.localeCompare(b.name); }); q('#fl').innerHTML = list.length ? '<div class="table-wrap"><table><thead><tr><th>Família</th><th>Código</th><th>Custo atual</th><th>SKUs vinculados</th><th>Status</th><th>Custo atualizado</th><th></th></tr></thead><tbody>' + list.map(function (f) { return '<tr><td><b>' + esc(f.name) + '</b></td><td class="mono">' + esc(f.internalCode || '—') + '</td><td>' + (f.currentCostAmount != null ? brl(f.currentCostAmount) : '<span class="badge b-warn">não informado</span>') + '</td><td>' + (counts[f.id] || 0) + '</td><td><span class="badge ' + (f.status === 'ACTIVE' ? 'b-ok' : 'b-neutral') + '">' + (f.status === 'ACTIVE' ? 'Ativa' : 'Inativa') + '</span></td><td class="footnote" style="margin:0">' + (f.costUpdatedAt ? new Date(f.costUpdatedAt).toLocaleString('pt-BR') : '—') + '</td><td><button class="btn-sm" data-fam="' + f.id + '">Editar</button></td></tr>'; }).join('') + '</tbody></table></div>' : '<div class="empty"><div class="ico">⁘</div><p>Nenhuma família. Crie a primeira para atribuir custo.</p></div>'; appEl.querySelectorAll('[data-fam]').forEach(function (b) { b.onclick = function () { familyEditor(S2.families.find(function (x) { return x.id === b.dataset.fam; })); }; }); }
    }
    function familyEditor(fam, onSaved) { var o = overlay('<div class="mh"><h3>' + (fam ? 'Editar família' : 'Nova família') + '</h3><button class="x">×</button></div><div class="mbd" style="max-height:72vh;overflow:auto"><div id="fe"></div><label class="fld">Nome *</label><input class="input" id="fn" value="' + esc(fam ? fam.name : '') + '"><div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><div><label class="fld">Código interno</label><input class="input" id="fc" value="' + esc(fam && fam.internalCode || '') + '"></div><div><label class="fld">Custo (R$)</label><input class="input" id="fcost" value="' + (fam && fam.currentCostAmount != null ? fam.currentCostAmount : '') + '" placeholder="0,00"></div></div><label class="fld">Observações</label><input class="input" id="fnotes" value="' + esc(fam && fam.notes || '') + '"><label class="fld">Status</label><select class="select" id="fss" style="width:100%"><option value="ACTIVE"' + (!fam || fam.status === 'ACTIVE' ? ' selected' : '') + '>Ativa</option><option value="INACTIVE"' + (fam && fam.status === 'INACTIVE' ? ' selected' : '') + '>Inativa</option></select><div class="footnote">Ao alterar o custo, o valor anterior é preservado no histórico e passa a valer para todos os SKUs vinculados.</div>' + (fam && fam.costHistory && fam.costHistory.length ? '<label class="fld">Histórico de custo</label><div class="table-wrap" style="border:1px solid var(--line);border-radius:10px"><table><thead><tr><th>Custo</th><th>Vigente a partir de</th></tr></thead><tbody>' + fam.costHistory.slice().reverse().map(function (h) { return '<tr><td>' + brl(h.costAmount) + '</td><td>' + new Date(h.effectiveFrom).toLocaleString('pt-BR') + '</td></tr>'; }).join('') + '</tbody></table></div>' : '') + '</div><div class="mf"><button class="btn-sm" id="fx">Cancelar</button><button class="btn-sm primary" id="fsv">Salvar</button></div>', 560); o.querySelector('.x').onclick = o.querySelector('#fx').onclick = function () { o.remove(); }; o.querySelector('#fsv').onclick = function () { var n = o.querySelector('#fn').value.trim(); if (!n) { o.querySelector('#fe').innerHTML = '<div class="form-err">Informe o nome.</div>'; return; } var dto = { name: n, internalCode: o.querySelector('#fc').value.trim(), cost: o.querySelector('#fcost').value, notes: o.querySelector('#fnotes').value.trim(), status: o.querySelector('#fss').value }; (fam ? updateFamily(fam, dto).then(function () { return fam; }) : createFamily(dto)).then(function (saved) { o.remove(); render(); toast(fam ? 'Família atualizada' : 'Família criada', n); if (onSaved) onSaved(saved); }); }; }
    function renderImportacoes() { appEl.innerHTML = head('Histórico de importações do catálogo Shopee.') + tabsHtml('importacoes') + '<div class="panel"><div class="ph"><h3>Importações de produtos</h3><span class="footnote" style="margin:0">' + S2.imports.length + ' importação(ões)</span></div><div class="pb" style="padding:0">' + (S2.imports.length ? '<div class="table-wrap"><table><thead><tr><th>Arquivo</th><th>Processados</th><th>Anúncios</th><th>Variações</th><th>Novos</th><th>Atualizados</th><th>Sem alteração</th><th>Erros</th><th>Data</th></tr></thead><tbody>' + S2.imports.map(function (b) { return '<tr><td>' + esc(b.filename) + '</td><td>' + b.total + '</td><td>' + b.productsSeen + '</td><td>' + b.variationsSeen + '</td><td>' + (b.newProducts + b.newVariations) + '</td><td>' + b.updated + '</td><td>' + b.unchanged + '</td><td>' + (b.errors ? '<b style="color:var(--err)">' + b.errors + '</b>' : 0) + '</td><td class="footnote" style="margin:0">' + new Date(b.createdAt).toLocaleString('pt-BR') + '</td></tr>'; }).join('') + '</tbody></table></div>' : '<div class="empty"><div class="ico">⭱</div><p>Nenhuma importação ainda.</p></div>') + '</div></div>'; wireTabs(); }

    return {
      render: render,
      getData: function () { return { products: S2.products, variations: S2.variations, families: S2.families }; },
      load: function () { return Promise.all([dbGetAll('products'), dbGetAll('variations'), dbGetAll('pfamilies'), dbGetAll('pimports')]).then(function (r) { S2.products = r[0]; S2.variations = r[1]; S2.families = r[2]; S2.imports = r[3].sort(function (a, b) { return b.createdAt.localeCompare(a.createdAt); }); reindex(); }); },
      reset: function () { S2.products = []; S2.variations = []; S2.families = []; S2.imports = []; S2.selected.clear(); S2.expanded.clear(); reindex(); },
    };
  }

  // ---------- boot ----------
  document.querySelectorAll('#nav a').forEach(function (a) { a.onclick = function () { route = a.dataset.route; render(); }; });
  var dateInputs = document.getElementById('dateinputs');
  function syncDateUI() { if (dateInputs) dateInputs.className = 'datein' + (periodSel.value === 'custom' ? ' on' : ''); }
  periodSel.onchange = function () { syncDateUI(); if (periodSel.value === 'custom' && !customRange.from && !customRange.to) return; render(); };
  syncDateUI();
  (function bindDates() {
    var f = document.getElementById('dfrom'), t = document.getElementById('dto'), ap = document.getElementById('dapply');
    if (ap) ap.onclick = function () { customRange.from = (f && f.value) || null; customRange.to = (t && t.value) || null; render(); };
  })();
  document.getElementById('btn-demo').onclick = function () { if (confirm('Limpar todos os dados importados deste navegador?')) clearAll().then(function () { orders = []; occ = []; batches = []; plans = []; wallet = []; walletCls = {}; devSel = {}; devCustomStatus = []; acelera = []; aceleraSummary = null; affConv = []; affRpa = []; affVb = []; affMaster = {}; mrRenda = []; mrShip = []; mrAdj = []; mrSvc = []; mrPdf = []; mrSummary = null; mrMetaCfg = { lucroAlvo: 0, periodMode: 'mes_atual', customFrom: null, customTo: null }; shipBip = {}; Produtos.reset(); rebuildSkuCost(); render(); toast('Dados locais limpos', ''); }); };

  // Abre o banco; se falhar (corrompido/bloqueado/privado), ativa o modo em memória e SEGUE —
  // o sistema sempre carrega e Produtos sempre abre (só não salva). Nunca dead-end / tela branca.
  openDB().catch(function (e) { activateMemoryMode(e && (e.message || '') || 'IndexedDB indisponível'); }).then(function () {
    Produtos = makeProdutos({ container: app, put: putMany, getAll: getAll, parse: S.produtos.parse, onChange: rebuildSkuCost });
    return Promise.all([getAll('orders'), getAll('occ'), getAll('batches'), Produtos.load(), getAll('plans'), getAll('wallet'), getAll('walletcls'), getAll('settings'), getAll('acelera'), getAll('affconv'), getAll('affrpa'), getAll('affvb'), getAll('affmaster'), getAll('mrrenda'), getAll('mrship'), getAll('mradj'), getAll('mrsvc'), getAll('mrpdf'), getAll('shipbip')]);
  }).then(function (r) {
    orders = r[0]; occ = (r[1] || []).map(migrateOcc); batches = (r[2] || []).sort(function (a, b) { return b.createdAt.localeCompare(a.createdAt); });
    wallet = r[5] || [];
    walletCls = {}; (r[6] || []).forEach(function (c) { walletCls[c.id] = c; });
    var settings = r[7] || [];
    devCustomStatus = (settings.filter(function (x) { return x.id === 'dev'; })[0] || {}).customStatus || [];
    acelera = r[8] || [];
    var acSum = settings.filter(function (x) { return x.id === 'aceleraSummary'; })[0]; if (acSum) aceleraSummary = acSum.data;
    var acCfg = settings.filter(function (x) { return x.id === 'aceleraCfg'; })[0]; if (acCfg && acCfg.data) Object.keys(acCfg.data).forEach(function (k) { aceleraCfg[k] = acCfg.data[k]; });
    affConv = r[9] || []; affRpa = r[10] || []; affVb = r[11] || []; affMaster = {}; (r[12] || []).forEach(function (mm) { affMaster[mm.id] = mm; });
    mrRenda = r[13] || []; mrShip = r[14] || []; mrAdj = r[15] || []; mrSvc = r[16] || []; mrPdf = r[17] || [];
    var mrS = settings.filter(function (x) { return x.id === 'mrSummary'; })[0]; if (mrS) mrSummary = mrS.data;
    var mrMCfg = settings.filter(function (x) { return x.id === 'mrMetaCfg'; })[0]; if (mrMCfg && mrMCfg.data) Object.keys(mrMCfg.data).forEach(function (k) { mrMetaCfg[k] = mrMCfg.data[k]; });
    shipBip = {}; (r[18] || []).forEach(function (b) { shipBip[b.orderId] = b; });
    var PLAN_MIGR = { PLANNED: 'PLANEJADO', IN_PROGRESS: 'EM_EXECUCAO', IMPLEMENTED: 'MEDINDO', MEASURING: 'MEDINDO', DONE: 'ENCERRADO', DISCARDED: 'ENCERRADO' };
    plans = (r[4] || []).map(function (p) { if (PLAN_MIGR[p.status]) p.status = PLAN_MIGR[p.status]; if (p.scopeSkus == null && p.relatedSkus) p.scopeSkus = p.relatedSkus; if (p.indicatorKind == null) p.indicatorKind = 'liquido'; return p; });
    occ = occ.filter(function (o) { return !o.isDemo; }); // higiene: nunca deixar demo no banco real
    if (occ.length) putMany('occ', occ);
    if (lastImportStamp == null && batches.length) { var last = batches.map(function (b) { return b.createdAt; }).sort().pop(); lastImportStamp = last || null; }
    occ = occ.concat(DEMO_CASES()); // injeta demo apenas em memória (§10-11), depois de persistir os reais
    rebuildSkuCost();
    render();
  }).catch(function (e) { app.innerHTML = '<div class="form-err" style="max-width:640px;margin:24px auto"><b>Não foi possível abrir o banco de dados local.</b><br>' + esc(e.message || e) + '<div style="margin-top:12px"><button class="btn-sm primary" onclick="location.reload()">Recarregar</button></div></div>'; });
})();
