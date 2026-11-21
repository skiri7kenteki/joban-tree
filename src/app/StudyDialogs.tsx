// 研究手順の小窓。
// - StudyEditDialog：保存する（study が無い）・直す（study がある）。名前・メモ・自分の側
// - StudyViewDialog：ツリーの閲覧画面で、研究手順の終わりの局面の「★ 名前」を押したとき（メモ・定跡帳で開く・直す・消す）
// - StudyExportDialog：研究手順を選んで書き出す（JSON・KIF。段階8-1）
// - shareStudies：研究手順を JSON・KIF のファイルで共有する（共有メニューは「押した直後」でないと出ないので、中身は待たずに作る）

import { useState } from 'preact/hooks';
import { Dialog } from '../components/Dialog';
import type { Side } from '../shogi/position';
import { dateStamp, fileNameOf } from '../tree/backup';
import { checkStudyFields, type Study } from '../tree/studies';
import { studiesToJson, studiesToKif } from '../tree/studyFile';
import type { TreeGroup } from '../tree/organize';
import { OUTCOME_TEXT, shareFile, type ShareOutcome } from './share';

const SIDE_TEXT: Record<Side, string> = { black: '☗先手', white: '☖後手' };

/** 保存する（study が無い）・直す（study がある）。onSave で名前・メモ・自分の側を返す */
export function StudyEditDialog({
  study,
  defaultName,
  movesText,
  side,
  hideSide = false,
  onSave,
  onClose,
}: {
  study: Study | null;
  defaultName: string;
  /** 手順の文（例：「横歩取り △3三角 → ▲３六飛 △８四飛」） */
  movesText: string;
  /** 自分の側の初期値（直すときは研究手順の側） */
  side: Side;
  /** 自分の側を出さない（定跡帳から直すとき。側を変えると別の定跡帳へ移ってしまうので。段階10-1） */
  hideSide?: boolean;
  onSave: (f: { name: string; note: string; mySide: Side }) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(study?.name ?? defaultName);
  const [note, setNote] = useState(study?.note ?? '');
  const [mySide, setMySide] = useState<Side>(study?.mySide ?? side);
  const [error, setError] = useState('');

  function save() {
    const problem = checkStudyFields({ name, note });
    if (problem) {
      setError(problem);
      return;
    }
    onSave({ name, note, mySide });
  }

  return (
    <Dialog title={study ? '研究手順を直す' : '研究手順として保存'} onClose={onClose} testId="study-dialog">
      <p class="study-moves muted" data-testid="study-moves">
        {movesText}
      </p>
      <label class="form-field">
        <span>名前</span>
        <input type="text" value={name} maxLength={100} data-testid="study-name" onInput={(e) => setName((e.target as HTMLInputElement).value)} />
      </label>
      <label class="form-field">
        <span>メモ</span>
        <textarea
          class="study-note-input"
          rows={5}
          value={note}
          maxLength={3000}
          placeholder="狙い・注意する手・参考にした棋譜など"
          data-testid="study-note"
          onInput={(e) => setNote((e.target as HTMLTextAreaElement).value)}
        />
      </label>
      {!hideSide && (
        <div class="side-choice" role="radiogroup" aria-label="自分は">
          <span>自分は</span>
          {(['black', 'white'] as Side[]).map((s) => (
            <button
              type="button"
              key={s}
              role="radio"
              aria-checked={mySide === s}
              data-testid={`study-side-${s}`}
              class={mySide === s ? 'btn btn-toggle on' : 'btn btn-toggle'}
              onClick={() => setMySide(s)}
            >
              {SIDE_TEXT[s]}
            </button>
          ))}
        </div>
      )}
      {error && (
        <p class="status-ng" role="alert">
          {error}
        </p>
      )}
      <div class="dialog-actions">
        <button type="button" class="btn btn-primary" data-testid="study-save" onClick={save}>
          保存する
        </button>
        <button type="button" class="btn" onClick={onClose}>
          やめる
        </button>
      </div>
    </Dialog>
  );
}

/** ツリーの研究手順の終わりの局面で「★ 名前」を押したとき：メモを見る・研究手順の画面で開く・直す・消す（確認あり） */
export function StudyViewDialog({
  study,
  onOpen,
  onEdit,
  onDelete,
  onClose,
}: {
  study: Study;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  return (
    <Dialog title={`★ ${study.name}`} onClose={onClose} testId="study-view">
      {study.note ? (
        <p class="study-note" data-testid="study-view-note">
          {study.note}
        </p>
      ) : (
        <p class="muted">メモはありません。</p>
      )}
      <p class="muted num">{formatDate(study.updatedAt)} に保存</p>
      {!confirm ? (
        <div class="dialog-actions">
          <button type="button" class="btn btn-primary" data-testid="study-view-open" onClick={onOpen}>
            定跡帳で開く
          </button>
          <button type="button" class="btn" data-testid="study-edit" onClick={onEdit}>
            直す
          </button>
          <button type="button" class="btn btn-danger" data-testid="study-delete" onClick={() => setConfirm(true)}>
            消す…
          </button>
        </div>
      ) : (
        <div class="dialog-actions">
          <span>この研究手順を消しますか？元に戻せません（ツリーの手や局面は消えません）。</span>
          <button type="button" class="btn btn-danger" data-testid="study-delete-ok" onClick={onDelete}>
            消す
          </button>
          <button type="button" class="btn" onClick={() => setConfirm(false)}>
            やめる
          </button>
        </div>
      )}
    </Dialog>
  );
}

/** 研究手順を JSON・KIF のファイルで共有する（中身は待たずに作る） */
export function shareStudies(list: readonly Study[], kind: 'json' | 'kif'): Promise<ShareOutcome> {
  const base = list.length === 1 ? list[0].name : `研究手順-${dateStamp()}`;
  return kind === 'json'
    ? shareFile(fileNameOf(base, 'json'), studiesToJson(list), 'application/json')
    : shareFile(fileNameOf(base, 'kifu'), studiesToKif(list), 'text/plain');
}

/** 研究手順を選んで書き出す（グループごとのチェックの一覧。「全部選ぶ」「全部外す」） */
export function StudyExportDialog({
  groups,
  initial,
  onClose,
}: {
  groups: TreeGroup<Study>[];
  /** 初めに選んでおく研究手順の id（無ければ全部） */
  initial?: readonly string[];
  onClose: () => void;
}) {
  const all = groups.flatMap((g) => g.items);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initial ?? all.map((s) => s.id)));
  const [note, setNote] = useState('');
  const chosen = all.filter((s) => selected.has(s.id));

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  async function exportAs(kind: 'json' | 'kif') {
    if (chosen.length === 0) return;
    const outcome = await shareStudies(chosen, kind);
    if (outcome !== 'cancelled') setNote(OUTCOME_TEXT[outcome]);
  }

  return (
    <Dialog title="研究手順の書き出し" onClose={onClose} testId="study-export-dialog">
      <div class="btn-row">
        <button type="button" class="btn" data-testid="study-export-all" onClick={() => setSelected(new Set(all.map((s) => s.id)))}>
          全部選ぶ
        </button>
        <button type="button" class="btn" data-testid="study-export-none" onClick={() => setSelected(new Set())}>
          全部外す
        </button>
      </div>
      <div class="study-pick-list">
        {groups.map((g) => (
          <section key={g.key}>
            <h3 class="study-pick-group">{g.label}</h3>
            {g.items.map((s) => (
              <label key={s.id} class="study-pick-item">
                <input type="checkbox" checked={selected.has(s.id)} data-testid="study-export-check" onChange={() => toggle(s.id)} />
                <span>{s.name}</span>
              </label>
            ))}
          </section>
        ))}
      </div>
      <p class="muted" data-testid="study-export-count">
        {chosen.length} 本を選んでいます。
      </p>
      <div class="dialog-actions">
        <button type="button" class="btn btn-primary" data-testid="study-export-json" disabled={chosen.length === 0} onClick={() => void exportAs('json')}>
          JSONで渡す
        </button>
        <button type="button" class="btn" data-testid="study-export-kif" disabled={chosen.length === 0} onClick={() => void exportAs('kif')}>
          KIFで渡す
        </button>
      </div>
      {note && (
        <p class="muted" role="status">
          {note}
        </p>
      )}
    </Dialog>
  );
}

function formatDate(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
