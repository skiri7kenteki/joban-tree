// 定跡帳のタブ（#/。アプリを開くといつもここ）：定跡帳（戦型のグループ × 自分の側）ごとに 1 行と、研究手順の登録。
//   - 「＋ 研究手順を登録」は［平手から］［戦型から選ぶ］→ 自分の側 → 定跡帳が開いて、そのまま指せる（段階10-1）。
//     下に、棋譜を貼って 1 本・変化付き KIF からまとめて
//   - いちばん上に稽古の集計（今日の稽古・身についた・前回まちがい）。1 本ずつの一覧は定跡帳の ⋯「研究手順の一覧」（src/app/StudyList.tsx）
//   - 端末の保存場所を新しい版にしたときの移し替えの結果を、一度だけ知らせる

import { useEffect, useRef, useState } from 'preact/hooks';
import { Dialog } from '../components/Dialog';
import { takeMigrationNote } from '../storage/migrate';
import { groupStudies, hirateBookKey, type TreeGroup } from '../tree/organize';
import type { Side } from '../shogi/position';
import { listName, type OpeningTemplate } from '../tree/templates';
import { summarizePractice, type PracticeSummary } from '../practice/practice';
import { LearnRing } from '../components/Marks';
import { DueText, useStudyDue } from './StudyList';
import { parseStudiesJson, planStudyImport, resolveStudyImport, type StudyConflictChoice, type StudyImportPlan } from '../tree/studyFile';
import type { Study } from '../tree/types';
import { bookPath, bookTemplatePath, go } from './router';
import { TemplatePicker, allTemplates, myTemplates, refreshMyTemplates } from './TemplateDialogs';
import { KifPasteDialog } from './addToBook';
import { fixStoredStudies } from './studyFix';
import { BasicStudiesDialog } from './BasicStudiesDialog';
import { ensureStudies, homeNotice, importUndo, library, saveStudies } from './studies';
import { ImportUndoButton } from './ImportUndo';
import { Words } from '../components/Words';
import { BackupNudge } from './DataSection';
import { SyncNudge } from './DriveSection';
import { ConflictNotice } from './ConflictNotice';

export function HomeScreen({ isolationMessage }: { isolationMessage: string | null }) {
  const [error, setError] = useState('');
  // KIF から取り込んだ後などの一言（一度だけ）
  const [message, setMessage] = useState(() => {
    const notice = homeNotice.value;
    homeNotice.value = null;
    return notice ?? '';
  });
  // 段階25-2：KIF の取り込みの［取り消す］。この画面を離れるまで（持ち主の判断 2026-11-26）。ほかの一言に変わったら出さない
  const [undo, setUndo] = useState(() => {
    const asked = importUndo.value;
    importUndo.value = null;
    return asked;
  });
  // 開いている間に届いた一言（アプリを開いたときの研究手順の直しなど。段階10 の直し）
  const lateNotice = homeNotice.value;
  useEffect(() => {
    if (!lateNotice) return;
    setMessage(lateNotice);
    homeNotice.value = null;
  }, [lateNotice]);
  /** 「＋ 研究手順を登録」のメニュー */
  const [registerMenu, setRegisterMenu] = useState(false);
  /** 棋譜を貼って 1 本登録の窓 */
  const [pasting, setPasting] = useState(false);
  /** 新しい研究：戦型を選ぶ窓（picking）・自分の側を選ぶ窓（start。template が null なら平手から） */
  const [newStudy, setNewStudy] = useState<{ kind: 'picking' } | { kind: 'start'; template: OpeningTemplate | null } | null>(null);
  /** 基本の研究を入れる窓（段階20-3） */
  const [basic, setBasic] = useState(false);
  /** 取り込もうとした研究手順に、同じ手順で中身の違うものがあるとき */
  const [studyConflict, setStudyConflict] = useState<StudyImportPlan | null>(null);
  const studyFileRef = useRef<HTMLInputElement>(null);
  // 自分で登録した戦型も、グループ分けに使う（読み込んだら描き直す）
  void myTemplates.value;
  const studies = library.value;
  useEffect(() => {
    if (!myTemplates.value) void refreshMyTemplates().catch(() => undefined);
    ensureStudies()
      .then(() => {
        // 端末の保存場所を新しい版にしたときの、研究手順の移し替えの結果（一度だけ。保存場所を開いた後で読む）
        const note = takeMigrationNote();
        if (note) setMessage(migrationText(note));
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const templates = allTemplates();
  const studyGroups = studies ? groupStudies(studies, templates) : [];
  const studyCount = studies?.length ?? 0;
  /** 段階19：稽古の集計（稽古のタブと同じ数え方。記録は読むだけ） */
  const { records, plan, dueOfAll } = useStudyDue(studies ?? []);
  const practiceSummary = plan && studies && records ? summarizePractice(studies, records, plan.today.length, templates) : null;

  async function onStudyFile(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    setMessage('');
    setRegisterMenu(false);
    const result = parseStudiesJson(await file.text());
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    const plan = planStudyImport(result.studies, await ensureStudies());
    if (plan.conflicts.length > 0) {
      setStudyConflict(plan);
      return;
    }
    await applyStudyImport(plan, 'skip');
  }

  async function applyStudyImport(plan: StudyImportPlan, choice: StudyConflictChoice) {
    setStudyConflict(null);
    const { put, skipped } = resolveStudyImport(plan, choice);
    try {
      if (put.length > 0) {
        await saveStudies(put);
        // 前の版で書き出した研究手順（戦型や名前がずれたもの）も直す（段階10 の直し）
        await fixStoredStudies().catch(() => 0);
      }
      const parts = [`研究手順 ${put.length} 本を取り込みました`];
      if (plan.same > 0) parts.push(`まったく同じもの ${plan.same} 本は飛ばしました`);
      if (skipped > 0) parts.push(`同じ手順の ${skipped} 本は取り込みませんでした`);
      setMessage(parts.join('。'));
    } catch (err) {
      setMessage(`取り込めませんでした（${err instanceof Error ? err.message : String(err)}）`);
    }
  }

  return (
    <>
      <div class="screen-header list-header">
        <h1 class="page-title">定跡帳</h1>
        {studies && (
          <span class="muted num" data-testid="study-count">
            研究手順 {studyCount} 本
          </span>
        )}
        <span class="spacer" />
      </div>
      {isolationMessage && <p class="notice notice-danger">{isolationMessage}</p>}
      {studies && <SyncNudge />}
      {studies && <BackupNudge studies={studies} />}
      {studies && studyCount > 0 && <StudySummary summary={practiceSummary} />}
      {studies && studyCount > 1 && <ConflictNotice studies={studies} />}
      <div class="btn-row">
        <button type="button" class="btn btn-primary btn-wide" data-testid="study-register" onClick={() => setRegisterMenu(true)}>
          ＋ 研究手順を登録
        </button>
      </div>

      {error && <p class="status-ng">{error}</p>}
      {message && (
        <p class="muted" role="status" data-testid="home-message">
          {message}
        </p>
      )}
      {undo && message === undo.message && (
        <ImportUndoButton
          undo={undo}
          onDone={(text) => {
            setUndo(null);
            setMessage(text);
          }}
        />
      )}
      {studies === null && !error && <p class="muted">読み込み中…</p>}

      {studies && studyCount === 0 && (
        <p class="muted" data-testid="studies-empty">
          研究手順はまだありません。「＋ 研究手順を登録」で平手か戦型を選び、盤で指すと研究手順になります。
        </p>
      )}
      {studyGroups.length > 0 && (
        <section class="tree-group" data-testid="book-groups">
          <ul class="tree-list">
            {studyGroups.map((g) => {
              const s = records ? summarizePractice(g.items, records, 0, templates) : null;
              return <BookRow key={g.key} group={g} learned={s?.learned ?? 0} total={s?.total ?? 0} due={dueOfAll(g.items)} />;
            })}
          </ul>
        </section>
      )}
      <input ref={studyFileRef} type="file" accept=".json,application/json" hidden data-testid="study-import-file" onChange={(e) => void onStudyFile(e)} />

      {registerMenu && (
        <Dialog title="研究手順を登録" onClose={() => setRegisterMenu(false)} testId="study-register-menu" sheet>
          {/* 段階13：金のボタンは 1 画面に 1 つほど。ここは選ぶだけの窓なので、どれも普通のボタン */}
          <div class="dialog-actions dialog-actions-column">
            <button
              type="button"
              class="btn"
              data-testid="study-register-hirate"
              onClick={() => {
                setRegisterMenu(false);
                setNewStudy({ kind: 'start', template: null });
              }}
            >
              平手から
            </button>
            <button
              type="button"
              class="btn"
              data-testid="study-register-template"
              onClick={() => {
                setRegisterMenu(false);
                setNewStudy({ kind: 'picking' });
              }}
            >
              戦型から選ぶ
            </button>
            <button
              type="button"
              class="btn"
              data-testid="study-register-basic"
              onClick={() => {
                setRegisterMenu(false);
                setBasic(true);
              }}
            >
              基本の研究を入れる
            </button>
          </div>
          <p class="menu-section-title">棋譜・ファイルから</p>
          <div class="dialog-actions dialog-actions-column">
            <button
              type="button"
              class="btn"
              data-testid="study-register-paste"
              onClick={() => {
                setRegisterMenu(false);
                setPasting(true);
              }}
            >
              棋譜を貼って 1 本登録
            </button>
            <button type="button" class="btn" data-testid="study-register-kif" onClick={() => go('/study-import')}>
              変化付きKIFからまとめて
            </button>
            <button type="button" class="btn" data-testid="study-register-json" onClick={() => studyFileRef.current?.click()}>
              JSONを取り込む
            </button>
          </div>
        </Dialog>
      )}

      {newStudy?.kind === 'picking' && (
        <TemplatePicker onPick={(t) => setNewStudy({ kind: 'start', template: t })} onClose={() => setNewStudy(null)} />
      )}

      {pasting && <KifPasteDialog onClose={() => setPasting(false)} />}

      {basic && <BasicStudiesDialog onClose={() => setBasic(false)} />}

      {newStudy?.kind === 'start' && <NewStudyDialog template={newStudy.template} onClose={() => setNewStudy(null)} />}

      {studyConflict && (
        <Dialog title="同じ手順の研究手順があります" onClose={() => setStudyConflict(null)} testId="study-import-conflict">
          <p>
            取り込む {studyConflict.fresh.length + studyConflict.same + studyConflict.conflicts.length} 本のうち、{studyConflict.conflicts.length}{' '}
            本は、同じ手順で名前やメモの違う研究手順がすでにあります。どうしますか？
          </p>
          <ul class="template-conflict-list">
            {studyConflict.conflicts.map((c) => (
              <li key={c.incoming.id}>
                「{c.incoming.name}」（今は「{c.existing.name}」）
              </li>
            ))}
          </ul>
          <div class="dialog-actions dialog-actions-column">
            <button type="button" class="btn btn-danger" data-testid="study-import-replace" onClick={() => void applyStudyImport(studyConflict, 'replace')}>
              置き換える
            </button>
            <button type="button" class="btn btn-primary" data-testid="study-import-both" onClick={() => void applyStudyImport(studyConflict, 'both')}>
              両方残す
            </button>
            <button type="button" class="btn" data-testid="study-import-skip" onClick={() => void applyStudyImport(studyConflict, 'skip')}>
              取り込まない（同じ手順のものだけ）
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}

/** 移し替えの結果の一言 */
function migrationText(note: { moved: number; leftover: number; failed?: boolean }): string {
  if (note.failed) {
    return `研究手順を、ツリーの外の置き場所に移せませんでした（研究手順 ${note.leftover} 本はツリーの中に残っていて、消えていません）。設定の「データ管理」でバックアップを保存しておいてください。`;
  }
  const parts = [`アプリの更新に合わせて、研究手順 ${note.moved} 本を「研究手順」の一覧に移しました`];
  if (note.leftover > 0) parts.push(`途中の局面から始まるツリーの研究手順 ${note.leftover} 本は移せませんでした（ツリーの中に残してあります）`);
  return `${parts.join('。')}。`;
}

/**
 * 定跡帳のタブのいちばん上の集計（段階12-3。段階19 から稽古の数）：今日の稽古・身についた（1 週以上空くところまで進んだ / 稽古できる研究手順）・前回まちがい。
 * 押すと稽古のタブへ
 */
function StudySummary({ summary }: { summary: PracticeSummary | null }) {
  return (
    <button type="button" class="card book-summary book-summary-practice" data-testid="book-summary" onClick={() => go('/practice')}>
      <span class="book-summary-cell">
        <span class="book-summary-label">今日の稽古</span>
        <span class="book-summary-value num" data-testid="book-summary-today">
          {summary ? summary.today : '–'}
          <small> 本</small>
        </span>
      </span>
      <span class="book-summary-cell">
        <span class="book-summary-label">身についた</span>
        <span class="book-summary-value num" data-testid="book-summary-learned">
          {summary ? summary.learned : '–'}
          <small> / {summary ? summary.total : '–'}本</small>
        </span>
      </span>
      <span class="book-summary-cell">
        <span class="book-summary-label">前回まちがい</span>
        <span class="book-summary-value num" data-testid="book-summary-wrong">
          {summary ? summary.wrong : '–'}
          <small> 本</small>
        </span>
      </span>
    </button>
  );
}

/** 定跡帳の 1 行（名前・研究の本数・覚えた割合の輪・次の稽古の日）。タップで定跡帳 */
function BookRow({ group, learned, total, due }: { group: TreeGroup<Study>; learned: number; total: number; due: string | null }) {
  return (
    <li class="tree-row" data-testid="book-group" data-key={group.key}>
      <button type="button" class="tree-item study-row-item" data-testid="book-group-open" onClick={() => go(bookPath(group.key))}>
        <span class="study-row-text">
          <span class="tree-item-title">
            <span class="tree-item-name">
              <Words text={group.label} />
            </span>
          </span>
          <span class="tree-item-meta num" data-testid="book-group-count">
            研究 {group.items.length}本
          </span>
          <DueText due={due} />
        </span>
        <LearnRing learned={learned} total={total} testId="book-group-ring" />
      </button>
    </li>
  );
}

const SIDE_CHOICE_TEXT: Record<Side, string> = { black: '☗先手', white: '☖後手' };

/**
 * 新しい研究を始める（段階10-1）：自分の側を選んで、定跡帳を開く。
 * 側の初期値は戦型の側（平手なら先手）。その戦型と側のグループに研究手順があれば、その定跡帳を戦型の出発点で開く。無ければ空の定跡帳
 */
function NewStudyDialog({ template, onClose }: { template: OpeningTemplate | null; onClose: () => void }) {
  const [side, setSide] = useState<Side>(template?.mySide ?? 'black');
  function open() {
    if (!template) go(bookPath(hirateBookKey(side)));
    else go(bookTemplatePath(`study:${template.group}|${side}`, template.id));
  }
  return (
    <Dialog title="新しい研究" onClose={onClose} testId="new-study-dialog">
      <p data-testid="new-study-from">出発点：{template ? listName(template) : '平手の初期局面'}</p>
      <div class="side-choice side-choice-strong" role="radiogroup" aria-label="自分は">
        <span>自分は</span>
        {(['black', 'white'] as Side[]).map((s) => (
          <button
            type="button"
            key={s}
            role="radio"
            aria-checked={side === s}
            data-testid={`new-study-side-${s}`}
            class={side === s ? 'btn btn-toggle on' : 'btn btn-toggle'}
            onClick={() => setSide(s)}
          >
            {SIDE_CHOICE_TEXT[s]}
          </button>
        ))}
      </div>
      <div class="dialog-actions">
        <button type="button" class="btn btn-primary" data-testid="new-study-open" onClick={open}>
          定跡帳を開く
        </button>
        <button type="button" class="btn" onClick={onClose}>
          やめる
        </button>
      </div>
    </Dialog>
  );
}
