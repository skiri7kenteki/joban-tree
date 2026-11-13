// ツリーのデータの形。IndexedDB への保存と、JSON の書き出し（段階2）にそのまま使う。
// 形を変えるときは TREE_FORMAT_VERSION を上げ、古い形も読めるようにする。

import type { Score } from '../engine/usi';
import type { Side } from '../shogi/position';

export const TREE_APP = 'joban-tree';
export const TREE_FORMAT_VERSION = 1;

/** 生成の条件（プリセットから決まる） */
export interface GenerationSettings {
  /** 全体の時間の上限（ミリ秒） */
  totalMs: number;
  /** 1 局面あたりの探索時間（ミリ秒） */
  movetimeMs: number;
  /** 候補手の数（MultiPV） */
  multiPV: number;
  /** 深さの上限（自分と相手の往復の数） */
  maxRounds: number;
  /** 局面の数の上限 */
  maxNodes: number;
  /** 最善手から何点以内の応手を採用するか */
  windowCp: number;
}

/** 局面から次の局面への矢印（1 手） */
export interface TreeEdge {
  /** 指し手（USI 形式） */
  move: string;
  /** 指した後の局面のキー */
  to: string;
  /** **自分から見た**評価値（プラスなら自分が有利） */
  score: Score;
  /** 相手の応手のとき：最善手との評価値の差（0 以上）。ラベル（本線・有力・疑問手）はここから決める */
  diff?: number;
  /** 自分の対応で、まだ探索して確かめていないもの（読み筋の 2 手目をそのまま使ったもの） */
  unverified?: boolean;
}

/** ツリーの中の 1 局面 */
export interface TreeNode {
  /** 局面のキー（手数を除いた SFEN） */
  key: string;
  /** 局面の SFEN（最初にたどり着いたときの手数付き） */
  sfen: string;
  /**
   * 何往復目の局面か。相手ノードは 0, 1, 2, …（開始局面が相手ノードなら 0）。
   * 自分ノードは、そこに至った相手ノードと同じ値（開始局面が自分ノードなら −1）
   */
  round: number;
  /** 次の局面への手（相手ノードなら相手の応手、自分ノードなら自分の対応） */
  edges: TreeEdge[];
  /** 探索した記録（まだなら無い） */
  searched?: { movetimeMs: number; multiPV: number; depth: number; nodes: number };
  /** 指す手が無い（詰み・投了など） */
  terminal?: boolean;
}

/** 保存されるツリー全体 */
export interface TreeData {
  app: typeof TREE_APP;
  version: typeof TREE_FORMAT_VERSION;
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  /** 研究する側 */
  mySide: Side;
  /** 開始局面のキー */
  rootKey: string;
  /** 開始局面に至るまでの手順（棋譜の初期局面と指し手。KIF 書き出し用） */
  prefix: { initialSfen: string; moves: string[] };
  /** 局面のキー → 局面 */
  nodes: Record<string, TreeNode>;
  /** 最後に使った生成の条件 */
  settings: GenerationSettings;
  /** 生成の記録 */
  generation?: { elapsedMs: number; searched: number; finishedReason?: string };
}
