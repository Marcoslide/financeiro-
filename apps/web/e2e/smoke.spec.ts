import { test, expect } from '@playwright/test';

/**
 * Smoke E2E do Bloco 1: login → dashboard → usuários.
 * Requer API (3001) e Web (3000) no ar e o seed aplicado.
 * Rode com: pnpm --filter @financeiro/web test:e2e
 */
test('login e navegação básica', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Conciliação Shopee' })).toBeVisible();

  await page.getByRole('button', { name: 'Entrar' }).click();
  await page.waitForURL('**/dashboard');
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

  await page.getByRole('link', { name: 'Usuários' }).click();
  await expect(page.getByRole('heading', { name: 'Usuários' })).toBeVisible();
  await expect(page.getByText('admin@demo.local')).toBeVisible();
});
