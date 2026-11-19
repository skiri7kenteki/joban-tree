// 研究手順を開く画面（段階8-1、軽い見返しの画面）：盤・手順（前後に動かせる）・名前・メモ。エンジンは使わない。
// 開いたときは研究手順の終わりの局面。ここから：この研究手順を復習、この局面からツリーを作る（新しいツリーの画面に手順を読み込んで移る）、
// ツリーで見る（平手からの手順がまったく同じ手順を含むツリーが端末にあるときだけ。今の局面を開く）、
// ⋯ の中に 名前・メモを直す／KIF をコピー／書き出す（JSON・KIF）／消す（確認あり）。
// 段階9-1：「手順を編集」で編集モード（#/study/<id>/edit）。編集中だけ盤で指せる。保存するまでは研究手順を書き換えない。
//   計算は src/tree/studyEdit.ts、編集中の下書きは src/app/studyEdit.ts（戻るボタンで出たときに「変更を捨てますか？」を聞くため画面の外に置く）。

import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Board } from '../components/Board';
import { Dialog } from '../components/Dialog';
import { PromotionBox, useMoveInput } from '../components/useMoveInput';
import { STARTPOS_SFEN, moveText } from '../shogi/position';
import { loadTreesOnLine } from '../storage/trees';
import { fileNameOf } from '../tree/backup';
import { groupLabel, groupStudies } from '../tree/organize';
import { studyPositions } from '../review/studyReview';
import { findSameStudy, firstLine, moveTexts, newStudyId, pathInTree, startsWith, studyMovesText, studyTemplate } from '../tree/studies';
import { bookAt, bookOrder, bookStart, switchTarget, type BookBranch, type BookPosition } from '../tree/studyBook';
import { listName } from '../tree/templates';
import {
  branchMoves,
  branchStudy,
  checkEdited,
  draftChanged,
  editedStudy,
  moveDraftTo,
  movesAfter,
  playOnDraft,
  replaceFrom,
  startDraft,
  truncateHere,
  undoDraft,
  type Draft,
} from '../tree/studyEdit';
import { studiesToKif } from '../tree/studyFile';
import type { Study, TreeData } from '../tree/types';
import { boardFitProps, measureFitAbove, useBoardFit } from './boardFit';
import { inputHandoff } from './handoff';
import { bookPath, go, groupReviewPath } from './router';
import { OUTCOME_TEXT, copyText, shareFile } from './share';
import { StudyEditDialog, shareStudies } from './StudyDialogs';
import { editSession, enterEdit, isNavigating, leaveEdit, navigateEdit, takeEditExit, type EditSession } from './studyEdit';
import { ensureStudies, library, removeStudy, saveStudies, studiesNow, updateStudyFields } from './studies';
import { allTemplates, myTemplates, refreshMyTemplates } from './TemplateDialogs';

/** 定跡帳として見ているとき（段階9-2）：グループの key・見出し・出発点（平手から何手目か）・出発点の名前 */
interface BookContext {
  key: string;
  label: string;
  start: number;
  startName: string;
}

/**
 * 研究手順の画面。book を渡すと「定跡帳として見る」（そのグループの研究手順をつないだツリー。研究手順の画面を使い回す）。
 * id・ply：開く研究手順と局面（平手から何手目か）。定跡帳で id が無い・グループに無ければ、いちばん最近直した研究手順の出発点
 */
export function StudyScreen({ id, edit = false, ply, book }: { id?: string; edit?: boolean; ply?: number; book?: string }) {
  const [error, setError] = useState('');
  const studies = library.value;
  const session = editSession.value;
  void myTemplates.value;
  // 定跡帳はグループ分けに自分で登録した戦型も使うので、読み終わるまで待つ
  const [templatesReady, setTemplatesReady] = useState(myTemplates.value !== null);
  useEffect(() => {
    ensureStudies().catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    if (!myTemplates.value)
      void refreshMyTemplates()
        .catch(() => undefined)
        .finally(() => setTemplatesReady(true));
  }, []);

  const templates = allTemplates();
  const group = useMemo(
    () => (book !== undefined && studies && templatesReady ? (groupStudies(studies, templates, '').find((g) => g.key === book) ?? null) : null),
    // templates は myTemplates が変わったときだけ変わる
    [book, studies, templatesReady, myTemplates.value],
  );
  const bookStudy = group ? (group.items.find((s) => s.id === id) ?? group.items[0]) : undefined;
  const study = book !== undefined ? bookStudy : studies?.find((s) => s.id === id);
  const bookCtx = useMemo<BookContext | null>(() => {
    if (!group || book === undefined) return null;
    const start = bookStart(group.items, templates);
    const t = start > 0 ? templates.find((x) => x.moves.length === start && group.items.every((s) => startsWith(s.moves, x.moves))) : undefined;
    return { key: book, label: group.label, start, startName: t ? listName(t) : '初期局面' };
  }, [group, book]);
  /** 「この局面からの研究」でつなぐ研究手順：定跡帳はそのグループ、研究手順の画面は自分の側が同じもの */
  const pool = useMemo(
    () => (group ? group.items : studies && study ? studies.filter((s) => s.mySide === study.mySide) : []),
    [group, studies, study?.mySide],
  );
  // 編集中の下書きがこの画面のものでない（戻るボタンで編集から出た）：変更が無ければ黙って捨て、あれば下で聞く
  const otherSession = session && !(edit && session.id === id) && !isNavigating() ? session : null;
  const here = study?.id ?? id ?? '';
  const otherDirty = otherSession !== null && draftChanged(otherSession.draft, otherSession.saved);
  useEffect(() => {
    if (otherSession && !otherDirty) editSession.value = null;
  }, [otherSession, otherDirty]);
  // #/study/<id>/edit を直接開いた（再読み込みなど）：終わりの局面から編集を始める
  useEffect(() => {
    if (edit && study && !session && !isNavigating())
      editSession.value = { id: study.id, saved: [...study.moves], draft: startDraft(study.moves, study.moves.length), fromView: false };
  }, [edit, study, session]);

  if (error) return <p class="status-ng">{error}</p>;
  if (!studies || (book !== undefined && !templatesReady)) return <p class="muted">読み込み中…</p>;
  if (book !== undefined && (!study || !bookCtx)) {
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
  if (!study) {
    return (
      <>
        <div class="screen-header">
          <button type="button" class="btn btn-ghost" onClick={() => go('/')}>
            ‹ 一覧
          </button>
          <h1>研究手順</h1>
        </div>
        <p class="muted" data-testid="study-missing">
          この研究手順は見つかりませんでした（消されたかもしれません）。
        </p>
      </>
    );
  }
  const editing = edit && session?.id === study.id ? session : null;
  // 開く局面：定跡帳で別の研究手順に替えた（URL に無い）ときは出発点
  const openAt = book !== undefined && id !== study.id ? undefined : ply;
  return (
    <>
      <StudyView key={study.id} study={study} session={editing} ply={openAt} book={bookCtx} pool={pool} />
      {otherSession && otherDirty && (
        <Dialog title="編集中の変更を捨てますか？" onClose={() => go(`/study/${otherSession.id}/edit`)} testId="study-edit-leave-dialog">
          <p>研究手順「{studies.find((s) => s.id === otherSession.id)?.name ?? ''}」の手順に、まだ保存していない変更があります。</p>
          <div class="dialog-actions">
            <button
              type="button"
              class="btn btn-primary"
              data-testid="study-edit-leave-back"
              onClick={() => enterEdit({ ...otherSession, fromView: otherSession.id === here })}
            >
              編集に戻る
            </button>
            <button type="button" class="btn btn-danger" data-testid="study-edit-leave-discard" onClick={() => (editSession.value = null)}>
              捨てる
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}

/** 編集中に出す窓 */
type EditDialog =
  | { kind: 'fork'; move: string; next: string }
  | { kind: 'branch-same'; move: string; other: Study }
  | { kind: 'save-same'; other: Study }
  | { kind: 'truncate' }
  | { kind: 'cancel' };

function StudyView({
  study,
  session,
  ply,
  book,
  pool,
}: {
  study: Study;
  session: EditSession | null;
  /** 開く局面（平手から何手目か）。無ければ研究手順の終わり（定跡帳では出発点） */
  ply?: number;
  /** 定跡帳として見ているとき（段階9-2） */
  book: BookContext | null;
  /** 「この局面からの研究」でつなぐ研究手順 */
  pool: readonly Study[];
}) {
  /** 編集中は下書きの手順、ふだんは研究手順の手順 */
  const moves = session ? session.draft.moves : study.moves;
  const positions = useMemo(() => studyPositions(moves), [moves]);
  const texts = useMemo(() => moveTexts(moves), [moves]);
  const last = positions.length - 1;
  /** 戻れるいちばん前の局面（定跡帳は出発点より前に戻らない） */
  const minIndex = book && !session ? Math.min(book.start, last) : 0;
  /**
   * 盤に出している局面（平手から何手目か）。開いたときは研究手順の終わり（定跡帳では出発点）か、URL の手数。
   * 定跡帳から入った編集を終えて戻ったときは、編集を終えた局面。編集中は下書きの index を使う
   */
  const [viewIndex, setIndex] = useState(() => {
    const exit = book ? takeEditExit(study.id) : undefined;
    const at = exit ?? ply ?? (book ? book.start : study.moves.length);
    return Math.max(book ? book.start : 0, Math.min(study.moves.length, at));
  });
  const index = session ? session.draft.index : Math.max(minIndex, Math.min(viewIndex, last));
  const [dialog, setDialog] = useState<'menu' | 'edit' | 'trees' | 'book-menu' | null>(null);
  const [editDialog, setEditDialog] = useState<EditDialog | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [note, setNote] = useState('');
  /** 研究手順の途中を開始局面にするツリー（「ツリーで見る」の候補） */
  const [trees, setTrees] = useState<TreeData[]>([]);
  const templates = allTemplates();
  const template = studyTemplate(session ? { moves, templateId: study.templateId } : study, templates);
  const dirty = session !== null && draftChanged(session.draft, session.saved);
  const crumbsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    loadTreesOnLine(study.moves)
      .then((list) => alive && setTrees(list))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [study.moves]);

  useEffect(() => {
    // 今の手が見えるように手順の行を横にだけスクロール（画面の縦のスクロールは動かさない）
    const box = crumbsRef.current;
    const el = box?.querySelector<HTMLElement>('.crumb.current');
    if (!box) return;
    if (!el) {
      box.scrollLeft = 0;
      return;
    }
    const left = el.offsetLeft - box.offsetLeft;
    if (left < box.scrollLeft) box.scrollLeft = left;
    else if (left + el.offsetWidth > box.scrollLeft + box.clientWidth) box.scrollLeft = left + el.offsetWidth - box.clientWidth;
  }, [index, moves]);

  // 今の局面までの手順を、最後までたどれるツリー（平手からの手順がまったく同じときだけ）
  const movesHere = moves.slice(0, index);
  const treesHere = trees.filter((t) => pathInTree(t, movesHere) !== null);

  // スマホ縦：盤・手順の操作（‹ ›）・手順の行（編集中は「1手戻す」「ここで終わりにする」の行まで）が、スクロールせずに見える盤の幅。
  // 「この局面からの研究」を出すときは、その 3 行目まで（段階9-2、持ち主の判断 14。幅 360・高さ 640 が基準）
  const boardRef = useRef<HTMLDivElement>(null);
  const toolsRef = useRef<HTMLDivElement>(null);
  const branchesRef = useRef<HTMLDivElement>(null);
  /** 手順の行の下から、一覧の 3 行目の下までの高さ（最後に測った値）。一覧が出ない局面でも同じだけ空けて、盤の大きさを変えない */
  const listReserve = useRef<number | null>(null);
  const boardFit = useBoardFit(boardRef, (board) => {
    if (session) return measureFitAbove(board, toolsRef.current ?? crumbsRef.current, 0);
    const crumbs = crumbsRef.current;
    const rows = branchesRef.current?.querySelectorAll<HTMLElement>('.book-row');
    if (crumbs && rows && rows.length > 0) {
      const n = Math.min(3, rows.length);
      const rowH = rows[0].getBoundingClientRect().height;
      listReserve.current = rows[n - 1].getBoundingClientRect().bottom - crumbs.getBoundingClientRect().bottom + (3 - n) * rowH;
    }
    // 一覧がどこかの局面で出るなら（定跡帳・同じ側の研究手順がほかにもある）、いつも一覧の分を空ける
    const reserve = book || pool.length >= 2 ? (listReserve.current ?? LIST_GUESS) : 0;
    return measureFitAbove(board, crumbs, reserve);
  });

  const input = useMoveInput(positions[index] ?? STARTPOS_SFEN, (move) => onPlay(move.usi), session !== null && !busy);

  function moveTo(i: number) {
    input.clear();
    if (session) setDraft(moveDraftTo(session.draft, i));
    else setIndex(Math.max(minIndex, Math.min(last, i)));
    setNote('');
  }

  // ---- この局面からの研究（段階9-2） ----

  /** 今の局面での研究手順のつながり（編集中は出さない） */
  const connections = useMemo(() => (session ? null : bookAt(pool, study.moves.slice(0, index))), [session, pool, study.moves, index]);
  /** 一覧を出すか：定跡帳ではいつも。研究手順の画面では、この局面を通る研究手順が今の 1 本だけなら出さない */
  const showBranches = connections !== null && (book !== null || connections.count >= 2);

  /** ほかの研究手順に切り替える（同じ局面のまま、またはその手を指した局面へ）。履歴は増やさない */
  function switchTo(target: Study, at: number) {
    if (target.id === study.id) {
      moveTo(at);
      return;
    }
    location.replace(`#${book ? bookPath(book.key, target.id, at) : `/study/${target.id}/${at}`}`);
  }

  /** 次の手を押した：今の研究手順の次の手なら 1 手進む。違う手なら、その手を通る研究手順のうちいちばん最近直したものへ */
  function pickBranch(branch: BookBranch<Study>) {
    if (study.moves[index] === branch.move) moveTo(index + 1);
    else switchTo(switchTarget(branch), index + 1);
  }

  // 定跡帳：今の研究手順と局面を URL に書いておく（戻るボタンで戻ってきたとき・編集から戻ったときに同じところを開く）。
  // 画面は移らない（hashchange は起きない）
  useEffect(() => {
    if (!book || session) return;
    const url = `#${bookPath(book.key, study.id, index)}`;
    if (location.hash !== url) history.replaceState(history.state, '', url);
  }, [book, session, study.id, index]);

  // 左右スワイプ：右へ払うと 1 手戻る、左へ払うと 1 手進む
  const touch = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: TouchEvent) => {
    const t = e.touches[0];
    touch.current = { x: t.clientX, y: t.clientY };
  };
  const onTouchEnd = (e: TouchEvent) => {
    const start = touch.current;
    touch.current = null;
    if (!start) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    moveTo(dx > 0 ? index - 1 : index + 1);
  };

  // ---- 手順の編集（段階9-1） ----

  /** 下書きを書き換える（編集中だけ。前の操作の知らせは消す） */
  function setDraft(draft: Draft) {
    if (!session) return;
    const { notice: _n, ...rest } = session;
    void _n;
    editSession.value = { ...rest, draft };
  }

  function onPlay(move: string) {
    if (!session) return;
    setNote('');
    const r = playOnDraft(session.draft, move);
    if (r.kind === 'fork') setEditDialog({ kind: 'fork', move, next: r.next });
    else setDraft(r.draft);
  }

  function startEdit() {
    setNote('');
    enterEdit({ id: study.id, saved: [...study.moves], draft: startDraft(study.moves, index), fromView: true, ...(book ? { book: book.key } : {}) });
  }

  /** 編集を終えて見返しの画面へ（局面はそのまま） */
  function finish(s: EditSession, message: string) {
    setIndex(s.draft.index);
    setEditDialog(null);
    setNote(message);
    leaveEdit(s);
  }

  async function save() {
    if (!session || busy) return;
    if (!dirty) {
      finish(session, '');
      return;
    }
    const problem = checkEdited(session.draft.moves, studiesNow(), study.id);
    if (problem?.kind === 'same') {
      setEditDialog({ kind: 'save-same', other: problem.other });
      return;
    }
    if (problem) return;
    setBusy(true);
    try {
      await saveStudies([editedStudy(study, session.draft.moves, templates, Date.now(), session.branchAt)]);
      finish(session, `手順を保存しました（${session.draft.moves.length} 手）`);
    } catch (e) {
      setNote(`保存できませんでした（${e instanceof Error ? e.message : String(e)}）`);
    } finally {
      setBusy(false);
    }
  }

  /** やめる：変更があれば確認してから、編集前の手順に戻す */
  function cancel(confirmed = false) {
    if (!session) return;
    if (dirty && !confirmed) {
      setEditDialog({ kind: 'cancel' });
      return;
    }
    const at = Math.min(session.draft.index, study.moves.length);
    finish({ ...session, draft: { ...session.draft, index: at } }, dirty ? '編集をやめました（手順は元のままです）' : '');
  }

  /**
   * 「分かれる手として、別の研究手順にする」：今の局面まで同じで、指した手から始まる研究手順を作り、その編集へ移る。
   * 元の研究手順にまだ保存していない変更があれば、それも保存する（分かれた時点で消えないように）。
   * 同じ手順がすでにあれば作らずに知らせる（target を渡されたら、その研究手順の編集へ移る）
   */
  async function branch(move: string, target?: Study) {
    if (!session || busy) return;
    const all = studiesNow();
    const branchTo = branchMoves(session.draft, move);
    const existing = target ?? findSameStudy(
      all.filter((s) => s.id !== study.id),
      branchTo,
    );
    if (existing && !target) {
      setEditDialog({ kind: 'branch-same', move, other: existing });
      return;
    }
    const put: Study[] = [];
    if (dirty) {
      const problem = checkEdited(session.draft.moves, all, study.id);
      if (problem?.kind === 'same') {
        setEditDialog({ kind: 'save-same', other: problem.other });
        return;
      }
      put.push(editedStudy(study, session.draft.moves, templates, Date.now(), session.branchAt));
    }
    const made = existing ?? branchStudy(study, branchTo, templates, Date.now(), newStudyId());
    if (!existing) put.push(made);
    setBusy(true);
    try {
      if (put.length > 0) await saveStudies(put);
      setEditDialog(null);
      navigateEdit(
        {
          id: made.id,
          saved: [...made.moves],
          draft: startDraft(made.moves, branchTo.length),
          ...(existing ? {} : { branchAt: branchTo.length - 1 }),
          fromView: false,
          notice: existing ? `「${made.name}」の編集に移りました` : `別の研究手順を作りました：「${made.name}」`,
          ...(session.book !== undefined ? { book: session.book } : {}),
        },
        `/study/${made.id}/edit`,
      );
    } catch (e) {
      setNote(`保存できませんでした（${e instanceof Error ? e.message : String(e)}）`);
    } finally {
      setBusy(false);
    }
  }

  /** ほかの研究手順を開く（編集中の変更は捨てる） */
  function openOther(other: Study) {
    setEditDialog(null);
    navigateEdit(null, session?.book !== undefined ? bookPath(session.book, other.id, other.moves.length) : `/study/${other.id}`);
  }

  // ---- ふだんの操作 ----

  function makeTree() {
    inputHandoff.value = { moves: [...moves], index, mySide: study.mySide, ...(template ? { templateId: template.id } : {}) };
    go('/new');
  }

  function openTree(t: TreeData) {
    go(`/tree/${t.id}/study/${study.id}/${index}`);
  }

  async function copyKif() {
    setDialog(null);
    const ok = await copyText(studiesToKif([study]));
    setNote(ok ? 'KIF をコピーしました。ほかのアプリの「クリップボードから読み込み」で貼り付けられます。' : 'コピーできませんでした');
  }

  async function share(kind: 'json' | 'kif') {
    const outcome = await shareStudies([study], kind);
    if (outcome !== 'cancelled') {
      setDialog(null);
      setNote(OUTCOME_TEXT[outcome]);
    }
  }

  /** 定跡帳のグループの研究手順を、変化付きの 1 つの KIF にして渡す（並びは画面と同じ。共有の前に待たない） */
  async function shareBook() {
    if (!book) return;
    const kif = studiesToKif(bookOrder(pool), `定跡帳：${book.label}`);
    const outcome = await shareFile(fileNameOf(`定跡帳-${book.label}`, 'kifu'), kif, 'text/plain');
    if (outcome !== 'cancelled') {
      setDialog(null);
      setNote(OUTCOME_TEXT[outcome]);
    }
  }

  async function remove() {
    await removeStudy(study.id);
    go('/');
  }

  const sideText = study.mySide === 'black' ? '☗先手' : '☖後手';
  const where = template ? groupLabel(template.group, study.mySide) : `その他（自分は${sideText}）`;
  /** 手の文字（窓に出す）：今の局面で指した手 */
  const playedText = (move: string) => moveText(positions[index] ?? STARTPOS_SFEN, move, index > 0 ? moves[index - 1] : undefined);
  const editHint =
    session?.notice ??
    (note ||
      (index === moves.length ? '盤の駒をタップして指すと、手順の最後に足します。' : '盤で指すと、次の手と違う手なら「置き換える」か「別の研究手順にする」かを選べます。'));

  return (
    <>
      {session ? (
        <div class="screen-header study-editing-header" data-testid="study-edit-header">
          <button type="button" class="btn btn-ghost" data-testid="study-edit-cancel" disabled={busy} onClick={() => cancel()}>
            やめる
          </button>
          <h1 class="tree-title">✎ 手順を編集中</h1>
          <button type="button" class="btn btn-primary" data-testid="study-edit-save" disabled={busy} onClick={() => void save()}>
            保存
          </button>
        </div>
      ) : book ? (
        <div class="screen-header">
          <button type="button" class="btn btn-ghost" onClick={() => go('/')}>
            ‹ 一覧
          </button>
          <h1 class="tree-title book-title" data-testid="book-title">
            <span class="book-kicker">定跡帳</span>
            <span class="book-label">{book.label}</span>
          </h1>
          <button type="button" class="btn tree-menu-btn" aria-label="定跡帳の操作" data-testid="book-menu" onClick={() => setDialog('book-menu')}>
            ⋯
          </button>
        </div>
      ) : (
        <div class="screen-header">
          <button type="button" class="btn btn-ghost" onClick={() => go('/')}>
            ‹ 一覧
          </button>
          <h1 class="tree-title">研究手順</h1>
          <button type="button" class="btn tree-menu-btn" aria-label="研究手順の操作" data-testid="study-screen-menu" onClick={() => setDialog('menu')}>
            ⋯
          </button>
        </div>
      )}

      {book && !session ? (
        // 定跡帳：今たどっている研究手順の名前とメモの最初の 1 行を 1 行に（その研究手順を通っている間はいつも見える。
        // 一覧の 3 行目まで画面に収めるため 1 行にした。メモの全文は下のカード）
        <div class="study-head">
          <p class="study-title study-title-line">
            <span class="study-star" aria-hidden="true">
              ★
            </span>
            <strong data-testid="study-title">{study.name}</strong>
            <span class="muted study-meta-inline" data-testid="study-meta">
              {firstLine(study.note) || 'メモなし'}
            </span>
          </p>
        </div>
      ) : (
        <div class="study-head">
          <p class="study-title">
            <span class="study-star" aria-hidden="true">
              ★
            </span>
            <strong data-testid="study-title">{study.name}</strong>
          </p>
          <p class="muted study-meta" data-testid="study-meta">
            {where}・{moves.length} 手{dirty && session ? `（保存前。元は ${session.saved.length} 手）` : ''}
          </p>
        </div>
      )}

      <div class="tree-layout study-layout">
        <div
          ref={boardRef}
          {...boardFitProps(boardFit, 'tree-board')}
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
          data-testid="study-board"
        >
          <Board
            sfen={positions[index] ?? STARTPOS_SFEN}
            lastMove={index > 0 ? moves[index - 1] : undefined}
            {...(session ? { selection: input.selection, onSquare: input.onSquare, onHand: input.onHand } : {})}
          />
        </div>

        <div class="tree-side">
          {session && <PromotionBox input={input} />}
          <div class="move-nav" data-testid="study-nav">
            <button type="button" class="btn" aria-label={book ? '出発点へ' : '最初へ'} onClick={() => moveTo(0)} disabled={index <= minIndex}>
              |‹
            </button>
            <button
              type="button"
              class="btn"
              aria-label="1手戻る"
              data-testid="study-prev"
              onClick={() => moveTo(index - 1)}
              disabled={index <= minIndex}
            >
              ‹
            </button>
            <span class="move-nav-text num" data-testid="study-position">
              {index === 0 ? '初期局面' : `${index}手目 ${texts[index - 1] ?? ''}`}
            </span>
            <button type="button" class="btn" aria-label="1手進む" data-testid="study-next" onClick={() => moveTo(index + 1)} disabled={index >= last}>
              ›
            </button>
            <button type="button" class="btn" aria-label="最後へ" data-testid="study-last" onClick={() => moveTo(last)} disabled={index >= last}>
              ›|
            </button>
          </div>

          <div class="crumbs study-crumbs" ref={crumbsRef} data-testid="study-crumbs">
            {minIndex > 0 && (
              // 定跡帳：出発点より前の手は出さず、出発点（戦型の名前）を先頭に
              <button
                type="button"
                class={index === minIndex ? 'crumb current' : 'crumb'}
                data-testid="book-start-crumb"
                onClick={() => moveTo(minIndex)}
              >
                {book?.startName}
              </button>
            )}
            {texts.map((t, i) => i + 1 > minIndex && (
              <button
                type="button"
                key={`${i}-${t}`}
                class={i + 1 === index ? 'crumb current' : i + 1 > index ? 'crumb crumb-ahead' : 'crumb'}
                data-testid="study-crumb"
                onClick={() => moveTo(i + 1)}
              >
                {t}
              </button>
            ))}
          </div>

          {session ? (
            <>
              <div class="btn-row study-edit-tools" ref={toolsRef}>
                <button
                  type="button"
                  class="btn"
                  data-testid="study-edit-undo"
                  disabled={session.draft.undo.length === 0 || busy}
                  onClick={() => {
                    input.clear();
                    setNote('');
                    setDraft(undoDraft(session.draft));
                  }}
                >
                  ↶ 1手戻す
                </button>
                <button
                  type="button"
                  class="btn"
                  data-testid="study-edit-truncate"
                  disabled={index === 0 || movesAfter(session.draft) === 0 || busy}
                  onClick={() => setEditDialog({ kind: 'truncate' })}
                >
                  ここで終わりにする
                </button>
              </div>
              <p class="muted study-edit-hint" role="status" data-testid="study-edit-status">
                {editHint}
              </p>
            </>
          ) : book ? (
            <>
              {connections && (
                <StudyBranches
                  listRef={branchesRef}
                  connections={connections}
                  study={study}
                  sfen={positions[index] ?? STARTPOS_SFEN}
                  prev={index > 0 ? moves[index - 1] : undefined}
                  onBranch={pickBranch}
                  onEnding={(s) => switchTo(s, index)}
                />
              )}
              <div class="node-actions">
                <button type="button" class="btn btn-primary" data-testid="book-review" onClick={() => go(groupReviewPath(book.key))}>
                  まとめて復習（{pool.length} 本）
                </button>
                <button type="button" class="btn" data-testid="study-edit-start" onClick={startEdit}>
                  手順を編集
                </button>
              </div>
              {note && (
                <p class="muted" role="status" data-testid="study-screen-status">
                  {note}
                </p>
              )}
              <div class="card">
                {study.note ? (
                  <p class="study-note" data-testid="study-screen-note">
                    {study.note}
                  </p>
                ) : (
                  <p class="muted">「{study.name}」にメモはありません。</p>
                )}
              </div>
            </>
          ) : (
            <>
              {showBranches && connections && (
                <StudyBranches
                  listRef={branchesRef}
                  connections={connections}
                  study={study}
                  sfen={positions[index] ?? STARTPOS_SFEN}
                  prev={index > 0 ? moves[index - 1] : undefined}
                  onBranch={pickBranch}
                  onEnding={(s) => switchTo(s, index)}
                />
              )}
              <div class="card">
                {study.note ? (
                  <p class="study-note" data-testid="study-screen-note">
                    {study.note}
                  </p>
                ) : (
                  <p class="muted">メモはありません（⋯ の「名前・メモを直す」で書けます）。</p>
                )}
              </div>

              <div class="node-actions">
                <button type="button" class="btn btn-primary" data-testid="study-screen-review" onClick={() => go(`/study-review/${study.id}`)}>
                  この研究手順を復習
                </button>
                <button type="button" class="btn" data-testid="study-edit-start" onClick={startEdit}>
                  手順を編集
                </button>
                <button type="button" class="btn" data-testid="study-make-tree" onClick={makeTree}>
                  この局面からツリーを作る
                </button>
                {treesHere.length > 0 && (
                  <button
                    type="button"
                    class="btn"
                    data-testid="study-open-tree"
                    onClick={() => (treesHere.length === 1 ? openTree(treesHere[0]) : setDialog('trees'))}
                  >
                    ツリーで見る{treesHere.length > 1 ? `（${treesHere.length}）` : ''}
                  </button>
                )}
              </div>
              {note && (
                <p class="muted" role="status" data-testid="study-screen-status">
                  {note}
                </p>
              )}
            </>
          )}
        </div>
      </div>

      {/* ---- 編集中の窓 ---- */}
      {session && editDialog?.kind === 'fork' && (
        <Dialog title={`${playedText(editDialog.move)} を指しました`} onClose={() => setEditDialog(null)} testId="study-fork-dialog">
          <p>今の手順では、次の手は {playedText(editDialog.next)} です。</p>
          <div class="dialog-actions dialog-actions-column">
            <button
              type="button"
              class="btn"
              data-testid="study-fork-replace"
              onClick={() => {
                setDraft(replaceFrom(session.draft, editDialog.move));
                setEditDialog(null);
              }}
            >
              ここから先を置き換える（後ろの {movesAfter(session.draft)} 手を消す）
            </button>
            <button type="button" class="btn" data-testid="study-fork-branch" disabled={busy} onClick={() => void branch(editDialog.move)}>
              分かれる手として、別の研究手順にする
            </button>
            {dirty && <p class="muted">元の研究手順の、まだ保存していない変更も保存します。</p>}
            <button type="button" class="btn btn-ghost" data-testid="study-fork-cancel" onClick={() => setEditDialog(null)}>
              やめる（指さなかったことにする）
            </button>
          </div>
        </Dialog>
      )}

      {session && editDialog?.kind === 'branch-same' && (
        <Dialog title="すでにある研究手順です" onClose={() => setEditDialog(null)} testId="study-branch-same-dialog">
          <p>この手順は、研究手順「{editDialog.other.name}」としてすでにあります。</p>
          {dirty && <p class="muted">移るときは、元の研究手順の、まだ保存していない変更も保存します。</p>}
          <div class="dialog-actions">
            <button
              type="button"
              class="btn btn-primary"
              data-testid="study-branch-same-open"
              disabled={busy}
              onClick={() => void branch(editDialog.move, editDialog.other)}
            >
              「{editDialog.other.name}」の編集に移る
            </button>
            <button type="button" class="btn" onClick={() => setEditDialog(null)}>
              やめる
            </button>
          </div>
        </Dialog>
      )}

      {session && editDialog?.kind === 'save-same' && (
        <Dialog title="ほかの研究手順と同じ手順です" onClose={() => setEditDialog(null)} testId="study-save-same-dialog">
          <p>この手順は、研究手順「{editDialog.other.name}」とまったく同じなので、保存できません。</p>
          <div class="dialog-actions dialog-actions-column">
            <button type="button" class="btn btn-primary" data-testid="study-save-same-back" onClick={() => setEditDialog(null)}>
              編集に戻る
            </button>
            <button type="button" class="btn" data-testid="study-save-same-open" onClick={() => openOther(editDialog.other)}>
              「{editDialog.other.name}」を開く（この変更は捨てる）
            </button>
          </div>
        </Dialog>
      )}

      {session && editDialog?.kind === 'truncate' && (
        <Dialog title="ここで終わりにしますか？" onClose={() => setEditDialog(null)} testId="study-truncate-dialog">
          <p>後ろの {movesAfter(session.draft)} 手を消します（保存するまでは「1手戻す」や「やめる」で戻せます）。</p>
          <div class="dialog-actions">
            <button
              type="button"
              class="btn btn-danger"
              data-testid="study-truncate-ok"
              onClick={() => {
                setDraft(truncateHere(session.draft));
                setEditDialog(null);
              }}
            >
              終わりにする
            </button>
            <button type="button" class="btn" onClick={() => setEditDialog(null)}>
              やめる
            </button>
          </div>
        </Dialog>
      )}

      {session && editDialog?.kind === 'cancel' && (
        <Dialog title="編集をやめますか？" onClose={() => setEditDialog(null)} testId="study-cancel-dialog">
          <p>まだ保存していない変更を捨てて、編集前の手順に戻します。</p>
          <div class="dialog-actions">
            <button type="button" class="btn btn-danger" data-testid="study-cancel-ok" onClick={() => cancel(true)}>
              捨てる
            </button>
            <button type="button" class="btn" onClick={() => setEditDialog(null)}>
              編集を続ける
            </button>
          </div>
        </Dialog>
      )}

      {/* ---- ふだんの窓 ---- */}
      {dialog === 'menu' && (
        <Dialog title={`★ ${study.name}`} onClose={() => setDialog(null)} testId="study-screen-menu-dialog">
          <div class="dialog-actions dialog-actions-column">
            <button type="button" class="btn" data-testid="study-screen-edit" onClick={() => setDialog('edit')}>
              名前・メモを直す
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
          </div>
          <div class="dialog-actions">
            {!confirmDelete ? (
              <button type="button" class="btn btn-danger" data-testid="study-screen-delete" onClick={() => setConfirmDelete(true)}>
                消す…
              </button>
            ) : (
              <>
                <span>この研究手順を消しますか？元に戻せません（ツリーの手や局面は消えません）。</span>
                <button type="button" class="btn btn-danger" data-testid="study-screen-delete-ok" onClick={() => void remove()}>
                  消す
                </button>
                <button type="button" class="btn" onClick={() => setConfirmDelete(false)}>
                  やめる
                </button>
              </>
            )}
          </div>
        </Dialog>
      )}

      {dialog === 'edit' && (
        <StudyEditDialog
          study={study}
          defaultName={study.name}
          movesText={studyMovesText(study, templates)}
          side={study.mySide}
          onSave={(f) => {
            setDialog(null);
            void updateStudyFields(study, f).then(() => setNote('直しました'));
          }}
          onClose={() => setDialog(null)}
        />
      )}

      {dialog === 'book-menu' && book && (
        <Dialog title={`定跡帳：${book.label}`} onClose={() => setDialog(null)} testId="book-menu-dialog">
          <div class="dialog-actions dialog-actions-column">
            <button type="button" class="btn" data-testid="book-share-kif" onClick={() => void shareBook()}>
              KIF で書き出す（変化付き・{pool.length} 本）
            </button>
          </div>
          <p class="muted">分かれ目が変化として並ぶ 1 つの KIF です（研究手順の多い手が本譜）。ShogiHome などで開けます。</p>
        </Dialog>
      )}

      {dialog === 'trees' && (
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

/** 一覧の 3 行目までの高さの見込み（まだ測っていないとき。見出し＋3 行） */
const LIST_GUESS = 190;

/**
 * 「この局面からの研究」（段階9-2）：次の手ごとに、その手を通る研究手順の名前と数。今見ている研究手順の手に印。
 * その局面で終わる研究手順は「ここで終わる研究」として下に。押すと、その手の局面へ進む（違う研究手順なら切り替える）
 */
function StudyBranches({
  connections,
  study,
  sfen,
  prev,
  onBranch,
  onEnding,
  listRef,
}: {
  connections: BookPosition<Study>;
  study: Study;
  /** 今の局面（手の文字を作るため） */
  sfen: string;
  /** 今の局面の直前の手（「同」を付けるため） */
  prev: string | undefined;
  onBranch: (branch: BookBranch<Study>) => void;
  onEnding: (s: Study) => void;
  listRef: { current: HTMLDivElement | null };
}) {
  const { branches, ending, count } = connections;
  /** 名前の並び：今見ている研究手順を先に */
  const names = (list: readonly Study[]) =>
    [...list.filter((s) => s.id === study.id), ...list.filter((s) => s.id !== study.id)].map((s) => s.name).join('・');
  return (
    <div class="card candidates book-list" ref={listRef} data-testid="study-book-list">
      <div class="candidates-head">
        <strong data-testid="study-book-head">この局面からの研究（{count} 本）</strong>
      </div>
      <ul class="candidate-list">
        {branches.map((b) => {
          const current = b.studies.some((s) => s.id === study.id);
          return (
            <li key={b.move}>
              <button
                type="button"
                class={current ? 'candidate book-row book-current' : 'candidate book-row'}
                data-testid="study-book-branch"
                data-current={current ? 'true' : 'false'}
                onClick={() => onBranch(b)}
              >
                <span class="candidate-line">
                  <span class="candidate-move">
                    {current ? '▶ ' : ''}
                    {moveText(sfen, b.move, prev)}
                  </span>
                  <span class="book-names">{names(b.studies)}</span>
                  {b.studies.length >= 2 && <span class="book-count num">（{b.studies.length}）</span>}
                </span>
              </button>
            </li>
          );
        })}
        {ending.map((s) => {
          const current = s.id === study.id;
          return (
            <li key={`end-${s.id}`}>
              <button
                type="button"
                class={current ? 'candidate book-row book-current' : 'candidate book-row'}
                data-testid="study-book-ending"
                data-current={current ? 'true' : 'false'}
                onClick={() => onEnding(s)}
              >
                <span class="candidate-line">
                  <span class="candidate-move book-end-label">{current ? '▶ ' : ''}ここで終わる研究</span>
                  <span class="book-names">{s.name}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
