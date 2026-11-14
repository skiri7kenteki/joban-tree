// ツリーの閲覧画面（中心となる画面）。
// 上に盤面、下に「この局面の候補手リスト」。候補手をタップで 1 手進む。戻るボタン・左右スワイプで戻る/進む。
// 段階4：スマホ縦で「盤＋候補手 3 つ」が 1 画面に収まるよう詰めた。相手の応手の行には自分の対応と枝の先の様子を併記する。
// 段階4-3：相手の応手の行の「⋯」から「この手を除外」。除外した手はリストの下に畳み、「戻す」で戻せる。
// 生成中も、できた枝からたどれる。
// 局面ごとの操作：「ここから展開」「この手を検証」「KIF をコピー」、ツリーの書き出し・共有。

import { useEffect, useRef, useState } from 'preact/hooks';
import { Board } from '../components/Board';
import { Dialog } from '../components/Dialog';
import { formatScore, scoreToNumber, type Score } from '../engine/usi';
import { moveText } from '../shogi/position';
import { loadTree } from '../storage/trees';
import { fileNameOf, treeToJson } from '../tree/backup';
import { FINISH_TEXT, countParents, excludeMove, isAfterDubiousOnly, isOpponentNode, restoreMove } from '../tree/generator';
import { pathToKif, treeToKif } from '../tree/kif';
import { branchInfo, branchText, lastPrefixMove, replyOf } from '../tree/browse';
import { LABEL_TEXT, labelOf } from '../tree/labels';
import type { PresetId } from '../tree/presets';
import { availablePresets } from './engineService';
import type { TreeData, TreeEdge } from '../tree/types';
import { generation, isGenerating, openTree, saveEdited, startGeneration, startResample, startVerify, stopGeneration, treeVersion } from './generation';
import { go } from './router';
import { generationSettingsFor, presetLabel, settings } from './settings';
import { OUTCOME_TEXT, copyText, shareFile } from './share';


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
  /** 開いている小窓（ここから展開・書き出し） */
  const [dialog, setDialog] = useState<'expand' | 'export' | null>(null);
  /** 「⋯」を押した候補手（手のメニューを出す） */
  const [menuEdge, setMenuEdge] = useState<TreeEdge | null>(null);
  /** 除外した手の欄を開いているか */
  const [showExcluded, setShowExcluded] = useState(false);
  /** 操作の結果（「コピーしました」など） */
  const [note, setNote] = useState('');
  const crumbsRef = useRef<HTMLDivElement>(null);
  const thresholds = settings.value.thresholds;

  const key = path[path.length - 1];
  const node = tree.nodes[key];
  const parents = countParents(tree);
  const opp = isOpponentNode(tree, node);
  const incoming = path.length > 1 ? edgeBetween(tree, path[path.length - 2], key) : undefined;
  const gen = generation.value?.treeId === tree.id ? generation.value : null;
  const busy = isGenerating();
  // 「この手を検証」は、まだ調べていない自分の手番の局面だけ
  const canVerify = !opp && !node.searched && !node.terminal;

  useEffect(() => {
    // パンくずリストは、今の局面が見えるよう右端までスクロール
    const el = crumbsRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [path.length]);

  function advance(edge: TreeEdge) {
    setPath([...path, edge.to]);
    setForward(forward[0] === edge.to ? forward.slice(1) : []);
    setNote('');
  }
  function goBack() {
    if (path.length <= 1) return;
    setForward([key, ...forward]);
    setPath(path.slice(0, -1));
    setNote('');
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
    setNote('');
  }

  function expand(id: PresetId) {
    setDialog(null);
    setNote('');
    void startGeneration(tree, generationSettingsFor(id), key);
  }
  function verify() {
    setNote('');
    void startVerify(tree, key, settings.value.verifyMs);
  }
  /** 相手の応手を除外して、この局面を調べ直す（候補を補い、ラベルを付け直す） */
  async function exclude(edge: TreeEdge) {
    setMenuEdge(null);
    if (isGenerating() || !excludeMove(node, edge.move)) return;
    setForward([]);
    setNote('');
    await saveEdited(tree);
    void startResample(tree, key);
  }
  /** 除外した手を戻す（調べ直しはしない。ラベルは付け直す） */
  async function restore(edge: TreeEdge) {
    if (isGenerating() || !restoreMove(node, edge.move)) return;
    setNote('');
    await saveEdited(tree);
  }
  async function copyKif() {
    const ok = await copyText(pathToKif(tree, path, thresholds));
    setNote(ok ? 'この局面までの KIF をコピーしました。iShogi などの「クリップボードから読み込み」で貼り付けられます。' : 'コピーできませんでした');
  }
  async function exportAs(kind: 'tree-kif' | 'path-kif' | 'json') {
    // 共有メニューは「押した直後」でないと出ないので、ファイルの中身はここで（待たずに）作る
    const outcome =
      kind === 'json'
        ? await shareFile(fileNameOf(tree.name, 'json'), treeToJson(tree), 'application/json')
        : await shareFile(
            fileNameOf(kind === 'tree-kif' ? tree.name : `${tree.name}_手順`, 'kifu'),
            kind === 'tree-kif' ? treeToKif(tree, thresholds) : pathToKif(tree, path, thresholds),
            'text/plain',
          );
    if (outcome !== 'cancelled') {
      setDialog(null);
      setNote(OUTCOME_TEXT[outcome]);
    }
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
        <button type="button" class="btn" data-testid="review-open" onClick={() => go(`/review/${tree.id}`)}>
          復習
        </button>
      </div>

      {gen && <GenerationPanel tree={tree} />}

      <div class="tree-layout">
        <div class="tree-board" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
          <Board sfen={node.sfen} lastMove={path.length > 1 ? incoming?.move : lastPrefixMove(tree)} />
        </div>

        <div class="tree-side">
          {/* 1 手戻る＋手順のパンくずリストを 1 行に（「開始局面」のパンくずで開始局面へ戻る） */}
          <div class="crumb-row">
            <button type="button" class="crumb crumb-back" data-testid="nav-back" onClick={goBack} disabled={path.length <= 1} aria-label="1手戻る">
              ‹
            </button>
            <div class="crumbs" ref={crumbsRef} data-testid="crumbs">
              <button type="button" class={path.length === 1 ? 'crumb current' : 'crumb'} data-testid="crumb-start" onClick={() => jumpTo(1)}>
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
          </div>

          <div class="card candidates">
            <div class="candidates-head">
              <strong>{opp ? '相手の応手' : '自分の対応'}</strong>
              {/* 1 行に収める（スマホ縦で候補手を上に寄せるため） */}
              <span class="muted">評価値は{opp ? '対応の後・' : ''}{sideText}から見た値</span>
            </div>
            {node.edges.length === 0 && <EmptyNote tree={tree} nodeKey={key} generating={busy} />}
            <ul class="candidate-list">
              {node.edges.map((edge) => {
                // 相手の応手の行は、自分の対応の後の評価値を主に見せる（まだ対応が無ければ応手の評価値）
                const reply = opp ? replyOf(tree, edge) : undefined;
                const info = branchInfo(tree, edge);
                return (
                  <li key={edge.move} class="candidate-item">
                    <button type="button" class="candidate" data-testid="candidate" onClick={() => advance(edge)}>
                      <span class="candidate-line">
                        <span class="candidate-move">{moveText(node.sfen, edge.move, incoming?.move)}</span>
                        {opp && edge.diff !== undefined && <LabelChip diff={edge.diff} />}
                        {!opp && <MineChip verified={!edge.unverified} searched={node.searched !== undefined} />}
                        {(parents.get(edge.to) ?? 0) > 1 && <span class="chip chip-merge">合流</span>}
                        <ScoreText score={reply?.score ?? edge.score} />
                      </span>
                      <span class="candidate-line candidate-sub">
                        {opp && <ReplyText tree={tree} edge={edge} reply={reply} />}
                        {(!opp || reply) && (
                          <span class={`candidate-ahead ahead-${info.kind}`} data-testid="candidate-ahead">
                            {branchText(info)}
                          </span>
                        )}
                      </span>
                    </button>
                    {opp && (
                      <button
                        type="button"
                        class="candidate-menu"
                        data-testid="candidate-menu"
                        aria-label={`${moveText(node.sfen, edge.move, incoming?.move)} の操作`}
                        onClick={() => setMenuEdge(edge)}
                      >
                        ⋯
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
            {node.excluded && node.excluded.length > 0 && (
              <div class="excluded-box" data-testid="excluded-box">
                <button
                  type="button"
                  class="excluded-toggle"
                  data-testid="excluded-toggle"
                  aria-expanded={showExcluded}
                  onClick={() => setShowExcluded(!showExcluded)}
                >
                  除外した手（{node.excluded.length}）{showExcluded ? '▾' : '▸'}
                </button>
                {showExcluded && (
                  <ul class="excluded-list">
                    {node.excluded.map((edge) => (
                      <li key={edge.move} class="excluded-item" data-testid="excluded-item">
                        <span class="candidate-move">{moveText(node.sfen, edge.move, incoming?.move)}</span>
                        <span class="muted">調べません</span>
                        <button type="button" class="btn btn-ghost" data-testid="excluded-restore" disabled={busy} onClick={() => void restore(edge)}>
                          戻す
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          {/* 局面ごとの操作（主役の候補手リストを先に見せるため、その下に置く） */}
          <div class="node-actions">
            <button type="button" class="btn" data-testid="expand-here" onClick={() => setDialog('expand')} disabled={busy || node.terminal}>
              ここから展開
            </button>
            {canVerify && (
              <button type="button" class="btn" data-testid="verify-here" onClick={verify} disabled={busy}>
                この手を検証
              </button>
            )}
            <button type="button" class="btn" data-testid="copy-kif" onClick={() => void copyKif()}>
              KIFをコピー
            </button>
            <button type="button" class="btn" data-testid="export-open" onClick={() => setDialog('export')}>
              書き出し・共有
            </button>
          </div>
          {note && (
            <p class="muted" role="status" data-testid="tree-note">
              {note}
            </p>
          )}
        </div>
      </div>

      {dialog === 'expand' && (
        <Dialog title="ここから展開" onClose={() => setDialog(null)} testId="expand-dialog">
          <p>この局面から先の、まだ調べていない枝を広げます。今あるツリーに枝を足します。</p>
          <div class="dialog-actions dialog-actions-column">
            {availablePresets().map((id) => (
              <button type="button" key={id} class="btn btn-primary" data-testid={`expand-${id}`} onClick={() => expand(id)}>
                {presetLabel(id)}
              </button>
            ))}
          </div>
        </Dialog>
      )}

      {menuEdge && (
        <Dialog title={moveText(node.sfen, menuEdge.move, incoming?.move)} onClose={() => setMenuEdge(null)} testId="move-menu">
          <p>
            人があまり指さない手などを除外すると、この局面を調べ直して（約{Math.round(tree.settings.movetimeMs / 100) / 10}秒）代わりの候補を補います。
            除外した手は、調べ直しても「ここから展開」しても採用しません。リストの下の「除外した手」から戻せます。
          </p>
          <div class="dialog-actions dialog-actions-column">
            <button type="button" class="btn btn-primary" data-testid="exclude-move" disabled={busy} onClick={() => void exclude(menuEdge)}>
              この手を除外
            </button>
          </div>
          {busy && <p class="muted">生成中は除外できません。止めてから除外してください。</p>}
        </Dialog>
      )}

      {dialog === 'export' && (
        <Dialog title="書き出し・共有" onClose={() => setDialog(null)} testId="export-dialog">
          <div class="dialog-actions dialog-actions-column">
            <button type="button" class="btn" data-testid="export-tree-kif" onClick={() => void exportAs('tree-kif')}>
              分岐付き KIF（ツリー全体）
            </button>
            <button type="button" class="btn" data-testid="export-path-kif" onClick={() => void exportAs('path-kif')}>
              この局面までの手順の KIF
            </button>
            <button type="button" class="btn" data-testid="export-json" onClick={() => void exportAs('json')}>
              JSON（このアプリ用。仲間に渡す・バックアップ）
            </button>
          </div>
          <p class="muted">
            iPad では共有メニューの「"ファイル"に保存」で保存できます。共有メニューが出ない端末では、ファイルをダウンロードします。
          </p>
        </Dialog>
      )}
    </>
  );
}

/** 生成の進み具合と停止ボタン */
function GenerationPanel({ tree }: { tree: TreeData }) {
  const gen = generation.value!;
  const [, setTick] = useState(0);
  // 経過時間を 1 秒ごとに更新
  useEffect(() => {
    if (gen.phase === 'done') return;
    const timer = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(timer);
  }, [gen.phase]);

  const where = gen.startKey === tree.rootKey ? '' : '（途中の局面から）';

  if (gen.phase === 'done') {
    let text: string;
    if (gen.kind === 'verify') {
      text = gen.finish === 'completed' ? '検証しました（自分の対応のいちばん上が、確定した手です）' : FINISH_TEXT[gen.finish ?? 'stopped'];
    } else if (gen.kind === 'resample') {
      text =
        gen.finish === 'completed'
          ? '除外した手のほかに候補を補いました（ラベルは残った手の中の最善手から付け直しました）'
          : FINISH_TEXT[gen.finish ?? 'stopped'];
    } else {
      text = `${gen.finish ? FINISH_TEXT[gen.finish] : '終わりました'}${where}`;
      if (gen.progress) text += `（調べた局面 ${gen.progress.searched}・全部で ${gen.progress.nodeCount} 局面）`;
    }
    return (
      <div class={gen.error ? 'gen-panel gen-error' : 'gen-panel'} data-testid="gen-status" data-phase="done" data-kind={gen.kind}>
        <span>{text}</span>
        {gen.error && <span class="gen-error-text">{gen.error}</span>}
      </div>
    );
  }

  const elapsed = gen.runStartedAt ? Math.floor((Date.now() - gen.runStartedAt) / 1000) : 0;
  const total = Math.round(gen.settings.totalMs / 1000);
  let text: string;
  if (gen.phase === 'engine') text = 'エンジンを準備中…';
  else if (gen.kind === 'verify') text = `検証中（${total}秒）…`;
  else if (gen.kind === 'resample') text = `調べ直し中（${total}秒）…`;
  else text = `生成中${where} ${Math.min(elapsed, total)}秒／${total}秒・調べた局面 ${gen.progress?.searched ?? 0}・${gen.progress?.round ?? 1}往復目`;
  return (
    <div class="gen-panel" data-testid="gen-status" data-phase={gen.phase} data-kind={gen.kind}>
      <span class="num">{text}</span>
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
  let text = 'この局面はまだ調べていません。「ここから展開」で調べられます。';
  if (!isOpponentNode(tree, node)) text = '自分の手はまだ調べていません。「この手を検証」か「ここから展開」で調べられます。';
  if (node.terminal) text = '指せる手がありません（詰み・投了など）。';
  else if (isOpponentNode(tree, node) && isAfterDubiousOnly(tree, nodeKey))
    text = '相手の疑問手を咎めた後の局面なので、この先は調べていません（疑問手の先は浅くしています）。必要なら「ここから展開」で調べられます。';
  else if (generating) text = 'この局面はこれから調べます。';
  return (
    <p class="muted" data-testid="empty-note">
      {text}
    </p>
  );
}

/** 相手の応手の行の 2 段目：「→ ▲２六歩」（自分の対応）。まだ無ければ「→ 未展開」 */
function ReplyText({ tree, edge, reply }: { tree: TreeData; edge: TreeEdge; reply: TreeEdge | undefined }) {
  const me = tree.nodes[edge.to];
  if (!reply) {
    return (
      <span class="candidate-reply muted" data-testid="candidate-reply">
        {me?.terminal ? '→ 指せる手なし' : '→ 未展開'}
      </span>
    );
  }
  return (
    <span class="candidate-reply" data-testid="candidate-reply">
      → {moveText(me.sfen, reply.move, edge.move)}
      {reply.unverified && <span class="chip chip-unverified chip-small">未検証</span>}
    </span>
  );
}

function ScoreText({ score }: { score: Score }) {
  const n = scoreToNumber(score);
  const cls = n >= 50 ? 'eval-good' : n <= -50 ? 'eval-bad' : 'eval-even';
  return <span class={`candidate-score num ${cls}`}>{formatScore(score)}</span>;
}

/** 自分の対応の印：未検証／検証済み／検証前の手（検証で別の手が最善になった） */
function MineChip({ verified, searched }: { verified: boolean; searched: boolean }) {
  if (verified) return searched ? <span class="chip chip-verified">検証済み</span> : null;
  if (searched) return <span class="chip chip-unverified">検証前の手</span>;
  return <span class="chip chip-unverified">未検証</span>;
}

function LabelChip({ diff }: { diff: number }) {
  const label = labelOf(diff, settings.value.thresholds);
  return <span class={`chip chip-${label}`}>{LABEL_TEXT[label]}</span>;
}

/** 局面 from から局面 to への矢印 */
function edgeBetween(tree: TreeData, from: string, to: string): TreeEdge | undefined {
  return tree.nodes[from]?.edges.find((e) => e.to === to);
}
