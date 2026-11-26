// 設定の「データ」の欄（段階17、v0.41.0〜。持ち主の依頼書 stage17-prompt・判断 2026-11-23「おすすめの通りで」）と、
// 定跡帳の一覧の上の「しばらくバックアップしていません」の知らせ。
// - データの保護：守られています／守られていません（navigator.storage.persisted）。守られていなければ説明と［守るように頼む］
// - ［バックアップを保存］：研究手順・ツリー・復習の記録・自分で登録した戦型・実戦の棋譜（段階18）・設定を 1 つの JSON にして、共有の画面（使えなければダウンロード）へ。
//   iPhone/iPad は「押した直後」でないと共有を断るので、ファイルの中身は画面を開いたときに作っておく（押したときに await を挟まない）
// - ［バックアップから戻す］：ファイルを選ぶ → 中身の数を見せる → 「今のデータを全部置きかえる」を確かめてから戻す。戻す前のデータは端末の中に取っておく
// - ［戻す前のデータに戻す］：戻したことがあるときだけ。戻したあとはアプリを読み込み直す
// - ［ほかの端末のバックアップを合わせる］（段階22-2）：ファイルを選ぶ → この端末で変わる数と消える研究手順を見せる（MergeSummary）→ 合わせる。
//   合わせる前のデータは「戻す」と同じく端末の中に取っておく
// - ［研究手順を書き出す］（段階20-3 で定跡帳のタブの右上から移した）：選んで JSON・KIF（StudyExportDialog）。研究手順があるときだけ

import { useEffect, useRef, useState } from 'preact/hooks';
import { Dialog } from '../components/Dialog';
import { APP_VERSION } from '../components/Footer';
import { currentBackup, hideNudgeUntil, lastBackupAt, loadSnapshot, markBackedUp, mergeFromBackup, nudgeHiddenUntilStored, readAllData, restoreFromBackup } from '../storage/backup';
import { mergeBackups, type MergeResult } from '../tree/merge';
import { MergeSummary } from './MergeSummary';
import { askPersist, persistState, type PersistState } from '../storage/persist';
import {
  KIND_LABELS,
  backupCounts,
  backupFileName,
  backupToJson,
  nudgeHiddenUntil,
  parseBackupJson,
  shouldNudge,
  type BackupFile,
} from '../tree/backupFile';
import type { Study } from '../tree/types';
import { isGenerating } from './generation';
import { settings } from './settings';
import { go } from './router';
import { shareFile } from './share';
import { groupStudies } from '../tree/organize';
import { StudyExportDialog } from './StudyDialogs';
import { allTemplates, myTemplates, refreshMyTemplates } from './TemplateDialogs';
import { ensureStudies, library } from './studies';

/** 日付（11/23 13:05 の形） */
function shortDateTime(t: number): string {
  const d = new Date(t);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** ファイルの大きさ（約 2.3MB・約 120KB） */
function sizeText(bytes: number): string {
  if (bytes >= 1024 * 1024) return `約 ${(bytes / 1024 / 1024).toFixed(1)}MB`;
  return `約 ${Math.max(1, Math.round(bytes / 1024))}KB`;
}

const PERSIST_TEXT: Record<PersistState, string> = {
  persisted: '守られています',
  'not-persisted': '守られていません',
  unsupported: 'この端末では確かめられません',
};

/** 戻すかどうかを確かめる窓に出すもの */
interface Pending {
  file: BackupFile;
  unknownKinds: string[];
  /** 戻す前のデータ（端末の中）から戻すとき */
  fromSnapshot: boolean;
}

/** 合わせたあと読み込み直すので、一言を覚えておく */
const MERGED_NOTE_KEY = 'joban-tree.merged-note';

function takeMergedNote(): string {
  try {
    const note = sessionStorage.getItem(MERGED_NOTE_KEY) ?? '';
    sessionStorage.removeItem(MERGED_NOTE_KEY);
    return note;
  } catch {
    return '';
  }
}

export function DataSection() {
  const [persist, setPersist] = useState<PersistState | null>(null);
  const [prepared, setPrepared] = useState<{ text: string; bytes: number } | null>(null);
  const [last, setLast] = useState<number | null>(lastBackupAt());
  const [snapshotAt, setSnapshotAt] = useState<number | null>(null);
  const [message, setMessage] = useState(takeMergedNote);
  const [error, setError] = useState('');
  const [pending, setPending] = useState<Pending | null>(null);
  /** 合わせるかどうかを確かめているファイルと、合わせるとどうなるか */
  const [merging, setMerging] = useState<{ file: BackupFile; unknownKinds: string[]; result: MergeResult } | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const mergeFileRef = useRef<HTMLInputElement>(null);
  /** 研究手順の書き出しの窓 */
  const [exporting, setExporting] = useState(false);
  const studies = library.value ?? [];
  // 自分で登録した戦型のグループ分けにも使う（読み込み前なら読む）
  void myTemplates.value;

  useEffect(() => {
    void ensureStudies().catch(() => undefined);
    if (!myTemplates.value) void refreshMyTemplates().catch(() => undefined);
    void persistState().then(setPersist);
    loadSnapshot()
      .then((s) => setSnapshotAt(s ? s.createdAt : null))
      .catch(() => undefined);
  }, []);

  // 共有は押した直後でないと断られるので、ファイルの中身は先に作っておく。同じ画面で設定を変えたら作り直す
  const current = settings.value;
  useEffect(() => {
    let alive = true;
    currentBackup(APP_VERSION)
      .then((f) => {
        if (!alive) return;
        const text = backupToJson(f);
        setPrepared({ text, bytes: new Blob([text]).size });
      })
      .catch(() => alive && setError('データを読めませんでした。アプリを開き直してください。'));
    return () => {
      alive = false;
    };
  }, [current]);

  /** 保存する（共有の画面。使えなければダウンロード）。共有の前に await を挟まない */
  function save() {
    if (!prepared) return;
    setMessage('');
    void shareFile(backupFileName(), prepared.text, 'application/json').then((outcome) => {
      if (outcome === 'cancelled') return;
      const now = Date.now();
      markBackedUp(now);
      setLast(now);
      setMessage(outcome === 'shared' ? 'バックアップを保存しました。' : 'バックアップのファイルをダウンロードしました。');
    });
  }

  async function pick(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    setMessage('');
    setError('');
    const parsed = parseBackupJson(await file.text());
    if (!parsed.ok) {
      setError(parsed.message);
      return;
    }
    setPending({ file: parsed.file, unknownKinds: parsed.unknownKinds, fromSnapshot: false });
  }

  async function pickMerge(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    setMessage('');
    setError('');
    try {
      const parsed = parseBackupJson(await file.text(), 'merge');
      if (!parsed.ok) {
        setError(parsed.message);
        return;
      }
      setMerging({ file: parsed.file, unknownKinds: parsed.unknownKinds, result: mergeBackups(await readAllData(), parsed.file.data) });
    } catch {
      setError('データを読めませんでした。アプリを開き直してから、もう一度ためしてください。');
    }
  }

  async function merge() {
    if (!merging) return;
    if (isGenerating()) {
      setMerging(null);
      setError('ツリーを生成しています。止めるか終わってから合わせてください。');
      return;
    }
    setBusy(true);
    try {
      await mergeFromBackup(merging.file.data, APP_VERSION);
      try {
        sessionStorage.setItem(MERGED_NOTE_KEY, 'ほかの端末のバックアップを合わせました。');
      } catch {
        // 覚えられなくても、合わせることはできている
      }
      location.reload();
    } catch {
      setBusy(false);
      setMerging(null);
      setError('合わせられませんでした（データは変えていません）。アプリを開き直してから、もう一度ためしてください。');
    }
  }

  async function openSnapshot() {
    setMessage('');
    setError('');
    const s = await loadSnapshot().catch(() => null);
    if (!s) {
      setError('戻す前のデータが見つかりませんでした。');
      return;
    }
    setPending({ file: s, unknownKinds: [], fromSnapshot: true });
  }

  async function restore() {
    if (!pending) return;
    if (isGenerating()) {
      setPending(null);
      setError('ツリーを生成しています。止めるか終わってから戻してください。');
      return;
    }
    setBusy(true);
    try {
      await restoreFromBackup(pending.file.data, APP_VERSION);
      // 画面に残っている古い一覧を確実に入れ替えるため、読み込み直す
      location.reload();
    } catch {
      setBusy(false);
      setPending(null);
      setError('戻せませんでした（データは変えていません）。アプリを開き直してから、もう一度ためしてください。');
    }
  }

  async function ask() {
    await askPersist();
    setPersist(await persistState());
  }

  return (
    <section class="card settings-section" data-testid="data-section">
      <h2>データ</h2>
      <div class="data-row">
        <span>データの保護</span>
        <strong class={persist === 'persisted' ? 'status-ok' : persist === 'not-persisted' ? 'status-ng' : ''} data-testid="persist-state" data-state={persist ?? ''}>
          {persist ? PERSIST_TEXT[persist] : '…'}
        </strong>
      </div>
      {persist && persist !== 'persisted' && (
        <>
          <p class="muted" data-testid="persist-help">
            端末の空きが少ないときや、Safari で長く開かなかったときに、ブラウザがこのアプリのデータを消すことがあります。ホーム画面に追加して開くと守られやすくなります。
            念のため、ときどき［バックアップを保存］してください。
          </p>
          {persist === 'not-persisted' && (
            <button type="button" class="btn" data-testid="persist-ask" onClick={() => void ask()}>
              守るように頼む
            </button>
          )}
        </>
      )}

      <div class="data-row">
        <span>最後にバックアップした日</span>
        <span class="num" data-testid="last-backup">
          {last ? shortDateTime(last) : 'まだありません'}
        </span>
      </div>
      <div class="data-buttons">
        <button type="button" class="btn btn-primary btn-wide" data-testid="backup-save" disabled={!prepared} onClick={save}>
          {prepared ? `バックアップを保存（${sizeText(prepared.bytes)}）` : 'バックアップを準備中…'}
        </button>
        <button type="button" class="btn btn-wide" data-testid="backup-merge" onClick={() => mergeFileRef.current?.click()}>
          ほかの端末のバックアップを合わせる
        </button>
        <p class="muted data-hint">2 台をそろえるには、合わせた端末で保存して、もう 1 台でも合わせます。</p>
        <button type="button" class="btn btn-wide" data-testid="backup-restore" onClick={() => fileRef.current?.click()}>
          バックアップから戻す
        </button>
        {snapshotAt !== null && (
          <button type="button" class="btn btn-wide" data-testid="snapshot-restore" onClick={() => void openSnapshot()}>
            戻す前のデータに戻す（{shortDateTime(snapshotAt)}）
          </button>
        )}
      </div>
      <input ref={fileRef} type="file" accept="application/json,.json" hidden data-testid="backup-restore-file" onChange={(e) => void pick(e)} />
      <input ref={mergeFileRef} type="file" accept="application/json,.json" hidden data-testid="backup-merge-file" onChange={(e) => void pickMerge(e)} />
      {merging && (
        <Dialog title="ほかの端末と合わせる" onClose={() => !busy && setMerging(null)} testId="backup-merge-dialog">
          <MergeSummary file={merging.file} unknownKinds={merging.unknownKinds} result={merging.result} when={shortDateTime(merging.file.createdAt)} />
          <div class="btn-row">
            <button type="button" class="btn btn-primary" data-testid="backup-merge-confirm" disabled={busy} onClick={() => void merge()}>
              {busy ? '合わせています…' : '合わせる'}
            </button>
            <button type="button" class="btn" disabled={busy} onClick={() => setMerging(null)}>
              やめる
            </button>
          </div>
        </Dialog>
      )}
      {studies.length > 0 && (
        <div class="data-buttons">
          <button type="button" class="btn btn-wide" data-testid="study-export-open" onClick={() => setExporting(true)}>
            研究手順を書き出す（JSON・KIF）
          </button>
        </div>
      )}
      {exporting && <StudyExportDialog groups={groupStudies(studies, allTemplates())} onClose={() => setExporting(false)} />}
      {message && (
        <p class="muted" role="status" data-testid="backup-message">
          {message}
        </p>
      )}
      {error && (
        <p class="status-ng" role="alert" data-testid="backup-error">
          {error}
        </p>
      )}

      {pending && (
        <Dialog title={pending.fromSnapshot ? '戻す前のデータに戻す' : 'バックアップから戻す'} onClose={() => !busy && setPending(null)} testId="backup-restore-dialog">
          <RestoreSummary pending={pending} />
          <div class="btn-row">
            <button type="button" class="btn btn-danger" data-testid="backup-restore-confirm" disabled={busy} onClick={() => void restore()}>
              {busy ? '戻しています…' : '今のデータを全部置きかえる'}
            </button>
            <button type="button" class="btn" disabled={busy} onClick={() => setPending(null)}>
              やめる
            </button>
          </div>
        </Dialog>
      )}
    </section>
  );
}

/** 戻す前の確認：いつのデータか、中身の数、置きかえることの説明 */
function RestoreSummary({ pending }: { pending: Pending }) {
  const c = backupCounts(pending.file.data);
  return (
    <div data-testid="backup-restore-summary">
      <p>
        {shortDateTime(pending.file.createdAt)} のデータです（アプリ v{pending.file.appVersion}）。
      </p>
      <ul class="data-counts">
        <li>研究手順 {c.studies} 本</li>
        <li>ツリー {c.trees} 本</li>
        <li>復習の記録 {c.reviewProblems} 問</li>
        <li>自分で登録した戦型 {c.templates} 個</li>
        <li>実戦 {c.games} 局</li>
        <li>稽古の記録 {c.practice} 本</li>
        <li>局面メモ {c.positions} 個</li>
        <li>候補の表 {c.tables} 局面</li>
        <li>設定 {c.prefs > 0 ? 'あり' : 'なし（初期値のまま）'}</li>
      </ul>
      {pending.unknownKinds.length > 0 && (
        <p class="notice" data-testid="backup-unknown">
          このファイルには、この版のアプリが知らないデータ（{pending.unknownKinds.map((k) => KIND_LABELS[k] ?? k).join('・')}）があります。戻すとそれは入りません。
        </p>
      )}
      <p>
        今の研究手順・ツリー・復習と稽古の記録・戦型・実戦・設定は、全部このデータに置きかわります。
        {pending.fromSnapshot ? '今のデータは、また［戻す前のデータに戻す］で元に戻せます。' : '戻す前のデータは端末の中に取っておき、［戻す前のデータに戻す］で元に戻せます。'}
      </p>
      <p class="muted">このあと、ほかの端末のバックアップを合わせると、相手にあるものはまた入ります。</p>
    </div>
  );
}

/** 定跡帳の一覧の上の「しばらくバックアップしていません」（閉じたら 30 日は出さない） */
export function BackupNudge({ studies }: { studies: readonly Study[] }) {
  const [hidden, setHidden] = useState(false);
  if (hidden || !shouldNudge(Date.now(), studies, lastBackupAt(), nudgeHiddenUntilStored())) return null;
  return (
    <div class="notice backup-nudge" role="status" data-testid="backup-nudge">
      <span class="backup-nudge-text">しばらくバックアップしていません</span>
      <button type="button" class="btn btn-ghost" data-testid="backup-nudge-open" onClick={() => go('/settings')}>
        設定で保存
      </button>
      <button
        type="button"
        class="btn btn-ghost backup-nudge-close"
        aria-label="閉じる（30 日は出しません）"
        data-testid="backup-nudge-close"
        onClick={() => {
          hideNudgeUntil(nudgeHiddenUntil(Date.now()));
          setHidden(true);
        }}
      >
        ×
      </button>
    </div>
  );
}
