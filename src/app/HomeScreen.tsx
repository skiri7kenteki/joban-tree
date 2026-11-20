// トップ画面：新しいツリーを作るボタン、保存してあるツリーの一覧（名前の変更・共有・削除）、ファイルからの取り込み。
// 段階7-1：ツリーを「戦型のグループ × 自分の側」でまとめる（開閉でき、状態は端末に覚える）。名前で絞り込む。最近開いた 3 件。
// 段階7-2：「ツリー｜研究手順」の切り替え。
// 段階8-1：研究手順はツリーから独立したデータ（src/tree/studies.ts）。研究手順のタブ：
//   - 「＋ 研究手順を登録」（盤で指す・棋譜を貼る／変化付き KIF からまとめて取り込む（段階8-2）／JSON を取り込む）、「書き出し」（選んで JSON・KIF）
//     段階10-1：「＋ 研究手順を登録」は［平手から］［戦型から選ぶ］→ 自分の側 → 定跡帳が開いて、そのまま指せる。棋譜・KIF・JSON は下に小さく
//   - 研究手順も戦型のグループ × 自分の側でまとめる。グループの ⋯ から「定跡帳として見る」（段階9-2）「このグループの研究手順を復習」「このグループを書き出す」
//   - 行をタップで研究手順の画面（#/study/<id>）。段階10-1 から、その研究手順の終わりの局面で定跡帳を開く。行の ⋯：この研究手順を復習・名前・メモを直す・書き出す・消す（確認あり）
//   - ツリーの JSON（形式 6 まで）を取り込むと、中の研究手順も研究手順として取り込む（同じ手順がすでにあれば足さない）
//   - 端末の保存場所を新しい版にしたときの移し替えの結果を、一度だけ知らせる
// 段階11-1：画面の下のタブに分けた。list='studies' が定跡帳のタブ（#/。いちばん目立つのは「＋ 研究手順を登録」）、
//   list='trees' がツリーのタブ（#/trees。「＋ 新しいツリーを作る」・最近開いた・ツリーの取り込み）。画面の上の「ツリー｜研究手順」の切り替えはやめた

import { signal } from '@preact/signals';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Dialog } from '../components/Dialog';
import { takeMigrationNote } from '../storage/migrate';
import { deleteTree, listTrees, loadTree, newTreeId, saveTree, type TreeSummary } from '../storage/trees';
import { fileNameOf, parseTreeJson, treeToJson } from '../tree/backup';
import { latestBundled } from '../tree/bundledCatalog';
import {
  RECENT_MIN_TREES,
  bookKeyOfGroup,
  filterByName,
  groupStudies,
  groupTrees,
  hirateBookKey,
  normalizeForSearch,
  recentItems,
  type TreeGroup,
} from '../tree/organize';
import type { Side } from '../shogi/position';
import { listName, type OpeningTemplate } from '../tree/templates';
import { firstLine, liftTreeStudies, studyMovesText } from '../tree/studies';
import { parseStudiesJson, planStudyImport, resolveStudyImport, type StudyConflictChoice, type StudyImportPlan } from '../tree/studyFile';
import type { Study, TreeData } from '../tree/types';
import { generation, isGenerating, openTree, treeVersion } from './generation';
import { collapsedGroups, forgetOpened, recentOpened, toggleGroup } from './recent';
import { bookPath, bookTemplatePath, go, groupReviewPath } from './router';
import { OUTCOME_TEXT, shareFile } from './share';
import { TemplatePicker, allTemplates, myTemplates, refreshMyTemplates } from './TemplateDialogs';
import { KifPasteDialog } from './addToBook';
import { fixStoredStudies } from './studyFix';

/** 次にトップ画面を開いたとき「研究手順を登録」の窓を開く（古い登録の画面の URL #/new/study から来たとき。段階10-2） */
export const registerRequest = signal(false);
import { StudyEditDialog, StudyExportDialog, shareStudies } from './StudyDialogs';
import { ensureStudies, homeNotice, importLiftedStudies, library, removeStudy, saveStudies, updateStudyFields } from './studies';

export function HomeScreen({ list, isolationMessage }: { list: 'studies' | 'trees'; isolationMessage: string | null }) {
  const [trees, setTrees] = useState<TreeSummary[] | null>(null);
  const [error, setError] = useState('');
  // KIF から取り込んだ後などの一言（一度だけ）
  const [message, setMessage] = useState(() => {
    const notice = homeNotice.value;
    homeNotice.value = null;
    return notice ?? '';
  });
  // 開いている間に届いた一言（アプリを開いたときの研究手順の直しなど。段階10 の直し）
  const lateNotice = homeNotice.value;
  useEffect(() => {
    if (!lateNotice) return;
    setMessage(lateNotice);
    homeNotice.value = null;
  }, [lateNotice]);
  /** 一覧を読み直す合図 */
  const [reload, setReload] = useState(0);
  /** ⋯ を押したツリー（メニューを出す） */
  const [menuTree, setMenuTree] = useState<TreeData | null>(null);
  /** ⋯ を押した研究手順 */
  const [menuStudy, setMenuStudy] = useState<Study | null>(null);
  /** ⋯ を押した研究手順のグループ */
  const [menuGroup, setMenuGroup] = useState<TreeGroup<Study> | null>(null);
  /** 「＋ 研究手順を登録」のメニュー（古い登録の画面の URL から来たときは開いておく。段階10-2） */
  const [registerMenu, setRegisterMenu] = useState(() => {
    const asked = registerRequest.value;
    registerRequest.value = false;
    return asked;
  });
  /** 棋譜を貼って 1 本登録の窓 */
  const [pasting, setPasting] = useState(false);
  /** 新しい研究：戦型を選ぶ窓（picking）・自分の側を選ぶ窓（start。template が null なら平手から） */
  const [newStudy, setNewStudy] = useState<{ kind: 'picking' } | { kind: 'start'; template: OpeningTemplate | null } | null>(null);
  /** 研究手順の書き出し（initial：初めに選んでおく研究手順） */
  const [exporting, setExporting] = useState<{ initial?: string[] } | null>(null);
  /** 取り込もうとしたツリーが既にあるとき */
  const [conflict, setConflict] = useState<TreeData | null>(null);
  /** 取り込もうとした研究手順に、同じ手順で中身の違うものがあるとき */
  const [studyConflict, setStudyConflict] = useState<StudyImportPlan | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const studyFileRef = useRef<HTMLInputElement>(null);
  /** 名前で絞り込む文字 */
  const [query, setQuery] = useState('');
  // 生成が進んだら一覧（局面の数）も新しくする
  const version = treeVersion.value;
  // 自分で登録した戦型も、グループ分けに使う（読み込んだら描き直す）
  void myTemplates.value;
  const studies = library.value;
  useEffect(() => {
    if (!myTemplates.value) void refreshMyTemplates().catch(() => undefined);
    ensureStudies().catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  useEffect(() => {
    listTrees()
      .then((list) => {
        setTrees(list);
        // 端末の保存場所を新しい版にしたときの、研究手順の移し替えの結果（一度だけ）
        const note = takeMigrationNote();
        if (note) setMessage(migrationText(note));
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [version, reload]);

  const running = isGenerating() ? generation.value!.treeId : null;
  const searching = normalizeForSearch(query) !== '';
  const tab = list;
  const templates = allTemplates();
  const groups = trees ? groupTrees(filterByName(trees, query), templates) : [];
  const studyGroups = studies ? groupStudies(studies, templates, query) : [];
  const allStudyGroups = studies ? groupStudies(studies, templates, '') : [];
  const studyCount = studies?.length ?? 0;
  // 最近開いた：ツリーが 4 つ以上あり、絞り込んでいないときだけ
  const recent = trees && !searching && trees.length >= RECENT_MIN_TREES ? recentItems(trees, recentOpened.value) : [];
  const collapsed = collapsedGroups.value;
  const rowProps = (t: TreeSummary) => ({ tree: t, running: running === t.id, onMenu: () => void openMenu(t.id) });

  async function openMenu(id: string) {
    setMessage('');
    // 共有ボタンを押した直後に共有メニューを出せるよう、先に読み込んでおく（iPad の Safari 対策）
    const tree = openTree.value?.id === id ? openTree.value : await loadTree(id);
    if (tree) setMenuTree(tree);
  }

  async function onFile(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    setMessage('');
    const result = parseTreeJson(await file.text());
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    if (await loadTree(result.tree.id)) {
      setConflict(result.tree);
      return;
    }
    await importTree(result.tree);
  }

  async function importTree(tree: TreeData) {
    try {
      // 形式 6 までのツリーの中の研究手順は、独立した研究手順として取り込む（平手から始まらないツリーは、ツリーの中に残す）
      let studyText = '';
      const lifted = tree.studies && tree.studies.length > 0 ? liftTreeStudies(tree) : null;
      if (lifted) {
        const r = await importLiftedStudies(lifted);
        delete tree.studies;
        studyText = `。研究手順 ${r.added} 本も取り込みました${r.skipped > 0 ? `（${r.skipped} 本はすでにありました）` : ''}`;
      } else if (tree.studies && tree.studies.length > 0) {
        studyText = `。途中の局面から始まるツリーなので、研究手順 ${tree.studies.length} 本は研究手順の一覧に移せませんでした（ツリーの中に残してあります）`;
      }
      await saveTree(tree);
      if (openTree.value?.id === tree.id) openTree.value = tree;
      setMessage(`「${tree.name}」を取り込みました${studyText}`);
    } catch (e) {
      setMessage(`取り込めませんでした（${e instanceof Error ? e.message : String(e)}）`);
    }
    setReload((n) => n + 1);
  }

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
        <h1>{tab === 'studies' ? '定跡帳' : 'ツリー'}</h1>
        {tab === 'studies' && studies && (
          <span class="muted num" data-testid="study-count">
            研究手順 {studyCount} 本
          </span>
        )}
        {tab === 'trees' && trees && (
          <span class="muted num" data-testid="tree-count">
            {trees.length} 本
          </span>
        )}
        <span class="spacer" />
        {tab === 'studies' && studyCount > 0 && (
          <button type="button" class="btn btn-ghost" data-testid="study-export-open" onClick={() => setExporting({})}>
            書き出し
          </button>
        )}
      </div>
      {isolationMessage && <p class="notice notice-danger">{isolationMessage}</p>}
      <div class="btn-row">
        {tab === 'studies' ? (
          <button type="button" class="btn btn-primary btn-wide" data-testid="study-register" onClick={() => setRegisterMenu(true)}>
            ＋ 研究手順を登録
          </button>
        ) : (
          <button type="button" class="btn btn-primary btn-wide" data-testid="new-tree" onClick={() => go('/new')}>
            ＋ 新しいツリーを作る
          </button>
        )}
      </div>

      {trees && (
        <>
          {(tab === 'trees' ? trees.length > 0 : studyCount > 0) && (
            <input
              type="search"
              class="home-filter"
              placeholder={tab === 'trees' ? '名前で絞り込む…' : '名前・メモで絞り込む…'}
              aria-label={tab === 'trees' ? '名前で絞り込む' : '名前・メモで絞り込む'}
              data-testid="tree-filter"
              value={query}
              onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
            />
          )}
        </>
      )}

      {error && <p class="status-ng">{error}</p>}
      {message && (
        <p class="muted" role="status" data-testid="home-message">
          {message}
        </p>
      )}
      {trees === null && !error && <p class="muted">読み込み中…</p>}

      {trees && tab === 'trees' && (
        <>
          {trees.length === 0 && <p class="muted">まだありません。「新しいツリーを作る」から始めてください。</p>}
          {recent.length > 0 && (
            <section class="home-recent" data-testid="recent">
              <h2>最近開いた</h2>
              <ul class="tree-list">
                {recent.map((t) => (
                  <TreeRow key={t.id} {...rowProps(t)} testId="recent-item" dateText={`開いた ${formatShortDate(t.openedAt)}`} />
                ))}
              </ul>
            </section>
          )}

          {trees.length > 0 && <h2>保存したツリー</h2>}
          {searching && groups.length === 0 && (
            <p class="muted" data-testid="filter-empty">
              「{query.trim()}」に当てはまるツリーはありません。
            </p>
          )}
          {groups.map((g) => (
            <GroupSection key={g.key} group={g} open={searching || !collapsed.includes(g.key)} searching={searching}>
              {g.items.map((t) => (
                <TreeRow key={t.id} {...rowProps(t)} testId="tree-item" />
              ))}
            </GroupSection>
          ))}
        </>
      )}

      {trees && tab === 'studies' && (
        <>
          {studies && studyCount === 0 && (
            <p class="muted" data-testid="studies-empty">
              研究手順はまだありません。「＋ 研究手順を登録」で平手か戦型を選び、盤で指すと研究手順になります。
            </p>
          )}
          {searching && studyCount > 0 && studyGroups.length === 0 && (
            <p class="muted" data-testid="filter-empty">
              「{query.trim()}」に当てはまる研究手順はありません。
            </p>
          )}
          {studyGroups.map((g) => (
            <GroupSection
              key={g.key}
              group={g}
              open={searching || !collapsed.includes(g.key)}
              searching={searching}
              onMenu={searching ? undefined : () => setMenuGroup(allStudyGroups.find((x) => x.key === g.key) ?? g)}
            >
              {g.items.map((s) => (
                <StudyRow key={s.id} study={s} bookKey={bookKeyOfGroup(g.key)} onMenu={() => setMenuStudy(s)} />
              ))}
            </GroupSection>
          ))}
        </>
      )}

      {tab === 'trees' && (
        <>
          <div class="btn-row home-import">
            <button type="button" class="btn" data-testid="import-json" onClick={() => fileRef.current?.click()}>
              ツリーを取り込む（JSON）
            </button>
            <input ref={fileRef} type="file" accept=".json,application/json" hidden data-testid="import-file" onChange={(e) => void onFile(e)} />
          </div>
        </>
      )}
      <input ref={studyFileRef} type="file" accept=".json,application/json" hidden data-testid="study-import-file" onChange={(e) => void onStudyFile(e)} />

      {registerMenu && (
        <Dialog title="研究手順を登録" onClose={() => setRegisterMenu(false)} testId="study-register-menu" sheet>
          <div class="dialog-actions dialog-actions-column">
            <button
              type="button"
              class="btn btn-primary"
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
              class="btn btn-primary"
              data-testid="study-register-template"
              onClick={() => {
                setRegisterMenu(false);
                setNewStudy({ kind: 'picking' });
              }}
            >
              戦型から選ぶ
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

      {newStudy?.kind === 'start' && <NewStudyDialog template={newStudy.template} onClose={() => setNewStudy(null)} />}

      {menuGroup && (
        <Dialog title={menuGroup.label} onClose={() => setMenuGroup(null)} testId="study-group-menu" sheet>
          <div class="dialog-actions dialog-actions-column">
            <button type="button" class="btn btn-primary" data-testid="study-group-book" onClick={() => go(bookPath(bookKeyOfGroup(menuGroup.key)))}>
              定跡帳として見る
            </button>
            <button type="button" class="btn" data-testid="study-group-review" onClick={() => go(groupReviewPath(menuGroup.key))}>
              復習（{menuGroup.items.length}本）
            </button>
            <button
              type="button"
              class="btn"
              data-testid="study-group-export"
              onClick={() => {
                const ids = menuGroup.items.map((s) => s.id);
                setMenuGroup(null);
                setExporting({ initial: ids });
              }}
            >
              書き出す…
            </button>
          </div>
        </Dialog>
      )}

      {exporting && <StudyExportDialog groups={allStudyGroups} initial={exporting.initial} onClose={() => setExporting(null)} />}

      {menuStudy && (
        <StudyMenu
          study={menuStudy}
          onClose={() => setMenuStudy(null)}
          onDone={(text) => {
            setMenuStudy(null);
            setMessage(text);
          }}
        />
      )}

      {menuTree && (
        <TreeMenu
          tree={menuTree}
          generating={running === menuTree.id}
          onClose={() => setMenuTree(null)}
          onDone={(text) => {
            setMenuTree(null);
            setMessage(text);
            setReload((n) => n + 1);
          }}
        />
      )}

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

      {conflict && (
        <Dialog title="同じツリーがあります" onClose={() => setConflict(null)} testId="import-conflict">
          <p>
            「{conflict.name}」は、もうこの端末にあります。どうしますか？
          </p>
          <div class="dialog-actions">
            <button
              type="button"
              class="btn btn-danger"
              data-testid="import-overwrite"
              disabled={running === conflict.id}
              onClick={() => {
                const tree = conflict;
                setConflict(null);
                void importTree(tree);
              }}
            >
              上書きする
            </button>
            <button
              type="button"
              class="btn btn-primary"
              data-testid="import-copy"
              onClick={() => {
                const tree = { ...conflict, id: newTreeId(), name: `${conflict.name}（取り込み）` };
                setConflict(null);
                void importTree(tree);
              }}
            >
              別のツリーとして追加
            </button>
            <button type="button" class="btn" onClick={() => setConflict(null)}>
              やめる
            </button>
          </div>
          {running === conflict.id && <p class="muted">このツリーは生成中なので、上書きできません。</p>}
        </Dialog>
      )}
    </>
  );
}

/** 移し替えの結果の一言 */
function migrationText(note: { moved: number; leftover: number; failed?: boolean }): string {
  if (note.failed) {
    return `研究手順を、ツリーの外の置き場所に移せませんでした（研究手順 ${note.leftover} 本はツリーの中に残っていて、消えていません）。「気づきを送る」で知らせてください。`;
  }
  const parts = [`アプリの更新に合わせて、研究手順 ${note.moved} 本を「研究手順」の一覧に移しました`];
  if (note.leftover > 0) parts.push(`途中の局面から始まるツリーの研究手順 ${note.leftover} 本は移せませんでした（ツリーの中に残してあります）`);
  return `${parts.join('。')}。`;
}

/** グループ（見出しの ▼／▶・名前・件数と、開いていれば中身）。onMenu があれば見出しの右に ⋯ */
function GroupSection<T>({
  group: g,
  open,
  searching,
  onMenu,
  children,
}: {
  group: TreeGroup<T>;
  open: boolean;
  searching: boolean;
  onMenu?: () => void;
  children: preact.ComponentChildren;
}) {
  return (
    <section class="tree-group" data-testid="tree-group" data-key={g.key}>
      <div class="tree-group-row">
        <button
          type="button"
          class="tree-group-head"
          aria-expanded={open}
          data-testid="tree-group-head"
          disabled={searching}
          onClick={() => toggleGroup(g.key)}
        >
          <span class="tree-group-caret" aria-hidden="true">
            {open ? '▼' : '▶'}
          </span>
          <span class="tree-group-label">{g.label}</span>
          <span class="tree-group-count num" data-testid="tree-group-count">
            {g.items.length}
          </span>
        </button>
        {onMenu && (
          <button type="button" class="btn tree-group-menu" aria-label={`「${g.label}」の操作`} data-testid="study-group-menu-open" onClick={onMenu}>
            ⋯
          </button>
        )}
      </div>
      {open && <ul class="tree-list">{children}</ul>}
    </section>
  );
}

/** 研究手順の 1 行（★名前・メモの最初の 1 行・手数・日付）。タップで研究手順の画面 */
function StudyRow({ study, bookKey, onMenu }: { study: Study; bookKey: string; onMenu: () => void }) {
  const note = firstLine(study.note);
  return (
    <li class="tree-row">
      <button type="button" class="tree-item" data-testid="study-item" onClick={() => go(bookPath(bookKey, study.id, study.moves.length))}>
        <span class="tree-item-title">
          {/* ★ は名前の中に入れる（長い名前が折り返しても、★ だけの行にならないように） */}
          <span class="tree-item-name">
            <span class="study-star" aria-hidden="true">
              ★
            </span>
            {study.name}
          </span>
        </span>
        {note && (
          <span class="tree-item-meta study-item-note" data-testid="study-item-note">
            {note}
          </span>
        )}
        <span class="tree-item-meta num">
          {study.moves.length} 手・{formatShortDate(study.updatedAt)}
        </span>
      </button>
      <button type="button" class="btn tree-menu-btn" aria-label={`「${study.name}」の操作`} data-testid="study-menu" onClick={onMenu}>
        ⋯
      </button>
    </li>
  );
}

/** 研究手順の行の ⋯ のメニュー：この研究手順を復習・名前・メモを直す・書き出す（JSON・KIF）・消す（確認あり） */
function StudyMenu({ study, onClose, onDone }: { study: Study; onClose: () => void; onDone: (message: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [note, setNote] = useState('');

  async function save(f: { name: string; note: string; mySide: Study['mySide'] }) {
    await updateStudyFields(study, f);
    onDone(`研究手順「${f.name.trim()}」を直しました`);
  }

  async function remove() {
    await removeStudy(study.id);
    onDone(`研究手順「${study.name}」を消しました`);
  }

  async function share(kind: 'json' | 'kif') {
    const outcome = await shareStudies([study], kind);
    if (outcome !== 'cancelled') setNote(OUTCOME_TEXT[outcome]);
  }

  if (editing) {
    return (
      <StudyEditDialog
        study={study}
        defaultName={study.name}
        movesText={studyMovesText(study, allTemplates())}
        side={study.mySide}
        onSave={(f) => void save(f)}
        onClose={onClose}
      />
    );
  }
  return (
    <Dialog title={`★ ${study.name}`} onClose={onClose} testId="study-menu-dialog" sheet>
      <div class="dialog-actions dialog-actions-column">
        <button type="button" class="btn btn-primary" data-testid="study-menu-review" onClick={() => go(`/study-review/${study.id}`)}>
          復習
        </button>
        <button type="button" class="btn" data-testid="study-menu-edit" onClick={() => setEditing(true)}>
          名前・メモ
        </button>
        <button type="button" class="btn" data-testid="study-menu-json" onClick={() => void share('json')}>
          JSONで渡す
        </button>
        <button type="button" class="btn" data-testid="study-menu-kif" onClick={() => void share('kif')}>
          KIFで渡す
        </button>
      </div>
      <div class="dialog-actions">
        {!confirm ? (
          <button type="button" class="btn btn-danger" data-testid="study-menu-delete" onClick={() => setConfirm(true)}>
            消す…
          </button>
        ) : (
          <>
            <span>この研究手順を消しますか？元に戻せません（ツリーの手や局面は消えません）。</span>
            <button type="button" class="btn btn-danger" data-testid="study-menu-delete-ok" onClick={() => void remove()}>
              消す
            </button>
            <button type="button" class="btn" onClick={() => setConfirm(false)}>
              やめる
            </button>
          </>
        )}
      </div>
      {note && (
        <p class="muted" role="status">
          {note}
        </p>
      )}
    </Dialog>
  );
}

/** ツリーの 1 行（名前・印・自分の側と手順・日付と局面の数・⋯） */
function TreeRow({
  tree: t,
  running,
  onMenu,
  testId,
  dateText,
}: {
  tree: TreeSummary;
  running: boolean;
  onMenu: () => void;
  testId: string;
  /** 日付の欄（初期値は更新日） */
  dateText?: string;
}) {
  return (
    <li class="tree-row">
      <button type="button" class="tree-item" data-testid={testId} onClick={() => go(`/tree/${t.id}`)}>
        <span class="tree-item-title">
          <span class="tree-item-name">{t.name}</span>
          {t.source?.kind === 'bundled' && (
            <span class="chip chip-small chip-bundled" data-testid="bundled-chip">
              用意済み
            </span>
          )}
          {t.source?.kind === 'bundled' && (latestBundled(t.source.id)?.version ?? 0) > t.source.version && (
            <span class="chip chip-small chip-unverified" data-testid="bundled-newer-chip">
              新しい版あり
            </span>
          )}
        </span>
        <span class="tree-item-meta" data-testid="tree-item-position">
          自分：{t.mySide === 'black' ? '☗先手' : '☖後手'}・{t.prefixText}
        </span>
        <span class="tree-item-meta num">
          {dateText ?? formatDate(t.updatedAt)}・{t.nodeCount} 局面{running ? '・生成中' : ''}
        </span>
      </button>
      <button type="button" class="btn tree-menu-btn" aria-label={`「${t.name}」の操作`} data-testid="tree-menu" onClick={onMenu}>
        ⋯
      </button>
    </li>
  );
}

/** 一覧の ⋯ のメニュー：名前の変更・JSON で共有・削除 */
function TreeMenu({
  tree,
  generating,
  onClose,
  onDone,
}: {
  tree: TreeData;
  generating: boolean;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [name, setName] = useState(tree.name);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [note, setNote] = useState('');

  async function rename() {
    const trimmed = name.trim();
    if (!trimmed) {
      setNote('名前を入力してください');
      return;
    }
    // 開いている（生成中かもしれない）ツリーなら、そのものを書き換える（自動保存で元に戻らないように）
    const target = openTree.value?.id === tree.id ? openTree.value : tree;
    target.name = trimmed;
    await saveTree(target);
    if (openTree.value?.id === tree.id) openTree.value = target;
    treeVersion.value++;
    onDone('名前を変えました');
  }

  async function share() {
    const outcome = await shareFile(fileNameOf(tree.name, 'json'), treeToJson(tree), 'application/json');
    if (outcome !== 'cancelled') setNote(OUTCOME_TEXT[outcome]);
  }

  async function remove() {
    await deleteTree(tree.id);
    forgetOpened(tree.id);
    if (openTree.value?.id === tree.id) openTree.value = null;
    onDone(`「${tree.name}」を削除しました`);
  }

  return (
    <Dialog title="ツリーの操作" onClose={onClose} testId="tree-menu-dialog" sheet>
      <label class="form-field">
        <span>名前</span>
        <input type="text" value={name} maxLength={80} data-testid="rename-input" onInput={(e) => setName((e.target as HTMLInputElement).value)} />
      </label>
      <div class="dialog-actions">
        <button type="button" class="btn btn-primary" data-testid="rename-save" onClick={() => void rename()}>
          名前を保存
        </button>
      </div>
      <div class="dialog-actions">
        <button type="button" class="btn" data-testid="share-json" onClick={() => void share()}>
          JSONで渡す
        </button>
      </div>
      <div class="dialog-actions">
        {!confirmDelete ? (
          <button type="button" class="btn btn-danger" data-testid="delete-tree" disabled={generating} onClick={() => setConfirmDelete(true)}>
            削除…
          </button>
        ) : (
          <>
            <span>本当に削除しますか？元に戻せません。</span>
            <button type="button" class="btn btn-danger" data-testid="delete-confirm" onClick={() => void remove()}>
              削除する
            </button>
            <button type="button" class="btn" onClick={() => setConfirmDelete(false)}>
              やめる
            </button>
          </>
        )}
      </div>
      {generating && <p class="muted">生成中のツリーは削除できません。止めてから削除してください。</p>}
      {note && (
        <p class="muted" role="status">
          {note}
        </p>
      )}
    </Dialog>
  );
}

function formatDate(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 「今日 14:05」「昨日」「11/17」「2025/11/17」のような短い日付（最近開いた用） */
function formatShortDate(ms: number, now: number = Date.now()): string {
  const d = new Date(ms);
  const today = new Date(now);
  const pad = (n: number) => String(n).padStart(2, '0');
  const dayStart = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((dayStart(today) - dayStart(d)) / 86_400_000);
  if (days === 0) return `今日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (days === 1) return '昨日';
  if (d.getFullYear() === today.getFullYear()) return `${d.getMonth() + 1}/${d.getDate()}`;
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
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
