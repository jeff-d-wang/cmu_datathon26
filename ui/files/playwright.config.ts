import { defineConfig } from '@playwright/test';

// Smoke tests run against a local dev server (`npm run dev`) on DATABRICKS_APP_PORT (default 8000).
export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  use: { baseURL: `http://localhost:${process.env.DATABRICKS_APP_PORT ?? '8000'}`, viewport: { width: 1280, height: 800 } },
});
