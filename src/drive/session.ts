// Google のログインのうち、ブラウザの読み書き（段階22-3）。計算は src/drive/auth.ts。
// 鍵はこの端末の localStorage にだけ置く（バックアップに入れる設定の名前には入れない）。ドライブとは fetch で直接やり取りする
// （service worker は別の場所への通信に触らないので、キャッシュされない。sw.ts）

import { acceptLoginReturn, buildAuthUrl, parseLoginReturn, usableToken, type DriveToken } from './auth';
import { GOOGLE_CLIENT_ID } from './config';

const TOKEN_KEY = 'joban-tree.drive-token';
const LOGIN_KEY = 'joban-tree.drive-login';
/** 戻った直後に設定の画面で出す結果 */
const NOTE_KEY = 'joban-tree.drive-note';
/** ログインから戻ったら同期する（［Google ドライブで同期］を押してログインに移ったとき） */
const PENDING_KEY = 'joban-tree.drive-sync-pending';

const read = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string | null): void => {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // 書けない端末（プライベートブラウズなど）では覚えない
  }
};

/** ログインの後に戻ってくる場所（Google の画面で登録する「承認済みのリダイレクト URI」と同じ文字にする） */
export function redirectUri(): string {
  return new URL(import.meta.env.BASE_URL, location.origin).href;
}

/** Google のログインの画面へ移る（戻ったら同期する） */
export function startLogin(): void {
  clearDriveNote();
  clearSyncPending();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const state = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  write(LOGIN_KEY, JSON.stringify({ state, at: Date.now() }));
  location.assign(buildAuthUrl(GOOGLE_CLIENT_ID, redirectUri(), state));
}

/**
 * アプリを開いたとき、ログインの戻りなら受け取って、URL から鍵を消して設定の画面にする。
 * **画面の URL を読むより先に呼ぶ**（app/router.ts が呼ぶ）。戻りを受け取ったら true
 */
export function takeLoginReturn(): boolean {
  const r = parseLoginReturn(location.hash);
  if (!r) return false;
  // 鍵の付いた URL は、すぐに履歴から消す
  history.replaceState(history.state, '', `${location.pathname}${location.search}#/settings/sync`);
  let sent: { state: string; at: number } | null = null;
  try {
    sent = JSON.parse(read(LOGIN_KEY) ?? 'null') as { state: string; at: number } | null;
  } catch {
    sent = null;
  }
  const result = acceptLoginReturn(r, sent, Date.now());
  if (result.ok) {
    write(TOKEN_KEY, JSON.stringify(result.token));
    write(PENDING_KEY, String(Date.now()));
  }
  // 送った印は 1 回で使い切る（このアプリのログインの戻りだったときは、失敗でも）
  if (sent && sent.state === r.state) write(LOGIN_KEY, null);
  if (!result.ok) saveDriveNote({ ok: false, message: result.message });
  return true;
}

export interface DriveNote {
  ok: boolean;
  message: string;
}

/** 結果を出しておく時間 */
const NOTE_MS = 2 * 60 * 1000;

export function saveDriveNote(note: DriveNote, now = Date.now()): void {
  write(NOTE_KEY, JSON.stringify({ ...note, at: now }));
}

/**
 * ログインの戻り・同期の結果。**読んでも消さない**：ログインの直後や同期のあとはアプリが読み込み直すことがあり、
 * 消すと結果が出ないまま終わる。次に操作したとき（clearDriveNote）か、2 分たったら出さない
 */
export function driveNote(now = Date.now()): DriveNote | null {
  try {
    const note = JSON.parse(read(NOTE_KEY) ?? 'null') as (DriveNote & { at: number }) | null;
    return note && now - note.at < NOTE_MS ? { ok: note.ok, message: note.message } : null;
  } catch {
    return null;
  }
}

export function clearDriveNote(): void {
  write(NOTE_KEY, null);
}

/** ログインから戻って、まだ同期が終わっていない（途中で読み込み直しても、もう一度同期する） */
export function syncPending(now = Date.now()): boolean {
  const at = Number(read(PENDING_KEY));
  return at > 0 && now - at < NOTE_MS;
}

export function clearSyncPending(): void {
  write(PENDING_KEY, null);
}

export function currentToken(now = Date.now()): DriveToken | null {
  return usableToken(read(TOKEN_KEY), now);
}

export function forgetToken(): void {
  write(TOKEN_KEY, null);
}
