// ツリーのデータの形。IndexedDB への保存と、JSON の書き出し（段階2）にそのまま使う。
// 形を変えるときは TREE_FORMAT_VERSION を上げ、古い形も読めるようにする。

import type { Score } from '../engine/usi';
import type { Side } from '../shogi/position';

export const TREE_APP = 'joban-tree';
/**
 * 形式の版。1：段階1〜。2：段階4-3 A〜（局面に「除外した手」excluded を足した）。
 * 3：段階4-3 B〜（自分の手に userChosen・loss を足した）。1・2 の形はそのまま 3 として読める
 */
export const TREE_FORMAT_VERSION = 3;

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
  /**
   * 自分の対応を調べる時間（ミリ秒）。0 か無いときは、相手の局面の読み筋の 2 手目をそのまま使う（未検証）。
   * 1 以上なら、相手の応手の後の局面（自分ノード）を MultiPV=1 でこの時間だけ調べて確定する（v0.4.0〜）
   */
  replyMs?: number;
  /**
   * 最善手との差がこれより大きい相手の応手（疑問手）は、咎める自分の手までで止め、その先は調べない（v0.6.2〜）。
   * 浮いた時間を本線・有力の枝に回す。無いときは疑問手の先も調べる（v0.6.1 まで）。画面の「有力」のしきい値と同じ値を使う
   */
  dubiousCp?: number;
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
  /**
   * 自分の対応で、利用者が「自分の指したい手」として選んで調べたもの（形式 3〜）。
   * 選んだ手は本線（その局面のいちばん上）にする。エンジンの最善手は消さずにその下に残す
   */
  userChosen?: boolean;
  /** userChosen の手が、エンジンの最善手より何点悪いか（0 以上。同じ時間で両方を調べて比べた値） */
  loss?: number;
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
  /**
   * 利用者が除外した相手の応手（形式 2〜）。edges から移したもので、その先の局面は消さずに残す（「戻す」で edges に戻る）。
   * ここにある手は、調べ直すときにも採用しない（go searchmoves で外す）。書き出し・復習・ここから展開ではたどらない
   */
  excluded?: TreeEdge[];
}

/** 保存されるツリー全体 */
export interface TreeData {
  app: typeof TREE_APP;
  /** 形式の版（古い形式のツリーは、保存し直すときに TREE_FORMAT_VERSION にする） */
  version: number;
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
