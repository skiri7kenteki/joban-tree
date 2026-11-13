/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** package.json の version（vite.config.ts で入れる） */
  readonly VITE_APP_VERSION: string;
  /** エンジンのビルドの識別子（GitHub Actions が入れる） */
  readonly VITE_ENGINE_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
