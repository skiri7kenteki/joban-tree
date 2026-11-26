// 設定の「データ」の中の Google ドライブの欄（段階22-3。今は**ログインの確認だけ**：研究のデータは読み書きしない）。
// クライアント ID（src/drive/config.ts）が入るまで出さない。
// iPhone のホーム画面のアプリでログインから戻れるかを、持ち主が実機で確かめてから、同期を作る

import { useEffect, useState } from 'preact/hooks';
import { driveClientId } from '../drive/config';
import { checkDrive, clearLoginNote, currentToken, forgetToken, loginNote, startLogin } from '../drive/session';

/** ホーム画面のアプリとして開いているか（実機の確かめで、どちらかを知るため） */
function isHomeScreenApp(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
}

export function DriveSection() {
  const [note, setNote] = useState(() => loginNote());
  const [token, setToken] = useState(() => currentToken());
  const [checking, setChecking] = useState(false);

  async function check() {
    setChecking(true);
    const r = await checkDrive();
    setChecking(false);
    setToken(currentToken());
    setNote(r.ok ? { ok: true, message: `ドライブに届きました（このアプリのファイル ${r.files} 個）。` } : { ok: false, message: r.message });
  }

  // ログインから戻った直後は、そのままドライブに届くかも確かめる
  useEffect(() => {
    if (note?.ok && token) void check();
  }, []);

  if (!driveClientId()) return null;
  const minutes = token ? Math.floor((token.expiresAt - Date.now()) / 60_000) : 0;
  return (
    <div class="drive-box" data-testid="drive-section">
      <div class="data-row">
        <span>Google ドライブ</span>
        <span class="num" data-testid="drive-state">
          {token ? `ログイン中（あと ${minutes}分）` : 'ログインしていません'}
        </span>
      </div>
      <p class="muted data-hint">
        今はログインできるかを確かめるだけです。研究のデータは送りません。{isHomeScreenApp() ? 'ホーム画面のアプリで開いています。' : 'ブラウザで開いています。'}
      </p>
      <div class="data-buttons">
        <button type="button" class="btn btn-wide" data-testid="drive-login" onClick={startLogin}>
          Google にログインして確かめる
        </button>
        {token && (
          <>
            <button type="button" class="btn btn-wide" data-testid="drive-check" disabled={checking} onClick={() => void check()}>
              {checking ? '確かめています…' : 'ドライブに届くかもう一度確かめる'}
            </button>
            <button
              type="button"
              class="btn btn-wide"
              data-testid="drive-logout"
              onClick={() => {
                forgetToken();
                clearLoginNote();
                setToken(null);
                setNote(null);
              }}
            >
              この端末のログインを消す
            </button>
          </>
        )}
      </div>
      {note && (
        <p class={note.ok ? 'status-ok' : 'status-ng'} role="status" data-testid="drive-message">
          {note.message}
        </p>
      )}
    </div>
  );
}
