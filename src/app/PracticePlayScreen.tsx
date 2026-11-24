// 稽古の画面（段階19。#/practice/play〔今日の稽古〕・#/practice/play/<研究手順の id>〔その 1 本〕・#/practice/group/<定跡帳の key>〔そのグループ〕）。
// 持ち主の判断 2026-11-24「おすすめの通りで」：
// - 研究手順を 1 本ずつ、戦型の出発点から終わりまで通して指す。相手の手は研究手順の通りにアプリが指す（少し間を置いて）
// - まちがえたら「△5二玉 ではありません。正解は △6二玉」。盤で正解を指すと続く（止めずに最後まで）。数えるのは 1 回目の答えだけ
// - 1 本終わったら記録を保存（全部正解なら次の間隔へ、まちがえたら明日）し、「次の研究手順へ（あと n本）」
// - 段階20-1：ほかの研究手順の自分の手（同じ局面・手順前後も）を指したら、まちがいにしない（「それは『X』の研究の手です」）。
//   まちがえたとき・ほかの研究の手のときは、その局面の局面メモをカードの下に出す
// - 盤の画面の決まり（段階14）：1 画面に収める。上の行に、今日の稽古に入った理由と、自分の手の数だけの丸（正解は茶・まちがいは朱）

import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Board } from '../components/Board';
import { MoveBar } from '../components/MoveBar';
import { OnceHint } from '../components/OnceHint';
import { PromotionBox, useMoveInput } from '../components/useMoveInput';
import { STEP_LABELS, REASON_TEXT, nextRecord, practicePlies, practiceStart, startOfDay, type PracticeReason, type PracticeRecord } from '../practice/practice';
import { studyPositions } from '../review/studyReview';
import { STARTPOS_SFEN, moveText } from '../shogi/position';
import { bookPool } from '../tree/organize';
import { moveTexts } from '../tree/studies';
import type { Study } from '../tree/types';
import { studyBookUrl } from './addToBook';
import { boardFitProps, bottomInFrame, measureFitFrame, useBoardFit } from './boardFit';
import { ensureGames, gameList } from './games';
import { gameDate } from './GamesScreen';
import { ensurePractice, planNow, practiceRecords, savePractice } from './practice';
import { back, go } from './router';
import { ensureStudies, library } from './studies';
import { buildBookIndex } from '../games/compare';
import { otherStudyAt } from '../tree/positions';
import { ensurePositions, noteAt, positionNotes } from './positions';
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
    if (!myTemplates.value) void refreshMyTemplates().catch(() => undefined);
  }, []);

  // 始めたときに、稽古する研究手順の並びを決める（途中で記録が変わっても並びは変えない）
  useEffect(() => {
    if (queue || !studies || !records || !games) return;
    setQueue(makeQueue(target, studies, records, games));
  }, [studies, records, games]);

  if (error) return <p class="status-ng">{error}</p>;
  if (!queue) return <p class="muted">読み込み中…</p>;
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
  return <PlayView queue={queue} />;
}

function makeQueue(target: PracticeTarget, studies: readonly Study[], records: ReadonlyMap<string, PracticeRecord>, games: Parameters<typeof planNow>[2]): QueueItem[] {
  const templates = allTemplates();
  const plan = planNow(studies, records, games, templates);
  const fromPlan = (ids: Set<string> | null): QueueItem[] => [
    ...plan.today.filter((i) => !ids || ids.has(i.study.id)).map((i) => ({ id: i.study.id, reason: i.reason, ...(i.gameAt !== undefined ? { gameAt: i.gameAt } : {}) })),
    ...plan.later.filter((l) => !ids || ids.has(l.study.id)).map((l) => ({ id: l.study.id })),
  ];
  if (target.kind === 'today') return fromPlan(null).filter((q) => q.reason);
  const able = (s: Study) => practicePlies(s, templates).length > 0;
  if (target.kind === 'one') {
    const s = studies.find((x) => x.id === target.studyId);
    if (!s || !able(s)) return [];
    return [fromPlan(new Set([s.id]))[0] ?? { id: s.id }];
  }
  const pool = bookPool(target.key, studies, templates).filter(able);
  const ids = new Set(pool.map((s) => s.id));
  const planned = fromPlan(ids);
  const seen = new Set(planned.map((q) => q.id));
  return [...planned, ...pool.filter((s) => !seen.has(s.id)).map((s) => ({ id: s.id }))];
}

type Phase = { kind: 'play' } | { kind: 'wrong'; tried: string } | { kind: 'other'; tried: string; name: string } | { kind: 'end'; record: PracticeRecord | null; saveError?: string };

function PlayView({ queue }: { queue: QueueItem[] }) {
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
      item={item}
      start={practiceStart(study, templates)}
      plies={practicePlies(study, templates)}
      index={qi}
      total={queue.length}
      onNext={() => (qi + 1 < queue.length ? setQi(qi + 1) : back('/practice'))}
    />
  );
}

function StudyPlay({
  study,
  item,
  start,
  plies,
  index,
  total,
  onNext,
}: {
  study: Study;
  item: QueueItem;
  start: number;
  plies: number[];
  index: number;
  total: number;
  onNext: () => void;
}) {
  const positions = useMemo(() => studyPositions(study.moves), [study]);
  const texts = useMemo(() => moveTexts(study.moves), [study]);
  const end = positions.length - 1;
  const own = useMemo(() => new Set(plies), [plies]);
  const [ply, setPly] = useState(start);
  const [phase, setPhase] = useState<Phase>({ kind: 'play' });
  /** 自分の手の 1 回目の答え（手数 → 正解か） */
  const [answers, setAnswers] = useState<Map<number, boolean>>(new Map());
  const [justOk, setJustOk] = useState(false);
  /** 終わった後にさかのぼって見ている局面（null は今の局面） */
  const [view, setView] = useState<number | null>(null);
  const mySideText = study.mySide === 'black' ? '☗先手' : '☖後手';
  // 段階20-1：ほかの研究手順の手か（自分の側が同じ研究手順を局面で引く）と、局面メモ
  void positionNotes.value;
  useEffect(() => {
    void ensurePositions().catch(() => undefined);
  }, []);
  const allStudies = library.value;
  const bookIndex = useMemo(() => buildBookIndex(allStudies ?? [study], study.mySide), [allStudies, study]);

  // 相手の手番ならアプリが指す。最後まで来たら記録を保存して終わり
  useEffect(() => {
    if (phase.kind !== 'play') return;
    if (ply >= end) {
      void finish();
      return;
    }
    if (own.has(ply)) return;
    const timer = setTimeout(() => setPly((p) => p + 1), OPPONENT_DELAY);
    return () => clearTimeout(timer);
  }, [ply, phase.kind]);

  async function finish() {
    const mistakes = [...answers.values()].filter((ok) => !ok).length;
    const record = nextRecord(practiceRecords.value?.get(study.id), study.id, mistakes, Date.now());
    try {
      await savePractice(record);
      setPhase({ kind: 'end', record });
    } catch (e) {
      setPhase({ kind: 'end', record: null, saveError: e instanceof Error ? e.message : String(e) });
    }
  }

  const asking = phase.kind !== 'end' && own.has(ply) && ply < end;
  const sfen = positions[ply] ?? STARTPOS_SFEN;
  const input = useMoveInput(
    sfen,
    (move) => {
      const correct = move.usi === study.moves[ply];
      if (correct) {
        if (!answers.has(ply)) setAnswers(new Map(answers).set(ply, true));
        setJustOk(phase.kind === 'play');
        setPhase({ kind: 'play' });
        setPly(ply + 1);
        return;
      }
      const tried = textAt(sfen, move.usi, ply > 0 ? study.moves[ply - 1] : undefined);
      setJustOk(false);
      // ほかの研究手順の手なら、まちがいに数えない（正解の手を指すまで続かないのは同じ）
      const other = otherStudyAt(bookIndex, sfen, move.usi, study.id);
      if (other) {
        setPhase({ kind: 'other', tried, name: other.name });
        return;
      }
      if (!answers.has(ply)) setAnswers(new Map(answers).set(ply, false));
      setPhase({ kind: 'wrong', tried });
    },
    asking,
  );
  useEffect(() => {
    if (!justOk) return;
    const timer = setTimeout(() => setJustOk(false), 700);
    return () => clearTimeout(timer);
  }, [justOk, ply]);

  const shown = phase.kind === 'end' && view !== null ? view : ply;
  const shownSfen = positions[shown] ?? STARTPOS_SFEN;
  const shownLast = shown > 0 ? study.moves[shown - 1] : undefined;

  const boardRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLElement>(null);
  // 同じ研究手順の間は、一度縮めた盤を戻さない（終わりのカードが出ても盤が行ったり来たりしない）
  const fitMemo = useRef<number | null>(null);
  const boardFit = useBoardFit(boardRef, (board) => {
    const frame = frameRef.current;
    const width = frame && cardRef.current ? measureFitFrame(board, frame, bottomInFrame(frame, cardRef.current)) : null;
    const kept = fitMemo.current !== null && width !== null ? Math.min(fitMemo.current, width) : width;
    fitMemo.current = kept;
    return kept;
  });

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
          <span class="book-label">{study.name}</span>
        </h1>
      </div>

      <div class="study-head">
        <p class="study-title study-title-line practice-head">
          {item.reason && (
            <span class={item.reason === 'game' ? 'kind-tag kind-mine' : item.reason === 'wrong' ? 'kind-tag kind-opp' : 'kind-tag'} data-testid="practice-reason">
              {REASON_TEXT[item.reason]}
              {item.reason === 'game' && item.gameAt !== undefined && `（${gameDate(item.gameAt)}）`}
            </span>
          )}
          <span class="practice-pips" data-testid="practice-pips" aria-label={`自分の手 ${plies.length} 問`}>
            {plies.map((p) => (
              <span key={p} class={`practice-pip${answers.get(p) === true ? ' ok' : answers.get(p) === false ? ' ng' : p === ply && asking ? ' now' : ''}`} data-testid="practice-pip" />
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
              selection={input.selection}
              onSquare={input.onSquare}
              onHand={input.onHand}
              flash={justOk && view === null}
            />
            <PromotionBox input={input} />
          </div>
          <MoveBar
            fixed={false}
            ids={{ bar: 'practice-nav', prev: 'practice-prev', center: 'practice-position', next: 'practice-next-move' }}
            onPrev={() => setView(Math.max(start, shown - 1))}
            onNext={() => setView(shown + 1 >= ply ? null : shown + 1)}
            canPrev={phase.kind === 'end' && shown > start}
            canNext={phase.kind === 'end' && shown < ply}
          >
            {shown === 0 ? '初期局面' : `${shown}手目 ${texts[shown - 1] ?? ''}`}
          </MoveBar>
        </div>

        <div class="tree-side board-frame" ref={frameRef}>
          <section class="card review-prompt practice-card" ref={cardRef} data-testid="practice-card" data-phase={phase.kind === 'end' ? 'end' : asking ? (phase.kind === 'play' ? 'ask' : phase.kind) : 'wait'}>
            {phase.kind === 'play' && asking && (
              <>
                {lastOpp && (
                  <p>
                    相手は <strong>{lastOpp}</strong>。
                  </p>
                )}
                <p>あなた（{mySideText}）の手は？</p>
                <OnceHint id="answer-tap">盤の駒をタップ → 行き先をタップで答えます。</OnceHint>
              </>
            )}
            {phase.kind === 'play' && !asking && <p class="muted">相手が指します…</p>}
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
                  {phase.tried} は「{phase.name}」の研究の手です（まちがいにしません）。
                </p>
                <p>
                  この研究は <strong class="practice-answer" data-testid="practice-answer">{texts[ply]}</strong>。盤で指すと続きます。
                </p>
              </>
            )}
            {phase.kind === 'end' && (
              <EndCard record={phase.record} saveError={phase.saveError} mistakes={mistakes} texts={texts} rest={total - index - 1} onNext={onNext} />
            )}
          </section>
          {/* 段階20-1：まちがえたとき・ほかの研究の手のときは、その局面の局面メモ（カードの下。盤の大きさはカードまでで決める） */}
          {(phase.kind === 'wrong' || phase.kind === 'other') && noteAt(study.mySide, sfen) && (
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
              {study.note && <p class="study-note practice-note">{study.note}</p>}
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
