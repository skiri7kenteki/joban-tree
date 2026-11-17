// 研究手順（段階7-2）の小窓：保存する・直す（名前とメモ）、終わりの局面で見る（メモ・直す・消す）。

import { useState } from 'preact/hooks';
import { Dialog } from '../components/Dialog';
import { checkStudyFields, type Study } from '../tree/studies';

/** 保存する（study が無い）・直す（study がある）。onSave で名前とメモを返す */
export function StudyEditDialog({
  study,
  defaultName,
  movesText,
  onSave,
  onClose,
}: {
  study: Study | null;
  defaultName: string;
  /** 手順の文（例：「▲７六歩 △３四歩 ▲２六歩」） */
  movesText: string;
  onSave: (f: { name: string; note: string }) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(study?.name ?? defaultName);
  const [note, setNote] = useState(study?.note ?? '');
  const [error, setError] = useState('');

  function save() {
    const problem = checkStudyFields({ name, note });
    if (problem) {
      setError(problem);
      return;
    }
    onSave({ name, note });
  }

  return (
    <Dialog title={study ? '研究手順を直す' : '研究手順として保存'} onClose={onClose} testId="study-dialog">
      {study && <p class="muted">この手順は、もう研究手順として保存してあります。名前とメモを直せます。</p>}
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

/** 研究手順の終わりの局面で「★ 名前」を押したとき：メモを見る・直す・消す（確認あり） */
export function StudyViewDialog({
  study,
  onEdit,
  onDelete,
  onClose,
}: {
  study: Study;
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
          <button type="button" class="btn btn-primary" data-testid="study-edit" onClick={onEdit}>
            直す
          </button>
          <button type="button" class="btn btn-danger" data-testid="study-delete" onClick={() => setConfirm(true)}>
            消す…
          </button>
        </div>
      ) : (
        <div class="dialog-actions">
          <span>この研究手順を消しますか？（ツリーの手や局面は消えません）</span>
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

function formatDate(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
