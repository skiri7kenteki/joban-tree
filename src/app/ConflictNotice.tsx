// 食い違いの知らせ（段階20-1）：定跡帳のタブの集計の下に「食い違い n か所［見る］」。
// 食い違い＝自分の手番の同じ局面（手順前後を含む）で、研究手順によって自分の手が違うこと。研究の手の全部に候補の表の印があるものは数えない。
// 1 か所なら［見る］でその局面の定跡帳を開く。2 か所以上なら一覧の窓（行を押すと開く・行ごとに本命を選ぶ。段階21-1）。

import { useEffect, useMemo, useState } from 'preact/hooks';
import { Dialog } from '../components/Dialog';
import { moveText } from '../shogi/position';
import { chooseMain, tableOf } from '../tree/candidates';
import { bookIndexes, findConflicts, type Conflict } from '../tree/positions';
import { moveTexts } from '../tree/studies';
import type { Study } from '../tree/types';
import { studyBookUrl } from './addToBook';
import { ensurePositions, positionNotes, positionsNow, saveTable } from './positions';
import { go } from './router';

/** 「17手目 ▲5八玉 の後（☖後手）」 */
export function conflictPlace(c: Conflict): string {
  const side = c.side === 'black' ? '☗先手' : '☖後手';
  if (c.ply === 0) return `初期局面（${side}）`;
  return `${c.ply}手目 ${moveTexts(c.study.moves.slice(0, c.ply))[c.ply - 1]} の後（${side}）`;
}

/** 「△6二玉／△5二玉」 */
export function conflictMoves(c: Conflict): string {
  return c.moves.map((m) => moveText(c.sfen, m.move, c.ply > 0 ? c.study.moves[c.ply - 1] : undefined)).join('／');
}

/** どちらを本命にするか（ほかの研究の手は次善になる） */
export function MainChoice({ conflict, busy, onChoose }: { conflict: Conflict; busy: boolean; onChoose: (move: string) => void }) {
  const prev = conflict.ply > 0 ? conflict.study.moves[conflict.ply - 1] : undefined;
  return (
    <div class="main-choice">
      <span class="main-choice-label">本命は</span>
      {conflict.moves.map((m) => (
        <button type="button" key={m.move} class="btn" data-testid="conflict-main" data-move={m.move} disabled={busy} onClick={() => onChoose(m.move)}>
          {moveText(conflict.sfen, m.move, prev)}
        </button>
      ))}
    </div>
  );
}

export function ConflictNotice({ studies }: { studies: readonly Study[] }) {
  void positionNotes.value;
  useEffect(() => {
    void ensurePositions().catch(() => undefined);
  }, []);
  const indexes = useMemo(() => bookIndexes(studies), [studies]);
  const conflicts = useMemo(
    () => (positionNotes.value ? findConflicts(indexes, positionNotes.value).filter((c) => !c.ok) : []),
    [indexes, positionNotes.value],
  );
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (conflicts.length === 0) return null;
  const one = conflicts.length === 1 ? conflicts[0] : null;

  async function choose(c: Conflict, move: string) {
    setBusy(true);
    setError('');
    try {
      const table = chooseMain(
        tableOf(positionsNow().get(c.id), c.moves),
        c.moves.map((m) => m.move),
        move,
      );
      if (table) await saveTable(c.side, c.sfen, table);
      else setError('候補の表がいっぱいです。その局面で、使わない手を表から外してください。');
    } catch (e) {
      setError(`保存できませんでした：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div class="card conflict-notice" data-testid="conflict-notice" role="status">
        <p class="conflict-notice-text">
          <strong class="conflict-word">食い違い {conflicts.length} か所</strong>
          {one ? `：${conflictPlace(one)}で、自分の手が ${conflictMoves(one)}` : '：研究手順によって自分の手が違う局面があります'}
        </p>
        <button
          type="button"
          class="btn conflict-notice-btn"
          data-testid="conflict-open"
          onClick={() => (one ? go(studyBookUrl(one.study, one.ply)) : setOpen(true))}
        >
          見る
        </button>
      </div>
      {open && (
        <Dialog title={`食い違い ${conflicts.length} か所`} onClose={() => setOpen(false)} testId="conflict-dialog" sheet>
          <p class="muted memo-sub">自分の手番の同じ局面で、研究手順によって自分の手が違います。本命を選ぶと、ほかの手は次善になります。稽古では、どちらを指してもまちがいにしません。</p>
          {error && <p class="status-ng">{error}</p>}
          <ul class="conflict-list">
            {conflicts.map((c) => (
              <li key={c.id} class="conflict-item" data-testid="conflict-item">
                <button type="button" class="conflict-item-open" onClick={() => go(studyBookUrl(c.study, c.ply))}>
                  <span>{conflictPlace(c)}</span>
                  <span class="conflict-item-moves">{conflictMoves(c)}</span>
                </button>
                <MainChoice conflict={c} busy={busy} onChoose={(move) => void choose(c, move)} />
              </li>
            ))}
          </ul>
        </Dialog>
      )}
    </>
  );
}
