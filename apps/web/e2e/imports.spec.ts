import { test, expect } from '@playwright/test';
import path from 'path';

/**
 * E2E da Central de Importações (Bloco 2). Requer Web:3000 e API:3001 no ar,
 * com o seed de demonstração aplicado. Usa as fixtures sanitizadas.
 */
const FIX = path.resolve(__dirname, '../../api/test/fixtures/files');

async function login(page: import('@playwright/test').Page) {
  await page.goto('/login');
  await page.fill('input[type=email]', 'admin@demo.local');
  await page.fill('input[type=password]', 'Demo@12345');
  await page.click('button[type=submit]');
  await page.waitForURL('**/dashboard');
}

test('importa a Carteira (cabeçalho linha 18) e mostra o resultado real', async ({ page }) => {
  await login(page);
  await page.goto('/importacoes');
  await page.click('button:has-text("Nova importação")');
  await page.setInputFiles('input[type=file]', path.join(FIX, 'my_balance_transaction_report.20260729.xlsx'));
  await page.click('button:has-text("Analisar")');

  await expect(page.getByText('Carteira Shopee').first()).toBeVisible({ timeout: 20000 });
  await expect(page.getByText('Cabeçalho localizado na linha 18', { exact: false })).toBeVisible({ timeout: 20000 });
  await expect(page.getByText('linha 18').first()).toBeVisible();

  await page.click('button:has-text("Confirmar importação")');
  await expect(page.getByText('Importação concluída', { exact: false })).toBeVisible({ timeout: 20000 });

  await page.click('text=Abrir lote');
  await expect(page.getByText('Detalhes do lote')).toBeVisible({ timeout: 20000 });
  await expect(page.getByText('linha 18').first()).toBeVisible();
});

test('VIEWER não vê o botão de nova importação', async ({ page }) => {
  await page.goto('/login');
  await page.fill('input[type=email]', 'viewer@demo.local');
  await page.fill('input[type=password]', 'Demo@12345');
  await page.click('button[type=submit]');
  await page.waitForURL('**/dashboard');
  await page.goto('/importacoes');
  await expect(page.getByText('Consulta', { exact: false }).first()).toBeVisible();
  await expect(page.locator('button:has-text("Nova importação")')).toHaveCount(0);
});
