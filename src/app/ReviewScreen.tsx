// 復習モード：ツリーから「相手がこう来たら？」を手順を通して出題する。
// 相手の応手はアプリが選んで指す（まだ出していない・間違えた問題が多い枝ほど選ばれやすい）。
// 自分の手番では盤をタップして答える。正解はツリーの先頭の手。記録は端末の中（IndexedDB）に残す。
// 段階4-2：相手が直前に指した手を、盤（最終手のマス）と一言「相手は △９四歩」ではっきり示す。
// v0.12.4：スマホ縦では、盤と問題のカードがスクロールせずに 1 画面に収まるよう、盤の大きさを画面の高さに合わせる（boardFit.ts）。
// 研究手順だけを復習する：上の「全部／研究手順だけ」で切り替える（このツリーの開始局面を通る研究手順があるときだけ）。
// 段階8-1 から研究手順の復習はツリーを使わない別の画面（StudyReviewScreen.tsx、#/review/<id>/study）。
// 段階11-4：決まった数（設定の reviewBatch、初期値 10）を答えたら 1 回が終わり、結果（ReviewResult）を出す。上の行は「今日 3／10問」、全体の数は結果に小さく。
// 段階11-2：盤の下の固定バー（MoveBar）。真ん中に「今日 3／10問」。問題を出している間は ‹ › を押せない。答えた後は ‹ › でこの手順をさかのぼって見られる。

import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Move } from 'tsshogi';
import { Board } from '../components/Board';
import { Dialog } from '../components/Dialog';
import { MoveBar, moveBarHeight } from '../components/MoveBar';
import { OnceHint } from '../components/OnceHint';
import { PromotionBox, useMoveInput } from '../components/useMoveInput';
import { formatScore } from '../engine/usi';
import { moveText } from '../shogi/position';
import { loadTree } from '../storage/trees';
import { clearReview, loadReview, saveReview } from '../storage/review';
import { lastPrefixMove, prefixMoveTexts } from '../tree/browse';
import { isOpponentNode } from '../tree/generator';
import { studiesThroughTree } from '../review/studyReview';
import type { TreeData, TreeEdge } from '../tree/types';
import { answerOf, computeNeeds, emptyRecord, isDubiousReply, pickReply, recordAnswer, summarize, type ReviewRecord } from '../review/review';
import { addItem, newSession, progressText, sessionDone } from '../review/session';
import { ReviewResult } from './ReviewResult';
import { boardFitProps, measureFitAbove, useBoardFit } from './boardFit';
import { openTree } from './generation';
import { back, go, replaceTo } from './router';
import { settings } from './settings';
import { ensureStudies, library } from './studies';

export function ReviewScreen({ id }: { id: string }) {
  const [tree, setTree] = useState<TreeData | null>(openTree.value?.id === id ? openTree.value : null);
  const [record, setRecord] = useState<ReviewRecord | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      const t = tree ?? (await loadTree(id));
      if (!t) throw new Error('このツリーは見つかりませんでした');
      const r = await loadReview(id);
      if (!alive) return;
      setTree(t);
      setRecord(r);
    })().catch((e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [id]);

  if (error) return <p class="status-ng">{error}</p>;
  if (!tree || !record) return <p class="muted">読み込み中…</p>;
  return <ReviewView tree={tree} initialRecord={record} />;
}

/** 今の手順の 1 局面（move はその局面に来た手） */
interface Step {
  key: string;
  move?: string;
  /** 相手の疑問手で来た局面（咎める 1 手を答えたら、その手順は終わり） */
  dubious?: boolean;
}

type Phase =
  | { kind: 'ask'; firstTry: boolean }
  | { kind: 'wrong'; tried: string }
  | { kind: 'answered'; ok: boolean }
  | { kind: 'end'; afterDubious?: boolean }
  | { kind: 'start' }
  /** 1 回の問題を答え終わった（段階11-4） */
  | { kind: 'result' };

function ReviewView({ tree, initialRecord }: { tree: TreeData; initialRecord: ReviewRecord }) {
  const [record, setRecord] = useState(initialRecord);
  // このツリーの開始局面を通る研究手順があれば「研究手順だけ」に切り替えられる
  useEffect(() => {
    void ensureStudies().catch(() => undefined);
  }, []);
  const hasStudies = studiesThroughTree(tree, library.value ?? []).length > 0;
  const [steps, setSteps] = useState<Step[]>([{ key: tree.rootKey }]);
  const [phase, setPhase] = useState<Phase>({ kind: 'start' });
  /** この手順で出した問題の数と、1 回目で正解した数 */
  const [lineScore, setLineScore] = useState({ asked: 0, ok: 0 });
  const [confirmClear, setConfirmClear] = useState(false);
  const [saveError, setSaveError] = useState('');
  /** 今の 1 回（段階11-4） */
  const [session, setSession] = useState(() => newSession(settings.value.reviewBatch));
  /** 答えた後に ‹ › でさかのぼって見ている局面（steps の番号。null＝今の局面。段階11-2） */
  const [view, setView] = useState<number | null>(null);

  const thresholds = settings.value.thresholds;
  const needs = useMemo(() => computeNeeds(tree, record, thresholds), [tree, record, thresholds]);
  const summary = useMemo(() => summarize(tree, record, thresholds), [tree, record, thresholds]);
  const current = steps[steps.length - 1];
  const node = tree.nodes[current.key];
  // 正解：ツリーの先頭の手
  const answer: TreeEdge | null = answerOf(tree, current.key);
  const mySideText = tree.mySide === 'black' ? '☗先手' : '☖後手';
  /** 全体の数（画面のいちばん下と結果に小さく。段階11-4） */
  const overall = `このツリーの問題 ${summary.total}（まだ ${summary.unseen}・前回まちがい ${summary.wrong}・覚えた ${summary.learned}）`;

  /** i 番目の局面に来た手を文字にする（例：▲２六歩） */
  const stepText = (i: number) => {
    const step = steps[i];
    if (!step.move) return '';
    return moveText(tree.nodes[steps[i - 1].key].sfen, step.move, steps[i - 2]?.move);
  };
  // 相手が直前に指した手（開始局面が自分の手番なら、開始局面に至る最後の手）
  const atRoot = steps.length === 1;
  const lastMove = atRoot ? lastPrefixMove(tree) : current.move;
  const lastText = atRoot ? (prefixMoveTexts(tree).at(-1) ?? '') : stepText(steps.length - 1);
  const input = useMoveInput(node.sfen, onMove, phase.kind === 'ask');
  // 固定バー：問題を出している間（答える前・まちがえた後）は ‹ › を押せない。答えた後・手順の終わりでは、この手順をさかのぼれる
  const canBrowse = phase.kind === 'answered' || phase.kind === 'end';
  const shown = canBrowse && view !== null ? view : steps.length - 1;
  const shownNode = tree.nodes[steps[shown].key];
  const shownLast = shown === 0 ? lastPrefixMove(tree) : steps[shown].move;
  // スマホ縦：盤と問題のカード（問題の文・答えの操作）が画面に収まる盤の幅（v0.12.4。成る・成らないの小窓は数えない）
  const boardRef = useRef<HTMLDivElement>(null);
  const promptRef = useRef<HTMLDivElement>(null);
  // 同じ問題の間は、一度縮めた盤を戻さない（まちがえて「もう一度」のボタンが出て縮んだ後、問題に戻るたびに盤が動かないように）
  const fitMemo = useRef<{ question: string; width: number | null }>({ question: '', width: null });
  const question = `${steps.length}:${current.key}`;
  const boardFit = useBoardFit(boardRef, (board) => {
    const width = measureFitAbove(board, promptRef.current, moveBarHeight(), [board.querySelector<HTMLElement>('.promote-box')]);
    const memo = fitMemo.current;
    const kept = memo.question === question && memo.width !== null && width !== null ? Math.min(memo.width, width) : width;
    fitMemo.current = { question, width: kept };
    return kept;
  });

  // 最初の手順を始める
  useEffect(() => {
    startLine();
  }, []);

  // 正解したら、少し見せてから次へ進む
  useEffect(() => {
    if (phase.kind !== 'answered' || !phase.ok) return;
    const timer = setTimeout(next, 700);
    return () => clearTimeout(timer);
  }, [phase, steps, session]);

  /** 新しい手順を開始局面から始める */
  function startLine() {
    setLineScore({ asked: 0, ok: 0 });
    continueFrom([{ key: tree.rootKey }], needs);
  }

  /** 答えを見せた後：1 回の問題を答え終わっていれば結果へ、まだなら手順の続きへ */
  function next() {
    if (sessionDone(session)) setPhase({ kind: 'result' });
    else continueFrom(steps);
  }

  /** 「もう 10 問」：新しい 1 回を始める */
  function more() {
    setSession(newSession(settings.value.reviewBatch));
    startLine();
  }

  /** 手順の最後の局面から、次の問題まで進める（相手の手番なら応手を選んで指す） */
  function continueFrom(list: Step[], currentNeeds = needs) {
    setView(null);
    const last = list[list.length - 1];
    const lastNode = tree.nodes[last.key];
    // 相手の疑問手を咎める手を答えたところで、この手順は終わり（その先は深く掘り下げない）
    if (list.length >= 3 && list[list.length - 2].dubious) {
      setSteps(list);
      setPhase({ kind: 'end', afterDubious: true });
      return;
    }
    let next = list;
    if (isOpponentNode(tree, lastNode)) {
      const reply = pickReply(tree, last.key, currentNeeds);
      if (!reply) {
        setSteps(list);
        setPhase({ kind: 'end' });
        return;
      }
      next = [...list, { key: reply.to, move: reply.move, dubious: isDubiousReply(reply, thresholds) }];
    }
    setSteps(next);
    setPhase(answerOf(tree, next[next.length - 1].key) ? { kind: 'ask', firstTry: true } : { kind: 'end' });
  }

  function remember(ok: boolean, tried: string) {
    const updated = recordAnswer(record, current.key, ok, Date.now());
    setRecord(updated);
    setLineScore((s) => ({ asked: s.asked + 1, ok: s.ok + (ok ? 1 : 0) }));
    if (answer) setSession((x) => addItem(x, { sfen: node.sfen, lastMove: lastMove, answer: answer.move, ok, ...(ok ? {} : { tried }) }));
    saveReview(updated).catch((e: unknown) => setSaveError(`記録を保存できませんでした（${e instanceof Error ? e.message : String(e)}）`));
  }

  function onMove(move: Move) {
    if (phase.kind !== 'ask' || !answer) return;
    const ok = move.usi === answer.move;
    if (phase.firstTry) remember(ok, move.usi);
    if (ok) {
      setSteps([...steps, { key: answer.to, move: answer.move }]);
      setPhase({ kind: 'answered', ok: true });
    } else {
      setPhase({ kind: 'wrong', tried: move.usi });
    }
  }

  function showAnswer() {
    if (!answer) return;
    setSteps([...steps, { key: answer.to, move: answer.move }]);
    setPhase({ kind: 'answered', ok: false });
  }

  async function clearRecord() {
    setConfirmClear(false);
    await clearReview(tree.id).catch(() => undefined);
    const fresh = emptyRecord(tree.id);
    setRecord(fresh);
  }

  // 問題を出している間は、相手の手を大きめに出す
  const opponentLine = lastText && (phase.kind === 'ask' || phase.kind === 'wrong') && (
    <p class="review-opponent" data-testid="review-opponent">
      相手は <strong>{lastText}</strong>
      {current.dubious && (
        <>
          （<span class="status-ng" data-testid="review-dubious">疑問手</span>）
        </>
      )}
    </p>
  );

  return (
    <>
      <div class="screen-header">
        <button type="button" class="btn btn-ghost btn-back" onClick={() => go(`/tree/${tree.id}`)}>
          ‹<span class="back-text"> ツリー</span>
        </button>
        <h1 class="tree-title">復習：{tree.name}</h1>
      </div>

      {/* このツリーの開始局面を通る研究手順があれば「全部／研究手順だけ」を切り替えられる */}
      {hasStudies && <ReviewModeTabs treeId={tree.id} mode="all" />}

      {phase.kind === 'result' ? (
        <ReviewResult
          session={session}
          overall={overall}
          onMore={more}
          onEnd={() => back('/reviews')}
        />
      ) : (
        <>
      <div class="tree-layout">
        <div ref={boardRef} {...boardFitProps(boardFit, 'tree-board')}>
          <Board
            sfen={shownNode.sfen}
            lastMove={shownLast}
            selection={input.selection}
            onSquare={input.onSquare}
            onHand={input.onHand}
            flash={phase.kind === 'answered' && phase.ok && view === null}
          />
          <PromotionBox input={input} />
        </div>

        <div class="tree-side">
          <div class="card review-prompt" ref={promptRef} data-testid="review-prompt" data-phase={phase.kind}>
            {opponentLine}
            {phase.kind === 'ask' && (
              <>
                <p>{current.dubious ? 'どう咎めますか？' : `あなた（${mySideText}）の手は？`}</p>
                <OnceHint id="answer-tap">盤の駒をタップ → 行き先をタップで答えます。</OnceHint>
                {answer?.unverified && <p class="muted">この局面の答えは「未検証」の手です（エンジンで確かめていません）。</p>}
              </>
            )}
            {phase.kind === 'wrong' && (
              <>
                <p class="status-ng" data-testid="review-wrong">
                  {moveText(node.sfen, phase.tried, current.move)} ではありません。
                </p>
                {node.edges.some((e) => e.move === phase.tried) && (
                  <p class="muted">その手は、調べ直す前の読み筋で出た手です（調べ直すと別の手が最善でした）。</p>
                )}
                <div class="btn-row">
                  <button type="button" class="btn btn-primary" data-testid="review-retry" onClick={() => setPhase({ kind: 'ask', firstTry: false })}>
                    もう一度
                  </button>
                  <button type="button" class="btn" data-testid="review-show" onClick={showAnswer}>
                    正解を見る
                  </button>
                </div>
              </>
            )}
            {phase.kind === 'answered' && (
              <>
                <p class={phase.ok ? 'status-ok' : ''} data-testid="review-answer">
                  {phase.ok ? '正解！' : '正解は'} <strong>{lastText}</strong>
                  <span class="muted">（評価値 {formatScore(answeredScore(tree, steps))}）</span>
                </p>
                {!phase.ok && (
                  <button type="button" class="btn btn-primary" data-testid="review-continue" onClick={next}>
                    {sessionDone(session) ? '結果を見る' : '次へ'}
                  </button>
                )}
              </>
            )}
            {phase.kind === 'end' && (
              <>
                <p data-testid="review-end">
                  {lineScore.asked > 0
                    ? `${phase.afterDubious ? '疑問手を咎める手まで出しました。' : ''}この手順はここまでです（${lineScore.asked} 問中 ${lineScore.ok} 問、1 回目で正解）。`
                    : 'このツリーには、まだ問題がありません（自分の手が入った局面がありません）。'}
                </p>
                {summary.total > 0 && (
                  <button type="button" class="btn btn-primary" data-testid="review-next" onClick={startLine}>
                    次の手順へ
                  </button>
                )}
              </>
            )}
            {saveError && <p class="status-ng">{saveError}</p>}
          </div>

        </div>
      </div>

        </>
      )}

      {/* 画面のいちばん下にまとめる */}
      <div class="review-footer">
        {/* 結果の画面では結果の中に出すので、ここには出さない */}
        {phase.kind !== 'result' && (
          <span class="muted review-summary" data-testid="review-summary">
            {overall}
          </span>
        )}
        <button type="button" class="btn btn-ghost" data-testid="review-clear" onClick={() => setConfirmClear(true)}>
          記録を消す…
        </button>
      </div>

      {/* 盤の下の固定バー（段階11-2）：真ん中は「今日 3／10問」。さかのぼって見ているときは、その局面も */}
      {phase.kind !== 'result' && (
        <MoveBar
          ids={{ bar: 'review-nav', prev: 'review-prev', center: 'review-position', next: 'review-next-move' }}
          onPrev={() => setView(shown - 1)}
          onNext={() => setView(shown + 1 >= steps.length - 1 ? null : shown + 1)}
          canPrev={canBrowse && shown > 0}
          canNext={canBrowse && shown < steps.length - 1}
        >
          <span class="move-bar-main" data-testid="review-progress">
            {progressText(session, phase.kind === 'ask' && phase.firstTry)}
          </span>
          {shown < steps.length - 1 && (
            <span class="move-bar-sub" data-testid="review-viewing">
              {shown === 0 ? '開始局面' : stepText(shown)}を表示中
            </span>
          )}
        </MoveBar>
      )}

      {confirmClear && (
        <Dialog title="記録を消す" onClose={() => setConfirmClear(false)} testId="review-clear-dialog">
          <p>このツリーの復習の記録（正解・まちがい）を消します。ツリーそのものは消えません。</p>
          <div class="dialog-actions">
            <button type="button" class="btn btn-danger" data-testid="review-clear-confirm" onClick={() => void clearRecord()}>
              消す
            </button>
            <button type="button" class="btn" onClick={() => setConfirmClear(false)}>
              やめる
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}

/** 答えた手の評価値（答えた局面から、答えの手の行き先へ） */
function answeredScore(tree: TreeData, steps: Step[]) {
  const from = tree.nodes[steps[steps.length - 2].key];
  const move = steps[steps.length - 1].move;
  return (from.edges.find((e) => e.move === move) ?? from.edges[0]).score;
}

/** 「全部／研究手順だけ」の切り替え（ツリーの復習画面と、そのツリーの研究手順だけの復習画面で共通） */
export function ReviewModeTabs({ treeId, mode }: { treeId: string; mode: 'all' | 'studies' }) {
  return (
    <div class="review-modes" role="tablist" aria-label="出す問題">
      <button
        type="button"
        role="tab"
        aria-selected={mode === 'all'}
        class={mode === 'all' ? 'home-tab on' : 'home-tab'}
        data-testid="review-mode-all"
        onClick={() => replaceTo(`/review/${treeId}`)}
      >
        全部
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={mode === 'studies'}
        class={mode === 'studies' ? 'home-tab on' : 'home-tab'}
        data-testid="review-mode-studies"
        onClick={() => replaceTo(`/review/${treeId}/study`)}
      >
        研究手順だけ
      </button>
    </div>
  );
}
