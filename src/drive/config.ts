// Google ドライブを使うための番号（段階22-3）。作り方は docs/google-drive-setup.md。

/**
 * Google Cloud で作った「ウェブ アプリケーション」の OAuth クライアント ID。**秘密ではない**（コードに書いてよい）。
 * 空の間は、設定の画面に Google ドライブの欄を出さない
 */
const GOOGLE_CLIENT_ID = '';

/** 画面の通し確認（e2e）で、仮の番号を入れるための名前（ふだんは使わない） */
const TEST_KEY = 'joban-tree.drive-client-id';

export function driveClientId(): string {
  try {
    return GOOGLE_CLIENT_ID || (localStorage.getItem(TEST_KEY) ?? '');
  } catch {
    return GOOGLE_CLIENT_ID;
  }
}
