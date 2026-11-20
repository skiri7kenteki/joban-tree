// 定跡帳（段階9-2 の「定跡帳として見る」を、段階10-1 で研究を入力する場所の中心にした。持ち主の判断 2026-11-19「おすすめの通りで」）。
//   #/book/<key>[/<研究手順の id>/<手数>]、#/book/<key>/t/<戦型の id>（新しい研究を始めるとき。研究手順がまだ無くても開ける）
// - 盤で指すと、その場で研究手順に足す（名前は自動、保存も自動）。決まりは src/tree/bookEdit.ts
//   （同じ手 → 進むだけ／ここで終わる研究手順 → 延ばす／それ以外 → 新しい研究手順）
// - 誤操作の対策：足すたびに画面の下に「▲3六歩 を足しました［取り消す］」を 5 秒。「↶ 取り消す」で何回でも続けて戻せる
//   （足す・消す・ここで終わりにする・研究手順を消す・名前とメモを直す。この画面を開いている間だけ）。⋯ の「書き込む」を切にすると読むだけ
// - 「この局面からの研究」の行の ⋯ で「この手から先を消す」。⋯ に、今の研究手順の操作（復習・書き出し・ここで終わりにする・消す）、
//   この局面の操作（ツリーを作る・ツリーで見る）、定跡帳の操作（KIF で書き出す・書き込む 入／切）
// - ★ の行を押すと、今の研究手順の名前・メモを直す
// - 段階11-2：‹ › の行と手順の行（パンくず）をやめ、盤の下の固定バー（MoveBar）に。手数を押すと手順の一覧
// 研究手順の画面（StudyScreen）と編集モードは段階10-2 で片付けた（古い URL は src/app/LegacyRedirect.tsx でここへ移す）。

import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Board } from '../components/Board';
import { Dialog } from '../components/Dialog';
import { PromotionBox, useMoveInput } from '../components/useMoveInput';
import { STARTPOS_SFEN, moveText, type Side } from '../shogi/position';
import { studyPositions } from '../review/studyReview';
import { loadTreesOnLine } from '../storage/trees';
import { fileNameOf } from '../tree/backup';
import {

  coveredDepth,
  cutBranch,
  endHere,
  inverseChange,
  playInBook,
  settleView,
  type BookChange,
  type BookCtx,
  type BookView,
  type CutPlan,
} from '../tree/bookEdit';
import { bookLabel, bookPool, bookSide, fitsBook, isHirateBook } from '../tree/organize';
import { firstLine, moveTexts, newStudyId, pathInTree, startsWith, studyMovesText, studyTemplate } from '../tree/studies';
import { bookAt, bookOrder, bookStart, type BookBranch, type BookPosition } from '../tree/studyBook';
import { studiesToKif } from '../tree/studyFile';
import { listName, type OpeningTemplate } from '../tree/templates';
import type { Study, TreeData } from '../tree/types';
import { boardFitProps, measureFitAbove, useBoardFit } from './boardFit';
import { inputHandoff } from './handoff';
import { bookPath, go, groupReviewPath } from './router';
import { OUTCOME_TEXT, copyText, shareFile } from './share';
import { StudyEditDialog, shareStudies } from './StudyDialogs';
import { applyStudyChange, ensureStudies, library, studiesNow } from './studies';
import { KifuPanel, KifuSheet, useWideLayout, type KifuRow } from '../components/KifuList';
import { MoveBar, moveBarHeight } from '../components/MoveBar';
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

/** 取り消しの知らせを出しておく時間（ミリ秒） */
const TOAST_MS = 5000;

/** 定跡帳の画面。研究手順と戦型を読み終えてから中身を出す */
export function BookScreen({ bookKey, id, ply, template }: { bookKey: string; id?: string; ply?: number; template?: string }) {
  const [error, setError] = useState('');
  const studies = library.value;
  void myTemplates.value;
  // 定跡帳はグループ分けに自分で登録した戦型も使うので、読み終わるまで待つ
  const [templatesReady, setTemplatesReady] = useState(myTemplates.value !== null);
  /** 一度開いたら、研究手順を全部消しても（取り消せるように）定跡帳のまま */
  const opened = useRef(false);
  useEffect(() => {
    ensureStudies().catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    if (!myTemplates.value)
      void refreshMyTemplates()
        .catch(() => undefined)
        .finally(() => setTemplatesReady(true));
  }, []);

  if (error) return <p class="status-ng">{error}</p>;
  if (!studies || !templatesReady) return <p class="muted">読み込み中…</p>;
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
  return <BookViewScreen bookKey={bookKey} side={side} pool={pool} templates={templates} id={id} ply={ply} tpl={tpl} />;
}

/** 定跡帳の出発点：平手からの定跡帳は初期局面。戦型のグループは、研究手順（と今の手順）が全部通る、自分の側が同じ、いちばん浅い戦型の出発点（段階10 の直し） */
function startOf(key: string, pool: readonly Study[], line: readonly string[], templates: readonly OpeningTemplate[]): number {
  if (isHirateBook(key)) return 0;
  return bookStart([...pool, { moves: [...line] }], templates, bookSide(key) ?? 'black');
}

const byLatest = (a: Study, b: Study) => b.updatedAt - a.updatedAt;

/** 開いたときの手順と局面 */
function initialView(key: string, pool: readonly Study[], templates: readonly OpeningTemplate[], id?: string, ply?: number, tpl?: OpeningTemplate): BookView {
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
  | { kind: 'trees' }
  | { kind: 'cut'; move: string }
  | { kind: 'end' }
  | { kind: 'delete' };

/** 取り消し 1 回分：元に戻す変更と、その操作の前の盤 */
interface UndoEntry {
  change: BookChange;
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
}: {
  bookKey: string;
  side: Side;
  pool: Study[];
  templates: OpeningTemplate[];
  id?: string;
  ply?: number;
  tpl?: OpeningTemplate;
}) {
  const [view, setView] = useState<BookView>(() => initialView(bookKey, pool, templates, id, ply, tpl));
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
  /** 今の局面までの手順を含むツリー（「ツリーで見る」の候補） */
  const [trees, setTrees] = useState<TreeData[]>([]);
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

  useEffect(() => {
    let alive = true;
    loadTreesOnLine(line)
      .then((list) => alive && setTrees(list))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [line]);

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

  const treesHere = current ? trees.filter((t) => pathInTree(t, here) !== null) : [];

  // スマホ縦：盤と「この局面からの研究」の 3 行目までが、画面の下に固定したバー（段階11-2）の上にスクロールせずに見える盤の幅
  const boardRef = useRef<HTMLDivElement>(null);
  const branchesRef = useRef<HTMLDivElement>(null);
  /** 盤の下から、一覧の 3 行目の下までの高さ（最後に測った値）。一覧の行が少ない局面でも同じだけ空けて、盤の大きさを変えない */
  const listReserve = useRef<number | null>(null);
  const boardFit = useBoardFit(boardRef, (board) => {
    const rows = branchesRef.current?.querySelectorAll<HTMLElement>('.book-row');
    if (rows && rows.length > 0) {
      const n = Math.min(3, rows.length);
      const rowH = rows[0].getBoundingClientRect().height;
      // 成る・成らないの小窓は数えない（盤の大きさが変わらないように）
      const promote = board.parentElement?.querySelector<HTMLElement>('.promote-box')?.getBoundingClientRect().height ?? 0;
      listReserve.current = rows[n - 1].getBoundingClientRect().bottom - board.getBoundingClientRect().bottom + (3 - n) * rowH - promote;
    }
    return measureFitAbove(board, board, moveBarHeight() + (listReserve.current ?? LIST_GUESS));
  });

  const input = useMoveInput(sfen, (move) => void onPlay(move.usi), !busy);

  function moveTo(i: number) {
    input.clear();
    setView({ id: current?.id ?? null, line: [...line], index: Math.max(minIndex, Math.min(last, i)) });
    setNote('');
  }

  /** ほかの研究手順へ（同じ局面のまま、またはその手を指した局面へ） */
  function switchTo(target: Study, at: number) {
    input.clear();
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
      await applyStudyChange(entry.change);
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
    const r = playInBook(pool, studiesNow(), here, move, current?.id ?? null, ctx());
    const played = moveText(sfen, move, prevMove);
    if (r.kind === 'advance') {
      setView({ id: r.target.id, line: [...r.target.moves], index: index + 1 });
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

  // ---- 消す ----

  /** 消した後の盤：残した研究手順か今の研究手順が今の局面を通っていればそのまま、無ければ近くの研究手順へ */
  const afterCut = (plan: CutPlan) => (list: Study[]) => settleView(list, line, index, plan.kept?.id ?? current?.id ?? null);

  const cutPlan = dialog?.kind === 'cut' ? cutBranch(pool, here, dialog.move, current?.id ?? null, ctx()) : null;
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

  function makeTree() {
    const t = studyTemplate({ moves: here, mySide: side }, templates);
    inputHandoff.value = { moves: [...line], index, mySide: side, ...(t ? { templateId: t.id } : {}) };
    go('/new');
  }

  function openTree(t: TreeData) {
    if (current) go(`/tree/${t.id}/study/${current.id}/${index}`);
  }

  async function copyKif() {
    if (!current) return;
    setDialog(null);
    const ok = await copyText(studiesToKif([current]));
    setNote(ok ? 'KIF をコピーしました。ほかのアプリの「クリップボードから読み込み」で貼り付けられます。' : 'コピーできませんでした');
  }

  async function share(kind: 'json' | 'kif') {
    if (!current) return;
    const outcome = await shareStudies([current], kind);
    if (outcome !== 'cancelled') {
      setDialog(null);
      setNote(OUTCOME_TEXT[outcome]);
    }
  }

  /** 定跡帳の研究手順を、変化付きの 1 つの KIF にして渡す（並びは画面と同じ。共有の前に待たない） */
  async function shareBook() {
    const kif = studiesToKif(bookOrder(pool), `定跡帳：${label}`);
    const outcome = await shareFile(fileNameOf(`定跡帳-${label}`, 'kifu'), kif, 'text/plain');
    if (outcome !== 'cancelled') {
      setDialog(null);
      setNote(OUTCOME_TEXT[outcome]);
    }
  }

  const connections = bookAt(pool, here);
  const outside = index > covered || pool.length === 0;

  return (
    <>
      <div class="screen-header">
        <button type="button" class="btn btn-ghost" onClick={() => go('/')}>
          ‹ 一覧
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

      {/* 今たどっている研究手順の名前とメモの最初の 1 行（押すと名前・メモを直す） */}
      <div class="study-head">
        {current ? (
          <button type="button" class="study-title study-title-line book-head-btn" data-testid="book-head" onClick={() => setDialog({ kind: 'fields' })}>
            <span class="study-star" aria-hidden="true">
              ★
            </span>
            <strong data-testid="study-title">{current.name}</strong>
            <span class="muted study-meta-inline" data-testid="study-meta">
              {firstLine(current.note) || 'メモなし'}
            </span>
          </button>
        ) : (
          <p class="study-title study-title-line muted" data-testid="book-head-empty">
            {pool.length === 0 ? '研究手順はまだありません。盤で指すと研究手順ができます' : 'ここは研究の木の外です。指すと研究手順ができます'}
          </p>
        )}
      </div>

      <div class="tree-layout study-layout">
        <div ref={boardRef} {...boardFitProps(boardFit, 'tree-board')} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} data-testid="study-board">
          <Board sfen={sfen} lastMove={prevMove} selection={input.selection} onSquare={input.onSquare} onHand={input.onHand} />
        </div>

        <div class="tree-side">
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
            onMenu={(move) => setDialog({ kind: 'cut', move })}
          />
          <div class="node-actions">
            <button type="button" class="btn" data-testid="book-undo" disabled={undoCount === 0 || busy} onClick={() => void undo()}>
              ↶ 取り消す
            </button>
            <button type="button" class="btn btn-primary" data-testid="book-review" disabled={pool.length === 0} onClick={() => go(groupReviewPath(bookKey))}>
              まとめて復習（{pool.length} 本）
            </button>
          </div>
          {note && (
            <p class="muted" role="status" data-testid="study-screen-status">
              {note}
            </p>
          )}
          {current && (
            <div class="card">
              {current.note ? (
                <p class="study-note" data-testid="study-screen-note">
                  {current.note}
                </p>
              ) : (
                <p class="muted">「{current.name}」にメモはありません（★ の行を押すと書けます）。</p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 盤の下の固定バー（段階11-2）：|‹（出発点へ） ‹ [n手目 ▲X ▾] › ›|（今の研究手順の終わりへ） */}
      <MoveBar
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
        <Dialog title={`定跡帳：${label}`} onClose={() => setDialog(null)} testId="book-menu-dialog">
          {current && (
            <>
              <p class="menu-section-title">★ {current.name}</p>
              <div class="dialog-actions dialog-actions-column">
                <button type="button" class="btn" data-testid="book-edit-fields" onClick={() => setDialog({ kind: 'fields' })}>
                  名前・メモを直す
                </button>
                <button type="button" class="btn" data-testid="book-study-review" onClick={() => go(`/study-review/${current.id}`)}>
                  この研究手順を復習
                </button>
                <button type="button" class="btn" data-testid="study-copy-kif" onClick={() => void copyKif()}>
                  KIF をコピー
                </button>
                <button type="button" class="btn" data-testid="study-share-json" onClick={() => void share('json')}>
                  ファイルで渡す（JSON・このアプリ用）
                </button>
                <button type="button" class="btn" data-testid="study-share-kif" onClick={() => void share('kif')}>
                  ファイルで渡す（KIF・ほかのソフト用）
                </button>
                <button type="button" class="btn" data-testid="book-end-here" disabled={!endPlan} onClick={() => setDialog({ kind: 'end' })}>
                  ここで終わりにする…
                </button>
                <button type="button" class="btn btn-danger" data-testid="book-delete-study" onClick={() => setDialog({ kind: 'delete' })}>
                  この研究手順を消す…
                </button>
              </div>
            </>
          )}
          <p class="menu-section-title">この局面</p>
          <div class="dialog-actions dialog-actions-column">
            <button type="button" class="btn" data-testid="study-make-tree" onClick={makeTree}>
              この局面からツリーを作る
            </button>
            {treesHere.length > 0 && (
              <button
                type="button"
                class="btn"
                data-testid="study-open-tree"
                onClick={() => (treesHere.length === 1 ? openTree(treesHere[0]) : setDialog({ kind: 'trees' }))}
              >
                ツリーで見る{treesHere.length > 1 ? `（${treesHere.length}）` : ''}
              </button>
            )}
          </div>
          <p class="menu-section-title">定跡帳</p>
          <div class="dialog-actions dialog-actions-column">
            {pool.length > 0 && (
              <button type="button" class="btn" data-testid="book-share-kif" onClick={() => void shareBook()}>
                KIF で書き出す（変化付き・{pool.length} 本）
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

      {dialog?.kind === 'cut' && cutPlan && (
        <Dialog title={`${moveText(sfen, dialog.move, prevMove)} から先`} onClose={() => setDialog(null)} testId="book-cut-dialog">
          <CutText plan={cutPlan} />
          <div class="dialog-actions">
            <button type="button" class="btn btn-danger" data-testid="book-cut-ok" disabled={busy} onClick={() => void doCut(dialog.move)}>
              この手から先を消す
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
          <p>研究手順「{current.name}」を消します（メモも消えます）。消した後も、この画面の「↶ 取り消す」で戻せます。</p>
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

      {dialog?.kind === 'trees' && (
        <Dialog title="どのツリーで見ますか？" onClose={() => setDialog(null)} testId="study-trees-dialog">
          <div class="dialog-actions dialog-actions-column">
            {treesHere.map((t) => (
              <button type="button" key={t.id} class="btn" data-testid="study-tree-choice" onClick={() => openTree(t)}>
                {t.name}
              </button>
            ))}
          </div>
        </Dialog>
      )}
    </>
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
      <p class="muted">消した後も、この画面の「↶ 取り消す」で戻せます。</p>
    </>
  );
}

/** 盤の下から一覧の 3 行目までの高さの見込み（まだ測っていないとき。間＋見出し＋3 行） */
const LIST_GUESS = 200;

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
}) {
  const { branches, ending, count } = connections;
  /** 名前の並び：今たどっている研究手順を先に */
  const names = (list: readonly Study[]) =>
    [...list.filter((s) => s.id === current?.id), ...list.filter((s) => s.id !== current?.id)].map((s) => s.name).join('・');
  return (
    <div class="card candidates book-list" ref={listRef} data-testid="study-book-list">
      <div class="candidates-head">
        <strong data-testid="study-book-head">この局面からの研究（{count} 本）</strong>
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
                  </span>
                  <span class="book-names">{names(b.studies)}</span>
                  {b.studies.length >= 2 && <span class="book-count num">（{b.studies.length}）</span>}
                </span>
              </button>
              <button type="button" class="candidate-menu" aria-label={`${moveText(sfen, b.move, prev)} の操作`} data-testid="book-branch-menu" onClick={() => onMenu(b.move)}>
                ⋯
              </button>
            </li>
          );
        })}
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
        {count === 0 && (
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
