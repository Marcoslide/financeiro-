/* Módulo Pós-venda — protótipo autônomo (offline). Importa os 3 relatórios reais
 * com o MESMO parser do sistema (window.PosVenda), materializa Pedido/Ocorrência/
 * Item (multi-SKU: valor uma vez), classifica exposição e persiste em IndexedDB. */
(function () {
  'use strict';
  var PV = window.PosVenda;
  var app = document.getElementById('app');
  var DB = null;
  var TYPES = { RETURN_REFUND: 'Devoluções / Reembolsos', ORDER_CANCELLATION: 'Cancelamentos', FAILED_DELIVERY: 'Falhas de Entrega' };

  function openDB() { return new Promise(function (res, rej) { var r = indexedDB.open('pos_venda', 1); r.onupgradeneeded = function () { ['occ', 'batches'].forEach(function (s) { if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s, { keyPath: 'id' }); }); }; r.onsuccess = function () { DB = r.result; res(); }; r.onerror = function () { rej(r.error); }; }); }
  function getAll(s) { return new Promise(function (res) { var o = []; DB.transaction(s, 'readonly').objectStore(s).openCursor().onsuccess = function (e) { var c = e.target.result; if (c) { o.push(c.value); c.continue(); } else res(o); }; }); }
  function putMany(s, items) { return new Promise(function (res) { if (!items.length) return res(); var t = DB.transaction(s, 'readwrite').objectStore(s); items.forEach(function (i) { t.put(i); }); t.transaction.oncomplete = function () { res(); }; }); }

  var S = { tab: 'visao', occ: [], batches: [], preset: 'all', filters: { type: '', status: '', search: '' }, page: 1, detail: null };
  var brl = function (v) { return (v == null ? 0 : Number(v)).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); };
  var nn = function (n) { return Number(n || 0).toLocaleString('pt-BR'); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function toast(t, b, err) { var e = document.createElement('div'); e.className = 'toast' + (err ? ' err' : ''); e.innerHTML = '<div class="tt">' + esc(t) + '</div><div>' + esc(b) + '</div>'; document.body.appendChild(e); setTimeout(function () { e.remove(); }, 5000); }
  function q(s) { return app.querySelector(s) || document.querySelector(s); }

  // ---- materialização (multi-SKU: 1 ocorrência, N itens, valor uma vez) ----
  function importFile(type, file) {
    return file.arrayBuffer().then(function (ab) {
      var parsed = PV.parse(ab, file.name, type);
      if (parsed.notRecognized) throw new Error('Relatório não reconhecido para ' + TYPES[type]);
      var groups = {};
      parsed.rows.forEach(function (r) { if (!r.occurrenceKey || !r.orderId) return; (groups[r.occurrenceKey] = groups[r.occurrenceKey] || []).push(r); });
      var existing = {}; S.occ.forEach(function (o) { existing[o.id] = 1; });
      var changed = [], newOcc = 0, updated = 0, items = 0, orders = {};
      Object.keys(groups).forEach(function (key) {
        var g = groups[key], rep = g.find(function (r) { return r.status; }) || g[0];
        var id = type + '::' + key; orders[rep.orderId] = 1;
        var reqd = rep.requestedRefundAmount == null ? null : Number(rep.requestedRefundAmount);
        var comp = rep.sellerCompensationAmount == null ? null : Number(rep.sellerCompensationAmount);
        var ex = PV.classify(rep.status, reqd || 0, comp || 0);
        var occ = {
          id: id, type: type, orderId: rep.orderId, returnId: rep.returnId, key: key,
          status: rep.status, reason: rep.reason, resolution: rep.resolution,
          occurredAt: rep.occurredAt ? new Date(rep.occurredAt).toISOString() : null,
          requested: reqd, compensation: comp, exposure: ex,
          items: g.map(function (r) { return { sku: r.sku, productName: r.productName, variationName: r.variationName, quantity: r.quantity }; }),
        };
        items += occ.items.length;
        if (existing[id]) updated++; else newOcc++;
        changed.push(occ);
      });
      // aplica em memória
      var byId = {}; S.occ.forEach(function (o) { byId[o.id] = o; }); changed.forEach(function (o) { byId[o.id] = o; }); S.occ = Object.keys(byId).map(function (k) { return byId[k]; });
      var batch = { id: 't' + Date.now() + Math.random().toString(16).slice(2), type: type, filename: file.name, createdAt: new Date().toISOString(), occurrencesSeen: Object.keys(groups).length, itemsSeen: items, newOcc: newOcc, updatedOcc: updated, ordersTouched: Object.keys(orders).length, periodStart: parsed.periodStart ? new Date(parsed.periodStart).toISOString() : null, periodEnd: parsed.periodEnd ? new Date(parsed.periodEnd).toISOString() : null };
      S.batches.unshift(batch);
      return Promise.all([putMany('occ', changed), putMany('batches', [batch])]).then(function () { return batch; });
    });
  }

  function periodRange() {
    var now = new Date(), p = S.preset;
    if (p === 'all') return {};
    if (p === 'today') return { from: new Date(now.getFullYear(), now.getMonth(), now.getDate()) };
    if (p === '7d') return { from: new Date(now - 7 * 864e5) };
    if (p === '30d') return { from: new Date(now - 30 * 864e5) };
    if (p === 'month') return { from: new Date(now.getFullYear(), now.getMonth(), 1) };
    if (p === 'prevmonth') return { from: new Date(now.getFullYear(), now.getMonth() - 1, 1), to: new Date(now.getFullYear(), now.getMonth(), 1) };
    return {};
  }
  function inPeriod(o) { var r = periodRange(); if (!r.from && !r.to) return true; if (!o.occurredAt) return true; var d = new Date(o.occurredAt); if (r.from && d < r.from) return false; if (r.to && d > r.to) return false; return true; }
  function scoped() { return S.occ.filter(inPeriod); }

  function sumExposure(list) {
    var a = { requested: 0, confirmedLoss: 0, atRisk: 0, recovered: 0, cancelled: 0, compensation: 0, unclassified: 0 };
    list.forEach(function (o) { var e = o.exposure; a.requested += e.requested; a.compensation += e.compensation; a.confirmedLoss += e.confirmedLoss; a.atRisk += e.atRisk; if (e.bucket === 'RECOVERED') a.recovered += e.compensation; if (e.bucket === 'CANCELLED') a.cancelled += e.requested; if (e.bucket === 'UNCLASSIFIED') a.unclassified += e.requested; });
    Object.keys(a).forEach(function (k) { a[k] = Math.round(a[k] * 100) / 100; }); a.potentiallyRecoverable = a.atRisk; return a;
  }

  // ---- render ----
  function render() {
    var last = S.batches[0];
    app.innerHTML =
      '<div class="page-head"><div><h2>Pós-venda &amp; Perdas</h2><p>Devoluções, reembolsos, cancelamentos e falhas de entrega — exposição e causas.</p></div>' +
      '<select class="select sm" id="preset">' + [['all', 'Todo o período'], ['today', 'Hoje'], ['7d', 'Últimos 7 dias'], ['30d', 'Últimos 30 dias'], ['month', 'Mês atual'], ['prevmonth', 'Mês anterior']].map(function (o) { return '<option value="' + o[0] + '"' + (S.preset === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></div>' +
      '<div class="tabs">' + [['visao', 'Visão Geral'], ['ocorrencias', 'Ocorrências'], ['exposicao', 'Exposição'], ['saude', 'Saúde dos Dados'], ['importacoes', 'Importações']].map(function (t) { return '<div class="tab ' + (S.tab === t[0] ? 'active' : '') + '" data-tab="' + t[0] + '">' + t[1] + '</div>'; }).join('') + '</div>' +
      '<div id="body"></div>';
    q('#preset').onchange = function () { S.preset = this.value; renderBody(); };
    app.querySelectorAll('.tab').forEach(function (t) { t.onclick = function () { S.tab = t.dataset.tab; S.page = 1; render(); }; });
    renderBody();
  }

  function renderBody() {
    var el = q('#body');
    if (S.occ.length === 0 && S.tab !== 'importacoes') { el.innerHTML = '<div class="seedbar"><b>Comece importando os relatórios reais da Shopee</b> na aba <b>Importações</b> (Devoluções, Cancelamentos, Falhas). Tudo é processado no seu navegador.</div>'; return; }
    if (S.tab === 'visao') return renderVisao(el);
    if (S.tab === 'ocorrencias') return renderOcc(el);
    if (S.tab === 'exposicao') return renderExp(el);
    if (S.tab === 'saude') return renderSaude(el);
    if (S.tab === 'importacoes') return renderImport(el);
  }
  function kpi(l, v, sub, warn) { return '<div class="kpi"><div class="lbl">' + l + '</div><div class="val" style="' + (warn ? 'color:var(--warn)' : '') + '">' + v + '</div>' + (sub ? '<div class="sub">' + sub + '</div>' : '') + '</div>'; }

  function renderVisao(el) {
    var list = scoped(), e = sumExposure(list);
    var byType = {}; list.forEach(function (o) { byType[o.type] = (byType[o.type] || 0) + 1; });
    var orders = {}; list.forEach(function (o) { orders[o.orderId] = 1; });
    // top SKUs
    var bySku = {}; list.forEach(function (o) { var seen = {}; o.items.forEach(function (i) { if (!i.sku || seen[i.sku]) return; seen[i.sku] = 1; var c = bySku[i.sku] = bySku[i.sku] || { sku: i.sku, product: i.productName, occ: 0 }; c.occ++; }); });
    var top = Object.keys(bySku).map(function (k) { return bySku[k]; }).sort(function (a, b) { return b.occ - a.occ; }).slice(0, 10);
    el.innerHTML =
      '<div class="kpi-grid">' + kpi('Ocorrências', nn(list.length), nn(Object.keys(orders).length) + ' pedidos') + kpi('Devoluções', nn(byType.RETURN_REFUND || 0)) + kpi('Cancelamentos', nn(byType.ORDER_CANCELLATION || 0)) + kpi('Falhas de entrega', nn(byType.FAILED_DELIVERY || 0)) + '</div>' +
      '<div class="kpi-grid">' + kpi('Prejuízo confirmado', brl(e.confirmedLoss), '', true) + kpi('Em risco', brl(e.atRisk)) + kpi('Recuperado', brl(e.recovered)) + kpi('Solicitação cancelada', brl(e.cancelled)) + '</div>' +
      '<div class="panel"><div class="ph"><h3>Top SKUs por ocorrência</h3></div><div class="pb" style="padding:0"><div class="table-wrap"><table><thead><tr><th>SKU</th><th>Produto</th><th>Ocorrências</th></tr></thead><tbody>' +
      (top.length ? top.map(function (s) { return '<tr><td class="mono">' + esc(s.sku) + '</td><td>' + esc(s.product || '—') + '</td><td>' + s.occ + '</td></tr>'; }).join('') : '<tr><td colspan="3" class="empty">Sem SKUs.</td></tr>') +
      '</tbody></table></div></div></div><div class="footnote">' + esc(PV.methodology) + '</div>';
  }

  function renderExp(el) {
    var e = sumExposure(scoped());
    var rows = [['Valor solicitado', e.requested], ['Prejuízo confirmado', e.confirmedLoss, 1], ['Em risco', e.atRisk], ['Recuperado', e.recovered], ['Compensações', e.compensation], ['Solicitação cancelada/desistida', e.cancelled], ['Potencialmente recuperável', e.potentiallyRecoverable], ['Sem classificação segura', e.unclassified]];
    el.innerHTML = '<div class="panel"><div class="ph"><h3>Exposição financeira</h3></div><div class="pb" style="padding:0"><div class="table-wrap"><table><tbody>' + rows.map(function (r) { return '<tr><td>' + r[0] + '</td><td style="text-align:right;font-weight:700;' + (r[2] ? 'color:var(--err)' : '') + '">' + brl(r[1]) + '</td></tr>'; }).join('') + '</tbody></table></div><div class="pb footnote">' + esc(PV.methodology) + '</div></div>';
  }

  function renderSaude(el) {
    var types = Object.keys(TYPES);
    var per = types.map(function (t) { var l = S.occ.filter(function (o) { return o.type === t; }); var ds = l.map(function (o) { return o.occurredAt; }).filter(Boolean).sort(); return { type: t, count: l.length, from: ds[0], to: ds[ds.length - 1] }; });
    var items = 0, withSku = 0; S.occ.forEach(function (o) { o.items.forEach(function (i) { items++; if (i.sku) withSku++; }); });
    el.innerHTML = '<div class="kpi-grid">' + kpi('Itens', nn(items)) + kpi('Itens com SKU', items ? Math.round(withSku / items * 100) + '%' : '0%') + kpi('Vínculo ao catálogo', '—', 'requer o módulo Produtos', true) + '</div>' +
      '<div class="panel"><div class="ph"><h3>Cobertura por relatório</h3></div><div class="pb" style="padding:0"><div class="table-wrap"><table><thead><tr><th>Relatório</th><th>Ocorrências</th><th>Período</th></tr></thead><tbody>' +
      per.map(function (t) { return '<tr><td>' + TYPES[t.type] + '</td><td>' + nn(t.count) + '</td><td>' + (t.from ? new Date(t.from).toLocaleDateString('pt-BR') + ' — ' + new Date(t.to).toLocaleDateString('pt-BR') : '<span class="tag warn">sem dados</span>') + '</td></tr>'; }).join('') +
      '</tbody></table></div></div></div><div class="footnote">Taxas por coorte dependem da base de Pedidos/Vendas — aqui mostramos volumes, não taxas.</div>';
  }

  function renderOcc(el) {
    var f = S.filters, list = scoped().filter(function (o) {
      if (f.type && o.type !== f.type) return false;
      if (f.status && (o.status || '').toLowerCase().indexOf(f.status.toLowerCase()) < 0) return false;
      if (f.search) { var s = f.search.toLowerCase(); if (!((o.orderId || '').toLowerCase().indexOf(s) >= 0 || (o.returnId || '').toLowerCase().indexOf(s) >= 0 || o.items.some(function (i) { return (i.sku || '').toLowerCase().indexOf(s) >= 0 || (i.productName || '').toLowerCase().indexOf(s) >= 0; }))) return false; }
      return true;
    });
    var pageSize = 25, pages = Math.max(1, Math.ceil(list.length / pageSize)); if (S.page > pages) S.page = pages;
    var slice = list.slice((S.page - 1) * pageSize, S.page * pageSize);
    el.innerHTML = '<div class="panel"><div class="pb"><div class="toolbar2">' +
      '<input class="input sm" id="s" style="width:240px" placeholder="Buscar pedido, devolução, SKU…" value="' + esc(f.search) + '">' +
      '<select class="select sm" id="ft"><option value="">Tipo: todos</option>' + Object.keys(TYPES).map(function (t) { return '<option value="' + t + '"' + (f.type === t ? ' selected' : '') + '>' + TYPES[t].split(' ')[0] + '</option>'; }).join('') + '</select>' +
      '<input class="input sm" id="fs" style="width:150px" placeholder="Status contém…" value="' + esc(f.status) + '"></div>' +
      '<div class="count-line"><b>' + nn(list.length) + '</b> ocorrências</div></div>' +
      '<div class="pb" style="padding:0"><div class="table-wrap"><table><thead><tr><th>Tipo</th><th>Pedido</th><th>ID Devolução</th><th>Status</th><th>Itens</th><th>Reembolso</th><th>Exposição</th><th></th></tr></thead><tbody>' +
      (slice.length ? slice.map(function (o, i) { return '<tr><td><span class="tag info">' + TYPES[o.type].split(' ')[0] + '</span></td><td class="mono">' + esc(o.orderId) + '</td><td class="mono">' + esc(o.returnId || '—') + '</td><td>' + esc(o.status || '—') + '</td><td>' + o.items.length + (o.items.length > 1 ? ' <span class="tag">multi-SKU</span>' : '') + '</td><td>' + brl(o.requested) + '</td><td><span class="tag ' + (o.exposure.bucket === 'CONFIRMED' ? 'warn' : o.exposure.bucket === 'AT_RISK' ? 'info' : 'ok') + '">' + o.exposure.bucket + '</span></td><td><button class="btn-sm" data-open="' + o.id + '">Abrir</button></td></tr>'; }).join('') : '<tr><td colspan="8" class="empty">Nenhuma ocorrência.</td></tr>') +
      '</tbody></table></div></div>' +
      (pages > 1 ? '<div class="pb" style="display:flex;gap:8px;justify-content:flex-end;align-items:center"><button class="btn-sm" id="pv"' + (S.page <= 1 ? ' disabled' : '') + '>Anterior</button><span class="footnote" style="margin:0">página ' + S.page + ' de ' + pages + '</span><button class="btn-sm" id="nx"' + (S.page >= pages ? ' disabled' : '') + '>Próxima</button></div>' : '') + '</div>';
    q('#s').oninput = function () { S.filters.search = this.value; S.page = 1; renderBody(); };
    q('#ft').onchange = function () { S.filters.type = this.value; S.page = 1; renderBody(); };
    q('#fs').oninput = function () { S.filters.status = this.value; S.page = 1; renderBody(); };
    var pv = q('#pv'), nx = q('#nx'); if (pv) pv.onclick = function () { S.page--; renderBody(); }; if (nx) nx.onclick = function () { S.page++; renderBody(); };
    app.querySelectorAll('[data-open]').forEach(function (b) { b.onclick = function () { openDetail(b.dataset.open); }; });
  }

  function openDetail(id) {
    var o = S.occ.find(function (x) { return x.id === id; }); if (!o) return;
    var d = document.createElement('div'); d.className = 'drawer';
    d.innerHTML = '<div class="drawer-panel" style="width:520px"><div class="dh"><h3 style="margin:0;font-size:16px">Ficha da ocorrência</h3><button class="x">×</button></div><div class="dbd">' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><div><label class="fld">Tipo</label><div class="ro">' + TYPES[o.type] + '</div></div><div><label class="fld">Status</label><div class="ro">' + esc(o.status || '—') + '</div></div>' +
      '<div><label class="fld">Pedido</label><div class="ro mono">' + esc(o.orderId) + '</div></div><div><label class="fld">ID Devolução</label><div class="ro mono">' + esc(o.returnId || '—') + '</div></div>' +
      '<div><label class="fld">Reembolso solicitado</label><div class="ro">' + brl(o.requested) + '</div></div><div><label class="fld">Exposição</label><div class="ro">' + o.exposure.bucket + '</div></div></div>' +
      '<label class="fld">Motivo / Solução</label><div class="ro">' + esc(o.reason || '—') + (o.resolution ? ' · ' + esc(o.resolution) : '') + '</div>' +
      '<label class="fld">Itens (' + o.items.length + ') — valor da ocorrência contado uma vez</label><div class="table-wrap" style="border:1px solid var(--line);border-radius:10px"><table><thead><tr><th>SKU</th><th>Produto/Variação</th><th>Qtd</th></tr></thead><tbody>' +
      o.items.map(function (i) { return '<tr><td class="mono">' + esc(i.sku || '—') + '</td><td>' + esc(i.productName || '—') + (i.variationName ? ' · ' + esc(i.variationName) : '') + '</td><td>' + (i.quantity == null ? '—' : i.quantity) + '</td></tr>'; }).join('') +
      '</tbody></table></div></div></div>';
    d.onclick = function (e) { if (e.target === d) d.remove(); }; d.querySelector('.x').onclick = function () { d.remove(); };
    document.body.appendChild(d);
  }

  function renderImport(el) {
    el.innerHTML = '<div class="kpi-grid">' + Object.keys(TYPES).map(function (t) { return '<div class="kpi"><div class="lbl">' + TYPES[t] + '</div><button class="btn-sm primary" style="margin-top:10px" data-imp="' + t + '">Importar planilha</button><input type="file" accept=".xlsx,.xls,.csv" class="hidden" data-file="' + t + '"></div>'; }).join('') + '</div>' +
      '<div class="panel"><div class="ph"><h3>Histórico de importações</h3><span class="footnote" style="margin:0">' + S.batches.length + '</span></div><div class="pb" style="padding:0">' +
      (S.batches.length ? '<div class="table-wrap"><table><thead><tr><th>Relatório</th><th>Arquivo</th><th>Ocorrências</th><th>Novas</th><th>Atualizadas</th><th>Itens</th><th>Período</th><th>Data</th></tr></thead><tbody>' + S.batches.map(function (b) { return '<tr><td>' + TYPES[b.type] + '</td><td>' + esc(b.filename) + '</td><td>' + b.occurrencesSeen + '</td><td>' + b.newOcc + '</td><td>' + b.updatedOcc + '</td><td>' + b.itemsSeen + '</td><td class="footnote" style="margin:0">' + (b.periodStart ? new Date(b.periodStart).toLocaleDateString('pt-BR') + '—' + new Date(b.periodEnd).toLocaleDateString('pt-BR') : '—') + '</td><td class="footnote" style="margin:0">' + new Date(b.createdAt).toLocaleString('pt-BR') + '</td></tr>'; }).join('') + '</tbody></table></div>' : '<div class="empty">Nenhuma importação ainda.</div>') +
      '</div></div>';
    app.querySelectorAll('[data-imp]').forEach(function (b) { b.onclick = function () { app.querySelector('[data-file="' + b.dataset.imp + '"]').click(); }; });
    app.querySelectorAll('[data-file]').forEach(function (inp) { inp.onchange = function () { var f = inp.files[0]; if (!f) return; var type = inp.dataset.file; importFile(type, f).then(function (b) { render(); toast('Importação: ' + TYPES[type], b.occurrencesSeen + ' ocorrências · ' + b.newOcc + ' novas · ' + b.updatedOcc + ' atualizadas · ' + b.itemsSeen + ' itens'); }).catch(function (e) { toast('Falha', e.message || e, true); }); inp.value = ''; }; });
  }

  openDB().then(function () { return Promise.all([getAll('occ'), getAll('batches')]); }).then(function (r) { S.occ = r[0]; S.batches = r[1].sort(function (a, b) { return b.createdAt.localeCompare(a.createdAt); }); render(); }).catch(function (e) { app.innerHTML = '<div class="form-err">Falha ao abrir banco local: ' + esc(e.message || e) + '</div>'; });
})();
