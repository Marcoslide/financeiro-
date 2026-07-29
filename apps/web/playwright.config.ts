import { defineConfig } from '@playwright/test';

/**
 * Config do smoke E2E. Assume Web em http://localhost:3000 e API em 3001 já no ar.
 * Usa o Chromium pré-instalado do ambiente (via CHROMIUM_PATH ou o caminho padrão).
 */
const executablePath = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium';

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  use: {
    baseURL: 'http://localhost:3000',
    headless: true,
    launchOptions: { executablePath },
  },
});
