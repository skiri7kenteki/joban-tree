/// <reference lib="webworker" />
// service worker（画面の裏で動き、ファイルの読み込みを仲介する仕組み）。役目は 3 つ：
//
// 1. すべての応答に COOP/COEP ヘッダを付け足す
//    → ページが「cross-origin isolated」になり、エンジン（複数スレッド版の WASM）が使う
//      SharedArrayBuffer が使えるようになる。GitHub Pages ではヘッダを設定できないための工夫
//      （coi-serviceworker と同じ考え方）
// 2. アプリ本体のファイルを端末に保存し、オフラインでも開けるようにする
//    - HTML（index.html など）は「ネット優先」。GitHub Pages の 10 分キャッシュで古い版が出続けないよう
//      cache: 'no-cache' で毎回確認する
//    - それ以外（Vite がハッシュ付きの名前を付ける JS/CSS）は「キャッシュ優先」
// 3. エンジン（engine/）と評価関数（eval/）は大きいので、最初に使ったときに保存し、以後は「キャッシュ優先」
//    （URL にバージョンが入っているので、更新は URL が変わることで届く）

// このファイルを「モジュール」として扱わせる（下の self の型宣言を、全体の self とぶつけないため）
export {};

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

// ビルド時に vite-plugin-pwa が、事前に保存するファイルの一覧を埋め込む
const MANIFEST = self.__WB_MANIFEST;

/** 一覧の中身から短い印を作り、キャッシュの名前にする（中身が変われば名前も変わる） */
function hashManifest(): string {
  let h = 5381;
  for (const entry of MANIFEST) {
    const s = `${entry.url}|${entry.revision ?? ''}`;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

const APP_CACHE = `joban-tree-app-${hashManifest()}`;
/** src/engine/config.ts の BIG_CACHE と同じ名前 */
const BIG_CACHE = 'joban-tree-big';

const scopeUrl = () => new URL(self.registration.scope);

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(APP_CACHE);
      const requests = MANIFEST.map((e) => new Request(new URL(e.url, scopeUrl()).href, { cache: 'reload' }));
      await cache.addAll(requests);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // 古い版のアプリ本体の保存分を消す（大きいファイル用はページ側で整理する）
      for (const key of await caches.keys()) {
        if (key.startsWith('joban-tree-app-') && key !== APP_CACHE) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  // Chrome の古い不具合への対策（only-if-cached は same-origin モード以外で使えない）
  if (request.cache === 'only-if-cached' && request.mode !== 'same-origin') return;

  event.respondWith(handle(request, url).then(addIsolationHeaders));
});

async function handle(request: Request, url: URL): Promise<Response> {
  const path = url.pathname.slice(scopeUrl().pathname.length);
  if (request.mode === 'navigate' || path === '' || path.endsWith('.html')) {
    return networkFirst(url, path);
  }
  if (path.startsWith('engine/') || path.startsWith('eval/')) {
    return cacheFirst(request, BIG_CACHE);
  }
  // ignoreVary：保存した応答の Vary ヘッダ（Origin・Accept-Encoding など）が、ページからの読み込みと食い違っても使う。
  // URL にハッシュ（版）が入っているので、URL が同じなら中身も同じ。これが無いとオフラインで JS/CSS が読めなかった
  const cached = await caches.match(request, { cacheName: APP_CACHE, ignoreVary: true });
  return cached ?? fetch(request);
}

/** HTML：ネット優先。だめなら保存分 */
async function networkFirst(url: URL, path: string): Promise<Response> {
  // "/joban-tree/" と "/joban-tree/index.html" は同じものとして保存する
  const key = new URL(path === '' ? 'index.html' : path, scopeUrl()).href;
  try {
    const response = await fetch(url.href, { cache: 'no-cache', credentials: 'same-origin' });
    if (response.ok) {
      const cache = await caches.open(APP_CACHE);
      await cache.put(key, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await caches.match(key, { ignoreSearch: true, ignoreVary: true });
    if (cached) return cached;
    throw error;
  }
}

/** 大きいファイル：キャッシュ優先。無ければ取ってきて保存 */
async function cacheFirst(request: Request, cacheName: string): Promise<Response> {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request, { ignoreVary: true });
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

/** COOP/COEP ヘッダを付け足した応答を作り直す */
function addIsolationHeaders(response: Response): Response {
  if (response.status === 0) return response; // 中身の見えない応答はそのまま
  const headers = new Headers(response.headers);
  headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
