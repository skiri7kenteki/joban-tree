// トップ画面：新しいツリーを作るボタン、保存してあるツリーの一覧（名前の変更・共有・削除）、ファイルからの取り込み。

import { useEffect, useRef, useState } from 'preact/hooks';
import { Dialog } from '../components/Dialog';
import { deleteTree, listTrees, loadTree, newTreeId, saveTree, type TreeSummary } from '../storage/trees';
import { fileNameOf, parseTreeJson, treeToJson } from '../tree/backup';
import type { TreeData } from '../tree/types';
import { generation, isGenerating, openTree, treeVersion } from './generation';
import { go } from './router';
import { OUTCOME_TEXT, shareFile } from './share';

export function HomeScreen({ isolationMessage }: { isolationMessage: string | null }) {
  const [trees, setTrees] = useState<TreeSummary[] | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  /** 一覧を読み直す合図 */
  const [reload, setReload] = useState(0);
  /** ⋯ を押したツリー（メニューを出す） */
  const [menuTree, setMenuTree] = useState<TreeData | null>(null);
  /** 取り込もうとしたツリーが既にあるとき */
  const [conflict, setConflict] = useState<TreeData | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // 生成が進んだら一覧（局面の数）も新しくする
  const version = treeVersion.value;

  useEffect(() => {
    listTrees()
      .then(setTrees)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [version, reload]);

  const running = isGenerating() ? generation.value!.treeId : null;

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

      <h2>保存したツリー</h2>
      {error && <p class="status-ng">{error}</p>}
      {message && (
        <p class="muted" role="status" data-testid="home-message">
          {message}
        </p>
      )}
      {trees === null && !error && <p class="muted">読み込み中…</p>}
      {trees?.length === 0 && <p class="muted">まだありません。「新しいツリーを作る」から始めてください。</p>}
      <ul class="tree-list">
        {trees?.map((t) => (
          <li key={t.id} class="tree-row">
            <button type="button" class="tree-item" data-testid="tree-item" onClick={() => go(`/tree/${t.id}`)}>
              <span class="tree-item-name">{t.name}</span>
              <span class="tree-item-meta" data-testid="tree-item-position">
                自分：{t.mySide === 'black' ? '☗先手' : '☖後手'}・{t.prefixText}
              </span>
              <span class="tree-item-meta num">
                {formatDate(t.updatedAt)}・{t.nodeCount} 局面{running === t.id ? '・生成中' : ''}
              </span>
            </button>
            <button type="button" class="btn tree-menu-btn" aria-label={`「${t.name}」の操作`} data-testid="tree-menu" onClick={() => void openMenu(t.id)}>
              ⋯
            </button>
          </li>
        ))}
      </ul>

      <div class="btn-row home-import">
        <button type="button" class="btn" data-testid="import-json" onClick={() => fileRef.current?.click()}>
          ファイルから取り込む（JSON）
        </button>
        <input ref={fileRef} type="file" accept=".json,application/json" hidden data-testid="import-file" onChange={(e) => void onFile(e)} />
      </div>
      <p class="muted">仲間から受け取ったツリー（このアプリで書き出した JSON）を開けます。</p>

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
