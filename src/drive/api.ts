// Google ドライブの REST API を fetch で呼ぶ（段階22-3。Google の JavaScript もライブラリも使わない）。
// 使うのはアプリ専用の見えない場所（appDataFolder）だけ。service worker は別の場所への通信に触らないので、キャッシュされない

import { DriveError, type RemoteFile } from './sync';

const FILES = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const FIELDS = 'id,name,modifiedTime,md5Checksum';
/** 返事を待つ時間（止まったまま操作できなくならないように）。中身を送るときは長めにする */
const WAIT_MS = 60 * 1000;
const SEND_WAIT_MS = 5 * 60 * 1000;

/** 通信 1 回。失敗は、画面に出す理由を付けた DriveError にする */
async function call(token: string, url: string, init: RequestInit = {}, wait = WAIT_MS): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, cache: 'no-store', signal: AbortSignal.timeout(wait), headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}` } });
  } catch {
    throw new DriveError('Google ドライブにつながりませんでした。ネットにつながっているか確かめてください。');
  }
  if (res.ok) return res;
  if (res.status === 401) throw new DriveError('ログインの期限が切れました。もう一度［Google ドライブで同期］を押してください。', true);
  const body = await res.text().catch(() => '');
  if (body.includes('storageQuotaExceeded')) throw new DriveError('Google ドライブの空きがありません。');
  throw new DriveError(`Google ドライブが使えませんでした（${res.status}）。少し待ってから、もう一度ためしてください。`);
}

const unreadable = () => new DriveError('Google ドライブの返事が読めませんでした。');

async function json(res: Response): Promise<Record<string, unknown>> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    throw unreadable();
  }
}

function remoteFile(raw: unknown): RemoteFile {
  const f = raw as Partial<RemoteFile> | null;
  if (!f || typeof f.id !== 'string' || typeof f.name !== 'string' || typeof f.modifiedTime !== 'string') throw unreadable();
  return { id: f.id, name: f.name, modifiedTime: f.modifiedTime, md5Checksum: f.md5Checksum };
}

/** アプリ専用の場所のファイルの一覧（全部） */
export async function listFiles(token: string): Promise<RemoteFile[]> {
  const out: RemoteFile[] = [];
  let page = '';
  do {
    const q = new URLSearchParams({ spaces: 'appDataFolder', fields: `nextPageToken,files(${FIELDS})`, pageSize: '100', ...(page ? { pageToken: page } : {}) });
    const body = await json(await call(token, `${FILES}?${q}`));
    if (!Array.isArray(body.files)) throw unreadable();
    out.push(...body.files.map(remoteFile));
    page = typeof body.nextPageToken === 'string' ? body.nextPageToken : '';
  } while (page);
  return out;
}

export async function downloadFile(token: string, id: string): Promise<string> {
  const res = await call(token, `${FILES}/${encodeURIComponent(id)}?alt=media`);
  try {
    return await res.text();
  } catch {
    throw new DriveError('Google ドライブから読む途中で切れました。もう一度ためしてください。');
  }
}

/**
 * ファイルを書く（id が null なら新しく作る）。大きいツリーがあっても送れるように、2 回に分ける送り方（resumable）にする：
 * 先に送り先をもらい、そこへ中身を送る。送り終わるまでファイルは変わらない（途中で切れても、半分のファイルにならない）
 */
export async function uploadFile(token: string, id: string | null, name: string, text: string): Promise<RemoteFile> {
  const url = `${UPLOAD}${id ? `/${encodeURIComponent(id)}` : ''}?uploadType=resumable&fields=${FIELDS}`;
  const started = await call(token, url, {
    method: id ? 'PATCH' : 'POST',
    headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': 'application/json' },
    body: JSON.stringify(id ? {} : { name, parents: ['appDataFolder'] }),
  });
  const session = started.headers.get('Location');
  // 鍵を付けて送るので、送り先が Google でなければ使わない
  if (!session || !session.startsWith('https://www.googleapis.com/')) throw new DriveError('Google ドライブの送り先が受け取れませんでした。');
  return remoteFile(await json(await call(token, session, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: text }, SEND_WAIT_MS)));
}
