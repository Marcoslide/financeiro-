/* UI da homologação de produtos. Roda o parser REAL (HomologProdutos) sobre os
 * arquivos soltos, mantendo um catálogo em memória na sessão para demonstrar a
 * sincronização (reimportar não duplica). Nada sai do navegador. */
(function () {
  var H = window.HomologProdutos;
  var dz = document.getElementById('dz');
  var input = document.getElementById('file');
  var results = document.getElementById('results');
  var empty = document.getElementById('empty');
  var resetBtn = document.getElementById('reset');

  var catalog = H.newCatalog();
  var count = 0;

  var brl = function (v) {
    if (v == null) return '—';
    return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  };
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  };

  dz.addEventListener('click', function () { input.click(); });
  dz.addEventListener('dragover', function (e) { e.preventDefault(); dz.classList.add('over'); });
  dz.addEventListener('dragleave', function () { dz.classList.remove('over'); });
  dz.addEventListener('drop', function (e) {
    e.preventDefault();
    dz.classList.remove('over');
    handleFiles(e.dataTransfer.files);
  });
  input.addEventListener('change', function () { handleFiles(input.files); });
  resetBtn.addEventListener('click', function () {
    catalog = H.newCatalog();
    count = 0;
    results.innerHTML = '<div class="empty" id="empty">Nenhuma planilha lida ainda.</div>';
  });

  function handleFiles(list) {
    var files = Array.prototype.slice.call(list || []);
    files.forEach(function (file) {
      var reader = new FileReader();
      reader.onload = function () {
        try {
          renderCard(file, H.toBuffer(reader.result));
        } catch (err) {
          renderError(file, err);
        }
      };
      reader.readAsArrayBuffer(file);
    });
    // permite reselecionar o MESMO arquivo pelo seletor (dispara "change" de novo)
    input.value = '';
  }

  function renderError(file, err) {
    var e = document.getElementById('empty');
    if (e) e.remove();
    var card = document.createElement('div');
    card.className = 'card err';
    card.innerHTML =
      '<div class="ch"><span class="badge b-err">ERRO</span><b>' + esc(file.name) + '</b></div>' +
      '<div class="cb"><div class="note warn">' + esc(err && err.message ? err.message : err) + '</div></div>';
    results.insertBefore(card, results.firstChild);
  }

  function renderCard(file, buffer) {
    var e = document.getElementById('empty');
    if (e) e.remove();

    var parsed = H.parseProductSheet(buffer, file.name);
    count++;

    if (parsed.notRecognized) {
      var card0 = document.createElement('div');
      card0.className = 'card err';
      card0.innerHTML =
        '<div class="ch"><span class="badge b-err">NÃO RECONHECIDO</span><b>' + esc(file.name) + '</b></div>' +
        '<div class="cb"><div class="note warn">Não foi encontrado o cabeçalho da planilha de produtos ' +
        '(colunas “ID do Produto” e “Nome do Produto”). Verifique se é a planilha certa.</div></div>';
      results.insertBefore(card0, results.firstChild);
      return;
    }

    var sync = H.simulateSync(catalog, parsed.rows);
    var snap = H.snapshot(catalog);

    var card = document.createElement('div');
    card.className = 'card';

    var head =
      '<div class="ch"><span class="badge b-info">Importação #' + count + '</span><b>' + esc(file.name) + '</b>' +
      '<span class="muted">' + esc(parsed.format) + ' · ' + (file.size / 1024).toFixed(0) + ' KB</span></div>';

    var kpis =
      '<div class="grid">' +
      kp('Cabeçalho', 'linha ' + (parsed.headerRowIndex == null ? '—' : parsed.headerRowIndex), parsed.columns.length + ' colunas') +
      kp('Início dos dados', 'linha ' + (parsed.dataStartRowIndex == null ? '—' : parsed.dataStartRowIndex), parsed.ignoredRows + ' linha(s) ignorada(s)') +
      kp('Linhas físicas', String(parsed.physicalRowCount), parsed.rows.length + ' linha(s) de dados') +
      kp('Aba', esc(parsed.sheetName || '—'), '') +
      '</div>';

    var counts =
      '<div class="counts">' +
      ct('info', sync.productsSeen, 'anúncios') +
      ct('info', sync.variationsSeen, 'variações') +
      ct('ok', sync.newProducts, 'novos anúncios') +
      ct('ok', sync.newVariations, 'novas variações') +
      ct('warn', sync.updatedRecords, 'atualizados') +
      ct('neutral', sync.unchangedRecords, 'sem alteração') +
      ct(sync.errorRows ? 'err' : 'neutral', sync.errorRows, 'erros') +
      '</div>';

    var dupNote = '';
    if (count > 1 && sync.newProducts === 0 && sync.newVariations === 0) {
      dupNote = '<div class="note ok">✓ Reimportação sem duplicar: nenhum anúncio/variação novo. ' +
        (sync.updatedRecords ? sync.updatedRecords + ' registro(s) sincronizado(s) (estoque/preço).' : 'Tudo já estava atualizado.') +
        ' Família e preço de fechamento são preservados.</div>';
    }

    var errorsBlock = '';
    if (parsed.rows.some(function (r) { return r.error; })) {
      var errs = parsed.rows.filter(function (r) { return r.error; });
      errorsBlock =
        '<details><summary>Ver linhas com erro (' + errs.length + ')</summary>' +
        '<div class="tw"><table><thead><tr><th>Linha</th><th>ID do Produto</th><th>SKU</th><th>Erro</th></tr></thead><tbody>' +
        errs.map(function (r) {
          return '<tr><td>' + r.physicalRowNumber + '</td><td class="mono">' + esc(r.shopeeProductId || '—') +
            '</td><td class="mono">' + esc(r.sku || '—') + '</td><td>' + esc(r.error) + '</td></tr>';
        }).join('') +
        '</tbody></table></div></details>';
    }

    var catBlock = renderCatalog(snap);

    card.innerHTML = head + '<div class="cb">' + kpis + counts + dupNote + errorsBlock + catBlock + '</div>';
    results.insertBefore(card, results.firstChild);
    wireExpanders(card);
  }

  function renderCatalog(snap) {
    if (!snap.length) return '';
    var rows = snap.map(function (p, i) {
      var price = p.priceMin == null ? '—'
        : p.priceMin === p.priceMax ? brl(p.priceMin)
          : brl(p.priceMin) + ' a ' + brl(p.priceMax);
      var head =
        '<tr><td><button class="expand" data-idx="' + i + '">▸</button></td>' +
        '<td><b>' + esc(p.name) + '</b></td>' +
        '<td class="mono">' + esc(p.shopeeProductId) + '</td>' +
        '<td>' + p.variationCount + '</td>' +
        '<td>' + price + '</td></tr>';
      var vars = p.variations.map(function (v) {
        return '<tr class="vrow vr-' + i + '" style="display:none"><td></td><td colspan="4">' +
          '<b>' + esc(v.variationName || '(sem nome)') + '</b> · ' +
          'SKU <span class="mono">' + esc(v.sku || '—') + '</span> · ' +
          'preço cheio ' + brl(v.shopeeFullPrice) + ' · ' +
          'estoque ' + (v.sellerStock == null ? '—' : v.sellerStock) + ' · ' +
          'variante <span class="mono">' + esc(v.shopeeVariationId || '(única)') + '</span>' +
          '</td></tr>';
      }).join('');
      return head + vars;
    }).join('');
    return '<details open><summary>Catálogo acumulado da sessão (' + snap.length + ' anúncio(s))</summary>' +
      '<div class="tw"><table><thead><tr><th></th><th>Produto</th><th>ID do Produto</th><th>Variações</th><th>Preço cheio</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div></details>';
  }

  function wireExpanders(card) {
    var btns = card.querySelectorAll('.expand');
    Array.prototype.forEach.call(btns, function (btn) {
      btn.addEventListener('click', function () {
        var idx = btn.getAttribute('data-idx');
        var open = btn.textContent === '▾';
        btn.textContent = open ? '▸' : '▾';
        var vrows = card.querySelectorAll('.vr-' + idx);
        Array.prototype.forEach.call(vrows, function (tr) {
          tr.style.display = open ? 'none' : 'table-row';
        });
      });
    });
  }

  function kp(l, v, s) {
    return '<div class="kp"><div class="kl">' + esc(l) + '</div><div class="kv">' + esc(v) + '</div>' +
      (s ? '<div class="ks">' + esc(s) + '</div>' : '') + '</div>';
  }
  function ct(kind, v, l) {
    return '<div class="ct ' + kind + '"><div class="cv">' + v + '</div><div class="cl">' + esc(l) + '</div></div>';
  }
})();
