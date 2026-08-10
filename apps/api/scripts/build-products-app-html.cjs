/*
 * Monta docs/produtos-app.html: o MÓDULO PRODUTOS completo como um único arquivo
 * offline (protótipo navegável). Empacota o parser real de produtos (esbuild +
 * shims), inlina SheetJS e a aplicação (interface ERP + IndexedDB). Nenhum dado
 * sai do navegador.
 *
 * Uso: node apps/api/scripts/build-products-app-html.cjs
 *  (ou) pnpm --filter @financeiro/api build:produtos-app
 */
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const ROOT = path.resolve(__dirname, '../../..');
const API = path.resolve(__dirname, '..');
const B = path.join(API, 'src/imports/parsing/browser');
const ENTRY = path.join(API, 'src/products/parsing/browser/entry.ts');

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

const shell = fs.readFileSync(path.join(__dirname, 'products-app-shell.html'), 'utf8');
const xlsx = fs.readFileSync(findXlsx(), 'utf8');
const ui = fs.readFileSync(path.join(__dirname, 'products-app-ui.js'), 'utf8');

const html = shell
  .replace('<!--XLSX-->', () => '<script>' + xlsx + '\n</script>')
  .replace('<!--BUNDLE-->', () => '<script>' + bundle + '\n</script>')
  .replace('<!--UI-->', () => '<script>' + ui + '\n</script>');

const out = path.join(ROOT, 'docs/produtos-app.html');
fs.writeFileSync(out, html);
console.log('Gerado', out, '(' + (html.length / 1024).toFixed(0) + ' KB)');
