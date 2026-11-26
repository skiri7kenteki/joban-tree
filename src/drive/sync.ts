// Google ドライブの同期の流れ（段階22-3、v0.51.0。持ち主の依頼と判断 2026-11-26）。通信と保存は SyncPort で受け取る
// （本物は src/drive/api.ts と src/drive/run.ts。テストは偽物を渡す）。
//
// - ドライブのアプリ専用の場所に、**端末ごとに 1 つ**ファイルを置く。各端末は自分のファイルだけを書く（同時に押しても、相手の結果を上書きしない）
// - **前に読んだときから変わったファイルだけ**を読んで合わせる。合わせ済みのファイルをもう一度合わせると、
//   そのあと指し直した手順の前の形が、別の研究手順としてよみがえるため（自分が送ったファイルも、送ったら「読んだ」ことにする）
// - 中身が前に送ったものと同じなら送らない（送ると、ほかの端末がもう一度読むことになる）
// - 全部読めて形を確かめられるまで、この端末のデータは変えない

import { parseBackupJson, backupToJson, makeBackup, type BackupData } from '../tree/backupFile';
import type { MergeResult } from '../tree/merge';

/** ドライブのファイル 1 つ（アプリ専用の場所の一覧） */
export interface RemoteFile {
  id: string;
  name: string;
  modifiedTime: string;
  md5Checksum?: string;
}

/** この端末が覚えておくこと */
export interface SyncState {
  /** この端末のファイルを見分ける名前 */
  deviceId: string;
  /** 合わせ済みのファイル（ファイルの id → そのときの印） */
  seen: Record<string, string>;
  /** 前に送った中身の印 */
  uploadedHash: string;
}

export interface SyncPort {
  appVersion: string;
  now(): number;
  hash(text: string): Promise<string>;
  list(): Promise<RemoteFile[]>;
  download(fileId: string): Promise<string>;
  /** fileId が null なら新しく作る */
  upload(fileId: string | null, name: string, text: string): Promise<RemoteFile>;
  readData(): Promise<BackupData>;
  /** ほかの端末の中身を順に合わせて、この端末に書く（変わるときは、前のデータを取っておく） */
  apply(incoming: BackupData[]): Promise<{ before: BackupData; after: BackupData; changes: StudyChanges }>;
  loadState(): SyncState;
  saveState(state: SyncState): void;
}

/** ドライブの通信の失敗（message は画面に出す日本語） */
export class DriveError extends Error {
  constructor(
    message: string,
    readonly loggedOut = false,
  ) {
    super(message);
  }
}

const reasonOf = (e: unknown) => (e instanceof DriveError ? e.message : 'うまくいきませんでした。アプリを開き直してから、もう一度ためしてください。');

const FILE_NAME = /^joban-tree-sync-[\w-]+\.json$/;

export function syncFileName(deviceId: string): string {
  return `joban-tree-sync-${deviceId}.json`;
}

/** ファイルの中身が変わったかを見る印 */
export function stampOf(f: RemoteFile): string {
  return `${f.modifiedTime} ${f.md5Checksum ?? ''}`;
}

const byName = (a: RemoteFile, b: RemoteFile) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id);

/** 読むファイル：このアプリの同期のファイルで、合わせ済みのときから変わったもの */
export function filesToRead(files: readonly RemoteFile[], seen: Readonly<Record<string, string>>): RemoteFile[] {
  return files.filter((f) => FILE_NAME.test(f.name) && seen[f.id] !== stampOf(f)).sort(byName);
}

/** 中身を比べるための文字（並び順の違いは同じとみなす。設定は入れない） */
function dataText(data: BackupData): string {
  const sorted = (list: readonly unknown[]) => list.map((x) => JSON.stringify(x)).sort();
  const { prefs: _prefs, ...kinds } = data;
  void _prefs;
  return JSON.stringify(
    Object.entries(kinds)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([kind, list]) => [kind, sorted(list)]),
  );
}

/** 研究や記録が 1 つも無い */
function isEmpty(d: BackupData): boolean {
  return [d.studies, d.trees, d.games, d.positions, d.templates, d.practice, d.reviews].every((list) => list.length === 0);
}

/** 同期で、この端末の研究手順がどう変わったか。数え方は合わせる計算（`merge.ts`）のもの：1 本にまとまった・id が分かれたものは「消えた」にしない */
export interface StudyChanges {
  added: number;
  changed: number;
  /** 消えた研究手順の名前 */
  removed: string[];
  /** 手が消えた・指し直された研究手順 */
  shortened: { name: string; from: number; to: number }[];
}

export function studyChangesOf(r: MergeResult): StudyChanges {
  return { added: r.summary.studies.added, changed: r.summary.studies.updated, removed: r.removedStudies, shortened: r.shortened };
}

/** 同期できたときに出す文。dataChanged：この端末のデータが何か変わった */
export function syncMessage(c: StudyChanges, dataChanged: boolean): string {
  if (!dataChanged) return '同期しました。この端末のデータは変わりません。';
  if (c.added + c.changed + c.removed.length === 0) return '同期しました。研究手順のほかのデータを合わせました。';
  let text = `同期しました。研究手順：足した ${c.added} 本・変わった ${c.changed} 本・消えた ${c.removed.length} 本。`;
  if (c.removed.length > 0) text += `消えた研究手順：${c.removed.join('、')}。`;
  if (c.shortened.length > 0) text += `手が消えた・指し直された研究手順：${c.shortened.map((s) => `${s.name}（${s.from}手 → ${s.to}手）`).join('、')}。`;
  return text;
}

export type SyncOutcome =
  | { ok: true; changes: StudyChanges; changedHere: boolean }
  | { ok: false; message: string; loggedOut: boolean; changedHere: boolean };

/** 1 回の同期：読む → 合わせる → 書き戻す */
export async function syncOnce(port: SyncPort): Promise<SyncOutcome> {
  let changedHere = false;
  let changes: StudyChanges = { added: 0, changed: 0, removed: [], shortened: [] };
  const fail = (message: string, e?: unknown): SyncOutcome => ({ ok: false, message, loggedOut: e instanceof DriveError && e.loggedOut, changedHere });
  try {
    const state = port.loadState();
    const files = await port.list();
    // この端末のデータが空（消えた・入れ直した）なら、合わせ済みの覚えは使わない。空のまま送ると、ドライブの中身が消える
    const known = isEmpty(await port.readData()) ? {} : state.seen;
    // 全部読んで確かめてから合わせる
    const toRead = filesToRead(files, known);
    const incoming: BackupData[] = [];
    for (const f of toRead) {
      const parsed = parseBackupJson(await port.download(f.id), 'merge');
      if (!parsed.ok) return fail(`ドライブのデータを読めなかったので、何も変えていません。${parsed.message}`);
      incoming.push(parsed.file.data);
    }
    if (incoming.length > 0) {
      const applied = await port.apply(incoming);
      changedHere = dataText(applied.before) !== dataText(applied.after);
      changes = applied.changes;
    }
    const seen = { ...state.seen };
    for (const f of toRead) seen[f.id] = stampOf(f);
    port.saveState({ ...state, seen });

    const data: BackupData = { ...(await port.readData()), prefs: {} };
    const hash = await port.hash(dataText(data));
    const name = syncFileName(state.deviceId);
    const own = files.filter((f) => f.name === name).sort(byName)[0];
    // 自分のファイルが無い・覚えている形と違う・中身が前に送ったものと違うときに送る
    if (!own || known[own.id] !== stampOf(own) || hash !== state.uploadedHash) {
      try {
        const sent = await port.upload(own?.id ?? null, name, backupToJson(makeBackup(data, port.now(), port.appVersion)));
        port.saveState({ ...state, seen: { ...seen, [sent.id]: stampOf(sent) }, uploadedHash: hash });
      } catch (e) {
        return fail(`${changedHere ? 'この端末には合わせましたが、' : ''}ドライブに送れませんでした。${reasonOf(e)}`, e);
      }
    }
    return { ok: true, changes, changedHere };
  } catch (e) {
    return fail(reasonOf(e), e);
  }
}

const DAY = 24 * 60 * 60 * 1000;

/** 「前の同期から 1 日以上」の一言を出すか（一度も同期していなければ出さない） */
export function shouldSyncNudge(now: number, lastSyncAt: number | null, hiddenUntil: number | null): boolean {
  if (lastSyncAt === null || (hiddenUntil !== null && now < hiddenUntil)) return false;
  return now - lastSyncAt >= DAY;
}
