// 段階25-1：変化付き KIF の取り込みの確認画面で、戦型を選ぶ・作る（計算は src/tree/importTemplate.ts）。
// - PickTemplateDialog：「戦型を選ぶ」。新しい戦型を作る／自動／今ある戦型（取り込む手順が全部通るものだけ選べる）
// - CreateTemplateDialog：「新しい戦型を作る」。名前・グループ・出発点（小さな盤を見ながら ‹ ›）。
//   ここでは保存しない（登録するのは「n 本を取り込む」を押したとき）

import { useState } from 'preact/hooks';
import { Board } from '../components/Board';
import { Dialog } from '../components/Dialog';
import type { Side } from '../shogi/position';
import { lacksOwnAfter, movedStudies, passesAll, startName, startRange } from '../tree/importTemplate';
import { startsWith } from '../tree/studies';
import { checkTemplateFields, closestTemplate, findSameMoves, newTemplateId, templateLine, type OpeningTemplate } from '../tree/templates';
import type { Study } from '../tree/types';
import { GroupChoices, allTemplates } from './TemplateDialogs';

/** 出発点より後に自分の手が無い手順があるときの注意（作る窓と確認の画面） */
export const NO_OWN_TEXT = '一部の手順は、出発点より後に自分の手がありません。その手順は稽古が初手からになり、定跡帳で出発点より前に戻れないことがあります。';

export function PickTemplateDialog({
  lines,
  side,
  autoName,
  onAuto,
  onPick,
  onCreate,
  onClose,
}: {
  /** 取り込む（チェックの付いた）手順 */
  lines: readonly (readonly string[])[];
  side: Side;
  /** 自動のときに行に出る名前 */
  autoName: string;
  onAuto: () => void;
  onPick: (t: OpeningTemplate) => void;
  onCreate: () => void;
  onClose: () => void;
}) {
  const canCreate = startRange(lines, side) !== null;
  const templates = allTemplates();
  // 選べるものを上に
  const ok = templates.filter((t) => passesAll(t, lines));
  const rows = [...ok, ...templates.filter((t) => !ok.includes(t))];
  return (
    <Dialog title="戦型を選ぶ" onClose={onClose} testId="import-pick" sheet>
      <button type="button" class="btn btn-primary btn-wide" data-testid="import-pick-new" disabled={!canCreate} onClick={onCreate}>
        ＋ 新しい戦型を作る
      </button>
      {!canCreate && (
        <p class="muted" data-testid="import-pick-nocommon">
          チェックした手順の初手が違うので、戦型は作れません。同じ戦型の手順だけにチェックを付けてください。
        </p>
      )}
      <p class="menu-section-title">今ある戦型から選ぶ</p>
      <ul class="template-list">
        <li>
          <button type="button" class="template-item" data-testid="import-pick-auto" onClick={onAuto}>
            <span class="template-item-main">
              <span class="template-item-name">自動（{autoName}）</span>
            </span>
          </button>
        </li>
        {rows.map((t) => {
          const can = ok.includes(t);
          return (
            <li key={t.id}>
              <button type="button" class="template-item" data-testid="import-pick-item" disabled={!can} onClick={() => onPick(t)}>
                <span class="template-item-main">
                  <span class="template-item-name">{t.name}</span>
                  <span class="template-item-note muted">{can ? t.group : '手順が合わないので選べません'}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {ok.length < templates.length && <p class="muted">チェックの付いた {lines.length} 本が全部通る戦型だけ選べます。</p>}
    </Dialog>
  );
}

export function CreateTemplateDialog({
  lines,
  mainLine,
  side,
  studies,
  onDone,
  onClose,
}: {
  lines: readonly (readonly string[])[];
  /** 盤で見せる手順（チェックの付いた最初の手順） */
  mainLine: readonly string[];
  side: Side;
  /** 今ある研究手順（一緒に移る数を出す） */
  studies: readonly Study[];
  /** created：新しい戦型。false なら、同じ手順の戦型がすでにあったのでそれ */
  onDone: (t: OpeningTemplate, created: boolean) => void;
  onClose: () => void;
}) {
  const range = startRange(lines, side)!;
  const [ply, setPly] = useState(range.initial);
  const moves = mainLine.slice(0, ply);
  const templates = allTemplates();
  /** 自分で直すまでは、名前は出発点に合わせて変わる */
  const [typedName, setTypedName] = useState<string | null>(null);
  const name = typedName ?? startName(moves);
  const [group, setGroup] = useState(() => closestTemplate(templates, mainLine.slice(0, range.initial))?.group ?? '');
  const [error, setError] = useState('');

  const replay = templateLine(moves);
  const position = replay.ok ? replay.line[replay.line.length - 1] : null;
  const same = findSameMoves(templates, moves);
  const draft: OpeningTemplate = { id: 'draft', name, group: group.trim(), mySide: side, moves, note: '', reviewed: true };
  // 取り込む手順と同じもの（すでにある）は数えない
  const others = studies.filter((s) => !lines.some((l) => l.length === s.moves.length && startsWith(s.moves, l)));
  const moved = same || !draft.group ? 0 : movedStudies(others, templates, draft).length;

  function done() {
    if (same) return onDone(same, false);
    const f = { name: name.trim(), group: group.trim(), note: '' };
    const problem = checkTemplateFields(f);
    if (problem) {
      setError(problem);
      return;
    }
    onDone({ ...draft, ...f, id: newTemplateId() }, true);
  }

  return (
    <Dialog title="新しい戦型を作る" onClose={onClose} testId="import-create" sheet>
      <label class="form-field">
        <span>名前</span>
        <input type="text" value={name} maxLength={100} data-testid="import-create-name" onInput={(e) => setTypedName((e.target as HTMLInputElement).value)} />
      </label>
      <label class="form-field">
        <span>グループ</span>
        <input
          type="text"
          value={group}
          maxLength={50}
          placeholder="例）角換わり"
          data-testid="import-create-group"
          onInput={(e) => setGroup((e.target as HTMLInputElement).value)}
        />
      </label>
      <GroupChoices value={group} onPick={setGroup} />
      <p class="menu-section-title">出発点（定跡帳と稽古はここから）</p>
      {position && (
        <div class="mini-board start-board">
          <Board sfen={position.sfen} lastMove={position.usi} />
        </div>
      )}
      <div class="start-step">
        <button type="button" class="btn" aria-label="出発点を 1 手前に" data-testid="import-create-prev" disabled={ply <= 1} onClick={() => setPly(ply - 1)}>
          ‹
        </button>
        <strong data-testid="import-create-ply">
          {ply}手目 {position?.text ?? ''}
        </strong>
        <button type="button" class="btn" aria-label="出発点を 1 手先に" data-testid="import-create-next" disabled={ply >= range.max} onClick={() => setPly(ply + 1)}>
          ›
        </button>
      </div>
      {lacksOwnAfter(lines, side, ply) && (
        <p class="notice" role="status" data-testid="import-create-warn">
          {NO_OWN_TEXT}
        </p>
      )}
      {same && (
        <p class="notice" role="status" data-testid="import-create-same">
          同じ局面の戦型「{same.name}」（{same.group}）がすでにあるので、それを使います。
        </p>
      )}
      {moved > 0 && (
        <p class="muted" data-testid="import-create-moved">
          今ある研究手順 {moved} 本も、このグループに移ります。
        </p>
      )}
      {error && (
        <p class="notice notice-danger" role="alert" data-testid="import-create-error">
          {error}
        </p>
      )}
      <div class="dialog-actions">
        <button type="button" class="btn btn-primary" data-testid="import-create-ok" onClick={done}>
          この戦型にする
        </button>
        <button type="button" class="btn" onClick={onClose}>
          やめる
        </button>
      </div>
    </Dialog>
  );
}
