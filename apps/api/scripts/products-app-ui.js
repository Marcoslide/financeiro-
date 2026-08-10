/* Módulo Produtos — protótipo autônomo (offline) para validação da interface.
 * Usa o MESMO parser do sistema (HomologProdutos.parseProductSheet) e persiste em
 * IndexedDB apenas nesta versão standalone. No sistema real a fonte da verdade é
 * o backend/PostgreSQL.
 *
 * Princípio central: existe UM ÚNICO conjunto filtrado (no nível do SKU). Ele
 * alimenta, com os MESMOS ids: a visualização, a contagem, a seleção e as ações
 * em massa. Filtros de variação (família, preço de fechamento, estoque, busca)
 * escondem os SKUs que não pertencem ao resultado; o anúncio master aparece
 * apenas como agrupador dos SKUs correspondentes. */
(function () {
  'use strict';
  var P = window.HomologProdutos;

  // ------------------------------------------------------------ IndexedDB
  var DB = null, STORES = ['products', 'variations', 'families', 'imports'];
  function openDB() { return new Promise(function (res, rej) { var r = indexedDB.open('produtos_shopee', 1); r.onupgradeneeded = function () { STORES.forEach(function (s) { if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s, { keyPath: 'id' }); }); }; r.onsuccess = function () { DB = r.result; res(); }; r.onerror = function () { rej(r.error); }; }); }
  function getAll(store) { return new Promise(function (res) { var out = []; DB.transaction(store, 'readonly').objectStore(store).openCursor().onsuccess = function (e) { var c = e.target.result; if (c) { out.push(c.value); c.continue(); } else res(out); }; }); }
  function putMany(store, items) { return new Promise(function (res) { if (!items.length) return res(); var t = DB.transaction(store, 'readwrite').objectStore(store); items.forEach(function (i) { t.put(i); }); t.transaction.oncomplete = function () { res(); }; }); }

  // ------------------------------------------------------------ Estado
  var EMPTY = { search: '', familyId: '', family: '', closingPrice: '', stock: '', variations: '', status: '', sort: 'name_asc' };
  var S = { tab: 'produtos', products: [], variations: [], families: [], imports: [], varByProduct: {}, filters: Object.assign({}, EMPTY), page: 1, pageSize: 25, expanded: new Set(), selected: new Set(), allFiltered: false, edit: null };

  // ------------------------------------------------------------ Utils
  var brl = function (v) { return v == null ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); };
  var num = function (n) { return Number(n).toLocaleString('pt-BR'); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function normalize(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim(); }
  function parseNum(s) { if (s == null) return null; var t = String(s).replace(/\s|R\$/gi, '').trim(); if (t === '') return null; if (t.indexOf('.') >= 0 && t.indexOf(',') >= 0) t = t.replace(/\./g, '').replace(',', '.'); else if (t.indexOf(',') >= 0) t = t.replace(',', '.'); var n = Number(t); return isFinite(n) ? n : null; }
  function uuid() { return crypto.randomUUID ? crypto.randomUUID() : 'f' + Date.now() + Math.random().toString(16).slice(2); }
  function toast(title, body, err) { var el = document.createElement('div'); el.className = 'toast' + (err ? ' err' : ''); el.innerHTML = '<div class="tt">' + esc(title) + '</div><div>' + esc(body) + '</div>'; document.body.appendChild(el); setTimeout(function () { el.remove(); }, 4500); }
  var debTimer = null; function debounce(fn, ms) { return function () { clearTimeout(debTimer); debTimer = setTimeout(fn, ms); }; }
  function reindex() { S.varByProduct = {}; S.variations.forEach(function (v) { (S.varByProduct[v.productId] = S.varByProduct[v.productId] || []).push(v); }); }
  var famById = function () { var m = {}; S.families.forEach(function (f) { m[f.id] = f; }); return m; };

  // ------------------------------------------------------------ Sincronização (upsert idempotente)
  function syncRows(rows) {
    var now = new Date().toISOString();
    var errors = rows.filter(function (r) { return r.error; }).length;
    var valid = rows.filter(function (r) { return !r.error && r.shopeeProductId; });
    var prodById = {}; S.products.forEach(function (p) { prodById[p.id] = p; });
    var varById = {}; S.variations.forEach(function (v) { varById[v.id] = v; });
    var nameById = {}; valid.forEach(function (r) { if (nameById[r.shopeeProductId] == null && r.productName) nameById[r.shopeeProductId] = r.productName; });
    var res = { total: rows.length, productsSeen: 0, variationsSeen: 0, newProducts: 0, newVariations: 0, updated: 0, unchanged: 0, errors: errors };
    var seen = {}, lastRowByKey = {};
    valid.forEach(function (r) { seen[r.shopeeProductId] = 1; lastRowByKey[r.shopeeProductId + '::' + r.variationKey] = r; });
    res.productsSeen = Object.keys(seen).length;
    var cp = [], cv = [];
    Object.keys(seen).forEach(function (pid) {
      var name = nameById[pid] || pid, ex = prodById[pid];
      if (!ex) { var p = { id: pid, shopeeProductId: pid, name: name, principalSku: null, status: 'ACTIVE', firstSeenAt: now, lastSeenAt: now }; prodById[pid] = p; S.products.push(p); cp.push(p); res.newProducts++; }
      else { ex.lastSeenAt = now; if (ex.name !== name) { ex.name = name; res.updated++; } cp.push(ex); }
    });
    Object.keys(lastRowByKey).forEach(function (key) {
      var r = lastRowByKey[key]; res.variationsSeen++;
      var id = r.shopeeProductId + '::' + r.variationKey, ex = varById[id], price = r.shopeeFullPrice == null ? null : Number(r.shopeeFullPrice);
      // captura o SKU de referência como "SKU principal" do master, quando existir
      var prod = prodById[r.shopeeProductId]; if (prod && !prod.principalSku && r.referenceSku) prod.principalSku = r.referenceSku;
      if (!ex) { var v = { id: id, productId: r.shopeeProductId, shopeeVariationId: r.shopeeVariationId || '', variationKey: r.variationKey, variationName: r.variationName, sku: r.sku, referenceSku: r.referenceSku, gtin: r.gtin, shopeeFullPrice: price, sellerStock: r.sellerStock, failReason: r.failReason, familyId: null, closingPrice: null, firstSeenAt: now, lastSeenAt: now }; varById[id] = v; S.variations.push(v); cv.push(v); res.newVariations++; }
      else { var chg = ex.variationName !== r.variationName || ex.sku !== r.sku || ex.referenceSku !== r.referenceSku || ex.gtin !== r.gtin || ex.sellerStock !== r.sellerStock || (ex.shopeeFullPrice == null ? null : Number(ex.shopeeFullPrice)) !== price; ex.lastSeenAt = now; if (chg) { ex.variationName = r.variationName; ex.sku = r.sku; ex.referenceSku = r.referenceSku; ex.gtin = r.gtin; ex.shopeeFullPrice = price; ex.sellerStock = r.sellerStock; ex.shopeeVariationId = r.shopeeVariationId || ''; res.updated++; } else res.unchanged++; cv.push(ex); }
    });
    reindex();
    return Promise.all([putMany('products', cp), putMany('variations', cv)]).then(function () { var b = { id: uuid(), createdAt: now, filename: res.filename || 'planilha.xlsx', total: res.total, productsSeen: res.productsSeen, variationsSeen: res.variationsSeen, newProducts: res.newProducts, newVariations: res.newVariations, updated: res.updated, unchanged: res.unchanged, errors: res.errors }; S.imports.unshift(b); return putMany('imports', [b]).then(function () { return res; }); });
  }

  function stats() { return { products: S.products.length, variations: S.variations.length, withoutFamily: S.variations.filter(function (v) { return !v.familyId; }).length, withoutClosing: S.variations.filter(function (v) { return v.closingPrice == null; }).length, families: S.families.length }; }

  // ------------------------------------------------------------ CONJUNTO FILTRADO ÚNICO (nível SKU)
  function variationScoped(v, p, q, titleMatch, f) {
    if (q && !titleMatch) { if (!(normalize(v.sku).indexOf(q) >= 0 || normalize(v.variationName).indexOf(q) >= 0 || String(v.shopeeVariationId).indexOf(q) >= 0)) return false; }
    if (f.familyId && v.familyId !== f.familyId) return false;
    if (f.family === 'with' && !v.familyId) return false;
    if (f.family === 'without' && v.familyId) return false;
    if (f.closingPrice === 'with' && v.closingPrice == null) return false;
    if (f.closingPrice === 'without' && v.closingPrice != null) return false;
    if (f.stock === 'with' && !((v.sellerStock || 0) > 0)) return false;
    if (f.stock === 'zero' && v.sellerStock !== 0) return false;
    if (f.stock === 'without' && (v.sellerStock || 0) > 0) return false;
    return true;
  }
  function computeFiltered() {
    var f = S.filters, q = normalize(f.search);
    var varLevel = !!(f.search || f.familyId || f.family || f.closingPrice || f.stock);
    var fm = famById();
    var masters = [], ids = [];
    S.products.forEach(function (p) {
      var all = S.varByProduct[p.id] || [];
      if (f.status && p.status !== f.status) return;
      if (f.variations === 'single' && all.length !== 1) return;
      if (f.variations === 'multiple' && all.length <= 1) return;
      var shown;
      if (!varLevel) shown = all;
      else { var titleMatch = q && (normalize(p.name).indexOf(q) >= 0 || String(p.shopeeProductId).indexOf(q) >= 0 || (p.principalSku && normalize(p.principalSku).indexOf(q) >= 0)); shown = all.filter(function (v) { return variationScoped(v, p, q, titleMatch, f); }); if (!shown.length) return; }
      masters.push({ p: p, all: all, shown: shown, a: aggOf(all, shown, fm) });
      shown.forEach(function (v) { ids.push(v.id); });
    });
    var C = {
      name_asc: function (a, b) { return a.p.name.localeCompare(b.p.name); }, name_desc: function (a, b) { return b.p.name.localeCompare(a.p.name); },
      stock_desc: function (a, b) { return b.a.totalStock - a.a.totalStock; }, stock_asc: function (a, b) { return a.a.totalStock - b.a.totalStock; },
      price_desc: function (a, b) { return (b.a.maxPrice || 0) - (a.a.maxPrice || 0); }, price_asc: function (a, b) { return (a.a.minPrice == null ? 1e15 : a.a.minPrice) - (b.a.minPrice == null ? 1e15 : b.a.minPrice); },
      variations_desc: function (a, b) { return b.shown.length - a.shown.length; }, variations_asc: function (a, b) { return a.shown.length - b.shown.length; },
      without_family: function (a, b) { return b.a.woFam - a.a.woFam; }, without_closing: function (a, b) { return b.a.woClose - a.a.woClose; },
    };
    masters.sort(C[f.sort] || C.name_asc);
    return { masters: masters, ids: ids, varLevel: varLevel };
  }
  // agregados do master calculados sobre os SKUs EM CONTEXTO (shown)
  function aggOf(all, shown, fm) {
    var prices = shown.map(function (v) { return v.shopeeFullPrice; }).filter(function (n) { return n != null; });
    var fams = uniq(shown.map(function (v) { return v.familyId || null; }));
    var closes = uniq(shown.map(function (v) { return v.closingPrice == null ? null : v.closingPrice; }));
    var costs = uniq(shown.map(function (v) { var f = v.familyId ? fm[v.familyId] : null; return f && f.currentCostAmount != null ? f.currentCostAmount : null; }));
    return {
      totalStock: shown.reduce(function (s, v) { return s + (v.sellerStock || 0); }, 0),
      minPrice: prices.length ? Math.min.apply(null, prices) : null, maxPrice: prices.length ? Math.max.apply(null, prices) : null,
      woFam: shown.filter(function (v) { return !v.familyId; }).length, woClose: shown.filter(function (v) { return v.closingPrice == null; }).length,
      famSummary: fams.length === 0 ? 'none' : fams.length === 1 ? (fams[0] ? 'single:' + fams[0] : 'none') : 'multi',
      close: agg1(closes), cost: agg1(costs),
    };
  }
  function uniq(a) { var s = {}, o = []; a.forEach(function (x) { var k = x == null ? ' ' : String(x); if (!s[k]) { s[k] = 1; o.push(x); } }); return o; }
  function agg1(vals) { if (!vals.length) return { kind: 'none' }; if (vals.length === 1) return vals[0] == null ? { kind: 'none' } : { kind: 'one', v: vals[0] }; var nn = vals.filter(function (x) { return x != null; }); if (!nn.length) return { kind: 'none' }; return { kind: 'multi', min: Math.min.apply(null, nn), max: Math.max.apply(null, nn) }; }

  // ------------------------------------------------------------ Sugestão automática (heurística; NÃO é IA)
  var STOP = { de: 1, do: 1, da: 1, com: 1, sem: 1, para: 1, e: 1, o: 1, a: 1, em: 1, kit: 1, un: 1, modelo: 1 };
  function tokset(s) { var o = {}; normalize(s).split(/[^a-z0-9]+/).forEach(function (t) { if (t.length >= 2 && !STOP[t]) o[t] = 1; }); return o; }
  function suggestFor(ids) {
    var fams = S.families.filter(function (f) { return f.status === 'ACTIVE'; }).map(function (f) { return { f: f, t: tokset(f.name) }; }), counts = {};
    ids.slice(0, 400).forEach(function (id) { var v = S.variations.find(function (x) { return x.id === id; }); if (!v) return; var p = S.products.find(function (x) { return x.id === v.productId; }); var vt = tokset((p ? p.name : '') + ' ' + (v.variationName || '') + ' ' + (v.sku || '')); var vk = Object.keys(vt), best = null; fams.forEach(function (fm) { var fk = Object.keys(fm.t); if (!fk.length) return; var inter = fk.filter(function (t) { return vt[t]; }).length; if (!inter) return; var conf = Math.min(1, inter / (fk.length + vk.length - inter) + (fk.some(function (t) { return /^\d{1,3}x\d{1,3}$/.test(t) && vt[t]; }) ? 0.25 : 0)); if (!best || conf > best.conf) best = { id: fm.f.id, name: fm.f.name, conf: conf }; }); if (best && best.conf >= 0.34) { var c = counts[best.id] || { name: best.name, n: 0, conf: 0 }; c.n++; c.conf = Math.max(c.conf, best.conf); counts[best.id] = c; } });
    var arr = Object.keys(counts).map(function (id) { return { id: id, name: counts[id].name, n: counts[id].n, conf: Math.round(counts[id].conf * 100) }; }); arr.sort(function (a, b) { return b.n - a.n; }); return arr[0] || null;
  }

  // ------------------------------------------------------------ Persistência de mutações
  function saveVars(vs) { return putMany('variations', vs); }
  function pruneSelection(ids) { var set = {}; ids.forEach(function (id) { set[id] = 1; }); Array.from(S.selected).forEach(function (id) { if (!set[id]) S.selected.delete(id); }); }

  // ------------------------------------------------------------ Render
  var app = document.getElementById('app');
  function q(sel) { return app.querySelector(sel) || document.querySelector(sel); }
  function render() { if (S.tab === 'produtos') renderProdutos(); else if (S.tab === 'familias') renderFamilias(); else renderImportacoes(); }
  function tabsHtml(a) { return '<div class="tabs">' + [['produtos', 'Produtos'], ['familias', 'Famílias'], ['importacoes', 'Importações']].map(function (t) { return '<div class="tab ' + (a === t[0] ? 'active' : '') + '" data-tab="' + t[0] + '">' + t[1] + '</div>'; }).join('') + '</div>'; }
  function head(sub) { return '<div class="page-head"><div><h2>Produtos</h2><p>' + sub + '</p></div></div>'; }
  function wireTabs() { app.querySelectorAll('.tab').forEach(function (t) { t.onclick = function () { S.tab = t.dataset.tab; S.edit = null; render(); }; }); }

  function renderProdutos() {
    var s = stats(), last = S.imports[0];
    app.innerHTML = head('Catálogo Shopee: anúncios, variações/SKUs, famílias e custos.') + tabsHtml('produtos') +
      '<div class="importbar"><div><div class="ib-title">Atualizar catálogo Shopee</div><div class="ib-meta">' + (last ? 'Última atualização: ' + new Date(last.createdAt).toLocaleString('pt-BR') + ' · ' : '') + num(s.products) + ' anúncios · ' + num(s.variations) + ' SKUs</div></div><div class="spacer"></div><button class="link-btn" id="goImports">Ver histórico</button><button class="btn-sm primary" id="openImport">Importar planilha</button></div>' +
      '<div class="kpi-grid">' + kpi('Anúncios', num(s.products), 'k-all') + kpi('Variações / SKUs', num(s.variations), 'k-all') + kpi('SKUs sem família', num(s.withoutFamily), 'k-nofam', s.withoutFamily > 0) + kpi('SKUs sem preço de fechamento', num(s.withoutClosing), 'k-noclose', s.withoutClosing > 0) + '</div>' +
      '<div class="panel"><div class="pb">' + toolbarHtml() + '<div id="countline"></div><div id="selbanner"></div></div><div class="pb" style="padding:0" id="results"></div><div class="pb" id="pager"></div></div><div id="bulk"></div>';
    q('#openImport').onclick = openImportModal; q('#goImports').onclick = function () { S.tab = 'importacoes'; render(); };
    wireTabs(); app.querySelectorAll('.kpi.clickable').forEach(function (k) { k.onclick = function () { onKpi(k.dataset.k); }; });
    wireToolbar(); refresh();
  }
  function kpi(l, v, k, warn) { return '<div class="kpi clickable ' + (kpiOn(k) ? 'on' : '') + '" data-k="' + k + '"><div class="lbl">' + l + '</div><div class="val" style="' + (warn ? 'color:var(--warn)' : '') + '">' + v + '</div></div>'; }
  function kpiOn(k) { return (k === 'k-nofam' && S.filters.family === 'without') || (k === 'k-noclose' && S.filters.closingPrice === 'without'); }
  function onKpi(k) { if (k === 'k-all') S.filters = Object.assign({}, EMPTY); else if (k === 'k-nofam') { S.filters = Object.assign({}, EMPTY, { family: 'without', sort: 'without_family' }); } else if (k === 'k-noclose') { S.filters = Object.assign({}, EMPTY, { closingPrice: 'without', sort: 'without_closing' }); } S.page = 1; S.allFiltered = false; render(); }

  function toolbarHtml() {
    var f = S.filters; function sel(id, val, opts) { return '<select class="select sm" data-f="' + id + '">' + opts.map(function (o) { return '<option value="' + o[0] + '"' + (val === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>'; }
    return '<div class="toolbar2"><input class="input sm" id="search" style="width:260px" placeholder="Buscar título, SKU, variação ou ID…" value="' + esc(f.search) + '">' +
      sel('familyId', f.familyId, [['', 'Família: todas']].concat(S.families.map(function (fm) { return [fm.id, fm.name]; }))) +
      sel('family', f.family, [['', 'Classificação: todos'], ['with', 'Com família'], ['without', 'Sem família']]) +
      sel('closingPrice', f.closingPrice, [['', 'Preço fechamento: todos'], ['with', 'Configurado'], ['without', 'Não configurado']]) +
      sel('stock', f.stock, [['', 'Estoque: todos'], ['with', 'Com estoque'], ['without', 'Sem estoque'], ['zero', 'Zerado']]) +
      sel('variations', f.variations, [['', 'Variações: todas'], ['single', 'Sem variação'], ['multiple', 'Com variações']]) +
      sel('status', f.status, [['', 'Status: todos'], ['ACTIVE', 'Ativo'], ['INACTIVE', 'Inativo']]) +
      sel('sort', f.sort, [['name_asc', 'Nome A–Z'], ['name_desc', 'Nome Z–A'], ['stock_desc', 'Maior estoque'], ['stock_asc', 'Menor estoque'], ['price_desc', 'Maior preço'], ['price_asc', 'Menor preço'], ['variations_desc', 'Mais variações'], ['variations_asc', 'Menos variações'], ['without_family', 'Sem família 1º'], ['without_closing', 'Sem fechamento 1º']]) +
      '<button class="link-btn" id="clearF">Limpar filtros</button></div>';
  }
  function wireToolbar() {
    var si = q('#search'); si.oninput = debounce(function () { S.filters.search = si.value; S.page = 1; S.allFiltered = false; refresh(); }, 220);
    app.querySelectorAll('select[data-f]').forEach(function (se) { se.onchange = function () { var k = se.dataset.f; S.filters[k] = se.value; if (k === 'familyId' && se.value) S.filters.family = ''; if (k === 'family') S.filters.familyId = ''; S.page = 1; S.allFiltered = false; render(); }; });
    q('#clearF').onclick = function () { S.filters = Object.assign({}, EMPTY); S.page = 1; S.allFiltered = false; render(); };
  }

  function refresh() {
    var R = computeFiltered(), s = stats();
    pruneSelection(R.ids);
    var pages = Math.max(1, Math.ceil(R.masters.length / S.pageSize)); if (S.page > pages) S.page = pages;
    var pageMasters = R.masters.slice((S.page - 1) * S.pageSize, S.page * S.pageSize);
    var pageIds = []; pageMasters.forEach(function (m) { m.shown.forEach(function (v) { pageIds.push(v.id); }); });
    var pageAll = pageIds.length > 0 && pageIds.every(function (id) { return S.selected.has(id); });
    app.querySelectorAll('.kpi.clickable').forEach(function (k) { k.classList.toggle('on', kpiOn(k.dataset.k)); });
    var filteredView = JSON.stringify(S.filters) !== JSON.stringify(EMPTY);
    q('#countline').className = 'count-line';
    q('#countline').innerHTML = (filteredView ? '<b>' + num(R.masters.length) + '</b> de ' + num(s.products) + ' anúncios' : '<b>' + num(R.masters.length) + '</b> anúncios') + ' · <b>' + num(R.ids.length) + '</b> SKUs correspondentes · <button class="link-btn" id="expAll">Expandir</button> / <button class="link-btn" id="colAll">Recolher</button>';
    q('#expAll').onclick = function () { pageMasters.forEach(function (m) { S.expanded.add(m.p.id); }); refresh(); }; q('#colAll').onclick = function () { S.expanded.clear(); refresh(); };
    var sb = q('#selbanner'); sb.innerHTML = '';
    if (S.allFiltered && S.selected.size) sb.innerHTML = '<div class="selbanner"><span>Todos os <b>' + num(S.selected.size) + '</b> SKUs do resultado estão selecionados.</span><button class="link-btn" id="clrSel">Limpar seleção</button></div>';
    else if (pageAll && R.ids.length > pageIds.length) sb.innerHTML = '<div class="selbanner"><span>' + pageIds.length + ' SKUs desta página selecionados.</span><button class="link-btn" id="selAllF">Selecionar todos os ' + num(R.ids.length) + ' SKUs do resultado</button></div>';
    var b1 = q('#clrSel'); if (b1) b1.onclick = function () { S.selected.clear(); S.allFiltered = false; refresh(); };
    var b2 = q('#selAllF'); if (b2) b2.onclick = function () { R.ids.forEach(function (id) { S.selected.add(id); }); S.allFiltered = true; refresh(); };
    q('#results').innerHTML = renderTable(pageMasters, pageAll); wireResults(pageMasters);
    q('#pager').innerHTML = pagerHtml(pages);
    app.querySelectorAll('[data-ps]').forEach(function (b) { b.onclick = function () { S.pageSize = +b.dataset.ps; S.page = 1; refresh(); }; });
    var pv = q('#prev'), nx = q('#next'); if (pv) pv.onclick = function () { if (S.page > 1) { S.page--; refresh(); } }; if (nx) nx.onclick = function () { if (S.page < pages) { S.page++; refresh(); } };
    renderBulk(R.ids.length);
  }
  function pagerHtml(pages) { return '<div style="display:flex;gap:10px;justify-content:space-between;align-items:center;flex-wrap:wrap"><div class="seg">' + [25, 50, 100].map(function (n) { return '<button class="' + (S.pageSize === n ? 'on' : '') + '" data-ps="' + n + '">' + n + '/pág</button>'; }).join('') + '</div><div style="display:flex;gap:8px;align-items:center"><button class="btn-sm" id="prev"' + (S.page <= 1 ? ' disabled' : '') + '>Anterior</button><span class="footnote" style="margin:0">página ' + S.page + ' de ' + pages + '</span><button class="btn-sm" id="next"' + (S.page >= pages ? ' disabled' : '') + '>Próxima</button></div></div>'; }

  function famName(id) { var f = famById()[id]; return f ? f.name : ''; }
  function famCell(sum) { if (sum === 'none') return '<span class="tag warn">sem família</span>'; if (sum === 'multi') return '<span class="tag info">múltiplas</span>'; if (sum.indexOf('single:') === 0) return '<span class="tag ok">' + esc(famName(sum.slice(7))) + '</span>'; return '—'; }
  function money1(a) { if (a.kind === 'none') return '<span class="tag warn">não informado</span>'; if (a.kind === 'one') return brl(a.v); return brl(a.min) + ' — ' + brl(a.max); }
  function cost1(a) { if (a.kind === 'none') return '—'; if (a.kind === 'one') return brl(a.v) + ' <span class="inh-cost">herdado</span>'; return brl(a.min) + ' — ' + brl(a.max); }

  function renderTable(masters, pageAll) {
    if (!masters.length) return '<div class="empty"><div class="ico">◫</div><p>' + (S.products.length ? 'Nenhum resultado para os filtros atuais.' : 'Catálogo vazio. Clique em “Importar planilha” e envie o arquivo .xlsx da Shopee.') + '</p></div>';
    var body = masters.map(function (m) {
      var p = m.p, a = m.a, shown = m.shown;
      var sel = shown.filter(function (v) { return S.selected.has(v.id); }).length, allSel = shown.length && sel === shown.length, indet = sel > 0 && !allSel, open = S.expanded.has(p.id);
      var range = a.minPrice == null ? '—' : (a.minPrice === a.maxPrice ? brl(a.minPrice) : brl(a.minPrice) + ' — ' + brl(a.maxPrice));
      var master = '<tr class="master-row" data-pid="' + p.id + '">' +
        '<td><input type="checkbox" class="chk chk-m" data-pid="' + p.id + '"' + (allSel ? ' checked' : '') + ' data-indet="' + (indet ? 1 : 0) + '"></td>' +
        '<td><button class="expander" data-exp="' + p.id + '">' + (open ? '▾' : '▸') + '</button></td>' +
        '<td><div class="pname">' + esc(p.name) + (p.status === 'INACTIVE' ? ' <span class="tag">inativo</span>' : '') + '</div><div class="footnote" style="margin:0">' + (p.principalSku ? 'SKU: <span class="mono">' + esc(p.principalSku) + '</span> · ' : '') + 'ID Shopee: <span class="mono">' + esc(p.shopeeProductId) + '</span></div></td>' +
        '<td>' + shown.length + (shown.length < m.all.length ? ' <span class="footnote" style="margin:0">de ' + m.all.length + '</span>' : '') + '</td>' +
        '<td class="cell-fam" data-mfam="' + p.id + '">' + famCell(a.famSummary) + '</td>' +
        '<td>' + range + '</td>' +
        '<td class="cell-close" data-mclose="' + p.id + '">' + money1(a.close) + '</td>' +
        '<td>' + cost1(a.cost) + '</td>' +
        '<td>' + num(a.totalStock) + '</td></tr>';
      var subs = '';
      if (open) {
        subs = '<tr class="subwrap"><td colspan="9" style="padding:0"><table><thead><tr><th style="width:30px"></th><th>Variação</th><th>Família</th><th>Preço Shopee</th><th>Preço Fechamento</th><th>Custo (herdado)</th><th>Estoque</th></tr></thead><tbody>' +
          shown.map(function (v) {
            var f = v.familyId ? famById()[v.familyId] : null;
            return '<tr class="subrow" data-vid="' + v.id + '"><td><input type="checkbox" class="chk chk-v" data-vid="' + v.id + '"' + (S.selected.has(v.id) ? ' checked' : '') + '></td>' +
              '<td class="vname">' + esc(v.variationName || '(única)') + '<div class="footnote" style="margin:0">SKU: <span class="mono">' + esc(v.sku || '—') + '</span></div></td>' +
              '<td class="cell-fam" data-vfam="' + v.id + '">' + (f ? '<span class="tag info">' + esc(f.name) + '</span>' : '<span class="tag warn">sem família</span>') + '</td>' +
              '<td>' + brl(v.shopeeFullPrice) + '</td>' +
              '<td class="cell-close" data-vclose="' + v.id + '">' + (v.closingPrice != null ? brl(v.closingPrice) : '<span class="tag warn">não informado</span>') + '</td>' +
              '<td>' + (f && f.currentCostAmount != null ? brl(f.currentCostAmount) + ' <span class="inh-cost">herdado</span>' : '—') + '</td>' +
              '<td>' + (v.sellerStock == null ? '—' : v.sellerStock) + '</td></tr>';
          }).join('') + '</tbody></table></td></tr>';
      }
      return master + subs;
    }).join('');
    return '<div class="table-wrap"><table><thead><tr><th style="width:30px"><input type="checkbox" class="chk" id="chkPage"' + (pageAll ? ' checked' : '') + '></th><th style="width:26px"></th><th>Produto</th><th>SKUs</th><th>Família</th><th>Preço Shopee</th><th>Preço Fechamento</th><th>Custo</th><th>Estoque</th></tr></thead><tbody>' + body + '</tbody></table></div>';
  }

  function wireResults(masters) {
    app.querySelectorAll('[data-exp]').forEach(function (b) { b.onclick = function () { var id = b.dataset.exp; if (S.expanded.has(id)) S.expanded.delete(id); else S.expanded.add(id); refresh(); }; });
    app.querySelectorAll('.chk-v').forEach(function (c) { c.onchange = function () { if (c.checked) S.selected.add(c.dataset.vid); else S.selected.delete(c.dataset.vid); S.allFiltered = false; refresh(); }; });
    app.querySelectorAll('.chk-m').forEach(function (c) { if (+c.dataset.indet) c.indeterminate = true; c.onchange = function () { var m = masters.find(function (x) { return x.p.id === c.dataset.pid; }); if (m) m.shown.forEach(function (v) { if (c.checked) S.selected.add(v.id); else S.selected.delete(v.id); }); S.allFiltered = false; refresh(); }; });
    var cp = q('#chkPage'); if (cp) cp.onchange = function () { masters.forEach(function (m) { m.shown.forEach(function (v) { if (cp.checked) S.selected.add(v.id); else S.selected.delete(v.id); }); }); S.allFiltered = false; refresh(); };
    // edição inline
    app.querySelectorAll('[data-vfam]').forEach(function (c) { c.onclick = function () { editVarFamily(c, c.dataset.vfam); }; });
    app.querySelectorAll('[data-vclose]').forEach(function (c) { c.onclick = function () { editVarClose(c, c.dataset.vclose); }; });
    app.querySelectorAll('[data-mfam]').forEach(function (c) { c.onclick = function () { editMasterFamily(c, c.dataset.mfam, masters); }; });
    app.querySelectorAll('[data-mclose]').forEach(function (c) { c.onclick = function () { editMasterClose(c, c.dataset.mclose, masters); }; });
  }

  // ---------- edição inline: família da variação ----------
  function editVarFamily(cell, vid) {
    var v = S.variations.find(function (x) { return x.id === vid; }); if (!v) return;
    var actives = S.families.filter(function (f) { return f.status === 'ACTIVE' || f.id === v.familyId; });
    cell.innerHTML = '<select class="select sm inl"><option value="">— sem família —</option>' + actives.map(function (f) { return '<option value="' + f.id + '"' + (v.familyId === f.id ? ' selected' : '') + '>' + esc(f.name) + '</option>'; }).join('') + '</select>';
    var se = cell.querySelector('select'); se.focus();
    se.onchange = function () { v.familyId = se.value || null; saveVars([v]).then(function () { refresh(); toast('Salvo', 'Família da variação atualizada.'); }); };
    se.onkeydown = function (e) { if (e.key === 'Escape') refresh(); };
    se.onblur = function () { setTimeout(function () { if (document.body.contains(se)) refresh(); }, 150); };
  }
  // ---------- edição inline: preço de fechamento da variação ----------
  function editVarClose(cell, vid) {
    var v = S.variations.find(function (x) { return x.id === vid; }); if (!v) return;
    cell.innerHTML = '<input class="input sm inl" style="width:110px" value="' + (v.closingPrice != null ? v.closingPrice : '') + '" placeholder="0,00">';
    var inp = cell.querySelector('input'); inp.focus(); inp.select();
    function commit(next) { v.closingPrice = parseNum(inp.value); saveVars([v]).then(function () { refresh(); toast('Salvo', 'Preço de fechamento atualizado.'); if (next) focusNextClose(vid); }); }
    inp.onkeydown = function (e) { if (e.key === 'Enter') { e.preventDefault(); commit(false); } else if (e.key === 'Tab') { e.preventDefault(); commit(true); } else if (e.key === 'Escape') refresh(); };
    inp.onblur = function () { setTimeout(function () { if (document.body.contains(inp)) commit(false); }, 120); };
  }
  function focusNextClose(vid) { var cells = Array.from(app.querySelectorAll('[data-vclose]')); var i = cells.findIndex(function (c) { return c.dataset.vclose === vid; }); if (i >= 0 && i + 1 < cells.length) editVarClose(cells[i + 1], cells[i + 1].dataset.vclose); }

  // ---------- edição inline: família do master (aplica aos SKUs em contexto) ----------
  function editMasterFamily(cell, pid, masters) {
    var m = masters.find(function (x) { return x.p.id === pid; }); if (!m) return;
    var actives = S.families.filter(function (f) { return f.status === 'ACTIVE'; });
    cell.innerHTML = '<select class="select sm inl"><option value="">— sem família —</option>' + actives.map(function (f) { return '<option value="' + f.id + '">' + esc(f.name) + '</option>'; }).join('') + '</select>';
    var se = cell.querySelector('select'); se.focus();
    se.onkeydown = function (e) { if (e.key === 'Escape') refresh(); };
    se.onchange = function () {
      var fid = se.value || null; var shown = m.shown, mixed = uniq(shown.map(function (v) { return v.familyId || null; }));
      var needConfirm = shown.length > 1 && (mixed.length > 1 || (mixed.length === 1 && mixed[0] !== fid && mixed[0] != null));
      var apply = function () { shown.forEach(function (v) { v.familyId = fid; }); saveVars(shown).then(function () { refresh(); toast('Família aplicada', shown.length + ' SKUs classificados' + (fid ? ' em “' + famName(fid) + '”' : '') + '.'); }); };
      if (needConfirm) confirmModal('Aplicar família a ' + shown.length + ' variações?', 'Este anúncio possui variações com classificações diferentes. Aplicar “' + (fid ? famName(fid) : 'sem família') + '” substituirá as famílias atuais.', apply, refresh);
      else apply();
    };
  }
  // ---------- edição inline: preço de fechamento do master (preenche os SKUs em contexto) ----------
  function editMasterClose(cell, pid, masters) {
    var m = masters.find(function (x) { return x.p.id === pid; }); if (!m) return;
    cell.innerHTML = '<input class="input sm inl" style="width:120px" placeholder="0,00">';
    var inp = cell.querySelector('input'); inp.focus();
    function done() {
      var val = parseNum(inp.value), shown = m.shown, hasIndiv = shown.some(function (v) { return v.closingPrice != null; }) && uniq(shown.map(function (v) { return v.closingPrice == null ? null : v.closingPrice; })).length > 1;
      var apply = function () { shown.forEach(function (v) { v.closingPrice = val; }); saveVars(shown).then(function () { refresh(); toast('Preço aplicado', shown.length + ' SKUs com ' + brl(val) + '.'); }); };
      if (shown.length > 1 && hasIndiv) confirmModal('Aplicar ' + brl(val) + ' a ' + shown.length + ' variações?', 'Existem preços de fechamento individuais neste anúncio. Eles serão substituídos.', apply, refresh);
      else apply();
    }
    inp.onkeydown = function (e) { if (e.key === 'Enter') { e.preventDefault(); done(); } else if (e.key === 'Escape') refresh(); };
    inp.onblur = function () { setTimeout(function () { if (document.body.contains(inp)) refresh(); }, 120); };
  }

  function confirmModal(title, body, onYes, onNo) {
    var o = overlay('<div class="mh"><h3>' + esc(title) + '</h3><button class="x">×</button></div><div class="mbd"><p style="margin-top:0">' + esc(body) + '</p></div><div class="mf"><button class="btn-sm" id="no">Cancelar</button><button class="btn-sm primary" id="yes">Aplicar</button></div>');
    o.querySelector('.x').onclick = o.querySelector('#no').onclick = function () { o.remove(); if (onNo) onNo(); };
    o.querySelector('#yes').onclick = function () { o.remove(); onYes(); };
  }

  // ------------------------------------------------------------ Ações em massa
  function renderBulk(resultCount) {
    var el = q('#bulk'); if (!S.selected.size) { el.innerHTML = ''; return; }
    el.innerHTML = '<div class="bulkbar"><b>' + num(S.selected.size) + ' SKUs selecionados</b><div class="spacer"></div><button class="btn-sm primary" id="bAssign">Classificar família</button><button class="btn-sm" id="bPrice">Preço de fechamento</button><button class="btn-sm" id="bOff">Inativar</button><button class="btn-sm" id="bOn">Ativar</button><button class="btn-sm" id="bClr">Limpar</button></div>';
    q('#bAssign').onclick = openAssign; q('#bPrice').onclick = openBulkPrice; q('#bClr').onclick = function () { S.selected.clear(); S.allFiltered = false; refresh(); };
    q('#bOff').onclick = function () { statusBulk('INACTIVE'); }; q('#bOn').onclick = function () { statusBulk('ACTIVE'); };
  }
  function selIds() { return Array.from(S.selected); }
  function statusBulk(st) { var pset = {}; selIds().forEach(function (id) { var v = S.variations.find(function (x) { return x.id === id; }); if (v) pset[v.productId] = 1; }); var ch = []; S.products.forEach(function (p) { if (pset[p.id]) { p.status = st; ch.push(p); } }); putMany('products', ch).then(function () { S.selected.clear(); S.allFiltered = false; refresh(); toast('Status alterado', 'Anúncios ' + (st === 'ACTIVE' ? 'ativados' : 'inativados') + '.'); }); }

  function openAssign() {
    var ids = selIds(), actives = S.families.filter(function (f) { return f.status === 'ACTIVE'; });
    var o = overlay('<div class="mh"><h3>Classificar família</h3><button class="x">×</button></div><div class="mbd"><p class="footnote" style="margin-top:0"><b>' + ids.length + '</b> SKUs serão alterados.</p><div id="ab"></div></div><div class="mf" id="af"></div>');
    o.querySelector('.x').onclick = function () { o.remove(); };
    var creating = false, chosen = '', sug = null;
    function draw() {
      var body = o.querySelector('#ab'), foot = o.querySelector('#af');
      if (creating) { body.innerHTML = '<div id="qe"></div><label class="fld">Nome da família *</label><input class="input" id="qn" placeholder="Ex.: Quadro 40x60 Premium com Vidro"><div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><div><label class="fld">Código</label><input class="input" id="qc"></div><div><label class="fld">Custo (R$)</label><input class="input" id="qcost" placeholder="0,00"></div></div>'; foot.innerHTML = '<button class="btn-sm" id="qb">Voltar</button><button class="btn-sm primary" id="qcr">Criar e usar</button>'; o.querySelector('#qb').onclick = function () { creating = false; draw(); }; o.querySelector('#qcr').onclick = function () { var n = o.querySelector('#qn').value.trim(); if (!n) { o.querySelector('#qe').innerHTML = '<div class="form-err">Informe o nome.</div>'; return; } createFamily({ name: n, internalCode: o.querySelector('#qc').value.trim(), cost: o.querySelector('#qcost').value }).then(function (f) { creating = false; chosen = f.id; draw(); }); }; return; }
      var cf = S.families.find(function (f) { return f.id === chosen; });
      body.innerHTML = '<label class="fld">Família</label><select class="select" id="fs" style="width:100%"><option value="">— remover família —</option>' + actives.map(function (f) { return '<option value="' + f.id + '"' + (chosen === f.id ? ' selected' : '') + '>' + esc(f.name) + (f.currentCostAmount != null ? ' (' + brl(f.currentCostAmount) + ')' : ' (sem custo)') + '</option>'; }).join('') + '</select><div style="display:flex;gap:12px;margin-top:8px"><button class="link-btn" id="nf">+ Criar nova família</button><button class="link-btn" id="sf">Sugestão automática</button></div>' + (sug ? '<div class="footnote" style="color:var(--info)">' + esc(sug) + '</div>' : '') + (cf ? '<div class="ro" style="margin-top:12px">Custo herdado: <b>' + (cf.currentCostAmount != null ? brl(cf.currentCostAmount) : 'não informado') + '</b></div>' : '');
      foot.innerHTML = '<button class="btn-sm" id="ac">Cancelar</button><button class="btn-sm primary" id="ap">Aplicar a ' + ids.length + ' SKUs</button>';
      o.querySelector('#fs').onchange = function () { chosen = this.value; draw(); }; o.querySelector('#nf').onclick = function () { creating = true; draw(); };
      o.querySelector('#sf').onclick = function () { var s = suggestFor(ids); if (s) { chosen = s.id; sug = 'Sugestão automática: “' + s.name + '” (' + s.n + '/' + ids.length + ' · ' + s.conf + '%). Revise antes de aplicar.'; } else sug = 'Nenhuma sugestão confiável.'; draw(); };
      o.querySelector('#ac').onclick = function () { o.remove(); }; o.querySelector('#ap').onclick = function () { applyFamily(ids, chosen || null); o.remove(); };
    }
    draw();
  }
  function applyFamily(ids, fid) { var ch = []; ids.forEach(function (id) { var v = S.variations.find(function (x) { return x.id === id; }); if (v) { v.familyId = fid; ch.push(v); } }); saveVars(ch).then(function () { S.selected.clear(); S.allFiltered = false; refresh(); toast('Família atribuída', ids.length + ' SKUs' + (fid ? ' em “' + famName(fid) + '”' : '') + '.'); }); }
  function openBulkPrice() {
    var ids = selIds(), o = overlay('<div class="mh"><h3>Preço de fechamento em massa</h3><button class="x">×</button></div><div class="mbd"><p class="footnote" style="margin-top:0"><b>' + ids.length + '</b> SKUs serão alterados. O preço Shopee não muda.</p><label class="fld">Preço de fechamento (R$)</label><input class="input" id="bp" placeholder="0,00"></div><div class="mf"><button class="btn-sm" id="c">Cancelar</button><button class="btn-sm primary" id="ok">Aplicar a ' + ids.length + ' SKUs</button></div>');
    o.querySelector('.x').onclick = o.querySelector('#c').onclick = function () { o.remove(); };
    o.querySelector('#ok').onclick = function () { var val = parseNum(o.querySelector('#bp').value), ch = []; ids.forEach(function (id) { var v = S.variations.find(function (x) { return x.id === id; }); if (v) { v.closingPrice = val; ch.push(v); } }); saveVars(ch).then(function () { S.selected.clear(); S.allFiltered = false; o.remove(); refresh(); toast('Preço aplicado', ids.length + ' SKUs com ' + brl(val) + '.'); }); };
  }

  // ------------------------------------------------------------ Import
  function overlay(html, w) { var o = document.createElement('div'); o.className = 'overlay'; o.innerHTML = '<div class="modal" style="width:' + (w || 520) + 'px">' + html + '</div>'; o.onclick = function (e) { if (e.target === o) o.remove(); }; document.body.appendChild(o); return o; }
  function openImportModal() {
    var o = overlay('<div class="mh"><h3>Importar planilha da Shopee</h3><button class="x">×</button></div><div class="mbd"><div class="dz" id="dz"><div style="font-size:26px;opacity:.4">⭱</div><div class="footnote" id="dzt" style="margin-top:6px">Arraste o arquivo .xlsx ou clique para selecionar</div><input type="file" accept=".xlsx" class="hidden" id="file"></div><div class="footnote">Reimportar sincroniza nome/preço/estoque da Shopee sem duplicar; família, preço de fechamento e custo são preservados.</div><div id="ie"></div></div><div class="mf"><button class="btn-sm" id="c">Cancelar</button><button class="btn-sm primary" id="go" disabled>Importar</button></div>');
    var file = null, dz = o.querySelector('#dz'), inp = o.querySelector('#file');
    o.querySelector('.x').onclick = o.querySelector('#c').onclick = function () { o.remove(); };
    dz.onclick = function () { inp.click(); }; dz.ondragover = function (e) { e.preventDefault(); dz.classList.add('over'); }; dz.ondragleave = function () { dz.classList.remove('over'); }; dz.ondrop = function (e) { e.preventDefault(); dz.classList.remove('over'); file = e.dataTransfer.files[0]; show(); }; inp.onchange = function () { file = inp.files[0]; show(); };
    function show() { if (file) { o.querySelector('#dzt').innerHTML = '<b>' + esc(file.name) + '</b> · ' + (file.size / 1024).toFixed(0) + ' KB'; o.querySelector('#go').disabled = false; } }
    o.querySelector('#go').onclick = function () { var rd = new FileReader(); rd.onload = function () { try { var parsed = P.parseProductSheet(P.toBuffer(rd.result), file.name); if (parsed.notRecognized) { o.querySelector('#ie').innerHTML = '<div class="form-err">Cabeçalho de produtos não encontrado nesta planilha.</div>'; return; } var r0 = parsed.rows; syncRows(r0).then(function (res) { res.filename = file.name; o.remove(); render(); toast(res.errors ? 'Importação concluída com erros' : 'Importação concluída', res.total + ' SKUs processados · ' + (res.newProducts + res.newVariations) + ' novos · ' + res.updated + ' atualizados · ' + res.unchanged + ' sem alteração · ' + res.errors + ' erros', res.errors > 0); }); } catch (e) { o.querySelector('#ie').innerHTML = '<div class="form-err">' + esc(e.message || e) + '</div>'; } }; rd.readAsArrayBuffer(file); };
  }

  // ------------------------------------------------------------ Famílias
  function createFamily(dto) { var cost = parseNum(dto.cost), now = new Date().toISOString(), f = { id: uuid(), name: dto.name, normalizedName: normalize(dto.name), internalCode: dto.internalCode || null, notes: dto.notes || null, status: dto.status || 'ACTIVE', currentCostAmount: cost, currentCostEffectiveFrom: cost != null ? now : null, costUpdatedAt: cost != null ? now : null, costHistory: cost != null ? [{ costAmount: cost, effectiveFrom: now, createdAt: now }] : [] }; S.families.push(f); return putMany('families', [f]).then(function () { return f; }); }
  function updateFamily(f, dto) { var now = new Date().toISOString(); if (dto.name != null) { f.name = dto.name; f.normalizedName = normalize(dto.name); } if (dto.internalCode !== undefined) f.internalCode = dto.internalCode || null; if (dto.notes !== undefined) f.notes = dto.notes || null; if (dto.status) f.status = dto.status; var cost = parseNum(dto.cost); if (cost != null && cost !== f.currentCostAmount) { f.currentCostAmount = cost; f.currentCostEffectiveFrom = now; f.costUpdatedAt = now; f.costHistory = (f.costHistory || []).concat([{ costAmount: cost, effectiveFrom: now, createdAt: now }]); } return putMany('families', [f]); }

  function renderFamilias() {
    app.innerHTML = head('A família é a unidade interna de custo. Vários SKUs apontam para uma família; o custo mora aqui, com histórico.') + tabsHtml('familias') +
      '<div class="page-head" style="margin-top:-6px"><div></div><button class="btn-sm primary" id="nf">+ Nova família</button></div>' +
      '<div class="panel"><div class="pb"><div class="toolbar2"><input class="input sm" id="fq" style="width:260px" placeholder="Buscar família"><select class="select sm" id="fst"><option value="">Todas</option><option value="ACTIVE">Ativas</option><option value="INACTIVE">Inativas</option><option value="NOCOST">Sem custo</option></select></div></div><div class="pb" style="padding:0" id="fl"></div></div>';
    wireTabs(); q('#nf').onclick = function () { familyEditor(null); }; q('#fq').oninput = debounce(drawFam, 180); q('#fst').onchange = drawFam; drawFam();
    function drawFam() {
      var qv = normalize(q('#fq').value), st = q('#fst').value, counts = {}; S.variations.forEach(function (v) { if (v.familyId) counts[v.familyId] = (counts[v.familyId] || 0) + 1; });
      var list = S.families.filter(function (f) { return (!qv || normalize(f.name).indexOf(qv) >= 0) && (st === '' || (st === 'NOCOST' ? f.currentCostAmount == null : f.status === st)); }).sort(function (a, b) { return a.name.localeCompare(b.name); });
      q('#fl').innerHTML = list.length ? '<div class="table-wrap"><table><thead><tr><th>Família</th><th>Código</th><th>Custo atual</th><th>SKUs vinculados</th><th>Status</th><th>Custo atualizado</th><th></th></tr></thead><tbody>' + list.map(function (f) { return '<tr><td><b>' + esc(f.name) + '</b></td><td class="mono">' + esc(f.internalCode || '—') + '</td><td>' + (f.currentCostAmount != null ? brl(f.currentCostAmount) : '<span class="badge b-warn">não informado</span>') + '</td><td>' + (counts[f.id] || 0) + '</td><td><span class="badge ' + (f.status === 'ACTIVE' ? 'b-ok' : 'b-neutral') + '">' + (f.status === 'ACTIVE' ? 'Ativa' : 'Inativa') + '</span></td><td class="footnote" style="margin:0">' + (f.costUpdatedAt ? new Date(f.costUpdatedAt).toLocaleString('pt-BR') : '—') + '</td><td><button class="btn-sm" data-fam="' + f.id + '">Editar</button></td></tr>'; }).join('') + '</tbody></table></div>' : '<div class="empty"><div class="ico">⁘</div><p>Nenhuma família. Crie a primeira para atribuir custo.</p></div>';
      app.querySelectorAll('[data-fam]').forEach(function (b) { b.onclick = function () { familyEditor(S.families.find(function (x) { return x.id === b.dataset.fam; })); }; });
    }
  }
  function familyEditor(fam) {
    var o = overlay('<div class="mh"><h3>' + (fam ? 'Editar família' : 'Nova família') + '</h3><button class="x">×</button></div><div class="mbd" style="max-height:72vh;overflow:auto"><div id="fe"></div><label class="fld">Nome *</label><input class="input" id="fn" value="' + esc(fam ? fam.name : '') + '"><div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><div><label class="fld">Código interno</label><input class="input" id="fc" value="' + esc(fam && fam.internalCode || '') + '"></div><div><label class="fld">Custo (R$)</label><input class="input" id="fcost" value="' + (fam && fam.currentCostAmount != null ? fam.currentCostAmount : '') + '" placeholder="0,00"></div></div><label class="fld">Observações</label><input class="input" id="fnotes" value="' + esc(fam && fam.notes || '') + '"><label class="fld">Status</label><select class="select" id="fss" style="width:100%"><option value="ACTIVE"' + (!fam || fam.status === 'ACTIVE' ? ' selected' : '') + '>Ativa</option><option value="INACTIVE"' + (fam && fam.status === 'INACTIVE' ? ' selected' : '') + '>Inativa</option></select><div class="footnote">Ao alterar o custo, o valor anterior é preservado no histórico e passa a valer para todos os SKUs vinculados.</div>' + (fam && fam.costHistory && fam.costHistory.length ? '<label class="fld">Histórico de custo</label><div class="table-wrap" style="border:1px solid var(--line);border-radius:10px"><table><thead><tr><th>Custo</th><th>Vigente a partir de</th></tr></thead><tbody>' + fam.costHistory.slice().reverse().map(function (h) { return '<tr><td>' + brl(h.costAmount) + '</td><td>' + new Date(h.effectiveFrom).toLocaleString('pt-BR') + '</td></tr>'; }).join('') + '</tbody></table></div>' : '') + '</div><div class="mf"><button class="btn-sm" id="fx">Cancelar</button><button class="btn-sm primary" id="fsv">Salvar</button></div>', 560);
    o.querySelector('.x').onclick = o.querySelector('#fx').onclick = function () { o.remove(); };
    o.querySelector('#fsv').onclick = function () { var n = o.querySelector('#fn').value.trim(); if (!n) { o.querySelector('#fe').innerHTML = '<div class="form-err">Informe o nome.</div>'; return; } var dto = { name: n, internalCode: o.querySelector('#fc').value.trim(), cost: o.querySelector('#fcost').value, notes: o.querySelector('#fnotes').value.trim(), status: o.querySelector('#fss').value }; (fam ? updateFamily(fam, dto) : createFamily(dto)).then(function () { o.remove(); render(); toast(fam ? 'Família atualizada' : 'Família criada', n); }); };
  }

  // ------------------------------------------------------------ Importações
  function renderImportacoes() {
    app.innerHTML = head('Histórico de importações do catálogo Shopee.') + tabsHtml('importacoes') + '<div class="panel"><div class="ph"><h3>Importações de produtos</h3><span class="footnote" style="margin:0">' + S.imports.length + ' importação(ões)</span></div><div class="pb" style="padding:0">' + (S.imports.length ? '<div class="table-wrap"><table><thead><tr><th>Arquivo</th><th>Processados</th><th>Anúncios</th><th>Variações</th><th>Novos</th><th>Atualizados</th><th>Sem alteração</th><th>Erros</th><th>Data</th></tr></thead><tbody>' + S.imports.map(function (b) { return '<tr><td>' + esc(b.filename) + '</td><td>' + b.total + '</td><td>' + b.productsSeen + '</td><td>' + b.variationsSeen + '</td><td>' + (b.newProducts + b.newVariations) + '</td><td>' + b.updated + '</td><td>' + b.unchanged + '</td><td>' + (b.errors ? '<b style="color:var(--err)">' + b.errors + '</b>' : 0) + '</td><td class="footnote" style="margin:0">' + new Date(b.createdAt).toLocaleString('pt-BR') + '</td></tr>'; }).join('') + '</tbody></table></div>' : '<div class="empty"><div class="ico">⭱</div><p>Nenhuma importação ainda.</p></div>') + '</div></div>';
    wireTabs();
  }

  // ------------------------------------------------------------ Boot
  openDB().then(function () { return Promise.all([getAll('products'), getAll('variations'), getAll('families'), getAll('imports')]); }).then(function (r) { S.products = r[0]; S.variations = r[1]; S.families = r[2]; S.imports = r[3].sort(function (a, b) { return b.createdAt.localeCompare(a.createdAt); }); reindex(); render(); }).catch(function (e) { app.innerHTML = '<div class="form-err">Falha ao abrir o banco local: ' + esc(e.message || e) + '</div>'; });
})();
