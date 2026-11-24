// 食い違いの知らせ（段階20-1）：定跡帳のタブの集計の下に「食い違い n か所［見る］」。
// 食い違い＝自分の手番の同じ局面（手順前後を含む）で、研究手順によって自分の手が違うこと。「このままでよい」にしたものは数えない。
// 1 か所なら［見る］でその局面の定跡帳を開く。2 か所以上なら一覧の窓（行を押すと開く・行ごとに「このままでよい」）。

import { useEffect, useMemo, useState } from 'preact/hooks';
import { Dialog } from '../components/Dialog';
import { moveText } from '../shogi/position';
import { bookIndexes, findConflicts, type Conflict } from '../tree/positions';
import { moveTexts } from '../tree/studies';
import type { Study } from '../tree/types';
import { studyBookUrl } from './addToBook';
import { acknowledgeConflict, ensurePositions, positionNotes } from './positions';
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
  if (conflicts.length === 0) return null;
  const one = conflicts.length === 1 ? conflicts[0] : null;

  async function ok(c: Conflict) {
    setBusy(true);
    try {
      await acknowledgeConflict(c);
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
          <p class="muted memo-sub">自分の手番の同じ局面で、研究手順によって自分の手が違います。稽古では、どちらを指してもまちがいにしません。</p>
          <ul class="conflict-list">
            {conflicts.map((c) => (
              <li key={c.id} class="conflict-item" data-testid="conflict-item">
                <button type="button" class="conflict-item-open" onClick={() => go(studyBookUrl(c.study, c.ply))}>
                  <span>{conflictPlace(c)}</span>
                  <span class="conflict-item-moves">{conflictMoves(c)}</span>
                </button>
                <button type="button" class="btn conflict-item-ok" data-testid="conflict-item-ok" disabled={busy} onClick={() => void ok(c)}>
                  このままでよい
                </button>
              </li>
            ))}
          </ul>
        </Dialog>
      )}
    </>
  );
}
