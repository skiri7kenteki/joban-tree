// 画面の通し確認（Playwright）。ビルド済みのファイルを vite preview で配信して確かめる。
// preview にはヘッダを付けていないので、公開版と同じく service worker 経由で isolated になるかも確かめられる。
import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;

export default defineConfig({
  testDir: 'e2e',
  timeout: 180_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}/joban-tree/`,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/joban-tree/`,
    reuseExistingServer: !process.env.CI,
  },
});
