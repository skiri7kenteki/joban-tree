// Google のログインのうち、ブラウザの読み書き（段階22-3）。計算は src/drive/auth.ts。
// 鍵はこの端末の localStorage にだけ置く（バックアップに入れる設定の名前には入れない）。ドライブとは fetch で直接やり取りする
// （service worker は別の場所への通信に触らないので、キャッシュされない。sw.ts）

import { acceptLoginReturn, buildAuthUrl, parseLoginReturn, usableToken, type DriveToken } from './auth';
import { driveClientId } from './config';

const TOKEN_KEY = 'joban-tree.drive-token';
const LOGIN_KEY = 'joban-tree.drive-login';
/** 戻った直後に設定の画面で出す結果 */
const NOTE_KEY = 'joban-tree.drive-note';

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

/** Google のログインの画面へ移る */
export function startLogin(): void {
  clearLoginNote();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const state = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  write(LOGIN_KEY, JSON.stringify({ state, at: Date.now() }));
  location.assign(buildAuthUrl(driveClientId(), redirectUri(), state));
}

/**
 * アプリを開いたとき、ログインの戻りなら受け取って、URL から鍵を消して設定の画面にする。
 * **画面の URL を読むより先に呼ぶ**（app/router.ts が呼ぶ）。戻りを受け取ったら true
 */
export function takeLoginReturn(): boolean {
  const r = parseLoginReturn(location.hash);
  if (!r) return false;
  // 鍵の付いた URL は、すぐに履歴から消す
  history.replaceState(history.state, '', `${location.pathname}${location.search}#/settings`);
  let sent: { state: string; at: number } | null = null;
  try {
    sent = JSON.parse(read(LOGIN_KEY) ?? 'null') as { state: string; at: number } | null;
  } catch {
    sent = null;
  }
  const result = acceptLoginReturn(r, sent, Date.now());
  if (result.ok) write(TOKEN_KEY, JSON.stringify(result.token));
  // 送った印は 1 回で使い切る（このアプリのログインの戻りだったときは、失敗でも）
  if (sent && sent.state === r.state) write(LOGIN_KEY, null);
  write(NOTE_KEY, JSON.stringify({ ...(result.ok ? { ok: true, message: 'ログインできました。' } : { ok: false, message: result.message }), at: Date.now() }));
  return true;
}

/** 戻った結果を出しておく時間 */
const NOTE_MS = 2 * 60 * 1000;

/**
 * 戻った直後の結果。**読んでも消さない**：初めて開いたときは、準備（isolation）のためにアプリが 1 回読み込み直すので、
 * 消すと結果が出ないまま終わる。次に操作したとき（clearLoginNote）か、2 分たったら出さない
 */
export function loginNote(now = Date.now()): { ok: boolean; message: string } | null {
  try {
    const note = JSON.parse(read(NOTE_KEY) ?? 'null') as { ok: boolean; message: string; at: number } | null;
    return note && now - note.at < NOTE_MS ? { ok: note.ok, message: note.message } : null;
  } catch {
    return null;
  }
}

export function clearLoginNote(): void {
  write(NOTE_KEY, null);
}

export function currentToken(now = Date.now()): DriveToken | null {
  return usableToken(read(TOKEN_KEY), now);
}

export function forgetToken(): void {
  write(TOKEN_KEY, null);
}

export type DriveCheck = { ok: true; files: number } | { ok: false; message: string; loggedOut?: boolean };

/** ドライブに届くかを確かめる（このアプリ専用の場所の一覧を読むだけ。何も書かない・研究のデータは送らない） */
export async function checkDrive(): Promise<DriveCheck> {
  const t = currentToken();
  if (!t) return { ok: false, message: 'ログインの期限が切れました。もう一度ログインしてください。', loggedOut: true };
  let res: Response;
  try {
    res = await fetch('https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&fields=files(id)&pageSize=100', {
      headers: { Authorization: `Bearer ${t.token}` },
      cache: 'no-store',
    });
  } catch {
    return { ok: false, message: 'Google ドライブにつながりませんでした。ネットにつながっているか確かめてください。' };
  }
  if (res.status === 401) {
    forgetToken();
    return { ok: false, message: 'ログインの期限が切れました。もう一度ログインしてください。', loggedOut: true };
  }
  if (!res.ok) {
    return { ok: false, message: `Google ドライブが使えませんでした（${res.status}）。Google Cloud で「Google Drive API」を有効にしたか確かめてください。` };
  }
  try {
    const body = (await res.json()) as { files?: unknown };
    return Array.isArray(body.files) ? { ok: true, files: body.files.length } : { ok: false, message: 'Google ドライブの返事が読めませんでした。' };
  } catch {
    return { ok: false, message: 'Google ドライブの返事が読めませんでした。' };
  }
}
