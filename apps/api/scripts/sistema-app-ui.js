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
  var devF = { search: '', internalStatus: '', disputeStatus: '', type: '', status: '', flag: '' }, devPage = 1;
  // Shopee Acelera / Antecipação de Recebíveis
  var acelera = [];                 // registros pedido-a-pedido do relatório de antecipação
  var aceleraSummary = null;        // resumo informado pela própria Shopee (para conciliar)
  var aceleraSub = 'visao';         // sub-aba do módulo
  var aceleraPage = 1;
  var aceleraF = { search: '', status: '', band: '', maturity: '', flag: '' };
  var aceleraSel = { resgate: null };
  var aceleraCfg = { cohortDays: 60, ticketRisco: 25000, metaAntecip: 0.5, aliquotaAlvo: 0.025, limiteDevol: 0.15, capitalProprio: 0, custoOportAA: 0.12, bancoTaxaAM: 0.02, metaCobertura: 12.8, tolAliquota: 0.0015 }; // valores em centavos p/ dinheiro
  var aceleraSim = { pct: 1, ticketMax: 0, aliquota: 'atual', capitalProprio: 0, banco: 0, bancoTaxaAM: 0.02, custoOportAA: 0.12, devol: 'hist' };
  // Afiliados
  var affConv = [], affRpa = [], affVb = [], affMaster = {};
  var affSub = 'visao', affPage = 1;
  var affF = { search: '', channel: '', status: '', ded: '', region: '', basis: 'venda', rateMin: null };
  var affSel = null;
  var affCfg = { rateAlert: 0.15, tolConcil: 100, minPedidos: 5, margemBoa: 0.15, margemAperta: 0.05 };
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
  function newOcc(uid, type) { return { id: uid, type: type, internalStatus: 'NOVA', priority: 'MEDIA', ownerName: null, internalCause: null, causeFamily: null, responsibility: 'NAO_IDENTIFICADA', merchandiseStatus: 'DESCONHECIDO', merchandiseCondition: null, recoverableValue: null, operatorNotes: null, hasDispute: false, disputeStatus: 'NAO_INICIADA', disputeDeadline: null, disputeRespondedAt: null, hasSellerWindow: false, disputeRecovered: null, disputeContested: null, disputeNote: null, disputeReason: null, reasonRevised: null, resolution: null, returnType: null, sellerNote: null, trackingStatus: null, tracking: null, occurredAt: null, orderCreatedAt: null, returnOpenedAt: null, sourceWatermark: null, lastImportAt: null, lastImportFile: null, isDemo: false, receiptState: null, receiptItems: null, receivedBy: null, receivedAt: null, receiptNote: null, events: [], activities: [], impact: { refundedTotal: 0, additionalCostTotal: 0, recoveredTotal: 0, knownNetImpact: 0, cmvAvailable: false } }; }
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
  var STORES = { orders: 'id', occ: 'id', batches: 'id', products: 'id', variations: 'id', pfamilies: 'id', pimports: 'id', plans: 'id', wallet: 'id', walletcls: 'id', settings: 'id', acelera: 'id', affconv: 'id', affrpa: 'id', affvb: 'id', affmaster: 'id' };
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
  function ensureDB() { return DB ? Promise.resolve(DB) : openDB().then(function () { return DB; }); }
  function getAll(store) { return ensureDB().then(function (db) { return new Promise(function (res, rej) { var rq = db.transaction(store).objectStore(store).getAll(); rq.onsuccess = function () { res(rq.result || []); }; rq.onerror = function () { rej(rq.error); }; }); }); }
  function putMany(store, items) { if (!items || !items.length) return Promise.resolve(); return ensureDB().then(function (db) { return new Promise(function (res, rej) { var tx = db.transaction(store, 'readwrite'); var os = tx.objectStore(store); items.forEach(function (it) { os.put(it); }); tx.oncomplete = function () { res(); }; tx.onerror = function () { rej(tx.error); }; }); }); }
  function delOne(store, id) { return ensureDB().then(function (db) { return new Promise(function (res, rej) { var tx = db.transaction(store, 'readwrite'); tx.objectStore(store).delete(id); tx.oncomplete = function () { res(); }; tx.onerror = function () { rej(tx.error); }; }); }); }
  function clearAll() { return ensureDB().then(function (db) { return new Promise(function (res, rej) { var names = Object.keys(STORES); var tx = db.transaction(names, 'readwrite'); names.forEach(function (s) { tx.objectStore(s).clear(); }); tx.oncomplete = function () { res(); }; tx.onerror = function () { rej(tx.error); }; }); }); }

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
    if (p === '7d') return { from: new Date(now - 7 * 864e5) };
    if (p === '15d') return { from: new Date(now - 15 * 864e5) };
    if (p === '30d') return { from: new Date(now - 30 * 864e5) };
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
        var next = { id: id, orderStatus: rep.orderStatus, normalizedStatus: S.pedidos.normalizeStatus(rep.orderStatus), tracking: rep.trackingNumber, createdAt: rep.orderCreatedAt ? new Date(rep.orderCreatedAt).toISOString() : null, returnRefundStatus: rep.returnRefundStatus, cancelReason: rep.cancelReason, city: rep.city, uf: rep.uf, recipientName: rep.recipientName, buyerUsername: rep.buyerUsername, shippingOption: rep.shippingOption, shippingMethod: rep.shippingMethod, totalAmount: num(rep.totalAmount), grandTotal: num(rep.grandTotal), commissionNet: num(rep.commissionNet), serviceFeeNet: num(rep.serviceFeeNet), transactionFee: num(rep.transactionFee), reverseShippingFee: num(rep.reverseShippingFee), estimatedShipping: num(rep.estimatedShipping), buyerPaidShipping: num(rep.buyerPaidShipping), unitsTotal: rep.unitsTotal || items.reduce(function (s, i) { return s + i.qty; }, 0), items: items };
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
      var novo = 0, upd = 0, unch = 0, stale = 0, itemsSeen = 0; var changed = []; var newStatuses = {};
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
        finalizeOcc(ex);
        if (diffs.length) { diffs.forEach(function (d) { var fmt = function (v) { return v == null || v === '' ? '∅' : (typeof v === 'number' ? brl(v) : String(v)); }; addActivity(ex, 'SOURCE', { field: d.label, oldValue: fmt(d.old), newValue: fmt(d.nw), userName: 'Shopee', fileName: file.name, batchId: batchId }); }); upd++; } else { unch++; }
        byId[uid] = ex; changed.push(ex);
      });
      occ = Object.values(byId);
      var label = { RETURN_REFUND: 'Devoluções', ORDER_CANCELLATION: 'Cancelamentos', FAILED_DELIVERY: 'Falhas de entrega' }[type];
      var batch = { id: batchId, module: 'Devolução · ' + label, filename: file.name, createdAt: importedAt, seen: Object.keys(groups).length, itemsSeen: itemsSeen, novo: novo, upd: upd, unch: unch, stale: stale, periodStart: parsed.periodStart ? new Date(parsed.periodStart).toISOString() : null, periodEnd: parsed.periodEnd ? new Date(parsed.periodEnd).toISOString() : null, newStatuses: Object.keys(newStatuses) };
      batches.unshift(batch); lastImportStamp = importedAt;
      return Promise.all([putMany('occ', changed), putMany('batches', [batch])]).then(function () { return batch; });
    });
  }
  function fileInput(cb) { var inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.xlsx,.xls,.csv'; inp.onchange = function () { if (inp.files[0]) cb(inp.files[0]); }; inp.click(); }

  // ============================================================ RENDER (roteamento)
  function setActive() { document.querySelectorAll('#nav a').forEach(function (a) { a.classList.toggle('active', a.dataset.route === route); }); crumb.textContent = { dashboard: 'Dashboard', produtos: 'Produtos', pedidos: 'Pedidos', posvenda: 'Devolução', carteira: 'Saldo da Carteira', acelera: 'Shopee Acelera', afiliados: 'Afiliados', ia: 'Inteligência' }[route] || ''; }
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
      if (route === 'ia') return renderIA();
    } catch (e) { app.innerHTML = renderErrBox('Erro ao abrir esta tela: ' + esc(e && (e.message || e)) + '. Os dados estão salvos — recarregue a página.'); }
  }
  function renderErrBox(msg) { return '<div class="form-err" style="max-width:640px;margin:24px auto"><b>Ops.</b><br>' + msg + '<div style="margin-top:12px"><button class="btn-sm primary" onclick="location.reload()">Recarregar</button></div></div>'; }

  // ---------- DASHBOARD global ----------
  function computeOrderAgg() {
    var list = pedidosInPeriod();
    var agg = { orders: list.length, units: 0, revenue: 0, fees: 0, cost: 0, result: 0, costPending: 0, unlinked: 0, byStatus: {} };
    list.forEach(function (o) { var f = orderFinance(o); agg.units += o.items.reduce(function (s, i) { return s + i.qty; }, 0); agg.revenue += f.revenue; agg.fees += f.marketplaceFeesTotal; agg.cost += f.productCostTotal; if (f.estimatedResult != null) agg.result += f.estimatedResult; else agg.costPending++; if (f._items.some(function (i) { return !i.linked; })) agg.unlinked++; agg.byStatus[o.normalizedStatus] = (agg.byStatus[o.normalizedStatus] || 0) + 1; });
    return agg;
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
      '<div class="subtabs">' + subtab('pedidos', 'pedidos', 'Pedidos') + subtab('pedidos', 'dashboard', 'Dashboard') + subtab('pedidos', 'import', 'Importações') + '</div>' +
      (sub.pedidos === 'dashboard' ? pedidosDashboard() : sub.pedidos === 'import' ? importsFor('Pedidos') : pedidosList());
    document.getElementById('imp-ped').onclick = function () { fileInput(function (f) { importPedidos(f).then(function (b) { render(); toast('Pedidos importados', b.seen + ' pedidos · ' + b.novo + ' novos · ' + b.upd + ' atualizados · ' + b.unch + ' sem alteração'); }).catch(function (e) { toast('Falha', e.message, true); }); }); };
    bindSubtabs('pedidos');
    if (sub.pedidos === 'pedidos') bindPedidosList();
  }
  function pedidosList() {
    var occByOrder = {}; occ.forEach(function (o) { if (o.orderId) occByOrder[o.orderId] = true; });
    var all = pedidosInPeriod();
    var counts = { ALL: all.length };
    ['NAO_PAGO', 'A_ENVIAR', 'ENVIADO', 'CONCLUIDO', 'CANCELADO'].forEach(function (k) { counts[k] = all.filter(function (o) { return o.normalizedStatus === k; }).length; });
    var tabs = S.pedidos.tabs.map(function (t) { return '<div class="tab ' + (pedTab === t.key ? 'active' : '') + '" data-ptab="' + t.key + '">' + t.label + ' <span class="tag">' + nn(counts[t.key] || 0) + '</span></div>'; }).join('');
    var list = pedTab === 'ALL' ? all : all.filter(function (o) { return o.normalizedStatus === pedTab; });
    var qel = document.getElementById('ped-q'); var q = qel ? qel.value : '';
    if (q) { var ql = q.toLowerCase(); list = list.filter(function (o) { return (o.id || '').toLowerCase().indexOf(ql) >= 0 || (o.tracking || '').toLowerCase().indexOf(ql) >= 0 || o.items.some(function (i) { return (i.sku || '').toLowerCase().indexOf(ql) >= 0 || (i.productName || '').toLowerCase().indexOf(ql) >= 0; }); }); }
    if (!all.length) return emptyBox('Nenhum pedido. Importe a planilha "Order.all…" da Shopee.');
    var rows = list.slice(0, 300).map(function (o) {
      var f = orderFinance(o); var prod = o.items.length > 1 ? o.items.length + ' produtos' : (o.items[0] ? esc((o.items[0].productName || '').slice(0, 40)) : '—');
      return '<tr><td class="mono">' + esc(o.id) + '</td><td>' + dbr(o.createdAt) + '</td><td><span class="pill ' + o.normalizedStatus + '">' + esc(S.pedidos.labels[o.normalizedStatus] || o.normalizedStatus) + '</span></td>' +
        '<td>' + prod + (o.items.length > 1 ? ' <span class="tag">multi</span>' : '') + '</td><td>' + brl(f.revenue) + '</td><td style="color:var(--err)">' + brl(f.marketplaceFeesTotal) + '</td>' +
        '<td>' + (f.estimatedResult == null ? '<span class="tag warn">pendente</span>' : '<b style="color:var(--ok)">' + brl(f.estimatedResult) + '</b>') + '</td><td>' + (f.estimatedMarginPct == null ? '—' : pct(f.estimatedMarginPct)) + '</td>' +
        '<td>' + (occByOrder[o.id] ? '<span class="tag warn">devolução</span>' : '') + '</td><td><button class="btn-sm" data-open="' + esc(o.id) + '">Abrir</button></td></tr>';
    }).join('');
    return '<div class="tabs">' + tabs + '</div><div class="toolbar2"><input class="input sm" id="ped-q" style="width:280px" placeholder="Buscar ID, SKU, produto, rastreamento…" value="' + esc(q) + '"></div>' +
      '<div class="count-line"><b>' + nn(list.length) + '</b> pedidos' + (list.length > 300 ? ' (mostrando 300)' : '') + '</div>' +
      '<div class="panel"><div class="table-wrap"><table><thead><tr><th>Pedido</th><th>Data</th><th>Status</th><th>Produto</th><th>Venda</th><th>Taxas</th><th>Lucro est.</th><th>Margem</th><th>Devolução</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div></div>';
  }
  function bindPedidosList() {
    app.querySelectorAll('[data-ptab]').forEach(function (t) { t.onclick = function () { pedTab = t.dataset.ptab; render(); }; });
    var q = document.getElementById('ped-q'); if (q) { var deb; q.oninput = function () { clearTimeout(deb); deb = setTimeout(function () { var v = q.value; renderPedidos(); var el = document.getElementById('ped-q'); if (el) { el.focus(); el.value = v; el.setSelectionRange(v.length, v.length); } }, 200); }; }
    app.querySelectorAll('[data-open]').forEach(function (b) { b.onclick = function () { openOrder(b.dataset.open); }; });
  }
  function pedidosDashboard() {
    var a = computeOrderAgg(); var ticket = a.orders ? a.revenue / a.orders : 0;
    return '<div class="cards6">' + fcard('Venda real', brl(a.revenue), 'blue', nn(a.orders) + ' pedidos') + fcard('Ticket médio', brl(ticket), '') + fcard('Unidades vendidas', nn(a.units), '') + fcard('Taxas marketplace', brl(a.fees), 'red') + fcard('Custo produtos', brl(a.cost), 'amber') + fcard('Resultado estimado', brl(a.result), 'green') + fcard('Margem estimada', a.revenue ? pct((a.result / a.revenue) * 100) : '—', '') + fcard('A enviar', nn(a.byStatus.A_ENVIAR || 0), 'amber') + fcard('Enviados', nn(a.byStatus.ENVIADO || 0), 'blue') + fcard('Concluídos', nn(a.byStatus.CONCLUIDO || 0), 'green') + fcard('Cancelados', nn(a.byStatus.CANCELADO || 0), 'red') + fcard('SKUs sem custo', nn(a.costPending) + ' pedidos', 'amber') + '</div>' + topSkusPanel();
  }
  function topSkusPanel() {
    var map = {};
    pedidosInPeriod().forEach(function (o) { var f = orderFinance(o); o.items.forEach(function (it, i) { if (!it.sku) return; var m = map[it.sku] = map[it.sku] || { sku: it.sku, product: it.productName, units: 0, revenue: 0, result: 0 }; m.units += it.qty; m.revenue += it.subtotal; var r = f._items[i]; if (r && f.estimatedResult != null) m.result += (r.subtotal - r.allocatedFees - (r.costTotal || 0)); }); });
    var top = Object.values(map).sort(function (a, b) { return b.revenue - a.revenue; }).slice(0, 15);
    if (!top.length) return '';
    return '<div class="panel"><div class="ph"><h3>Top SKUs por venda</h3></div><div class="table-wrap"><table><thead><tr><th>SKU</th><th>Produto</th><th>Unid.</th><th>Venda</th><th>Lucro est.</th></tr></thead><tbody>' + top.map(function (m) { return '<tr><td class="mono">' + esc(m.sku) + '</td><td>' + esc((m.product || '').slice(0, 46)) + '</td><td>' + nn(m.units) + '</td><td>' + brl(m.revenue) + '</td><td>' + brl(m.result) + '</td></tr>'; }).join('') + '</tbody></table></div></div>';
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
    d.innerHTML = '<div class="drawer-panel"><div class="dh"><div><b>Pedido ' + esc(o.id) + '</b><div class="footnote" style="margin-top:2px">Shopee · lidermolduras · ' + dbr(o.createdAt) + '</div></div><button class="x">&times;</button></div><div class="dbd">' +
      '<div class="cards6">' + fcard('Venda real', brl(f.revenue), 'blue') + fcard('Valor Total', brl(o.totalAmount), '') + fcard('Taxas marketplace', brl(f.marketplaceFeesTotal), 'red') + fcard('Custo produtos', f.costPending ? '—' : brl(f.productCostTotal), 'amber') + fcard('Lucro estimado', f.estimatedResult == null ? 'pendente' : brl(f.estimatedResult), 'green') + fcard('Margem', f.estimatedMarginPct == null ? '—' : pct(f.estimatedMarginPct), '') + '</div>' +
      '<div class="split"><div><div class="panel"><div class="ph"><h3>Itens do pedido</h3><span class="footnote" style="margin:0">' + o.items.length + '</span></div><div class="pb">' + itemsHtml + '</div></div></div>' +
      '<div><div class="panel"><div class="ph"><h3>Composição financeira</h3></div><div class="pb">' + finLine('Venda real (Σ preço acordado)', f.revenue) + finLine('Valor Total (Shopee)', o.totalAmount) + finLine('Comissão líquida', -o.commissionNet, true) + finLine('Taxa de serviço líquida', -o.serviceFeeNet, true) + finLine('Taxa de transação', -o.transactionFee, true) + finLine('Frete reverso', -o.reverseShippingFee, true) + finLine('Custo produtos', f.costPending ? null : -f.productCostTotal, true) + '<div class="fin-line total"><span>Resultado estimado</span><span class="' + (f.estimatedResult >= 0 ? 'pos' : 'neg') + '">' + (f.estimatedResult == null ? 'pendente (custo)' : brl(f.estimatedResult)) + '</span></div></div></div>' +
      '<div class="panel"><div class="ph"><h3>Logística & cliente</h3></div><div class="pb">' + kv('Status Shopee', o.orderStatus) + kv('Rastreamento', o.tracking) + kv('Envio', (o.shippingOption || '') + ' ' + (o.shippingMethod || '')) + kv('Cidade/UF', (o.city || '—') + '/' + (o.uf || '—')) + kv('Devolução', o.returnRefundStatus || '—') + '</div></div>' +
      (occs.length ? '<div class="panel"><div class="ph"><h3>Devolução vinculada</h3></div><div class="pb">' + occs.map(function (x) { return '<div class="ro" style="margin-bottom:6px">' + esc(x.type) + ' · ' + esc(x.status || '—') + ' · ' + brl(x.requested) + ' <span class="tag">' + x.exposure.bucket + '</span></div>'; }).join('') + '</div></div>' : '') +
      '</div></div></div></div>';
    d.onclick = function (e) { if (e.target === d) d.remove(); }; d.querySelector('.x').onclick = function () { d.remove(); };
    document.body.appendChild(d);
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
    app.querySelectorAll('[data-pv]').forEach(function (b) { b.onclick = function () { fileInput(function (f) { importPosVenda(b.dataset.pv, f).then(function (batch) { render(); toast('Importado', batch.novo + ' novas · ' + batch.upd + ' atualizadas · ' + batch.unch + ' sem alteração' + (batch.stale ? ' · ' + batch.stale + ' ignoradas (relatório antigo)' : '')); }).catch(function (e) { toast('Falha', e.message, true); }); }); }; });
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
    if (t === 'recebimentos') bindRecebimentos();
    if (t === 'casos') bindDevOcc();
    if (t === 'analises') bindAnalises();
    if (t === 'planos') bindPlanos();
  }
  // Barra de período compartilhada por todo o módulo Devolução (§18-19) + selo "atualizado até".
  function devPeriodBar() {
    var opts = [['all', 'Todo o período'], ['today', 'Hoje'], ['7d', 'Últimos 7 dias'], ['15d', 'Últimos 15 dias'], ['30d', 'Últimos 30 dias'], ['month', 'Este mês'], ['prevmonth', 'Mês anterior'], ['custom', 'Personalizado']];
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
  function openConferir(idOrCode) {
    var o = occ.find(function (x) { return x.id === idOrCode; });
    if (!o) { var m = findOccByCode(idOrCode); if (m.length) o = m[0]; }
    if (!o) { toast('Nada encontrado', 'Devolução não localizada.', true); return; }
    var items = (o.items && o.items.length ? o.items : [{ sku: null, productName: '(item único)', qty: 1 }]).map(function (it, i) { return { idx: i, sku: it.sku, productName: it.productName, variationName: it.variationName, expected: it.qty || 1, received: it.qty || 1, condition: 'REAPROVEITAVEL' }; });
    var d = document.createElement('div'); d.className = 'drawer'; var panel = document.createElement('div'); panel.className = 'drawer-panel'; panel.style.width = '720px'; panel.style.maxWidth = '96vw';
    d.appendChild(panel); d.onclick = function (e) { if (e.target === d) d.remove(); }; document.body.appendChild(d);
    function draw() {
      var totExp = items.reduce(function (s, i) { return s + i.expected; }, 0), totRec = items.reduce(function (s, i) { return s + i.received; }, 0);
      var rows = items.map(function (it) {
        return '<tr><td class="cell-text">' + esc(it.productName || '—') + (it.variationName ? ' · ' + esc(it.variationName) : '') + '<div class="footnote" style="margin:0">' + esc(it.sku || '—') + '</div></td><td>' + it.expected + '</td>' +
          '<td class="nowrap"><button class="btn-sm" data-dec="' + it.idx + '">−</button> <b>' + it.received + '</b> <button class="btn-sm" data-inc="' + it.idx + '">+</button></td>' +
          '<td><select class="select sm" data-cond="' + it.idx + '">' + Object.keys(COND_LABELS).map(function (k) { return '<option value="' + k + '"' + (it.condition === k ? ' selected' : '') + '>' + COND_LABELS[k] + '</option>'; }).join('') + '</select></td></tr>';
      }).join('');
      panel.innerHTML = '<div class="dh"><div><b>Conferir devolução ' + esc(o.returnId || o.id) + '</b> <span class="tag info" style="margin-left:6px">Shopee: ' + esc(o.status || '—') + '</span></div><button class="x">&times;</button></div><div class="dbd">' +
        '<div class="footnote" style="margin:0 0 10px">Pedido ' + esc(o.orderId || '—') + ' · Valor envolvido ' + brl(o.requested) + ' · Motivo: ' + esc(o.reason || '—') + '</div>' +
        '<div class="table-wrap"><table><thead><tr><th>Produto / SKU</th><th>Esperado</th><th>Recebido</th><th>Condição</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:14px;flex-wrap:wrap;gap:10px"><div><b>Esperado ' + totExp + '</b> · <b>Recebido ' + totRec + '</b></div>' +
        '<div style="display:flex;gap:8px"><input class="input sm" id="cnote" placeholder="Observação (opcional)" style="width:220px"><button class="btn-sm primary" id="cok">Confirmar recebimento</button></div></div>' +
        '<div class="footnote" style="margin-top:8px">A baixa é manual. O produto só fica "recebido" quando você confirma aqui.</div></div>';
      panel.querySelector('.x').onclick = function () { d.remove(); };
      panel.querySelectorAll('[data-dec]').forEach(function (b) { b.onclick = function () { var it = items[+b.dataset.dec]; it.received = Math.max(0, it.received - 1); draw(); }; });
      panel.querySelectorAll('[data-inc]').forEach(function (b) { b.onclick = function () { var it = items[+b.dataset.inc]; it.received = it.received + 1; draw(); }; });
      panel.querySelectorAll('[data-cond]').forEach(function (s) { s.onchange = function () { items[+s.dataset.cond].condition = s.value; }; });
      panel.querySelector('#cok').onclick = function () { confirmReceive(o, items, (panel.querySelector('#cnote') || {}).value || null, d); };
    }
    draw();
  }
  function confirmReceive(o, items, note, drawerEl) {
    var totExp = items.reduce(function (s, i) { return s + i.expected; }, 0), totRec = items.reduce(function (s, i) { return s + i.received; }, 0);
    var diff = items.some(function (i) { return i.condition === 'DIFERENTE'; });
    var state = diff ? 'DIVERGENCIA' : (totRec === 0 ? 'DIVERGENCIA' : (totRec >= totExp ? 'RECEBIDO' : 'PARCIAL'));
    o.receiptState = state; o.receiptItems = items.slice(); o.receivedBy = 'Operador'; o.receivedAt = new Date().toISOString(); o.receiptNote = note;
    o.merchandiseStatus = (state === 'RECEBIDO' || state === 'PARCIAL') ? 'RECEBIDO' : o.merchandiseStatus;
    o.merchandiseCondition = (items[0] && items[0].condition) || o.merchandiseCondition;
    if (state === 'RECEBIDO' && o.internalStatus === 'NOVA') o.internalStatus = 'RECEBIDO';
    addActivity(o, 'RECEIPT', { message: 'Recebimento: ' + totRec + ' de ' + totExp + ' item(ns) · ' + RECEIPT_LABELS[state] + (note ? ' · ' + note : ''), userName: 'Operador' });
    recomputeOccImpact(o);
    saveOcc(o).then(function () {
      if (drawerEl) drawerEl.remove(); render();
      toast('Recebimento registrado', (o.returnId || o.id) + ' · ' + totRec + ' de ' + totExp + ' · ' + RECEIPT_LABELS[state]);
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
      '<div class="panel"><div class="ph"><h3>Histórico de importações</h3></div><div class="table-wrap"><table><thead><tr><th>Relatório</th><th>Arquivo</th><th>Ocorrências</th><th>Novas</th><th>Atualizadas</th><th>Itens</th><th>Data</th></tr></thead><tbody>' +
      (list.length ? list.map(function (b) { return '<tr><td>' + esc(b.module.replace(/^Devolução · |^Pós-venda · /, '')) + '</td><td>' + esc(b.filename) + '</td><td>' + nn(b.seen) + '</td><td>' + nn(b.novo) + '</td><td>' + nn(b.upd) + '</td><td>' + nn(b.itemsSeen || 0) + '</td><td class="footnote" style="margin:0">' + new Date(b.createdAt).toLocaleString('pt-BR') + '</td></tr>'; }).join('') : '<tr><td colspan="7" class="empty">Nenhuma importação ainda.</td></tr>') +
      '</tbody></table></div></div>' +
      '<div class="footnote">Saúde dos dados: ' + nn(occ.length) + ' ocorrências · ' + nn(occ.filter(function (o) { return (o.items || []).some(function (i) { return i.sku && !i.skuLinked; }); }).length) + ' com SKU não vinculado.</div>';
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
  function devCohortData() {
    var ordByMonth = {}; var ordById = {};
    orders.forEach(function (o) { ordById[o.id] = o; if (o.createdAt) { var k = o.createdAt.slice(0, 7); ordByMonth[k] = (ordByMonth[k] || 0) + 1; } });
    var map = {};
    occ.forEach(function (o) {
      var ord = o.orderId ? ordById[o.orderId] : null;
      var iso = (ord && ord.createdAt) || o.occurredAt; if (!iso) return;
      var k = iso.slice(0, 7);
      var m = map[k] = map[k] || { k: k, occ: 0, loss: 0 };
      m.occ++; m.loss += occEffectiveLoss(o);
    });
    return Object.values(map).sort(function (a, b) { return a.k.localeCompare(b.k); }).map(function (m) {
      var ord = ordByMonth[m.k] || 0; m.orders = ord; m.taxa = ord ? r2(m.occ / ord * 100) : null; m.loss = r2(m.loss); return m;
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
    var chartRows = cohort.map(function (m) { return { label: monthLabel(m.k), bar: m.occ, line: hasTaxa ? (m.taxa || 0) : m.loss }; });
    var trend = cohort.length >= 2 ? chartCard('Evolução das devoluções (por mês do pedido)',
      legendSwatch([['Devoluções', '#2b4bd6'], [hasTaxa ? 'Taxa de devolução %' : 'Perda R$', '#d13b3b']]) + ' <button class="link-btn" data-go="analises" data-asub="evolucao">detalhar</button>',
      svgBarLine(chartRows, { barFmt: nn, lineFmt: hasTaxa ? function (v) { return pct(v); } : function (v) { return brl(v); } })) : '';
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

    return secHead('PANORAMA', 'Como estamos?', 'Estamos melhorando ou piorando, quanto perdemos, por quê e quanto recuperamos.') +
      kstrip([
        { l: 'Taxa de devolução', v: agg.orders ? pct(list.length / agg.orders * 100) : '—', cls: 'blue', s: agg.orders ? nn(list.length) + ' de ' + nn(agg.orders) + ' pedidos' : 'sem base de pedidos' },
        { l: 'Perda confirmada', v: brl(confirmed), cls: 'red', s: agg.revenue ? pct(confirmed / agg.revenue * 100) + ' do faturamento' : '' },
        { l: 'Em risco', v: brl(atRisk), cls: 'amber' },
        { l: 'Recuperado', v: brl(recovered), cls: 'green' },
      ]) +
      denomWarn + achadosHtml + trend +
      '<div class="split2">' + motChart + prodChart + '</div>' +
      finResumo;
  }

  var FLAG_LABELS = { semcausa: 'Sem causa', nova: 'Novas', semresp: 'Sem responsável', naovinc: 'SKU não vinculado', prazo: 'Prazo p/ recorrer' };
  function prazoBadge(o) { if (!o.hasSellerWindow || !o.disputeDeadline) return ''; var dl = new Date(o.disputeDeadline); var days = Math.ceil((dl - Date.now()) / 864e5); if (days < 0) return ' <span class="tag warn">🔴 prazo vencido</span>'; if (days <= 0) return ' <span class="tag warn">⚠️ responder hoje</span>'; if (days <= 3) return ' <span class="tag warn">⚠️ ' + days + 'd p/ recorrer</span>'; return ' <span class="tag info">recorrer até ' + dbr(o.disputeDeadline) + '</span>'; }
  function devOcc() {
    var all = occInPeriodAll().slice();
    if (!all.length) return secHead('CASOS', 'Casos', 'Todos os casos de devolução, cancelamento e falha de entrega em um só lugar.') + emptyBox('Nenhum caso. Importe os relatórios na aba Importações.');
    var typed = devF.type ? all.filter(function (o) { return o.type === devF.type; }) : all;
    // Segunda linha DINÂMICA: status reais presentes na fonte selecionada (§4-15) — nunca inventa.
    var statusCounts = {}; var novoStatus = {}; typed.forEach(function (o) { var raw = o.status || '(sem status)'; statusCounts[raw] = (statusCounts[raw] || 0) + 1; if (o.status && !SHOPEE_STATUS_MAP[normStatus(o.status)]) novoStatus[o.status] = true; });
    var statusList = Object.keys(statusCounts).sort();
    var list = typed;
    if (devF.status) list = list.filter(function (o) { return (o.status || '(sem status)') === devF.status; });
    if (devF.flag === 'prazo') list = list.filter(function (o) { return o.hasSellerWindow && o.disputeDeadline; });
    else if (devF.flag === 'semcausa') list = list.filter(function (o) { return !o.internalCause && !o.causeFamily; });
    else if (devF.flag === 'nova') list = list.filter(function (o) { return o.internalStatus === 'NOVA'; });
    else if (devF.flag === 'semresp') list = list.filter(function (o) { return !o.ownerName; });
    else if (devF.flag === 'naovinc') list = list.filter(function (o) { return (o.items || []).some(function (i) { return i.sku && !i.skuLinked; }); });
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
    var typeChips = [['', 'Todas'], ['RETURN_REFUND', 'Devoluções'], ['ORDER_CANCELLATION', 'Cancelamentos'], ['FAILED_DELIVERY', 'Falhas de entrega']];
    var demoN = typed.filter(function (o) { return o.isDemo; }).length;
    var statusRow = '<div class="chips" style="margin-top:6px"><span class="chip' + (devF.status === '' ? ' chip-on' : '') + '" data-ocstatus="">Todos</span>' + statusList.map(function (raw) { var isNew = raw !== '(sem status)' && !SHOPEE_STATUS_MAP[normStatus(raw)]; return '<span class="chip' + (devF.status === raw ? ' chip-on' : '') + '" data-ocstatus="' + esc(raw) + '" title="' + esc(raw) + '">' + esc(statusLabel(raw)) + (isNew ? ' ✦' : '') + ' <b>' + nn(statusCounts[raw]) + '</b></span>'; }).join('') + '</div>';
    var flagChips = [['', 'Sem filtro rápido'], ['prazo', '⚠️ Prazo p/ recorrer'], ['semcausa', 'Sem causa'], ['nova', 'Novas'], ['semresp', 'Sem responsável'], ['naovinc', 'SKU não vinculado']];
    // Filtro de status interno como chips de multi-seleção (marque quantos quiser).
    var istCounts = {}; typed.forEach(function (o) { istCounts[o.internalStatus] = (istCounts[o.internalStatus] || 0) + 1; });
    var istOrder = Object.keys(ISTMAP).filter(function (k) { return istCounts[k]; }).sort(function (a, b) { return istCounts[b] - istCounts[a]; });
    devCustomStatus.forEach(function (s) { if (s && s.key && istOrder.indexOf(s.key) < 0) istOrder.push(s.key); }); // status personalizados sempre visíveis como filtro
    var istChips = '<div class="chips" style="margin-top:6px"><span class="footnote" style="margin:0 4px 0 0;align-self:center">Status interno:</span><span class="chip' + (!istKeys.length ? ' chip-on' : '') + '" data-ocist="">Todos</span>' + istOrder.map(function (k) { return '<span class="chip' + (istKeys.indexOf(k) >= 0 ? ' chip-on' : '') + '" data-ocist="' + esc(k) + '">' + esc(ISTMAP[k]) + ' <b>' + nn(istCounts[k]) + '</b></span>'; }).join('') + '<span class="chip" data-ocmanage="1" title="Criar, renomear ou remover status internos personalizados">⚙ Gerenciar status</span></div>';
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
    return secHead('CASOS', 'Casos', 'Todos os casos de devolução, cancelamento e falha de entrega em um só lugar. Selecione vários para ações em massa, edite o status na própria linha ou abra o caso.') +
      '<div class="chips">' + typeChips.map(function (c) { return '<span class="chip' + (devF.type === c[0] ? ' chip-on' : '') + '" data-octype="' + c[0] + '">' + c[1] + '</span>'; }).join('') + '</div>' +
      statusRow +
      '<div class="chips" style="margin-top:6px">' + flagChips.map(function (c) { return '<span class="chip' + (devF.flag === c[0] ? ' chip-on' : '') + '" data-ocflag="' + c[0] + '">' + c[1] + '</span>'; }).join('') + '</div>' +
      istChips +
      '<div class="toolbar2" style="margin-top:8px"><input class="input sm" id="devq" style="width:260px" placeholder="Buscar ID da devolução, pedido, produto ou SKU…" value="' + esc(devF.search) + '">' +
      '<select class="select sm" id="devsort"><option value="recent"' + (devF.sort === 'recent' ? ' selected' : '') + '>Mais recentes</option><option value="impact"' + (devF.sort === 'impact' ? ' selected' : '') + '>Maior impacto</option></select></div>' +
      novoNote + demoNote + '<div class="count-line"><b>' + nn(list.length) + '</b> casos' + (selIds.length ? ' · <b>' + nn(selIds.length) + '</b> selecionado(s)' : '') + '</div>' + bulkBar +
      '<div class="panel"><div class="table-wrap"><table class="report"><thead><tr><th style="width:34px"><input type="checkbox" id="devselall"' + (allChecked ? ' checked' : '') + ' title="Selecionar os desta página"></th><th>Pedido / Devolução</th><th>Tipo</th><th>Produto</th><th>Motivo</th><th>Status Shopee</th><th>Status interno</th><th>Recebimento</th><th>Valor</th><th>Ação</th></tr></thead><tbody>' +
      slice.map(function (o) { var it = (o.items || [])[0] || {}; var prod = (it.productName || '—') + (it.variationName ? ' · ' + it.variationName : '') + ((o.items || []).length > 1 ? ' (+' + (o.items.length - 1) + ')' : ''); var rl = REC_LABEL[recGroup(o)];
        var chk = o.isDemo ? '<span class="footnote" style="margin:0">—</span>' : '<input type="checkbox" class="devrowsel" data-selid="' + esc(o.id) + '"' + (devSel[o.id] ? ' checked' : '') + '>';
        var istCell = o.isDemo ? '<span class="pill st-int">' + esc(istLabel(o.internalStatus)) + '</span>' : '<select class="select sm devinlinest" data-inlid="' + esc(o.id) + '" style="min-width:150px">' + Object.keys(ISTMAP).map(function (k) { return '<option value="' + k + '"' + (o.internalStatus === k ? ' selected' : '') + '>' + ISTMAP[k] + '</option>'; }).join('') + '</select>';
        return '<tr' + (o.isDemo ? ' style="background:#fff8ef"' : (devSel[o.id] ? ' style="background:var(--brand-soft,#f2f5ff)"' : '')) + '><td>' + chk + '</td><td class="mono">' + esc(o.orderId || '—') + (o.returnId ? '<div class="footnote" style="margin:0">' + esc(o.returnId) + '</div>' : '') + '</td><td>' + esc(TYPE_LABELS[o.type] || '—') + (o.isDemo ? ' <span class="tag warn">demo</span>' : '') + '</td><td class="cell-text">' + esc(prod) + '<div class="footnote" style="margin:0">' + esc(it.sku || '—') + '</div></td><td class="cell-text">' + esc(o.reason || '—') + '</td><td class="cell-text"><span class="tag ' + (normStatus(o.status).indexOf('disputa') >= 0 ? 'info' : 'neutral') + '">' + esc(statusLabel(o.status)) + '</span>' + prazoBadge(o) + '</td><td>' + istCell + '</td><td><span class="tag ' + rl[1] + '">' + rl[0] + '</span></td><td class="nowrap">' + brl(o.requested) + '</td><td><button class="btn-sm primary" data-oc="' + esc(o.id) + '">Abrir</button></td></tr>'; }).join('') +
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
    app.querySelectorAll('[data-octype]').forEach(function (c) { c.onclick = function () { devF.type = c.dataset.octype; devF.status = ''; devPage = 1; render(); }; });
    app.querySelectorAll('[data-ocstatus]').forEach(function (c) { c.onclick = function () { devF.status = c.dataset.ocstatus; devPage = 1; render(); }; });
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
    var subs = [['impacto', 'Impacto das devoluções'], ['taxas', 'Taxas da venda'], ['areceber', 'A Receber da Shopee'], ['concil', 'Conciliação']];
    if (['impacto', 'taxas', 'areceber', 'concil'].indexOf(finSub) < 0) finSub = 'impacto';
    var inner = finSub === 'taxas' ? devFinTaxas() : finSub === 'areceber' ? devFinAReceber() : finSub === 'concil' ? devFinConcil() : devFinImpacto();
    return '<div class="subtabs" style="margin-bottom:12px">' + subs.map(function (x) { return '<div class="subtab' + (finSub === x[0] ? ' active' : '') + '" data-finsub="' + x[0] + '">' + x[1] + '</div>'; }).join('') + '</div><div>' + inner + '</div>';
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
    var d = document.createElement('div'); d.className = 'drawer drawer-wide';
    var panel = document.createElement('div'); panel.className = 'drawer-panel'; panel.style.width = '940px'; panel.style.maxWidth = '97vw';
    d.appendChild(panel); d.onclick = function (e) { if (e.target === d) d.remove(); }; document.body.appendChild(d);
    function persist(activity) { if (activity) addActivity(o, activity.kind, activity); recomputeOccImpact(o); saveOcc(o).then(draw); }
    function setField(field, value) { var old = o[field]; if ((old == null ? '' : old) === (value == null ? '' : value)) return; o[field] = value; addActivity(o, 'CHANGE', { field: field, oldValue: old == null ? '' : String(old), newValue: value == null ? '' : String(value), userName: 'Operador' }); recomputeOccImpact(o); saveOcc(o).then(function () { draw(); render(); }); }
    function draw() {
      var ord = orders.find(function (x) { return x.id === o.orderId; });
      var sel = function (label, val, map, field) { return '<label class="fld">' + label + '</label><select class="select" data-set="' + field + '" style="width:100%">' + Object.keys(map).map(function (k) { return '<option value="' + k + '"' + (val === k ? ' selected' : '') + '>' + map[k] + '</option>'; }).join('') + '</select>'; };
      var inp = function (label, val, field, ph) { return '<label class="fld">' + label + '</label><input class="input" data-inp="' + field + '" style="width:100%" value="' + esc(val || '') + '" placeholder="' + (ph || '') + '">'; };
      panel.innerHTML = '<div class="dh"><div><b>Ficha — ' + esc(o.orderId || o.id) + '</b> <span class="pill st-int" style="margin-left:8px">' + istLabel(o.internalStatus) + '</span></div><button class="x">&times;</button></div><div class="dbd">' +
        '<div class="cards6">' + fcard('Reembolso', brl(o.impact.refundedTotal), 'red') + fcard('Custos adicionais', brl(o.impact.additionalCostTotal), 'amber') + fcard('Recuperado', brl(o.impact.recoveredTotal), 'green') + fcard('Impacto líquido', o.impact.knownNetImpact == null ? '—' : brl(o.impact.knownNetImpact), 'red', o.impact.cmvAvailable ? '' : 'CMV não disponível') + '</div>' +
        '<div class="split"><div>' +
        '<div class="panel"><div class="ph"><h3>Produto / retorno</h3><span class="tag ' + situacaoCaso(o)[1] + '">' + situacaoCaso(o)[0] + '</span></div><div class="pb">' + kv('Motivo (cliente)', o.reason) + kv('Situação do retorno', RECEIPT_LABELS[o.receiptState] || 'Não iniciado') + '<label class="fld">Itens</label>' + (o.items || []).map(function (i) { return '<div class="ro" style="margin-bottom:4px"><span class="mono">' + esc(i.sku || '—') + '</span> ' + esc(i.productName || '') + (i.variationName ? ' · ' + esc(i.variationName) : '') + (i.skuLinked ? '' : ' <span class="tag warn">não vinc.</span>') + '</div>'; }).join('') + '</div></div>' +
        '<details class="panel" style="padding:0"><summary style="cursor:pointer;padding:12px 16px;font-weight:700">Ver dados originais (Shopee)</summary><div class="pb">' +
        '<label class="fld">Identificação</label>' + kv('Pedido', o.orderId) + kv('Devolução', o.returnId) + (ord ? kv('Status do pedido', S.pedidos.labels[ord.normalizedStatus] || ord.orderStatus || '—') : '') +
        '<label class="fld">Solicitação</label>' + kv('Motivo', o.reason) + (o.reasonRevised ? kv('Motivo revisado', o.reasonRevised) : '') + (o.resolution ? kv('Solução', o.resolution) : '') + (o.returnType ? kv('Tipo', o.returnType) : '') + kv('Status Shopee', o.status) + kv('Data', dbr(o.occurredAt)) +
        '<label class="fld">Logística</label>' + kv('Rastreio', o.tracking) + (o.trackingStatus ? kv('Status do rastreio', o.trackingStatus) : '') +
        (o.hasSellerWindow || o.disputeDeadline ? '<label class="fld">Disputa</label>' + kv('Ação do vendedor até', dbr(o.disputeDeadline)) : '') +
        (o.sellerNote ? '<label class="fld">Observações</label>' + kv('Nota', o.sellerNote) : '') +
        '<label class="fld">Financeiro</label>' + kv('Reembolso solicitado', brl(o.requested)) + kv('Compensação', brl(o.compensation)) +
        '</div></details>' +
        '<div class="panel"><div class="ph"><h3>Impacto financeiro</h3></div><div class="pb">' +
        '<div class="fin-line"><span>Reembolso pago</span><span class="neg">' + brl(o.impact.refundedTotal) + '</span></div><div class="fin-line"><span>Custos adicionais</span><span class="neg">' + brl(o.impact.additionalCostTotal) + '</span></div><div class="fin-line"><span>Recuperações</span><span class="pos">-' + brl(o.impact.recoveredTotal) + '</span></div><div class="fin-line total"><span>Impacto líquido conhecido</span><span class="neg">' + (o.impact.knownNetImpact == null ? '—' : brl(o.impact.knownNetImpact)) + '</span></div>' +
        '<div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap;align-items:center"><select class="select sm" id="evtype">' + Object.keys(EVENT_META).map(function (k) { return '<option value="' + k + '">' + EVENT_META[k].label + '</option>'; }).join('') + '</select><input class="input sm" id="evamt" style="width:100px" placeholder="valor"><button class="btn-sm primary" id="evadd">+ Movimentação</button></div>' +
        (o.events && o.events.length ? '<div style="margin-top:10px">' + o.events.map(function (e) { return '<div class="fin-line"><span>' + (EVENT_META[e.type] ? EVENT_META[e.type].label : e.type) + (e.note ? ' · ' + esc(e.note) : '') + '</span><span class="' + (e.direction === 'RECOVERY' ? 'pos' : 'neg') + '">' + (e.direction === 'RECOVERY' ? '-' : '') + brl(e.amount) + '</span></div>'; }).join('') + '</div>' : '') + '</div></div></div>' +
        '<div><div class="panel"><div class="ph"><h3>Controle interno</h3></div><div class="pb">' + sel('Status interno', o.internalStatus, internalStatusMap(), 'internalStatus') + sel('Prioridade', o.priority, DEV.PRIORITY, 'priority') + inp('Responsável', o.ownerName, 'ownerName', 'nome do responsável') + inp('Causa interna', o.internalCause, 'internalCause', 'ex.: proteção insuficiente do vidro') + inp('Família da causa', o.causeFamily, 'causeFamily', 'ex.: Avaria / Embalagem') + sel('Responsabilidade', o.responsibility, DEV.RESPONSIBILITY, 'responsibility') + sel('Situação da mercadoria', o.merchandiseStatus, DEV.MERCH_STATUS, 'merchandiseStatus') + sel('Condição (se recebida)', o.merchandiseCondition || '', Object.assign({ '': '—' }, DEV.MERCH_COND), 'merchandiseCondition') + inp('Valor recuperável (R$)', o.recoverableValue, 'recoverableValue', '0,00') + '</div></div>' +
        '<div class="panel" id="fichaDisputa"><div class="ph"><h3>Disputa</h3><span class="tag info">' + DEV.DISPUTE_STATUS[o.disputeStatus] + '</span></div><div class="pb"><select class="select" id="dispsel" style="width:100%">' + Object.keys(DEV.DISPUTE_STATUS).map(function (k) { return '<option value="' + k + '"' + (o.disputeStatus === k ? ' selected' : '') + '>' + DEV.DISPUTE_STATUS[k] + '</option>'; }).join('') + '</select><div id="dispextra"></div><button class="btn-sm primary" id="dispsave" style="margin-top:8px">Salvar disputa</button></div></div></div></div>' +
        '<div class="panel"><div class="ph"><h3>Timeline & auditoria</h3></div><div class="pb"><div style="display:flex;gap:6px;margin-bottom:10px"><input class="input sm" id="cmt" style="flex:1" placeholder="Adicionar comentário…"><button class="btn-sm" id="cmtadd">Comentar</button></div>' +
        ((o.activities || []).length ? o.activities.map(function (a) {
          var body = a.kind === 'COMMENT' ? '💬 ' + esc(a.message)
            : a.kind === 'FINANCIAL' ? '💰 ' + esc(a.message)
            : a.kind === 'RECEIPT' ? '📦 ' + esc(a.message || 'Recebimento')
            : a.kind === 'SOURCE' ? '🛰️ Shopee' + (a.field ? ' · ' + esc(a.field) + ': ' + esc(a.oldValue || '∅') + ' → ' + esc(a.newValue || '∅') : ' · ' + esc(a.message || '')) + (a.fileName ? ' <span class="footnote" style="margin:0">(' + esc(a.fileName) + ')</span>' : '')
            : a.kind === 'DISPUTE' ? '⚖️ ' + esc(a.field || '') + ': ' + esc(a.oldValue || '∅') + ' → ' + esc(a.newValue || '∅') + (a.message ? ' · ' + esc(a.message) : '')
            : esc(a.field || '') + ': ' + esc(a.oldValue || '∅') + ' → ' + esc(a.newValue || '∅');
          var who = a.userName === 'Shopee' ? '' : (a.userName ? ' — ' + esc(a.userName) : '');
          return '<div class="fin-line"><span>' + body + who + '</span><span class="footnote" style="margin:0">' + new Date(a.createdAt).toLocaleString('pt-BR') + '</span></div>';
        }).join('') : '<div class="footnote">Sem atividade ainda.</div>') + '</div></div>' +
        '</div>';
      panel.querySelector('.x').onclick = function () { d.remove(); };
      panel.querySelectorAll('[data-set]').forEach(function (s) { s.onchange = function () { setField(s.dataset.set, s.value || (s.dataset.set === 'merchandiseCondition' ? null : s.value)); }; });
      panel.querySelectorAll('[data-inp]').forEach(function (i) { i.onblur = function () { var field = i.dataset.inp; var val = field === 'recoverableValue' ? (i.value === '' ? null : Number(i.value.replace(',', '.'))) : (i.value || null); setField(field, val); }; });
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
    var vals = []; points.forEach(function (p) { vals.push(p.a); if (p.b != null) vals.push(p.b); });
    var mn = Math.min.apply(null, vals.concat([0])), mx = Math.max.apply(null, vals.concat([0])); if (mx === mn) mx = mn + 1;
    var x = function (i) { return padL + i * (W - padL - padR) / (points.length - 1); }; var y = function (v) { return H - padB - (v - mn) / (mx - mn) * (H - padB - padT); };
    var zero = mn < 0 && mx > 0 ? '<line x1="' + padL + '" y1="' + y(0).toFixed(1) + '" x2="' + (W - padR) + '" y2="' + y(0).toFixed(1) + '" stroke="#e2e8f0" stroke-dasharray="3 3"/>' : '';
    var lineA = '<polyline points="' + points.map(function (p, i) { return x(i).toFixed(1) + ',' + y(p.a).toFixed(1); }).join(' ') + '" fill="none" stroke="#2b4bd6" stroke-width="2.5"/>';
    var lineB = opt.two ? '<polyline points="' + points.map(function (p, i) { return x(i).toFixed(1) + ',' + y(p.b || 0).toFixed(1); }).join(' ') + '" fill="none" stroke="#e0662a" stroke-width="2" stroke-dasharray="4 3"/>' : '';
    var labels = ''; var step = Math.ceil(points.length / 6); points.forEach(function (p, i) { if (i % step === 0 || i === points.length - 1) labels += '<text x="' + x(i).toFixed(1) + '" y="' + (H - 8) + '" font-size="10" fill="#64708a" text-anchor="middle">' + esc(p.label) + '</text>'; });
    var yl = '<text x="8" y="' + (y(mx) + 4).toFixed(1) + '" font-size="10" fill="#64708a">' + brl(mx) + '</text><text x="8" y="' + (y(mn) + 4).toFixed(1) + '" font-size="10" fill="#64708a">' + brl(mn) + '</text>';
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" style="max-width:' + W + 'px">' + zero + lineA + lineB + labels + yl + '</svg>';
  }
  function walletSaldoSeries() {
    var byDay = {}; wallet.filter(function (t) { return t.date && inPeriod(t.date); }).sort(function (a, b) { return a.date.localeCompare(b.date); }).forEach(function (t) { var d = t.date.slice(0, 10); if (!byDay[d]) byDay[d] = { label: monthDayLabel(d), a: null, b: null }; if (t.balance != null) byDay[d].a = t.balance; if (t.adjust != null) byDay[d].b = t.adjust; });
    var arr = Object.keys(byDay).sort().map(function (k) { return byDay[k]; }); var lastA = 0, lastB = 0; arr.forEach(function (p) { if (p.a == null) p.a = lastA; else lastA = p.a; if (p.b == null) p.b = lastB; else lastB = p.b; }); return arr;
  }
  function monthDayLabel(d) { var p = d.split('-'); return p[2] + '/' + p[1]; }
  var RECON_LABEL = { FECHADO: ['Fechado', 'ok'], EXPLICADO: ['Explicado', 'info'], PROVAVEL: ['Provável ajuste', 'warn'], DIVERGENTE: ['Divergente', 'warn'] };

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
    return secHead('SALDO DA CARTEIRA', 'Raio-X da carteira', 'Onde o dinheiro está vazando: quanto, quantas vezes, por quê, em quais pedidos, de quem é a responsabilidade e o que ainda não conseguimos explicar.') +
      band + conf + bloco2 + bloco3 + bloco4 + bloco5 + bloco6 + chart;
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
  function acBand(rate) { var tol = aceleraCfg.tolAliquota; if (rate === 0) return '—'; if (Math.abs(rate - 0.025) <= tol) return '2.5%'; if (Math.abs(rate - 0.035) <= tol) return '3.5%'; if (Math.abs(rate - 0.02) <= tol) return '2.0%'; return 'outra'; }
  var AC_STATUS_LABELS = { 'antecipacao paga': 'Antecipação paga', 'totalmente pago': 'Totalmente pago', 'antecipacao parcialmente reembolsada': 'Parcialmente reembolsada', 'antecipacao totalmente reembolsada': 'Totalmente reembolsada' };
  function acStatusLabel(s) { return AC_STATUS_LABELS[normStatus(s)] || s || '—'; }

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
      var batch = { id: 'ac' + Date.now() + Math.round(performance.now()), module: 'Shopee Acelera', filename: file.name, createdAt: importedAt, seen: parsed.rows.length, novo: novo, upd: upd, unch: unch, itemsSeen: parsed.rows.length };
      batches.unshift(batch); lastImportStamp = importedAt;
      return Promise.all([putMany('acelera', changed), putMany('batches', [batch]), putMany('settings', [{ id: 'aceleraSummary', data: aceleraSummary }])]).then(function () { return { batch: batch, novo: novo, upd: upd, unch: unch }; });
    });
  }
  function saveAceleraCfg() { return putMany('settings', [{ id: 'aceleraCfg', data: aceleraCfg }]); }

  // ---- motor determinístico ----
  function aceleraByResgate(recs) {
    var map = {}; recs.forEach(function (r) { var g = map[r.resgate] = map[r.resgate] || { resgate: r.resgate, data: r.data, n: 0, antec: 0, taxa: 0, receb: 0, reemb: 0, pend: 0, maxUlt: '' }; g.n++; g.antec += r.antecipado; g.taxa += r.taxa; g.receb += r.recebido; g.reemb += r.reembolsado; g.pend += r.pendente; if (r.data < g.data) g.data = r.data; if ((r.ultimaTransacao || '') > g.maxUlt) g.maxUlt = r.ultimaTransacao; });
    return Object.keys(map).map(function (k) { var g = map[k]; g.rate = g.antec ? g.taxa / g.antec : 0; g.band = acBand(g.rate); return g; }).sort(function (a, b) { return (a.data || '').localeCompare(b.data || ''); });
  }
  function aceleraMetrics(recs) {
    var m = { n: recs.length, volume: 0, taxa: 0, receb: 0, reemb: 0, pend: 0, restante: 0, taxaReemb: 0, taxaRisco: 0 };
    var status = {}, anomalies = [];
    var reembF = 0, riscoF = 0;
    recs.forEach(function (r) {
      m.volume += r.antecipado; m.taxa += r.taxa; m.receb += r.recebido; m.reemb += r.reembolsado; m.pend += r.pendente; m.restante += r.restante;
      status[normStatus(r.status)] = (status[normStatus(r.status)] || 0) + 1;
      if (r.antecipado > 0) { reembF += r.taxa * r.reembolsado / r.antecipado; riscoF += r.taxa * r.pendente / r.antecipado; }
      var an = null;
      if (r.antecipado <= 0) an = 'Valor antecipado zero ou negativo';
      else if (r.reembolsado > r.antecipado + 1) an = 'Reembolso maior que o antecipado';
      else if (r.pendente > r.antecipado + 1) an = 'Pendência maior que o antecipado';
      else if (r.taxa < 0) an = 'Taxa negativa';
      else if (acBand(r.antecipado ? r.taxa / r.antecipado : 0) === 'outra') an = 'Alíquota fora dos padrões (investigar)';
      if (an) anomalies.push({ r: r, type: an });
    });
    m.taxaReemb = Math.round(reembF); m.taxaRisco = Math.round(riscoF);
    m.aliquota = m.volume ? m.taxa / m.volume : 0;
    m.status = status; m.anomalies = anomalies;
    m.byResgate = aceleraByResgate(recs);
    // dias até liquidação
    var diasPago = [], diasReemb = [], idadePend = [];
    recs.forEach(function (r) { if (acIsFullyPaid(r)) { var d = acDays(r.data, r.ultimaTransacao); if (d != null && d >= 0) diasPago.push(d); } else if (acIsReemb(r)) { var d2 = acDays(r.data, r.ultimaTransacao); if (d2 != null && d2 >= 0) diasReemb.push(d2); } else { var a = acAgeDays(r.data); if (a != null) idadePend.push(a); } });
    var avg = function (a) { return a.length ? a.reduce(function (s, x) { return s + x; }, 0) / a.length : null; };
    var med = function (a) { if (!a.length) return null; var s = a.slice().sort(function (x, y) { return x - y; }); var mid = Math.floor(s.length / 2); return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2; };
    m.diasPagoAvg = avg(diasPago); m.diasPagoMed = med(diasPago); m.diasReembAvg = avg(diasReemb); m.idadePendAvg = avg(idadePend); m.nPago = diasPago.length; m.nReemb = diasReemb.length; m.nPend = idadePend.length;
    // coorte madura
    var mad = recs.filter(function (r) { return acAgeDays(r.data) != null && acAgeDays(r.data) >= aceleraCfg.cohortDays; });
    var madAntec = mad.reduce(function (s, r) { return s + r.antecipado; }, 0), madReemb = mad.reduce(function (s, r) { return s + r.reembolsado; }, 0);
    m.cohortMaduraN = mad.length; m.cohortMaduraAntec = madAntec; m.cohortMaduraReemb = madReemb; m.cohortDevolRate = madAntec ? madReemb / madAntec : 0;
    // custo equivalente anual (usa dias médios de pedidos pagos)
    var diasEq = m.diasPagoAvg || m.diasPagoMed || null;
    m.custoEquivAnual = (diasEq && m.aliquota < 1 && diasEq > 0) ? (Math.pow(1 / (1 - m.aliquota), 365 / diasEq) - 1) : null;
    m.diasEq = diasEq;
    // custo projetado 12m: média mensal da taxa * 12
    var months = aceleraMonths(recs); m.monthsSpan = months.length || 1;
    m.taxaMensalMedia = Math.round(m.taxa / m.monthsSpan); m.custoProj12m = m.taxaMensalMedia * 12;
    m.volumeMensalMedio = Math.round(m.volume / m.monthsSpan);
    // capital necessário para independência (receita realizável média/30 * prazo médio liberação)
    var realizavelMensal = Math.round(m.volumeMensalMedio * (1 - m.cohortDevolRate));
    var prazo = m.diasPagoMed || m.diasPagoAvg || 0;
    m.capitalNecessario = Math.round(realizavelMensal / 30 * prazo);
    m.prazoLiberacao = prazo; m.realizavelMensal = realizavelMensal;
    m.capitalProprio = aceleraCfg.capitalProprio || 0;
    m.coberturaDias = realizavelMensal ? (m.capitalProprio / (realizavelMensal / 30)) : 0;
    return m;
  }
  function aceleraMonths(recs) { var mm = {}; recs.forEach(function (r) { if (r.data) mm[r.data.slice(0, 7)] = 1; }); return Object.keys(mm).sort(); }
  function aceleraInPeriodAll() { return acelera; } // o módulo tem período próprio; não filtra por padrão (§5)

  function renderAcelera() {
    var tabs = [['visao', 'Visão Geral'], ['antecipacoes', 'Antecipações'], ['desperdicio', 'Devoluções & Desperdício'], ['aliquotas', 'Alíquotas'], ['coortes', 'Coortes'], ['capital', 'Capital & Simulador'], ['plano', 'Plano de Ação'], ['auditoria', 'Auditoria'], ['config', 'Configurações']];
    app.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap"><div class="subtabs" style="margin-bottom:0;overflow-x:auto">' + tabs.map(function (t) { return '<div class="subtab' + (aceleraSub === t[0] ? ' active' : '') + '" data-acsub="' + t[0] + '">' + t[1] + '</div>'; }).join('') + '</div><button class="btn-sm primary" data-acimport="1">Importar Shopee Acelera</button></div><div id="acbody" style="margin-top:14px"></div>';
    var body = document.getElementById('acbody');
    try {
      if (!acelera.length && aceleraSub !== 'config') body.innerHTML = secHead('SHOPEE ACELERA', 'Antecipação de Recebíveis', 'Quanto antecipamos, quanto pagamos, qual a alíquota real, quanto disso virou desperdício com devolução e qual decisão de capital é mais barata.') + emptyBox('Nenhum relatório Shopee Acelera importado. Clique em “Importar Shopee Acelera” e envie o CSV de antecipação de recebíveis.') + '<div style="text-align:center;margin-top:-8px"><button class="btn-sm primary" id="acimp">Importar primeiro relatório</button></div>';
      else body.innerHTML = ({ visao: aceleraVisao, antecipacoes: aceleraAntecipacoes, desperdicio: aceleraDesperdicio, aliquotas: aceleraAliquotas, coortes: aceleraCoortes, capital: aceleraCapital, plano: aceleraPlano, auditoria: aceleraAuditoria, config: aceleraConfig }[aceleraSub] || aceleraVisao)();
    } catch (e) { body.innerHTML = '<div class="form-err">Erro ao renderizar o Shopee Acelera: ' + esc(e.message || e) + '</div>'; }
    app.querySelectorAll('[data-acsub]').forEach(function (b) { b.onclick = function () { aceleraSub = b.dataset.acsub; aceleraPage = 1; render(); }; });
    var imp = function () { fileInput(function (f) { importAcelera(f).then(function (b) { render(); toast('Importação concluída', b.novo + ' novos · ' + b.upd + ' atualizados · ' + b.unch + ' sem alteração'); }).catch(function (e) { toast('Falha', e.message, true); }); }); };
    app.querySelectorAll('[data-acimport]').forEach(function (b) { b.onclick = imp; });
    var ai = document.getElementById('acimp'); if (ai) ai.onclick = imp;
    app.querySelectorAll('[data-acgo]').forEach(function (b) { b.onclick = function () { aceleraSub = b.dataset.acgo; if (b.dataset.acflag != null) aceleraF.flag = b.dataset.acflag; render(); }; });
    app.querySelectorAll('[data-acresg]').forEach(function (b) { b.onclick = function () { aceleraSel.resgate = b.dataset.acresg; openAceleraResgate(b.dataset.acresg); }; });
    app.querySelectorAll('[data-acped]').forEach(function (b) { b.onclick = function () { openAceleraPedido(b.dataset.acped); }; });
    if (aceleraSub === 'antecipacoes') bindAceleraAntec();
    if (aceleraSub === 'capital') bindAceleraSim();
    if (aceleraSub === 'config') bindAceleraConfig();
    if (aceleraSub === 'auditoria') bindAceleraAud();
  }

  function acKpiHelp(label, help) { return '<span title="' + esc(help) + '" style="cursor:help;border-bottom:1px dotted var(--muted)">' + esc(label) + '</span>'; }
  function aceleraVisao() {
    var m = aceleraMetrics(acelera);
    var recon = aceleraReconcile(m);
    var head = secHead('SHOPEE ACELERA', 'Antecipação de Recebíveis', 'Central de inteligência da antecipação: quanto pagamos, por quê, quais pedidos originaram o custo, quanto voltou, quanto está em risco e qual decisão de capital é mais barata.');
    var strip1 = kstrip([
      { l: 'Volume antecipado', v: brlC(m.volume), cls: 'blue', s: nn(m.n) + ' pedidos · ' + nn(m.byResgate.length) + ' resgates' },
      { l: 'Taxa paga', v: brlC(m.taxa), cls: 'red' },
      { l: 'Alíquota efetiva', v: pct(r2(m.aliquota * 100)), cls: 'amber', s: 'média ponderada' },
      { l: 'Líquido recebido', v: brlC(m.receb), cls: 'green' },
      { l: 'Reembolsado', v: brlC(m.reemb), cls: 'amber' },
      { l: 'Pendente', v: brlC(m.pend), cls: 'blue' },
    ]);
    var strip2 = kstrip([
      { l: 'Taxa vinculada a reembolsos', v: brlC(m.taxaReemb), cls: 'red', s: pct(r2(m.taxa ? m.taxaReemb / m.taxa * 100 : 0)) + ' da taxa' },
      { l: 'Taxa em risco (pendências)', v: brlC(m.taxaRisco), cls: 'amber', s: 'não é perda realizada' },
      { l: 'Custo projetado 12 meses', v: brlC(m.custoProj12m), cls: 'red', s: brlC(m.taxaMensalMedia) + '/mês' },
      { l: 'Custo equivalente a.a.', v: m.custoEquivAnual == null ? 'sem base' : pct(r2(m.custoEquivAnual * 100)), cls: 'amber', s: m.diasEq ? 'p/ ' + Math.round(m.diasEq) + ' dias médios' : '' },
      { l: 'Capital p/ independência', v: brlC(m.capitalNecessario), cls: 'blue', s: 'ver Capital & Simulador' },
      { l: 'Devolução coorte madura', v: pct(r2(m.cohortDevolRate * 100)), cls: 'amber', s: nn(m.cohortMaduraN) + ' pedidos ≥' + aceleraCfg.cohortDays + 'd' },
    ]);
    // onde está vazando
    var leaks = aceleraLeaks(m);
    var leakRows = leaks.map(function (l, i) { return '<tr class="rowlink"' + (l.go ? ' data-acgo="' + l.go + '"' : '') + '><td>' + (i + 1) + '</td><td>' + esc(l.label) + '</td><td class="neg"><b>' + (l.money ? brlC(l.money) : esc(l.txt || '')) + '</b></td><td class="cell-text footnote" style="margin:0">' + esc(l.hint || '') + '</td></tr>'; }).join('');
    var vaz = '<div class="panel"><div class="ph"><h3>Onde está vazando o dinheiro</h3><span class="footnote" style="margin:0">ordenado por impacto</span></div><div class="table-wrap"><table class="report"><thead><tr><th>#</th><th>Causa</th><th>Impacto</th><th>Observação</th></tr></thead><tbody>' + (leakRows || '<tr><td colspan="4" class="empty">Sem dados.</td></tr>') + '</tbody></table></div></div>';
    // o que fazer agora
    var acts = aceleraActions(m);
    var doNow = acts.length ? '<div class="panel"><div class="ph"><h3>O que fazer agora?</h3></div><div class="pb">' + acts.map(function (a) { return '<div class="fin-line"><span>' + a.icon + ' ' + a.text + '</span>' + (a.go ? '<button class="btn-sm" data-acgo="' + a.go + '">abrir</button>' : '') + '</div>'; }).join('') + '</div></div>' : '';
    return head + recon + strip1 + strip2 + vaz + doNow;
  }
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
  function aceleraLeaks(m) {
    var leaks = [];
    if (m.taxaReemb > 0) leaks.push({ label: 'Taxa paga em pedidos que depois devolveram', money: m.taxaReemb, go: 'desperdicio', hint: 'antecipamos e pagamos taxa, mas o pedido voltou' });
    // impacto de alíquota (3.5 vs 2.5)
    var band35 = m.byResgate.filter(function (g) { return g.band === '3.5%'; }); var vol35 = band35.reduce(function (s, g) { return s + g.antec; }, 0);
    if (vol35 > 0) { var econ = Math.round(vol35 * (0.035 - 0.025)); leaks.push({ label: 'Alíquota a 3,5% (vs 2,5%) sobre ' + brlC(vol35), money: econ, go: 'aliquotas', hint: 'diferença de alíquota no volume já antecipado a 3,5%' }); }
    if (m.taxaRisco > 0) leaks.push({ label: 'Taxa em risco por pendências em aberto', money: m.taxaRisco, go: 'desperdicio', hint: 'ainda não é perda — depende do desfecho' });
    return leaks.sort(function (a, b) { return (b.money || 0) - (a.money || 0); }).slice(0, 6);
  }
  function aceleraActions(m) {
    var a = [];
    var band35 = m.byResgate.filter(function (g) { return g.band === '3.5%'; }); var vol35 = band35.reduce(function (s, g) { return s + g.antec; }, 0);
    if (vol35 > 0) a.push({ icon: '🔴', text: 'A alíquota atual inclui 3,5%. Voltar a 2,5% no volume atual economizaria ~' + brlC(Math.round(vol35 * (0.035 - 0.025))) + ' no período.', go: 'aliquotas' });
    if (m.taxaReemb > 0) a.push({ icon: '🟠', text: brlC(m.taxaReemb) + ' de taxa foram pagos em pedidos que depois devolveram. Ver os piores produtos/faixas.', go: 'desperdicio' });
    if (m.capitalProprio > 0 && m.capitalNecessario > 0 && m.capitalProprio < m.capitalNecessario) a.push({ icon: '🟢', text: 'Faltam ' + brlC(m.capitalNecessario - m.capitalProprio) + ' de colchão para reduzir a dependência da antecipação.', go: 'capital' });
    a.push({ icon: '🔎', text: 'Simular cenários de corte de antecipação e comparar com capital próprio/bancário.', go: 'capital' });
    return a;
  }

  function aceleraAntecipacoes() {
    var gs = aceleraByResgate(acelera).sort(function (a, b) { return (b.data || '').localeCompare(a.data || ''); });
    if (aceleraF.band) gs = gs.filter(function (g) { return g.band === aceleraF.band; });
    if (aceleraF.search) { var q = aceleraF.search.toLowerCase(); gs = gs.filter(function (g) { return g.resgate.toLowerCase().indexOf(q) >= 0; }); }
    var pages = Math.max(1, Math.ceil(gs.length / 25)); if (aceleraPage > pages) aceleraPage = pages; var slice = gs.slice((aceleraPage - 1) * 25, aceleraPage * 25);
    var bands = [['', 'Todas'], ['2.5%', '2,5%'], ['3.5%', '3,5%'], ['outra', 'Outra / investigar']];
    var head = secHead('ACELERA · ANTECIPAÇÕES', 'Auditoria por resgate', 'Cada lote de antecipação: valor, taxa, alíquota efetiva, líquido, reembolsado e pendente. Clique para ver os pedidos.');
    var rows = slice.map(function (g) { return '<tr class="rowlink" data-acresg="' + esc(g.resgate) + '"><td class="nowrap">' + esc(dbr(g.data)) + '</td><td class="mono">' + esc(g.resgate) + '</td><td>' + nn(g.n) + '</td><td class="nowrap">' + brlC(g.antec) + '</td><td class="nowrap">' + brlC(g.taxa) + '</td><td><span class="tag ' + (g.band === 'outra' ? 'warn' : 'neutral') + '">' + pct(r2(g.rate * 100)) + (g.band !== 'outra' && g.band !== '—' ? ' (' + g.band + ')' : '') + '</span></td><td class="nowrap">' + brlC(g.receb) + '</td><td class="nowrap ' + (g.reemb ? 'neg' : '') + '">' + brlC(g.reemb) + '</td><td class="nowrap">' + brlC(g.pend) + '</td><td><button class="btn-sm" data-acresg="' + esc(g.resgate) + '">Abrir</button></td></tr>'; }).join('');
    return head +
      '<div class="chips">' + bands.map(function (c) { return '<span class="chip' + (aceleraF.band === c[0] ? ' chip-on' : '') + '" data-acband="' + c[0] + '">' + c[1] + '</span>'; }).join('') + '</div>' +
      '<div class="toolbar2" style="margin-top:8px"><input class="input sm" id="acq" style="width:280px" placeholder="Buscar ID do resgate…" value="' + esc(aceleraF.search) + '"></div>' +
      '<div class="count-line"><b>' + nn(gs.length) + '</b> resgates</div>' +
      '<div class="panel"><div class="table-wrap"><table class="report"><thead><tr><th>Data</th><th>ID resgate</th><th>Pedidos</th><th>Antecipado</th><th>Taxa</th><th>Alíquota</th><th>Recebido</th><th>Reembolsado</th><th>Pendente</th><th></th></tr></thead><tbody>' + (rows || '<tr><td colspan="10" class="empty">Nenhum resgate neste filtro.</td></tr>') + '</tbody></table></div></div>' +
      (pages > 1 ? '<div style="display:flex;gap:8px;justify-content:flex-end;align-items:center"><button class="btn-sm" id="acprev"' + (aceleraPage <= 1 ? ' disabled' : '') + '>Anterior</button><span class="footnote" style="margin:0">página ' + aceleraPage + ' de ' + pages + '</span><button class="btn-sm" id="acnext"' + (aceleraPage >= pages ? ' disabled' : '') + '>Próxima</button></div>' : '');
  }
  function bindAceleraAntec() {
    app.querySelectorAll('[data-acband]').forEach(function (c) { c.onclick = function () { aceleraF.band = c.dataset.acband; aceleraPage = 1; render(); }; });
    var q = document.getElementById('acq'); if (q) { var t; q.oninput = function () { clearTimeout(t); t = setTimeout(function () { var v = q.value; aceleraF.search = v; aceleraPage = 1; render(); var el = document.getElementById('acq'); if (el) { el.focus(); el.value = v; el.setSelectionRange(v.length, v.length); } }, 220); }; }
    var pv = document.getElementById('acprev'); if (pv) pv.onclick = function () { if (aceleraPage > 1) { aceleraPage--; render(); } };
    var nx = document.getElementById('acnext'); if (nx) nx.onclick = function () { aceleraPage++; render(); };
  }
  function openAceleraResgate(rid) {
    var recs = acelera.filter(function (r) { return r.resgate === rid; });
    var d = document.createElement('div'); d.className = 'drawer'; var panel = document.createElement('div'); panel.className = 'drawer-panel'; panel.style.width = '820px'; panel.style.maxWidth = '97vw';
    d.appendChild(panel); d.onclick = function (e) { if (e.target === d) d.remove(); }; document.body.appendChild(d);
    var g = aceleraByResgate(recs)[0] || { antec: 0, taxa: 0, rate: 0, receb: 0, reemb: 0, pend: 0 };
    var rows = recs.sort(function (a, b) { return b.antecipado - a.antecipado; }).slice(0, 400).map(function (r) { return '<tr class="rowlink" data-acped="' + esc(r.pedido) + '"><td class="mono">' + esc(r.pedido) + '</td><td class="nowrap">' + brlC(r.antecipado) + '</td><td class="nowrap">' + brlC(r.taxa) + '</td><td class="nowrap">' + brlC(r.recebido) + '</td><td class="nowrap ' + (r.reembolsado ? 'neg' : '') + '">' + brlC(r.reembolsado) + '</td><td class="nowrap">' + brlC(r.pendente) + '</td><td><span class="tag ' + (acIsReemb(r) ? 'warn' : acIsFullyPaid(r) ? 'ok' : 'neutral') + '">' + esc(acStatusLabel(r.status)) + '</span></td></tr>'; }).join('');
    panel.innerHTML = '<div class="dh"><div><b>Resgate ' + esc(rid) + '</b> <span class="tag ' + (g.band === 'outra' ? 'warn' : 'neutral') + '" style="margin-left:6px">alíquota ' + pct(r2(g.rate * 100)) + '</span></div><button class="x">&times;</button></div><div class="dbd">' +
      '<div class="kstrip" style="margin-bottom:12px"><div class="kc"><div class="kl">Antecipado</div><div class="kv" style="font-size:16px">' + brlC(g.antec) + '</div></div><div class="kc"><div class="kl">Taxa</div><div class="kv" style="font-size:16px">' + brlC(g.taxa) + '</div></div><div class="kc"><div class="kl">Recebido</div><div class="kv" style="font-size:16px">' + brlC(g.receb) + '</div></div><div class="kc"><div class="kl">Reembolsado</div><div class="kv" style="font-size:16px">' + brlC(g.reemb) + '</div></div></div>' +
      '<div class="panel"><div class="ph"><h3>' + nn(recs.length) + ' pedidos neste resgate</h3></div><div class="table-wrap"><table class="report"><thead><tr><th>Pedido</th><th>Antecipado</th><th>Taxa</th><th>Recebido</th><th>Reembolsado</th><th>Pendente</th><th>Status</th></tr></thead><tbody>' + rows + '</tbody></table></div></div></div>';
    panel.querySelector('.x').onclick = function () { d.remove(); };
    panel.querySelectorAll('[data-acped]').forEach(function (b) { b.onclick = function () { openAceleraPedido(b.dataset.acped); }; });
  }
  function openAceleraPedido(pid) {
    var recs = acelera.filter(function (r) { return r.pedido === pid; }); if (!recs.length) return; var r = recs[0];
    var ord = orders.find(function (o) { return o.id === pid; }); var oc = occ.find(function (o) { return !o.isDemo && o.orderId === pid; });
    var d = document.createElement('div'); d.className = 'drawer'; var panel = document.createElement('div'); panel.className = 'drawer-panel'; panel.style.width = '640px'; panel.style.maxWidth = '96vw';
    d.appendChild(panel); d.onclick = function (e) { if (e.target === d) d.remove(); }; document.body.appendChild(d);
    var taxaReemb = r.antecipado ? Math.round(r.taxa * r.reembolsado / r.antecipado) : 0; var taxaRisco = r.antecipado ? Math.round(r.taxa * r.pendente / r.antecipado) : 0;
    var it = ord ? (ord.items || [])[0] || {} : {};
    var pedBlock = ord ? '<div class="panel"><div class="ph"><h3>Pedido (do módulo Pedidos)</h3></div><div class="pb">' + kv('Produto', it.productName || '—') + kv('SKU', it.sku || '—') + kv('Status', S.pedidos.labels[ord.normalizedStatus] || ord.orderStatus || '—') + kv('Valor', brl(ord.totalAmount || 0)) + '<button class="btn-sm" data-goped="' + esc(pid) + '">Ver pedido</button></div></div>' : '<div class="footnote">Pedido ' + esc(pid) + ' não importado no módulo Pedidos — SKU/produto indisponíveis.</div>';
    var devBlock = oc ? '<div class="panel"><div class="ph"><h3>Devolução vinculada</h3><span class="tag info">' + esc(statusLabel(oc.status)) + '</span></div><div class="pb">' + kv('Motivo', oc.reason || '—') + kv('Responsabilidade', (DEV.RESPONSIBILITY[oc.responsibility] || '—')) + '<button class="btn-sm" data-godev="' + esc(oc.id) + '">Ver devolução</button></div></div>' : '';
    var hist = (r.history && r.history.length) ? '<div class="panel"><div class="ph"><h3>Linha do tempo financeira</h3></div><div class="pb">' + [{ at: r.firstImportAt, txt: 'Importado — ' + acStatusLabel(r.status) }].concat(r.history.map(function (h) { return { at: h.at, txt: acStatusLabel(h.statusOld) + ' → ' + acStatusLabel(h.statusNew) + (h.reembNew !== h.reembOld ? ' · reembolso ' + brlC(h.reembOld) + '→' + brlC(h.reembNew) : '') }; })).map(function (e) { return '<div class="fin-line"><span>' + esc(e.txt) + '</span><span class="footnote" style="margin:0">' + (e.at ? new Date(e.at).toLocaleDateString('pt-BR') : '') + '</span></div>'; }).join('') + '</div></div>' : '';
    panel.innerHTML = '<div class="dh"><div><b>Pedido ' + esc(pid) + '</b> <span class="tag ' + (acIsReemb(r) ? 'warn' : acIsFullyPaid(r) ? 'ok' : 'neutral') + '" style="margin-left:6px">' + esc(acStatusLabel(r.status)) + '</span></div><button class="x">&times;</button></div><div class="dbd">' +
      '<div class="panel"><div class="ph"><h3>Antecipação</h3></div><div class="pb">' + kv('Resgate', r.resgate) + kv('Data', dbr(r.data)) + kv('Disponível', brlC(r.disponivel)) + kv('% antecipado', r.pctAntecip != null ? pct(r.pctAntecip * 100) : '—') + kv('Valor antecipado', brlC(r.antecipado)) + kv('Taxa', brlC(r.taxa)) + kv('Alíquota', pct(r2((r.antecipado ? r.taxa / r.antecipado : 0) * 100))) + kv('Líquido recebido', brlC(r.recebido)) + '</div></div>' +
      '<div class="panel"><div class="ph"><h3>Depois da antecipação</h3></div><div class="pb">' + kv('Reembolsado', brlC(r.reembolsado)) + kv('Pendente', brlC(r.pendente)) + kv('Última transação', dbr(r.ultimaTransacao)) + kv('Vencimento', dbr(r.vencimento)) + '</div></div>' +
      '<div class="panel"><div class="ph"><h3>Impacto financeiro</h3></div><div class="pb">' + kv('Taxa vinculada ao reembolso', brlC(taxaReemb)) + kv('Taxa em risco (pendência)', brlC(taxaRisco)) + kv('Dias antecipado', (acDays(r.data, r.ultimaTransacao) != null ? acDays(r.data, r.ultimaTransacao) + ' dias' : (acAgeDays(r.data) + ' dias (em aberto)'))) + '</div></div>' +
      pedBlock + devBlock + hist + '</div>';
    panel.querySelector('.x').onclick = function () { d.remove(); };
    var gp = panel.querySelector('[data-goped]'); if (gp) gp.onclick = function () { d.remove(); route = 'pedidos'; sub.pedidos = 'pedidos'; render(); };
    var gd = panel.querySelector('[data-godev]'); if (gd) gd.onclick = function () { var id2 = gd.dataset.godev; d.remove(); route = 'posvenda'; sub.posvenda = 'casos'; render(); setTimeout(function () { openFicha(id2); }, 60); };
  }

  function aceleraDesperdicio() {
    var m = aceleraMetrics(acelera);
    var head = secHead('ACELERA · DEVOLUÇÕES & DESPERDÍCIO', 'Taxa que virou desperdício', 'Taxa de antecipação paga em pedidos que depois foram reembolsados — calculada pedido a pedido. Separamos perda realizada de risco em aberto.');
    var strip = kstrip([
      { l: 'Antecipado que voltou (reembolso)', v: brlC(m.reemb), cls: 'amber' },
      { l: 'Taxa desperdiçada (realizada)', v: brlC(m.taxaReemb), cls: 'red', s: 'perda já concretizada' },
      { l: 'Taxa em risco (pendências)', v: brlC(m.taxaRisco), cls: 'amber', s: 'ainda não é perda' },
      { l: 'Pedidos reembolsados', v: nn(m.status['antecipacao totalmente reembolsada'] || 0) + ' / ' + nn(m.status['antecipacao parcialmente reembolsada'] || 0), cls: 'blue', s: 'total / parcial' },
    ]);
    // faixas de ticket (por valor antecipado do pedido)
    var faixas = [[0, 5000, 'até R$50'], [5000, 10000, 'R$50–100'], [10000, 15000, 'R$100–150'], [15000, 25000, 'R$150–250'], [25000, 40000, 'R$250–400'], [40000, Infinity, 'acima de R$400']];
    var fd = faixas.map(function (f) { return { label: f[2], min: f[0], max: f[1], n: 0, antec: 0, reemb: 0, taxaW: 0, pend: 0 }; });
    acelera.forEach(function (r) { var t = r.antecipado; var fx = fd.find(function (f) { return t >= f.min && t < f.max; }); if (!fx) return; fx.n++; fx.antec += r.antecipado; fx.reemb += r.reembolsado; fx.pend += r.pendente; if (r.antecipado > 0) fx.taxaW += r.taxa * r.reembolsado / r.antecipado; });
    var totAntec = m.volume || 1;
    var frows = fd.map(function (f) { return '<tr><td>' + esc(f.label) + '</td><td>' + nn(f.n) + '</td><td class="nowrap">' + brlC(f.antec) + '</td><td>' + pct(r2(f.antec / totAntec * 100)) + '</td><td class="nowrap ' + (f.reemb ? 'neg' : '') + '">' + brlC(f.reemb) + '</td><td>' + pct(r2(f.antec ? f.reemb / f.antec * 100 : 0)) + '</td><td class="nowrap"><b>' + brlC(Math.round(f.taxaW)) + '</b></td><td class="nowrap">' + brlC(f.pend) + '</td></tr>'; }).join('');
    var faixaTable = '<div class="panel"><div class="ph"><h3>Por faixa de ticket</h3><span class="footnote" style="margin:0">taxa desperdiçada calculada pedido a pedido</span></div><div class="table-wrap"><table class="report"><thead><tr><th>Faixa</th><th>Pedidos</th><th>Antecipado</th><th>% do volume</th><th>Reembolsado</th><th>% reemb.</th><th>Taxa desperdiçada</th><th>Pendente</th></tr></thead><tbody>' + frows + '</tbody></table></div></div>';
    // integração com devoluções por responsabilidade (por ID do pedido)
    var byResp = {}; var semOcc = { n: 0, taxaW: 0 };
    acelera.forEach(function (r) { if (r.reembolsado <= 0) return; var taxaW = r.antecipado ? r.taxa * r.reembolsado / r.antecipado : 0; var oc = occ.find(function (o) { return !o.isDemo && o.orderId === r.pedido; }); if (oc) { var key = oc.responsibility || 'NAO_IDENTIFICADA'; var g = byResp[key] = byResp[key] || { n: 0, taxaW: 0 }; g.n++; g.taxaW += taxaW; } else { semOcc.n++; semOcc.taxaW += taxaW; } });
    var respRows = Object.keys(byResp).sort(function (a, b) { return byResp[b].taxaW - byResp[a].taxaW; }).map(function (k) { return '<tr><td>' + esc(DEV.RESPONSIBILITY[k] || k) + '</td><td>' + nn(byResp[k].n) + '</td><td class="nowrap"><b>' + brlC(Math.round(byResp[k].taxaW)) + '</b></td></tr>'; }).join('');
    var respTable = '<div class="panel"><div class="ph"><h3>Taxa desperdiçada por responsabilidade da devolução</h3><span class="footnote" style="margin:0">cruzando o módulo Devoluções por ID do pedido</span></div><div class="table-wrap"><table class="report"><thead><tr><th>Responsabilidade</th><th>Pedidos</th><th>Taxa desperdiçada</th></tr></thead><tbody>' + (respRows || '') + (semOcc.n ? '<tr><td>Sem devolução importada</td><td>' + nn(semOcc.n) + '</td><td class="nowrap">' + brlC(Math.round(semOcc.taxaW)) + '</td></tr>' : '') + (respRows || semOcc.n ? '' : '<tr><td colspan="3" class="empty">Nenhum pedido reembolsado encontrado nas devoluções. Importe o módulo Devoluções para cruzar responsabilidade.</td></tr>') + '</tbody></table></div></div>';
    var sep = callout('', 'Perda realizada × risco (não confundir)', '<b>' + brlC(m.taxaReemb) + '</b> já é desperdício concretizado (o pedido devolveu). <b>' + brlC(m.taxaRisco) + '</b> é apenas <b>risco</b> associado a valores ainda pendentes — pode ou não virar perda. Nunca somamos os dois como "dinheiro perdido".');
    return head + strip + sep + faixaTable + respTable;
  }

  function aceleraAliquotas() {
    var m = aceleraMetrics(acelera); var gs = m.byResgate;
    var head = secHead('ACELERA · ALÍQUOTAS', 'Qual taxa está sendo cobrada — e quando mudou', 'A alíquota é calculada (Taxa ÷ Valor antecipado), por resgate. Pequenas variações por arredondamento são agrupadas nas faixas contratuais.');
    var bmap = {}; gs.forEach(function (g) { var b = bmap[g.band] = bmap[g.band] || { band: g.band, n: 0, antec: 0, taxa: 0 }; b.n++; b.antec += g.antec; b.taxa += g.taxa; });
    var bands = Object.values(bmap).sort(function (a, b) { return a.band.localeCompare(b.band); });
    var strip = kstrip(bands.map(function (b) { return { l: 'Faixa ' + b.band, v: nn(b.n) + ' resgates', cls: b.band === 'outra' ? 'red' : 'blue', s: brlC(b.antec) + ' · taxa ' + brlC(b.taxa) }; }));
    // timeline de mudança de alíquota
    var tl = gs.slice().sort(function (a, b) { return (a.data || '').localeCompare(b.data || ''); });
    var segs = [], cur = null;
    tl.forEach(function (g) { if (!cur || cur.band !== g.band) { cur = { band: g.band, from: g.data, to: g.data, antec: 0, taxa: 0 }; segs.push(cur); } cur.to = g.data; cur.antec += g.antec; cur.taxa += g.taxa; });
    var tlRows = segs.map(function (s) { return '<tr><td><span class="tag ' + (s.band === 'outra' ? 'warn' : 'neutral') + '">' + esc(s.band) + '</span></td><td class="nowrap">' + esc(dbr(s.from)) + ' → ' + esc(dbr(s.to)) + '</td><td class="nowrap">' + brlC(s.antec) + '</td><td class="nowrap">' + brlC(s.taxa) + '</td></tr>'; }).join('');
    // evento de mudança
    var changeNote = '';
    for (var i = 1; i < segs.length; i++) { if (segs[i].band !== segs[i - 1].band && segs[i].band !== '—' && segs[i - 1].band !== '—') { var prev = parseFloat(segs[i - 1].band), now = parseFloat(segs[i].band); if (!isNaN(prev) && !isNaN(now) && now > prev) { var impactoMes = Math.round(m.volumeMensalMedio * (now - prev) / 100); changeNote = callout('warn', '🔴 Alíquota aumentou: ' + segs[i - 1].band + ' → ' + segs[i].band, 'Considerando seu volume médio de ' + brlC(m.volumeMensalMedio) + '/mês, essa mudança adiciona aproximadamente <b>' + brlC(impactoMes) + '/mês</b> (~' + brlC(impactoMes * 12) + '/ano) ao custo de antecipação.'); } } }
    var chart = chartCard('Volume antecipado por faixa de alíquota', legendSwatch([['Antecipado', '#2b4bd6']]), svgHBars(bands.map(function (b) { return { label: 'Faixa ' + b.band, value: b.antec / 100 }; }), { fmt: function (v) { return brl(v); } }));
    return head + strip + changeNote + chart + '<div class="panel"><div class="ph"><h3>Linha do tempo da alíquota</h3></div><div class="table-wrap"><table class="report"><thead><tr><th>Faixa</th><th>Período</th><th>Antecipado</th><th>Taxa</th></tr></thead><tbody>' + tlRows + '</tbody></table></div></div>';
  }

  function aceleraCoortes() {
    var head = secHead('ACELERA · COORTES', 'Devolução por coorte (maturação de ' + aceleraCfg.cohortDays + ' dias)', 'Não medimos devolução recente como se estivesse encerrada. Coortes com menos de ' + aceleraCfg.cohortDays + ' dias ainda estão maturando — o percentual delas não deve ser usado isoladamente.');
    var mm = {}; acelera.forEach(function (r) { var k = (r.data || '').slice(0, 7); if (!k) return; var g = mm[k] = mm[k] || { month: k, antec: 0, reemb: 0, n: 0, madN: 0 }; g.antec += r.antecipado; g.reemb += r.reembolsado; g.n++; if (acAgeDays(r.data) != null && acAgeDays(r.data) >= aceleraCfg.cohortDays) g.madN++; });
    var months = Object.keys(mm).sort();
    var rows = months.map(function (k) { var g = mm[k]; var rate = g.antec ? g.reemb / g.antec : 0; var madura = g.n && g.madN / g.n >= 0.9; return '<tr><td>' + esc(k) + '</td><td class="nowrap">' + brlC(g.antec) + '</td><td class="nowrap ' + (g.reemb ? 'neg' : '') + '">' + brlC(g.reemb) + '</td><td>' + pct(r2(rate * 100)) + '</td><td><span class="tag ' + (madura ? 'ok' : 'warn') + '">' + (madura ? 'Madura' : 'Em maturação') + '</span></td></tr>'; }).join('');
    var m = aceleraMetrics(acelera);
    var strip = kstrip([
      { l: 'Coorte madura (≥' + aceleraCfg.cohortDays + 'd)', v: nn(m.cohortMaduraN) + ' pedidos', cls: 'blue', s: brlC(m.cohortMaduraAntec) + ' antecipados' },
      { l: 'Devolução observada (madura)', v: pct(r2(m.cohortDevolRate * 100)), cls: 'amber', s: 'dado realizado' },
      { l: 'Reembolsado (madura)', v: brlC(m.cohortMaduraReemb), cls: 'red' },
    ]);
    var chart = months.length ? chartCard('Antecipado × Reembolsado por coorte (mês)', legendSwatch([['Antecipado', '#2b4bd6'], ['Reembolsado', '#d13b3b']]), svgGroupBars(months, [{ name: 'Antecipado', color: '#2b4bd6', vals: months.map(function (k) { return mm[k].antec / 100; }) }, { name: 'Reembolsado', color: '#d13b3b', vals: months.map(function (k) { return mm[k].reemb / 100; }) }], { fmt: function (v) { return brl(v); } })) : '';
    var warn = callout('warn', 'Coortes recentes ainda não maturaram', 'Meses marcados como <b>Em maturação</b> tendem a mostrar devolução artificialmente baixa porque o ciclo ainda não se completou. Use a coorte madura para projeções — nunca a mais recente isoladamente.');
    return head + strip + chart + warn + '<div class="panel"><div class="ph"><h3>Coortes por mês de antecipação</h3></div><div class="table-wrap"><table class="report"><thead><tr><th>Coorte</th><th>Antecipado</th><th>Reembolsado</th><th>% devolução</th><th>Maturidade</th></tr></thead><tbody>' + rows + '</tbody></table></div></div>';
  }

  function aceleraCapital() {
    var m = aceleraMetrics(acelera);
    var head = secHead('ACELERA · CAPITAL & SIMULADOR', 'Antecipar com a Shopee ou usar capital próprio/bancário?', 'Comparação de custo, capital necessário para reduzir a dependência e simulador de cenários. Premissas editáveis em Configurações — nada de taxas fixas escondidas.');
    // dias / custo equivalente
    var custoEq = m.custoEquivAnual == null ? '—' : pct(r2(m.custoEquivAnual * 100));
    // comparador (anualizado)
    var custoShopeeAno = m.custoProj12m; // R$/ano projetado
    var bancoAA = Math.pow(1 + aceleraCfg.bancoTaxaAM, 12) - 1;
    var externoNecessario = Math.max(0, m.capitalNecessario - (aceleraCfg.capitalProprio || 0));
    var custoBancoAno = Math.round(externoNecessario * bancoAA);
    var custoProprioAno = Math.round(Math.min(m.capitalNecessario, aceleraCfg.capitalProprio || 0) * aceleraCfg.custoOportAA) + Math.round(externoNecessario * bancoAA);
    var strip = kstrip([
      { l: 'Custo Acelera (12m proj.)', v: brlC(custoShopeeAno), cls: 'red', s: 'taxa média × 12' },
      { l: 'Custo equivalente a.a.', v: custoEq, cls: 'amber', s: m.diasEq ? 'p/ ' + Math.round(m.diasEq) + ' dias' : '' },
      { l: 'Capital p/ independência', v: brlC(m.capitalNecessario), cls: 'blue', s: Math.round(m.prazoLiberacao) + ' dias de liberação' },
      { l: 'Capital próprio', v: brlC(aceleraCfg.capitalProprio || 0), cls: 'green' },
      { l: 'Falta de colchão', v: brlC(Math.max(0, m.capitalNecessario - (aceleraCfg.capitalProprio || 0))), cls: 'amber' },
    ]);
    // cobertura
    var meta = m.capitalNecessario || 1; var covPct = Math.min(100, Math.round((aceleraCfg.capitalProprio || 0) / meta * 100));
    var cobertura = '<div class="chartcard"><div class="cch"><h4>Cobertura de capital</h4><div class="cleg">' + covPct + '% da necessidade</div></div><div style="height:16px;border-radius:8px;background:var(--line);overflow:hidden"><div style="height:100%;width:' + covPct + '%;background:' + (covPct >= 100 ? 'var(--ok)' : 'var(--brand)') + '"></div></div><div class="footnote" style="margin-top:8px">Capital próprio ' + brlC(aceleraCfg.capitalProprio || 0) + ' · necessidade ' + brlC(m.capitalNecessario) + (covPct >= 100 ? ' · 🟢 já é possível operar reduzindo a antecipação recorrente (apenas indicativo).' : ' · falta ' + brlC(m.capitalNecessario - (aceleraCfg.capitalProprio || 0))) + '</div></div>';
    var comp = '<div class="panel"><div class="ph"><h3>Comparador de custo do dinheiro</h3></div><div class="pb">' +
      '<div class="fin-line"><span>Shopee Acelera (projeção 12m)</span><b class="neg">' + brlC(custoShopeeAno) + '/ano</b></div>' +
      '<div class="fin-line"><span>Linha bancária (' + pct(r2(aceleraCfg.bancoTaxaAM * 100)) + ' a.m. ≈ ' + pct(r2(bancoAA * 100)) + ' a.a.) sobre ' + brlC(externoNecessario) + '</span><b>' + brlC(custoBancoAno) + '/ano</b></div>' +
      '<div class="fin-line"><span>Capital próprio (custo de oportunidade ' + pct(r2(aceleraCfg.custoOportAA * 100)) + ' a.a.)</span><b>' + brlC(custoProprioAno) + '/ano</b></div>' +
      '<div class="fin-line total"><span>Economia potencial trocando o Acelera pela alternativa mais barata</span><b class="pos">' + brlC(Math.max(0, custoShopeeAno - Math.min(custoBancoAno, custoProprioAno))) + '/ano</b></div>' +
      '<div class="footnote" style="margin-top:6px">Comparação indicativa. Não é rendimento — é despesa evitada / custo de oportunidade. Ajuste as taxas em Configurações.</div></div></div>';
    return head + strip + cobertura + comp + aceleraSimulador(m);
  }
  function aceleraSimulador(m) {
    // decisão pedido a pedido: corta por teto de ticket e por percentual (corta os maiores até restar pct do volume)
    var recs = acelera.slice(); var ticketMax = aceleraSim.ticketMax || 0;
    var kept = [], cut = [];
    recs.forEach(function (r) { if (ticketMax > 0 && r.antecipado > ticketMax) cut.push(r); else kept.push(r); });
    // aplica percentual sobre o que restou: corta os de maior ticket até restar pct do volume total
    var volTotal = m.volume; var alvo = Math.round(volTotal * aceleraSim.pct);
    kept.sort(function (a, b) { return b.antecipado - a.antecipado; });
    var keptVol = kept.reduce(function (s, r) { return s + r.antecipado; }, 0);
    while (keptVol > alvo && kept.length) { var rr = kept.shift(); cut.push(rr); keptVol -= rr.antecipado; }
    var volAntecSim = keptVol; var volCortado = volTotal - volAntecSim;
    var aliq = aceleraSim.aliquota === 'atual' ? m.aliquota : parseFloat(aceleraSim.aliquota);
    var taxaShopeeSim = Math.round(volAntecSim * aliq); var taxaShopeeSimAno = Math.round(taxaShopeeSim / m.monthsSpan * 12);
    // capital para cobrir o volume cortado (que deixaria de ser antecipado)
    var externo = Math.max(0, volCortado - (aceleraSim.capitalProprio || 0));
    var bancoAA = Math.pow(1 + (aceleraSim.bancoTaxaAM || 0), 12) - 1;
    var custoBancoAno = Math.round(externo / m.monthsSpan * 12 * 0 + externo * bancoAA); // custo anual do capital externo alocado
    var custoProprioAno = Math.round(Math.min(volCortado, aceleraSim.capitalProprio || 0) * (aceleraSim.custoOportAA || 0));
    var custoTotalAno = taxaShopeeSimAno + custoBancoAno + custoProprioAno;
    var custoAtualAno = m.custoProj12m; var economiaAno = custoAtualAno - custoTotalAno;
    var devolHist = m.cohortDevolRate; var reembEvitado = Math.round(volCortado * devolHist); var taxaDesperdEvit = Math.round(volCortado * aliq * devolHist);
    var out = kstrip([
      { l: 'Continuaria antecipado', v: brlC(volAntecSim), cls: 'blue', s: pct(r2(volTotal ? volAntecSim / volTotal * 100 : 0)) + ' do volume' },
      { l: 'Deixaria de antecipar', v: brlC(volCortado), cls: 'amber', s: nn(cut.length) + ' pedidos' },
      { l: 'Taxa Shopee (ano)', v: brlC(taxaShopeeSimAno), cls: 'red' },
      { l: 'Custo do capital (ano)', v: brlC(custoBancoAno + custoProprioAno), cls: 'amber' },
      { l: 'Custo total (ano)', v: brlC(custoTotalAno), cls: 'red' },
      { l: 'Economia vs hoje (ano)', v: brlC(economiaAno), cls: economiaAno >= 0 ? 'green' : 'red' },
    ]);
    var aliqOpts = [['atual', 'Atual (' + pct(r2(m.aliquota * 100)) + ')'], ['0.02', '2,0%'], ['0.025', '2,5%'], ['0.035', '3,5%']];
    var ctrl = '<div class="panel"><div class="ph"><h3>Simulador</h3><span class="footnote" style="margin:0">recalcula pedido a pedido</span></div><div class="pb">' +
      '<label class="fld">% do volume a antecipar: <b id="acsimpctv">' + Math.round(aceleraSim.pct * 100) + '%</b></label><input type="range" min="0" max="100" value="' + Math.round(aceleraSim.pct * 100) + '" id="acsimpct" style="width:100%">' +
      '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:8px">' +
      '<div><label class="fld">Não antecipar acima de (R$)</label><input class="input sm" id="acsimticket" value="' + (aceleraSim.ticketMax ? (aceleraSim.ticketMax / 100) : '') + '" placeholder="sem teto" style="width:130px"></div>' +
      '<div><label class="fld">Alíquota</label><select class="select sm" id="acsimaliq">' + aliqOpts.map(function (o) { return '<option value="' + o[0] + '"' + (String(aceleraSim.aliquota) === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></div>' +
      '<div><label class="fld">Capital próprio (R$)</label><input class="input sm" id="acsimcap" value="' + (aceleraSim.capitalProprio ? aceleraSim.capitalProprio / 100 : '') + '" style="width:120px"></div>' +
      '<div><label class="fld">Taxa banco (% a.m.)</label><input class="input sm" id="acsimbanco" value="' + (aceleraSim.bancoTaxaAM * 100) + '" style="width:90px"></div>' +
      '<div><label class="fld">Custo oport. (% a.a.)</label><input class="input sm" id="acsimopp" value="' + (aceleraSim.custoOportAA * 100) + '" style="width:90px"></div>' +
      '</div></div></div>';
    var extra = callout('', 'Efeito colateral do corte', 'Cortar ' + brlC(volCortado) + ' de antecipação evitaria pagar taxa sobre pedidos que historicamente devolvem: ~<b>' + brlC(taxaDesperdEvit) + '/período</b> de taxa desperdiçada evitada (usando a devolução da coorte madura, ' + pct(r2(devolHist * 100)) + '). Isso exige colchão de caixa para o volume que deixa de ser antecipado.');
    return '<div style="margin-top:10px">' + ctrl + out + extra + '</div>';
  }
  function bindAceleraSim() {
    var sync = function () { render(); };
    var pct2 = document.getElementById('acsimpct'); if (pct2) { pct2.oninput = function () { document.getElementById('acsimpctv').textContent = pct2.value + '%'; }; pct2.onchange = function () { aceleraSim.pct = (+pct2.value) / 100; sync(); }; }
    var tk = document.getElementById('acsimticket'); if (tk) tk.onchange = function () { aceleraSim.ticketMax = tk.value ? Math.round(parseFloat(tk.value.replace(',', '.')) * 100) : 0; sync(); };
    var al = document.getElementById('acsimaliq'); if (al) al.onchange = function () { aceleraSim.aliquota = al.value; sync(); };
    var cp = document.getElementById('acsimcap'); if (cp) cp.onchange = function () { aceleraSim.capitalProprio = cp.value ? Math.round(parseFloat(cp.value.replace(',', '.')) * 100) : 0; sync(); };
    var bk = document.getElementById('acsimbanco'); if (bk) bk.onchange = function () { aceleraSim.bancoTaxaAM = (parseFloat(bk.value.replace(',', '.')) || 0) / 100; sync(); };
    var op = document.getElementById('acsimopp'); if (op) op.onchange = function () { aceleraSim.custoOportAA = (parseFloat(op.value.replace(',', '.')) || 0) / 100; sync(); };
  }

  function aceleraPlano() {
    var m = aceleraMetrics(acelera);
    var head = secHead('ACELERA · PLANO DE AÇÃO', 'Reduzir o custo da antecipação', 'Metas dinâmicas calculadas sobre os dados reais. Edite as metas em Configurações.');
    var band35 = m.byResgate.filter(function (g) { return g.band === '3.5%'; }); var vol35 = band35.reduce(function (s, g) { return s + g.antec; }, 0);
    var indicators = [
      { l: 'Alíquota efetiva', atual: pct(r2(m.aliquota * 100)), meta: pct(r2(aceleraCfg.aliquotaAlvo * 100)) },
      { l: 'Volume antecipado (mês)', atual: brlC(m.volumeMensalMedio), meta: brlC(Math.round(m.volumeMensalMedio * aceleraCfg.metaAntecip)) },
      { l: 'Taxa vinculada a reembolso', atual: brlC(m.taxaReemb), meta: '↓ reduzir' },
      { l: 'Devolução coorte madura', atual: pct(r2(m.cohortDevolRate * 100)), meta: '≤ ' + pct(r2(aceleraCfg.limiteDevol * 100)) },
      { l: 'Dias de cobertura de caixa', atual: r2(m.coberturaDias) + 'd', meta: aceleraCfg.metaCobertura + 'd' },
    ];
    var indRows = indicators.map(function (i) { return '<tr><td>' + esc(i.l) + '</td><td class="nowrap"><b>' + i.atual + '</b></td><td class="nowrap">' + i.meta + '</td></tr>'; }).join('');
    var fases = [
      { f: 'Fase 1 — Medir', d: 'Importar todos os relatórios, conciliar com o resumo da Shopee, mapear alíquotas e coortes.', done: acelera.length > 0 },
      { f: 'Fase 2 — Reduzir automatismo', d: 'Parar de antecipar 100% cegamente; aplicar teto de ticket e cortar faixas de maior risco (ver Simulador).', done: false },
      { f: 'Fase 3 — Atingir o alvo', d: 'Reduzir antecipação para ' + pct(r2(aceleraCfg.metaAntecip * 100)) + ' do volume com colchão de caixa e/ou linha bancária mais barata.', done: false },
    ];
    var faseRows = fases.map(function (x) { return '<div class="fin-line"><span>' + (x.done ? '✅ ' : '⬜ ') + '<b>' + esc(x.f) + '</b> — ' + esc(x.d) + '</span></div>'; }).join('');
    var alvoAno = brlC(Math.round(m.custoProj12m * aceleraCfg.metaAntecip));
    return head + callout('', 'Meta financeira', 'Situação atual: <b>' + brlC(m.custoProj12m) + '/ano</b> de custo projetado. Meta (' + pct(r2(aceleraCfg.metaAntecip * 100)) + ' do volume): <b>' + alvoAno + '/ano</b>. Economia alvo: <b>' + brlC(m.custoProj12m - Math.round(m.custoProj12m * aceleraCfg.metaAntecip)) + '/ano</b>.') +
      '<div class="panel"><div class="ph"><h3>Indicadores permanentes — atual × meta</h3></div><div class="table-wrap"><table class="report"><thead><tr><th>Indicador</th><th>Atual</th><th>Meta</th></tr></thead><tbody>' + indRows + '</tbody></table></div></div>' +
      '<div class="panel"><div class="ph"><h3>Fases</h3></div><div class="pb">' + faseRows + '</div></div>';
  }

  function aceleraAuditoria() {
    var m = aceleraMetrics(acelera);
    var subhead = secHead('ACELERA · AUDITORIA', 'Rastreabilidade e qualidade dos dados', 'Resumo Shopee × sistema, importações, anomalias e a base histórica do estudo para comparação.');
    // qualidade / anomalias
    var an = m.anomalies;
    var anRows = an.slice(0, 200).map(function (x) { return '<tr><td class="mono">' + esc(x.r.pedido) + '</td><td class="cell-text">' + esc(x.type) + '</td><td class="nowrap">' + brlC(x.r.antecipado) + '</td><td class="nowrap">' + brlC(x.r.reembolsado) + '</td><td class="nowrap">' + brlC(x.r.pendente) + '</td><td><button class="btn-sm" data-acped="' + esc(x.r.pedido) + '">Abrir</button></td></tr>'; }).join('');
    var qual = '<div class="panel"><div class="ph"><h3>Qualidade dos dados — anomalias</h3><span class="footnote" style="margin:0">' + nn(an.length) + ' registro(s) marcados · nunca descartados</span></div><div class="table-wrap"><table class="report"><thead><tr><th>Pedido</th><th>Anomalia</th><th>Antecipado</th><th>Reembolsado</th><th>Pendente</th><th></th></tr></thead><tbody>' + (anRows || '<tr><td colspan="6" class="empty">Nenhuma anomalia detectada. 🎉</td></tr>') + '</tbody></table></div></div>';
    // importações
    var imps = batches.filter(function (b) { return b.module === 'Shopee Acelera'; });
    var impRows = imps.slice(0, 30).map(function (b) { return '<tr><td class="nowrap">' + new Date(b.createdAt).toLocaleString('pt-BR') + '</td><td class="cell-text">' + esc(b.filename) + '</td><td>' + nn(b.seen) + '</td><td>' + nn(b.novo) + '</td><td>' + nn(b.upd) + '</td><td>' + nn(b.unch) + '</td></tr>'; }).join('');
    var impTable = '<div class="panel"><div class="ph"><h3>Histórico de importações</h3></div><div class="table-wrap"><table class="report"><thead><tr><th>Quando</th><th>Arquivo</th><th>Linhas</th><th>Novos</th><th>Atualizados</th><th>Sem alteração</th></tr></thead><tbody>' + (impRows || '<tr><td colspan="6" class="empty">Sem importações.</td></tr>') + '</tbody></table></div></div>';
    // período de auditoria
    var pr = aceleraSummary ? aceleraSummary.periodReal : null;
    var periodo = aceleraSummary ? callout('', 'Auditoria de período', 'Declarado pela Shopee: <b>' + esc(aceleraSummary.periodDeclared || '—') + '</b> · Registros de <b>' + esc((pr && pr.min) || '—') + '</b> a <b>' + esc((pr && pr.max) || '—') + '</b> · Importado em ' + new Date(aceleraSummary.importedAt).toLocaleString('pt-BR') + '. Nenhum registro foi descartado por causa do período do cabeçalho.') : '';
    // base histórica do estudo (estático, claramente rotulado)
    var estudo = '<details class="panel" style="padding:0"><summary style="cursor:pointer;padding:12px 16px;font-weight:700">Base histórica — Estudo Ago/2026 (referência) × Atual (dados reais)</summary><div class="table-wrap"><table class="report"><thead><tr><th>Indicador</th><th>Estudo (ref.)</th><th>Atual (importado)</th></tr></thead><tbody>' +
      '<tr><td>Alíquota efetiva</td><td>3,5%</td><td>' + pct(r2(m.aliquota * 100)) + '</td></tr>' +
      '<tr><td>Devolução coorte madura</td><td>17,3%</td><td>' + pct(r2(m.cohortDevolRate * 100)) + '</td></tr>' +
      '<tr><td>Dias até liquidação (pago)</td><td>12,8 dias</td><td>' + (m.diasPagoMed != null ? Math.round(m.diasPagoMed) + ' dias' : '—') + '</td></tr>' +
      '<tr><td>Dias até liquidação (devolvido)</td><td>45,9 dias</td><td>' + (m.diasReembAvg != null ? Math.round(m.diasReembAvg) + ' dias' : '—') + '</td></tr>' +
      '<tr><td>Volume antecipado (mês)</td><td>~R$352 mil</td><td>' + brlC(m.volumeMensalMedio) + '</td></tr>' +
      '</tbody></table></div><div class="footnote" style="padding:0 16px 12px">Coluna “Estudo” é referência fixa do PDF; “Atual” é sempre recalculada dos dados importados.</div></details>';
    return subhead + periodo + qual + impTable + estudo;
  }

  function aceleraConfig() {
    var head = secHead('ACELERA · CONFIGURAÇÕES', 'Premissas do módulo', 'Nada é fixo escondido. Ajuste as premissas — tudo é recalculado a partir dos dados importados.');
    var f = function (id, label, val, help) { return '<div><label class="fld">' + esc(label) + (help ? ' <span title="' + esc(help) + '" style="cursor:help">ⓘ</span>' : '') + '</label><input class="input sm" id="' + id + '" value="' + esc(val) + '" style="width:160px"></div>'; };
    return head + '<div class="panel"><div class="pb"><div style="display:flex;gap:14px;flex-wrap:wrap">' +
      f('cfgcohort', 'Coorte madura (dias)', aceleraCfg.cohortDays, 'Idade mínima para considerar o ciclo de devolução encerrado.') +
      f('cfgticket', 'Ticket de risco (R$)', (aceleraCfg.ticketRisco / 100), 'Acima disso o pedido é considerado de maior risco.') +
      f('cfgmeta', 'Meta de antecipação (%)', r2(aceleraCfg.metaAntecip * 100), 'Percentual alvo do volume a antecipar.') +
      f('cfgalvo', 'Alíquota alvo (%)', r2(aceleraCfg.aliquotaAlvo * 100)) +
      f('cfglimdev', 'Limite de devolução (%)', r2(aceleraCfg.limiteDevol * 100)) +
      f('cfgcapital', 'Capital próprio (R$)', (aceleraCfg.capitalProprio / 100)) +
      f('cfgopp', 'Custo de oportunidade (% a.a.)', r2(aceleraCfg.custoOportAA * 100)) +
      f('cfgbanco', 'Taxa bancária (% a.m.)', r2(aceleraCfg.bancoTaxaAM * 100)) +
      f('cfgcob', 'Meta de cobertura (dias)', aceleraCfg.metaCobertura) +
      f('cfgtol', 'Tolerância de alíquota (%)', r2(aceleraCfg.tolAliquota * 100)) +
      '</div><div style="margin-top:12px"><button class="btn-sm primary" id="cfgsave">Salvar configurações</button></div>' +
      '<div class="footnote" style="margin-top:8px">As configurações persistem no navegador e alimentam Coortes, Capital, Simulador e Plano de Ação.</div></div></div>';
  }
  function bindAceleraConfig() {
    var s = document.getElementById('cfgsave'); if (!s) return;
    s.onclick = function () {
      var g = function (id) { var el = document.getElementById(id); return el ? parseFloat((el.value || '').replace(',', '.')) : null; };
      var v;
      if ((v = g('cfgcohort')) != null && !isNaN(v)) aceleraCfg.cohortDays = Math.round(v);
      if ((v = g('cfgticket')) != null && !isNaN(v)) aceleraCfg.ticketRisco = Math.round(v * 100);
      if ((v = g('cfgmeta')) != null && !isNaN(v)) aceleraCfg.metaAntecip = v / 100;
      if ((v = g('cfgalvo')) != null && !isNaN(v)) aceleraCfg.aliquotaAlvo = v / 100;
      if ((v = g('cfglimdev')) != null && !isNaN(v)) aceleraCfg.limiteDevol = v / 100;
      if ((v = g('cfgcapital')) != null && !isNaN(v)) aceleraCfg.capitalProprio = Math.round(v * 100);
      if ((v = g('cfgopp')) != null && !isNaN(v)) aceleraCfg.custoOportAA = v / 100;
      if ((v = g('cfgbanco')) != null && !isNaN(v)) aceleraCfg.bancoTaxaAM = v / 100;
      if ((v = g('cfgcob')) != null && !isNaN(v)) aceleraCfg.metaCobertura = v;
      if ((v = g('cfgtol')) != null && !isNaN(v)) aceleraCfg.tolAliquota = v / 100;
      saveAceleraCfg().then(function () { render(); toast('Configurações salvas', ''); });
    };
  }
  function bindAceleraAud() { /* handlers de anomalia usam data-acped, já ligados no render */ }

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
  function affEngine() {
    var conv = affConv;
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
    app.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap"><div class="subtabs" style="margin-bottom:0;overflow-x:auto">' + tabs.map(function (t) { return '<div class="subtab' + (affSub === t[0] ? ' active' : '') + '" data-affsub="' + t[0] + '">' + t[1] + '</div>'; }).join('') + '</div><button class="btn-sm primary" data-affimport="1">Importar relatório de afiliados</button></div><div id="affbody" style="margin-top:14px"></div>';
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
    var rateMap = {}; affConv.forEach(function (r) { if (r.rateItemAff == null) return; var k = (r2(r.rateItemAff * 100)) + '%'; var g = rateMap[k] = rateMap[k] || { k: k, rate: r.rateItemAff, sales: 0, com: 0, n: 0 }; g.sales += r.purchase; g.com += r.comItemAff; g.n++; });
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
    var creditOrders = affConv.filter(function (r) { return normStatus(r.dedMethod).indexOf('credito comissao extra') >= 0; });
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
    var altas = affConv.filter(function (r) { return r.rateItemAff != null && r.rateItemAff >= affCfg.rateAlert; }); var altasSales = altas.reduce(function (s, r) { return s + r.purchase; }, 0);
    if (altasSales > 0) ins.push('<b>' + brlU(altasSales) + '</b> em vendas foram feitas com comissão ≥ ' + pct(r2(affCfg.rateAlert * 100)) + ' — revise se a taxa se justifica.');
    var difDesp = t.despesaStated - t.despesaRecon; if (Math.abs(difDesp) > affCfg.tolConcil) ins.push('Há diferença de <b>' + brlU(difDesp) + '</b> entre a despesa informada pela Shopee e a reconstruída pelos componentes conhecidos — vale conciliar.');
    var totRpa = affRpa.reduce(function (s, r) { return s + r.gross; }, 0); if (affRpa.length && Math.abs(t.comAff - totRpa) > affCfg.tolConcil) ins.push('Divergência de <b>' + brlU(t.comAff - totRpa) + '</b> entre a comissão calculada pelos pedidos e o total reconhecido no RPA.');
    var affected = e.ordersArr.filter(function (o) { return o.st === 'cancelado' || o.refund > 0; }); var comAfet = affected.reduce(function (s, o) { return s + o.comAff; }, 0); if (comAfet > 0) ins.push('Existem <b>' + brlU(comAfet) + '</b> de comissão ligados a pedidos cancelados/reembolsados cujo estorno ainda não foi localizado — requer conciliação com a carteira.');
    var body = ins.length ? '<div class="panel"><div class="pb">' + ins.map(function (x) { return '<div class="fin-line"><span>• ' + x + '</span></div>'; }).join('') + '</div></div>' : emptyBox('Importe os relatórios para gerar leituras.');
    return head + body + callout('', 'Como isto é gerado', 'Cada frase acima usa apenas números calculados pelo motor determinístico (somas, percentuais, diferenças). Nenhum valor foi estimado pela IA.');
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
  function kstrip(items) { return '<div class="kstrip">' + items.map(function (k) { return '<div class="kc ' + (k.cls || '') + '"><div class="kl">' + esc(k.l) + '</div><div class="kv">' + k.v + '</div>' + (k.s ? '<div class="ks">' + esc(k.s) + '</div>' : '') + '</div>'; }).join('') + '</div>'; }
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
  document.getElementById('btn-demo').onclick = function () { if (confirm('Limpar todos os dados importados deste navegador?')) clearAll().then(function () { orders = []; occ = []; batches = []; plans = []; wallet = []; walletCls = {}; devSel = {}; devCustomStatus = []; acelera = []; aceleraSummary = null; affConv = []; affRpa = []; affVb = []; affMaster = {}; Produtos.reset(); rebuildSkuCost(); render(); toast('Dados locais limpos', ''); }); };

  openDB().then(function () {
    Produtos = makeProdutos({ container: app, put: putMany, getAll: getAll, parse: S.produtos.parse, onChange: rebuildSkuCost });
    return Promise.all([getAll('orders'), getAll('occ'), getAll('batches'), Produtos.load(), getAll('plans'), getAll('wallet'), getAll('walletcls'), getAll('settings'), getAll('acelera'), getAll('affconv'), getAll('affrpa'), getAll('affvb'), getAll('affmaster')]);
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
