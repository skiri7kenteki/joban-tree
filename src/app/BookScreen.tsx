// 定跡帳（段階9-2 の「定跡帳として見る」を、段階10-1 で研究を入力する場所の中心にした。持ち主の判断 2026-11-19「おすすめの通りで」）。
//   #/book/<key>[/<研究手順の id>/<手数>]、#/book/<key>/t/<戦型の id>（新しい研究を始めるとき。研究手順がまだ無くても開ける）、
//   #/book/<key>/m/<手順>（段階18：実戦の外れた局面。研究の木の外でもその局面で開き、盤の上に「実戦 11/08 の 21手目。指すと研究に足します」。‹ で実戦の画面へ戻る）
// - 盤で指すと、その場で研究手順に足す（名前は自動、保存も自動）。決まりは src/tree/bookEdit.ts
//   （同じ手 → 進むだけ／ここで終わる研究手順 → 延ばす／それ以外 → 新しい研究手順）
// - 誤操作の対策：足すたびに画面の下に「▲3六歩 を足しました［取り消す］」を 5 秒。「↶ 取り消す」で何回でも続けて戻せる
//   （足す・消す・ここで終わりにする・研究手順を消す・名前とメモを直す。この画面を開いている間だけ）。⋯ の「書き込む」を切にすると読むだけ
// - 「この局面からの研究」の行の ⋯ で「この手から先を消す」。⋯ に、今の研究手順の操作（名前・メモ・稽古・KIF をコピー・ここで終わりにする・消す）、
//   定跡帳の操作（まとめて稽古・取り消す・KIF で渡す・書き込む 入／切）。段階20-3 で「この局面」（ツリーを作る・ツリーで見る）と 1 本ずつの JSON・KIF で渡すを外した
// - ★ の行を押すと、今の研究手順の名前・メモを直す
// - 段階11-2：‹ › の行と手順の行（パンくず）をやめ、盤の下の固定バー（MoveBar）に。手数を押すと手順の一覧
// - 段階11-3：⋯ は画面の下から（小見出し「この研究手順」「この局面」「定跡帳」・短い文字）。★ の行の右端に［復習］（段階19 から［稽古］）
// - 段階12-3：［復習］は金。「この局面からの研究」の見出しの左に「芽」の紋、行に、その手を通る研究手順の割合の棒（行の高さは変えない）
// - 段階20-1：一覧の見出しの行に局面メモ（1 行目。押すと窓で読む・直す）。自分の手番で研究手順によって自分の手が違う（食い違い）とき、その手の行に印、
//   手順前後で来るほかの研究手順の手は「手順前後」の行。行の ⋯ で「このままでよい」。KIF の書き出しに局面メモを入れる
// - 段階20-2：一覧の見出しの行の右端に［エンジンに聞く］（src/app/AskEngine.tsx）
// - 段階21-1：自分の手番の局面に候補の表（本命・次善・悪手。src/tree/candidates.ts、窓は src/app/CandidateDialogs.tsx）。行に印、研究手順の無い手は薄い行、
//   見出しの行は表の要約（局面メモは候補の窓の下へ）。行の ⋯ で印を付け替える。食い違いは「どちらを本命にするか」。表の変更も「取り消す」で戻る
// 研究手順の画面（StudyScreen）と編集モードは段階10-2 で片付けた（古い URL は src/app/LegacyRedirect.tsx でここへ移す）。

import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Board } from '../components/Board';
import { Dialog } from '../components/Dialog';
import { PromotionBox, useMoveInput } from '../components/useMoveInput';
import { STARTPOS_SFEN, moveText, sfenKey, sideToMove, type Side } from '../shogi/position';
import { buildBookIndex } from '../games/compare';
import { conflictAt, positionId, studyMovesAt, type Conflict } from '../tree/positions';
import { MARK_TEXT, candidatesKifLine, chooseMain, markText, setMark, setReason, summaryText, tableOf, type Candidate, type CandidateMark } from '../tree/candidates';
import { ensurePositions, isMarkedBad, noteAt, positionNotes, positionsNow, restoreTable, saveNote, saveTable, tableSnapshot, type TableSnapshot } from './positions';
import { CandidateWindow, MarkChooser, MarkTag, MemoDialog } from './CandidateDialogs';
import { MainChoice } from './ConflictNotice';
import { settings } from './settings';
import { studyBookUrl } from './addToBook';
import { studyPositions } from '../review/studyReview';
import { fileNameOf } from '../tree/backup';
import {

  coveredDepth,
  cutBranch,
  cutMoveAt,
  endHere,
  inverseChange,
  playInBook,
  playLineInBook,
  settleView,
  studiesPlaying,
  type BookChange,
  type BookCtx,
  type BookView,
  type CutPlan,
} from '../tree/bookEdit';
import { bookLabel, bookPool, bookSide, fitsBook, isHirateBook } from '../tree/organize';
import { firstLine, moveTexts, newStudyId, startsWith, studyMovesText } from '../tree/studies';
import { bookAt, bookOrder, bookStart, type BookBranch, type BookPosition } from '../tree/studyBook';
import { studiesToKif } from '../tree/studyFile';
import { listName, type OpeningTemplate } from '../tree/templates';
import type { Study } from '../tree/types';
import { boardFitProps, measureFitFrame, threeRowsNeed, useBoardFit } from './boardFit';
import { takeHint } from './recent';
import { back, bookPath, go, groupPracticePath } from './router';
import { bookFromGame } from './games';
import { OUTCOME_TEXT, copyText, shareFile } from './share';
import { StudyEditDialog } from './StudyDialogs';
import { applyStudyChange, ensureStudies, library, studiesNow } from './studies';
import { KifuPanel, KifuSheet, useWideLayout, type KifuRow } from '../components/KifuList';
import { MoveBar } from '../components/MoveBar';
import { AskEngine } from './AskEngine';
import { allTemplates, myTemplates, refreshMyTemplates } from './TemplateDialogs';

/** 「書き込む」の入／切（端末ごとに覚える。初期値は入） */
const WRITE_KEY = 'joban-tree:book-write';

function loadWrite(): boolean {
  try {
    return localStorage.getItem(WRITE_KEY) !== 'off';
  } catch {
    return true;
  }
}

function saveWrite(on: boolean): void {
  try {
    localStorage.setItem(WRITE_KEY, on ? 'on' : 'off');
  } catch {
    // 保存できなくても、この画面の間は効く
  }
}

/** 候補の表がいっぱいのときの一言 */
const TABLE_FULL = '候補の表は 8 手までです。使わない手を表から外してください。';

/** 取り消しの知らせを出しておく時間（ミリ秒） */
const TOAST_MS = 5000;

/** 定跡帳の画面。研究手順と戦型を読み終えてから中身を出す */
export function BookScreen({ bookKey, id, ply, template, line }: { bookKey: string; id?: string; ply?: number; template?: string; line?: string[] }) {
  const [error, setError] = useState('');
  const studies = library.value;
  void myTemplates.value;
  // 定跡帳はグループ分けに自分で登録した戦型も使うので、読み終わるまで待つ。
  // 読み終えたかは myTemplates をそのまま見る（段階20-3 の直し：アプリを開いたときの研究手順の直し〔studyFix〕が先に読み終えると、
  // 前の作り〔読み終えたら自分で印を立てる〕では印が立たず、ずっと「読み込み中…」のままになることがあった）。読めなかったときも先へ進む
  const [templatesFailed, setTemplatesFailed] = useState(false);
  const templatesReady = myTemplates.value !== null || templatesFailed;
  /** 一度開いたら、研究手順を全部消しても（取り消せるように）定跡帳のまま */
  const opened = useRef(false);
  useEffect(() => {
    ensureStudies().catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    if (!myTemplates.value) void refreshMyTemplates().catch(() => setTemplatesFailed(true));
    // 局面メモと候補の表を読み終える前に指したり印を付けたりすると、前の記録を知らないまま上書きするので、読み終わるまで待つ
    ensurePositions().catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  if (error) return <p class="status-ng">{error}</p>;
  if (!studies || !templatesReady || !positionNotes.value) return <p class="muted">読み込み中…</p>;
  const templates = allTemplates();
  const side = bookSide(bookKey);
  const pool = bookPool(bookKey, studies, templates);
  // 出発点に使う戦型：その定跡帳のグループの戦型だけ（平手からの定跡帳ではどの戦型でも）
  const tpl = template ? templates.find((t) => t.id === template && (isHirateBook(bookKey) || `study:${t.group}|${side}` === bookKey)) : undefined;
  if (!side || (pool.length === 0 && !tpl && !isHirateBook(bookKey) && !opened.current)) {
    return (
      <>
        <div class="screen-header">
          <button type="button" class="btn btn-ghost" onClick={() => go('/')}>
            ‹ 一覧
          </button>
          <h1>定跡帳</h1>
        </div>
        <p class="muted" data-testid="book-missing">
          このグループの研究手順はありません（消されたか、戦型が変わったかもしれません）。
        </p>
      </>
    );
  }
  opened.current = true;
  return <BookViewScreen bookKey={bookKey} side={side} pool={pool} templates={templates} id={id} ply={ply} tpl={tpl} openLine={line} />;
}

/** 定跡帳の出発点：平手からの定跡帳は初期局面。戦型のグループは、研究手順（と今の手順）が全部通る、自分の側が同じ、いちばん浅い戦型の出発点（段階10 の直し） */
function startOf(key: string, pool: readonly Study[], line: readonly string[], templates: readonly OpeningTemplate[]): number {
  if (isHirateBook(key)) return 0;
  return bookStart([...pool, { moves: [...line] }], templates, bookSide(key) ?? 'black');
}

const byLatest = (a: Study, b: Study) => b.updatedAt - a.updatedAt;

/** 開いたときの手順と局面 */
function initialView(key: string, pool: readonly Study[], templates: readonly OpeningTemplate[], id?: string, ply?: number, tpl?: OpeningTemplate, openLine?: string[]): BookView {
  // 段階18：実戦の外れた局面（平手からの手順）。その手順を通る研究手順があればそれで、無ければ研究の木の外として
  if (openLine && openLine.length > 0) {
    const through = pool.filter((x) => startsWith(x.moves, openLine)).sort(byLatest)[0];
    return through ? { id: through.id, line: [...through.moves], index: openLine.length } : { id: null, line: [...openLine], index: openLine.length };
  }
  const s = id ? pool.find((x) => x.id === id) : undefined;
  if (s) return { id: s.id, line: [...s.moves], index: Math.min(s.moves.length, ply ?? s.moves.length) };
  if (tpl) {
    const through = pool.filter((x) => startsWith(x.moves, tpl.moves)).sort(byLatest)[0];
    return through ? { id: through.id, line: [...through.moves], index: tpl.moves.length } : { id: null, line: [...tpl.moves], index: tpl.moves.length };
  }
  const latest = [...pool].sort(byLatest)[0];
  if (latest) return { id: latest.id, line: [...latest.moves], index: startOf(key, pool, latest.moves, templates) };
  return { id: null, line: [], index: 0 };
}

/** 窓 */
type BookDialog =
  | { kind: 'menu' }
  | { kind: 'fields' }
  /** 行の ⋯：自分の手番は印の付け替え。branch：この定跡帳の研究手順がある手（消す操作も出す） */
  | { kind: 'row'; move: string; branch: boolean }
  /** 研究手順が通っている手を悪手にする確認 */
  | { kind: 'bad'; move: string }
  | { kind: 'cand' }
  | { kind: 'end' }
  | { kind: 'delete' }
  | { kind: 'memo' }
  /** picked：盤で指して調べる手 */
  | { kind: 'ask'; picked?: string };

/** 取り消し 1 回分：元に戻す研究手順の変更と候補の表（どちらか、または両方）、その操作の前の盤 */
interface UndoEntry {
  change?: BookChange;
  table?: { sfen: string; snapshot: TableSnapshot };
  view: BookView;
}

function BookViewScreen({
  bookKey,
  side,
  pool,
  templates,
  id,
  ply,
  tpl,
  openLine,
}: {
  bookKey: string;
  side: Side;
  pool: Study[];
  templates: OpeningTemplate[];
  id?: string;
  ply?: number;
  tpl?: OpeningTemplate;
  openLine?: string[];
}) {
  const [view, setView] = useState<BookView>(() => initialView(bookKey, pool, templates, id, ply, tpl, openLine));
  // 段階18：実戦から開いたときの一言（開いた局面にいる間だけ）
  const gameNote = openLine && bookFromGame.value?.line === openLine.join('.') ? bookFromGame.value.text : null;
  const current = view.id ? (pool.find((s) => s.id === view.id) ?? null) : null;
  const line = current ? current.moves : view.line;
  const positions = useMemo(() => studyPositions(line), [line]);
  const texts = useMemo(() => moveTexts(line), [line]);
  const last = positions.length - 1;
  const start = startOf(bookKey, pool, line, templates);
  /** 戻れるいちばん前の局面（出発点より前に戻らない） */
  const minIndex = Math.min(start, last);
  const index = Math.max(minIndex, Math.min(view.index, last));
  const here = line.slice(0, index);
  const sfen = positions[index] ?? STARTPOS_SFEN;
  const prevMove = index > 0 ? line[index - 1] : undefined;
  const label = bookLabel(bookKey);
  // 出発点の名前：自分の側が同じ戦型を先に
  const startCandidates = start > 0 ? templates.filter((t) => t.moves.length === start && startsWith(line, t.moves)) : [];
  const startTemplate = startCandidates.find((t) => t.mySide === side) ?? startCandidates[0];
  const startName = startTemplate ? listName(startTemplate) : '初期局面';
  /** 研究の木が通っている、今の手順のいちばん深い局面（それより先は木の外。パンくずを薄く） */
  const covered = coveredDepth(pool, line);

  const [dialog, setDialog] = useState<BookDialog | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [write, setWriteState] = useState(loadWrite);
  const [toast, setToast] = useState<{ text: string; undo: boolean; seq: number } | null>(null);
  const undoStack = useRef<UndoEntry[]>([]);
  const [undoCount, setUndoCount] = useState(0);
  /** 棋譜欄（段階11-5）：広い画面は盤の横に常に、スマホ縦は固定バーの手数を押すと画面下から */
  const wide = useWideLayout();
  const [kifuOpen, setKifuOpen] = useState(false);
  // 出発点より前の手は薄く・押せない（この画面は出発点より前に戻らない）。出発点の行に戦型の名前、今より先の手は少し薄く
  const kifuRows: KifuRow[] = [
    { ply: 0, text: '初期局面', dim: minIndex > 0, disabled: minIndex > 0 },
    ...texts.map((t, i) => ({
      ply: i + 1,
      text: t,
      dim: i + 1 < minIndex,
      disabled: i + 1 < minIndex,
      ahead: i + 1 > index,
      ...(i + 1 === minIndex ? { note: startName } : {}),
    })),
  ];

  // 今たどっている研究手順が無くなった（ほかの画面で消したなど）：近くの研究手順へ
  useEffect(() => {
    if (view.id && !current) setView(settleView(pool, view.line, view.index, null));
  }, [view.id, current, pool]);


  // 取り消しの知らせは 5 秒で消す
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast?.seq]);

  // 今の研究手順と局面を URL に書いておく（戻るボタンで戻ってきたときに同じところを開く）。画面は移らない（hashchange は起きない）
  useEffect(() => {
    const url = `#${current ? bookPath(bookKey, current.id, index) : bookPath(bookKey)}`;
    if (current && location.hash !== url) history.replaceState(history.state, '', url);
  }, [bookKey, current?.id, index]);


  // 段階20-1：局面メモと食い違い（自分の側が同じ研究手順すべてを局面で引く。手順前後も同じ局面）
  void positionNotes.value;
  const allStudies = library.value ?? pool;
  const bookIndex = useMemo(() => buildBookIndex(allStudies, side), [allStudies, side]);
  const conflict = conflictAt(bookIndex, side, sfen, positionsNow());
  const memo = noteAt(side, sfen);
  // 段階21-1：自分の手番の局面の候補の表
  const mine = sideToMove(sfen) === side;
  /** この局面の研究の自分の手すべて（手順前後・ほかのグループの研究手順も） */
  const studyMoves = mine ? studyMovesAt(bookIndex, sfen) : [];
  const table = mine ? tableOf(positionsNow().get(positionId(side, sfen)), studyMoves) : [];
  /** 盤で指した手を、足さずにエンジンで調べる（局面が変わったらやめる） */
  const [picking, setPicking] = useState(false);
  useEffect(() => setPicking(false), [sfen]);

  // 段階14：1 画面に収める。「この局面からの研究」の枠の中で 3 行目まで見える盤の幅（一覧の行が少ない局面でも同じだけ空けて、盤の大きさを変えない）
  const boardRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const branchesRef = useRef<HTMLDivElement>(null);
  const boardFit = useBoardFit(boardRef, (board) => {
    const frame = frameRef.current;
    const list = branchesRef.current;
    if (!frame || !list) return null;
    const rows = list.querySelectorAll<HTMLElement>('.book-row:not(.book-empty)');
    // 成る・成らないの小窓は数えない（盤の大きさが変わらないように）
    const promote = frame.querySelector<HTMLElement>('.promote-box')?.getBoundingClientRect().height ?? 0;
    return measureFitFrame(board, frame, threeRowsNeed(frame, rows, list.querySelector<HTMLElement>('.candidates-head'), ROW_GUESS) - promote);
  });
  // 段階14：操作の結果の一言（コピーしました・読むだけ など）は、一覧の下ではなく画面の下の知らせで 5 秒（画面を広げない）
  useEffect(() => {
    if (!note) return;
    // 新しい一言が出たら、前の取り消しの知らせは消す（両方が同時に消えて、一言が一度も見えないことがあったため。取り消しは ⋯ からもできる）
    setToast(null);
    const timer = setTimeout(() => setNote(''), TOAST_MS);
    return () => clearTimeout(timer);
  }, [note]);
  /** 初めての 1 回だけの説明（盤で指すと足される）。画面の下の知らせとして 8 秒 */
  const [hint, setHint] = useState(() => write && pool.length > 0 && takeHint('book-write'));
  useEffect(() => {
    if (!hint) return;
    const timer = setTimeout(() => setHint(false), 8000);
    return () => clearTimeout(timer);
  }, [hint]);

  const input = useMoveInput(sfen, (move) => void onPlay(move.usi), !busy);

  function moveTo(i: number) {
    input.clear();
    setPicking(false);
    setView({ id: current?.id ?? null, line: [...line], index: Math.max(minIndex, Math.min(last, i)) });
    setNote('');
  }

  /** ほかの研究手順へ（同じ局面のまま、またはその手を指した局面へ） */
  function switchTo(target: Study, at: number) {
    input.clear();
    setPicking(false);
    setNote('');
    setView({ id: target.id, line: [...target.moves], index: at });
  }

  /** 次の手を押した：今の研究手順の次の手なら 1 手進む。違う手なら、その手を通る研究手順のうちいちばん最近直したものへ */
  function pickBranch(branch: BookBranch<Study>) {
    if (current && current.moves[index] === branch.move) moveTo(index + 1);
    else switchTo(branch.studies[0], index + 1);
  }

  // 左右スワイプ：右へ払うと 1 手戻る、左へ払うと 1 手進む
  const touch = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: TouchEvent) => {
    const t = e.touches[0];
    touch.current = { x: t.clientX, y: t.clientY };
  };
  const onTouchEnd = (e: TouchEvent) => {
    const s = touch.current;
    touch.current = null;
    if (!s) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - s.x;
    const dy = t.clientY - s.y;
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    moveTo(dx > 0 ? index - 1 : index + 1);
  };

  // ---- 書き込む ----

  const ctx = (): BookCtx => ({ templates, side, start, now: Date.now(), newId: newStudyId, fits: (s) => fitsBook(bookKey, s, templates) });
  const nowView = (): BookView => ({ id: current?.id ?? null, line: [...line], index });

  function showToast(text: string, undo: boolean) {
    setToast((t) => ({ text, undo, seq: (t?.seq ?? 0) + 1 }));
  }

  /** 変更を保存して、取り消しの記録に積む。after：保存した後の盤 */
  async function commit(change: BookChange, after: (list: Study[]) => BookView, message: string) {
    const before = studiesNow();
    const was = nowView();
    setBusy(true);
    try {
      const list = await applyStudyChange(change);
      undoStack.current.push({ change: inverseChange(change, before), view: was });
      setUndoCount(undoStack.current.length);
      setView(after(bookPool(bookKey, list, templates)));
      setNote('');
      showToast(message, true);
    } catch (e) {
      setNote(`保存できませんでした（${e instanceof Error ? e.message : String(e)}）`);
    } finally {
      setBusy(false);
    }
  }

  /** 直前の書き込みを取り消す（何回でも続けて） */
  async function undo() {
    const entry = undoStack.current[undoStack.current.length - 1];
    if (!entry || busy) return;
    setBusy(true);
    input.clear();
    try {
      if (entry.change) await applyStudyChange(entry.change);
      if (entry.table) await restoreTable(side, entry.table.sfen, entry.table.snapshot);
      undoStack.current.pop();
      setUndoCount(undoStack.current.length);
      setView(entry.view);
      setNote('');
      showToast('取り消しました', false);
    } catch (e) {
      setNote(`取り消せませんでした（${e instanceof Error ? e.message : String(e)}）`);
    } finally {
      setBusy(false);
    }
  }

  async function onPlay(move: string) {
    if (busy) return;
    setNote('');
    if (picking) {
      setPicking(false);
      setDialog({ kind: 'ask', picked: move });
      return;
    }
    const r = playInBook(pool, studiesNow(), here, move, current?.id ?? null, ctx());
    const played = moveText(sfen, move, prevMove);
    if (r.kind === 'advance') {
      setView({ id: r.target.id, line: [...r.target.moves], index: index + 1 });
      return;
    }
    // 段階21-1：悪手の印のある手は、研究手順に足さない
    if (isMarkedBad(side, sfen, move)) {
      setNote(badNotAdded(played));
      return;
    }
    if (!write) {
      setNote(`読むだけにしています（${played} は足していません）。⋯ の「書き込む」を入にすると足せます。`);
      return;
    }
    if (r.kind === 'same') {
      setNote(`この手順は、研究手順「${r.other.name}」としてすでにあります（${r.other.mySide === 'black' ? '先手番' : '後手番'}）。`);
      return;
    }
    if (r.kind === 'outside') {
      setNote(`${played} を足すと、この定跡帳（${label}）のグループから外れるので足しません。`);
      return;
    }
    if (r.kind === 'too-short') return;
    const made = r.study;
    await commit(r.change, () => ({ id: made.id, line: [...made.moves], index: index + 1 }), `${played} を足しました`);
  }

  // ---- 段階20-2：エンジンに聞く ----

  /** 研究にある手へ進む（この定跡帳の手、または手順前後のほかの研究手順の手） */
  function askAdvance(move: string) {
    setDialog(null);
    const branch = connections.branches.find((b) => b.move === move);
    if (branch) return pickBranch(branch);
    const t = transposed.find((x) => x.move === move);
    if (t) openTransposed(t);
  }

  /** エンジンの候補を足す（相手の手と自分の対応の 2 手は、まとめて 1 回で取り消せる） */
  async function askAdd(moves: string[]) {
    if (busy || !write) return;
    setDialog(null);
    input.clear();
    const along = studyPositions([...here, ...moves]);
    const bad = moves.findIndex((m, i) => isMarkedBad(side, along[index + i] ?? '', m));
    if (bad >= 0) {
      setNote(badNotAdded(moveText(along[index + bad], moves[bad])));
      return;
    }
    const r = playLineInBook(pool, studiesNow(), here, moves, current?.id ?? null, ctx());
    const played = moveText(sfen, moves[0], prevMove);
    if (r.kind === 'same') {
      setNote(`この手順は、研究手順「${r.other.name}」としてすでにあります（${r.other.mySide === 'black' ? '先手番' : '後手番'}）。`);
      return;
    }
    if (r.kind === 'outside') {
      setNote(`${played} を足すと、この定跡帳（${label}）のグループから外れるので足しません。`);
      return;
    }
    if (r.kind !== 'ok') return;
    const made = r.study;
    const view = { id: made.id, line: [...made.moves], index: index + 1 };
    if (!r.change) {
      setView(view);
      return;
    }
    const added = moveTexts([...here, ...moves.slice(0, r.played)]).slice(index).join(' ');
    await commit(r.change, () => view, `${added} を足しました`);
  }

  // ---- 段階21-1：候補の表 ----

  /** （cut があれば研究手順を消してから）表を保存して、取り消しの記録に積む */
  async function commitTable(next: Candidate[], message: string, cut?: BookChange) {
    const before = studiesNow();
    const was = nowView();
    setBusy(true);
    try {
      const snapshot = await tableSnapshot(side, sfen);
      const entry: UndoEntry = { view: was };
      const record = () => {
        if (!undoStack.current.includes(entry)) undoStack.current.push(entry);
        setUndoCount(undoStack.current.length);
      };
      if (cut) {
        const list = await applyStudyChange(cut);
        entry.change = inverseChange(cut, before);
        record();
        setView(settleView(bookPool(bookKey, list, templates), line, index, current?.id ?? null));
      }
      await saveTable(side, sfen, next);
      entry.table = { sfen, snapshot };
      record();
      setNote('');
      showToast(message, true);
    } catch (e) {
      setNote(`保存できませんでした（${e instanceof Error ? e.message : String(e)}）`);
    } finally {
      setBusy(false);
    }
  }

  /** 表を保存する（null は、いっぱいで足せなかった） */
  function applyTable(next: Candidate[] | null, message: string) {
    setDialog(null);
    if (next) void commitTable(next, message);
    else setNote(TABLE_FULL);
  }

  function markMove(move: string, mark: CandidateMark | null) {
    const next = setMark(table, move, mark);
    // 研究手順が通っている手は、消してから悪手にする（稽古で悪手が正解にならないように）
    if (next && mark === 'bad' && studiesPlaying(allStudies, side, sfenKey(sfen), move).length > 0) {
      setDialog({ kind: 'bad', move });
      return;
    }
    const text = moveText(sfen, move, prevMove);
    applyTable(next, mark ? `${text} を${MARK_TEXT[mark]}にしました` : `${text} を候補の表から外しました`);
  }

  function chooseMainHere(move: string) {
    if (!conflict) return;
    const next = chooseMain(table, conflict.moves.map((m) => m.move), move);
    applyTable(next, `${moveText(sfen, move, prevMove)} を本命にしました`);
  }

  function confirmBad(move: string) {
    const next = setMark(table, move, 'bad');
    const cut = cutMoveAt(studiesNow(), side, sfenKey(sfen), move, current?.id ?? null, ctx());
    setDialog(null);
    if (next) void commitTable(next, `${moveText(sfen, move, prevMove)} を悪手にしました`, cut ?? undefined);
    else setNote(TABLE_FULL);
  }

  function startPicking() {
    input.clear();
    setNote('');
    setDialog(null);
    setPicking(true);
  }

  // ---- 消す ----

  /** 消した後の盤：残した研究手順か今の研究手順が今の局面を通っていればそのまま、無ければ近くの研究手順へ */
  const afterCut = (plan: CutPlan) => (list: Study[]) => settleView(list, line, index, plan.kept?.id ?? current?.id ?? null);

  const cutPlan = dialog?.kind === 'row' && dialog.branch ? cutBranch(pool, here, dialog.move, current?.id ?? null, ctx()) : null;
  // ここで終わりにする：出発点（と初期局面）では使えない
  const endPlan = useMemo(
    () => (index > start && index > 0 ? endHere(pool, here, current?.id ?? null, { templates, start, side, now: 0 }) : null),
    [pool, index, line, current?.id, start],
  );

  async function doCut(move: string) {
    const plan = cutBranch(pool, here, move, current?.id ?? null, ctx());
    setDialog(null);
    if (plan) await commit(plan, afterCut(plan), `${moveText(sfen, move, prevMove)} から先を消しました（${plan.remove.length + (plan.kept ? 1 : 0)} 本）`);
  }

  async function doEnd() {
    const plan = endHere(pool, here, current?.id ?? null, ctx());
    setDialog(null);
    if (plan) await commit(plan, afterCut(plan), 'ここで終わりにしました');
  }

  async function doDelete() {
    if (!current) return;
    const target = current;
    setDialog(null);
    await commit({ put: [], remove: [target] }, (list) => settleView(list, line, index, null), `研究手順「${target.name}」を消しました`);
  }

  async function saveFields(f: { name: string; note: string }) {
    if (!current) return;
    setDialog(null);
    const next: Study = { ...current, name: f.name.trim(), note: f.note.trimEnd(), updatedAt: Date.now() };
    await commit({ put: [next], remove: [] }, () => ({ id: next.id, line: [...next.moves], index }), '名前・メモを直しました');
  }

  // ---- ⋯ の中のほかの操作 ----

  function setWrite(on: boolean) {
    setWriteState(on);
    saveWrite(on);
  }

  async function copyKif() {
    if (!current) return;
    setDialog(null);
    const ok = await copyText(studiesToKif([current]));
    setNote(ok ? 'KIF をコピーしました。ほかのアプリの「クリップボードから読み込み」で貼り付けられます。' : 'コピーできませんでした');
  }

  /** 定跡帳の研究手順を、変化付きの 1 つの KIF にして渡す（並びは画面と同じ。共有の前に待たない） */
  async function shareBook() {
    const candidatesOf = (s: string) =>
      sideToMove(s) === side ? candidatesKifLine(tableOf(positionsNow().get(positionId(side, s)), studyMovesAt(bookIndex, s)), s) : '';
    const kif = studiesToKif(bookOrder(pool), `定跡帳：${label}`, (s) => noteAt(side, s), candidatesOf);
    const outcome = await shareFile(fileNameOf(`定跡帳-${label}`, 'kifu'), kif, 'text/plain');
    if (outcome !== 'cancelled') {
      setDialog(null);
      setNote(OUTCOME_TEXT[outcome]);
    }
  }

  const connections = bookAt(pool, here);
  /** 手順前後で同じ局面に来る、ほかの研究手順の自分の手（この定跡帳の一覧に無い手） */
  const transposed = studyMoves
    .filter((m) => !connections.branches.some((b) => b.move === m.move))
    .map((m) => {
      const study = [...m.studies].sort(byLatest)[0];
      const at = bookIndex.get(sfenKey(sfen))?.through.find((t) => t.study.id === study.id)?.ply ?? study.moves.length;
      return { move: m.move, study, ply: at };
    });

  /** 手順前後の研究手順へ（この定跡帳にあれば切り替え、無ければその研究手順の定跡帳で） */
  function openTransposed(t: { study: Study; ply: number }) {
    if (pool.some((s) => s.id === t.study.id)) switchTo(t.study, t.ply);
    else go(studyBookUrl(t.study, t.ply));
  }

  async function doSaveMemo(text: string) {
    setBusy(true);
    try {
      await saveNote(side, sfen, text);
      setDialog(null);
      setNote(text.trim() ? '局面メモを保存しました' : '局面メモを消しました');
    } catch (e) {
      setNote(`保存できませんでした：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  /** この局面の窓（自分の手番は候補の表、相手の手番は局面メモ） */
  const openPositionWindow = () => setDialog({ kind: mine ? 'cand' : 'memo' });
  const openRow = (move: string) => setDialog({ kind: 'row', move, branch: connections.branches.some((b) => b.move === move) });
  const place = index === 0 ? '初期局面' : `${index}手目 ${texts[index - 1] ?? ''} の局面`;
  const outside = index > covered || pool.length === 0;

  return (
    <div class="board-screen">
      <div class="screen-header">
        <button type="button" class="btn btn-ghost btn-back" onClick={() => (openLine ? back('/games') : go('/'))}>
          ‹<span class="back-text"> 一覧</span>
        </button>
        <h1 class="tree-title book-title" data-testid="book-title">
          <span class="book-kicker" data-testid="book-kicker">
            {write ? '定跡帳' : '定跡帳・読むだけ'}
          </span>
          <span class="book-label">{label}</span>
        </h1>
        <button type="button" class="btn tree-menu-btn" aria-label="定跡帳の操作" data-testid="book-menu" onClick={() => setDialog({ kind: 'menu' })}>
          ⋯
        </button>
      </div>

      {/* 今たどっている研究手順の名前とメモの最初の 1 行（押すと名前・メモを直す）。右端に［復習］（段階11-3） */}
      <div class="study-head">
        {current ? (
          <>
            <button type="button" class="study-title study-title-line book-head-btn" data-testid="book-head" onClick={() => setDialog({ kind: 'fields' })}>
              <span class="study-star" aria-hidden="true">
                ★
              </span>
              <strong data-testid="study-title">{current.name}</strong>
              <span class="muted study-meta-inline" data-testid="study-meta">
                {firstLine(current.note) || 'メモなし'}
              </span>
            </button>
            <button type="button" class="btn btn-primary study-head-review" data-testid="book-head-review" onClick={() => go(`/practice/play/${current.id}`)}>
              稽古
            </button>
          </>
        ) : (
          <p class="study-title study-title-line muted" data-testid="book-head-empty">
            {gameNote && view.index === openLine?.length
              ? gameNote
              : pool.length === 0
                ? '研究手順はまだありません。盤で指すと研究手順ができます'
                : 'ここは研究の木の外です。指すと研究手順ができます'}
          </p>
        )}
      </div>

      <div class="tree-layout study-layout">
        <div class="board-col">
          <div ref={boardRef} {...boardFitProps(boardFit, 'tree-board')} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} data-testid="study-board">
            <Board sfen={sfen} lastMove={prevMove} selection={input.selection} onSquare={input.onSquare} onHand={input.onHand} />
          </div>
          {/* 盤のすぐ下の操作バー（段階14。前は画面の下に固定）：|‹（出発点へ） ‹ [n手目 ▲X ▾] › ›|（今の研究手順の終わりへ） */}
          <MoveBar
            fixed={false}
            ids={{ bar: 'study-nav', first: 'study-first', prev: 'study-prev', center: 'study-position', next: 'study-next', last: 'study-last' }}
            firstLabel={`出発点（${startName}）へ`}
            onFirst={() => moveTo(minIndex)}
            onPrev={() => moveTo(index - 1)}
            onNext={() => moveTo(index + 1)}
            onLast={() => moveTo(last)}
            canPrev={index > minIndex}
            canNext={index < last}
            onCenter={wide ? undefined : () => setKifuOpen(true)}
          >
            {index === 0 ? '初期局面' : `${index}手目 ${texts[index - 1] ?? ''}`}
          </MoveBar>
        </div>

        {/* 一覧の枠（段階14）：入りきらない分は、この中だけスクロール */}
        <div class="tree-side board-frame" ref={frameRef}>
          <PromotionBox input={input} />
          {/* 手順の一覧：広い画面は盤の横に常に。スマホ縦は固定バーの手数を押すと画面下から（段階11-5・11-2） */}
          {wide && <KifuPanel rows={kifuRows} current={index} onJump={moveTo} />}

          <BookBranches
            listRef={branchesRef}
            connections={connections}
            current={current}
            outside={outside}
            sfen={sfen}
            prev={prevMove}
            onBranch={pickBranch}
            onEnding={(s) => switchTo(s, index)}
            onMenu={openRow}
            conflict={conflict}
            transposed={transposed}
            onTransposed={openTransposed}
            table={table}
            memo={memo}
            onSummary={openPositionWindow}
            onAsk={() => setDialog({ kind: 'ask' })}
            picking={picking}
            onPickCancel={() => setPicking(false)}
          />
        </div>
      </div>

      {/* 操作の結果の一言（段階14：一覧の下から、画面の下の知らせへ。取り消しの知らせが出ている間はそちらを出す） */}
      {note && !toast && (
        <div class="toast" role="status" data-testid="study-screen-status">
          <span class="toast-text toast-wrap">{note}</span>
        </div>
      )}

      {/* 初めての 1 回だけの説明（段階14：一覧の下から、画面の下の知らせへ） */}
      {hint && !toast && !note && (
        <div class="toast" role="status" data-testid="hint-book-write">
          <span class="toast-text toast-wrap">盤で指すと、その場で研究手順に足されます（名前は自動。あとで直せます）。</span>
        </div>
      )}

      {kifuOpen && <KifuSheet rows={kifuRows} current={index} onJump={moveTo} onClose={() => setKifuOpen(false)} />}

      {toast && (
        <div class="toast" role="status" data-testid="book-toast">
          <span class="toast-text">{toast.text}</span>
          {toast.undo && undoCount > 0 && (
            <button
              type="button"
              class="btn toast-btn"
              data-testid="book-toast-undo"
              disabled={busy}
              onClick={() => {
                setToast(null);
                void undo();
              }}
            >
              取り消す
            </button>
          )}
        </div>
      )}

      {dialog?.kind === 'menu' && (
        <Dialog title={`定跡帳：${label}`} onClose={() => setDialog(null)} testId="book-menu-dialog" sheet>
          {current && (
            <>
              <p class="menu-section-title">この研究手順（★ {current.name}）</p>
              <div class="dialog-actions dialog-actions-column">
                <button type="button" class="btn" data-testid="book-edit-fields" onClick={() => setDialog({ kind: 'fields' })}>
                  名前・メモ
                </button>
                <button type="button" class="btn" data-testid="book-study-review" onClick={() => go(`/practice/play/${current.id}`)}>
                  稽古
                </button>
                <button type="button" class="btn" data-testid="study-copy-kif" onClick={() => void copyKif()}>
                  KIFをコピー
                </button>
                <button type="button" class="btn" data-testid="book-end-here" disabled={!endPlan} onClick={() => setDialog({ kind: 'end' })}>
                  ここで終わり…
                </button>
                <button type="button" class="btn btn-danger" data-testid="book-delete-study" onClick={() => setDialog({ kind: 'delete' })}>
                  消す…
                </button>
              </div>
            </>
          )}
          <p class="menu-section-title">この局面</p>
          <div class="dialog-actions dialog-actions-column">
            <button type="button" class="btn" data-testid="book-open-cand" onClick={openPositionWindow}>
              {mine ? '候補・局面メモ' : '局面メモ'}
            </button>
          </div>
          <p class="menu-section-title">定跡帳</p>
          <div class="dialog-actions dialog-actions-column">
            {/* 段階14：盤の下から ⋯ へ移した */}
            <button
              type="button"
              class="btn"
              data-testid="book-review"
              disabled={pool.length === 0}
              onClick={() => go(groupPracticePath(bookKey))}
            >
              まとめて稽古（{pool.length} 本）
            </button>
            <button
              type="button"
              class="btn"
              data-testid="book-undo"
              disabled={undoCount === 0 || busy}
              onClick={() => {
                setDialog(null);
                void undo();
              }}
            >
              ↶ 取り消す
            </button>
            {pool.length > 0 && (
              <button type="button" class="btn" data-testid="book-share-kif" onClick={() => void shareBook()}>
                KIFで渡す（{pool.length}本）
              </button>
            )}
          </div>
          <div class="side-choice" role="radiogroup" aria-label="盤で指して書き込む">
            <span>盤で指して書き込む</span>
            {[true, false].map((on) => (
              <button
                type="button"
                key={String(on)}
                role="radio"
                aria-checked={write === on}
                data-testid={`book-write-${on ? 'on' : 'off'}`}
                class={write === on ? 'btn btn-toggle on' : 'btn btn-toggle'}
                onClick={() => setWrite(on)}
              >
                {on ? '入' : '切（読むだけ）'}
              </button>
            ))}
          </div>
        </Dialog>
      )}

      {dialog?.kind === 'fields' && current && (
        <StudyEditDialog
          study={current}
          defaultName={current.name}
          movesText={studyMovesText(current, templates)}
          side={current.mySide}
          hideSide
          onSave={(f) => void saveFields(f)}
          onClose={() => setDialog(null)}
        />
      )}

      {dialog?.kind === 'row' && (mine || cutPlan) && (
        <Dialog
          title={mine ? moveText(sfen, dialog.move, prevMove) : `${moveText(sfen, dialog.move, prevMove)} から先`}
          onClose={() => setDialog(null)}
          testId="book-cut-dialog"
          sheet={mine}
        >
          {conflict && !conflict.ok && conflict.moves.some((m) => m.move === dialog.move) && <ConflictBox conflict={conflict} busy={busy} onChoose={chooseMainHere} />}
          {mine && (
            <MarkChooser
              key={dialog.move}
              entry={table.find((c) => c.move === dialog.move)}
              busy={busy}
              onMark={(mark) => markMove(dialog.move, mark)}
              onReason={(text) => applyTable(setReason(table, dialog.move, text), '理由を保存しました')}
            />
          )}
          {cutPlan && (
            <>
              {mine && <p class="menu-section-title">研究手順</p>}
              <CutText plan={cutPlan} />
              <div class="dialog-actions">
                <button type="button" class="btn btn-danger" data-testid="book-cut-ok" disabled={busy} onClick={() => void doCut(dialog.move)}>
                  この手から先を消す
                </button>
                <button type="button" class="btn" onClick={() => setDialog(null)}>
                  やめる
                </button>
              </div>
            </>
          )}
        </Dialog>
      )}

      {dialog?.kind === 'bad' && (
        <Dialog title={`${moveText(sfen, dialog.move, prevMove)} を悪手にしますか？`} onClose={() => setDialog(null)} testId="book-bad-dialog">
          <BadText plan={cutMoveAt(allStudies, side, sfenKey(sfen), dialog.move, current?.id ?? null, ctx())} />
          <p class="muted">取り消せます。</p>
          <div class="dialog-actions">
            <button type="button" class="btn btn-danger" data-testid="book-bad-ok" disabled={busy} onClick={() => confirmBad(dialog.move)}>
              消して悪手にする
            </button>
            <button type="button" class="btn" onClick={() => setDialog(null)}>
              やめる
            </button>
          </div>
        </Dialog>
      )}

      {dialog?.kind === 'end' && endPlan && (
        <Dialog title="ここで終わりにしますか？" onClose={() => setDialog(null)} testId="book-end-dialog">
          <p>この局面より先の手を、すべて消します。</p>
          <CutText plan={endPlan} />
          <div class="dialog-actions">
            <button type="button" class="btn btn-danger" data-testid="book-end-ok" disabled={busy} onClick={() => void doEnd()}>
              終わりにする
            </button>
            <button type="button" class="btn" onClick={() => setDialog(null)}>
              やめる
            </button>
          </div>
        </Dialog>
      )}

      {dialog?.kind === 'delete' && current && (
        <Dialog title="この研究手順を消しますか？" onClose={() => setDialog(null)} testId="book-delete-dialog">
          <p>研究手順「{current.name}」を消します（メモも消えます）。取り消せます。</p>
          <div class="dialog-actions">
            <button type="button" class="btn btn-danger" data-testid="book-delete-ok" disabled={busy} onClick={() => void doDelete()}>
              消す
            </button>
            <button type="button" class="btn" onClick={() => setDialog(null)}>
              やめる
            </button>
          </div>
        </Dialog>
      )}

      {dialog?.kind === 'memo' && (
        <MemoDialog title={place} side={side} initial={memo} busy={busy} onSave={(t) => void doSaveMemo(t)} onClose={() => setDialog(null)} />
      )}

      {dialog?.kind === 'cand' && (
        <CandidateWindow
          title={place}
          side={side}
          sfen={sfen}
          prev={prevMove}
          table={table}
          memo={memo}
          busy={busy}
          onMenu={openRow}
          onAsk={() => setDialog({ kind: 'ask' })}
          onPick={startPicking}
          onSaveMemo={(t) => void doSaveMemo(t)}
          onClose={() => setDialog(null)}
        />
      )}

      {dialog?.kind === 'ask' && (
        <AskEngine
          sfen={sfen}
          mySide={side}
          prev={prevMove}
          place={place}
          table={table}
          picked={dialog.picked}
          goodMax={settings.value.thresholds.goodMax}
          onSave={(next, dropped) =>
            applyTable(next, `候補の表に残しました（${next.length}手${dropped > 0 ? `。8 手までなので ${dropped}手は入っていません` : ''}）`)
          }
          onPick={startPicking}
          bookMoves={[...connections.branches.map((b) => b.move), ...transposed.map((t) => t.move)]}
          write={write}
          onAdvance={askAdvance}
          onAdd={(moves) => void askAdd(moves)}
          onClose={() => setDialog(null)}
        />
      )}

    </div>
  );
}

/** 悪手の印のある手を指した・足そうとしたとき */
const badNotAdded = (move: string) => `${move} は悪手にしているので、研究手順に足しません（印は一覧の ⋯ で変えられます）。`;

/** 悪手にする確認の本文：何本がこの手を通り、どれが消えて、どれが残るか */
function BadText({ plan }: { plan: ReturnType<typeof cutMoveAt> }) {
  if (!plan) return null;
  const names = (list: readonly Study[]) => list.map((s) => `「${s.name}」`).join('');
  return (
    <div data-testid="book-bad-text">
      <p>この手を通る研究手順 {plan.count} 本を、この手から先で消して、悪手にします（稽古で悪手が正解にならないように）。</p>
      {plan.remove.length > 0 && <p>消える研究手順（メモも）：{names(plan.remove)}</p>}
      {plan.put.length > 0 && <p>この局面で終わる形で残す研究手順：{names(plan.put)}</p>}
    </div>
  );
}

/** 食い違いの説明と、本命を選ぶ（行の ⋯ の窓の上） */
function ConflictBox({ conflict, busy, onChoose }: { conflict: Conflict; busy: boolean; onChoose: (move: string) => void }) {
  return (
    <div class="conflict-box" data-testid="book-conflict-box">
      <p>
        <strong class="conflict-word">食い違い</strong>：この局面で、研究手順によって自分の手が違います（
        {conflict.moves.map((m) => `${moveText(conflict.sfen, m.move)}（${m.studies.length}本）`).join('／')}）。
      </p>
      <p class="muted">どちらを本命にしますか。ほかの手は次善になります。</p>
      <MainChoice conflict={conflict} busy={busy} onChoose={onChoose} />
    </div>
  );
}

/** 消すときの説明（何本消すか・どれを残すか） */
function CutText({ plan }: { plan: CutPlan }) {
  const removed = plan.remove.length + (plan.kept ? 1 : 0);
  return (
    <>
      <p data-testid="book-cut-text">
        研究手順 {removed} 本を消します
        {plan.kept ? `。「${plan.kept.name}」は、この局面で終わる研究手順として残します（メモもそのまま）` : ''}。
      </p>
      <p class="muted">取り消せます。</p>
    </>
  );
}

/** 盤の下から一覧の 3 行目までの高さの見込み（まだ測っていないとき。間＋見出し＋3 行） */
/** 「この局面からの研究」の 1 行の高さ（行が無いときの見込み。px） */
const ROW_GUESS = 44;

/**
 * 「この局面からの研究」：次の手ごとに、その手を通る研究手順の名前と数。今たどっている研究手順の手に印。行の ⋯ で「この手から先を消す」。
 * その局面で終わる研究手順は「ここで終わる研究」として下に。押すと、その手の局面へ進む（違う研究手順なら切り替える）
 */
function BookBranches({
  connections,
  current,
  outside,
  sfen,
  prev,
  onBranch,
  onEnding,
  onMenu,
  listRef,
  conflict,
  transposed,
  onTransposed,
  table,
  memo,
  onSummary,
  onAsk,
  picking,
  onPickCancel,
}: {
  connections: BookPosition<Study>;
  current: Study | null;
  /** 研究の木の外にいる */
  outside: boolean;
  sfen: string;
  prev: string | undefined;
  onBranch: (branch: BookBranch<Study>) => void;
  onEnding: (s: Study) => void;
  onMenu: (move: string) => void;
  listRef: { current: HTMLDivElement | null };
  conflict: Conflict | null;
  transposed: { move: string; study: Study; ply: number }[];
  onTransposed: (t: { move: string; study: Study; ply: number }) => void;
  /** 候補の表（相手の手番は空） */
  table: readonly Candidate[];
  memo: string;
  /** この局面の窓を開く */
  onSummary: () => void;
  onAsk: () => void;
  picking: boolean;
  onPickCancel: () => void;
}) {
  const { branches, ending, count } = connections;
  /** 食い違いの印を付ける手（研究の手の全部に表の印があれば付けない） */
  const diffMoves = new Set(conflict && !conflict.ok ? conflict.moves.map((m) => m.move) : []);
  /** 手の印：候補の表にあれば本命・次善・悪手、無くて食い違いなら「食い違い」 */
  const tagOf = (move: string) => {
    const entry = table.find((c) => c.move === move);
    if (entry) return <MarkTag mark={entry.mark} text={markText(table, entry)} testId="book-mark-tag" />;
    return diffMoves.has(move) ? (
      <span class="diff-tag" data-testid="book-conflict-tag">
        食い違い
      </span>
    ) : null;
  };
  /** 表にあるが研究手順の無い手（薄い行で出す） */
  const tableOnly = table.filter((c) => !branches.some((b) => b.move === c.move) && !transposed.some((t) => t.move === c.move));
  /** 名前の並び：今たどっている研究手順を先に */
  const names = (list: readonly Study[]) =>
    [...list.filter((s) => s.id === current?.id), ...list.filter((s) => s.id !== current?.id)].map((s) => s.name).join('・');
  return (
    <div class="card candidates book-list" ref={listRef} data-testid="study-book-list">
      <div class="candidates-head book-list-head">
        {picking ? (
          <>
            <strong data-testid="pick-text">調べる手を盤で指す</strong>
            <button type="button" class="btn book-ask" data-testid="pick-cancel" onClick={onPickCancel}>
              やめる
            </button>
          </>
        ) : (
          <>
            <strong data-testid="study-book-head">研究 {count}本</strong>
            {/* 段階21-1：候補の表の要約（押すと候補の窓）。表が無くメモがあれば、メモの 1 行目 */}
            {table.length > 0 ? (
              <button type="button" class="book-memo" data-testid="book-table" onClick={onSummary}>
                <span class="book-memo-text">
                  {memo && '✎ '}
                  {/* 幅の狭いスマホでは「候補 n・」を隠して、本命の手が切れないように */}
                  <span class="book-table-count">{summaryText(table, sfen, prev).split('・')[0]}・</span>
                  {summaryText(table, sfen, prev).split('・')[1]}
                </span>
              </button>
            ) : (
              memo && (
                <button type="button" class="book-memo" data-testid="book-memo" aria-label={`局面メモ：${firstLine(memo)}`} onClick={onSummary}>
                  <span aria-hidden="true">✎ </span>
                  <span class="book-memo-text">{firstLine(memo)}</span>
                </button>
              )
            )}
            {/* 段階20-2：今の局面だけをエンジンで数秒調べる */}
            <button type="button" class="btn book-ask" data-testid="book-ask" onClick={onAsk}>
              エンジンに聞く
            </button>
          </>
        )}
      </div>
      <ul class="candidate-list">
        {branches.map((b) => {
          const isCurrent = b.studies.some((s) => s.id === current?.id);
          return (
            <li key={b.move} class="candidate-item">
              <button
                type="button"
                class={isCurrent ? 'candidate book-row book-current' : 'candidate book-row'}
                data-testid="study-book-branch"
                data-current={isCurrent ? 'true' : 'false'}
                onClick={() => onBranch(b)}
              >
                <span class="candidate-line">
                  <span class="candidate-move">
                    {isCurrent ? '▶ ' : ''}
                    {moveText(sfen, b.move, prev)}
                    {tagOf(b.move)}
                  </span>
                  <span class="book-names">{names(b.studies)}</span>
                  {/* その手を通る研究手順の割合の棒（段階12-3。本数はこの局面を通る研究手順の数に対して） */}
                  <span class="book-bar" aria-hidden="true" data-testid="study-book-bar">
                    <span class="book-bar-fill" style={{ width: `${Math.round((b.studies.length / Math.max(count, 1)) * 100)}%` }} />
                  </span>
                  {b.studies.length >= 2 && <span class="book-count num">（{b.studies.length}）</span>}
                </span>
              </button>
              <button type="button" class="candidate-menu" aria-label={`${moveText(sfen, b.move, prev)} の操作`} data-testid="book-branch-menu" onClick={() => onMenu(b.move)}>
                ⋯
              </button>
            </li>
          );
        })}
        {transposed.map((t) => (
          <li key={`tr-${t.move}`} class="candidate-item">
            <button type="button" class="candidate book-row book-transposed" data-testid="book-transposed" onClick={() => onTransposed(t)}>
              <span class="candidate-line">
                <span class="candidate-move">
                  {moveText(sfen, t.move, prev)}
                  {tagOf(t.move)}
                </span>
                <span class="book-names">手順前後：{t.study.name}</span>
              </span>
            </button>
            <button type="button" class="candidate-menu" aria-label={`${moveText(sfen, t.move, prev)} の操作`} data-testid="book-transposed-menu" onClick={() => onMenu(t.move)}>
              ⋯
            </button>
          </li>
        ))}
        {tableOnly.map((c) => (
          <li key={`cand-${c.move}`} class="candidate-item">
            <button type="button" class="candidate book-row book-table-only" data-testid="book-cand-row" data-move={c.move} onClick={onSummary}>
              <span class="candidate-line">
                <span class="candidate-move">
                  {moveText(sfen, c.move, prev)}
                  {tagOf(c.move)}
                </span>
                <span class="book-names">研究手順なし</span>
              </span>
            </button>
            <button type="button" class="candidate-menu" aria-label={`${moveText(sfen, c.move, prev)} の操作`} data-testid="book-cand-menu" onClick={() => onMenu(c.move)}>
              ⋯
            </button>
          </li>
        ))}
        {ending.map((s) => {
          const isCurrent = s.id === current?.id;
          return (
            <li key={`end-${s.id}`}>
              <button
                type="button"
                class={isCurrent ? 'candidate book-row book-current' : 'candidate book-row'}
                data-testid="study-book-ending"
                data-current={isCurrent ? 'true' : 'false'}
                onClick={() => onEnding(s)}
              >
                <span class="candidate-line">
                  <span class="candidate-move book-end-label">{isCurrent ? '▶ ' : ''}ここで終わる研究</span>
                  <span class="book-names">{s.name}</span>
                </span>
              </button>
            </li>
          );
        })}
        {count === 0 && transposed.length === 0 && tableOnly.length === 0 && (
          <li>
            <p class="muted book-row book-empty" data-testid="study-book-empty">
              {outside ? '盤で指すと、ここから研究手順ができます。' : 'この局面からの研究はありません。'}
            </p>
          </li>
        )}
      </ul>
    </div>
  );
}
