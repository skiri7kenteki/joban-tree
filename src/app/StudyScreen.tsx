// 研究手順を開く画面（段階8-1、軽い見返しの画面）：盤・手順（前後に動かせる）・名前・メモ。エンジンは使わない。
// 開いたときは研究手順の終わりの局面。ここから：この研究手順を復習、この局面からツリーを作る（新しいツリーの画面に手順を読み込んで移る）、
// ツリーで見る（平手からの手順がまったく同じ手順を含むツリーが端末にあるときだけ。今の局面を開く）、
// ⋯ の中に 名前・メモを直す／KIF をコピー／書き出す（JSON・KIF）／消す（確認あり）。

import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Board } from '../components/Board';
import { Dialog } from '../components/Dialog';
import { STARTPOS_SFEN } from '../shogi/position';
import { loadTreesOnLine } from '../storage/trees';
import { groupLabel } from '../tree/organize';
import { studyPositions } from '../review/studyReview';
import { moveTexts, pathInTree, studyMovesText, studyTemplate } from '../tree/studies';
import { studiesToKif } from '../tree/studyFile';
import type { Study, TreeData } from '../tree/types';
import { boardFitProps, measureFitAbove, useBoardFit } from './boardFit';
import { inputHandoff } from './handoff';
import { go } from './router';
import { OUTCOME_TEXT, copyText } from './share';
import { StudyEditDialog, shareStudies } from './StudyDialogs';
import { ensureStudies, library, removeStudy, updateStudyFields } from './studies';
import { allTemplates, myTemplates, refreshMyTemplates } from './TemplateDialogs';

export function StudyScreen({ id }: { id: string }) {
  const [error, setError] = useState('');
  const studies = library.value;
  void myTemplates.value;
  useEffect(() => {
    ensureStudies().catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    if (!myTemplates.value) void refreshMyTemplates().catch(() => undefined);
  }, []);

  if (error) return <p class="status-ng">{error}</p>;
  if (!studies) return <p class="muted">読み込み中…</p>;
  const study = studies.find((s) => s.id === id);
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
  return <StudyView key={study.id} study={study} />;
}

function StudyView({ study }: { study: Study }) {
  const positions = useMemo(() => studyPositions(study.moves), [study.moves]);
  const texts = useMemo(() => moveTexts(study.moves), [study.moves]);
  const last = positions.length - 1;
  /** 盤に出している局面（平手から何手目か）。開いたときは研究手順の終わり */
  const [index, setIndex] = useState(last);
  const [dialog, setDialog] = useState<'menu' | 'edit' | 'trees' | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [note, setNote] = useState('');
  /** 研究手順の途中を開始局面にするツリー（「ツリーで見る」の候補） */
  const [trees, setTrees] = useState<TreeData[]>([]);
  const templates = allTemplates();
  const template = studyTemplate(study, templates);
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
  }, [index]);

  // 今の局面までの手順を、最後までたどれるツリー（平手からの手順がまったく同じときだけ）
  const movesHere = study.moves.slice(0, index);
  const treesHere = trees.filter((t) => pathInTree(t, movesHere) !== null);

  // スマホ縦：盤・手順の操作（‹ ›）・手順の行が、スクロールせずに見える盤の幅
  const boardRef = useRef<HTMLDivElement>(null);
  const boardFit = useBoardFit(boardRef, (board) => measureFitAbove(board, crumbsRef.current, 0));

  function moveTo(i: number) {
    setIndex(Math.max(0, Math.min(last, i)));
    setNote('');
  }

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

  function makeTree() {
    inputHandoff.value = { moves: [...study.moves], index, mySide: study.mySide, ...(template ? { templateId: template.id } : {}) };
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

  async function remove() {
    await removeStudy(study.id);
    go('/');
  }

  const sideText = study.mySide === 'black' ? '☗先手' : '☖後手';
  const where = template ? groupLabel(template.group, study.mySide) : `その他（自分は${sideText}）`;

  return (
    <>
      <div class="screen-header">
        <button type="button" class="btn btn-ghost" onClick={() => go('/')}>
          ‹ 一覧
        </button>
        <h1 class="tree-title">研究手順</h1>
        <button type="button" class="btn tree-menu-btn" aria-label="研究手順の操作" data-testid="study-screen-menu" onClick={() => setDialog('menu')}>
          ⋯
        </button>
      </div>

      <div class="study-head">
        <p class="study-title">
          <span class="study-star" aria-hidden="true">
            ★
          </span>
          <strong data-testid="study-title">{study.name}</strong>
        </p>
        <p class="muted study-meta" data-testid="study-meta">
          {where}・{study.moves.length} 手
        </p>
      </div>

      <div class="tree-layout">
        <div ref={boardRef} {...boardFitProps(boardFit, 'tree-board')} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
          <Board sfen={positions[index] ?? STARTPOS_SFEN} lastMove={index > 0 ? study.moves[index - 1] : undefined} />
        </div>

        <div class="tree-side">
          <div class="move-nav" data-testid="study-nav">
            <button type="button" class="btn" aria-label="最初へ" onClick={() => moveTo(0)} disabled={index === 0}>
              |‹
            </button>
            <button type="button" class="btn" aria-label="1手戻る" data-testid="study-prev" onClick={() => moveTo(index - 1)} disabled={index === 0}>
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
            {texts.map((t, i) => (
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
        </div>
      </div>

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
