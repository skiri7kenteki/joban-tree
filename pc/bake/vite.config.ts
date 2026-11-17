// 同梱ツリーを作るコマンド（pc/bake/main.ts）を、Node.js で動く 1 つのファイル（pc/bake/dist/bake.mjs）にまとめる。
// アプリと同じ src/ の TypeScript をそのまま使うため、Vite でまとめる（tsshogi などは node_modules から読む）。
import { defineConfig } from 'vite';

export default defineConfig({
  // src/engine/config.ts の import.meta.env を使えるように（PC のエンジンでは使わない）
  base: '/joban-tree/',
  publicDir: false,
  build: {
    ssr: 'pc/bake/main.ts',
    outDir: 'pc/bake/dist',
    emptyOutDir: true,
    target: 'node22',
    minify: false,
    rollupOptions: {
      output: { entryFileNames: 'bake.mjs' },
    },
  },
});
