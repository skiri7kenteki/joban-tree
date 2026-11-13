// ツリーの閲覧画面（中心となる画面）。
// 上に盤面、下に「この局面の候補手リスト」。候補手をタップで 1 手進む。戻るボタン・左右スワイプで戻る/進む。
// 生成中も、できた枝からたどれる。

import { useEffect, useRef, useState } from 'preact/hooks';
import { Board } from '../components/Board';
import { formatScore, scoreToNumber, type Score } from '../engine/usi';
import { moveText } from '../shogi/position';
import { loadTree } from '../storage/trees';
import { FINISH_TEXT, countParents, isOpponentNode } from '../tree/generator';
import { LABEL_TEXT, labelOf } from '../tree/labels';
import type { TreeData, TreeEdge } from '../tree/types';
import { generation, openTree, stopGeneration, treeVersion } from './generation';
import { go } from './router';

export function TreeScreen({ id }: { id: string }) {
  const [error, setError] = useState('');
  const tree = openTree.value?.id === id ? openTree.value : null;

  useEffect(() => {
    if (tree) return;
    loadTree(id)
      .then((loaded) => {
        if (loaded) openTree.value = loaded;
        else setError('このツリーは見つかりませんでした');
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [id, tree]);

  if (error) return <p class="status-ng">{error}</p>;
  if (!tree) return <p class="muted">読み込み中…</p>;
  return <TreeView key={tree.id} tree={tree} />;
}

function TreeView({ tree }: { tree: TreeData }) {
  // 生成が進むたびに描き直す
  void treeVersion.value;
  /** 開始局面から今の局面までの、局面のキーの並び */
  const [path, setPath] = useState<string[]>([tree.rootKey]);
  /** 戻ったときに覚えておく「進む」先（スワイプで進む用） */
  const [forward, setForward] = useState<string[]>([]);
  const crumbsRef = useRef<HTMLDivElement>(null);

  const key = path[path.length - 1];
  const node = tree.nodes[key];
  const parents = countParents(tree);
  const opp = isOpponentNode(tree, node);
  const incoming = path.length > 1 ? edgeBetween(tree, path[path.length - 2], key) : undefined;
  const gen = generation.value?.treeId === tree.id ? generation.value : null;

  useEffect(() => {
    // パンくずリストは、今の局面が見えるよう右端までスクロール
    const el = crumbsRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [path.length]);

  function advance(edge: TreeEdge) {
    setPath([...path, edge.to]);
    setForward(forward[0] === edge.to ? forward.slice(1) : []);
  }
  function goBack() {
    if (path.length <= 1) return;
    setForward([key, ...forward]);
    setPath(path.slice(0, -1));
  }
  function goForward() {
    const next = forward[0] ?? node.edges[0]?.to;
    if (!next) return;
    const edge = node.edges.find((e) => e.to === next);
    if (edge) advance(edge);
  }
  function jumpTo(length: number) {
    if (length >= path.length) return;
    setForward([...path.slice(length), ...forward]);
    setPath(path.slice(0, length));
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
    if (dx > 0) goBack();
    else goForward();
  };

  const sideText = tree.mySide === 'black' ? '☗先手' : '☖後手';

  return (
    <>
      <div class="screen-header">
        <button type="button" class="btn btn-ghost" onClick={() => go('/')}>
          ‹ 一覧
        </button>
        <h1 class="tree-title">{tree.name}</h1>
      </div>

      {gen && <GenerationPanel />}

      <div class="tree-layout">
        <div class="tree-board" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
          <Board sfen={node.sfen} bottom={tree.mySide} lastMove={incoming?.move} />
        </div>

        <div class="tree-side">
          <div class="crumbs" ref={crumbsRef} data-testid="crumbs">
            <button type="button" class={path.length === 1 ? 'crumb current' : 'crumb'} onClick={() => jumpTo(1)}>
              開始局面
            </button>
            {path.slice(1).map((k, i) => {
              const from = tree.nodes[path[i]];
              const edge = edgeBetween(tree, path[i], k);
              const prev = i > 0 ? edgeBetween(tree, path[i - 1], path[i])?.move : undefined;
              return (
                <button
                  type="button"
                  key={`${i}-${k}`}
                  class={i + 2 === path.length ? 'crumb current' : 'crumb'}
                  data-testid="crumb"
                  onClick={() => jumpTo(i + 2)}
                >
                  {edge ? moveText(from.sfen, edge.move, prev) : '?'}
                </button>
              );
            })}
          </div>

          <div class="nav-row">
            <button type="button" class="btn" data-testid="nav-back" onClick={goBack} disabled={path.length <= 1}>
              ‹ 1手戻る
            </button>
            <button type="button" class="btn" onClick={() => jumpTo(1)} disabled={path.length <= 1}>
              開始局面へ
            </button>
          </div>

          <div class="card candidates">
            <div class="candidates-head">
              <strong>{opp ? '相手の応手' : '自分の対応'}</strong>
              <span class="muted">評価値は自分（{sideText}）から見た値</span>
            </div>
            {node.edges.length === 0 && <EmptyNote tree={tree} nodeKey={key} generating={gen !== null && gen.phase !== 'done'} />}
            <ul class="candidate-list">
              {node.edges.map((edge) => (
                <li key={edge.move}>
                  <button type="button" class="candidate" data-testid="candidate" onClick={() => advance(edge)}>
                    <span class="candidate-move">{moveText(node.sfen, edge.move, incoming?.move)}</span>
                    <ScoreText score={edge.score} />
                    <span class="candidate-tags">
                      {edge.diff !== undefined && <LabelChip diff={edge.diff} />}
                      {edge.unverified && <span class="chip chip-unverified">未検証</span>}
                      {(parents.get(edge.to) ?? 0) > 1 && <span class="chip chip-merge">合流</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </>
  );
}

/** 生成の進み具合と停止ボタン */
function GenerationPanel() {
  const gen = generation.value!;
  const [, setTick] = useState(0);
  // 経過時間を 1 秒ごとに更新
  useEffect(() => {
    if (gen.phase === 'done') return;
    const timer = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(timer);
  }, [gen.phase]);

  if (gen.phase === 'done') {
    return (
      <div class={gen.error ? 'gen-panel gen-error' : 'gen-panel'} data-testid="gen-status" data-phase="done">
        <span>
          {gen.finish ? FINISH_TEXT[gen.finish] : '終わりました'}
          {gen.progress && `（調べた局面 ${gen.progress.searched}・全部で ${gen.progress.nodeCount} 局面）`}
        </span>
        {gen.error && <span class="gen-error-text">{gen.error}</span>}
      </div>
    );
  }

  const elapsed = gen.runStartedAt ? Math.floor((Date.now() - gen.runStartedAt) / 1000) : 0;
  const total = Math.round(gen.settings.totalMs / 1000);
  return (
    <div class="gen-panel" data-testid="gen-status" data-phase={gen.phase}>
      <span class="num">
        {gen.phase === 'engine'
          ? 'エンジンを準備中…'
          : `生成中 ${Math.min(elapsed, total)}秒／${total}秒・調べた局面 ${gen.progress?.searched ?? 0}・${gen.progress?.round ?? 1}往復目`}
      </span>
      <button type="button" class="btn btn-danger" data-testid="gen-stop" onClick={stopGeneration}>
        停止
      </button>
      <progress max={gen.settings.totalMs} value={gen.phase === 'engine' ? undefined : Math.min(elapsed * 1000, gen.settings.totalMs)} />
    </div>
  );
}

/** 候補手が無いときの説明 */
function EmptyNote({ tree, nodeKey, generating }: { tree: TreeData; nodeKey: string; generating: boolean }) {
  const node = tree.nodes[nodeKey];
  let text = 'この局面はまだ調べていません。';
  if (node.terminal) text = '指せる手がありません（詰み・投了など）。';
  else if (generating) text = 'この局面はこれから調べます。';
  return <p class="muted">{text}</p>;
}

function ScoreText({ score }: { score: Score }) {
  const n = scoreToNumber(score);
  const cls = n >= 50 ? 'eval-good' : n <= -50 ? 'eval-bad' : 'eval-even';
  return <span class={`candidate-score num ${cls}`}>{formatScore(score)}</span>;
}

function LabelChip({ diff }: { diff: number }) {
  const label = labelOf(diff);
  return <span class={`chip chip-${label}`}>{LABEL_TEXT[label]}</span>;
}

/** 局面 from から局面 to への矢印 */
function edgeBetween(tree: TreeData, from: string, to: string): TreeEdge | undefined {
  return tree.nodes[from]?.edges.find((e) => e.to === to);
}
