// ［Google ドライブで同期］を押したときの本物の同期（段階22-3）。流れは src/drive/sync.ts に、通信は api.ts、保存は storage/backup.ts

import { mergeFromBackups, readAllData } from '../storage/backup';
import { downloadFile, listFiles, uploadFile } from './api';
import { currentToken, forgetToken } from './session';
import { loadSyncState, markSynced, saveSyncState } from './state';
import { studyChangesOf, syncOnce, type SyncOutcome } from './sync';

/** 中身の印（同じ中身かを見るだけ） */
async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function runSync(token: string, appVersion: string): Promise<SyncOutcome> {
  const outcome = await syncOnce({
    appVersion,
    now: () => Date.now(),
    hash: sha256,
    list: () => listFiles(token),
    download: (id) => downloadFile(token, id),
    upload: (id, name, text) => uploadFile(token, id, name, text),
    readData: readAllData,
    apply: async (incoming) => {
      const { before, after, result } = await mergeFromBackups(incoming, appVersion);
      return { before, after, changes: studyChangesOf(result) };
    },
    loadState: loadSyncState,
    saveState: saveSyncState,
  });
  if (outcome.ok) markSynced();
  else if (outcome.loggedOut && currentToken()?.token === token) forgetToken();
  return outcome;
}
