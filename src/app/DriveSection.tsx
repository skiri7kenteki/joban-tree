// 設定の「Google ドライブで同期」の下の画面の中身（段階22-3）と、定跡帳のタブの「前の同期から 1 日以上」の一言。
// ［Google ドライブで同期］：ログインしていなければ Google のログインへ移り、戻ったら続けて同期する。
// 同期でこの端末のデータが変わったら、アプリを読み込み直して結果を出す

import { useEffect, useRef, useState } from 'preact/hooks';
import { clearDriveNote, currentToken, driveNote, forgetToken, syncPending } from '../drive/session';
import { hideSyncNudgeUntil, lastSyncAt, syncNudgeHiddenUntil } from '../drive/state';
import { shouldSyncNudge } from '../drive/sync';
import { go } from './router';
import { driveChanged, startSync, syncing } from './syncing';

const DAY = 24 * 60 * 60 * 1000;
const LATE_TEXT = '1 日以上同期していません';

/** 日時（11/23 13:05 の形） */
function shortDateTime(t: number): string {
  const d = new Date(t);
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function DriveSection() {
  // ログイン・同期の状態が変わったら描き直して、読み直す
  void driveChanged.value;
  const busy = syncing.value;
  const note = busy ? null : driveNote();
  const token = currentToken();
  const last = lastSyncAt();
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // 結果があるとき（ログインの戻り・同期で読み込み直した後）は、この欄が見えるところまで送る
    if (driveNote() || syncPending()) box.current?.scrollIntoView({ block: 'nearest' });
    // ［Google ドライブで同期］からログインに移って戻ったら、続けて同期する
    if (syncPending() && currentToken()) startSync();
  }, []);

  return (
    <div class="drive-box" data-testid="drive-section" ref={box}>
      <div class="data-row">
        <span>最後に同期した日時</span>
        <span class="num" data-testid="drive-last">
          {last ? shortDateTime(last) : 'まだありません'}
        </span>
      </div>
      {shouldSyncNudge(Date.now(), last, null) && (
        <p class="muted data-hint" data-testid="drive-late">
          {LATE_TEXT}。
        </p>
      )}
      <div class="data-buttons">
        <button type="button" class="btn btn-wide" data-testid="drive-sync" disabled={busy} onClick={startSync}>
          Google ドライブで同期
        </button>
        <p class="muted data-hint">
          研究や実戦のデータを、あなたの Google ドライブのこのアプリ専用の場所に送り、ほかの端末と合わせます。{!token && '押すと Google のログインに移ります。'}
        </p>
        {token && (
          <button
            type="button"
            class="btn btn-wide"
            data-testid="drive-logout"
            disabled={busy}
            onClick={() => {
              forgetToken();
              clearDriveNote();
              driveChanged.value++;
            }}
          >
            この端末のログインを消す
          </button>
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

/** 定跡帳の一覧の上の一言（同期したことがあり、前の同期から 1 日以上。閉じたら 1 日は出さない） */
export function SyncNudge() {
  const [hidden, setHidden] = useState(false);
  if (hidden || !shouldSyncNudge(Date.now(), lastSyncAt(), syncNudgeHiddenUntil())) return null;
  return (
    <div class="notice backup-nudge" role="status" data-testid="sync-nudge">
      <span class="backup-nudge-text">{LATE_TEXT}</span>
      <button type="button" class="btn btn-ghost" data-testid="sync-nudge-open" onClick={() => go('/settings/sync')}>
        設定で同期
      </button>
      <button
        type="button"
        class="btn btn-ghost backup-nudge-close"
        aria-label="閉じる（1 日は出しません）"
        data-testid="sync-nudge-close"
        onClick={() => {
          hideSyncNudgeUntil(Date.now() + DAY);
          setHidden(true);
        }}
      >
        ×
      </button>
    </div>
  );
}
