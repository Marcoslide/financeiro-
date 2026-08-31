/*
 * Monta docs/sistema-marketplace.html: o SISTEMA COMPLETO (Produtos, Pedidos,
 * Pós-venda e Inteligência) como um único arquivo offline navegável. Empacota os
 * MESMOS parsers/regras do backend (esbuild + shims), inlina SheetJS e a aplicação
 * (IndexedDB). Na v1.0.2, as mesmas stores são espelhadas por organização no
 * backend para sincronização durável entre Proprietário e subcontas.
 *
 * Uso: node apps/api/scripts/build-sistema-app-html.cjs
 *  (ou) pnpm --filter @financeiro/api build:sistema-app
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const esbuild = require('esbuild');

const ROOT = path.resolve(__dirname, '../../..');
const API = path.resolve(__dirname, '..');
const B = path.join(API, 'src/imports/parsing/browser');
const ENTRY = path.join(API, 'src/all/entry.ts');

function findXlsx() {
  const candidates = [
    path.join(API, 'node_modules/xlsx/dist/xlsx.full.min.js'),
    path.join(ROOT, 'node_modules/xlsx/dist/xlsx.full.min.js'),
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  throw new Error('xlsx.full.min.js não encontrado');
}

const built = esbuild.buildSync({
  entryPoints: [ENTRY],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2019',
  write: false,
  logLevel: 'warning',
  alias: { crypto: path.join(B, 'shim-crypto.js'), xlsx: path.join(B, 'shim-xlsx.js') },
});
const bundle = built.outputFiles[0].text;

const shell = fs.readFileSync(path.join(__dirname, 'sistema-app-shell.html'), 'utf8');
const xlsx = fs.readFileSync(findXlsx(), 'utf8');
let ui = fs.readFileSync(path.join(__dirname, 'sistema-app-ui.js'), 'utf8');

// Prioridade 1 (Rodada 2 da auditoria): window.__qaAudit é um hook só-leitura útil pra auditoria em
// massa, mas não pode existir no build de produção (docs/sistema-marketplace.html, o mesmo arquivo
// publicado pela Vercel). Este projeto não tem build separado por DEV/QA/staging/produção — é um
// único HTML estático montado por este script — então o corte precisa acontecer AQUI, em build-time,
// por variável de ambiente: sem QA_AUDIT_ENABLED=1 explícito, o bloco entre os marcadores é removido
// do texto ANTES de entrar no bundle, então window.__qaAudit fica genuinamente `undefined` (não há
// nenhum código do hook no HTML final pra inspecionar/reativar). Todo build normal (o que gera o
// docs/sistema-marketplace.html commitado) roda sem essa variável.
const QA_AUDIT_ENABLED = process.env.QA_AUDIT_ENABLED === '1';
{
  const startMarker = '/* __QA_AUDIT_HOOK_START__ */';
  const endMarker = '/* __QA_AUDIT_HOOK_END__ */';
  const start = ui.indexOf(startMarker);
  const end = ui.indexOf(endMarker);
  if (start === -1 || end === -1 || end < start) {
    throw new Error('Marcadores __QA_AUDIT_HOOK_START__/END__ não encontrados em sistema-app-ui.js — build abortado pra não publicar o hook por engano.');
  }
  if (QA_AUDIT_ENABLED) {
    console.log('[build-sistema-app] QA_AUDIT_ENABLED=1 — window.__qaAudit INCLUÍDO neste build. NÃO commitar esta saída em docs/sistema-marketplace.html.');
  } else {
    ui = ui.slice(0, start) + ui.slice(end + endMarker.length);
  }
}

// Identificador de build (prompt "Etapa 2 — inserir identificador de build"): mostra no rodapé do
// menu qual commit e em que instante o docs/sistema-marketplace.html atual foi gerado, para o
// usuário comparar direto na tela publicada contra o commit do GitHub — sem precisar acreditar em
// "já corrigi" sem prova visível. Roda no ambiente que gera o arquivo (aqui, local): usa
// VERCEL_GIT_COMMIT_SHA se algum dia a Vercel rodar este script em build próprio; senão o HEAD git
// local — que, como o arquivo gerado é commitado DEPOIS deste build rodar, é o PAI do commit que vai
// carregar este HTML (defasagem de 1 commit é esperada e inofensiva: o objetivo é provar frescor —
// "isso foi gerado agora", não apontar pro próprio hash, que ainda não existe neste instante).
function gitShortSha() {
  try { return execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim(); }
  catch (e) { return null; }
}
function gitFullSha() {
  try { return execSync('git rev-parse HEAD', { cwd: ROOT }).toString().trim(); }
  catch (e) { return null; }
}
const buildSha = process.env.VERCEL_GIT_COMMIT_SHA ? process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 7) : gitShortSha();
const buildShaFull = process.env.VERCEL_GIT_COMMIT_SHA || gitFullSha();
const buildAt = new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
// Congelamento pré-go-live encerrado (certificação concluída) — rótulo de "teste operacional"
// removido do rodapé (era temporário, ver histórico do commit que o introduziu). set TEST_LABEL
// de novo se uma futura rodada de teste operacional precisar do aviso na tela.
const TEST_LABEL = '';
const buildInfo = (TEST_LABEL ? TEST_LABEL + ' · ' : '') + 'build ' + (buildSha || '(sem git)') + ' · ' + buildAt;
// Identificador de versão/observabilidade (go-live, release engineering) — meta tags no <head>
// (ver sistema-app-shell.html) para provar depois, sem precisar de acesso ao servidor, qual commit
// está de fato publicado (comparar com o commit certificado em RELEASE_MANIFEST.json). Nunca um
// segredo — só o hash e um rótulo de versão. APP_RELEASE_VERSION permite ao processo de release
// carimbar a tag oficial (ex.: "v1.0.0-certified"); sem a env var, cai no build-info textual já
// existente (curto, sempre presente).
const appVersion = process.env.APP_RELEASE_VERSION || ('build-' + (buildSha || 'unknown'));

const html = shell
  .replace('<!--XLSX-->', () => '<script>' + xlsx + '\n</script>')
  .replace('<!--BUNDLE-->', () => '<script>' + bundle + '\n</script>')
  .replace('<!--UI-->', () => '<script>' + ui + '\n</script>')
  .replace('<!--BUILDINFO-->', () => buildInfo)
  .replace('__APP_VERSION__', () => appVersion)
  .replace('__GIT_COMMIT__', () => (buildShaFull || 'unknown'));

const out = path.join(ROOT, 'docs/sistema-marketplace.html');
fs.writeFileSync(out, html);
console.log('Gerado', out, '(' + (html.length / 1024).toFixed(0) + ' KB) —', buildInfo);
