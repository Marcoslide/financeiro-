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
  var Produtos = null;
  var sub = { pedidos: 'pedidos', posvenda: 'visao' };
  var pedTab = 'ALL';
  var devF = { search: '', internalStatus: '', disputeStatus: '' }, devPage = 1;
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
  function newOcc(uid, type) { return { id: uid, type: type, internalStatus: 'NOVA', priority: 'MEDIA', ownerName: null, internalCause: null, causeFamily: null, responsibility: 'NAO_IDENTIFICADA', merchandiseStatus: 'DESCONHECIDO', merchandiseCondition: null, recoverableValue: null, operatorNotes: null, hasDispute: false, disputeStatus: 'NAO_INICIADA', disputeRecovered: null, disputeContested: null, disputeNote: null, events: [], activities: [], impact: { refundedTotal: 0, additionalCostTotal: 0, recoveredTotal: 0, knownNetImpact: 0, cmvAvailable: false } }; }
  function computeImpact(events, recoverable) { var refunded = 0, additional = 0, recovery = 0; (events || []).forEach(function (e) { var m = EVENT_META[e.type] || {}; var b = m.bucket || (e.direction === 'COST' ? 'additional' : e.direction === 'RECOVERY' ? 'recovery' : 'none'); var a = e.amount || 0; if (b === 'refund') refunded += a; else if (b === 'additional') additional += a; else if (b === 'recovery') recovery += a; }); recovery += recoverable || 0; return { refundedTotal: r2(refunded), additionalCostTotal: r2(additional), recoveredTotal: r2(recovery), knownNetImpact: r2(refunded + additional - recovery), cmvAvailable: false }; }
  function recomputeOccImpact(occ) { occ.impact = computeImpact(occ.events, occ.recoverableValue || 0); occ.knownNetImpact = occ.impact.knownNetImpact; return occ.impact; }
  function putEvent(occ, dedupeKey, type, direction, amount, source, note) { occ.events = occ.events || []; var ex = occ.events.find(function (e) { return e.dedupeKey === dedupeKey; }); if (ex) { ex.amount = amount; ex.type = type; ex.direction = direction; } else { occ.events.push({ id: 'e' + Date.now() + Math.round(Math.random() * 1e6), dedupeKey: dedupeKey, type: type, direction: direction, amount: amount, source: source || 'MANUAL', note: note || null, createdByName: source === 'IMPORT' ? 'Importação' : 'Operador', occurredAt: new Date().toISOString() }); } }
  function upsertImportEvents(occ, exposure, requested, compensation) { if (exposure.bucket === 'CONFIRMED' && requested > 0) putEvent(occ, 'import:refund', 'REEMBOLSO_PAGO', 'COST', requested, 'IMPORT'); if (compensation > 0) putEvent(occ, 'import:compensation', 'COMPENSACAO_SHOPEE', 'RECOVERY', compensation, 'IMPORT'); }
  function addActivity(occ, kind, data) { occ.activities = occ.activities || []; occ.activities.unshift(Object.assign({ id: 'a' + Date.now() + Math.round(Math.random() * 1e6), kind: kind, createdAt: new Date().toISOString() }, data)); }
  function occEffectiveLoss(o) { return Math.max(0, (o.impact && o.impact.knownNetImpact) || 0); }
  function occGuessCause(o) { var s = (o.causeFamily || o.internalCause || o.reason || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); if (/quebr|avar|dano|trinc|rachad/.test(s)) return 'AVARIA'; if (/errad|troca|separac|item faltando|faltan|divergent/.test(s)) return 'SEPARACAO'; if (/arrepend|desist|nao quero|gostei/.test(s)) return 'ARREPENDIMENTO'; if (/entreg|extravi|transport|correi|logistic|nao recebi/.test(s)) return 'LOGISTICA'; if (/defeit|qualidade|funciona|apresent/.test(s)) return 'QUALIDADE'; return 'SEM_MOTIVO'; }
  function occApproved(o) { return /conclu|aprovad|reembols|pago|finaliz|sucesso|deferid/.test((o.status || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()); }
  function occGiveup(o) { return /cancel|desist|recus|rejeit/.test((o.status || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()); }
  function saveOcc(o) { return putMany('occ', [o]); }
  // Normaliza ocorrências salvas por versões anteriores (sem impact/events/campos operacionais),
  // para que a análise nunca quebre e o impacto reflita a exposição. Idempotente.
  function migrateOcc(o) {
    var m = Object.assign(newOcc(o.id, o.type), o);
    m.events = o.events || []; m.activities = o.activities || [];
    m.exposure = o.exposure || S.posVenda.classify(o.status || null, o.requested || 0, o.compensation || 0);
    upsertImportEvents(m, m.exposure, m.requested || 0, m.compensation || 0);
    recomputeOccImpact(m);
    return m;
  }

  // ---------- IndexedDB (v2: adiciona stores de Produtos sem apagar dados) ----------
  var STORES = { orders: 'id', occ: 'id', batches: 'id', products: 'id', variations: 'id', pfamilies: 'id', pimports: 'id', plans: 'id' };
  function openDB() {
    return new Promise(function (res, rej) {
      var r = indexedDB.open('sistema_marketplace', 3);
      r.onupgradeneeded = function () {
        var db = r.result;
        Object.keys(STORES).forEach(function (s) { if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: STORES[s] }); });
      };
      r.onsuccess = function () { DB = r.result; res(); };
      r.onerror = function () { rej(r.error); };
    });
  }
  function getAll(store) { return new Promise(function (res, rej) { var rq = DB.transaction(store).objectStore(store).getAll(); rq.onsuccess = function () { res(rq.result || []); }; rq.onerror = function () { rej(rq.error); }; }); }
  function putMany(store, items) { return new Promise(function (res, rej) { if (!items.length) return res(); var tx = DB.transaction(store, 'readwrite'); var os = tx.objectStore(store); items.forEach(function (it) { os.put(it); }); tx.oncomplete = function () { res(); }; tx.onerror = function () { rej(tx.error); }; }); }
  function clearAll() { return new Promise(function (res) { var names = Object.keys(STORES); var tx = DB.transaction(names, 'readwrite'); names.forEach(function (s) { tx.objectStore(s).clear(); }); tx.oncomplete = function () { res(); }; }); }

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
    if (p === '7d') return { from: new Date(now - 7 * 864e5) };
    if (p === '30d') return { from: new Date(now - 30 * 864e5) };
    if (p === 'month') return { from: new Date(now.getFullYear(), now.getMonth(), 1) };
    if (p === 'prevmonth') return { from: new Date(now.getFullYear(), now.getMonth() - 1, 1), to: new Date(now.getFullYear(), now.getMonth(), 1) };
    return {};
  }
  function inPeriod(iso) { if (!iso) return true; var r = periodRange(); var d = new Date(iso); if (r.from && d < r.from) return false; if (r.to && d > r.to) return false; return true; }
  function pedidosInPeriod() { return orders.filter(function (o) { return inPeriod(o.createdAt); }); }
  function occInPeriod() { return occ.filter(function (o) { return inPeriod(o.occurredAt); }); }

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
  function importPosVenda(type, file) {
    return file.arrayBuffer().then(function (ab) {
      var parsed = S.posVenda.parse(ab, file.name, type);
      if (parsed.notRecognized) throw new Error('Relatório de pós-venda não reconhecido para o tipo selecionado.');
      var groups = {};
      (parsed.rows || []).forEach(function (r) { var k = r.occurrenceKey; if (!k) return; (groups[k] = groups[k] || []).push(r); });
      var byId = {}; occ.forEach(function (o) { byId[o.id] = o; });
      var novo = 0, upd = 0, unch = 0, itemsSeen = 0; var changed = [];
      Object.keys(groups).forEach(function (key) {
        var g = groups[key]; var rep = g.find(function (r) { return r.status; }) || g[0]; itemsSeen += g.length;
        var uid = type + ':' + key; var requested = num(rep.requestedRefundAmount), compensation = num(rep.sellerCompensationAmount);
        var exposure = S.posVenda.classify(rep.status, requested, compensation);
        var ex = byId[uid]; var next = ex ? ex : newOcc(uid, type); // preserva estado operacional em reimportações (§30)
        next.orderId = rep.orderId; next.returnId = rep.returnId; next.status = rep.status; next.reason = rep.reason; next.resolution = rep.resolution;
        next.occurredAt = rep.occurredAt ? new Date(rep.occurredAt).toISOString() : next.occurredAt;
        next.requested = requested; next.compensation = compensation; next.exposure = exposure;
        next.items = g.map(function (r) { return { sku: r.sku, productName: r.productName, qty: r.quantity, skuLinked: !!(r.sku && skuCost[r.sku.toLowerCase()]) }; });
        upsertImportEvents(next, exposure, requested, compensation); recomputeOccImpact(next);
        if (!ex) { novo++; } else if (ex.status !== next.status) { upd++; } else { unch++; } byId[uid] = next; changed.push(next);
      });
      occ = Object.values(byId);
      var label = { RETURN_REFUND: 'Devoluções', ORDER_CANCELLATION: 'Cancelamentos', FAILED_DELIVERY: 'Falhas de entrega' }[type];
      var batch = { id: 'b' + Date.now() + Math.round(performance.now()), module: 'Pós-venda · ' + label, filename: file.name, createdAt: new Date().toISOString(), seen: Object.keys(groups).length, itemsSeen: itemsSeen, novo: novo, upd: upd, unch: unch };
      batches.unshift(batch);
      return Promise.all([putMany('occ', changed), putMany('batches', [batch])]).then(function () { return batch; });
    });
  }
  function fileInput(cb) { var inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.xlsx,.xls,.csv'; inp.onchange = function () { if (inp.files[0]) cb(inp.files[0]); }; inp.click(); }

  // ============================================================ RENDER (roteamento)
  function setActive() { document.querySelectorAll('#nav a').forEach(function (a) { a.classList.toggle('active', a.dataset.route === route); }); crumb.textContent = { dashboard: 'Dashboard', produtos: 'Produtos', pedidos: 'Pedidos', posvenda: 'Devolução', ia: 'Inteligência' }[route]; }
  function render() {
    setActive();
    if (route === 'produtos') { Produtos.render(); return; }
    if (route === 'dashboard') return renderDashboard();
    if (route === 'pedidos') return renderPedidos();
    if (route === 'posvenda') return renderPosVenda();
    if (route === 'ia') return renderIA();
  }

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
      '<div class="page-head"><div><h2>Visão geral</h2><p>Panorama de vendas e pós-venda — determinístico e auditável.</p></div></div>' +
      (empty ? banner('Comece importando planilhas em <b>Produtos</b>, <b>Pedidos</b> e <b>Pós-venda</b>. Os módulos se conectam automaticamente (SKU→família→custo e pedido↔devolução).') : '') +
      '<div class="cards6">' + fcard('Venda real', brl(a.revenue), 'blue', nn(a.orders) + ' pedidos') + fcard('Unidades', nn(a.units), '') + fcard('Taxas marketplace', brl(a.fees), 'red') + fcard('Custo produtos', brl(a.cost), 'amber') + fcard('Resultado estimado', brl(a.result), 'green', a.costPending ? a.costPending + ' pedidos c/ custo pendente' : 'determinístico') + fcard('Margem estimada', a.revenue ? pct((a.result / a.revenue) * 100) : '—', '') + '</div>' +
      '<div class="cards6">' + fcard('A enviar', nn(a.byStatus.A_ENVIAR || 0), 'amber') + fcard('Enviados', nn(a.byStatus.ENVIADO || 0), 'blue') + fcard('Concluídos', nn(a.byStatus.CONCLUIDO || 0), 'green') + fcard('Cancelados', nn(a.byStatus.CANCELADO || 0), 'red') + fcard('Devoluções (pós-venda)', nn(o.length), '') + fcard('Prejuízo confirmado', brl(exposure.confirmedLoss), 'red') + '</div>' +
      '<div class="cards6">' + fcard('SKUs sem vínculo', nn(a.unlinked) + ' pedidos', 'amber') + fcard('Custo pendente', nn(a.costPending) + ' pedidos', 'amber') + fcard('Em risco (pós-venda)', brl(exposure.atRisk), 'amber') + '</div>' +
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
      '<div class="panel"><div class="table-wrap"><table><thead><tr><th>Pedido</th><th>Data</th><th>Status</th><th>Produto</th><th>Venda</th><th>Taxas</th><th>Lucro est.</th><th>Margem</th><th>Pós-venda</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div></div>';
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
      (occs.length ? '<div class="panel"><div class="ph"><h3>Pós-venda vinculada</h3></div><div class="pb">' + occs.map(function (x) { return '<div class="ro" style="margin-bottom:6px">' + esc(x.type) + ' · ' + esc(x.status || '—') + ' · ' + brl(x.requested) + ' <span class="tag">' + x.exposure.bucket + '</span></div>'; }).join('') + '</div></div>' : '') +
      '</div></div></div></div>';
    d.onclick = function (e) { if (e.target === d) d.remove(); }; d.querySelector('.x').onclick = function () { d.remove(); };
    document.body.appendChild(d);
  }

  // ---------- PÓS-VENDA ----------
  function sumExposure(list) { var a = { requested: 0, confirmedLoss: 0, atRisk: 0, recovered: 0, cancelled: 0 }; list.forEach(function (o) { var e = o.exposure; a.requested += e.requested; a.confirmedLoss += e.confirmedLoss; a.atRisk += e.atRisk; if (e.bucket === 'RECOVERED') a.recovered += e.compensation; if (e.bucket === 'CANCELLED') a.cancelled += e.requested; }); Object.keys(a).forEach(function (k) { a[k] = Math.round(a[k] * 100) / 100; }); return a; }
  function renderPosVenda() {
    var TYPES = [['RETURN_REFUND', 'Devoluções / Reembolsos'], ['ORDER_CANCELLATION', 'Cancelamentos'], ['FAILED_DELIVERY', 'Falhas de Entrega']];
    var tabs = [['visao', 'Visão Geral'], ['ocorrencias', 'Ocorrências'], ['motivos', 'Motivos'], ['causas', 'Causas'], ['produtos', 'Produtos & SKUs'], ['financeiro', 'Financeiro'], ['disputas', 'Disputas'], ['achados', 'Achados'], ['pendencias', 'Pendências'], ['planos', 'Plano de Ação'], ['import', 'Importações']];
    app.innerHTML = '<div class="page-head"><div><h2>Devolução</h2><p>Operação, controle financeiro, investigação e inteligência — devoluções, reembolsos, cancelamentos e falhas.</p></div></div>' +
      '<div class="subtabs">' + tabs.map(function (t) { return subtab('posvenda', t[0], t[1]); }).join('') + '</div><div id="devbody"></div>';
    var body = document.getElementById('devbody'); var t = sub.posvenda;
    try {
    if (t === 'import') body.innerHTML = '<div class="cards6">' + TYPES.map(function (x) { return '<div class="fcard"><div class="lbl">' + x[1] + '</div><button class="btn-sm primary" style="margin-top:10px" data-pv="' + x[0] + '">Importar</button></div>'; }).join('') + '</div>' + importsFor('Pós-venda');
    else if (t === 'ocorrencias') body.innerHTML = devOcc();
    else if (t === 'motivos') body.innerHTML = devMotivos();
    else if (t === 'causas') body.innerHTML = devCausas();
    else if (t === 'produtos') body.innerHTML = devCriticos();
    else if (t === 'financeiro') body.innerHTML = devFinanceiro();
    else if (t === 'disputas') body.innerHTML = devDisputas();
    else if (t === 'achados') body.innerHTML = devAchados();
    else if (t === 'pendencias') body.innerHTML = devPendencias();
    else if (t === 'planos') body.innerHTML = devPlanos();
    else body.innerHTML = devExec();
    } catch (e) { body.innerHTML = '<div class="form-err">Erro ao renderizar esta aba: ' + esc(e.message || e) + '</div>'; }
    app.querySelectorAll('[data-pv]').forEach(function (b) { b.onclick = function () { fileInput(function (f) { importPosVenda(b.dataset.pv, f).then(function (batch) { render(); toast('Importado', batch.seen + ' ocorrências · ' + batch.novo + ' novas · ' + batch.upd + ' atualizadas · ' + batch.unch + ' sem alteração'); }).catch(function (e) { toast('Falha', e.message, true); }); }); }; });
    bindSubtabs('posvenda');
    app.querySelectorAll('[data-oc]').forEach(function (b) { b.onclick = function () { openFicha(b.dataset.oc); }; });
    app.querySelectorAll('[data-go]').forEach(function (b) { b.onclick = function () { sub.posvenda = b.dataset.go; render(); }; });
    if (t === 'ocorrencias') bindDevOcc();
    if (t === 'achados') bindAchados();
    if (t === 'planos') bindPlanos();
  }
  // ---- Causas, Achados e Plano de Ação (client-side, mesmas regras do backend) ----
  function devCausasData(list) {
    var total = devLoss(list) || 1; var map = {};
    list.forEach(function (o) { var key = o.causeFamily || occGuessCause(o); var c = map[key] = map[key] || { key: key, label: DEV.CAUSE_LABELS[key] || key, cases: 0, loss: 0, atRisk: 0, additional: 0, recovered: 0, reasons: {} }; c.cases++; c.loss += occEffectiveLoss(o); c.atRisk += o.exposure.atRisk; c.additional += o.impact.additionalCostTotal || 0; c.recovered += o.impact.recoveredTotal || 0; var rr = (o.reason || '—').trim(); c.reasons[rr] = (c.reasons[rr] || 0) + 1; });
    return Object.values(map).map(function (c) { var dom = Object.entries(c.reasons).sort(function (a, b) { return b[1] - a[1]; })[0]; return { key: c.key, label: c.label, cases: c.cases, loss: r2(c.loss), atRisk: r2(c.atRisk), additional: r2(c.additional), recovered: r2(c.recovered), net: r2(c.loss + c.additional - c.recovered), dom: dom ? dom[0] : '—', share: r2(c.loss / total * 100) }; }).sort(function (a, b) { return b.loss - a.loss; });
  }
  function devCausas() { var list = occInPeriod(); if (!list.length) return emptyBox('Sem ocorrências no período.'); var d = devCausasData(list); return '<div class="panel"><div class="ph"><h3>Causas (interna ≠ motivo Shopee)</h3></div><div class="table-wrap"><table><thead><tr><th>Causa</th><th>Casos</th><th>Perda</th><th>Custo adic.</th><th>Recuperado</th><th>Impacto líq.</th><th>Motivo dominante</th><th>% da perda</th></tr></thead><tbody>' + d.map(function (c) { return '<tr><td><b>' + esc(c.label) + '</b></td><td>' + nn(c.cases) + '</td><td>' + brl(c.loss) + '</td><td>' + brl(c.additional) + '</td><td>' + brl(c.recovered) + '</td><td><b>' + brl(c.net) + '</b></td><td>' + esc((c.dom || '—').slice(0, 28)) + '</td><td><span class="tag">' + pct(c.share) + '</span></td></tr>'; }).join('') + '</tbody></table></div><div class="footnote">Classifique a causa interna e a família da causa na ficha da ocorrência.</div></div>'; }

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
  function devAchados() {
    var list = occInPeriod(); var d = devAchadosData(list);
    if (!list.length) return emptyBox('Sem ocorrências no período.');
    return '<div class="count-line">Amostra: <b>' + nn(d.sample) + '</b> ocorrências · confiança <b>' + d.conf + '</b></div>' +
      (d.findings.length ? d.findings.map(function (f, i) { return '<div class="panel"><div class="ph"><h3>' + esc(f.title) + '</h3><span class="tag ' + (f.conf === 'ALTA' ? 'ok' : f.conf === 'MEDIA' ? 'info' : 'warn') + '">' + f.conf + '</span></div><div class="pb"><p style="margin-top:0">' + esc(f.desc) + '</p><div style="display:flex;gap:10px;align-items:center"><span class="footnote" style="margin:0">Ação sugerida: <b>' + esc(f.action) + '</b></span><button class="btn-sm primary" data-plan="' + i + '">Criar plano de ação</button></div></div></div>'; }).join('') : '<div class="panel"><div class="empty">Nenhum achado relevante no período. 🎉</div></div>') +
      (d.notProblems.length ? '<div class="panel"><div class="ph"><h3>O que o problema NÃO é</h3></div><div class="pb">' + d.notProblems.map(function (np) { return '<div class="fin-line"><span><b>' + esc(np.dim) + '</b></span><span class="footnote" style="margin:0">' + esc(np.note) + '</span></div>'; }).join('') + '</div></div>' : '');
  }
  function bindAchados() { var d = devAchadosData(occInPeriod()); app.querySelectorAll('[data-plan]').forEach(function (b) { b.onclick = function () { var f = d.findings[+b.dataset.plan]; if (!f) return; createPlan({ title: f.action, origin: 'finding', relatedFindings: [f.type], relatedSkus: f.skus || [], priority: 'ALTA' }).then(function () { toast('Plano criado', f.action); sub.posvenda = 'planos'; render(); }); }; }); }

  // Plano de ação (IndexedDB) com medição antes/depois determinística.
  function measureScope(skus) { if (!skus || !skus.length) return 0; var set = {}; skus.forEach(function (s) { set[s.toLowerCase()] = 1; }); return r2(occ.filter(function (o) { return (o.items || []).some(function (i) { return i.sku && set[i.sku.toLowerCase()]; }); }).reduce(function (s, o) { return s + occEffectiveLoss(o); }, 0)); }
  function createPlan(dto) { var now = new Date().toISOString(); var baseline = dto.baselineValue != null ? dto.baselineValue : measureScope(dto.relatedSkus); var p = { id: 'p' + Date.now() + Math.round(Math.random() * 1e6), title: dto.title, description: dto.description || null, origin: dto.origin || 'user', status: dto.status || 'PLANNED', priority: dto.priority || 'MEDIA', ownerName: dto.ownerName || null, indicator: dto.indicator || 'Impacto líquido do escopo', baselineValue: baseline, targetValue: dto.targetValue != null ? dto.targetValue : null, relatedSkus: dto.relatedSkus || [], relatedFindings: dto.relatedFindings || [], checklist: [], implementedAt: null, createdAt: now }; plans.unshift(p); return putMany('plans', [p]); }
  function savePlan(p) { return putMany('plans', [p]); }
  function planMeasure(p) { var current = measureScope(p.relatedSkus); var delta = p.baselineValue != null ? r2(current - p.baselineValue) : null; return { baseline: p.baselineValue, current: current, delta: delta, improved: delta == null ? null : delta < 0, after: p.implementedAt ? current : null }; }
  var PLAN_STATUS = { SUGGESTED: 'Sugerido', PLANNED: 'Planejado', IN_PROGRESS: 'Em andamento', IMPLEMENTED: 'Implantado', MEASURING: 'Medindo', DONE: 'Concluído', DISCARDED: 'Descartado' };
  function devPlanos() {
    return '<div class="importbar"><div style="flex:1;display:flex;gap:8px;flex-wrap:wrap"><input class="input sm" id="plt" style="flex:2;min-width:220px" placeholder="Nova ação (ex.: novo padrão de embalagem 80x120)"><input class="input sm" id="pls" style="flex:1;min-width:160px" placeholder="SKUs (vírgula) — escopo/medição"><button class="btn-sm primary" id="plnew">Criar plano</button></div></div>' +
      (plans.length ? plans.map(function (p) { var m = planMeasure(p); return '<div class="panel"><div class="ph"><h3>' + esc(p.title) + '</h3><span class="tag info">' + (PLAN_STATUS[p.status] || p.status) + '</span></div><div class="pb"><div class="cards6" style="margin-bottom:10px">' + fcard('Baseline (antes)', m.baseline == null ? '—' : brl(m.baseline), '') + fcard('Atual', brl(m.current), '') + fcard('Δ (depois − antes)', m.delta == null ? '—' : brl(m.delta), m.improved ? 'green' : m.improved === false ? 'red' : '') + fcard('Desde implantação', m.after == null ? 'não implantado' : brl(m.after), '') + '</div>' + (p.relatedSkus.length ? '<div class="footnote">Escopo: ' + esc(p.relatedSkus.join(', ')) + '</div>' : '') + '<div style="margin-top:8px">' + p.checklist.map(function (it) { return '<label style="display:flex;gap:8px;align-items:center;padding:3px 0"><input type="checkbox" data-plchk="' + p.id + '|' + it.id + '"' + (it.done ? ' checked' : '') + '> <span style="text-decoration:' + (it.done ? 'line-through' : 'none') + ';color:' + (it.done ? 'var(--muted)' : 'inherit') + '">' + esc(it.text) + '</span></label>'; }).join('') + '</div><div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap;align-items:center"><input class="input sm" data-plitem="' + p.id + '" style="width:200px" placeholder="+ item do checklist"><select class="select sm" data-plstatus="' + p.id + '">' + Object.keys(PLAN_STATUS).map(function (k) { return '<option value="' + k + '"' + (p.status === k ? ' selected' : '') + '>' + PLAN_STATUS[k] + '</option>'; }).join('') + '</select><button class="btn-sm" data-pldel="' + p.id + '">Excluir</button></div></div></div>'; }).join('') : '<div class="panel"><div class="empty">Nenhum plano de ação. Crie um a partir de um Achado ou manualmente.</div></div>');
  }
  function bindPlanos() {
    var nb = document.getElementById('plnew'); if (nb) nb.onclick = function () { var t = document.getElementById('plt').value.trim(); if (!t) return; var skus = (document.getElementById('pls').value || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean); createPlan({ title: t, relatedSkus: skus }).then(function () { render(); toast('Plano criado', t); }); };
    app.querySelectorAll('[data-plchk]').forEach(function (c) { c.onchange = function () { var pr = c.dataset.plchk.split('|'); var p = plans.find(function (x) { return x.id === pr[0]; }); if (!p) return; var it = p.checklist.find(function (x) { return x.id === pr[1]; }); if (it) { it.done = c.checked; savePlan(p).then(render); } }; });
    app.querySelectorAll('[data-plitem]').forEach(function (inp) { inp.onkeydown = function (e) { if (e.key === 'Enter' && inp.value.trim()) { var p = plans.find(function (x) { return x.id === inp.dataset.plitem; }); if (p) { p.checklist.push({ id: 'c' + Date.now() + Math.round(Math.random() * 1e6), text: inp.value.trim(), done: false }); savePlan(p).then(render); } } }; });
    app.querySelectorAll('[data-plstatus]').forEach(function (s) { s.onchange = function () { var p = plans.find(function (x) { return x.id === s.dataset.plstatus; }); if (!p) return; p.status = s.value; if ((s.value === 'IMPLEMENTED' || s.value === 'MEASURING') && !p.implementedAt) p.implementedAt = new Date().toISOString(); savePlan(p).then(render); }; });
    app.querySelectorAll('[data-pldel]').forEach(function (b) { b.onclick = function () { var id = b.dataset.pldel; plans = plans.filter(function (x) { return x.id !== id; }); var tx = DB.transaction('plans', 'readwrite'); tx.objectStore('plans').delete(id); tx.oncomplete = function () { render(); }; }; });
  }
  // ---- análise client-side (mesmas regras determinísticas do backend) ----
  function devLoss(list) { return list.reduce(function (s, o) { return s + occEffectiveLoss(o); }, 0); }
  function devCauseBreakdown(list) { var map = {}; var total = devLoss(list) || 1; list.forEach(function (o) { var key = o.causeFamily || occGuessCause(o); var c = map[key] = map[key] || { key: key, label: DEV.CAUSE_LABELS[key] || key, cases: 0, loss: 0, atRisk: 0 }; c.cases++; c.loss += occEffectiveLoss(o); c.atRisk += o.exposure.atRisk; }); return Object.values(map).map(function (c) { c.share = r2(c.loss / total * 100); c.loss = r2(c.loss); c.atRisk = r2(c.atRisk); return c; }).sort(function (a, b) { return b.loss - a.loss; }); }
  function devMotivosData(list) { var map = {}; list.forEach(function (o) { var reason = (o.reason || '(sem motivo informado)').trim(); var c = map[reason] = map[reason] || { reason: reason, cases: 0, approved: 0, analyzing: 0, giveups: 0, loss: 0, atRisk: 0, compensation: 0, ticket: 0, returned: 0 }; c.cases++; if (occApproved(o)) c.approved++; else if (occGiveup(o)) c.giveups++; else c.analyzing++; c.loss += occEffectiveLoss(o); c.atRisk += o.exposure.atRisk; c.compensation += o.compensation; c.ticket += o.requested; if (o.merchandiseStatus === 'RECEBIDO') c.returned++; }); return Object.values(map).map(function (r) { r.giveupRate = r.cases ? r2(r.giveups / r.cases * 100) : 0; r.avgTicket = r.cases ? r2(r.ticket / r.cases) : 0; r.loss = r2(r.loss); r.atRisk = r2(r.atRisk); r.compensation = r2(r.compensation); return r; }).sort(function (a, b) { return b.loss - a.loss || b.cases - a.cases; }); }
  function devCriticosData(list) { var map = {}; var total = devLoss(list) || 1; list.forEach(function (o) { var seen = {}; var skus = []; (o.items || []).forEach(function (i) { if (i.sku && !seen[i.sku]) { seen[i.sku] = 1; skus.push(i.sku); } }); var share = skus.length || 1; var cause = o.causeFamily || occGuessCause(o); skus.forEach(function (sku) { var item = (o.items || []).find(function (i) { return i.sku === sku; }); var c = map[sku] = map[sku] || { sku: sku, product: item ? item.productName : null, occ: 0, loss: 0, additional: 0, recovered: 0, causes: {}, linked: !!(item && item.skuLinked) }; c.occ++; c.loss += occEffectiveLoss(o) / share; c.additional += (o.impact.additionalCostTotal || 0) / share; c.recovered += (o.impact.recoveredTotal || 0) / share; c.causes[cause] = (c.causes[cause] || 0) + 1; }); }); return Object.values(map).map(function (s) { var dom = Object.entries(s.causes).sort(function (a, b) { return b[1] - a[1]; })[0]; return { sku: s.sku, product: s.product, occ: s.occ, loss: r2(s.loss), additional: r2(s.additional), recovered: r2(s.recovered), dominant: dom ? (DEV.CAUSE_LABELS[dom[0]] || dom[0]) : '—', share: r2(s.loss / total * 100), linked: s.linked }; }).sort(function (a, b) { return b.loss - a.loss || b.occ - a.occ; }).slice(0, 50); }
  function devFinanceiroData(list) { var r = { refunded: 0, additional: 0, recovered: 0, compensation: 0, disputeRec: 0, confirmed: 0, atRisk: 0, net: 0 }; list.forEach(function (o) { r.refunded += o.impact.refundedTotal || 0; r.additional += o.impact.additionalCostTotal || 0; r.recovered += o.impact.recoveredTotal || 0; r.compensation += o.compensation; r.disputeRec += o.disputeRecovered || 0; r.confirmed += occEffectiveLoss(o); r.atRisk += o.exposure.atRisk; r.net += occEffectiveLoss(o); }); Object.keys(r).forEach(function (k) { r[k] = r2(r[k]); }); return r; }
  function devDisputesData(list) { var now = new Date(); var soon = new Date(now.getTime() + 3 * 864e5); var d = { possiveis: 0, abertas: 0, vencendo: 0, vencidas: 0, respondidas: 0, ganhas: 0, perdidas: 0, contestado: 0, recuperado: 0 }; list.forEach(function (o) { var st = o.disputeStatus; if (st === 'POSSIVEL') d.possiveis++; if (['POSSIVEL', 'EM_PREPARACAO', 'RESPONDIDA', 'AGUARDANDO_SHOPEE'].indexOf(st) >= 0) d.abertas++; if (['EM_PREPARACAO', 'AGUARDANDO_SHOPEE', 'POSSIVEL'].indexOf(st) >= 0 && o.disputeDeadline) { var dl = new Date(o.disputeDeadline); if (dl < now) d.vencidas++; else if (dl <= soon) d.vencendo++; } if (st === 'RESPONDIDA' || o.disputeRespondedAt) d.respondidas++; if (st === 'GANHA' || st === 'PARCIAL') d.ganhas++; if (st === 'PERDIDA') d.perdidas++; d.contestado += o.disputeContested || 0; d.recuperado += o.disputeRecovered || 0; }); var resp = d.possiveis + d.respondidas + d.ganhas + d.perdidas; d.taxaResposta = resp ? r2((d.respondidas + d.ganhas + d.perdidas) / resp * 100) : 0; d.contestado = r2(d.contestado); d.recuperado = r2(d.recuperado); return d; }
  function devPendingData(list) { var now = new Date(); var soon = new Date(now.getTime() + 3 * 864e5); var p = { a: 0, b: 0, c: 0, d: 0, e: 0, f: 0 }; list.forEach(function (o) { if (['EM_PREPARACAO', 'AGUARDANDO_SHOPEE', 'POSSIVEL'].indexOf(o.disputeStatus) >= 0 && o.disputeDeadline && new Date(o.disputeDeadline) <= soon) p.a++; if (o.internalStatus === 'AGUARDANDO_EVIDENCIA') p.b++; if (o.internalStatus === 'AGUARDANDO_RETORNO' || o.merchandiseStatus === 'AGUARDANDO_POSTAGEM' || o.merchandiseStatus === 'EM_TRANSITO') p.c++; if (!o.internalCause && !o.causeFamily) p.d++; if (o.internalStatus === 'NOVA') p.e++; if ((o.items || []).some(function (i) { return i.sku && !i.skuLinked; })) p.f++; }); return [['Disputas vencendo (≤3 dias)', p.a], ['Aguardando evidência', p.b], ['Produtos aguardando retorno', p.c], ['Devoluções sem causa interna', p.d], ['Ocorrências novas (sem triagem)', p.e], ['SKUs não vinculados', p.f]].filter(function (x) { return x[1] > 0; }); }

  function devExec() {
    var list = occInPeriod(); if (!list.length) return emptyBox('Nenhuma ocorrência. Importe os relatórios na aba Importações.');
    var agg = computeOrderAgg(); var causes = devCauseBreakdown(list); var crit = devCriticosData(list).slice(0, 5); var disp = devDisputesData(list); var pend = devPendingData(list);
    var confirmed = r2(devLoss(list)); var atRisk = r2(list.reduce(function (s, o) { return s + o.exposure.atRisk; }, 0)); var recovered = r2(list.reduce(function (s, o) { return s + (o.impact.recoveredTotal || 0); }, 0)); var additional = r2(list.reduce(function (s, o) { return s + (o.impact.additionalCostTotal || 0); }, 0)); var compensation = r2(list.reduce(function (s, o) { return s + o.compensation; }, 0));
    var semRetorno = list.filter(function (o) { return ['PERDIDO', 'EXTRAVIADO'].indexOf(o.merchandiseStatus) >= 0 || (o.merchandiseStatus === 'DESCONHECIDO' && occApproved(o)); }).length;
    return '<div class="cards6">' +
      fcard('Taxa de devolução', agg.orders ? pct(list.length / agg.orders * 100) : '—', 'blue', nn(list.length) + ' / ' + nn(agg.orders) + ' pedidos') +
      fcard('Perda sobre faturamento', agg.revenue ? pct(confirmed / agg.revenue * 100) : '—', '') +
      fcard('Perda confirmada', brl(confirmed), 'red') + fcard('Em risco', brl(atRisk), 'amber') +
      fcard('Recuperado', brl(recovered), 'green') + fcard('Custos adicionais', brl(additional), 'amber', 'frete reverso, retrabalho') +
      fcard('Produto sem retorno', nn(semRetorno), '') + fcard('Disputas abertas', nn(disp.abertas), '', disp.vencendo + ' vencendo · resposta ' + pct(disp.taxaResposta)) + '</div>' +
      '<div class="panel"><div class="ph"><h3>Onde está o erro</h3><button class="link-btn" data-go="motivos">Analisar motivos</button></div><div class="table-wrap"><table><thead><tr><th>Causa</th><th>Casos</th><th>Perda</th><th>Em risco</th><th>% da perda</th></tr></thead><tbody>' +
      (causes.length ? causes.map(function (c) { return '<tr><td><b>' + esc(c.label) + '</b></td><td>' + nn(c.cases) + '</td><td>' + brl(c.loss) + '</td><td>' + brl(c.atRisk) + '</td><td><span class="tag">' + pct(c.share) + '</span></td></tr>'; }).join('') : '<tr><td colspan="5" class="empty">Sem dados.</td></tr>') + '</tbody></table></div></div>' +
      '<div class="split2"><div class="panel"><div class="ph"><h3>Produtos críticos</h3><button class="link-btn" data-go="produtos">Ver todos</button></div><div class="table-wrap"><table><thead><tr><th>SKU</th><th>Ocor.</th><th>Perda</th><th>Causa</th></tr></thead><tbody>' +
      (crit.length ? crit.map(function (s) { return '<tr><td class="mono">' + esc(s.sku) + '</td><td>' + s.occ + '</td><td>' + brl(s.loss) + '</td><td>' + esc(s.dominant) + '</td></tr>'; }).join('') : '<tr><td colspan="4" class="empty">—</td></tr>') + '</tbody></table></div></div>' +
      '<div class="panel"><div class="ph"><h3>Defesa / Disputas</h3><button class="link-btn" data-go="disputas">Abrir disputas</button></div><div class="pb">' +
      '<div class="fin-line"><span>Abertas</span><b>' + nn(disp.abertas) + '</b></div><div class="fin-line"><span>Vencendo (≤3d)</span><b style="color:' + (disp.vencendo ? 'var(--warn)' : 'inherit') + '">' + nn(disp.vencendo) + '</b></div><div class="fin-line"><span>Vencidas</span><b style="color:' + (disp.vencidas ? 'var(--err)' : 'inherit') + '">' + nn(disp.vencidas) + '</b></div><div class="fin-line"><span>Taxa de resposta</span><b>' + pct(disp.taxaResposta) + '</b></div><div class="fin-line total"><span>Valor recuperado</span><span class="pos">' + brl(disp.recuperado) + '</span></div></div></div></div>' +
      '<div class="panel"><div class="ph"><h3>Atenção necessária</h3><button class="link-btn" data-go="ocorrencias">Fila operacional</button></div><div class="pb">' +
      (pend.length ? pend.map(function (x) { return '<div class="fin-line"><span>' + esc(x[0]) + '</span><b>' + nn(x[1]) + '</b></div>'; }).join('') : '<div class="footnote">Nada pendente. 🎉</div>') + '</div></div>';
  }

  function devOcc() {
    var list = occInPeriod().slice();
    if (!list.length) return emptyBox('Nenhuma ocorrência. Importe os relatórios na aba Importações.');
    if (devF.internalStatus) list = list.filter(function (o) { return o.internalStatus === devF.internalStatus; });
    if (devF.disputeStatus) list = list.filter(function (o) { return o.disputeStatus === devF.disputeStatus; });
    if (devF.search) { var s = devF.search.toLowerCase(); list = list.filter(function (o) { return (o.orderId || '').toLowerCase().indexOf(s) >= 0 || (o.reason || '').toLowerCase().indexOf(s) >= 0 || (o.items || []).some(function (i) { return (i.sku || '').toLowerCase().indexOf(s) >= 0 || (i.productName || '').toLowerCase().indexOf(s) >= 0; }); }); }
    list.sort(devF.sort === 'impact' ? function (a, b) { return occEffectiveLoss(b) - occEffectiveLoss(a); } : function (a, b) { return (b.occurredAt || '').localeCompare(a.occurredAt || ''); });
    var pages = Math.max(1, Math.ceil(list.length / 25)); if (devPage > pages) devPage = pages;
    var slice = list.slice((devPage - 1) * 25, devPage * 25);
    var ordSet = {}; orders.forEach(function (o) { ordSet[o.id] = true; });
    var opts = function (m, sel) { return Object.keys(m).map(function (k) { return '<option value="' + k + '"' + (sel === k ? ' selected' : '') + '>' + m[k] + '</option>'; }).join(''); };
    return '<div class="toolbar2"><input class="input sm" id="devq" style="width:240px" placeholder="Buscar pedido, SKU, motivo…" value="' + esc(devF.search) + '">' +
      '<select class="select sm" id="devis"><option value="">Status interno: todos</option>' + opts(DEV.INTERNAL_STATUS, devF.internalStatus) + '</select>' +
      '<select class="select sm" id="devds"><option value="">Disputa: todas</option>' + opts(DEV.DISPUTE_STATUS, devF.disputeStatus) + '</select>' +
      '<select class="select sm" id="devsort"><option value="recent"' + (devF.sort === 'recent' ? ' selected' : '') + '>Mais recentes</option><option value="impact"' + (devF.sort === 'impact' ? ' selected' : '') + '>Maior impacto</option></select></div>' +
      '<div class="count-line"><b>' + nn(list.length) + '</b> ocorrências</div>' +
      '<div class="panel"><div class="table-wrap"><table><thead><tr><th>Pedido</th><th>Motivo</th><th>Status interno</th><th>Responsável</th><th>Disputa</th><th>Impacto líq.</th><th>Exposição</th><th></th></tr></thead><tbody>' +
      slice.map(function (o) { return '<tr><td class="mono">' + esc(o.orderId || '—') + '<div class="footnote" style="margin:0">' + esc((o.items[0] && o.items[0].sku) || '—') + ((o.items || []).length > 1 ? ' +' + (o.items.length - 1) : '') + '</div></td><td>' + esc((o.reason || '—').slice(0, 28)) + '</td><td><span class="pill st-int">' + (DEV.INTERNAL_STATUS[o.internalStatus] || o.internalStatus) + '</span></td><td>' + esc(o.ownerName || '—') + '</td><td>' + (o.disputeStatus !== 'NAO_INICIADA' ? '<span class="tag info">' + DEV.DISPUTE_STATUS[o.disputeStatus] + '</span>' : '<span class="footnote">—</span>') + '</td><td>' + (o.impact && o.impact.knownNetImpact != null ? '<b>' + brl(o.impact.knownNetImpact) + '</b>' : '—') + '</td><td><span class="tag ' + (o.exposure.bucket === 'CONFIRMED' ? 'warn' : o.exposure.bucket === 'AT_RISK' ? 'info' : 'ok') + '">' + o.exposure.bucket + '</span></td><td><button class="btn-sm" data-oc="' + esc(o.id) + '">Abrir ficha</button></td></tr>'; }).join('') +
      '</tbody></table></div></div>' + (pages > 1 ? '<div style="display:flex;gap:8px;justify-content:flex-end;align-items:center"><button class="btn-sm" id="devprev"' + (devPage <= 1 ? ' disabled' : '') + '>Anterior</button><span class="footnote" style="margin:0">página ' + devPage + ' de ' + pages + '</span><button class="btn-sm" id="devnext"' + (devPage >= pages ? ' disabled' : '') + '>Próxima</button></div>' : '');
  }
  function bindDevOcc() {
    var q = document.getElementById('devq'); if (q) { var t; q.oninput = function () { clearTimeout(t); t = setTimeout(function () { var v = q.value; devF.search = v; devPage = 1; render(); var el = document.getElementById('devq'); if (el) { el.focus(); el.value = v; el.setSelectionRange(v.length, v.length); } }, 220); }; }
    var is = document.getElementById('devis'); if (is) is.onchange = function () { devF.internalStatus = is.value; devPage = 1; render(); };
    var ds = document.getElementById('devds'); if (ds) ds.onchange = function () { devF.disputeStatus = ds.value; devPage = 1; render(); };
    var so = document.getElementById('devsort'); if (so) so.onchange = function () { devF.sort = so.value; render(); };
    var pv = document.getElementById('devprev'); if (pv) pv.onclick = function () { if (devPage > 1) { devPage--; render(); } };
    var nx = document.getElementById('devnext'); if (nx) nx.onclick = function () { devPage++; render(); };
  }
  function devMotivos() { var list = occInPeriod(); if (!list.length) return emptyBox('Sem ocorrências no período.'); var d = devMotivosData(list); return '<div class="panel"><div class="ph"><h3>Motivos, um a um</h3></div><div class="table-wrap"><table><thead><tr><th>Motivo</th><th>Casos</th><th>Aprov.</th><th>Análise</th><th>Desist.</th><th>Taxa desist.</th><th>Perda</th><th>Em risco</th><th>Ticket médio</th><th>Compensação</th><th>Retornou</th></tr></thead><tbody>' + d.map(function (r) { return '<tr><td><b>' + esc(r.reason) + '</b></td><td>' + nn(r.cases) + '</td><td>' + nn(r.approved) + '</td><td>' + nn(r.analyzing) + '</td><td>' + nn(r.giveups) + '</td><td>' + pct(r.giveupRate) + '</td><td>' + brl(r.loss) + '</td><td>' + brl(r.atRisk) + '</td><td>' + brl(r.avgTicket) + '</td><td>' + brl(r.compensation) + '</td><td>' + nn(r.returned) + '</td></tr>'; }).join('') + '</tbody></table></div></div>'; }
  function devCriticos() { var list = occInPeriod(); if (!list.length) return emptyBox('Sem ocorrências no período.'); var d = devCriticosData(list); return '<div class="panel"><div class="ph"><h3>Produtos & SKUs críticos</h3></div><div class="table-wrap"><table><thead><tr><th>SKU</th><th>Produto</th><th>Ocor.</th><th>Perda</th><th>Custo adic.</th><th>Recuperado</th><th>% da perda</th><th>Causa dominante</th></tr></thead><tbody>' + d.map(function (s) { return '<tr><td class="mono">' + esc(s.sku) + (s.linked ? '' : ' <span class="tag warn">não vinc.</span>') + '</td><td>' + esc((s.product || '—').slice(0, 40)) + '</td><td>' + nn(s.occ) + '</td><td><b>' + brl(s.loss) + '</b></td><td>' + brl(s.additional) + '</td><td>' + brl(s.recovered) + '</td><td><span class="tag">' + pct(s.share) + '</span></td><td>' + esc(s.dominant) + '</td></tr>'; }).join('') + '</tbody></table></div></div>'; }
  function devFinanceiro() { var list = occInPeriod(); if (!list.length) return emptyBox('Sem ocorrências no período.'); var f = devFinanceiroData(list); return '<div class="cards6">' + fcard('Reembolso pago', brl(f.refunded), 'red') + fcard('Custos adicionais', brl(f.additional), 'amber', 'frete reverso, retrabalho') + fcard('Compensação Shopee', brl(f.compensation), 'green') + fcard('Recuperação de disputa', brl(f.disputeRec), 'green') + fcard('Recuperado (total)', brl(f.recovered), 'green') + fcard('Impacto líquido conhecido', brl(f.net), 'red') + fcard('Em risco', brl(f.atRisk), 'amber') + '</div><div class="info-banner">Impacto líquido = custos conhecidos (reembolso + frete reverso + retrabalho…) − recuperações conhecidas (compensação + recuperação de disputa + valor recuperável). CMV (custo da mercadoria perdida) ainda não disponível — não é estimado.</div>'; }
  function devDisputas() { var list = occInPeriod(); if (!list.length) return emptyBox('Sem ocorrências no período.'); var d = devDisputesData(list); return '<div class="cards6">' + fcard('Possíveis', nn(d.possiveis), '') + fcard('Abertas', nn(d.abertas), '') + fcard('Vencendo (≤3d)', nn(d.vencendo), 'amber') + fcard('Vencidas', nn(d.vencidas), 'red') + fcard('Respondidas', nn(d.respondidas), '') + fcard('Taxa de resposta', pct(d.taxaResposta), '') + fcard('Ganhas', nn(d.ganhas), 'green') + fcard('Perdidas', nn(d.perdidas), 'red') + fcard('Valor contestado', brl(d.contestado), '') + fcard('Valor recuperado', brl(d.recuperado), 'green') + '</div><div class="footnote">Trabalhe cada disputa na ficha da ocorrência (aba Ocorrências → Abrir ficha → Disputa).</div>'; }
  function devPendencias() { var list = occInPeriod(); var p = devPendingData(list); return '<div class="panel"><div class="ph"><h3>Fila operacional — o que fazer agora</h3></div><div class="pb">' + (p.length ? p.map(function (x) { return '<div class="fin-line"><span>' + esc(x[0]) + '</span><span style="display:flex;gap:10px;align-items:center"><b>' + nn(x[1]) + '</b><button class="btn-sm" data-go="ocorrencias">Trabalhar</button></span></div>'; }).join('') : '<div class="footnote">Nada pendente. 🎉</div>') + '</div></div>'; }

  // ---- Ficha operacional editável (§8-§19) ----
  function openFicha(id) {
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
      panel.innerHTML = '<div class="dh"><div><b>Ficha — ' + esc(o.orderId || o.id) + '</b> <span class="pill st-int" style="margin-left:8px">' + (DEV.INTERNAL_STATUS[o.internalStatus] || o.internalStatus) + '</span></div><button class="x">&times;</button></div><div class="dbd">' +
        '<div class="cards6">' + fcard('Reembolso', brl(o.impact.refundedTotal), 'red') + fcard('Custos adicionais', brl(o.impact.additionalCostTotal), 'amber') + fcard('Recuperado', brl(o.impact.recoveredTotal), 'green') + fcard('Impacto líquido', o.impact.knownNetImpact == null ? '—' : brl(o.impact.knownNetImpact), 'red', o.impact.cmvAvailable ? '' : 'CMV não disponível') + '</div>' +
        '<div class="split"><div>' +
        '<div class="panel"><div class="ph"><h3>Dados da Shopee</h3></div><div class="pb">' + kv('Motivo (original)', o.reason) + kv('Status Shopee', o.status) + kv('Reembolso solicitado', brl(o.requested)) + (ord ? kv('Pedido', ord.id + ' · ' + (S.pedidos.labels[ord.normalizedStatus] || '')) : '<div class="footnote">Pedido não importado.</div>') + '<label class="fld">Itens</label>' + (o.items || []).map(function (i) { return '<div class="ro" style="margin-bottom:4px"><span class="mono">' + esc(i.sku || '—') + '</span> ' + esc((i.productName || '').slice(0, 40)) + (i.skuLinked ? '' : ' <span class="tag warn">não vinc.</span>') + '</div>'; }).join('') + '</div></div>' +
        '<div class="panel"><div class="ph"><h3>Impacto financeiro</h3></div><div class="pb">' +
        '<div class="fin-line"><span>Reembolso pago</span><span class="neg">' + brl(o.impact.refundedTotal) + '</span></div><div class="fin-line"><span>Custos adicionais</span><span class="neg">' + brl(o.impact.additionalCostTotal) + '</span></div><div class="fin-line"><span>Recuperações</span><span class="pos">-' + brl(o.impact.recoveredTotal) + '</span></div><div class="fin-line total"><span>Impacto líquido conhecido</span><span class="neg">' + (o.impact.knownNetImpact == null ? '—' : brl(o.impact.knownNetImpact)) + '</span></div>' +
        '<div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap;align-items:center"><select class="select sm" id="evtype">' + Object.keys(EVENT_META).map(function (k) { return '<option value="' + k + '">' + EVENT_META[k].label + '</option>'; }).join('') + '</select><input class="input sm" id="evamt" style="width:100px" placeholder="valor"><button class="btn-sm primary" id="evadd">+ Movimentação</button></div>' +
        (o.events && o.events.length ? '<div style="margin-top:10px">' + o.events.map(function (e) { return '<div class="fin-line"><span>' + (EVENT_META[e.type] ? EVENT_META[e.type].label : e.type) + (e.note ? ' · ' + esc(e.note) : '') + '</span><span class="' + (e.direction === 'RECOVERY' ? 'pos' : 'neg') + '">' + (e.direction === 'RECOVERY' ? '-' : '') + brl(e.amount) + '</span></div>'; }).join('') + '</div>' : '') + '</div></div></div>' +
        '<div><div class="panel"><div class="ph"><h3>Controle interno</h3></div><div class="pb">' + sel('Status interno', o.internalStatus, DEV.INTERNAL_STATUS, 'internalStatus') + sel('Prioridade', o.priority, DEV.PRIORITY, 'priority') + inp('Responsável', o.ownerName, 'ownerName', 'nome do responsável') + inp('Causa interna', o.internalCause, 'internalCause', 'ex.: proteção insuficiente do vidro') + inp('Família da causa', o.causeFamily, 'causeFamily', 'ex.: Avaria / Embalagem') + sel('Responsabilidade', o.responsibility, DEV.RESPONSIBILITY, 'responsibility') + sel('Situação da mercadoria', o.merchandiseStatus, DEV.MERCH_STATUS, 'merchandiseStatus') + sel('Condição (se recebida)', o.merchandiseCondition || '', Object.assign({ '': '—' }, DEV.MERCH_COND), 'merchandiseCondition') + inp('Valor recuperável (R$)', o.recoverableValue, 'recoverableValue', '0,00') + '</div></div>' +
        '<div class="panel"><div class="ph"><h3>Disputa</h3><span class="tag info">' + DEV.DISPUTE_STATUS[o.disputeStatus] + '</span></div><div class="pb"><select class="select" id="dispsel" style="width:100%">' + Object.keys(DEV.DISPUTE_STATUS).map(function (k) { return '<option value="' + k + '"' + (o.disputeStatus === k ? ' selected' : '') + '>' + DEV.DISPUTE_STATUS[k] + '</option>'; }).join('') + '</select><div id="dispextra"></div><button class="btn-sm primary" id="dispsave" style="margin-top:8px">Salvar disputa</button></div></div></div></div>' +
        '<div class="panel"><div class="ph"><h3>Timeline & auditoria</h3></div><div class="pb"><div style="display:flex;gap:6px;margin-bottom:10px"><input class="input sm" id="cmt" style="flex:1" placeholder="Adicionar comentário…"><button class="btn-sm" id="cmtadd">Comentar</button></div>' +
        ((o.activities || []).length ? o.activities.map(function (a) { return '<div class="fin-line"><span>' + (a.kind === 'COMMENT' ? '💬 ' + esc(a.message) : a.kind === 'FINANCIAL' ? '💰 ' + esc(a.message) : a.kind === 'DISPUTE' ? '⚖️ ' + esc(a.field || '') + ': ' + esc(a.oldValue || '∅') + ' → ' + esc(a.newValue || '∅') + (a.message ? ' · ' + esc(a.message) : '') : esc(a.field || '') + ': ' + esc(a.oldValue || '∅') + ' → ' + esc(a.newValue || '∅')) + (a.userName ? ' — ' + esc(a.userName) : '') + '</span><span class="footnote" style="margin:0">' + new Date(a.createdAt).toLocaleString('pt-BR') + '</span></div>'; }).join('') : '<div class="footnote">Sem atividade ainda.</div>') + '</div></div>' +
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
  }

  // ---------- INTELIGÊNCIA ----------
  function renderIA() {
    app.innerHTML =
      '<div class="page-head"><div><h2>Inteligência</h2><p>Chat sobre os dados com <b>Preview</b> ao lado. Respostas determinísticas e auditáveis — a IA nunca inventa números nem calcula dinheiro.</p></div></div>' +
      '<div class="aicfg"><b>Como funciona:</b> as respostas abaixo são calculadas localmente a partir dos dados importados (evidências no Preview). No sistema completo (backend), a mesma camada aciona um provedor de LLM real — com credencial cifrada no servidor, <b>nunca no navegador</b> (§46) — para gerar a narrativa; os números permanecem sempre determinísticos.</div>' +
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
  function renderPreview() { var el = document.getElementById('prev'); if (!el) return; var ev = evidence(); var a = ev.a; el.innerHTML = '<h4>Preview · evidências determinísticas</h4>' + rowline('Pedidos (período)', nn(a.orders)) + rowline('Venda real', brl(a.revenue)) + rowline('Taxas marketplace', brl(a.fees)) + rowline('Custo produtos', brl(a.cost)) + rowline('Resultado estimado', brl(a.result)) + rowline('Margem estimada', a.revenue ? pct((a.result / a.revenue) * 100) : '—') + rowline('Pedidos c/ custo pendente', nn(a.costPending)) + rowline('SKUs distintos sem custo', nn(Object.keys(ev.noCost).length)) + rowline('Ocorrências pós-venda', nn(ev.o.length)) + rowline('Prejuízo confirmado', brl(ev.e.confirmedLoss)) + rowline('Em risco', brl(ev.e.atRisk)) + '<div class="footnote" style="margin-top:10px">Estes números são a base factual das respostas do chat.</div>'; }
  function answer(q) {
    var ql = q.toLowerCase(); var ev = evidence(); var a = ev.a;
    if (/sem custo|nao vinculad|não vinculad|pendente/.test(ql)) { var skus = Object.keys(ev.noCost).slice(0, 15); return { text: (skus.length ? 'Há ' + Object.keys(ev.noCost).length + ' SKUs distintos sem custo cadastrado (vínculo ou custo da família ausente). Isso deixa ' + a.costPending + ' pedidos com lucro pendente. Exemplos: ' + skus.slice(0, 8).join(', ') + '. Cadastre a família e o custo em Produtos para liberar o lucro estimado.' : 'Todos os SKUs vendidos no período têm custo cadastrado.'), cites: a.costPending + ' pedidos pendentes · ' + Object.keys(ev.noCost).length + ' SKUs' }; }
    if (/margem|lucro pouco|vendem muito/.test(ql)) { var map = {}; pedidosInPeriod().forEach(function (o) { var f = orderFinance(o); o.items.forEach(function (it, i) { if (!it.sku) return; var m = map[it.sku] = map[it.sku] || { sku: it.sku, rev: 0, res: 0, hasCost: true }; m.rev += it.subtotal; var r = f._items[i]; if (r.costUnknown) m.hasCost = false; else m.res += (r.subtotal - r.allocatedFees - (r.costTotal || 0)); }); }); var arr = Object.values(map).filter(function (m) { return m.hasCost && m.rev > 0; }).map(function (m) { m.margin = (m.res / m.rev) * 100; return m; }).sort(function (x, y) { return x.margin - y.margin; }); var low = arr.slice(0, 6); return { text: low.length ? 'SKUs que vendem mas têm margem baixa (com custo cadastrado):\n' + low.map(function (m) { return '• ' + m.sku + ' — venda ' + brl(m.rev) + ', margem ' + pct(m.margin); }).join('\n') : 'Ainda não há SKUs suficientes com custo cadastrado para avaliar margem. Cadastre custos em Produtos.', cites: arr.length + ' SKUs com custo avaliados' }; }
    if (/devolu|reembolso|pós-venda|pos-venda|perda|prejuíz|prejuiz/.test(ql)) { var skuMap = {}; ev.o.forEach(function (o) { (o.items || []).forEach(function (i) { if (i.sku) skuMap[i.sku] = (skuMap[i.sku] || 0) + 1; }); }); var top = Object.entries(skuMap).sort(function (x, y) { return y[1] - x[1]; }).slice(0, 6); return { text: 'No período há ' + ev.o.length + ' ocorrências de pós-venda. Prejuízo confirmado ' + brl(ev.e.confirmedLoss) + ', em risco ' + brl(ev.e.atRisk) + '. SKUs com mais ocorrências: ' + (top.map(function (t) { return t[0] + ' (' + t[1] + ')'; }).join(', ') || '—') + '.', cites: ev.o.length + ' ocorrências · confirmado ' + brl(ev.e.confirmedLoss) }; }
    if (/resultado|lucro|ganhei|faturamento|venda|receita/.test(ql)) { return { text: 'No período: venda real ' + brl(a.revenue) + ' em ' + a.orders + ' pedidos, taxas ' + brl(a.fees) + ', custo ' + brl(a.cost) + '. Resultado estimado ' + brl(a.result) + ' (margem ' + (a.revenue ? pct((a.result / a.revenue) * 100) : '—') + ').' + (a.costPending ? ' Atenção: ' + a.costPending + ' pedidos ainda têm custo pendente.' : ''), cites: 'venda ' + brl(a.revenue) + ' · resultado ' + brl(a.result) }; }
    return { text: 'Posso responder sobre venda, resultado/margem, SKUs sem custo e devoluções — sempre com base nos dados importados (veja o Preview).', cites: 'evidências no Preview' };
  }

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
  periodSel.onchange = function () { render(); };
  document.getElementById('btn-demo').onclick = function () { if (confirm('Limpar todos os dados importados deste navegador?')) clearAll().then(function () { orders = []; occ = []; batches = []; plans = []; Produtos.reset(); rebuildSkuCost(); render(); toast('Dados locais limpos', ''); }); };

  openDB().then(function () {
    Produtos = makeProdutos({ container: app, put: putMany, getAll: getAll, parse: S.produtos.parse, onChange: rebuildSkuCost });
    return Promise.all([getAll('orders'), getAll('occ'), getAll('batches'), Produtos.load(), getAll('plans')]);
  }).then(function (r) {
    orders = r[0]; occ = (r[1] || []).map(migrateOcc); batches = (r[2] || []).sort(function (a, b) { return b.createdAt.localeCompare(a.createdAt); }); plans = r[4] || []; if (occ.length) putMany('occ', occ);
    rebuildSkuCost();
    render();
  }).catch(function (e) { app.innerHTML = '<div class="form-err">Falha ao abrir banco local: ' + esc(e.message || e) + '</div>'; });
})();
