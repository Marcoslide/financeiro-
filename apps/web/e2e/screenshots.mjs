// Captura de telas reais do Bloco 2 (evidência). Requer API:3001 e Web:3000 no ar.
import { chromium } from '@playwright/test';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, '../../../docs/evidencias-bloco2');
const FIX = path.resolve(__dirname, '../../api/test/fixtures/files');
const exe = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';

async function main() {
  const fs = await import('fs');
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: exe });
  const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });

  // Login
  await page.goto('http://localhost:3000/login');
  await page.fill('input[type=email]', 'admin@demo.local');
  await page.fill('input[type=password]', 'Demo@12345');
  await page.click('button[type=submit]');
  await page.waitForURL('**/dashboard', { timeout: 15000 });

  async function importar(file, shot) {
    await page.goto('http://localhost:3000/importacoes');
    await page.waitForTimeout(700);
    await page.click('button:has-text("Nova importação")');
    await page.waitForTimeout(700);
    await page.setInputFiles('input[type=file]', path.join(FIX, file));
    await page.waitForTimeout(500);
    await page.click('button:has-text("Analisar")');
    await page.waitForSelector('text=Relatório sugerido', { timeout: 20000 });
    await page.waitForTimeout(600);
    if (shot) await page.screenshot({ path: path.join(OUT, shot), fullPage: true });
    await page.click('button:has-text("Confirmar importação")');
    await page.waitForSelector('text=Importação concluída', { timeout: 20000 });
    await page.waitForTimeout(500);
    return page;
  }

  // Importa a Carteira (cabeçalho linha 18) — captura a prévia com a detecção
  await importar('my_balance_transaction_report.20260729.xlsx', '02-previa-carteira-linha18.png');
  await page.screenshot({ path: path.join(OUT, '03-resultado.png'), fullPage: true });
  // Abre o lote (detalhe com todos os números)
  await page.click('text=Abrir lote');
  await page.waitForSelector('text=Detalhes do lote', { timeout: 15000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, '04-detalhe-lote.png'), fullPage: true });

  // Importa mais alguns para popular a lista
  await importar('2193537298992576518_1.csv', '05-previa-acelera-linha6.png');
  await importar('Order.return_refund.20260729.xls', null); // .xls que é XLSX
  await importar('Order.toship.20260729.xlsx', null);

  // Reimporta a carteira para evidenciar dedup (0 importadas)
  await importar('my_balance_transaction_report.20260729.xlsx', '06-reimport-dedup.png');

  // Lista final
  await page.goto('http://localhost:3000/importacoes');
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(OUT, '01-central-importacoes.png'), fullPage: true });

  // Detalhe com filtro de linhas com erro (usando o arquivo com 1 erro)
  await importar('orders_with_one_error.xlsx', null);
  await page.click('text=Abrir lote');
  await page.waitForSelector('text=Detalhes do lote', { timeout: 15000 });
  await page.click('text=Com erro');
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(OUT, '07-linha-com-erro.png'), fullPage: true });

  await browser.close();
  console.log('Screenshots salvos em', OUT);
}
main().catch((e) => { console.error(e); process.exit(1); });
