// service worker を登録し、ページを「cross-origin isolated」（エンジンに必要な状態）にする。
//
// 初めて開いたときは、まだ service worker がいないのでヘッダが付かず、isolated になれない。
// そこで「service worker が動き始めたら 1 回だけ自動で再読み込み」する。
// 再読み込みしてもだめなら、何度も繰り返さずに 'failed' を返す。

export type IsolationState = 'isolated' | 'reloading' | 'failed' | 'no-service-worker';

const RELOAD_KEY = 'joban-tree.isolation-reload-at';

function readReloadAt(): number {
  try {
    return Number(sessionStorage.getItem(RELOAD_KEY) ?? 0);
  } catch {
    return 0;
  }
}

function writeReloadAt(value: number): void {
  try {
    sessionStorage.setItem(RELOAD_KEY, String(value));
  } catch {
    // 保存できない環境でも動くようにする（その場合、再読み込みは 1 回きりの保証がなくなるだけ）
  }
}

async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  // 手元の開発サーバーでは service worker を使わない（ヘッダは開発サーバーが付ける）
  if (import.meta.env.DEV) return null;
  const base = import.meta.env.BASE_URL;
  return navigator.serviceWorker.register(`${base}sw.js`, { scope: base });
}

export async function ensureCrossOriginIsolated(): Promise<IsolationState> {
  const registration = await registerServiceWorker().catch(() => null);

  if (self.crossOriginIsolated) {
    writeReloadAt(0);
    return 'isolated';
  }
  if (!registration) return 'serviceWorker' in navigator ? 'failed' : 'no-service-worker';

  // 直前に再読み込みしたばかりなのに isolated でない → あきらめる（無限に再読み込みしないため）
  if (Date.now() - readReloadAt() < 15_000) return 'failed';

  // service worker がこのページを担当し始めるのを待つ
  // （インストールに失敗したときに待ち続けないよう、30 秒で打ち切る）
  if (!navigator.serviceWorker.controller) {
    const started = await new Promise<boolean>((resolve) => {
      navigator.serviceWorker.addEventListener('controllerchange', () => resolve(true), { once: true });
      setTimeout(() => resolve(false), 30_000);
    });
    if (!started) return 'failed';
  }
  writeReloadAt(Date.now());
  location.reload();
  return 'reloading';
}
