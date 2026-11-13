// トップ画面：新しいツリーを作るボタンと、保存してあるツリーの一覧。

import { useEffect, useState } from 'preact/hooks';
import { listTrees, type TreeSummary } from '../storage/trees';
import { generation, treeVersion } from './generation';
import { go } from './router';

export function HomeScreen({ isolationMessage }: { isolationMessage: string | null }) {
  const [trees, setTrees] = useState<TreeSummary[] | null>(null);
  const [error, setError] = useState('');
  // 生成が進んだら一覧（局面の数）も新しくする
  const version = treeVersion.value;

  useEffect(() => {
    listTrees()
      .then(setTrees)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [version]);

  const running = generation.value && generation.value.phase !== 'done' ? generation.value.treeId : null;

  return (
    <>
      <h1>序盤ツリー</h1>
      {isolationMessage && <p class="notice notice-danger">{isolationMessage}</p>}
      <div class="btn-row">
        <button type="button" class="btn btn-primary btn-wide" data-testid="new-tree" onClick={() => go('/new')}>
          ＋ 新しいツリーを作る
        </button>
      </div>

      <h2>保存したツリー</h2>
      {error && <p class="status-ng">{error}</p>}
      {trees === null && !error && <p class="muted">読み込み中…</p>}
      {trees?.length === 0 && <p class="muted">まだありません。「新しいツリーを作る」から始めてください。</p>}
      <ul class="tree-list">
        {trees?.map((t) => (
          <li key={t.id}>
            <button type="button" class="tree-item" data-testid="tree-item" onClick={() => go(`/tree/${t.id}`)}>
              <span class="tree-item-name">{t.name}</span>
              <span class="tree-item-meta num">
                {formatDate(t.updatedAt)}・{t.nodeCount} 局面{running === t.id ? '・生成中' : ''}
              </span>
            </button>
          </li>
        ))}
      </ul>

      <p class="muted home-links">
        <a href={`${import.meta.env.BASE_URL}bench.html`}>エンジンの速度測定</a>
      </p>
    </>
  );
}

function formatDate(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
