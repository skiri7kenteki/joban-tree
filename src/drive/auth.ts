// Google のログイン（段階22-3。持ち主の判断 2026-11-26）。ここは計算だけ（ブラウザの読み書きは src/drive/session.ts）。
//
// ブラウザだけで済む「画面を移して戻る」方式（response_type=token）。サーバーも秘密の鍵も使わず、Google の JavaScript も読み込まない。
// Google の公式の説明では古い方式の扱い（持ち主は承知の上で選んだ）。長く使える鍵は受け取らない（1 時間ほどで切れる）。
// 戻り先の URL の # の後ろに結果が付くので、アプリの画面の URL（#/…）より先に受け取る

/** アプリ専用の見えない場所だけを使う権限（ほかのファイルは見られない） */
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
/** ログインの画面へ行ってから、戻りを受け付ける時間 */
export const LOGIN_WAIT_MS = 15 * 60 * 1000;
/** 期限がこれより近い鍵は使わない */
const EXPIRY_MARGIN_MS = 60 * 1000;

/** ログインの画面の URL。state は、戻りがこのアプリから始めたログインのものかを確かめる印 */
export function buildAuthUrl(clientId: string, redirectUri: string, state: string): string {
  const q = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: 'token', scope: DRIVE_SCOPE, state });
  return `${AUTH_ENDPOINT}?${q}`;
}

export interface LoginReturn {
  state: string;
  error: string;
  token: string;
  expiresIn: number;
  scope: string;
}

/** URL の # の後ろが、ログインの戻りなら中身（アプリの画面の URL なら null） */
export function parseLoginReturn(hash: string): LoginReturn | null {
  if (hash === '' || hash.startsWith('#/')) return null;
  const q = new URLSearchParams(hash.slice(1));
  if (!q.has('state') || !(q.has('access_token') || q.has('error'))) return null;
  return {
    state: q.get('state') ?? '',
    error: q.get('error') ?? '',
    token: q.get('access_token') ?? '',
    expiresIn: Number(q.get('expires_in') ?? 0),
    scope: q.get('scope') ?? '',
  };
}

/** 受け取った鍵（端末の中だけに置く。バックアップには入れない） */
export interface DriveToken {
  token: string;
  expiresAt: number;
}

export type LoginResult = { ok: true; token: DriveToken } | { ok: false; message: string };

/** 戻りを受け付けるか。sent は、ログインの画面へ行くときに覚えた印 */
export function acceptLoginReturn(r: LoginReturn, sent: { state: string; at: number } | null, now: number): LoginResult {
  if (!sent || sent.state !== r.state || now - sent.at > LOGIN_WAIT_MS) {
    return { ok: false, message: 'このアプリから始めたログインか確かめられませんでした。もう一度［Google にログインして確かめる］を押してください。' };
  }
  if (r.error === 'access_denied') return { ok: false, message: 'ログイン（または許可）が取りやめられました。' };
  if (r.error) return { ok: false, message: `Google からエラーが返りました（${r.error}）。` };
  if (!r.token || !(r.expiresIn > 0)) return { ok: false, message: 'Google から鍵を受け取れませんでした。もう一度ためしてください。' };
  if (!r.scope.split(' ').includes(DRIVE_SCOPE)) {
    return { ok: false, message: 'ドライブを使う許可がありませんでした。もう一度ログインして、ドライブの項目にチェックを入れてください。' };
  }
  return { ok: true, token: { token: r.token, expiresAt: now + r.expiresIn * 1000 } };
}

/** 覚えてある鍵の文字から、まだ使える鍵（無ければ null） */
export function usableToken(stored: string | null, now: number): DriveToken | null {
  if (!stored) return null;
  try {
    const t = JSON.parse(stored) as Partial<DriveToken>;
    if (typeof t.token !== 'string' || typeof t.expiresAt !== 'number' || t.expiresAt - now <= EXPIRY_MARGIN_MS) return null;
    return { token: t.token, expiresAt: t.expiresAt };
  } catch {
    return null;
  }
}
