// 稽古の画面（段階19。#/practice/play〔今日の稽古〕・#/practice/play/<研究手順の id>〔その 1 本〕・#/practice/group/<定跡帳の key>〔そのグループ〕）。
// 持ち主の判断 2026-11-24「おすすめの通りで」：
// - 研究手順を 1 本ずつ、戦型の出発点から終わりまで通して指す。相手の手は研究手順の通りにアプリが指す（少し間を置いて）
// - まちがえたら「△5二玉 ではありません。正解は △6二玉」。盤で正解を指すと続く（止めずに最後まで）。数えるのは 1 回目の答えだけ
// - 1 本終わったら記録を保存（全部正解なら次の間隔へ、まちがえたら明日）し、「次の研究手順へ（あと n本）」
// - 段階21-2：候補の表の次善・本命と、ほかの研究手順の自分の手（同じ局面・手順前後も）は、まちがいにしない（「△5二玉 は 次善 −80」）。
//   悪手はまちがい。咎め方を盤で 1 手ずつ自動で見せて（相手の手と同じ 0.45 秒ずつ）戻り、正解を指すと続く
// - まちがえたとき・まちがいにしないときは、その局面の局面メモをカードの下に出す（段階20-1）
// - 段階26-2：続けて稽古するとき（今日の稽古・まとめて稽古）は、今日もう正しく指した同じ出だしを早送りする（`src/practice/skip.ts`。操作バーの真ん中は「とばす」）
// - 盤の画面の決まり（段階14）：1 画面に収める。上の行に、今日の稽古に入った理由と、自分の手の数だけの丸（正解は茶・まちがいは朱）

import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Board } from '../components/Board';
import { MoveBar } from '../components/MoveBar';
import { OnceHint } from '../components/OnceHint';
import { PromotionBox, useMoveInput } from '../components/useMoveInput';
import { STEP_LABELS, REASON_TEXT, judgeAnswer, nextRecord, practicePlies, practiceStart, startOfDay, type PracticeReason, type PracticeRecord } from '../practice/practice';
import { practiceRowLabel, todayOrder } from '../practice/groups';
import { answerKey, skipStart, wrongPliesOf } from '../practice/skip';
import { studyPositions } from '../review/studyReview';
import { STARTPOS_SFEN, moveText } from '../shogi/position';
import { bookPool, studyGroupKey } from '../tree/organize';
import { bookOrder } from '../tree/studyBook';
import { moveTexts } from '../tree/studies';
import type { Study } from '../tree/types';
import { studyBookUrl } from './addToBook';
import { boardFitProps, bottomInFrame, measureFitFrame, useBoardFit } from './boardFit';
import { ensureGames, gameList } from './games';
import { gameDate } from './GamesScreen';
import { SHOW } from './hidden';
import { ensurePractice, planNow, practiceRecords, savePractice } from './practice';
import { correctToday, rememberAnswer, rememberWrong, wrongMemo } from './practiceMemory';
import { settings } from './settings';
import { back, go } from './router';
import { ensureStudies, library } from './studies';
import { buildBookIndex } from '../games/compare';
import { hardMove, markText, refutation, tableOf, type Candidate, type Refutation } from '../tree/candidates';
import { otherStudyAt, positionId, studyMovesAt } from '../tree/positions';
import { ensurePositions, noteAt, positionNotes, positionsNow } from './positions';
import { MarkTag } from './CandidateDialogs';
import { allTemplates, myTemplates, refreshMyTemplates } from './TemplateDialogs';

export type PracticeTarget = { kind: 'today' } | { kind: 'one'; studyId: string } | { kind: 'group'; key: string };

/** 稽古する 1 本（今日の稽古に入った理由つき） */
interface QueueItem {
  id: string;
  reason?: PracticeReason;
  gameAt?: number;
}

/** 相手の手を指すまでの間（ミリ秒） */
const OPPONENT_DELAY = 450;
/** 早送りの 1 手の間（ミリ秒。段階26-2） */
const SKIP_DELAY = 200;

export function PracticePlayScreen({ target }: { target: PracticeTarget }) {
  const studies = library.value;
  const records = practiceRecords.value;
  const games = gameList.value;
  const [error, setError] = useState('');
  const [queue, setQueue] = useState<QueueItem[] | null>(null);
  void myTemplates.value;

  useEffect(() => {
    const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e));
    ensureStudies().catch(fail);
    ensurePractice().catch(fail);
    ensureGames().catch(fail);
    // 候補の表を読み終える前に指すと、次善がまちがいになるので、読み終えてから出す
    ensurePositions().catch(fail);
    if (!myTemplates.value) void refreshMyTemplates().catch(() => undefined);
  }, []);

  // 始めたときに、稽古する研究手順の並びを決める（途中で記録が変わっても並びは変えない）
  useEffect(() => {
    if (queue || !studies || !records || !games) return;
    setQueue(makeQueue(target, studies, records, games));
  }, [studies, records, games]);

  if (error) return <p class="status-ng">{error}</p>;
  if (!queue || !positionNotes.value) return <p class="muted">読み込み中…</p>;
  if (queue.length === 0) {
    return (
      <>
        <div class="screen-header">
          <button type="button" class="btn btn-ghost btn-back" aria-label="‹ 稽古" onClick={() => back('/practice')}>
            ‹<span class="back-text"> 稽古</span>
          </button>
          <h1>稽古</h1>
        </div>
        <p class="muted" data-testid="practice-none">
          稽古する研究手順がありません（自分の手番のある研究手順だけ稽古できます）。
        </p>
      </>
    );
  }
  // 早送りは、続けて稽古するときだけ（行を押して 1 本だけのときは出発点から）
  return <PlayView queue={queue} continuous={target.kind !== 'one'} />;
}

function makeQueue(target: PracticeTarget, studies: readonly Study[], records: ReadonlyMap<string, PracticeRecord>, games: Parameters<typeof planNow>[2]): QueueItem[] {
  const templates = allTemplates();
  const plan = planNow(studies, records, games, templates);
  const fromPlan = (ids: Set<string> | null): QueueItem[] => [
    ...plan.today.filter((i) => !ids || ids.has(i.study.id)).map((i) => ({ id: i.study.id, reason: i.reason, ...(i.gameAt !== undefined ? { gameAt: i.gameAt } : {}) })),
    ...plan.later.filter((l) => !ids || ids.has(l.study.id)).map((l) => ({ id: l.study.id })),
  ];
  // 今日の稽古は、定跡帳ごと・手順の近い順（段階26-2。同じ出だしが続くように）
  if (target.kind === 'today') {
    const today = new Set(plan.today.map((i) => i.study.id));
    const queued = new Map(fromPlan(today).map((q) => [q.id, q]));
    return todayOrder(plan.today, studies, records, templates).map((i) => queued.get(i.study.id)!);
  }
  const able = (s: Study) => practicePlies(s, templates).length > 0;
  if (target.kind === 'one') {
    const s = studies.find((x) => x.id === target.studyId);
    if (!s || !able(s)) return [];
    return [fromPlan(new Set([s.id]))[0] ?? { id: s.id }];
  }
  // まとめて稽古は、日が来ていなくても定跡帳の全部を手順の近い順に（段階26-1）。今日の稽古に入っているものには理由の印を付ける
  const planned = new Map(fromPlan(null).map((q) => [q.id, q]));
  return bookOrder(bookPool(target.key, studies, templates))
    .filter(able)
    .map((s) => planned.get(s.id) ?? { id: s.id });
}

type Phase =
  | { kind: 'play' }
  | { kind: 'wrong'; tried: string }
  /** まちがいにしない手（表の次善・本命、ほかの研究手順の手） */
  | { kind: 'other'; tried: string; mark: 'main' | 'alt'; tag: string; name: string | null; answerIsMain: boolean }
  /** 悪手。step：咎め方を見せている手（null は見せ終わって、問題の局面に戻った） */
  | { kind: 'bad'; tried: string; tag: string; entry: Candidate; line: Refutation; step: number | null }
  | { kind: 'end'; record: PracticeRecord | null; saveError?: string };

function PlayView({ queue, continuous }: { queue: QueueItem[]; continuous: boolean }) {
  const studies = library.value ?? [];
  const templates = allTemplates();
  const [qi, setQi] = useState(0);
  const item = queue[qi];
  const study = studies.find((s) => s.id === item.id);
  if (!study) {
    // 稽古の途中で消された研究手順は飛ばす
    return (
      <div class="board-screen">
        <p class="muted">この研究手順は見つかりませんでした（消されたかもしれません）。</p>
        <button type="button" class="btn" onClick={() => (qi + 1 < queue.length ? setQi(qi + 1) : back('/practice'))}>
          {qi + 1 < queue.length ? '次の研究手順へ' : '終わる'}
        </button>
      </div>
    );
  }
  return (
    <StudyPlay
      key={`${qi}:${study.id}`}
      study={study}
      label={practiceRowLabel(study, bookPool(studyGroupKey(study, templates), studies, templates), templates)}
      item={item}
      start={practiceStart(study, templates)}
      plies={practicePlies(study, templates)}
      skip={continuous && settings.value.skipSameStart}
      index={qi}
      total={queue.length}
      onNext={() => (qi + 1 < queue.length ? setQi(qi + 1) : back('/practice'))}
    />
  );
}

function StudyPlay({
  study,
  label,
  item,
  start,
  plies,
  skip,
  index,
  total,
  onNext,
}: {
  study: Study;
  /** 見出しの文字（稽古のタブの行と同じ） */
  label: string;
  item: QueueItem;
  start: number;
  plies: number[];
  /** 同じ出だしを早送りするか */
  skip: boolean;
  index: number;
  total: number;
  onNext: () => void;
}) {
  const positions = useMemo(() => studyPositions(study.moves), [study]);
  const texts = useMemo(() => moveTexts(study.moves), [study]);
  const end = positions.length - 1;
  const own = useMemo(() => new Set(plies), [plies]);
  const [ply, setPly] = useState(start);
  /** 自分で指し始める番目（段階26-2。そこまでは両方の手をアプリが指す。早送りしないなら start）。始めたときに決める */
  const [skipTo] = useState(() => (skip ? skipStart(study, plies, start, correctToday(), wrongPliesOf(practiceRecords.value?.get(study.id), wrongMemo())) : start));
  const skipping = ply < skipTo;
  const [phase, setPhase] = useState<Phase>({ kind: 'play' });
  /** 自分の手の 1 回目の答え（手数 → 正解か） */
  const [answers, setAnswers] = useState<Map<number, boolean>>(new Map());
  const [justOk, setJustOk] = useState(false);
  /** 終わった後にさかのぼって見ている局面（null は今の局面） */
  const [view, setView] = useState<number | null>(null);
  const mySideText = study.mySide === 'black' ? '☗先手' : '☖後手';
  // 候補の表・ほかの研究手順の手（自分の側が同じ研究手順を局面で引く）と、局面メモ
  void positionNotes.value;
  const allStudies = library.value;
  const bookIndex = useMemo(() => buildBookIndex(allStudies ?? [study], study.mySide), [allStudies, study]);

  /** p 手目（0 始まり）の局面の候補の表 */
  const tableAt = (p: number) => {
    const at = positions[p] ?? STARTPOS_SFEN;
    return tableOf(positionsNow().get(positionId(study.mySide, at)), studyMovesAt(bookIndex, at));
  };
  /** その局面の正解が、見えにくい手の本命（段階21-3） */
  const hardAt = (p: number) => hardMove(tableAt(p)) === study.moves[p];

  // 相手の手番ならアプリが指す。最後まで来たら記録を保存して終わり
  useEffect(() => {
    if (phase.kind !== 'play') return;
    if (ply >= end) {
      void finish();
      return;
    }
    if (own.has(ply) && ply >= skipTo) return;
    const timer = setTimeout(() => setPly((p) => p + 1), ply < skipTo ? SKIP_DELAY : OPPONENT_DELAY);
    return () => clearTimeout(timer);
  }, [ply, phase.kind]);

  async function finish() {
    const wrongAt = [...answers].filter(([, ok]) => !ok).map(([p]) => p);
    const record = nextRecord(practiceRecords.value?.get(study.id), study.id, wrongAt.length, Date.now(), wrongAt.some(hardAt));
    try {
      // どの手をまちがえたかは、早送りのために別に覚える（記録の形は変えない）
      rememberWrong(study.id, record.lastAt, wrongAt);
      await savePractice(record);
      setPhase({ kind: 'end', record });
    } catch (e) {
      setPhase({ kind: 'end', record: null, saveError: e instanceof Error ? e.message : String(e) });
    }
  }

  const asking = phase.kind !== 'end' && !skipping && own.has(ply) && ply < end;
  const sfen = positions[ply] ?? STARTPOS_SFEN;
  /** 悪手の咎め方を盤で見せている間 */
  const replaying = phase.kind === 'bad' && phase.step !== null;
  const input = useMoveInput(
    sfen,
    (move) => {
      const prev = ply > 0 ? study.moves[ply - 1] : undefined;
      const table = tableAt(ply);
      const other = otherStudyAt(bookIndex, sfen, move.usi, study.id);
      const judge = judgeAnswer(move.usi, study.moves[ply], table, other);
      // 早送りに使うのは 1 回目の答えだけ（次善やまちがいの後の正解は入れない）
      if (phase.kind === 'play' && !answers.has(ply)) rememberAnswer(answerKey(study, ply), judge.kind === 'correct');
      if (judge.kind === 'correct') {
        if (!answers.has(ply)) setAnswers(new Map(answers).set(ply, true));
        setJustOk(phase.kind === 'play');
        setPhase({ kind: 'play' });
        setPly(ply + 1);
        return;
      }
      const tried = textAt(sfen, move.usi, prev);
      setJustOk(false);
      // まちがいに数えない（この研究手順の手を指すまで続かないのは同じ）
      if (judge.kind === 'near') {
        setPhase({
          kind: 'other',
          tried,
          mark: judge.mark,
          tag: judge.entry ? markText(table, judge.entry) : '次善',
          name: judge.other?.name ?? null,
          answerIsMain: table.some((c) => c.mark === 'main' && c.move === study.moves[ply]),
        });
        return;
      }
      if (!answers.has(ply)) setAnswers(new Map(answers).set(ply, false));
      const line = judge.kind === 'bad' ? refutation(sfen, judge.entry) : null;
      if (judge.kind === 'bad' && line) {
        // 読み筋が無ければ、見せずに問題の局面のまま
        setPhase({ kind: 'bad', tried, tag: markText(table, judge.entry), entry: judge.entry, line, step: line.texts.length > 0 ? 0 : null });
        return;
      }
      setPhase({ kind: 'wrong', tried });
    },
    asking && !replaying,
  );
  // 咎め方を 1 手ずつ見せて、最後まで来たら問題の局面に戻る
  useEffect(() => {
    if (phase.kind !== 'bad' || phase.step === null) return;
    const next = phase.step < phase.line.texts.length ? phase.step + 1 : null;
    const timer = setTimeout(() => setPhase({ ...phase, step: next }), OPPONENT_DELAY);
    return () => clearTimeout(timer);
  }, [phase]);
  useEffect(() => {
    if (!justOk) return;
    const timer = setTimeout(() => setJustOk(false), 700);
    return () => clearTimeout(timer);
  }, [justOk, ply]);

  const shown = phase.kind === 'end' && view !== null ? view : ply;
  const replay = phase.kind === 'bad' && phase.step !== null ? { line: phase.line, step: phase.step } : null;
  /** 悪手の間の、操作バーの真ん中の操作（咎め方をとばす・もう一度見る） */
  const refuteAction =
    phase.kind === 'bad' && phase.line.texts.length > 0
      ? phase.step !== null
        ? { label: 'とばして戻る', testId: 'practice-refute-skip', run: () => setPhase({ ...phase, step: null }) }
        : {
            label: '咎め方をもう一度見る',
            testId: 'practice-refute-again',
            run: () => {
              input.clear();
              setPhase({ ...phase, step: 0 });
            },
          }
      : null;
  const shownSfen = replay ? replay.line.sfens[replay.step] : (positions[shown] ?? STARTPOS_SFEN);
  const shownLast = replay ? replay.line.moves[replay.step] : shown > 0 ? study.moves[shown - 1] : undefined;

  const boardRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLElement>(null);
  // 同じ研究手順の間は、一度縮めた盤を戻さない（終わりのカードが出ても盤が行ったり来たりしない）
  const fitMemo = useRef<number | null>(null);
  const boardFit = useBoardFit(boardRef, (board) => {
    // 悪手の間は盤の大きさを変えない
    if (phase.kind === 'bad' && fitMemo.current !== null) return fitMemo.current;
    const frame = frameRef.current;
    const width = frame && cardRef.current ? measureFitFrame(board, frame, bottomInFrame(frame, cardRef.current)) : null;
    const kept = fitMemo.current !== null && width !== null ? Math.min(fitMemo.current, width) : width;
    fitMemo.current = kept;
    return kept;
  });

  /** 操作バーの真ん中の操作：早送り中は「とばす」、悪手の間は咎め方の操作 */
  const barAction = skipping ? { label: 'とばす ≫', testId: 'practice-skip', run: () => setPly(skipTo) } : refuteAction;

  const lastOpp = ply > start && !own.has(ply - 1) ? texts[ply - 1] : null;
  const mistakes = [...answers].filter(([, ok]) => !ok).map(([p]) => p);

  return (
    <div class="board-screen">
      <div class="screen-header">
        <button type="button" class="btn btn-ghost btn-back" aria-label="‹ 稽古" data-testid="practice-back" onClick={() => back('/practice')}>
          ‹<span class="back-text"> 稽古</span>
        </button>
        <h1 class="tree-title book-title" data-testid="practice-title">
          <span class="book-kicker">
            稽古 {index + 1}／{total}本・{mySideText}
          </span>
          <span class="book-label">{label}</span>
        </h1>
      </div>

      <div class="study-head">
        <p class={asking && hardAt(ply) ? 'study-title study-title-line practice-head practice-head-hard' : 'study-title study-title-line practice-head'}>
          {/* 見えにくい手の局面では、理由の印と丸の場所をそのままに隠して、上に重ねる（行の高さを変えず、盤が動かないように） */}
          {asking && hardAt(ply) && (
            <span class="kind-tag kind-hard" data-testid="practice-hard">
              ここは知らないと指せない手
            </span>
          )}
          {item.reason && (
            <span class={item.reason === 'game' ? 'kind-tag kind-mine' : item.reason === 'wrong' ? 'kind-tag kind-opp' : 'kind-tag'} data-testid="practice-reason">
              {REASON_TEXT[item.reason]}
              {item.reason === 'game' && item.gameAt !== undefined && `（${gameDate(item.gameAt)}）`}
            </span>
          )}
          <span class="practice-pips" data-testid="practice-pips" aria-label={`自分の手 ${plies.length} 問${skipTo > start ? `（早送り ${plies.filter((p) => p < skipTo).length} 問）` : ''}`}>
            {plies.map((p) => (
              <span key={p} class={`practice-pip${p < skipTo ? ' skip' : answers.get(p) === true ? ' ok' : answers.get(p) === false ? ' ng' : p === ply && asking ? ' now' : ''}`} data-testid="practice-pip" />
            ))}
          </span>
        </p>
      </div>

      <div class="tree-layout study-layout">
        <div class="board-col">
          <div ref={boardRef} {...boardFitProps(boardFit, 'tree-board')} data-testid="practice-board">
            <Board
              sfen={shownSfen}
              lastMove={shownLast}
              selection={replay ? null : input.selection}
              onSquare={input.onSquare}
              onHand={input.onHand}
              flash={justOk && view === null}
            />
            <PromotionBox input={input} />
          </div>
          <MoveBar
            ids={{ bar: 'practice-nav', prev: 'practice-prev', center: 'practice-position', next: 'practice-next-move' }}
            onPrev={() => setView(Math.max(start, shown - 1))}
            onNext={() => setView(shown + 1 >= ply ? null : shown + 1)}
            canPrev={phase.kind === 'end' && shown > start}
            canNext={phase.kind === 'end' && shown < ply}
            onCenter={barAction?.run}
            centerLabel={barAction?.label}
          >
            {barAction ? (
              <span data-testid={barAction.testId}>{barAction.label}</span>
            ) : shown === 0 ? (
              '初期局面'
            ) : (
              `${shown}手目 ${texts[shown - 1] ?? ''}`
            )}
          </MoveBar>
        </div>

        <div class="tree-side board-frame" ref={frameRef}>
          <section class="card review-prompt practice-card" ref={cardRef} data-testid="practice-card" data-phase={phase.kind === 'end' ? 'end' : skipping ? 'skip' : asking ? (phase.kind === 'play' ? 'ask' : phase.kind) : 'wait'}>
            {phase.kind === 'play' && asking && (
              <>
                {lastOpp && (
                  <p>
                    相手は <strong>{lastOpp}</strong>。{skipTo > start && ply === skipTo && <span data-testid="practice-skip-end">ここから指します。</span>}
                  </p>
                )}
                <p>あなた（{mySideText}）の手は？</p>
                <OnceHint id="answer-tap">盤の駒をタップ → 行き先をタップで答えます。</OnceHint>
              </>
            )}
            {skipping && (
              <>
                <p>同じ出だしを早送り中…</p>
                <p class="muted">{skipTo + 1}手目から、あなたが指します。</p>
              </>
            )}
            {phase.kind === 'play' && !asking && !skipping && <p class="muted">相手が指します…</p>}
            {phase.kind === 'wrong' && (
              <>
                <p class="status-ng" data-testid="practice-wrong">
                  {phase.tried} ではありません。
                </p>
                <p>
                  正解は <strong class="practice-answer" data-testid="practice-answer">{texts[ply]}</strong>。盤で指すと続きます。
                </p>
              </>
            )}
            {phase.kind === 'other' && (
              <>
                <p data-testid="practice-other">
                  {phase.tried} は <MarkTag mark={phase.mark} text={phase.tag} />
                  {phase.name && `「${phase.name}」の研究の手`}（まちがいにしません）。
                </p>
                <p>
                  {phase.answerIsMain ? '本命は' : 'この研究は'} <strong class="practice-answer" data-testid="practice-answer">{texts[ply]}</strong>。盤で指すと続きます。
                </p>
              </>
            )}
            {phase.kind === 'bad' && (
              <>
                <p class="status-ng" data-testid="practice-bad">
                  {phase.tried} は悪手です。 <MarkTag mark="bad" text={phase.tag} />
                </p>
                {phase.step !== null ? (
                  <p data-testid="practice-refute">
                    咎め方 <span class="num">{phase.step}／{phase.line.texts.length}</span>：
                    {/* 長い読み筋は今のあたりの 3 手だけ（カードを高くしない） */}
                    {phase.line.texts.map((t, i) => {
                      const from = Math.max(0, Math.min(phase.step! - 2, phase.line.texts.length - 3));
                      return i >= from && i < from + 3 ? (
                        <span key={i} class={i + 1 === phase.step ? 'practice-refute-on' : ''}>
                          {t}{' '}
                        </span>
                      ) : null;
                    })}
                  </p>
                ) : (
                  <p>
                    正解は <strong class="practice-answer" data-testid="practice-answer">{texts[ply]}</strong>。盤で指すと続きます。
                  </p>
                )}
              </>
            )}
            {phase.kind === 'end' && (
              <EndCard record={phase.record} saveError={phase.saveError} mistakes={mistakes} texts={texts} rest={total - index - 1} onNext={onNext} />
            )}
          </section>
          {/* 悪手の理由と局面メモはカードの下（盤の大きさはカードまでで決める） */}
          {SHOW.comments && phase.kind === 'bad' && phase.entry.reason && (
            <div class="practice-after">
              <p class="study-note practice-note">{phase.entry.reason}</p>
            </div>
          )}
          {SHOW.comments && (phase.kind === 'wrong' || phase.kind === 'other' || phase.kind === 'bad') && noteAt(study.mySide, sfen) && (
            <div class="practice-after">
              <p class="study-note practice-note" data-testid="practice-memo">
                <span class="practice-memo-label">局面メモ</span>
                {noteAt(study.mySide, sfen)}
              </p>
            </div>
          )}
          {/* 終わった後のメモと「定跡帳で見る」はカードの下（盤の大きさはカードまでで決める。入りきらなければ枠の中でスクロール） */}
          {phase.kind === 'end' && (
            <div class="practice-after">
              {SHOW.comments && study.note && <p class="study-note practice-note">{study.note}</p>}
              <button type="button" class="btn btn-wide" data-testid="practice-book" onClick={() => go(studyBookUrl(study))}>
                定跡帳で見る
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** 指した手の文字（まちがえた手を出す。読めなければ USI のまま） */
function textAt(sfen: string, usi: string, prev?: string): string {
  try {
    return moveText(sfen, usi, prev);
  } catch {
    return usi;
  }
}

/** 1 本終わったときのカード：結果・次の稽古の日（段の並び）・次へ */
function EndCard({
  record,
  saveError,
  mistakes,
  texts,
  rest,
  onNext,
}: {
  record: PracticeRecord | null;
  saveError?: string;
  mistakes: number[];
  texts: string[];
  rest: number;
  onNext: () => void;
}) {
  const days = record ? Math.round((record.dueAt - startOfDay(record.lastAt)) / 86_400_000) : 0;
  return (
    <>
      {mistakes.length === 0 ? (
        <p class="status-ok" data-testid="practice-end">
          全部正解。次は {days === 1 ? '明日' : `${days}日後`}（{record ? gameDate(record.dueAt) : ''}）です。
        </p>
      ) : (
        <p data-testid="practice-end">
          最後まで指しました。
          {mistakes.map((p) => (
            <strong key={p}>
              {' '}
              {p + 1}手目 {texts[p]}
            </strong>
          ))}{' '}
          をまちがえました。次は明日です。
        </p>
      )}
      {record && (
        <div class="practice-ladder" data-testid="practice-ladder" aria-label="次の稽古までの間隔">
          <span>次：</span>
          {STEP_LABELS.map((l, i) => (
            <span key={l} class={i === record.step ? 'practice-step on' : 'practice-step'}>
              {l}
            </span>
          ))}
        </div>
      )}
      {saveError && <p class="status-ng">記録を保存できませんでした（{saveError}）</p>}
      <button type="button" class="btn btn-primary btn-wide" data-testid="practice-next" onClick={onNext}>
        {rest > 0 ? `次の研究手順へ（あと ${rest}本）` : '終わる'}
      </button>
    </>
  );
}
