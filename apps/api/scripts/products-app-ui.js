/* Módulo Produtos — protótipo autônomo (offline). Usa o MESMO parser do sistema
 * (HomologProdutos.parseProductSheet) e persiste em IndexedDB. Reproduz a
 * interface e as regras do app real: importação idempotente, famílias com custo,
 * classificação em massa, filtros, busca, ordenação, paginação e edição. */
(function () {
  'use strict';
  var P = window.HomologProdutos;

  // ------------------------------------------------------------ IndexedDB
  var DB = null;
  var STORES = ['products', 'variations', 'families', 'imports'];
  function openDB() {
    return new Promise(function (res, rej) {
      var r = indexedDB.open('produtos_shopee', 1);
      r.onupgradeneeded = function () { STORES.forEach(function (s) { if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s, { keyPath: 'id' }); }); };
      r.onsuccess = function () { DB = r.result; res(); };
      r.onerror = function () { rej(r.error); };
    });
  }
  function tx(store, mode) { return DB.transaction(store, mode).objectStore(store); }
  function getAll(store) { return new Promise(function (res) { var out = []; tx(store, 'readonly').openCursor().onsuccess = function (e) { var c = e.target.result; if (c) { out.push(c.value); c.continue(); } else res(out); }; }); }
  function putMany(store, items) { return new Promise(function (res) { if (!items.length) return res(); var t = DB.transaction(store, 'readwrite').objectStore(store); items.forEach(function (i) { t.put(i); }); t.transaction.oncomplete = function () { res(); }; }); }
  function del(store, id) { return new Promise(function (res) { var t = DB.transaction(store, 'readwrite').objectStore(store); t.delete(id); t.transaction.oncomplete = function () { res(); }; }); }
  function clearAll() { return Promise.all(STORES.map(function (s) { return new Promise(function (res) { var t = DB.transaction(s, 'readwrite').objectStore(s); t.clear(); t.transaction.oncomplete = function () { res(); }; }); })); }

  // ------------------------------------------------------------ Estado
  var S = {
    tab: 'produtos',
    products: [], variations: [], families: [], imports: [],
    varByProduct: {},
    filters: { search: '', familyId: '', family: '', closingPrice: '', stock: '', variations: '', status: '', sort: 'name_asc' },
    page: 1, pageSize: 25,
    expanded: new Set(), selected: new Set(), allFiltered: false,
  };

  // ------------------------------------------------------------ Utils
  var brl = function (v) { return v == null ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); };
  var num = function (n) { return Number(n).toLocaleString('pt-BR'); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function normalize(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim(); }
  function parseNum(s) { if (s == null) return null; var t = String(s).replace(/\s|R\$/gi, '').trim(); if (t === '') return null; if (t.indexOf('.') >= 0 && t.indexOf(',') >= 0) t = t.replace(/\./g, '').replace(',', '.'); else if (t.indexOf(',') >= 0) t = t.replace(',', '.'); var n = Number(t); return isFinite(n) ? n : null; }
  function uuid() { return (crypto.randomUUID ? crypto.randomUUID() : 'f' + Date.now() + Math.random().toString(16).slice(2)); }
  function toast(title, body, err) { var el = document.createElement('div'); el.className = 'toast' + (err ? ' err' : ''); el.innerHTML = '<div class="tt">' + esc(title) + '</div><div>' + esc(body) + '</div>'; document.body.appendChild(el); setTimeout(function () { el.remove(); }, 6000); }
  var debTimer = null; function debounce(fn, ms) { return function () { clearTimeout(debTimer); debTimer = setTimeout(fn, ms); }; }

  function reindex() { S.varByProduct = {}; S.variations.forEach(function (v) { (S.varByProduct[v.productId] = S.varByProduct[v.productId] || []).push(v); }); }

  // ------------------------------------------------------------ Sincronização (upsert idempotente)
  function syncRows(rows) {
    var now = new Date().toISOString();
    var errors = rows.filter(function (r) { return r.error; }).length;
    var valid = rows.filter(function (r) { return !r.error && r.shopeeProductId; });
    var prodById = {}; S.products.forEach(function (p) { prodById[p.id] = p; });
    var varById = {}; S.variations.forEach(function (v) { varById[v.id] = v; });
    var nameById = {}; valid.forEach(function (r) { if (nameById[r.shopeeProductId] == null && r.productName) nameById[r.shopeeProductId] = r.productName; });

    var res = { productsSeen: 0, variationsSeen: 0, newProducts: 0, newVariations: 0, updated: 0, unchanged: 0, errors: errors, total: rows.length };
    var seenProducts = {}, lastRowByKey = {};
    valid.forEach(function (r) { seenProducts[r.shopeeProductId] = 1; lastRowByKey[r.shopeeProductId + '::' + r.variationKey] = r; });
    res.productsSeen = Object.keys(seenProducts).length;

    var changedProducts = [], changedVars = [];
    Object.keys(seenProducts).forEach(function (pid) {
      var name = nameById[pid] || pid, ex = prodById[pid];
      if (!ex) { var p = { id: pid, shopeeProductId: pid, name: name, status: 'ACTIVE', firstSeenAt: now, lastSeenAt: now }; prodById[pid] = p; S.products.push(p); changedProducts.push(p); res.newProducts++; }
      else { ex.lastSeenAt = now; if (ex.name !== name) { ex.name = name; res.updated++; } changedProducts.push(ex); }
    });
    Object.keys(lastRowByKey).forEach(function (key) {
      var r = lastRowByKey[key]; res.variationsSeen++;
      var id = r.shopeeProductId + '::' + r.variationKey, ex = varById[id];
      var price = r.shopeeFullPrice == null ? null : Number(r.shopeeFullPrice);
      if (!ex) {
        var v = { id: id, productId: r.shopeeProductId, shopeeVariationId: r.shopeeVariationId || '', variationKey: r.variationKey, variationName: r.variationName, sku: r.sku, referenceSku: r.referenceSku, gtin: r.gtin, shopeeFullPrice: price, sellerStock: r.sellerStock, failReason: r.failReason, familyId: null, closingPrice: null, internalNotes: null, firstSeenAt: now, lastSeenAt: now };
        varById[id] = v; S.variations.push(v); changedVars.push(v); res.newVariations++;
      } else {
        var chg = ex.variationName !== r.variationName || ex.sku !== r.sku || ex.referenceSku !== r.referenceSku || ex.gtin !== r.gtin || ex.sellerStock !== r.sellerStock || ex.failReason !== r.failReason || (ex.shopeeFullPrice == null ? null : Number(ex.shopeeFullPrice)) !== price;
        ex.lastSeenAt = now;
        if (chg) { ex.variationName = r.variationName; ex.sku = r.sku; ex.referenceSku = r.referenceSku; ex.gtin = r.gtin; ex.shopeeFullPrice = price; ex.sellerStock = r.sellerStock; ex.failReason = r.failReason; ex.shopeeVariationId = r.shopeeVariationId || ''; res.updated++; }
        else res.unchanged++;
        changedVars.push(ex);
      }
    });
    reindex();
    return Promise.all([putMany('products', changedProducts), putMany('variations', changedVars)]).then(function () {
      var batch = { id: uuid(), createdAt: now, filename: res.filename || 'planilha.xlsx', total: res.total, productsSeen: res.productsSeen, variationsSeen: res.variationsSeen, newProducts: res.newProducts, newVariations: res.newVariations, updated: res.updated, unchanged: res.unchanged, errors: res.errors };
      S.imports.unshift(batch);
      return putMany('imports', [batch]).then(function () { return res; });
    });
  }

  // ------------------------------------------------------------ Agregados por anúncio
  function agg(p) {
    var vs = S.varByProduct[p.id] || [];
    var prices = vs.map(function (v) { return v.shopeeFullPrice; }).filter(function (n) { return n != null; });
    var fams = {}; vs.forEach(function (v) { if (v.familyId) fams[v.familyId] = 1; });
    var famCount = Object.keys(fams).length;
    return {
      variations: vs, variationCount: vs.length,
      totalStock: vs.reduce(function (s, v) { return s + (v.sellerStock || 0); }, 0),
      minPrice: prices.length ? Math.min.apply(null, prices) : null,
      maxPrice: prices.length ? Math.max.apply(null, prices) : null,
      withoutFamily: vs.filter(function (v) { return !v.familyId; }).length,
      withoutClosing: vs.filter(function (v) { return v.closingPrice == null; }).length,
      familySummary: famCount === 0 ? 'none' : (vs.every(function (v) { return v.familyId; }) && famCount === 1 ? 'single' : 'multiple'),
    };
  }

  function stats() {
    return {
      products: S.products.length, variations: S.variations.length,
      withoutFamily: S.variations.filter(function (v) { return !v.familyId; }).length,
      withoutClosing: S.variations.filter(function (v) { return v.closingPrice == null; }).length,
      families: S.families.length,
    };
  }

  // ------------------------------------------------------------ Filtro/ordenação
  function computeList() {
    var f = S.filters, q = normalize(f.search);
    var famName = {}; S.families.forEach(function (fm) { famName[fm.id] = fm; });
    var rows = S.products.map(function (p) { return { p: p, a: agg(p) }; });
    var filtered = rows.filter(function (r) {
      var p = r.p, a = r.a, vs = a.variations;
      if (q) {
        var hit = normalize(p.name).indexOf(q) >= 0 || String(p.shopeeProductId).indexOf(q) >= 0 ||
          vs.some(function (v) { return normalize(v.sku).indexOf(q) >= 0 || normalize(v.variationName).indexOf(q) >= 0 || String(v.shopeeVariationId).indexOf(q) >= 0; });
        if (!hit) return false;
      }
      if (f.familyId && !vs.some(function (v) { return v.familyId === f.familyId; })) return false;
      if (f.family === 'with' && !vs.some(function (v) { return v.familyId; })) return false;
      if (f.family === 'without' && !vs.some(function (v) { return !v.familyId; })) return false;
      if (f.closingPrice === 'with' && !vs.some(function (v) { return v.closingPrice != null; })) return false;
      if (f.closingPrice === 'without' && !vs.some(function (v) { return v.closingPrice == null; })) return false;
      if (f.stock === 'with' && !vs.some(function (v) { return (v.sellerStock || 0) > 0; })) return false;
      if (f.stock === 'zero' && !vs.some(function (v) { return v.sellerStock === 0; })) return false;
      if (f.stock === 'without' && vs.some(function (v) { return (v.sellerStock || 0) > 0; })) return false;
      if (f.variations === 'single' && a.variationCount !== 1) return false;
      if (f.variations === 'multiple' && a.variationCount <= 1) return false;
      if (f.status && p.status !== f.status) return false;
      return true;
    });
    var cmp = {
      name_asc: function (a, b) { return a.p.name.localeCompare(b.p.name); },
      name_desc: function (a, b) { return b.p.name.localeCompare(a.p.name); },
      stock_desc: function (a, b) { return b.a.totalStock - a.a.totalStock; },
      stock_asc: function (a, b) { return a.a.totalStock - b.a.totalStock; },
      price_desc: function (a, b) { return (b.a.maxPrice || 0) - (a.a.maxPrice || 0); },
      price_asc: function (a, b) { return (a.a.minPrice || 1e15) - (b.a.minPrice || 1e15); },
      variations_desc: function (a, b) { return b.a.variationCount - a.a.variationCount; },
      variations_asc: function (a, b) { return a.a.variationCount - b.a.variationCount; },
      without_family: function (a, b) { return b.a.withoutFamily - a.a.withoutFamily; },
      without_closing: function (a, b) { return b.a.withoutClosing - a.a.withoutClosing; },
    }[f.sort] || cmpName;
    function cmpName(a, b) { return a.p.name.localeCompare(b.p.name); }
    filtered.sort(cmp);
    var matchedVars = 0;
    filtered.forEach(function (r) {
      r.a.variations.forEach(function (v) {
        if (!q) { matchedVars++; return; }
        if (normalize(r.p.name).indexOf(q) >= 0 || String(r.p.shopeeProductId).indexOf(q) >= 0 || normalize(v.sku).indexOf(q) >= 0 || normalize(v.variationName).indexOf(q) >= 0 || String(v.shopeeVariationId).indexOf(q) >= 0) matchedVars++;
      });
    });
    return { filtered: filtered, matchedVars: matchedVars, famName: famName };
  }

  function filteredVariationIds() {
    return computeList().filtered.reduce(function (acc, r) { r.a.variations.forEach(function (v) { acc.push(v.id); }); return acc; }, []);
  }

  // ------------------------------------------------------------ Sugestão de família (heurística)
  var STOP = { de: 1, do: 1, da: 1, com: 1, sem: 1, para: 1, e: 1, o: 1, a: 1, em: 1, kit: 1, un: 1, modelo: 1 };
  function tokset(s) { var out = {}; normalize(s).split(/[^a-z0-9]+/).forEach(function (t) { if (t.length >= 2 && !STOP[t]) out[t] = 1; }); return out; }
  function suggestFor(variationIds) {
    var fams = S.families.filter(function (f) { return f.status === 'ACTIVE'; }).map(function (f) { return { f: f, t: tokset(f.name) }; });
    var counts = {};
    variationIds.slice(0, 400).forEach(function (id) {
      var v = S.variations.find(function (x) { return x.id === id; }); if (!v) return;
      var p = S.products.find(function (x) { return x.id === v.productId; });
      var vt = tokset((p ? p.name : '') + ' ' + (v.variationName || '') + ' ' + (v.sku || ''));
      var vk = Object.keys(vt), best = null;
      fams.forEach(function (fm) {
        var fk = Object.keys(fm.t); if (!fk.length) return;
        var inter = fk.filter(function (t) { return vt[t]; }).length; if (!inter) return;
        var uni = fk.length + vk.length - inter;
        var sizeBonus = fk.some(function (t) { return /^\d{1,3}x\d{1,3}$/.test(t) && vt[t]; }) ? 0.25 : 0;
        var conf = Math.min(1, inter / uni + sizeBonus);
        if (!best || conf > best.conf) best = { id: fm.f.id, name: fm.f.name, conf: conf };
      });
      if (best && best.conf >= 0.34) { var c = counts[best.id] || { name: best.name, n: 0, conf: 0 }; c.n++; c.conf = Math.max(c.conf, best.conf); counts[best.id] = c; }
    });
    var arr = Object.keys(counts).map(function (id) { return { id: id, name: counts[id].name, n: counts[id].n, conf: Math.round(counts[id].conf * 100) }; });
    arr.sort(function (a, b) { return b.n - a.n; });
    return arr[0] || null;
  }

  // ------------------------------------------------------------ Render principal
  var app = document.getElementById('app');
  function render() {
    if (S.tab === 'produtos') renderProdutos();
    else if (S.tab === 'familias') renderFamilias();
    else renderImportacoes();
  }
  function tabsHtml(active) {
    return '<div class="tabs">' +
      ['produtos:Produtos', 'familias:Famílias', 'importacoes:Importações'].map(function (t) {
        var k = t.split(':')[0]; return '<div class="tab ' + (active === k ? 'active' : '') + '" data-tab="' + k + '">' + t.split(':')[1] + '</div>';
      }).join('') + '</div>';
  }
  function head(sub) { return '<div class="page-head"><div><h2>Produtos</h2><p>' + sub + '</p></div></div>'; }

  function renderProdutos() {
    var s = stats();
    var last = S.imports[0];
    app.innerHTML = head('Catálogo Shopee: anúncios, variações/SKUs, famílias e custos.') + tabsHtml('produtos') +
      (S.products.length === 0 ? '<div class="seedbar"><b>Comece por aqui:</b> importe a planilha .xlsx da Shopee no botão “Importar planilha”, ou <button class="link-btn" id="seed">gerar uma base de exemplo (1.000 anúncios / ~5.000 SKUs)</button> para testar.</div>' : '') +
      '<div class="importbar"><div><div class="ib-title">Atualizar catálogo Shopee</div><div class="ib-meta">' +
        (last ? 'Última atualização: ' + new Date(last.createdAt).toLocaleString('pt-BR') + ' · ' : '') + num(s.products) + ' anúncios · ' + num(s.variations) + ' variações</div></div>' +
        '<div class="spacer"></div><button class="link-btn" id="goImports">Ver histórico</button><button class="btn-sm primary" id="openImport">Importar planilha</button></div>' +
      '<div class="kpi-grid">' +
        kpi('Anúncios', num(s.products), 'k-all') + kpi('Variações / SKUs', num(s.variations), 'k-all') +
        kpi('SKUs sem família', num(s.withoutFamily), 'k-nofam', s.withoutFamily > 0) +
        kpi('SKUs sem preço de fechamento', num(s.withoutClosing), 'k-noclose', s.withoutClosing > 0) + '</div>' +
      '<div class="panel"><div class="pb">' + toolbarHtml() + '<div id="countline"></div><div id="selbanner"></div></div>' +
        '<div class="pb" style="padding:0"><div id="results"></div></div><div class="pb" id="pager"></div></div>' +
      '<div id="bulk"></div>';
    // wire estáticos
    q('#openImport').onclick = openImportModal;
    q('#goImports').onclick = function () { S.tab = 'importacoes'; render(); };
    var seed = q('#seed'); if (seed) seed.onclick = doSeed;
    app.querySelectorAll('.tab').forEach(function (t) { t.onclick = function () { S.tab = t.dataset.tab; render(); }; });
    app.querySelectorAll('.kpi.clickable').forEach(function (k) { k.onclick = function () { onKpi(k.dataset.k); }; });
    wireToolbar();
    refresh();
  }
  function kpi(label, val, k, warn) { return '<div class="kpi clickable ' + (isKpiOn(k) ? 'on' : '') + '" data-k="' + k + '"><div class="lbl">' + label + '</div><div class="val" style="' + (warn ? 'color:var(--warn)' : '') + '">' + val + '</div></div>'; }
  function isKpiOn(k) { return (k === 'k-nofam' && S.filters.family === 'without') || (k === 'k-noclose' && S.filters.closingPrice === 'without'); }
  function onKpi(k) {
    if (k === 'k-all') S.filters = { search: '', familyId: '', family: '', closingPrice: '', stock: '', variations: '', status: '', sort: 'name_asc' };
    else if (k === 'k-nofam') { S.filters.family = 'without'; S.filters.closingPrice = ''; S.filters.familyId = ''; S.filters.sort = 'without_family'; }
    else if (k === 'k-noclose') { S.filters.closingPrice = 'without'; S.filters.family = ''; S.filters.sort = 'without_closing'; }
    S.page = 1; S.allFiltered = false; var si = q('#search'); if (si) si.value = S.filters.search; syncFilterInputs(); render();
  }

  function toolbarHtml() {
    var f = S.filters;
    function sel(id, val, opts) { return '<select class="select sm" data-f="' + id + '">' + opts.map(function (o) { return '<option value="' + o[0] + '"' + (val === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select>'; }
    var famOpts = [['', 'Família: todas']].concat(S.families.map(function (fm) { return [fm.id, fm.name]; }));
    return '<div class="toolbar2">' +
      '<input class="input sm" id="search" style="width:260px" placeholder="Buscar produto, SKU ou ID…" value="' + esc(f.search) + '">' +
      sel('familyId', f.familyId, famOpts) +
      sel('family', f.family, [['', 'Classificação: todos'], ['with', 'Com família'], ['without', 'Sem família']]) +
      sel('closingPrice', f.closingPrice, [['', 'Preço fechamento: todos'], ['with', 'Configurado'], ['without', 'Não configurado']]) +
      sel('stock', f.stock, [['', 'Estoque: todos'], ['with', 'Com estoque'], ['without', 'Sem estoque'], ['zero', 'Estoque zerado']]) +
      sel('variations', f.variations, [['', 'Variações: todas'], ['single', 'Sem variação'], ['multiple', 'Com variações']]) +
      sel('status', f.status, [['', 'Status: todos'], ['ACTIVE', 'Ativo'], ['INACTIVE', 'Inativo']]) +
      sel('sort', f.sort, [['name_asc', 'Nome A–Z'], ['name_desc', 'Nome Z–A'], ['stock_desc', 'Maior estoque'], ['stock_asc', 'Menor estoque'], ['price_desc', 'Maior preço'], ['price_asc', 'Menor preço'], ['variations_desc', 'Mais variações'], ['variations_asc', 'Menos variações'], ['without_family', 'Sem família primeiro'], ['without_closing', 'Sem fechamento primeiro']]) +
      '<button class="link-btn" id="clearF">Limpar filtros</button></div>';
  }
  function wireToolbar() {
    var si = q('#search'); si.oninput = debounce(function () { S.filters.search = si.value; S.page = 1; S.allFiltered = false; refresh(); }, 250);
    app.querySelectorAll('select[data-f]').forEach(function (se) { se.onchange = function () { var k = se.dataset.f; S.filters[k] = se.value; if (k === 'familyId' && se.value) S.filters.family = ''; if (k === 'family') S.filters.familyId = ''; S.page = 1; S.allFiltered = false; syncFilterInputs(); refresh(); }; });
    q('#clearF').onclick = function () { S.filters = { search: '', familyId: '', family: '', closingPrice: '', stock: '', variations: '', status: '', sort: 'name_asc' }; S.page = 1; S.allFiltered = false; q('#search').value = ''; syncFilterInputs(); refresh(); };
  }
  function syncFilterInputs() { app.querySelectorAll('select[data-f]').forEach(function (se) { se.value = S.filters[se.dataset.f]; }); }

  function refresh() {
    var r = computeList(), s = stats();
    var totalP = r.filtered.length;
    var pages = Math.max(1, Math.ceil(totalP / S.pageSize));
    if (S.page > pages) S.page = pages;
    var pageRows = r.filtered.slice((S.page - 1) * S.pageSize, S.page * S.pageSize);
    var pageVarIds = pageRows.reduce(function (a, x) { x.a.variations.forEach(function (v) { a.push(v.id); }); return a; }, []);
    var pageAllSel = pageVarIds.length > 0 && pageVarIds.every(function (id) { return S.selected.has(id); });
    // KPIs on-state
    app.querySelectorAll('.kpi.clickable').forEach(function (k) { k.classList.toggle('on', isKpiOn(k.dataset.k)); });
    // count line
    var filteredView = JSON.stringify(S.filters) !== JSON.stringify({ search: '', familyId: '', family: '', closingPrice: '', stock: '', variations: '', status: '', sort: 'name_asc' });
    q('#countline').className = 'count-line';
    q('#countline').innerHTML = (filteredView ? '<b>' + num(totalP) + '</b> de ' + num(s.products) + ' anúncios' : '<b>' + num(totalP) + '</b> anúncios') +
      ' · <b>' + num(r.matchedVars) + '</b> variações/SKUs correspondentes · <button class="link-btn" id="expAll">Expandir todos</button> / <button class="link-btn" id="colAll">Recolher todos</button>';
    q('#expAll').onclick = function () { pageRows.forEach(function (x) { S.expanded.add(x.p.id); }); refresh(); };
    q('#colAll').onclick = function () { S.expanded.clear(); refresh(); };
    // banner
    var sb = q('#selbanner'); sb.innerHTML = '';
    if (S.allFiltered) sb.innerHTML = '<div class="selbanner"><span>Todos os ' + num(S.selected.size) + ' SKUs encontrados estão selecionados.</span><button class="link-btn" id="clrSel">Limpar seleção</button></div>';
    else if (pageAllSel && totalP > pageRows.length) sb.innerHTML = '<div class="selbanner"><span>Os ' + pageVarIds.length + ' SKUs desta página estão selecionados.</span><button class="link-btn" id="selAllF">Selecionar todos os ' + num(r.matchedVars) + ' SKUs encontrados</button></div>';
    var b1 = q('#clrSel'); if (b1) b1.onclick = function () { S.selected.clear(); S.allFiltered = false; refresh(); };
    var b2 = q('#selAllF'); if (b2) b2.onclick = function () { filteredVariationIds().forEach(function (id) { S.selected.add(id); }); S.allFiltered = true; refresh(); };
    // results
    q('#results').innerHTML = renderTable(pageRows, pageAllSel, r.famName);
    wireResults();
    // pager
    q('#pager').innerHTML = '<div style="display:flex;gap:10px;justify-content:space-between;align-items:center;flex-wrap:wrap">' +
      '<div class="seg">' + [25, 50, 100].map(function (n) { return '<button class="' + (S.pageSize === n ? 'on' : '') + '" data-ps="' + n + '">' + n + '/pág</button>'; }).join('') + '</div>' +
      '<div style="display:flex;gap:8px;align-items:center"><button class="btn-sm" id="prev"' + (S.page <= 1 ? ' disabled' : '') + '>Anterior</button>' +
      '<span class="footnote" style="margin:0">página ' + S.page + ' de ' + pages + '</span>' +
      '<button class="btn-sm" id="next"' + (S.page >= pages ? ' disabled' : '') + '>Próxima</button></div></div>';
    app.querySelectorAll('[data-ps]').forEach(function (bt) { bt.onclick = function () { S.pageSize = +bt.dataset.ps; S.page = 1; refresh(); }; });
    q('#prev').onclick = function () { if (S.page > 1) { S.page--; refresh(); } };
    q('#next').onclick = function () { if (S.page < pages) { S.page++; refresh(); } };
    // bulk
    renderBulk();
  }

  function renderTable(rows, pageAllSel, famName) {
    if (!rows.length) return '<div class="empty"><div class="ico">◫</div><p>Nenhum produto encontrado. Importe a planilha ou ajuste os filtros.</p></div>';
    var body = rows.map(function (x) {
      var p = x.p, a = x.a, sel = a.variations.filter(function (v) { return S.selected.has(v.id); }).length;
      var allSel = a.variations.length && sel === a.variations.length, indet = sel > 0 && !allSel;
      var open = S.expanded.has(p.id);
      var range = a.minPrice == null ? '—' : (a.minPrice === a.maxPrice ? brl(a.minPrice) : brl(a.minPrice) + ' — ' + brl(a.maxPrice));
      var famBadge = a.familySummary === 'none' ? '<span class="tag warn">sem família</span>' : a.familySummary === 'single' ? '<span class="tag ok">família única</span>' : '<span class="tag info">múltiplas famílias</span>';
      var master = '<tr class="master-row">' +
        '<td><input type="checkbox" class="chk chk-m" data-pid="' + p.id + '"' + (allSel ? ' checked' : '') + ' data-indet="' + (indet ? 1 : 0) + '"></td>' +
        '<td><button class="expander" data-exp="' + p.id + '">' + (open ? '▾' : '▸') + '</button></td>' +
        '<td><span class="pname">' + esc(p.name) + '</span>' + (p.status === 'INACTIVE' ? ' <span class="tag">inativo</span>' : '') + '</td>' +
        '<td class="mono">' + esc(p.shopeeProductId) + '</td><td>' + a.variationCount + '</td><td>' + range + '</td><td>' + num(a.totalStock) + '</td>' +
        '<td>' + famBadge + (a.withoutFamily ? ' <span class="tag warn">' + a.withoutFamily + ' s/ família</span>' : '') + (a.withoutClosing ? ' <span class="tag">' + a.withoutClosing + ' s/ fechamento</span>' : '') + '</td>' +
        '<td><button class="btn-sm" data-exp="' + p.id + '">' + (open ? 'Recolher' : 'Ver SKUs') + '</button></td></tr>';
      var subs = '';
      if (open) {
        subs = '<tr><td colspan="9" style="padding:0"><table><thead><tr><th style="width:30px"></th><th>Variação</th><th>SKU</th><th>Família</th><th>Preço Shopee</th><th>Preço Fechamento</th><th>Custo (herdado)</th><th>Estoque</th><th></th></tr></thead><tbody>' +
          a.variations.map(function (v) {
            var fam = v.familyId ? famName[v.familyId] : null;
            var q = normalize(S.filters.search), matched = q && (normalize(v.sku).indexOf(q) >= 0 || normalize(v.variationName).indexOf(q) >= 0 || String(v.shopeeVariationId).indexOf(q) >= 0);
            return '<tr class="subrow' + (matched ? ' matched' : '') + '">' +
              '<td><input type="checkbox" class="chk chk-v" data-vid="' + v.id + '"' + (S.selected.has(v.id) ? ' checked' : '') + '></td>' +
              '<td class="vname">' + esc(v.variationName || '(única)') + '</td>' +
              '<td class="mono">' + esc(v.sku || '—') + '</td>' +
              '<td>' + (fam ? '<span class="tag info">' + esc(fam.name) + '</span>' : '<span class="tag warn">sem família</span>') + '</td>' +
              '<td>' + brl(v.shopeeFullPrice) + '</td>' +
              '<td>' + (v.closingPrice != null ? brl(v.closingPrice) : '<span class="tag warn">não informado</span>') + '</td>' +
              '<td>' + (fam && fam.currentCostAmount != null ? brl(fam.currentCostAmount) + ' <span class="inh-cost">herdado</span>' : '—') + '</td>' +
              '<td>' + (v.sellerStock == null ? '—' : v.sellerStock) + '</td>' +
              '<td><button class="btn-sm" data-edit="' + v.id + '">Editar</button></td></tr>';
          }).join('') + '</tbody></table></td></tr>';
      }
      return master + subs;
    }).join('');
    return '<div class="table-wrap"><table><thead><tr>' +
      '<th style="width:30px"><input type="checkbox" class="chk" id="chkPage"' + (pageAllSel ? ' checked' : '') + '></th><th style="width:26px"></th><th>Produto</th><th>ID Shopee</th><th>Variações</th><th>Faixa de preço</th><th>Estoque</th><th>Parametrização</th><th></th>' +
      '</tr></thead><tbody>' + body + '</tbody></table></div>';
  }

  function wireResults() {
    app.querySelectorAll('[data-exp]').forEach(function (b) { b.onclick = function () { var id = b.dataset.exp; if (S.expanded.has(id)) S.expanded.delete(id); else S.expanded.add(id); refresh(); }; });
    app.querySelectorAll('.chk-v').forEach(function (c) { c.onchange = function () { var id = c.dataset.vid; if (c.checked) S.selected.add(id); else S.selected.delete(id); S.allFiltered = false; refresh(); }; });
    app.querySelectorAll('.chk-m').forEach(function (c) { if (+c.dataset.indet) c.indeterminate = true; c.onchange = function () { var pid = c.dataset.pid; (S.varByProduct[pid] || []).forEach(function (v) { if (c.checked) S.selected.add(v.id); else S.selected.delete(v.id); }); S.allFiltered = false; refresh(); }; });
    var cp = q('#chkPage'); if (cp) cp.onchange = function () { var r = computeList(); var pageRows = r.filtered.slice((S.page - 1) * S.pageSize, S.page * S.pageSize); pageRows.forEach(function (x) { x.a.variations.forEach(function (v) { if (cp.checked) S.selected.add(v.id); else S.selected.delete(v.id); }); }); S.allFiltered = false; refresh(); };
    app.querySelectorAll('[data-edit]').forEach(function (b) { b.onclick = function () { openEdit(b.dataset.edit); }; });
  }

  function renderBulk() {
    var el = q('#bulk'); if (!S.selected.size) { el.innerHTML = ''; return; }
    el.innerHTML = '<div class="bulkbar"><b>' + num(S.selected.size) + ' variação(ões) selecionada(s)</b><div class="spacer"></div>' +
      '<button class="btn-sm primary" id="bAssign">Atribuir família</button><button class="btn-sm" id="bPrice">Definir preço de fechamento</button>' +
      '<button class="btn-sm" id="bOff">Inativar</button><button class="btn-sm" id="bOn">Ativar</button><button class="btn-sm" id="bClr">Limpar</button></div>';
    q('#bAssign').onclick = openAssign; q('#bPrice').onclick = openBulkPrice;
    q('#bClr').onclick = function () { S.selected.clear(); S.allFiltered = false; refresh(); };
    q('#bOff').onclick = function () { setStatusBulk('INACTIVE'); }; q('#bOn').onclick = function () { setStatusBulk('ACTIVE'); };
  }

  function selectedIds() { return Array.from(S.selected); }
  function affectedProducts(ids) { var s = {}; ids.forEach(function (id) { var v = S.variations.find(function (x) { return x.id === id; }); if (v) s[v.productId] = 1; }); return Object.keys(s); }

  function setStatusBulk(st) {
    var pids = affectedProducts(selectedIds()), changed = [];
    S.products.forEach(function (p) { if (pids.indexOf(p.id) >= 0) { p.status = st; changed.push(p); } });
    putMany('products', changed).then(function () { S.selected.clear(); S.allFiltered = false; refresh(); toast('Status alterado', 'Anúncios ' + (st === 'ACTIVE' ? 'ativados' : 'inativados') + '.'); });
  }

  // ------------------------------------------------------------ Modais
  function overlay(html, width) { var o = document.createElement('div'); o.className = 'overlay'; o.innerHTML = '<div class="modal" style="width:' + (width || 520) + 'px">' + html + '</div>'; o.onclick = function (e) { if (e.target === o) o.remove(); }; document.body.appendChild(o); return o; }

  function openImportModal() {
    var o = overlay('<div class="mh"><h3>Importar planilha da Shopee</h3><button class="x">×</button></div><div class="mbd"><div class="dz" id="dz"><div style="font-size:26px;opacity:.4">⭱</div><div class="footnote" id="dzt" style="margin-top:6px">Arraste o arquivo .xlsx ou clique para selecionar</div><input type="file" accept=".xlsx" class="hidden" id="file"></div><div class="footnote">Reimportar sincroniza preço e estoque sem duplicar; família e preço de fechamento são preservados.</div><div id="ierr"></div></div><div class="mf"><button class="btn-sm" id="cancel">Cancelar</button><button class="btn-sm primary" id="go" disabled>Importar</button></div>');
    var file = null, dz = o.querySelector('#dz'), inp = o.querySelector('#file');
    o.querySelector('.x').onclick = o.querySelector('#cancel').onclick = function () { o.remove(); };
    dz.onclick = function () { inp.click(); };
    dz.ondragover = function (e) { e.preventDefault(); dz.classList.add('over'); }; dz.ondragleave = function () { dz.classList.remove('over'); };
    dz.ondrop = function (e) { e.preventDefault(); dz.classList.remove('over'); file = e.dataTransfer.files[0]; show(); };
    inp.onchange = function () { file = inp.files[0]; show(); };
    function show() { if (file) { o.querySelector('#dzt').innerHTML = '<b>' + esc(file.name) + '</b> · ' + (file.size / 1024).toFixed(0) + ' KB'; o.querySelector('#go').disabled = false; } }
    o.querySelector('#go').onclick = function () {
      var rd = new FileReader(); rd.onload = function () {
        try {
          var parsed = P.parseProductSheet(P.toBuffer(rd.result), file.name);
          if (parsed.notRecognized) { o.querySelector('#ierr').innerHTML = '<div class="form-err">Cabeçalho de produtos não encontrado nesta planilha.</div>'; return; }
          syncRows(parsed.rows.map(function (r) { return r; })).then(function (res) { res.filename = file.name; o.remove(); render(); toast(res.errors ? 'Importação concluída com erros' : 'Importação concluída', res.total + ' variações processadas · ' + (res.newProducts + res.newVariations) + ' novas · ' + res.updated + ' atualizadas · ' + res.unchanged + ' sem alteração · ' + res.errors + ' erros', res.errors > 0); });
        } catch (e) { o.querySelector('#ierr').innerHTML = '<div class="form-err">' + esc(e.message || e) + '</div>'; }
      }; rd.readAsArrayBuffer(file);
    };
  }

  function openAssign() {
    var ids = selectedIds();
    var actives = S.families.filter(function (f) { return f.status === 'ACTIVE'; });
    var o = overlay('<div class="mh"><h3>Atribuir família</h3><button class="x">×</button></div><div class="mbd">' +
      '<p class="footnote" style="margin-top:0">Você está atribuindo esta família a <b>' + ids.length + '</b> variação(ões).</p>' +
      '<div id="assignBody"></div></div><div class="mf" id="assignFoot"></div>');
    o.querySelector('.x').onclick = function () { o.remove(); };
    var creating = false, chosenSug = null;
    function draw() {
      var body = o.querySelector('#assignBody'), foot = o.querySelector('#assignFoot');
      if (creating) {
        body.innerHTML = '<div id="qerr"></div><label class="fld">Nome da família *</label><input class="input" id="qname" placeholder="Ex.: Quadro 40x60 Premium com Vidro">' +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><div><label class="fld">Código interno</label><input class="input" id="qcode"></div><div><label class="fld">Custo (R$)</label><input class="input" id="qcost" placeholder="0,00"></div></div>' +
          '<label class="fld">Observação</label><input class="input" id="qnotes">';
        foot.innerHTML = '<button class="btn-sm" id="qback">Voltar</button><button class="btn-sm primary" id="qcreate">Criar e usar</button>';
        o.querySelector('#qback').onclick = function () { creating = false; draw(); };
        o.querySelector('#qcreate').onclick = function () {
          var name = o.querySelector('#qname').value.trim(); if (!name) { o.querySelector('#qerr').innerHTML = '<div class="form-err">Informe o nome.</div>'; return; }
          createFamily({ name: name, internalCode: o.querySelector('#qcode').value.trim(), cost: o.querySelector('#qcost').value, notes: o.querySelector('#qnotes').value.trim() }).then(function (f) { creating = false; chosen = f.id; draw(); });
        };
        return;
      }
      var opts = '<option value="">— remover família —</option>' + actives.concat(S.families.filter(function (f) { return f.status !== 'ACTIVE'; })).filter(function (f, i, arr) { return arr.indexOf(f) === i; }).map(function (f) { return '<option value="' + f.id + '"' + (chosen === f.id ? ' selected' : '') + '>' + esc(f.name) + (f.currentCostAmount != null ? ' (' + brl(f.currentCostAmount) + ')' : ' (sem custo)') + '</option>'; }).join('');
      var cf = S.families.find(function (f) { return f.id === chosen; });
      body.innerHTML = '<label class="fld">Família</label><select class="select" id="famsel" style="width:100%">' + opts + '</select>' +
        '<div style="display:flex;gap:12px;margin-top:8px;align-items:center"><button class="link-btn" id="newFam">+ Criar nova família</button><button class="link-btn" id="sugFam">Sugerir família (heurística)</button></div>' +
        (chosenSug ? '<div class="footnote" style="color:var(--info)">' + esc(chosenSug) + '</div>' : '') +
        (cf ? '<div class="ro" style="margin-top:12px">Custo herdado: <b>' + (cf.currentCostAmount != null ? brl(cf.currentCostAmount) : 'não informado') + '</b></div>' : '');
      foot.innerHTML = '<button class="btn-sm" id="acancel">Cancelar</button><button class="btn-sm primary" id="aapply">Aplicar a ' + ids.length + ' SKUs</button>';
      o.querySelector('#famsel').onchange = function () { chosen = this.value; draw(); };
      o.querySelector('#newFam').onclick = function () { creating = true; draw(); };
      o.querySelector('#sugFam').onclick = function () { var s = suggestFor(ids); if (s) { chosen = s.id; chosenSug = 'Sugestão: “' + s.name + '” (' + s.n + '/' + ids.length + ' SKUs · confiança ' + s.conf + '%)'; } else chosenSug = 'Nenhuma sugestão confiável.'; draw(); };
      o.querySelector('#acancel').onclick = function () { o.remove(); };
      o.querySelector('#aapply').onclick = function () { applyFamily(ids, chosen || null); o.remove(); };
    }
    var chosen = '';
    draw();
  }

  function applyFamily(ids, familyId) {
    var changed = []; ids.forEach(function (id) { var v = S.variations.find(function (x) { return x.id === id; }); if (v) { v.familyId = familyId; changed.push(v); } });
    putMany('variations', changed).then(function () { S.selected.clear(); S.allFiltered = false; refresh(); var f = S.families.find(function (x) { return x.id === familyId; }); toast('Família atribuída', ids.length + ' SKUs vinculados' + (f ? ' a “' + f.name + '”' : '') + '.'); });
  }

  function openBulkPrice() {
    var ids = selectedIds();
    var o = overlay('<div class="mh"><h3>Preço de fechamento em massa</h3><button class="x">×</button></div><div class="mbd"><p class="footnote" style="margin-top:0">Aplicar a <b>' + ids.length + '</b> variação(ões). O preço Shopee não é alterado.</p><label class="fld">Preço de fechamento (R$)</label><input class="input" id="bp" placeholder="0,00"></div><div class="mf"><button class="btn-sm" id="c">Cancelar</button><button class="btn-sm primary" id="ok">Aplicar</button></div>');
    o.querySelector('.x').onclick = o.querySelector('#c').onclick = function () { o.remove(); };
    o.querySelector('#ok').onclick = function () { var val = parseNum(o.querySelector('#bp').value); var changed = []; ids.forEach(function (id) { var v = S.variations.find(function (x) { return x.id === id; }); if (v) { v.closingPrice = val; changed.push(v); } }); putMany('variations', changed).then(function () { S.selected.clear(); S.allFiltered = false; o.remove(); refresh(); toast('Preço de fechamento definido', 'Aplicado a ' + ids.length + ' variação(ões).'); }); };
  }

  function openEdit(vid) {
    var v = S.variations.find(function (x) { return x.id === vid; }); if (!v) return;
    var p = S.products.find(function (x) { return x.id === v.productId; });
    var actives = S.families.filter(function (f) { return f.status === 'ACTIVE' || f.id === v.familyId; });
    var d = document.createElement('div'); d.className = 'drawer';
    d.innerHTML = '<div class="drawer-panel"><div class="dh"><h3 style="margin:0;font-size:16px">Editar variação</h3><button class="x">×</button></div><div class="dbd">' +
      '<label class="fld">Produto master</label><div class="ro">' + esc(p ? p.name : '') + '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><div><label class="fld">Variação</label><div class="ro">' + esc(v.variationName || '(única)') + '</div></div><div><label class="fld">SKU</label><div class="ro mono">' + esc(v.sku || '—') + '</div></div></div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><div><label class="fld">ID variação Shopee</label><div class="ro mono">' + esc(v.shopeeVariationId || '(única)') + '</div></div><div><label class="fld">Estoque Shopee</label><div class="ro">' + (v.sellerStock == null ? '—' : v.sellerStock) + '</div></div></div>' +
      '<label class="fld">Preço Shopee (importado)</label><div class="ro">' + brl(v.shopeeFullPrice) + '</div>' +
      '<label class="fld">Preço de fechamento (nosso)</label><input class="input" id="ecp" placeholder="Não informado" value="' + (v.closingPrice != null ? v.closingPrice : '') + '">' +
      '<label class="fld">Família</label><select class="select" id="efam" style="width:100%"><option value="">— sem família —</option>' + actives.map(function (f) { return '<option value="' + f.id + '"' + (v.familyId === f.id ? ' selected' : '') + '>' + esc(f.name) + '</option>'; }).join('') + '</select>' +
      '<label class="fld">Custo (herdado da família)</label><div class="ro" id="ecost"></div>' +
      '</div><div class="df"><button class="btn-sm" id="ecancel">Cancelar</button><button class="btn-sm primary" id="esave">Salvar</button></div></div>';
    d.onclick = function (e) { if (e.target === d) d.remove(); };
    document.body.appendChild(d);
    function cost() { var fid = d.querySelector('#efam').value, f = S.families.find(function (x) { return x.id === fid; }); d.querySelector('#ecost').innerHTML = f && f.currentCostAmount != null ? '<b>' + brl(f.currentCostAmount) + '</b> <span class="inh-cost">— herdado de “' + esc(f.name) + '”</span>' : '<span class="inh-cost">o custo vem da família; selecione uma família com custo</span>'; }
    cost(); d.querySelector('#efam').onchange = cost;
    d.querySelector('.x').onclick = d.querySelector('#ecancel').onclick = function () { d.remove(); };
    d.querySelector('#esave').onclick = function () { v.closingPrice = parseNum(d.querySelector('#ecp').value); v.familyId = d.querySelector('#efam').value || null; putMany('variations', [v]).then(function () { d.remove(); refresh(); toast('Variação atualizada', 'Alterações salvas.'); }); };
  }

  // ------------------------------------------------------------ Famílias
  function createFamily(dto) {
    var cost = parseNum(dto.cost), now = new Date().toISOString();
    var f = { id: uuid(), name: dto.name, normalizedName: normalize(dto.name), internalCode: dto.internalCode || null, notes: dto.notes || null, status: dto.status || 'ACTIVE', currentCostAmount: cost, currentCostEffectiveFrom: cost != null ? now : null, costUpdatedAt: cost != null ? now : null, costHistory: cost != null ? [{ costAmount: cost, effectiveFrom: now, createdAt: now }] : [] };
    S.families.push(f); return putMany('families', [f]).then(function () { return f; });
  }
  function updateFamily(f, dto) {
    var now = new Date().toISOString();
    if (dto.name != null) { f.name = dto.name; f.normalizedName = normalize(dto.name); }
    if (dto.internalCode !== undefined) f.internalCode = dto.internalCode || null;
    if (dto.notes !== undefined) f.notes = dto.notes || null;
    if (dto.status) f.status = dto.status;
    var cost = parseNum(dto.cost);
    if (cost != null && cost !== f.currentCostAmount) { f.currentCostAmount = cost; f.currentCostEffectiveFrom = now; f.costUpdatedAt = now; f.costHistory = (f.costHistory || []).concat([{ costAmount: cost, effectiveFrom: now, createdAt: now }]); }
    return putMany('families', [f]);
  }

  function renderFamilias() {
    app.innerHTML = head('A família é a unidade interna de custo. Vários SKUs apontam para uma família; o custo mora aqui, com histórico.') + tabsHtml('familias') +
      '<div class="page-head" style="margin-top:-6px"><div></div><button class="btn-sm primary" id="newFam">+ Nova família</button></div>' +
      '<div class="panel"><div class="pb"><div class="toolbar2"><input class="input sm" id="fsearch" style="width:260px" placeholder="Buscar família"><select class="select sm" id="fstatus"><option value="">Todas</option><option value="ACTIVE">Ativas</option><option value="INACTIVE">Inativas</option><option value="NOCOST">Sem custo</option></select></div></div><div class="pb" style="padding:0" id="famlist"></div></div>';
    app.querySelectorAll('.tab').forEach(function (t) { t.onclick = function () { S.tab = t.dataset.tab; render(); }; });
    q('#newFam').onclick = function () { openFamilyEditor(null); };
    q('#fsearch').oninput = debounce(drawFam, 200); q('#fstatus').onchange = drawFam;
    drawFam();
    function drawFam() {
      var qv = normalize(q('#fsearch').value), st = q('#fstatus').value;
      var counts = {}; S.variations.forEach(function (v) { if (v.familyId) counts[v.familyId] = (counts[v.familyId] || 0) + 1; });
      var list = S.families.filter(function (f) { return (!qv || normalize(f.name).indexOf(qv) >= 0) && (st === '' || (st === 'NOCOST' ? f.currentCostAmount == null : f.status === st)); }).sort(function (a, b) { return a.name.localeCompare(b.name); });
      q('#famlist').innerHTML = list.length === 0 ? '<div class="empty"><div class="ico">⁘</div><p>Nenhuma família. Crie a primeira para atribuir custo.</p></div>' :
        '<div class="table-wrap"><table><thead><tr><th>Família</th><th>Código</th><th>Custo atual</th><th>SKUs vinculados</th><th>Status</th><th>Custo atualizado</th><th></th></tr></thead><tbody>' +
        list.map(function (f) { return '<tr><td><b>' + esc(f.name) + '</b></td><td class="mono">' + esc(f.internalCode || '—') + '</td><td>' + (f.currentCostAmount != null ? brl(f.currentCostAmount) : '<span class="badge b-warn">não informado</span>') + '</td><td>' + (counts[f.id] || 0) + '</td><td><span class="badge ' + (f.status === 'ACTIVE' ? 'b-ok' : 'b-neutral') + '">' + (f.status === 'ACTIVE' ? 'Ativa' : 'Inativa') + '</span></td><td class="footnote" style="margin:0">' + (f.costUpdatedAt ? new Date(f.costUpdatedAt).toLocaleString('pt-BR') : '—') + '</td><td><button class="btn-sm" data-fam="' + f.id + '">Editar</button></td></tr>'; }).join('') + '</tbody></table></div>';
      app.querySelectorAll('[data-fam]').forEach(function (b) { b.onclick = function () { openFamilyEditor(S.families.find(function (x) { return x.id === b.dataset.fam; })); }; });
    }
  }

  function openFamilyEditor(fam) {
    var o = overlay('<div class="mh"><h3>' + (fam ? 'Editar família' : 'Nova família') + '</h3><button class="x">×</button></div><div class="mbd" style="max-height:72vh;overflow:auto">' +
      '<div id="ferr"></div><label class="fld">Nome da família *</label><input class="input" id="fn" value="' + esc(fam ? fam.name : '') + '" placeholder="Ex.: Quadro 40x60 Premium Sem Vidro">' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><div><label class="fld">Código interno</label><input class="input" id="fc" value="' + esc(fam && fam.internalCode || '') + '"></div><div><label class="fld">Custo (R$)</label><input class="input" id="fcost" value="' + (fam && fam.currentCostAmount != null ? fam.currentCostAmount : '') + '" placeholder="0,00"></div></div>' +
      '<label class="fld">Observações</label><input class="input" id="fnotes" value="' + esc(fam && fam.notes || '') + '">' +
      '<label class="fld">Status</label><select class="select" id="fst" style="width:100%"><option value="ACTIVE"' + (!fam || fam.status === 'ACTIVE' ? ' selected' : '') + '>Ativa</option><option value="INACTIVE"' + (fam && fam.status === 'INACTIVE' ? ' selected' : '') + '>Inativa</option></select>' +
      '<div class="footnote">Ao alterar o custo, o valor anterior é preservado no histórico.</div>' +
      (fam && fam.costHistory && fam.costHistory.length ? '<label class="fld">Histórico de custo</label><div class="table-wrap" style="border:1px solid var(--line);border-radius:10px"><table><thead><tr><th>Custo</th><th>Vigente a partir de</th></tr></thead><tbody>' + fam.costHistory.slice().reverse().map(function (h) { return '<tr><td>' + brl(h.costAmount) + '</td><td>' + new Date(h.effectiveFrom).toLocaleString('pt-BR') + '</td></tr>'; }).join('') + '</tbody></table></div>' : '') +
      '</div><div class="mf"><button class="btn-sm" id="fcancel">Cancelar</button><button class="btn-sm primary" id="fsave">Salvar</button></div>', 560);
    o.querySelector('.x').onclick = o.querySelector('#fcancel').onclick = function () { o.remove(); };
    o.querySelector('#fsave').onclick = function () {
      var name = o.querySelector('#fn').value.trim(); if (!name) { o.querySelector('#ferr').innerHTML = '<div class="form-err">Informe o nome.</div>'; return; }
      var dto = { name: name, internalCode: o.querySelector('#fc').value.trim(), cost: o.querySelector('#fcost').value, notes: o.querySelector('#fnotes').value.trim(), status: o.querySelector('#fst').value };
      (fam ? updateFamily(fam, dto) : createFamily(dto)).then(function () { o.remove(); render(); toast(fam ? 'Família atualizada' : 'Família criada', name); });
    };
  }

  // ------------------------------------------------------------ Importações
  function renderImportacoes() {
    app.innerHTML = head('Histórico de importações do catálogo Shopee.') + tabsHtml('importacoes') +
      '<div class="panel"><div class="ph"><h3>Importações de produtos</h3><span class="footnote" style="margin:0">' + S.imports.length + ' importação(ões)</span></div><div class="pb" style="padding:0">' +
      (S.imports.length === 0 ? '<div class="empty"><div class="ico">⭱</div><p>Nenhuma importação ainda.</p></div>' :
        '<div class="table-wrap"><table><thead><tr><th>Arquivo</th><th>Processados</th><th>Anúncios</th><th>Variações</th><th>Novos</th><th>Atualizados</th><th>Sem alteração</th><th>Erros</th><th>Data</th></tr></thead><tbody>' +
        S.imports.map(function (b) { return '<tr><td>' + esc(b.filename) + '</td><td>' + b.total + '</td><td>' + b.productsSeen + '</td><td>' + b.variationsSeen + '</td><td>' + (b.newProducts + b.newVariations) + '</td><td>' + b.updated + '</td><td>' + b.unchanged + '</td><td>' + (b.errors ? '<b style="color:var(--err)">' + b.errors + '</b>' : 0) + '</td><td class="footnote" style="margin:0">' + new Date(b.createdAt).toLocaleString('pt-BR') + '</td></tr>'; }).join('') + '</tbody></table></div>') +
      '</div></div>';
    app.querySelectorAll('.tab').forEach(function (t) { t.onclick = function () { S.tab = t.dataset.tab; render(); }; });
  }

  // ------------------------------------------------------------ Base de exemplo
  function doSeed() {
    var SIZES = ['40x60', '50x70', '60x90', '30x40', '20x30'], COLORS = ['Preto', 'Branco', 'Freijó', 'Dourado', 'Cinza', 'Natural'], LINES = ['Quadro Decorativo', 'Kit Quadros', 'Mandala', 'Poster Retrô', 'Painel', 'Quadro Abstrato', 'Placa Decorativa', 'Quadro Paisagem'];
    var factor = { '20x30': 0.7, '30x40': 0.85, '40x60': 1, '50x70': 1.35, '60x90': 1.9 };
    var rows = [], vari = 0, prod = 0, id = 4300000001;
    while (vari < 5016 && prod < 1004) {
      var line = LINES[prod % LINES.length]; var name = line + ' Modelo ' + (100 + prod); var pid = String(id++); prod++;
      var base = 79 + (prod % 50), nS = 1 + (prod % 3), nC = 1 + (prod % 4);
      for (var s = 0; s < nS && vari < 5016; s++) { var sz = SIZES[(prod + s) % SIZES.length]; for (var c = 0; c < nC && vari < 5016; c++) { var color = COLORS[(prod + c) % COLORS.length]; vari++; rows.push({ physicalRowNumber: vari, shopeeProductId: pid, productName: name, shopeeVariationId: String(9000000 + vari), variationKey: 'vid:' + (9000000 + vari), variationName: color + ' · ' + sz, referenceSku: null, sku: 'SKU-' + pid.slice(-4) + '-' + sz + '-' + color.slice(0, 2).toUpperCase(), gtin: String(7890000000000 + vari), shopeeFullPrice: (base * factor[sz]).toFixed(2), sellerStock: (vari * 7) % 120, failReason: null, error: null }); } }
    }
    syncRows(rows).then(function (res) { res.filename = 'base-exemplo.xlsx'; render(); toast('Base de exemplo carregada', res.newProducts + ' anúncios · ' + res.newVariations + ' variações.'); });
  }

  function q(sel) { return app.querySelector(sel) || document.querySelector(sel); }

  // ------------------------------------------------------------ Boot
  openDB().then(function () {
    return Promise.all([getAll('products'), getAll('variations'), getAll('families'), getAll('imports')]);
  }).then(function (r) {
    S.products = r[0]; S.variations = r[1]; S.families = r[2]; S.imports = r[3].sort(function (a, b) { return b.createdAt.localeCompare(a.createdAt); });
    reindex(); render();
  }).catch(function (e) { app.innerHTML = '<div class="form-err">Falha ao abrir o banco local: ' + esc(e.message || e) + '</div>'; });
})();
