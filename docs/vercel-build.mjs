// Script de build usado SOMENTE pelo deploy Vercel. Copia sistema-marketplace.html
// tal como está no repositório para a pasta de saída e insere um selo discreto de
// build (commit real do Vercel, nunca inventado) antes de </body> — a mesma técnica
// já usada no deploy do GitHub Pages. Não altera o arquivo do repositório.
import fs from 'node:fs';

const commit = process.env.VERCEL_GIT_COMMIT_SHA || 'unknown';
const short = commit.slice(0, 7);
const deployedAt = new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';

const OUT = '.vercel-output';
fs.mkdirSync(OUT, { recursive: true });

const src = fs.readFileSync('sistema-marketplace.html', 'utf8');
if (!src.includes('</body>')) {
  throw new Error('</body> não encontrado em sistema-marketplace.html');
}
const badge =
  '<div id="__staging_build_badge" style="position:fixed;right:8px;bottom:8px;' +
  'z-index:999999;background:rgba(16,26,51,.85);color:#fff;' +
  'font:11px system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;' +
  'padding:4px 9px;border-radius:6px;opacity:.85;pointer-events:none">' +
  `STAGING &middot; Build ${short} &middot; ${deployedAt}</div></body>`;
const withBadge = src.replace('</body>', badge);

fs.writeFileSync(`${OUT}/index.html`, withBadge);
fs.writeFileSync(`${OUT}/sistema-marketplace.html`, withBadge);
fs.writeFileSync(
  `${OUT}/BUILD.txt`,
  `commit=${commit}\ncommit_short=${short}\ndeployed_at=${deployedAt}\n`
);

console.log(`Build OK — commit=${short} deployed_at=${deployedAt}`);
