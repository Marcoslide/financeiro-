/*
 * Monta docs/sistema-marketplace.html: o SISTEMA COMPLETO (Produtos, Pedidos,
 * Pós-venda e Inteligência) como um único arquivo offline navegável. Empacota os
 * MESMOS parsers/regras do backend (esbuild + shims), inlina SheetJS e a aplicação
 * (IndexedDB). Nenhum dado sai do navegador.
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
const ui = fs.readFileSync(path.join(__dirname, 'sistema-app-ui.js'), 'utf8');

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
const buildSha = process.env.VERCEL_GIT_COMMIT_SHA ? process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 7) : gitShortSha();
const buildAt = new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
// Fase 10.1 "Congelamento e Preparação para Teste Real": rótulo textual do congelamento, visível na
// tela (não só o hash) — set TEST_LABEL='' para voltar ao rodapé padrão depois da validação.
const TEST_LABEL = 'TESTE OPERACIONAL — 28/08/2026';
const buildInfo = (TEST_LABEL ? TEST_LABEL + ' · ' : '') + 'build ' + (buildSha || '(sem git)') + ' · ' + buildAt;

const html = shell
  .replace('<!--XLSX-->', () => '<script>' + xlsx + '\n</script>')
  .replace('<!--BUNDLE-->', () => '<script>' + bundle + '\n</script>')
  .replace('<!--UI-->', () => '<script>' + ui + '\n</script>')
  .replace('<!--BUILDINFO-->', () => buildInfo);

const out = path.join(ROOT, 'docs/sistema-marketplace.html');
fs.writeFileSync(out, html);
console.log('Gerado', out, '(' + (html.length / 1024).toFixed(0) + ' KB) —', buildInfo);
