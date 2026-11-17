// 同梱ツリー（段階6）：PC で時間をかけて作り、アプリに入れておくツリーのファイルの形と、その点検。
// 作るのは pc/bake/（Node.js のコマンド）。アプリは開くときに public/trees/<id>.v<版>.json を取りに行く（段階6-3）。

import { applyUsiMove, sfenKey, sideToMove, STARTPOS_SFEN } from '../shogi/position';
import { isOpponentNode } from './generator';
import type { GenerationSettings, TreeData, TreeNode } from './types';

export const BUNDLED_TREE_KIND = 'bundled-tree';
export const BUNDLED_TREE_FILE_VERSION = 1;

/** 作った条件の記録 */
export interface BundleInfo {
  /** 同梱ツリーの id（ふつうはテンプレートの id と同じ） */
  id: string;
  /** 出発点の戦型テンプレート */
  templateId: string;
  /** 同梱ツリーの版（作り直したら上げる。利用者のコピーは上書きしない） */
  version: number;
  /** ツリーの名前（テンプレートの名前） */
  name: string;
  /** 作り始めた日時・作り終わった日時（ミリ秒） */
  startedAt: number;
  finishedAt: number;
  /** かかった時間（止まっていた間を除く。ミリ秒） */
  elapsedMs: number;
  /** 何回に分けて作ったか（途中で止めて再開したら 2 以上） */
  sessions: number;
  /** 探索した局面の数・ツリーの局面の数 */
  searched: number;
  nodeCount: number;
  /** 深さ（往復の数）。手数ではその 2 倍 */
  maxRounds: number;
  engine: {
    /** エンジンが名乗った名前（USI の id name） */
    name: string;
    /** PC 用エンジンの版（pc-engine/manifest.json の id） */
    build: string;
    evalId: 'mini' | 'micro';
    evalLabel: string;
    threads: number;
    hashMB: number;
    cpu: string;
  };
  /** 生成の設定 */
  settings: GenerationSettings;
  /** 作ったときのアプリの版 */
  appVersion: string;
}

/** 同梱ツリーのファイル */
export interface BundledTreeFile {
  app: 'joban-tree';
  kind: typeof BUNDLED_TREE_KIND;
  version: number;
  bundle: BundleInfo;
  tree: TreeData;
}

/** 同梱ツリーのファイル名（版を入れておくと、端末に保存したものを安心して使い続けられる） */
export function bundledTreeFileName(id: string, version: number): string {
  return `${id}.v${version}.json`;
}

/**
 * 生成のときと同じ決まりでたどれる局面（相手の局面はすべての応手、自分の局面はいちばん上の手の先だけ。
 * 疑問手を咎めた後の局面の先は調べないので、たどらない）。深さの上限（相手の局面の round が maxRounds）の局面は葉として含む
 */
export function liveNodes(tree: TreeData, maxRounds: number, dubiousCp: number | undefined = tree.settings.dubiousCp): TreeNode[] {
  const root = tree.nodes[tree.rootKey];
  if (!root) return [];
  // 自分の局面に入ってくる手がすべて疑問手なら、その先は調べない（generator.ts の stopsAfterAnswer と同じ）
  const dubiousOnly = new Map<string, boolean>();
  if (dubiousCp !== undefined) {
    for (const node of Object.values(tree.nodes)) {
      for (const edge of node.edges) {
        const dubious = edge.diff !== undefined && edge.diff > dubiousCp;
        dubiousOnly.set(edge.to, (dubiousOnly.get(edge.to) ?? true) && dubious);
      }
    }
  }
  const out: TreeNode[] = [];
  const seen = new Set<string>();
  const stack = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (seen.has(node.key)) continue;
    seen.add(node.key);
    out.push(node);
    if (node.terminal) continue;
    const opp = isOpponentNode(tree, node);
    if (opp && node.round >= maxRounds) continue;
    if (!opp && node.key !== tree.rootKey && dubiousOnly.get(node.key)) continue;
    const edges = opp ? node.edges : node.edges.slice(0, 1);
    for (const edge of edges) {
      const next = tree.nodes[edge.to];
      if (next) stack.push(next);
    }
  }
  return out;
}

/** 自分の局面で、調べて確定した手がまだ無いもの（未検証の手しかない・まだ調べていない） */
export function unverifiedMine(tree: TreeData, maxRounds: number): TreeNode[] {
  return liveNodes(tree, maxRounds).filter((n) => {
    if (isOpponentNode(tree, n) || n.terminal) return false;
    const top = n.edges[0];
    return !n.searched || !top || top.unverified === true;
  });
}

/** まだ調べていない相手の局面（深さの上限より手前のもの） */
export function unsearchedOpponent(tree: TreeData, maxRounds: number): TreeNode[] {
  return liveNodes(tree, maxRounds).filter((n) => isOpponentNode(tree, n) && !n.terminal && !n.searched && n.round < maxRounds);
}

/**
 * 同梱ツリーのファイルを点検する。問題が無ければ空の配列、あれば理由の一覧。
 * expectedMoves を渡すと、出発点がその手順（平手の初期局面から）の後の局面と一致するかも確かめる
 */
export function checkBundledTree(file: unknown, expectedMoves?: readonly string[]): string[] {
  const problems: string[] = [];
  const f = file as Partial<BundledTreeFile> | null;
  if (!f || f.app !== 'joban-tree' || f.kind !== BUNDLED_TREE_KIND) return ['同梱ツリーのファイルではありません'];
  if (f.version !== BUNDLED_TREE_FILE_VERSION) problems.push(`ファイルの形の版が ${String(f.version)}`);
  const b = f.bundle;
  const tree = f.tree;
  if (!b || !tree) return [...problems, '作った条件の記録かツリーがありません'];

  // 作った条件の記録
  const need: [string, unknown][] = [
    ['id', b.id],
    ['templateId', b.templateId],
    ['name', b.name],
    ['engine.name', b.engine?.name],
    ['engine.build', b.engine?.build],
    ['engine.evalLabel', b.engine?.evalLabel],
    ['engine.cpu', b.engine?.cpu],
    ['appVersion', b.appVersion],
  ];
  for (const [name, v] of need) if (typeof v !== 'string' || v === '') problems.push(`記録の ${name} がありません`);
  const nums: [string, unknown][] = [
    ['version', b.version],
    ['startedAt', b.startedAt],
    ['finishedAt', b.finishedAt],
    ['elapsedMs', b.elapsedMs],
    ['sessions', b.sessions],
    ['searched', b.searched],
    ['nodeCount', b.nodeCount],
    ['maxRounds', b.maxRounds],
    ['engine.threads', b.engine?.threads],
    ['engine.hashMB', b.engine?.hashMB],
  ];
  for (const [name, v] of nums) if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) problems.push(`記録の ${name} がありません`);
  if (!b.settings || typeof b.settings.movetimeMs !== 'number') problems.push('記録の settings がありません');
  if (problems.length > 0) return problems;

  // 出発点
  const root = tree.nodes?.[tree.rootKey];
  if (!root) return ['出発点の局面がありません'];
  if (sfenKey(root.sfen) !== tree.rootKey) problems.push('出発点のキーと局面が合いません');
  if (expectedMoves) {
    let sfen = STARTPOS_SFEN;
    for (const m of expectedMoves) {
      const r = applyUsiMove(sfen, m);
      if (!r) return [...problems, `テンプレートの手順 ${m} が指せません`];
      sfen = r.sfen;
    }
    if (sfenKey(sfen) !== tree.rootKey) problems.push('出発点がテンプレートの手順の後の局面と一致しません');
    if (tree.prefix.moves.join(' ') !== expectedMoves.join(' ')) problems.push('出発点までの手順（prefix）がテンプレートと違います');
    if (sideToMove(sfen) === tree.mySide) problems.push('出発点で自分の手番になっています');
  }
  if (b.nodeCount !== Object.keys(tree.nodes).length) problems.push(`記録の局面の数（${b.nodeCount}）とツリーの局面の数（${Object.keys(tree.nodes).length}）が違います`);

  // 局面とつながり：キーが合う、すべての手が合法で、行き先の局面が指した後の局面と一致する
  for (const [key, node] of Object.entries(tree.nodes)) {
    if (node.key !== key || sfenKey(node.sfen) !== key) {
      problems.push(`局面 ${key} のキーが合いません`);
      continue;
    }
    for (const edge of [...node.edges, ...(node.excluded ?? [])]) {
      const r = applyUsiMove(node.sfen, edge.move);
      if (!r) {
        problems.push(`局面 ${key} の ${edge.move} が指せない手です`);
        continue;
      }
      if (sfenKey(r.sfen) !== edge.to) problems.push(`局面 ${key} の ${edge.move} の行き先が違います`);
      else if (!tree.nodes[edge.to]) problems.push(`局面 ${key} の ${edge.move} の行き先の局面がありません`);
    }
  }
  // 出発点からたどれない局面が無い（合流は 1 つの局面にまとまっているので、数えるのは 1 回）
  const reach = new Set<string>();
  const stack = [tree.rootKey];
  while (stack.length > 0) {
    const k = stack.pop()!;
    if (reach.has(k)) continue;
    reach.add(k);
    for (const e of [...(tree.nodes[k]?.edges ?? []), ...(tree.nodes[k]?.excluded ?? [])]) stack.push(e.to);
  }
  const orphan = Object.keys(tree.nodes).filter((k) => !reach.has(k));
  if (orphan.length > 0) problems.push(`出発点からたどれない局面が ${orphan.length} 個あります`);

  // 作り終わっている：調べ残しの相手の局面・確定していない自分の手が無い
  const rest = unsearchedOpponent(tree, b.maxRounds);
  if (rest.length > 0) problems.push(`まだ調べていない相手の局面が ${rest.length} 個あります`);
  const mine = unverifiedMine(tree, b.maxRounds);
  if (mine.length > 0) problems.push(`確定していない自分の手が ${mine.length} 個あります`);
  return problems;
}
