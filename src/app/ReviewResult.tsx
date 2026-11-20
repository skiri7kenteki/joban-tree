// 復習の 1 回の結果（段階11-4）：正解の数、まちがえた問題（小さな盤・正しい手・指した手。押すと大きく）、全体の数（小さく）、「もう n 問」「終わる」。
// ツリーの復習と研究手順の復習で共通。

import { useState } from 'preact/hooks';
import { Board } from '../components/Board';
import { Dialog } from '../components/Dialog';
import { moveText } from '../shogi/position';
import { sessionMistakes, sessionScore, type ReviewSession, type SessionItem } from '../review/session';

export function ReviewResult({
  session,
  overall,
  onMore,
  onEnd,
  endLabel = '終わる',
}: {
  session: ReviewSession;
  /** 全体の数の文（例：「この戦型の問題 2303・まだ 2280・前回まちがい 5・覚えた 3」） */
  overall: string;
  onMore: () => void;
  onEnd: () => void;
  endLabel?: string;
}) {
  const score = sessionScore(session);
  const mistakes = sessionMistakes(session);
  const [open, setOpen] = useState<SessionItem | null>(null);
  return (
    <div class="review-result" data-testid="review-result">
      <p class="review-result-score" data-testid="review-result-score">
        <strong>
          {score.asked} 問中 {score.ok} 問
        </strong>
        正解（1 回目で）
      </p>
      {mistakes.length > 0 ? (
        <>
          <h2 class="review-result-head">まちがえた問題（{mistakes.length}）</h2>
          <ul class="review-mistakes">
            {mistakes.map((m, i) => (
              <li key={i}>
                <button type="button" class="review-mistake" data-testid="review-mistake" onClick={() => setOpen(m)}>
                  <span class="mini-board" aria-hidden="true">
                    <Board sfen={m.sfen} lastMove={m.lastMove} />
                  </span>
                  <span class="review-mistake-text">
                    <span>
                      正解 <strong>{moveText(m.sfen, m.answer, m.lastMove)}</strong>
                    </span>
                    {m.tried && <span class="muted">指した手 {moveText(m.sfen, m.tried, m.lastMove)}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        score.asked > 0 && (
          <p class="status-ok" data-testid="review-perfect">
            全問正解です。
          </p>
        )
      )}
      <p class="muted review-summary" data-testid="review-result-overall">
        {overall}
      </p>
      <div class="btn-row review-result-actions">
        <button type="button" class="btn btn-primary" data-testid="review-more" onClick={onMore}>
          もう {session.limit} 問
        </button>
        <button type="button" class="btn" data-testid="review-finish" onClick={onEnd}>
          {endLabel}
        </button>
      </div>

      {open && (
        <Dialog title={`正解 ${moveText(open.sfen, open.answer, open.lastMove)}`} onClose={() => setOpen(null)} testId="review-mistake-dialog">
          <div class="review-mistake-board">
            <Board sfen={open.sfen} lastMove={open.lastMove} />
          </div>
          {open.tried && <p class="muted">指した手 {moveText(open.sfen, open.tried, open.lastMove)}</p>}
        </Dialog>
      )}
    </div>
  );
}
