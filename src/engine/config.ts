// エンジンと評価関数のファイルの場所。
// URL にバージョン（エンジンは ENGINE_ID、評価関数は日付）を含めることで、
// service worker の「キャッシュ優先」でも更新が確実に届くようにしている。

export type EvalId = 'micro' | 'mini';

export interface EvalInfo {
  id: EvalId;
  /** 画面に出す名前 */
  label: string;
  /** やねうら王のビルドで付けたパッケージ名（engine/patches を参照） */
  pkg: string;
  /** エンジンの JS が作るグローバル関数の名前 */
  exportName: string;
  /** 評価関数のフォルダ（public/ からの相対パス） */
  evalDir: string;
  /** おおよそのダウンロード量（MB）。画面の案内用 */
  approxMB: number;
}

export const EVALS: Record<EvalId, EvalInfo> = {
  micro: {
    id: 'micro',
    label: 'つようら王11micro',
    pkg: 'sfnn_ka2_2048.noeval',
    exportName: 'YaneuraOu_SFNN_ka2_2048',
    evalDir: 'eval/tuyoura11micro-20261001/',
    approxMB: 6,
  },
  mini: {
    id: 'mini',
    label: 'つようら王11mini',
    pkg: 'sfnn_ka2_4096.noeval',
    exportName: 'YaneuraOu_SFNN_ka2_4096',
    evalDir: 'eval/tuyoura11mini-20261003/',
    approxMB: 10,
  },
};

/** エンジンのビルドの識別子。GitHub Actions がビルド時に入れる。手元の開発では 'dev' */
export const ENGINE_ID: string = import.meta.env.VITE_ENGINE_ID || 'dev';

/** エンジン・評価関数のファイルの URL（絶対 URL） */
export function engineUrls(evalId: EvalId, origin: string = location.href) {
  const info = EVALS[evalId];
  const base = new URL(import.meta.env.BASE_URL, origin);
  const engineDir = new URL(`engine/${ENGINE_ID}/`, base).href;
  return {
    engineDir,
    engineJs: `${engineDir}yaneuraou.${info.pkg}.js`,
    nn: new URL(`${info.evalDir}nn.bin`, base).href,
    progress: new URL(`${info.evalDir}progress.bin`, base).href,
  };
}

/** service worker の「大きいファイル用」キャッシュの名前（src/sw.ts と同じもの） */
export const BIG_CACHE = 'joban-tree-big';

/**
 * 古いエンジン・評価関数をキャッシュから消す（端末の容量を節約するため）。
 * いまのビルドで使う URL 以外の engine/・eval/ のファイルを消す。
 */
export async function pruneOldBigFiles(): Promise<void> {
  if (typeof caches === 'undefined') return;
  const keep = new Set<string>();
  for (const id of Object.keys(EVALS) as EvalId[]) {
    const u = engineUrls(id);
    keep.add(u.engineDir);
    keep.add(new URL('.', u.nn).href);
  }
  const cache = await caches.open(BIG_CACHE);
  for (const req of await cache.keys()) {
    const dir = new URL('.', req.url).href;
    if (!keep.has(dir)) await cache.delete(req);
  }
}
