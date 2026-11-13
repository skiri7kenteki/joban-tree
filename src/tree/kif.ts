// ツリーを KIF（柿木形式の棋譜）にする。iShogi などほかの将棋アプリに渡すため。
// - 分岐付き KIF：ツリー全体。候補手リストの 1 番目が本譜、2 番目以降が変化になる
// - 手順の KIF：開始局面から今の局面まで（分岐なし）
// どちらも、棋譜の初期局面から開始局面までの手順（prefix）を先頭に付ける。
// 評価値やラベルは、各手のコメント（KIF の「*」の行）に書く。

import { Position, Record, RecordMetadataKey, exportKIF } from 'tsshogi';
import { formatScore } from '../engine/usi';
import { isOpponentNode } from './generator';
import { DEFAULT_THRESHOLDS, LABEL_TEXT, labelOf, type LabelThresholds } from './labels';
import type { TreeData, TreeEdge, TreeNode } from './types';

/** 開始局面まで進めた棋譜を作る */
function baseRecord(tree: TreeData): Record {
  const position = Position.newBySFEN(tree.prefix.initialSfen);
  if (!position) throw new Error('棋譜の初期局面を読めませんでした');
  const record = new Record(position);
  record.metadata.setStandardMetadata(RecordMetadataKey.TITLE, tree.name);
  for (const usi of tree.prefix.moves) appendUsi(record, usi);
  const side = tree.mySide === 'black' ? '先手' : '後手';
  record.current.comment = joinComment(record.current.comment, `序盤ツリーの開始局面（自分は${side}。評価値は自分から見た値）`);
  return record;
}

function appendUsi(record: Record, usi: string): void {
  const move = record.position.createMoveByUSI(usi);
  if (!move || !record.append(move)) throw new Error(`指し手 ${usi} を棋譜に入れられませんでした`);
}

function joinComment(a: string, b: string): string {
  return a ? `${a}\n${b}` : b;
}

/** 1 手のコメント（評価値・ラベル・未検証） */
function edgeComment(tree: TreeData, from: TreeNode, edge: TreeEdge, thresholds: LabelThresholds): string {
  const parts = [`評価値 ${formatScore(edge.score)}`];
  if (isOpponentNode(tree, from)) {
    if (edge.diff !== undefined) parts.push(LABEL_TEXT[labelOf(edge.diff, thresholds)]);
  } else if (edge.unverified) {
    parts.push(from.searched ? '検証前の手（検証では別の手が最善）' : '未検証');
  }
  return parts.join('・');
}

/** ツリー全体を分岐付き KIF にする */
export function treeToKif(tree: TreeData, thresholds: LabelThresholds = DEFAULT_THRESHOLDS): string {
  const record = baseRecord(tree);
  // 合流：同じ局面が 2 回目に出てきたら、その先は書かない（1 回目のところに書いてある）
  const written = new Set<string>();
  const walk = (key: string) => {
    written.add(key);
    const node = tree.nodes[key];
    if (!node) return;
    for (const edge of node.edges) {
      appendUsi(record, edge.move);
      let comment = edgeComment(tree, node, edge, thresholds);
      if (written.has(edge.to)) comment += '\n合流（この先は別の手順のところにあります）';
      record.current.comment = comment;
      if (!written.has(edge.to)) walk(edge.to);
      record.goBack();
    }
  };
  walk(tree.rootKey);
  return exportKIF(record);
}

/** 開始局面から path（局面のキーの並び）の最後までの手順を KIF にする */
export function pathToKif(tree: TreeData, path: string[], thresholds: LabelThresholds = DEFAULT_THRESHOLDS): string {
  const record = baseRecord(tree);
  for (let i = 1; i < path.length; i++) {
    const from = tree.nodes[path[i - 1]];
    const edge = from?.edges.find((e) => e.to === path[i]);
    if (!from || !edge) break;
    appendUsi(record, edge.move);
    record.current.comment = edgeComment(tree, from, edge, thresholds);
  }
  return exportKIF(record);
}
