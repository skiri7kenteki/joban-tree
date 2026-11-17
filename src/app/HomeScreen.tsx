// トップ画面：新しいツリーを作るボタン、保存してあるツリーの一覧（名前の変更・共有・削除）、ファイルからの取り込み。
// 段階7-1：ツリーを「戦型のグループ × 自分の側」でまとめる（開閉でき、状態は端末に覚える）。名前で絞り込む。最近開いた 3 件。
// 段階7-2：「ツリー｜研究手順」の切り替え。研究手順も同じグループでまとめ、タップでそのツリーのその局面を開く。絞り込みは研究手順の名前・メモにも当てる。
//          研究手順の行の ⋯ から、名前・メモを直す・消す（確認あり）（持ち主の依頼 2026-11-17）。

import { useEffect, useRef, useState } from 'preact/hooks';
import { Dialog } from '../components/Dialog';
import { deleteTree, listTrees, loadTree, newTreeId, saveTree, type StudySummary, type TreeSummary } from '../storage/trees';
import { fileNameOf, parseTreeJson, treeToJson } from '../tree/backup';
import { latestBundled } from '../tree/bundledCatalog';
import { RECENT_MIN_TREES, filterByName, groupStudies, groupTrees, normalizeForSearch, recentItems, type TreeGroup } from '../tree/organize';
import { defaultStudyName, firstLine, removeStudy, updateStudy } from '../tree/studies';
import type { Study, TreeData } from '../tree/types';
import { generation, isGenerating, openTree, saveEdited, treeVersion } from './generation';
import { collapsedGroups, forgetOpened, homeTab, recentOpened, setHomeTab, toggleGroup } from './recent';
import { go } from './router';
import { OUTCOME_TEXT, shareFile } from './share';
import { allTemplates, myTemplates, refreshMyTemplates } from './TemplateDialogs';
import { StudyEditDialog } from './StudyDialogs';

export function HomeScreen({ isolationMessage }: { isolationMessage: string | null }) {
  const [trees, setTrees] = useState<TreeSummary[] | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  /** 一覧を読み直す合図 */
  const [reload, setReload] = useState(0);
  /** ⋯ を押したツリー（メニューを出す） */
  const [menuTree, setMenuTree] = useState<TreeData | null>(null);
  /** ⋯ を押した研究手順（直す・消すのメニューを出す） */
  const [menuStudy, setMenuStudy] = useState<{ tree: TreeData; study: Study } | null>(null);
  /** 取り込もうとしたツリーが既にあるとき */
  const [conflict, setConflict] = useState<TreeData | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  /** 名前で絞り込む文字 */
  const [query, setQuery] = useState('');
  // 生成が進んだら一覧（局面の数）も新しくする
  const version = treeVersion.value;
  // 自分で登録した戦型も、グループ分けに使う（読み込んだら描き直す）
  void myTemplates.value;
  useEffect(() => {
    if (!myTemplates.value) void refreshMyTemplates().catch(() => undefined);
  }, []);

  useEffect(() => {
    listTrees()
      .then(setTrees)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [version, reload]);

  const running = isGenerating() ? generation.value!.treeId : null;
  const searching = normalizeForSearch(query) !== '';
  const tab = homeTab.value;
  const groups = trees ? groupTrees(filterByName(trees, query), allTemplates()) : [];
  const studyGroups = trees ? groupStudies(trees, allTemplates(), query) : [];
  const studyCount = trees?.reduce((n, t) => n + t.studies.length, 0) ?? 0;
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

  async function openStudyMenu(treeId: string, studyId: string) {
    setMessage('');
    // 開いている（生成中かもしれない）ツリーなら、そのものを書き換える（自動保存で元に戻らないように）
    const tree = openTree.value?.id === treeId ? openTree.value : await loadTree(treeId);
    const study = tree?.studies?.find((s) => s.id === studyId);
    if (tree && study) setMenuStudy({ tree, study });
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
      await saveTree(tree);
      if (openTree.value?.id === tree.id) openTree.value = tree;
      setMessage(`「${tree.name}」を取り込みました`);
    } catch (e) {
      setMessage(`取り込めませんでした（${e instanceof Error ? e.message : String(e)}）`);
    }
    setReload((n) => n + 1);
  }

  return (
    <>
      <div class="screen-header">
        <h1>序盤ツリー</h1>
        <span class="spacer" />
        <button type="button" class="btn btn-ghost" data-testid="open-settings" onClick={() => go('/settings')}>
          設定
        </button>
      </div>
      {isolationMessage && <p class="notice notice-danger">{isolationMessage}</p>}
      <div class="btn-row">
        <button type="button" class="btn btn-primary btn-wide" data-testid="new-tree" onClick={() => go('/new')}>
          ＋ 新しいツリーを作る
        </button>
      </div>

      {trees && trees.length > 0 && (
        <>
          <div class="home-tabs" role="tablist" aria-label="一覧の切り替え">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'trees'}
              class={tab === 'trees' ? 'home-tab on' : 'home-tab'}
              data-testid="tab-trees"
              onClick={() => setHomeTab('trees')}
            >
              ツリー <span class="num">{trees.length}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'studies'}
              class={tab === 'studies' ? 'home-tab on' : 'home-tab'}
              data-testid="tab-studies"
              onClick={() => setHomeTab('studies')}
            >
              研究手順 <span class="num">{studyCount}</span>
            </button>
          </div>
          <input
            type="search"
            class="home-filter"
            placeholder={tab === 'trees' ? '名前で絞り込む…（研究手順の名前・メモも）' : '名前・メモで絞り込む…'}
            aria-label="名前で絞り込む"
            data-testid="tree-filter"
            value={query}
            onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
          />
        </>
      )}

      {error && <p class="status-ng">{error}</p>}
      {message && (
        <p class="muted" role="status" data-testid="home-message">
          {message}
        </p>
      )}
      {trees === null && !error && <p class="muted">読み込み中…</p>}
      {trees?.length === 0 && <p class="muted">まだありません。「新しいツリーを作る」から始めてください。</p>}

      {tab === 'trees' || !trees || trees.length === 0 ? (
        <>
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

          {trees && trees.length > 0 && <h2>保存したツリー</h2>}
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
      ) : (
        <>
          {studyCount === 0 && (
            <p class="muted" data-testid="studies-empty">
              研究手順はまだありません。ツリーの閲覧画面で、気になる局面まで進めて「この手順を研究として保存」を押すと、ここに出ます。
            </p>
          )}
          {searching && studyCount > 0 && studyGroups.length === 0 && (
            <p class="muted" data-testid="filter-empty">
              「{query.trim()}」に当てはまる研究手順はありません。
            </p>
          )}
          {studyGroups.map((g) => (
            <GroupSection key={g.key} group={g} open={searching || !collapsed.includes(g.key)} searching={searching}>
              {g.items.map((x) => (
                <StudyRow key={x.study.id} study={x.study} treeId={x.treeId} treeName={x.treeName} onMenu={() => void openStudyMenu(x.treeId, x.study.id)} />
              ))}
            </GroupSection>
          ))}
        </>
      )}

      <div class="btn-row home-import">
        <button type="button" class="btn" data-testid="import-json" onClick={() => fileRef.current?.click()}>
          ファイルから取り込む（JSON）
        </button>
        <input ref={fileRef} type="file" accept=".json,application/json" hidden data-testid="import-file" onChange={(e) => void onFile(e)} />
      </div>
      <p class="muted">仲間から受け取ったツリー（このアプリで書き出した JSON）を開けます。</p>

      {menuStudy && (
        <StudyMenu
          tree={menuStudy.tree}
          study={menuStudy.study}
          onClose={() => setMenuStudy(null)}
          onDone={(text) => {
            setMenuStudy(null);
            setMessage(text);
            setReload((n) => n + 1);
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

/** グループ（見出しの ▼／▶・名前・件数と、開いていれば中身） */
function GroupSection<T>({ group: g, open, searching, children }: { group: TreeGroup<T>; open: boolean; searching: boolean; children: preact.ComponentChildren }) {
  return (
    <section class="tree-group" data-testid="tree-group" data-key={g.key}>
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
      {open && <ul class="tree-list">{children}</ul>}
    </section>
  );
}

/** 研究手順の 1 行（名前・メモの最初の 1 行・属するツリーの名前・日付）。タップでそのツリーのその局面を開く */
function StudyRow({ study, treeId, treeName, onMenu }: { study: StudySummary; treeId: string; treeName: string; onMenu: () => void }) {
  const note = firstLine(study.note);
  return (
    <li class="tree-row">
      <button type="button" class="tree-item" data-testid="study-item" onClick={() => go(`/tree/${treeId}/study/${study.id}`)}>
        <span class="tree-item-title">
          <span class="study-star" aria-hidden="true">
            ★
          </span>
          <span class="tree-item-name">{study.name}</span>
          {study.reached < study.total && (
            <span class="chip chip-small chip-unverified" data-testid="study-broken">
              途中まで
            </span>
          )}
        </span>
        {note && (
          <span class="tree-item-meta study-item-note" data-testid="study-item-note">
            {note}
          </span>
        )}
        <span class="tree-item-meta">
          {treeName}・{formatShortDate(study.updatedAt)}
        </span>
      </button>
      <button type="button" class="btn tree-menu-btn" aria-label={`「${study.name}」の操作`} data-testid="study-menu" onClick={onMenu}>
        ⋯
      </button>
    </li>
  );
}

/** 研究手順の行の ⋯ のメニュー：名前・メモを直す・消す（確認あり。ツリーの手や局面は消さない） */
function StudyMenu({ tree, study, onClose, onDone }: { tree: TreeData; study: Study; onClose: () => void; onDone: (message: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(false);

  async function save(f: { name: string; note: string }) {
    updateStudy(tree, study.id, f, Date.now());
    await saveEdited(tree);
    onDone(`研究手順「${f.name.trim()}」を直しました`);
  }

  async function remove() {
    removeStudy(tree, study.id);
    await saveEdited(tree);
    onDone(`研究手順「${study.name}」を消しました`);
  }

  if (editing) {
    return (
      <StudyEditDialog
        study={study}
        defaultName={study.name}
        movesText={defaultStudyName(tree, study.moves, Infinity)}
        onSave={(f) => void save(f)}
        onClose={onClose}
      />
    );
  }
  return (
    <Dialog title={`★ ${study.name}`} onClose={onClose} testId="study-menu-dialog">
      <p class="muted">{tree.name}</p>
      <div class="dialog-actions dialog-actions-column">
        <button type="button" class="btn btn-primary" data-testid="study-menu-edit" onClick={() => setEditing(true)}>
          名前・メモを直す
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
    <Dialog title="ツリーの操作" onClose={onClose} testId="tree-menu-dialog">
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
          ファイルで渡す（JSON）
        </button>
      </div>
      <p class="muted">受け取った人は、このアプリの「ファイルから取り込む」で開けます。</p>
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
