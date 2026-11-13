/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';

// 画面下に出すバージョン（package.json の version）を、import.meta.env.VITE_APP_VERSION として使えるようにする
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };
process.env.VITE_APP_VERSION = pkg.version;

// 手元の開発サーバーで cross-origin isolated にするためのヘッダ
// （公開版では service worker が同じヘッダを付け足す。src/sw.ts を参照）
const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  // GitHub Pages のサブパス https://skiri7kenteki.github.io/joban-tree/
  base: '/joban-tree/',
  plugins: [
    preact(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      // service worker の登録は src/isolation.ts で自分で行う
      injectRegister: false,
      // ホーム画面用の設定は public/manifest.webmanifest に手で書いている
      manifest: false,
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        // エンジンと評価関数は大きいので事前保存しない（使ったときに保存する）
        globIgnores: ['engine/**', 'eval/**'],
      },
      devOptions: { enabled: false },
    }),
  ],
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        bench: 'bench.html',
      },
    },
  },
  worker: {
    // エンジンの Worker は importScripts を使うので classic 形式（iife）でまとめる
    format: 'iife',
  },
  server: { headers: isolationHeaders },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
