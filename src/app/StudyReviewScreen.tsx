// 研究手順だけの復習（段階8-1〜。ツリーを使わない。ロジックは src/review/studyReview.ts）。
// 相手の手は研究手順どおりにアプリが指し、自分の手番で研究手順の手を盤のタップで答える。疑問手の決まりは当てはめず最後まで。
// 1 本終わったら結果とメモを出して「次の研究手順へ」（1 本だけのときは「もう一度」）。
// 入口：
//   - #/review/<ツリーの id>/study … ツリーの復習画面の「研究手順だけ」（ツリーの開始局面を通る研究手順。出題はツリーの開始局面から）
//   - #/study-review/<研究手順の id> … その 1 本だけ（研究手順の画面・トップ画面の ⋯ から。出題は戦型の出発点から）
//   - #/study-review/group/<グループの key> … そのグループの研究手順（トップ画面のグループの ⋯ から）
// 記録は研究手順用に 1 つ（ツリーの復習の記録とは別）。
// 段階11-4：決まった数（設定の reviewBatch、初期値 10）を答えたら 1 回が終わり、結果（ReviewResult）を出す。上の行は「今日 3／10問」、全体の数は結果に小さく。

import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Move } from 'tsshogi';
import { Board } from '../components/Board';
import { Dialog } from '../components/Dialog';
import { PromotionBox, useMoveInput } from '../components/useMoveInput';
import { moveText, sfenKey, sideToMove } from '../shogi/position';
import { clearReview, loadReview, saveReview } from '../storage/review';
import { loadTree } from '../storage/trees';
import { emptyRecord, recordAnswer, type ReviewRecord } from '../review/review';
import { addItem, newSession, progressText, sessionDone } from '../review/session';
import { ReviewResult } from './ReviewResult';
import { settings } from './settings';
import {
  STUDY_RECORD_ID,
  pickStudy,
  reviewStart,
  studiesThroughTree,
  studyPositions,
  studyQuestions,
  studyRecordKey,
  summarizeStudies,
} from '../review/studyReview';
import { bookLabel, bookPool } from '../tree/organize';
import { moveTexts, studyStartIndex, treeBaseMoves } from '../tree/studies';
import type { OpeningTemplate } from '../tree/templates';
import type { Study, TreeData } from '../tree/types';
import { boardFitProps, measureFitAbove, useBoardFit } from './boardFit';
import { openTree } from './generation';
import { ReviewModeTabs } from './ReviewScreen';
import { back, go } from './router';
import { ensureStudies } from './studies';
import { allTemplates, myTemplates, refreshMyTemplates } from './TemplateDialogs';

/** どの研究手順を出すか */
export type StudyReviewTarget = { kind: 'tree'; treeId: string } | { kind: 'one'; studyId: string } | { kind: 'group'; key: string };

interface Loaded {
  pool: Study[];
  startOf: (s: Study) => number;
  record: ReviewRecord;
  tree: TreeData | null;
  /** 見出しの「○○だけ・」 */
  label: string;
}

export function StudyReviewScreen({ target }: { target: StudyReviewTarget }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      const [studies, record] = await Promise.all([ensureStudies(), loadReview(STUDY_RECORD_ID)]);
      if (!myTemplates.value) await refreshMyTemplates().catch(() => undefined);
      const templates = allTemplates();
      const result = await choose(target, studies, templates);
      if (alive) setLoaded({ ...result, record });
    })().catch((e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, []);

  if (error) return <p class="status-ng">{error}</p>;
  if (!loaded) return <p class="muted">読み込み中…</p>;
  return <StudyReviewView target={target} {...loaded} />;
}

/** 出す研究手順と、出題を始める手を決める */
async function choose(target: StudyReviewTarget, studies: Study[], templates: OpeningTemplate[]): Promise<Omit<Loaded, 'record'>> {
  const fromTemplate = (s: Study) => reviewStart(s, studyStartIndex(s, templates));
  if (target.kind === 'tree') {
    const tree = openTree.value?.id === target.treeId ? openTree.value : await loadTree(target.treeId);
    if (!tree) throw new Error('このツリーは見つかりませんでした');
    const pool = studiesThroughTree(tree, studies);
    const start = treeBaseMoves(tree)?.length ?? 0;
    return { pool, startOf: () => start, tree, label: `研究手順 ${pool.length} 本・` };
  }
  if (target.kind === 'one') {
    const pool = studies.filter((s) => s.id === target.studyId);
    return { pool, startOf: fromTemplate, tree: null, label: `研究「${pool[0]?.name ?? '（見つかりません）'}」だけ・` };
  }
  // グループの key か、定跡帳の key（平手からの定跡帳はその側の研究手順すべて。段階10-1）
  const pool = bookPool(target.key, studies, templates);
  return { pool, startOf: fromTemplate, tree: null, label: `${pool.length > 0 ? `「${bookLabel(target.key)}」の` : ''}研究手順 ${pool.length} 本・` };
}

type Phase =
  | { kind: 'ask'; firstTry: boolean }
  | { kind: 'wrong'; tried: string }
  | { kind: 'answered'; ok: boolean }
  | { kind: 'end' }
  | { kind: 'start' }
  /** 1 回の問題を答え終わった（段階11-4） */
  | { kind: 'result' };

function StudyReviewView({ target, pool, startOf, record: initialRecord, tree, label }: Loaded & { target: StudyReviewTarget }) {
  const [record, setRecord] = useState(initialRecord);
  const [study, setStudy] = useState<Study | null>(null);
  /** 研究手順の何手目まで指したか（盤に出している局面＝平手から pos 手指した後） */
  const [pos, setPos] = useState(0);
  const [phase, setPhase] = useState<Phase>({ kind: 'start' });
  /** この研究手順で出した問題の数と、1 回目で正解した数 */
  const [lineScore, setLineScore] = useState({ asked: 0, ok: 0 });
  const [confirmClear, setConfirmClear] = useState(false);
  const [saveError, setSaveError] = useState('');
  /** 今の 1 回（段階11-4） */
  const [session, setSession] = useState(() => newSession(settings.value.reviewBatch));

  const positions = useMemo(() => (study ? studyPositions(study.moves) : []), [study]);
  const texts = useMemo(() => (study ? moveTexts(study.moves) : []), [study]);
  const start = study ? startOf(study) : 0;
  const sfen = positions[pos] ?? positions[0] ?? '';
  const answerMove = study && pos < positions.length - 1 ? study.moves[pos] : null;
  const summary = useMemo(() => summarizeStudies(pool, startOf, record), [pool, record]);
  const mySideText = study?.mySide === 'black' ? '☗先手' : '☖後手';
  /** 全体の数（画面のいちばん下と結果に小さく。段階11-4） */
  const overall = `${label}問題 ${summary.total}（まだ ${summary.unseen}・前回まちがい ${summary.wrong}・覚えた ${summary.learned}）`;

  // 相手が直前に指した手（出題を始める局面の直前の手も）
  const lastMove = study && pos > 0 ? study.moves[pos - 1] : undefined;
  const lastText = pos > 0 ? (texts[pos - 1] ?? '') : '';
  const input = useMoveInput(sfen, onMove, phase.kind === 'ask');
  // スマホ縦：盤と問題のカードが画面に収まる盤の幅（同じ問題の間は、一度縮めた盤を戻さない）
  const boardRef = useRef<HTMLDivElement>(null);
  const promptRef = useRef<HTMLDivElement>(null);
  const fitMemo = useRef<{ question: string; width: number | null }>({ question: '', width: null });
  const question = `${study?.id ?? ''}:${pos}`;
  const boardFit = useBoardFit(boardRef, (board) => {
    const width = measureFitAbove(board, promptRef.current, 0, [board.querySelector<HTMLElement>('.promote-box')]);
    const memo = fitMemo.current;
    const kept = memo.question === question && memo.width !== null && width !== null ? Math.min(memo.width, width) : width;
    fitMemo.current = { question, width: kept };
    return kept;
  });

  useEffect(() => {
    startLine();
  }, []);

  // 正解したら、少し見せてから次へ
  useEffect(() => {
    if (phase.kind !== 'answered' || !phase.ok || !study) return;
    const timer = setTimeout(next, 700);
    return () => clearTimeout(timer);
  }, [phase, pos, study, session]);

  /** 答えを見せた後：1 回の問題を答え終わっていれば結果へ、まだなら研究手順の続きへ */
  function next() {
    if (sessionDone(session)) setPhase({ kind: 'result' });
    else if (study) playOpponent(study, pos);
  }

  /** 「もう 10 問」：新しい 1 回を始める */
  function more() {
    setSession(newSession(settings.value.reviewBatch));
    startLine();
  }

  /** 研究手順を 1 本選んで、出題を始める手から始める */
  function startLine() {
    setLineScore({ asked: 0, ok: 0 });
    const next = pickStudy(pool, startOf, record);
    setStudy(next);
    if (!next) {
      setPhase({ kind: 'end' });
      return;
    }
    playOpponent(next, startOf(next));
  }

  /** 相手の手は研究手順どおりに指し、次の自分の手番（問題）まで進める。研究手順の終わりなら終わり */
  function playOpponent(s: Study, from: number) {
    const line = studyPositions(s.moves);
    let p = from;
    while (p < line.length - 1 && sideToMove(line[p]) !== s.mySide) p++;
    setPos(p);
    setPhase(p < line.length - 1 ? { kind: 'ask', firstTry: true } : { kind: 'end' });
  }

  function remember(ok: boolean, tried: string) {
    if (!answerMove) return;
    const updated = recordAnswer(record, studyRecordKey(sfenKey(sfen), answerMove), ok, Date.now());
    setRecord(updated);
    setLineScore((x) => ({ asked: x.asked + 1, ok: x.ok + (ok ? 1 : 0) }));
    setSession((x) => addItem(x, { sfen, ...(lastMove ? { lastMove } : {}), answer: answerMove, ok, ...(ok ? {} : { tried }) }));
    saveReview(updated).catch((e: unknown) => setSaveError(`記録を保存できませんでした（${e instanceof Error ? e.message : String(e)}）`));
  }

  function onMove(move: Move) {
    if (phase.kind !== 'ask' || !answerMove) return;
    const ok = move.usi === answerMove;
    if (phase.firstTry) remember(ok, move.usi);
    if (ok) {
      setPos(pos + 1);
      setPhase({ kind: 'answered', ok: true });
    } else {
      setPhase({ kind: 'wrong', tried: move.usi });
    }
  }

  function showAnswer() {
    if (!answerMove) return;
    setPos(pos + 1);
    setPhase({ kind: 'answered', ok: false });
  }

  async function clearRecord() {
    setConfirmClear(false);
    await clearReview(STUDY_RECORD_ID).catch(() => undefined);
    setRecord(emptyRecord(STUDY_RECORD_ID));
  }

  const opponentLine = lastText && (phase.kind === 'ask' || phase.kind === 'wrong') && (
    <p class="review-opponent" data-testid="review-opponent">
      相手は <strong>{lastText}</strong>
    </p>
  );

  return (
    <>
      <div class="screen-header">
        {tree ? (
          <button type="button" class="btn btn-ghost" onClick={() => go(`/tree/${tree.id}`)}>
            ‹ ツリー
          </button>
        ) : (
          <button type="button" class="btn btn-ghost" data-testid="study-review-back" onClick={() => back()}>
            ‹ 戻る
          </button>
        )}
        <h1 class="tree-title">{tree ? `復習：${tree.name}` : '復習：研究手順'}</h1>
      </div>

      {target.kind === 'tree' && <ReviewModeTabs treeId={target.treeId} mode="studies" />}

      {phase.kind === 'result' ? (
        <ReviewResult
          session={session}
          overall={overall}
          onMore={more}
          onEnd={() => back('/reviews')}
        />
      ) : (
        <>
      <p class="review-progress" data-testid="review-progress">
        {progressText(session, phase.kind === 'ask' && phase.firstTry)}
      </p>

      <div class="tree-layout">
        <div ref={boardRef} {...boardFitProps(boardFit, 'tree-board')}>
          {sfen && <Board sfen={sfen} lastMove={lastMove} selection={input.selection} onSquare={input.onSquare} onHand={input.onHand} />}
          <PromotionBox input={input} />
        </div>

        <div class="tree-side">
          <div class="card review-prompt" ref={promptRef} data-testid="review-prompt" data-phase={phase.kind}>
            {opponentLine}
            {phase.kind === 'ask' && (
              <>
                <p>あなた（{mySideText}）の手は？</p>
                <p class="muted">盤の駒をタップ → 行き先をタップで答えます。</p>
              </>
            )}
            {phase.kind === 'wrong' && (
              <>
                <p class="status-ng" data-testid="review-wrong">
                  {moveText(sfen, phase.tried, lastMove)} ではありません。
                </p>
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
                </p>
                {!phase.ok && study && (
                  <button type="button" class="btn btn-primary" data-testid="review-continue" onClick={next}>
                    {sessionDone(session) ? '結果を見る' : '次へ'}
                  </button>
                )}
              </>
            )}
            {phase.kind === 'end' && <StudyEnd study={study} start={start} score={lineScore} single={pool.length <= 1} onNext={startLine} />}
            {saveError && <p class="status-ng">{saveError}</p>}
          </div>

          {study && (
            <div class="crumbs" data-testid="review-line">
              <span class="crumb">{start === 0 ? '初期局面' : '出発点'}</span>
              {texts.slice(start, pos).map((t, i) => (
                <span key={`${i}-${t}`} class={start + i + 1 === pos ? 'crumb current' : 'crumb'}>
                  {t}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

        </>
      )}

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

      {confirmClear && (
        <Dialog title="記録を消す" onClose={() => setConfirmClear(false)} testId="review-clear-dialog">
          <p>研究手順の復習の記録（正解・まちがい）を、全部の研究手順の分まとめて消します。研究手順そのものは消えません。</p>
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

/** 研究手順を 1 本出し終わったとき：結果・メモ・次へ */
function StudyEnd({
  study,
  start,
  score,
  single,
  onNext,
}: {
  study: Study | null;
  start: number;
  score: { asked: number; ok: number };
  single: boolean;
  onNext: () => void;
}) {
  if (!study) {
    return (
      <p data-testid="review-end">
        出せる問題がありません（自分の手番の局面を通る研究手順がありません）。自分の手を指した後の局面まで進めて、研究手順を保存してください。
      </p>
    );
  }
  return (
    <>
      <p data-testid="review-end">
        研究「{study.name}」を最後まで答えました（{score.asked} 問中 {score.ok} 問、1 回目で正解）。
      </p>
      {studyQuestions(study, start).length === 0 && <p class="muted">この研究手順には、自分の手番の局面がありません。</p>}
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
