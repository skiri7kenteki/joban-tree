// 復習モード：ツリーから「相手がこう来たら？」を手順を通して出題する。
// 相手の応手はアプリが選んで指す（まだ出していない・間違えた問題が多い枝ほど選ばれやすい）。
// 自分の手番では盤をタップして答える。正解はツリーの先頭の手。記録は端末の中（IndexedDB）に残す。
// 段階4-2：相手が直前に指した手を、盤（最終手のマス）と一言「相手は △９四歩」ではっきり示す。
// v0.12.4：スマホ縦では、盤と問題のカードがスクロールせずに 1 画面に収まるよう、盤の大きさを画面の高さに合わせる（boardFit.ts）。
// 研究手順だけを復習する（2026-11-17）：上の「全部／研究手順だけ」で切り替える（#/review/<id>/study）。研究手順を 1 本選び、
// 相手の手は研究手順どおりに指して、自分の手番で研究手順の手を答える。疑問手の決まりは当てはめず最後まで。終わったらメモを出す。
// トップ画面の研究手順の ⋯「この研究手順を復習」からは、その 1 本だけ（#/review/<id>/study/<研究手順の id>）。

import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Move } from 'tsshogi';
import { Board } from '../components/Board';
import { Dialog } from '../components/Dialog';
import { PromotionBox, useMoveInput } from '../components/useMoveInput';
import { formatScore } from '../engine/usi';
import { moveText } from '../shogi/position';
import { loadTree } from '../storage/trees';
import { clearReview, loadReview, saveReview } from '../storage/review';
import { lastPrefixMove, prefixMoveTexts } from '../tree/browse';
import { isOpponentNode } from '../tree/generator';
import { traceStudy } from '../tree/studies';
import type { Study, TreeData, TreeEdge } from '../tree/types';
import {
  answerOf,
  computeNeeds,
  emptyRecord,
  isDubiousReply,
  pickReply,
  pickStudy,
  recordAnswer,
  studyQuestions,
  studyRecordKey,
  summarize,
  summarizeStudies,
  type ReviewRecord,
} from '../review/review';
import { boardFitProps, measureFitAbove, useBoardFit } from './boardFit';
import { openTree } from './generation';
import { go } from './router';
import { settings } from './settings';

/** 何を出すか：全部（今までの復習）・研究手順だけ（only があればその 1 本だけ） */
type Mode = { kind: 'all' } | { kind: 'studies'; only?: string };

export function ReviewScreen({ id, studies, study }: { id: string; studies?: boolean; study?: string }) {
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
  const mode: Mode = studies ? { kind: 'studies', only: study } : { kind: 'all' };
  return <ReviewView key={`${mode.kind}/${study ?? ''}`} tree={tree} initialRecord={record} mode={mode} />;
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
  | { kind: 'start' };

function ReviewView({ tree, initialRecord, mode }: { tree: TreeData; initialRecord: ReviewRecord; mode: Mode }) {
  const [record, setRecord] = useState(initialRecord);
  // 研究手順だけのとき：出す研究手順（only があればその 1 本）と、今出している研究手順
  const allStudies = tree.studies ?? [];
  const studyPool = mode.kind === 'studies' ? (mode.only ? allStudies.filter((s) => s.id === mode.only) : allStudies) : [];
  const [currentStudy, setCurrentStudy] = useState<Study | null>(null);
  const [steps, setSteps] = useState<Step[]>([{ key: tree.rootKey }]);
  const [phase, setPhase] = useState<Phase>({ kind: 'start' });
  /** この手順で出した問題の数と、1 回目で正解した数 */
  const [lineScore, setLineScore] = useState({ asked: 0, ok: 0 });
  const [lineCount, setLineCount] = useState(0);
  const [confirmClear, setConfirmClear] = useState(false);
  const [saveError, setSaveError] = useState('');

  const thresholds = settings.value.thresholds;
  const needs = useMemo(() => computeNeeds(tree, record, thresholds), [tree, record, thresholds]);
  const summary = useMemo(
    () => (mode.kind === 'studies' ? summarizeStudies(tree, studyPool, record) : summarize(tree, record, thresholds)),
    [tree, record, thresholds, mode.kind, studyPool.length],
  );
  const current = steps[steps.length - 1];
  const node = tree.nodes[current.key];
  // 正解：全部のときはツリーの先頭の手、研究手順のときは研究手順の手（その手がツリーにある間だけ）
  const answer: TreeEdge | null =
    mode.kind === 'studies'
      ? currentStudy && steps.length - 1 < currentStudy.moves.length
        ? (node.edges.find((e) => e.move === currentStudy.moves[steps.length - 1]) ?? null)
        : null
      : answerOf(tree, current.key);
  const mySideText = tree.mySide === 'black' ? '☗先手' : '☖後手';

  const input = useMoveInput(node.sfen, onMove, phase.kind === 'ask');
  // スマホ縦：盤と問題のカード（問題の文・答えの操作）が画面に収まる盤の幅（v0.12.4。成る・成らないの小窓は数えない）
  const boardRef = useRef<HTMLDivElement>(null);
  const promptRef = useRef<HTMLDivElement>(null);
  // 同じ問題の間は、一度縮めた盤を戻さない（まちがえて「もう一度」のボタンが出て縮んだ後、問題に戻るたびに盤が動かないように）
  const fitMemo = useRef<{ question: string; width: number | null }>({ question: '', width: null });
  const question = `${steps.length}:${current.key}`;
  const boardFit = useBoardFit(boardRef, (board) => {
    const width = measureFitAbove(board, promptRef.current, 0, [board.querySelector<HTMLElement>('.promote-box')]);
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
    const timer = setTimeout(() => continueFrom(steps), 700);
    return () => clearTimeout(timer);
  }, [phase, steps]);

  /** 新しい手順を開始局面から始める */
  function startLine() {
    setLineScore({ asked: 0, ok: 0 });
    setLineCount((n) => n + 1);
    if (mode.kind === 'studies') {
      const study = pickStudy(tree, studyPool, record);
      setCurrentStudy(study);
      continueStudy([{ key: tree.rootKey }], study);
      return;
    }
    continueFrom([{ key: tree.rootKey }], needs);
  }

  /** 研究手順：相手の手は研究手順どおりに指し、次の自分の手番（問題）まで進める。たどれなくなったら終わり */
  function continueStudy(list: Step[], study: Study | null = currentStudy) {
    if (!study) {
      setSteps(list);
      setPhase({ kind: 'end' });
      return;
    }
    const trace = traceStudy(tree, study.moves);
    let next = list;
    while (next.length - 1 < trace.reached) {
      const i = next.length - 1;
      if (!isOpponentNode(tree, tree.nodes[next[i].key])) {
        setSteps(next);
        setPhase({ kind: 'ask', firstTry: true });
        return;
      }
      next = [...next, { key: trace.keys[i + 1], move: study.moves[i] }];
    }
    setSteps(next);
    setPhase({ kind: 'end' });
  }

  /** 手順の最後の局面から、次の問題まで進める（相手の手番なら応手を選んで指す） */
  function continueFrom(list: Step[], currentNeeds = needs) {
    if (mode.kind === 'studies') {
      continueStudy(list);
      return;
    }
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

  function remember(ok: boolean) {
    // 研究手順の正解がツリーの本線と違う局面は、別のキーで記録する（今の復習の記録と混ざらないように）
    const recordKey = mode.kind === 'studies' && answer ? studyRecordKey(tree, current.key, answer.move) : current.key;
    const updated = recordAnswer(record, recordKey, ok, Date.now());
    setRecord(updated);
    setLineScore((s) => ({ asked: s.asked + 1, ok: s.ok + (ok ? 1 : 0) }));
    saveReview(updated).catch((e: unknown) => setSaveError(`記録を保存できませんでした（${e instanceof Error ? e.message : String(e)}）`));
  }

  function onMove(move: Move) {
    if (phase.kind !== 'ask' || !answer) return;
    const ok = move.usi === answer.move;
    if (phase.firstTry) remember(ok);
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
        <button type="button" class="btn btn-ghost" onClick={() => go(`/tree/${tree.id}`)}>
          ‹ ツリー
        </button>
        <h1 class="tree-title">復習：{tree.name}</h1>
      </div>

      {/* 研究手順があるツリーでは「全部／研究手順だけ」を切り替えられる */}
      {allStudies.length > 0 && (
        <div class="review-modes" role="tablist" aria-label="出す問題">
          <button
            type="button"
            role="tab"
            aria-selected={mode.kind === 'all'}
            class={mode.kind === 'all' ? 'home-tab on' : 'home-tab'}
            data-testid="review-mode-all"
            onClick={() => go(`/review/${tree.id}`)}
          >
            全部
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode.kind === 'studies'}
            class={mode.kind === 'studies' ? 'home-tab on' : 'home-tab'}
            data-testid="review-mode-studies"
            onClick={() => go(`/review/${tree.id}/study`)}
          >
            研究手順だけ
          </button>
        </div>
      )}

      <p class="muted review-summary" data-testid="review-summary">
        {mode.kind === 'studies' &&
          (mode.only ? `研究「${studyPool[0]?.name ?? '（見つかりません）'}」だけ・` : `研究手順 ${studyPool.length} 本・`)}
        問題 {summary.total}（まだ {summary.unseen}・前回まちがい {summary.wrong}・覚えた {summary.learned}）
      </p>

      <div class="tree-layout">
        <div ref={boardRef} {...boardFitProps(boardFit, 'tree-board')}>
          <Board
            sfen={node.sfen}
            lastMove={lastMove}
            selection={input.selection}
            onSquare={input.onSquare}
            onHand={input.onHand}
          />
          <PromotionBox input={input} />
        </div>

        <div class="tree-side">
          <div class="card review-prompt" ref={promptRef} data-testid="review-prompt" data-phase={phase.kind}>
            {opponentLine}
            {phase.kind === 'ask' && (
              <>
                <p>{current.dubious ? 'どう咎めますか？' : `あなた（${mySideText}）の手は？`}</p>
                <p class="muted">盤の駒をタップ → 行き先をタップで答えます。</p>
                {answer?.unverified && <p class="muted">この局面の答えは「未検証」の手です（エンジンで確かめていません）。</p>}
              </>
            )}
            {phase.kind === 'wrong' && (
              <>
                <p class="status-ng" data-testid="review-wrong">
                  {moveText(node.sfen, phase.tried, current.move)} ではありません。
                </p>
                {mode.kind === 'all' && node.edges.some((e) => e.move === phase.tried) && (
                  <p class="muted">その手は、調べ直す前の読み筋で出た手です（調べ直すと別の手が最善でした）。</p>
                )}
                {mode.kind === 'studies' && node.edges.some((e) => e.move === phase.tried) && (
                  <p class="muted">その手もツリーにありますが、この研究手順では別の手を指しています。</p>
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
                  <button type="button" class="btn btn-primary" data-testid="review-continue" onClick={() => continueFrom(steps)}>
                    次へ
                  </button>
                )}
              </>
            )}
            {phase.kind === 'end' && mode.kind === 'studies' && (
              <StudyEnd
                tree={tree}
                study={currentStudy}
                score={lineScore}
                hasQuestions={summary.total > 0}
                single={studyPool.length <= 1}
                onNext={startLine}
              />
            )}
            {phase.kind === 'end' && mode.kind === 'all' && (
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

          <div class="crumbs" data-testid="review-line">
            <span class="crumb">開始局面</span>
            {steps.slice(1).map((s, i) => (
              <span key={`${i}-${s.key}`} class={i + 2 === steps.length ? 'crumb current' : 'crumb'}>
                {stepText(i + 1)}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* 画面のいちばん下にまとめる */}
      <div class="review-footer">
        <span class="muted">{lineCount} 本目の手順</span>
        <button type="button" class="btn btn-ghost" data-testid="review-clear" onClick={() => setConfirmClear(true)}>
          記録を消す…
        </button>
      </div>

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

/** 研究手順を 1 本出し終わったとき：結果・メモ・（たどれなければ）その知らせ・次へ */
function StudyEnd({
  tree,
  study,
  score,
  hasQuestions,
  single,
  onNext,
}: {
  tree: TreeData;
  study: Study | null;
  score: { asked: number; ok: number };
  hasQuestions: boolean;
  single: boolean;
  onNext: () => void;
}) {
  if (!study || !hasQuestions) {
    return (
      <p data-testid="review-end">
        研究手順に問題がありません（自分の手番の局面を通る研究手順がありません）。閲覧画面で、自分の手を指した後の局面まで進めて保存してください。
      </p>
    );
  }
  const trace = traceStudy(tree, study.moves);
  const questions = studyQuestions(tree, study).length;
  return (
    <>
      <p data-testid="review-end">
        研究「{study.name}」を{trace.complete ? '最後まで' : 'たどれるところまで'}答えました（{score.asked} 問中 {score.ok} 問、1 回目で正解）。
      </p>
      {!trace.complete && (
        <p class="muted" data-testid="review-study-broken">
          この研究手順は途中までしかたどれません（{study.moves.length} 手のうち {trace.reached} 手目まで）。
        </p>
      )}
      {questions === 0 && <p class="muted">この研究手順には、自分の手番の局面がありません。</p>}
      {study.note && (
        <p class="study-note review-study-note" data-testid="review-study-note">
          {study.note}
        </p>
      )}
      <button type="button" class="btn btn-primary" data-testid="review-next" onClick={onNext}>
        {single ? 'もう一度' : '次の研究手順へ'}
      </button>
    </>
  );
}
