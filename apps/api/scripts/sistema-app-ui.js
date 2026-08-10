/*
 * Sistema Marketplace — Líder · aplicação única (protótipo navegável, 100% local).
 * Todos os módulos juntos: Produtos, Pedidos, Pós-venda e Inteligência.
 * Usa os MESMOS parsers/regras do backend (window.SISTEMA) e persiste em IndexedDB.
 * Integrações reais entre módulos: Produtos→(família/custo)→Pedidos (lucro) e
 * Pedidos↔Pós-venda pelo ID do pedido. Nenhum dado sai do navegador.
 */
(function () {
  var S = window.SISTEMA;
  var app = document.getElementById('app');
  var crumb = document.getElementById('crumb');
  var periodSel = document.getElementById('period');

  // ---------- estado ----------
  var route = 'dashboard';
  var DB = null;
  var catalog = {};   // sku(lower) -> {sku, productName, variationName, referenceSku, fullPrice, familyName}
  var families = {};  // name -> {name, cost}
  var orders = [];    // pedidos
  var occ = [];       // ocorrências pós-venda
  var batches = [];   // histórico de importações (todos os módulos)
  var sub = { produtos: 'lista', pedidos: 'pedidos', posvenda: 'visao' };
  var pedTab = 'ALL';
  var chat = [];

  // ---------- helpers ----------
  function esc(s) { return (s == null ? '' : String(s)).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function nn(n) { return (n || 0).toLocaleString('pt-BR'); }
  function brl(v) { return (v == null || isNaN(v)) ? 'R$ 0,00' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
  function pct(v) { return v == null ? '—' : (Math.round(v * 100) / 100).toLocaleString('pt-BR') + '%'; }
  function num(s) { return s == null || s === '' ? 0 : Number(s); }
  function dbr(d) { if (!d) return '—'; var x = new Date(d); return isNaN(x) ? '—' : x.toLocaleDateString('pt-BR'); }
  function toast(title, body, err) {
    var el = document.createElement('div'); el.className = 'toast' + (err ? ' err' : '');
    el.innerHTML = '<div class="tt">' + esc(title) + '</div><div>' + esc(body) + '</div>';
    document.body.appendChild(el); setTimeout(function () { el.remove(); }, 6000);
  }

  // ---------- IndexedDB ----------
  function openDB() {
    return new Promise(function (res, rej) {
      var r = indexedDB.open('sistema_marketplace', 1);
      r.onupgradeneeded = function () {
        ['catalog', 'families', 'orders', 'occ', 'batches'].forEach(function (s) {
          var kp = s === 'catalog' ? 'sku' : s === 'families' ? 'name' : 'id';
          if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s, { keyPath: kp });
        });
      };
      r.onsuccess = function () { DB = r.result; res(); };
      r.onerror = function () { rej(r.error); };
    });
  }
  function getAll(store) { return new Promise(function (res, rej) { var rq = DB.transaction(store).objectStore(store).getAll(); rq.onsuccess = function () { res(rq.result || []); }; rq.onerror = function () { rej(rq.error); }; }); }
  function putMany(store, items) {
    return new Promise(function (res, rej) {
      if (!items.length) return res();
      var tx = DB.transaction(store, 'readwrite'); var os = tx.objectStore(store);
      items.forEach(function (it) { os.put(it); });
      tx.oncomplete = function () { res(); }; tx.onerror = function () { rej(tx.error); };
    });
  }
  function clearAll() {
    return new Promise(function (res) {
      var tx = DB.transaction(['catalog', 'families', 'orders', 'occ', 'batches'], 'readwrite');
      ['catalog', 'families', 'orders', 'occ', 'batches'].forEach(function (s) { tx.objectStore(s).clear(); });
      tx.oncomplete = function () { res(); };
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
  function inPeriod(iso) {
    if (!iso) return true; var r = periodRange(); var d = new Date(iso);
    if (r.from && d < r.from) return false; if (r.to && d > r.to) return false; return true;
  }
  function pedidosInPeriod() { return orders.filter(function (o) { return inPeriod(o.createdAt); }); }
  function occInPeriod() { return occ.filter(function (o) { return inPeriod(o.occurredAt); }); }

  // ---------- financeiro do pedido (recalculado ao vivo com catálogo/custo atuais) ----------
  function orderFinance(o) {
    var items = o.items.map(function (it) {
      var cat = it.sku ? catalog[it.sku.toLowerCase()] : null;
      var fam = cat && cat.familyName ? families[cat.familyName] : null;
      var costUnit = fam && fam.cost != null && fam.cost !== '' ? Number(fam.cost) : null;
      var linked = !!cat;
      return { subtotal: it.subtotal, costTotal: costUnit != null ? costUnit * it.qty : null, costUnknown: !linked || costUnit == null, linked: linked, costUnit: costUnit };
    });
    var fin = S.pedidos.computeFinance({
      commissionNet: o.commissionNet, serviceFeeNet: o.serviceFeeNet, transactionFee: o.transactionFee, reverseShippingFee: o.reverseShippingFee, items: items,
    });
    fin._items = items;
    return fin;
  }

  // ============================================================ IMPORTS
  function importProdutos(file) {
    return file.arrayBuffer().then(function (ab) {
      var parsed = S.produtos.parse(ab, file.name);
      if (parsed.notRecognized) throw new Error('Planilha de produtos não reconhecida.');
      var novo = 0, upd = 0;
      (parsed.rows || []).forEach(function (r) {
        if (!r.sku) return;
        var k = r.sku.toLowerCase();
        var ex = catalog[k];
        var next = { sku: r.sku, productName: r.productName, variationName: r.variationName, referenceSku: r.referenceSku, fullPrice: r.shopeeFullPrice, familyName: ex ? ex.familyName : null };
        if (!ex) novo++; else upd++;
        catalog[k] = next;
      });
      var batch = { id: 'b' + Date.now() + Math.round(performance.now()), module: 'Produtos', filename: file.name, createdAt: new Date().toISOString(), seen: (parsed.rows || []).length, novo: novo, upd: upd };
      batches.unshift(batch);
      return Promise.all([putMany('catalog', Object.values(catalog)), putMany('batches', [batch])]).then(function () { return batch; });
    });
  }

  function importPedidos(file) {
    return file.arrayBuffer().then(function (ab) {
      var parsed = S.pedidos.parse(ab, file.name);
      if (parsed.notRecognized) throw new Error('Planilha de pedidos não reconhecida (esperado Order.all… da Shopee).');
      var groups = {};
      (parsed.rows || []).forEach(function (r) { if (!r.orderId) return; (groups[r.orderId] = groups[r.orderId] || []).push(r); });
      var byId = {}; orders.forEach(function (o) { byId[o.id] = o; });
      var novo = 0, upd = 0, unch = 0, itemsSeen = 0;
      var changed = [];
      Object.keys(groups).forEach(function (id) {
        var g = groups[id]; var rep = g.find(function (r) { return r.orderStatus; }) || g[0];
        itemsSeen += g.length;
        var items = g.map(function (r) {
          var qty = r.quantity || 1;
          var subtotal = r.productSubtotal != null ? num(r.productSubtotal) : num(r.agreedPrice) * qty;
          return { sku: r.sku, productName: r.productName, variationName: r.variationName, qty: qty, originalPrice: num(r.originalPrice), agreedPrice: num(r.agreedPrice), subtotal: subtotal };
        });
        var next = {
          id: id, orderStatus: rep.orderStatus, normalizedStatus: S.pedidos.normalizeStatus(rep.orderStatus),
          tracking: rep.trackingNumber, createdAt: rep.orderCreatedAt ? new Date(rep.orderCreatedAt).toISOString() : null,
          returnRefundStatus: rep.returnRefundStatus, cancelReason: rep.cancelReason,
          city: rep.city, uf: rep.uf, recipientName: rep.recipientName, buyerUsername: rep.buyerUsername,
          shippingOption: rep.shippingOption, shippingMethod: rep.shippingMethod,
          totalAmount: num(rep.totalAmount), grandTotal: num(rep.grandTotal),
          commissionNet: num(rep.commissionNet), serviceFeeNet: num(rep.serviceFeeNet), transactionFee: num(rep.transactionFee),
          reverseShippingFee: num(rep.reverseShippingFee), estimatedShipping: num(rep.estimatedShipping), buyerPaidShipping: num(rep.buyerPaidShipping),
          unitsTotal: rep.unitsTotal || items.reduce(function (s, i) { return s + i.qty; }, 0),
          items: items,
        };
        var ex = byId[id];
        if (!ex) { novo++; byId[id] = next; }
        else {
          var diff = ex.orderStatus !== next.orderStatus || ex.tracking !== next.tracking || ex.totalAmount !== next.totalAmount;
          if (diff) upd++; else unch++;
          byId[id] = next;
        }
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
      var novo = 0, upd = 0, unch = 0, itemsSeen = 0;
      var changed = [];
      Object.keys(groups).forEach(function (key) {
        var g = groups[key]; var rep = g.find(function (r) { return r.status; }) || g[0];
        itemsSeen += g.length;
        var uid = type + ':' + key;
        var requested = num(rep.requestedRefundAmount), compensation = num(rep.sellerCompensationAmount);
        var next = {
          id: uid, type: type, orderId: rep.orderId, returnId: rep.returnId, status: rep.status, reason: rep.reason, resolution: rep.resolution,
          occurredAt: rep.occurredAt ? new Date(rep.occurredAt).toISOString() : null,
          requested: requested, compensation: compensation, exposure: S.posVenda.classify(rep.status, requested, compensation),
          items: g.map(function (r) { return { sku: r.sku, productName: r.productName, qty: r.quantity }; }),
        };
        var ex = byId[uid];
        if (!ex) { novo++; } else if (ex.status !== next.status) { upd++; } else { unch++; }
        byId[uid] = next; changed.push(next);
      });
      occ = Object.values(byId);
      var label = { RETURN_REFUND: 'Devoluções', ORDER_CANCELLATION: 'Cancelamentos', FAILED_DELIVERY: 'Falhas de entrega' }[type];
      var batch = { id: 'b' + Date.now() + Math.round(performance.now()), module: 'Pós-venda · ' + label, filename: file.name, createdAt: new Date().toISOString(), seen: Object.keys(groups).length, itemsSeen: itemsSeen, novo: novo, upd: upd, unch: unch };
      batches.unshift(batch);
      return Promise.all([putMany('occ', changed), putMany('batches', [batch])]).then(function () { return batch; });
    });
  }

  function fileInput(cb) {
    var inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.xlsx,.xls,.csv';
    inp.onchange = function () { if (inp.files[0]) cb(inp.files[0]); };
    inp.click();
  }

  // ============================================================ RENDER
  function setActive() {
    document.querySelectorAll('#nav a').forEach(function (a) { a.classList.toggle('active', a.dataset.route === route); });
    crumb.textContent = { dashboard: 'Dashboard', produtos: 'Produtos', pedidos: 'Pedidos', posvenda: 'Pós-venda', ia: 'Inteligência' }[route];
  }
  function render() {
    setActive();
    if (route === 'dashboard') return renderDashboard();
    if (route === 'produtos') return renderProdutos();
    if (route === 'pedidos') return renderPedidos();
    if (route === 'posvenda') return renderPosVenda();
    if (route === 'ia') return renderIA();
  }

  // ---------- DASHBOARD global ----------
  function computeOrderAgg() {
    var list = pedidosInPeriod();
    var agg = { orders: list.length, units: 0, revenue: 0, fees: 0, cost: 0, result: 0, costPending: 0, unlinked: 0, byStatus: {} };
    list.forEach(function (o) {
      var f = orderFinance(o);
      agg.units += o.items.reduce(function (s, i) { return s + i.qty; }, 0);
      agg.revenue += f.revenue; agg.fees += f.marketplaceFeesTotal; agg.cost += f.productCostTotal;
      if (f.estimatedResult != null) agg.result += f.estimatedResult; else agg.costPending++;
      if (f._items.some(function (i) { return !i.linked; })) agg.unlinked++;
      agg.byStatus[o.normalizedStatus] = (agg.byStatus[o.normalizedStatus] || 0) + 1;
    });
    return agg;
  }
  function renderDashboard() {
    var a = computeOrderAgg();
    var o = occInPeriod();
    var exposure = sumExposure(o);
    var empty = orders.length === 0 && occ.length === 0;
    app.innerHTML =
      '<div class="page-head"><div><h2>Visão geral</h2><p>Panorama de vendas e pós-venda — determinístico e auditável.</p></div></div>' +
      (empty ? banner('Comece importando planilhas em <b>Produtos</b>, <b>Pedidos</b> e <b>Pós-venda</b>. Os módulos se conectam automaticamente (SKU→família→custo e pedido↔devolução).') : '') +
      '<div class="cards6">' +
      fcard('Venda real', brl(a.revenue), 'blue', nn(a.orders) + ' pedidos') +
      fcard('Unidades', nn(a.units), '') +
      fcard('Taxas marketplace', brl(a.fees), 'red') +
      fcard('Custo produtos', brl(a.cost), 'amber') +
      fcard('Resultado estimado', brl(a.result), 'green', a.costPending ? a.costPending + ' pedidos c/ custo pendente' : 'determinístico') +
      fcard('Margem estimada', a.revenue ? pct((a.result / a.revenue) * 100) : '—', '') +
      '</div>' +
      '<div class="cards6">' +
      fcard('A enviar', nn(a.byStatus.A_ENVIAR || 0), 'amber') +
      fcard('Enviados', nn(a.byStatus.ENVIADO || 0), 'blue') +
      fcard('Concluídos', nn(a.byStatus.CONCLUIDO || 0), 'green') +
      fcard('Cancelados', nn(a.byStatus.CANCELADO || 0), 'red') +
      fcard('Devoluções (pós-venda)', nn(o.length), '') +
      fcard('Prejuízo confirmado', brl(exposure.confirmedLoss), 'red') +
      '</div>' +
      '<div class="cards6">' +
      fcard('SKUs sem vínculo', nn(a.unlinked) + ' pedidos', 'amber') +
      fcard('Custo pendente', nn(a.costPending) + ' pedidos', 'amber') +
      fcard('Em risco (pós-venda)', brl(exposure.atRisk), 'amber') +
      '</div>' +
      panelImports();
    bindImportsTable();
  }

  // ---------- PRODUTOS ----------
  function renderProdutos() {
    var list = Object.values(catalog);
    var withFam = list.filter(function (v) { return v.familyName; }).length;
    var fams = Object.keys(families).length;
    app.innerHTML =
      '<div class="page-head"><div><h2>Produtos</h2><p>Catálogo, famílias e custo. O custo da família alimenta o lucro estimado dos Pedidos.</p></div>' +
      '<button class="btn-sm primary" id="imp-prod">Importar planilha de produtos</button></div>' +
      '<div class="subtabs">' + subtab('produtos', 'lista', 'Produtos (' + nn(list.length) + ')') + subtab('produtos', 'familias', 'Famílias (' + nn(fams) + ')') + subtab('produtos', 'import', 'Importações') + '</div>' +
      (sub.produtos === 'import' ? importsFor('Produtos') :
        sub.produtos === 'familias' ? familiasTable() : produtosTable(list, withFam));
    document.getElementById('imp-prod').onclick = function () { fileInput(function (f) { importProdutos(f).then(function (b) { render(); toast('Produtos importados', b.novo + ' novos · ' + b.upd + ' atualizados'); }).catch(function (e) { toast('Falha', e.message, true); }); }); };
    bindSubtabs('produtos');
    bindProdInline();
    bindImportsTable();
  }
  function produtosTable(list, withFam) {
    if (!list.length) return emptyBox('Nenhum produto. Importe a planilha de produtos da Shopee.');
    return '<div class="count-line"><b>' + nn(list.length) + '</b> SKUs · <b>' + nn(withFam) + '</b> com família</div>' +
      '<div class="panel"><div class="table-wrap"><table><thead><tr><th>SKU</th><th>Produto</th><th>Variação</th><th>Preço Shopee</th><th>Família</th><th>Custo família</th></tr></thead><tbody>' +
      list.slice(0, 400).map(function (v) {
        var fam = v.familyName ? families[v.familyName] : null;
        var cost = fam && fam.cost != null && fam.cost !== '' ? brl(fam.cost) : '<span class="tag warn">custo pendente</span>';
        return '<tr><td class="mono">' + esc(v.sku) + '</td><td>' + esc(v.productName || '—') + '</td><td>' + esc(v.variationName || '—') + '</td><td>' + brl(num(v.fullPrice)) + '</td>' +
          '<td class="cell-fam" data-sku="' + esc(v.sku) + '">' + (v.familyName ? esc(v.familyName) : '<span class="tag">definir</span>') + '</td>' +
          '<td class="cell-cost" data-sku="' + esc(v.sku) + '">' + cost + '</td></tr>';
      }).join('') + '</tbody></table></div>' + (list.length > 400 ? '<div class="footnote" style="padding:10px 14px">Mostrando 400 de ' + nn(list.length) + ' SKUs.</div>' : '') + '</div>';
  }
  function familiasTable() {
    var fams = Object.values(families);
    if (!fams.length) return emptyBox('Nenhuma família. Defina a família de um SKU na aba Produtos.');
    return '<div class="panel"><div class="table-wrap"><table><thead><tr><th>Família</th><th>SKUs</th><th>Custo</th></tr></thead><tbody>' +
      fams.map(function (f) {
        var count = Object.values(catalog).filter(function (v) { return v.familyName === f.name; }).length;
        return '<tr><td><b>' + esc(f.name) + '</b></td><td>' + nn(count) + '</td><td class="cell-famcost" data-fam="' + esc(f.name) + '">' + (f.cost != null && f.cost !== '' ? brl(f.cost) : '<span class="tag warn">custo pendente</span>') + '</td></tr>';
      }).join('') + '</tbody></table></div></div>';
  }
  function bindProdInline() {
    app.querySelectorAll('.cell-fam').forEach(function (c) {
      c.onclick = function () {
        var sku = c.dataset.sku; var cur = catalog[sku.toLowerCase()].familyName || '';
        var v = prompt('Família do SKU ' + sku + ':', cur); if (v == null) return;
        catalog[sku.toLowerCase()].familyName = v.trim() || null;
        if (v.trim() && !families[v.trim()]) families[v.trim()] = { name: v.trim(), cost: null };
        Promise.all([putMany('catalog', [catalog[sku.toLowerCase()]]), putMany('families', Object.values(families))]).then(render);
      };
    });
    app.querySelectorAll('.cell-cost').forEach(function (c) {
      c.onclick = function () {
        var sku = c.dataset.sku; var fam = catalog[sku.toLowerCase()].familyName;
        if (!fam) { toast('Defina a família primeiro', 'O custo pertence à família.', true); return; }
        var cur = families[fam].cost != null ? families[fam].cost : '';
        var v = prompt('Custo unitário da família "' + fam + '" (R$):', cur); if (v == null) return;
        families[fam].cost = v === '' ? null : Number(v.replace(',', '.'));
        putMany('families', [families[fam]]).then(render);
      };
    });
    app.querySelectorAll('.cell-famcost').forEach(function (c) {
      c.onclick = function () {
        var fam = c.dataset.fam; var cur = families[fam].cost != null ? families[fam].cost : '';
        var v = prompt('Custo unitário da família "' + fam + '" (R$):', cur); if (v == null) return;
        families[fam].cost = v === '' ? null : Number(v.replace(',', '.'));
        putMany('families', [families[fam]]).then(render);
      };
    });
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
    bindImportsTable();
  }
  function pedidosList() {
    var occByOrder = {}; occ.forEach(function (o) { if (o.orderId) occByOrder[o.orderId] = true; });
    var all = pedidosInPeriod();
    var counts = { ALL: all.length };
    ['NAO_PAGO', 'A_ENVIAR', 'ENVIADO', 'CONCLUIDO', 'CANCELADO'].forEach(function (k) { counts[k] = all.filter(function (o) { return o.normalizedStatus === k; }).length; });
    var tabs = S.pedidos.tabs.map(function (t) { return '<div class="tab ' + (pedTab === t.key ? 'active' : '') + '" data-ptab="' + t.key + '">' + t.label + ' <span class="tag">' + nn(counts[t.key] || 0) + '</span></div>'; }).join('');
    var list = pedTab === 'ALL' ? all : all.filter(function (o) { return o.normalizedStatus === pedTab; });
    var q = (document.getElementById('ped-q') || {}).value || '';
    if (q) { var ql = q.toLowerCase(); list = list.filter(function (o) { return (o.id || '').toLowerCase().indexOf(ql) >= 0 || (o.tracking || '').toLowerCase().indexOf(ql) >= 0 || o.items.some(function (i) { return (i.sku || '').toLowerCase().indexOf(ql) >= 0 || (i.productName || '').toLowerCase().indexOf(ql) >= 0; }); }); }
    if (!all.length) return emptyBox('Nenhum pedido. Importe a planilha "Order.all…" da Shopee.');
    var rows = list.slice(0, 300).map(function (o) {
      var f = orderFinance(o);
      var prod = o.items.length > 1 ? o.items.length + ' produtos' : (o.items[0] ? esc((o.items[0].productName || '').slice(0, 40)) : '—');
      return '<tr><td class="mono">' + esc(o.id) + '</td><td>' + dbr(o.createdAt) + '</td><td><span class="pill ' + o.normalizedStatus + '">' + esc(S.pedidos.labels[o.normalizedStatus] || o.normalizedStatus) + '</span></td>' +
        '<td>' + prod + (o.items.length > 1 ? ' <span class="tag">multi</span>' : '') + '</td><td>' + brl(f.revenue) + '</td><td class="neg" style="color:var(--err)">' + brl(f.marketplaceFeesTotal) + '</td>' +
        '<td>' + (f.estimatedResult == null ? '<span class="tag warn">pendente</span>' : '<b style="color:var(--ok)">' + brl(f.estimatedResult) + '</b>') + '</td>' +
        '<td>' + (f.estimatedMarginPct == null ? '—' : pct(f.estimatedMarginPct)) + '</td>' +
        '<td>' + (occByOrder[o.id] ? '<span class="tag warn">devolução</span>' : '') + '</td>' +
        '<td><button class="btn-sm" data-open="' + esc(o.id) + '">Abrir</button></td></tr>';
    }).join('');
    return '<div class="tabs">' + tabs + '</div>' +
      '<div class="toolbar2"><input class="input sm" id="ped-q" style="width:280px" placeholder="Buscar ID, SKU, produto, rastreamento…" value="' + esc(q) + '"></div>' +
      '<div class="count-line"><b>' + nn(list.length) + '</b> pedidos' + (list.length > 300 ? ' (mostrando 300)' : '') + '</div>' +
      '<div class="panel"><div class="table-wrap"><table><thead><tr><th>Pedido</th><th>Data</th><th>Status</th><th>Produto</th><th>Venda</th><th>Taxas</th><th>Lucro est.</th><th>Margem</th><th>Pós-venda</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div></div>';
  }
  function bindPedidosList() {
    app.querySelectorAll('[data-ptab]').forEach(function (t) { t.onclick = function () { pedTab = t.dataset.ptab; render(); }; });
    var q = document.getElementById('ped-q'); if (q) { q.oninput = function () { var v = q.value; renderPedidosListOnly(); var el = document.getElementById('ped-q'); if (el) { el.focus(); el.value = v; el.setSelectionRange(v.length, v.length); } }; }
    app.querySelectorAll('[data-open]').forEach(function (b) { b.onclick = function () { openOrder(b.dataset.open); }; });
  }
  function renderPedidosListOnly() {
    // re-render só a lista para manter foco na busca
    var container = app;
    var html = pedidosList();
    // substitui tudo abaixo dos subtabs — simplificação: re-render completo
    renderPedidos();
  }
  function pedidosDashboard() {
    var a = computeOrderAgg();
    var ticket = a.orders ? a.revenue / a.orders : 0;
    return '<div class="cards6">' +
      fcard('Venda real', brl(a.revenue), 'blue', nn(a.orders) + ' pedidos') +
      fcard('Ticket médio', brl(ticket), '') +
      fcard('Unidades vendidas', nn(a.units), '') +
      fcard('Taxas marketplace', brl(a.fees), 'red') +
      fcard('Custo produtos', brl(a.cost), 'amber') +
      fcard('Resultado estimado', brl(a.result), 'green') +
      fcard('Margem estimada', a.revenue ? pct((a.result / a.revenue) * 100) : '—', '') +
      fcard('A enviar', nn(a.byStatus.A_ENVIAR || 0), 'amber') +
      fcard('Enviados', nn(a.byStatus.ENVIADO || 0), 'blue') +
      fcard('Concluídos', nn(a.byStatus.CONCLUIDO || 0), 'green') +
      fcard('Cancelados', nn(a.byStatus.CANCELADO || 0), 'red') +
      fcard('SKUs sem custo', nn(a.costPending) + ' pedidos', 'amber') +
      '</div>' + topSkusPanel();
  }
  function topSkusPanel() {
    var map = {};
    pedidosInPeriod().forEach(function (o) {
      var f = orderFinance(o);
      o.items.forEach(function (it, i) {
        if (!it.sku) return; var m = map[it.sku] = map[it.sku] || { sku: it.sku, product: it.productName, units: 0, revenue: 0, result: 0 };
        m.units += it.qty; m.revenue += it.subtotal; var r = f._items[i]; if (r && f.estimatedResult != null) m.result += (r.subtotal - r.allocatedFees - (r.costTotal || 0));
      });
    });
    var top = Object.values(map).sort(function (a, b) { return b.revenue - a.revenue; }).slice(0, 15);
    if (!top.length) return '';
    return '<div class="panel"><div class="ph"><h3>Top SKUs por venda</h3></div><div class="table-wrap"><table><thead><tr><th>SKU</th><th>Produto</th><th>Unid.</th><th>Venda</th><th>Lucro est.</th></tr></thead><tbody>' +
      top.map(function (m) { return '<tr><td class="mono">' + esc(m.sku) + '</td><td>' + esc((m.product || '').slice(0, 46)) + '</td><td>' + nn(m.units) + '</td><td>' + brl(m.revenue) + '</td><td>' + brl(m.result) + '</td></tr>'; }).join('') + '</tbody></table></div></div>';
  }
  function openOrder(id) {
    var o = orders.find(function (x) { return x.id === id; }); if (!o) return;
    var f = orderFinance(o);
    var occs = occ.filter(function (x) { return x.orderId === id; });
    var itemsHtml = o.items.map(function (it, i) {
      var r = f._items[i];
      var lucro = (f.estimatedResult == null || r.costTotal == null) ? '<span class="tag warn">lucro estimado pendente</span>' : '<b style="color:var(--ok)">' + brl(r.subtotal - r.allocatedFees - r.costTotal) + '</b>';
      var custo = r.costUnit == null ? (r.linked ? '<span class="tag warn">custo não cadastrado</span>' : '<span class="tag warn">SKU não vinculado</span>') : brl(r.costUnit) + ' × ' + it.qty + ' = ' + brl(r.costTotal);
      return '<div class="ro" style="margin-bottom:8px"><b>' + esc((it.productName || '—')) + '</b>' + (it.variationName ? ' · ' + esc(it.variationName) : '') +
        '<div class="footnote" style="margin-top:4px">SKU <span class="mono">' + esc(it.sku || '—') + '</span> · qtd ' + it.qty + '</div>' +
        '<div class="fin-line"><span>Preço acordado (venda real)</span><span>' + brl(it.agreedPrice) + '</span></div>' +
        '<div class="fin-line"><span>Subtotal</span><span>' + brl(it.subtotal) + '</span></div>' +
        '<div class="fin-line"><span>Taxas rateadas <span class="tag">rateada</span></span><span class="neg">-' + brl(r.allocatedFees) + '</span></div>' +
        '<div class="fin-line"><span>Custo</span><span>' + custo + '</span></div>' +
        '<div class="fin-line total"><span>Lucro estimado</span><span>' + lucro + '</span></div></div>';
    }).join('');
    var d = document.createElement('div'); d.className = 'drawer drawer-wide';
    d.innerHTML = '<div class="drawer-panel"><div class="dh"><div><b>Pedido ' + esc(o.id) + '</b><div class="footnote" style="margin-top:2px">Shopee · lidermolduras · ' + dbr(o.createdAt) + '</div></div><button class="x">&times;</button></div>' +
      '<div class="dbd">' +
      '<div class="cards6">' + fcard('Venda real', brl(f.revenue), 'blue') + fcard('Valor Total', brl(o.totalAmount), '') + fcard('Taxas marketplace', brl(f.marketplaceFeesTotal), 'red') + fcard('Custo produtos', f.costPending ? '—' : brl(f.productCostTotal), 'amber') + fcard('Lucro estimado', f.estimatedResult == null ? 'pendente' : brl(f.estimatedResult), 'green') + fcard('Margem', f.estimatedMarginPct == null ? '—' : pct(f.estimatedMarginPct), '') + '</div>' +
      '<div class="split"><div>' +
      '<div class="panel"><div class="ph"><h3>Itens do pedido</h3><span class="footnote" style="margin:0">' + o.items.length + '</span></div><div class="pb">' + itemsHtml + '</div></div></div>' +
      '<div><div class="panel"><div class="ph"><h3>Composição financeira</h3></div><div class="pb">' +
      finLine('Venda real (Σ preço acordado)', f.revenue) + finLine('Valor Total (Shopee)', o.totalAmount) + finLine('Comissão líquida', -o.commissionNet, true) + finLine('Taxa de serviço líquida', -o.serviceFeeNet, true) + finLine('Taxa de transação', -o.transactionFee, true) + finLine('Frete reverso', -o.reverseShippingFee, true) + finLine('Custo produtos', f.costPending ? null : -f.productCostTotal, true) +
      '<div class="fin-line total"><span>Resultado estimado</span><span class="' + (f.estimatedResult >= 0 ? 'pos' : 'neg') + '">' + (f.estimatedResult == null ? 'pendente (custo)' : brl(f.estimatedResult)) + '</span></div>' +
      '</div></div>' +
      '<div class="panel"><div class="ph"><h3>Logística & cliente</h3></div><div class="pb">' +
      kv('Status Shopee', o.orderStatus) + kv('Rastreamento', o.tracking) + kv('Envio', (o.shippingOption || '') + ' ' + (o.shippingMethod || '')) + kv('Cidade/UF', (o.city || '—') + '/' + (o.uf || '—')) + kv('Devolução', o.returnRefundStatus || '—') +
      '</div></div>' +
      (occs.length ? '<div class="panel"><div class="ph"><h3>Pós-venda vinculada</h3></div><div class="pb">' + occs.map(function (x) { return '<div class="ro" style="margin-bottom:6px">' + esc(x.type) + ' · ' + esc(x.status || '—') + ' · ' + brl(x.requested) + ' <span class="tag">' + x.exposure.bucket + '</span></div>'; }).join('') + '</div></div>' : '') +
      '</div></div>' +
      '</div></div>';
    d.onclick = function (e) { if (e.target === d) d.remove(); };
    d.querySelector('.x').onclick = function () { d.remove(); };
    document.body.appendChild(d);
  }

  // ---------- PÓS-VENDA ----------
  function sumExposure(list) {
    var a = { requested: 0, confirmedLoss: 0, atRisk: 0, recovered: 0, cancelled: 0 };
    list.forEach(function (o) { var e = o.exposure; a.requested += e.requested; a.confirmedLoss += e.confirmedLoss; a.atRisk += e.atRisk; if (e.bucket === 'RECOVERED') a.recovered += e.compensation; if (e.bucket === 'CANCELLED') a.cancelled += e.requested; });
    Object.keys(a).forEach(function (k) { a[k] = Math.round(a[k] * 100) / 100; });
    return a;
  }
  function renderPosVenda() {
    var TYPES = [['RETURN_REFUND', 'Devoluções / Reembolsos'], ['ORDER_CANCELLATION', 'Cancelamentos'], ['FAILED_DELIVERY', 'Falhas de Entrega']];
    app.innerHTML =
      '<div class="page-head"><div><h2>Pós-venda &amp; Perdas</h2><p>Devoluções, cancelamentos e falhas — exposição financeira (solicitado ≠ prejuízo).</p></div></div>' +
      '<div class="subtabs">' + subtab('posvenda', 'visao', 'Visão geral') + subtab('posvenda', 'ocorrencias', 'Ocorrências') + subtab('posvenda', 'import', 'Importações') + '</div>' +
      (sub.posvenda === 'import' ?
        '<div class="cards6">' + TYPES.map(function (t) { return '<div class="fcard"><div class="lbl">' + t[1] + '</div><button class="btn-sm primary" style="margin-top:10px" data-pv="' + t[0] + '">Importar</button></div>'; }).join('') + '</div>' + importsFor('Pós-venda')
        : sub.posvenda === 'ocorrencias' ? pvOccList() : pvVisao());
    app.querySelectorAll('[data-pv]').forEach(function (b) { b.onclick = function () { fileInput(function (f) { importPosVenda(b.dataset.pv, f).then(function (batch) { render(); toast('Importado', batch.seen + ' ocorrências · ' + batch.novo + ' novas · ' + batch.upd + ' atualizadas · ' + batch.unch + ' sem alteração'); }).catch(function (e) { toast('Falha', e.message, true); }); }); }; });
    bindSubtabs('posvenda');
    app.querySelectorAll('[data-oc]').forEach(function (b) { b.onclick = function () { openOcc(b.dataset.oc); }; });
    bindImportsTable();
  }
  function pvVisao() {
    var list = occInPeriod();
    if (!list.length) return emptyBox('Nenhuma ocorrência. Importe os 3 relatórios de pós-venda.');
    var e = sumExposure(list);
    var byType = {}; list.forEach(function (o) { byType[o.type] = (byType[o.type] || 0) + 1; });
    var skuMap = {}; list.forEach(function (o) { (o.items || []).forEach(function (i) { if (i.sku) { var m = skuMap[i.sku] = skuMap[i.sku] || { sku: i.sku, product: i.productName, occ: 0 }; m.occ++; } }); });
    var top = Object.values(skuMap).sort(function (a, b) { return b.occ - a.occ; }).slice(0, 12);
    return '<div class="cards6">' +
      fcard('Ocorrências', nn(list.length), 'blue') +
      fcard('Devoluções', nn(byType.RETURN_REFUND || 0), '') +
      fcard('Cancelamentos', nn(byType.ORDER_CANCELLATION || 0), '') +
      fcard('Falhas de entrega', nn(byType.FAILED_DELIVERY || 0), '') +
      fcard('Prejuízo confirmado', brl(e.confirmedLoss), 'red') +
      fcard('Em risco', brl(e.atRisk), 'amber') +
      fcard('Recuperado', brl(e.recovered), 'green') +
      fcard('Solicitação cancelada', brl(e.cancelled), '') +
      '</div>' +
      '<div class="panel"><div class="ph"><h3>Top SKUs por ocorrência</h3></div><div class="table-wrap"><table><thead><tr><th>SKU</th><th>Produto</th><th>Ocorrências</th></tr></thead><tbody>' +
      top.map(function (m) { return '<tr><td class="mono">' + esc(m.sku) + '</td><td>' + esc((m.product || '').slice(0, 50)) + '</td><td>' + nn(m.occ) + '</td></tr>'; }).join('') + '</tbody></table></div></div>' +
      '<div class="footnote">' + esc(S.posVenda.methodology) + '</div>';
  }
  function pvOccList() {
    var list = occInPeriod();
    if (!list.length) return emptyBox('Nenhuma ocorrência importada.');
    var ordSet = {}; orders.forEach(function (o) { ordSet[o.id] = true; });
    return '<div class="count-line"><b>' + nn(list.length) + '</b> ocorrências</div><div class="panel"><div class="table-wrap"><table><thead><tr><th>Tipo</th><th>Pedido</th><th>Status</th><th>Itens</th><th>Solicitado</th><th>Exposição</th><th>Pedido?</th><th></th></tr></thead><tbody>' +
      list.slice(0, 300).map(function (o) {
        return '<tr><td><span class="tag info">' + esc(o.type.split('_')[0]) + '</span></td><td class="mono">' + esc(o.orderId || '—') + '</td><td>' + esc((o.status || '—')) + '</td><td>' + (o.items || []).length + '</td><td>' + brl(o.requested) + '</td><td><span class="tag ' + (o.exposure.bucket === 'CONFIRMED' ? 'warn' : o.exposure.bucket === 'AT_RISK' ? 'info' : 'ok') + '">' + o.exposure.bucket + '</span></td>' +
          '<td>' + (ordSet[o.orderId] ? '<span class="tag ok">vinculado</span>' : '—') + '</td><td><button class="btn-sm" data-oc="' + esc(o.id) + '">Abrir</button></td></tr>';
      }).join('') + '</tbody></table></div></div>';
  }
  function openOcc(id) {
    var o = occ.find(function (x) { return x.id === id; }); if (!o) return;
    var ord = orders.find(function (x) { return x.id === o.orderId; });
    var d = document.createElement('div'); d.className = 'drawer';
    d.innerHTML = '<div class="drawer-panel"><div class="dh"><b>Ficha da ocorrência</b><button class="x">&times;</button></div><div class="dbd">' +
      kv('Tipo', o.type) + kv('Pedido', o.orderId) + kv('Status', o.status) + kv('Reembolso solicitado', brl(o.requested)) + kv('Exposição', o.exposure.bucket) + kv('Motivo', o.reason) +
      (ord ? '<div class="panel" style="margin-top:12px"><div class="ph"><h3>Pedido vinculado</h3></div><div class="pb"><div class="ro">' + esc(ord.id) + ' · ' + esc(S.pedidos.labels[ord.normalizedStatus]) + ' · ' + brl(ord.totalAmount) + '</div></div></div>' : '<div class="footnote">Pedido não encontrado no módulo Pedidos (importe a planilha de pedidos para vincular).</div>') +
      '<div class="panel" style="margin-top:12px"><div class="ph"><h3>Itens (valor contado uma vez)</h3></div><div class="pb">' + (o.items || []).map(function (i) { return '<div class="ro" style="margin-bottom:6px"><span class="mono">' + esc(i.sku || '—') + '</span> · ' + esc((i.productName || '—')) + '</div>'; }).join('') + '</div></div>' +
      '</div></div>';
    d.onclick = function (e) { if (e.target === d) d.remove(); }; d.querySelector('.x').onclick = function () { d.remove(); };
    document.body.appendChild(d);
  }

  // ---------- INTELIGÊNCIA ----------
  function renderIA() {
    app.innerHTML =
      '<div class="page-head"><div><h2>Inteligência</h2><p>Chat sobre os dados com <b>Preview</b> ao lado. Respostas determinísticas e auditáveis — a IA nunca inventa números nem calcula dinheiro.</p></div></div>' +
      '<div class="aicfg"><b>Como funciona:</b> as respostas abaixo são calculadas localmente a partir dos dados importados (evidências no Preview). No sistema completo (backend), a mesma camada aciona um provedor de LLM real — com credencial cifrada no servidor, <b>nunca no navegador</b> (§46) — para gerar a narrativa; os números permanecem sempre determinísticos.</div>' +
      '<div class="split"><div class="chatbox"><div class="chatlog" id="clog"></div>' +
      '<div class="chips">' + ['Qual meu resultado estimado?', 'Quais SKUs estão sem custo?', 'Quais produtos vendem muito e lucram pouco?', 'Quais SKUs têm mais devoluções?', 'Qual a exposição financeira?'].map(function (c) { return '<span class="chip" data-q="' + esc(c) + '">' + esc(c) + '</span>'; }).join('') + '</div>' +
      '<div class="chatin"><input class="input" id="cin" placeholder="Pergunte sobre vendas, lucro, custos, devoluções…"><button class="btn-sm primary" id="csend">Enviar</button></div></div>' +
      '<div class="prev" id="prev"></div></div>';
    renderChat(); renderPreview();
    document.getElementById('csend').onclick = sendChat;
    document.getElementById('cin').onkeydown = function (e) { if (e.key === 'Enter') sendChat(); };
    app.querySelectorAll('.chip').forEach(function (c) { c.onclick = function () { document.getElementById('cin').value = c.dataset.q; sendChat(); }; });
  }
  function renderChat() {
    var log = document.getElementById('clog'); if (!log) return;
    if (!chat.length) { log.innerHTML = '<div class="msg a">Olá! Pergunte sobre seus dados. Ex.: <i>"quais SKUs estão sem custo?"</i>. Vou responder com base nas evidências do Preview ao lado.</div>'; return; }
    log.innerHTML = chat.map(function (m) { return '<div class="msg ' + m.role + '">' + esc(m.text).replace(/\n/g, '<br>') + (m.cites ? '<div class="cites">Evidências: ' + esc(m.cites) + '</div>' : '') + '</div>'; }).join('');
    log.scrollTop = log.scrollHeight;
  }
  function sendChat() {
    var inp = document.getElementById('cin'); var q = inp.value.trim(); if (!q) return;
    chat.push({ role: 'u', text: q }); inp.value = '';
    var ans = answer(q); chat.push({ role: 'a', text: ans.text, cites: ans.cites });
    renderChat(); renderPreview();
  }
  function evidence() {
    var a = computeOrderAgg(); var o = occInPeriod(); var e = sumExposure(o);
    var noCost = {}; pedidosInPeriod().forEach(function (ord) { orderFinance(ord)._items.forEach(function (r, i) { var it = ord.items[i]; if (it.sku && r.costUnknown) noCost[it.sku] = (noCost[it.sku] || 0) + 1; }); });
    return { a: a, o: o, e: e, noCost: noCost };
  }
  function renderPreview() {
    var el = document.getElementById('prev'); if (!el) return; var ev = evidence(); var a = ev.a;
    el.innerHTML = '<h4>Preview · evidências determinísticas</h4>' +
      row('Pedidos (período)', nn(a.orders)) + row('Venda real', brl(a.revenue)) + row('Taxas marketplace', brl(a.fees)) + row('Custo produtos', brl(a.cost)) +
      row('Resultado estimado', brl(a.result)) + row('Margem estimada', a.revenue ? pct((a.result / a.revenue) * 100) : '—') +
      row('Pedidos c/ custo pendente', nn(a.costPending)) + row('SKUs distintos sem custo', nn(Object.keys(ev.noCost).length)) +
      row('Ocorrências pós-venda', nn(ev.o.length)) + row('Prejuízo confirmado', brl(ev.e.confirmedLoss)) + row('Em risco', brl(ev.e.atRisk)) +
      '<div class="footnote" style="margin-top:10px">Estes números são a base factual das respostas do chat.</div>';
  }
  function answer(q) {
    var ql = q.toLowerCase(); var ev = evidence(); var a = ev.a;
    if (/sem custo|nao vinculad|não vinculad|pendente/.test(ql)) {
      var skus = Object.keys(ev.noCost).slice(0, 15);
      return { text: (skus.length ? 'Há ' + Object.keys(ev.noCost).length + ' SKUs distintos sem custo cadastrado (vínculo ou custo da família ausente). Isso deixa ' + a.costPending + ' pedidos com lucro pendente. Exemplos: ' + skus.slice(0, 8).join(', ') + '. Cadastre a família e o custo em Produtos para liberar o lucro estimado.' : 'Todos os SKUs vendidos no período têm custo cadastrado.'), cites: a.costPending + ' pedidos pendentes · ' + Object.keys(ev.noCost).length + ' SKUs' };
    }
    if (/margem|lucro pouco|vendem muito/.test(ql)) {
      var map = {}; pedidosInPeriod().forEach(function (o) { var f = orderFinance(o); o.items.forEach(function (it, i) { if (!it.sku) return; var m = map[it.sku] = map[it.sku] || { sku: it.sku, rev: 0, res: 0, hasCost: true }; m.rev += it.subtotal; var r = f._items[i]; if (r.costUnknown) m.hasCost = false; else m.res += (r.subtotal - r.allocatedFees - (r.costTotal || 0)); }); });
      var arr = Object.values(map).filter(function (m) { return m.hasCost && m.rev > 0; }).map(function (m) { m.margin = (m.res / m.rev) * 100; return m; }).sort(function (x, y) { return x.margin - y.margin; });
      var low = arr.filter(function (m) { return m.rev > 0; }).slice(0, 6);
      return { text: low.length ? 'SKUs que vendem mas têm margem baixa (com custo cadastrado):\n' + low.map(function (m) { return '• ' + m.sku + ' — venda ' + brl(m.rev) + ', margem ' + pct(m.margin); }).join('\n') : 'Ainda não há SKUs suficientes com custo cadastrado para avaliar margem. Cadastre custos em Produtos.', cites: arr.length + ' SKUs com custo avaliados' };
    }
    if (/devolu|reembolso|pós-venda|pos-venda|perda|prejuíz|prejuiz/.test(ql)) {
      var skuMap = {}; ev.o.forEach(function (o) { (o.items || []).forEach(function (i) { if (i.sku) skuMap[i.sku] = (skuMap[i.sku] || 0) + 1; }); });
      var top = Object.entries(skuMap).sort(function (x, y) { return y[1] - x[1]; }).slice(0, 6);
      return { text: 'No período há ' + ev.o.length + ' ocorrências de pós-venda. Prejuízo confirmado ' + brl(ev.e.confirmedLoss) + ', em risco ' + brl(ev.e.atRisk) + '. SKUs com mais ocorrências: ' + (top.map(function (t) { return t[0] + ' (' + t[1] + ')'; }).join(', ') || '—') + '.', cites: ev.o.length + ' ocorrências · confirmado ' + brl(ev.e.confirmedLoss) };
    }
    if (/resultado|lucro|ganhei|faturamento|venda|receita/.test(ql)) {
      return { text: 'No período: venda real ' + brl(a.revenue) + ' em ' + a.orders + ' pedidos, taxas ' + brl(a.fees) + ', custo ' + brl(a.cost) + '. Resultado estimado ' + brl(a.result) + ' (margem ' + (a.revenue ? pct((a.result / a.revenue) * 100) : '—') + ').' + (a.costPending ? ' Atenção: ' + a.costPending + ' pedidos ainda têm custo pendente, então o resultado real tende a ser maior quando os custos forem cadastrados.' : ''), cites: 'venda ' + brl(a.revenue) + ' · resultado ' + brl(a.result) };
    }
    return { text: 'Posso responder sobre venda, resultado/margem, SKUs sem custo e devoluções — sempre com base nos dados importados (veja o Preview). Reformule a pergunta ou use um dos atalhos.', cites: 'evidências no Preview' };
  }

  // ---------- componentes ----------
  function fcard(lbl, val, cls, sub) { return '<div class="fcard ' + (cls || '') + '"><div class="lbl">' + esc(lbl) + '</div><div class="val">' + val + '</div>' + (sub ? '<div class="footnote" style="margin-top:4px">' + esc(sub) + '</div>' : '') + '</div>'; }
  function finLine(lbl, val, neg) { if (val == null) return '<div class="fin-line"><span>' + esc(lbl) + '</span><span class="tag warn">pendente</span></div>'; return '<div class="fin-line"><span>' + esc(lbl) + '</span><span class="' + (neg ? 'neg' : '') + '">' + (neg && val !== 0 ? '' : '') + brl(val) + '</span></div>'; }
  function kv(k, v) { return '<label class="fld">' + esc(k) + '</label><div class="ro">' + esc(v || '—') + '</div>'; }
  function row(k, v) { return '<div class="row"><span>' + esc(k) + '</span><b>' + v + '</b></div>'; }
  function banner(html) { return '<div class="info-banner">' + html + '</div>'; }
  function emptyBox(t) { return '<div class="panel"><div class="empty"><div class="ico">📄</div><div style="margin-top:8px">' + esc(t) + '</div></div></div>'; }
  function subtab(mod, key, label) { return '<div class="subtab ' + (sub[mod] === key ? 'active' : '') + '" data-sub="' + mod + ':' + key + '">' + esc(label) + '</div>'; }
  function bindSubtabs(mod) { app.querySelectorAll('[data-sub^="' + mod + ':"]').forEach(function (t) { t.onclick = function () { var p = t.dataset.sub.split(':'); sub[p[0]] = p[1]; render(); }; }); }
  function panelImports() {
    return '<div class="panel"><div class="ph"><h3>Importações recentes</h3><span class="footnote" style="margin:0">' + batches.length + '</span></div><div class="table-wrap"><table id="imp-tbl"><thead><tr><th>Módulo</th><th>Arquivo</th><th>Registros</th><th>Novos</th><th>Atualizados</th><th>Sem alteração</th><th>Data</th></tr></thead><tbody>' +
      (batches.length ? batches.slice(0, 20).map(impRow).join('') : '<tr><td colspan="7" class="empty">Nenhuma importação ainda.</td></tr>') + '</tbody></table></div></div>';
  }
  function importsFor(mod) {
    var list = batches.filter(function (b) { return b.module.indexOf(mod) === 0; });
    return '<div class="panel"><div class="ph"><h3>Histórico de importações — ' + esc(mod) + '</h3></div><div class="table-wrap"><table><thead><tr><th>Arquivo</th><th>Registros</th><th>Novos</th><th>Atualizados</th><th>Sem alteração</th><th>Período</th><th>Data</th></tr></thead><tbody>' +
      (list.length ? list.map(function (b) { return '<tr><td>' + esc(b.filename) + '</td><td>' + nn(b.seen) + (b.itemsSeen ? ' <span class="footnote">(' + nn(b.itemsSeen) + ' itens)</span>' : '') + '</td><td>' + nn(b.novo) + '</td><td>' + nn(b.upd) + '</td><td>' + nn(b.unch || 0) + '</td><td class="footnote">' + (b.periodStart ? dbr(b.periodStart) + '–' + dbr(b.periodEnd) : '—') + '</td><td class="footnote">' + new Date(b.createdAt).toLocaleString('pt-BR') + '</td></tr>'; }).join('') : '<tr><td colspan="7" class="empty">Nenhuma importação neste módulo.</td></tr>') + '</tbody></table></div></div>';
  }
  function impRow(b) { return '<tr><td>' + esc(b.module) + '</td><td>' + esc(b.filename) + '</td><td>' + nn(b.seen) + '</td><td>' + nn(b.novo) + '</td><td>' + nn(b.upd) + '</td><td>' + nn(b.unch || 0) + '</td><td class="footnote">' + new Date(b.createdAt).toLocaleString('pt-BR') + '</td></tr>'; }
  function bindImportsTable() {}

  // ---------- boot ----------
  document.querySelectorAll('#nav a').forEach(function (a) { a.onclick = function () { route = a.dataset.route; render(); }; });
  periodSel.onchange = function () { render(); };
  document.getElementById('btn-demo').onclick = function () { if (confirm('Limpar todos os dados importados deste navegador?')) clearAll().then(function () { catalog = {}; families = {}; orders = []; occ = []; batches = []; render(); toast('Dados locais limpos', ''); }); };

  openDB().then(function () {
    return Promise.all([getAll('catalog'), getAll('families'), getAll('orders'), getAll('occ'), getAll('batches')]);
  }).then(function (r) {
    r[0].forEach(function (v) { catalog[v.sku.toLowerCase()] = v; });
    r[1].forEach(function (f) { families[f.name] = f; });
    orders = r[2]; occ = r[3];
    batches = r[4].sort(function (a, b) { return b.createdAt.localeCompare(a.createdAt); });
    render();
  }).catch(function (e) { app.innerHTML = '<div class="form-err">Falha ao abrir banco local: ' + esc(e.message || e) + '</div>'; });
})();
