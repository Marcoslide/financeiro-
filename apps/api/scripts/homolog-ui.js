/* UI da ferramenta de homologação (roda o importador REAL, 100% local). */
(function () {
  var H = window.Homolog;
  if (!H) {
    document.body.innerHTML = '<p style="padding:24px">Falha ao carregar o motor de leitura.</p>';
    return;
  }
  var REPORT_LABELS = H.REPORT_TYPE_LABELS;
  var EXPECTED = {
    ORDERS: 64, ORDER_CANCELLATION: 60, FAILED_DELIVERY: 59, RETURN_REFUND: 46,
    WALLET_TRANSACTION: 9, SHOPEE_ACELERA: 15, AFFILIATE_COMMISSION: 41, AFFILIATE_PERFORMANCE: 11,
  };

  // "Livro" de identidade em memória (mesma lógica do servidor) para demonstrar
  // deduplicação ao arrastar o mesmo arquivo / períodos sobrepostos duas vezes.
  var ledgerHash = new Set();
  var ledgerNatural = new Set();
  var seenFiles = new Set();

  var results = document.getElementById('results');
  var empty = document.getElementById('empty');

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }
  function pct(x) { return Math.round(x * 100) + '%'; }

  function badge(text, cls) { return '<span class="badge ' + cls + '">' + esc(text) + '</span>'; }

  function processOne(file) {
    return new Promise(function (resolve) {
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var buf = H.toBuffer(reader.result);
          var parsed = H.parseFile(buf, file.name);
          var fileHashSeen = false;
          var imported = 0, dup = 0, updated = 0, errors = 0, warnings = 0;
          var errSamples = [];
          if (parsed.spec) {
            for (var i = 0; i < parsed.dataRows.length; i++) {
              var pr = H.processRow(parsed.spec, parsed.dataRows[i]);
              var rowErr = pr.normalized.issues.filter(function (x) { return x.severity === 'ERROR'; });
              var rowWarn = pr.normalized.issues.filter(function (x) { return x.severity !== 'ERROR'; });
              if (rowErr.length) { errors++; if (errSamples.length < 6) errSamples.push('linha ' + parsed.dataRows[i].physicalRowNumber + ': ' + rowErr[0].message); continue; }
              var kh = parsed.reportType + '|' + pr.canonicalHash;
              if (ledgerHash.has(kh)) { dup++; }
              else {
                ledgerHash.add(kh);
                var kn = parsed.reportType + '|' + pr.normalized.naturalKey;
                if (ledgerNatural.has(kn)) updated++; else imported++;
                ledgerNatural.add(kn);
              }
              if (rowWarn.length) warnings++;
            }
          }
          var analysis = H.buildAnalysis(parsed, seenFiles.has(analysisHashOf(parsed)));
          if (seenFiles.has(analysisHashOf(parsed))) fileHashSeen = true;
          seenFiles.add(analysisHashOf(parsed));
          renderCard(file, parsed, analysis, { imported: imported, dup: dup, updated: updated, errors: errors, warnings: warnings, errSamples: errSamples, fileHashSeen: fileHashSeen });
        } catch (e) {
          renderError(file, e);
        }
        resolve();
      };
      reader.readAsArrayBuffer(file);
    });
  }
  function analysisHashOf(parsed) { return parsed.fileHash; }

  function renderError(file, e) {
    if (empty) empty.style.display = 'none';
    var div = document.createElement('div');
    div.className = 'card err';
    div.innerHTML = '<div class="ch"><b>' + esc(file.name) + '</b> ' + badge('não lido', 'b-err') + '</div>' +
      '<div class="cb"><div class="muted">Não foi possível ler o arquivo: ' + esc(e && e.message ? e.message : e) + '</div></div>';
    results.insertBefore(div, results.firstChild);
  }

  function renderCard(file, parsed, analysis, r) {
    if (empty) empty.style.display = 'none';
    var type = parsed.reportType;
    var label = REPORT_LABELS[type] || type;
    var unknown = type === 'UNKNOWN';
    var exp = EXPECTED[type];
    var colWarn = exp && parsed.columns.length !== exp;

    var issues = (analysis.issues || []).map(function (is) {
      var cls = is.severity === 'ERROR' ? 'b-err' : is.severity === 'WARNING' ? 'b-warn' : 'b-info';
      return '<div class="issue">' + badge(is.severity, cls) + ' <span>' + esc(is.message) + '</span></div>';
    }).join('');

    var cols = analysis.previewRows.length ? Object.keys(analysis.previewRows[0]).slice(0, 7) : [];
    var thead = cols.map(function (c) { return '<th>' + esc(c) + '</th>'; }).join('');
    var rows = analysis.previewRows.slice(0, 6).map(function (row) {
      return '<tr>' + cols.map(function (c) { return '<td class="mono">' + esc(row[c]) + '</td>'; }).join('') + '</tr>';
    }).join('');

    var errList = r.errSamples.length ? '<details><summary>' + r.errors + ' linha(s) com erro</summary><ul>' +
      r.errSamples.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ul></details>' : '';

    var status = unknown ? badge('tipo não identificado', 'b-warn')
      : r.errors ? badge('lido com ' + r.errors + ' erro(s)', 'b-warn')
      : badge('lido', 'b-ok');

    var div = document.createElement('div');
    div.className = 'card';
    div.innerHTML =
      '<div class="ch"><b>' + esc(file.name) + '</b> ' + status +
      (r.fileHashSeen ? ' ' + badge('arquivo já visto nesta sessão', 'b-neutral') : '') + '</div>' +
      '<div class="cb">' +
        '<div class="grid">' +
          kpi('Relatório', label + (parsed.detection && parsed.detection.usedFilenameHint ? ' ⤷nome' : ''), 'confiança ' + pct(parsed.confidence)) +
          kpi('Formato real', parsed.format, 'ext .' + esc(parsed.declaredExtension) + (parsed.extensionMismatch ? ' (divergente)' : '')) +
          kpi('Cabeçalho', 'linha ' + (parsed.headerRowIndex == null ? '—' : parsed.headerRowIndex), parsed.columns.length + ' colunas' + (exp ? ' (esp. ' + exp + ')' : '')) +
          kpi('Linhas', parsed.dataRows.length + ' de dados', parsed.physicalRowCount + ' físicas') +
        '</div>' +
        '<div class="counts">' +
          count('Importadas', r.imported, 'ok') + count('Duplicadas', r.dup, '') +
          count('Atualizadas', r.updated, 'info') + count('Com alerta', r.warnings, 'warn') +
          count('Com erro', r.errors, r.errors ? 'err' : '') +
        '</div>' +
        (colWarn ? '<div class="note warn">Colunas (' + parsed.columns.length + ') diferem do esperado pela inspeção (' + exp + '). O importador preserva todas as colunas que existirem.</div>' : '') +
        (issues ? '<div class="issues">' + issues + '</div>' : '') +
        errList +
        (rows ? '<div class="prev"><div class="muted">Prévia</div><div class="tw"><table><thead><tr>' + thead + '</tr></thead><tbody>' + rows + '</tbody></table></div></div>' : '') +
        '<div class="hash muted">período ' + esc(analysis.periodStart ? analysis.periodStart.slice(0, 10) : '—') + ' → ' + esc(analysis.periodEnd ? analysis.periodEnd.slice(0, 10) : '—') + ' · hash ' + esc(analysis.fileHash.slice(0, 16)) + '…</div>' +
      '</div>';
    results.insertBefore(div, results.firstChild);
  }

  function kpi(l, v, s) { return '<div class="kp"><div class="kl">' + esc(l) + '</div><div class="kv">' + esc(v) + '</div><div class="ks">' + esc(s) + '</div></div>'; }
  function count(l, v, cls) { return '<div class="ct ' + cls + '"><div class="cv">' + v + '</div><div class="cl">' + esc(l) + '</div></div>'; }

  // ---- drag & drop / seleção ----
  var dz = document.getElementById('dz');
  var input = document.getElementById('file');
  dz.addEventListener('click', function () { input.click(); });
  dz.addEventListener('dragover', function (e) { e.preventDefault(); dz.classList.add('over'); });
  dz.addEventListener('dragleave', function () { dz.classList.remove('over'); });
  dz.addEventListener('drop', function (e) { e.preventDefault(); dz.classList.remove('over'); handle(e.dataTransfer.files); });
  input.addEventListener('change', function () { handle(input.files); input.value = ''; });
  document.getElementById('reset').addEventListener('click', function () {
    ledgerHash.clear(); ledgerNatural.clear(); seenFiles.clear();
    results.innerHTML = ''; if (empty) { results.appendChild(empty); empty.style.display = ''; }
  });

  function handle(files) {
    var arr = Array.prototype.slice.call(files);
    (function next(i) { if (i >= arr.length) return; processOne(arr[i]).then(function () { next(i + 1); }); })(0);
  }
})();
