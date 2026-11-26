// 同期の実行（段階22-3）。**どの画面にいても操作を止める**ので、状態はアプリ全体で持つ
// （同期中に戻るボタンで画面を移れると、合わせる前の古い一覧を元に保存して、ほかの端末から来た中身を上書きするため）

import { signal } from '@preact/signals';
import { APP_VERSION } from '../components/Footer';
import { runSync } from '../drive/run';
import { clearDriveNote, clearSyncPending, currentToken, saveDriveNote, startLogin, type DriveNote } from '../drive/session';
import { syncMessage } from '../drive/sync';
import { isGenerating } from './generation';

/** 同期している間 true */
export const syncing = signal(false);
/** ログイン・同期の状態を変えたら増やす（設定の欄を描き直す） */
export const driveChanged = signal(0);

function finish(result: DriveNote | null): void {
  clearSyncPending();
  if (result) saveDriveNote(result);
  syncing.value = false;
  driveChanged.value++;
}

async function run(token: string): Promise<void> {
  const outcome = await runSync(token, APP_VERSION);
  const result = outcome.ok ? { ok: true, message: syncMessage(outcome.changes, outcome.changedHere) } : { ok: false, message: outcome.message };
  if (outcome.changedHere) {
    // 画面に残っている古い一覧を確実に入れ替えるため、読み込み直す（操作は止めたまま）
    clearSyncPending();
    saveDriveNote(result);
    location.reload();
    return;
  }
  finish(result);
}

/** ［Google ドライブで同期］：ログインしていなければ Google のログインへ移る（戻ったら続けて同期する） */
export function startSync(): void {
  if (syncing.value) return;
  clearDriveNote();
  driveChanged.value++;
  const t = currentToken();
  if (!t) {
    startLogin();
    return;
  }
  if (isGenerating()) {
    finish({ ok: false, message: 'ツリーを生成しています。止めるか終わってから同期してください。' });
    return;
  }
  syncing.value = true;
  run(t.token).catch(() => finish({ ok: false, message: '同期できませんでした。アプリを開き直してから、もう一度ためしてください。' }));
}

/** 同期している間、画面全体を覆って操作を止める */
export function SyncOverlay() {
  if (!syncing.value) return null;
  return (
    <div class="sync-overlay" data-testid="drive-busy">
      <p class="card" role="status">
        Google ドライブと同期しています…。このままお待ちください。
      </p>
    </div>
  );
}
