// ツリーのデータの形。IndexedDB への保存と、JSON の書き出し（段階2）にそのまま使う。
// 形を変えるときは TREE_FORMAT_VERSION を上げ、古い形も読めるようにする。

import type { Score } from '../engine/usi';
import type { Side } from '../shogi/position';

export const TREE_APP = 'joban-tree';
/**
 * 形式の版。1：段階1〜。2：段階4-3 A〜（局面に「除外した手」excluded を足した）。
 * 3：段階4-3 B〜（自分の手に userChosen・loss を足した）。4：段階6-3〜（ツリーに source を足した）。
 * 5：段階7-1〜（ツリーに templateId を足した）。6：段階7-2〜（ツリーに studies＝研究手順を足した）。
 * 7：段階8-1〜（研究手順をツリーの外の置き場所に移した。ツリーには研究手順を持たない）。
 * 1〜6 の形もそのまま読める（形式 6 までのツリーの研究手順は、取り込むときに独立した研究手順へ移す）
 */
export const TREE_FORMAT_VERSION = 7;

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
  /** 1 回の生成で増やす局面の数の上限（段階6-3〜。それまではツリー全体の局面の数の上限） */
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

/** 同梱ツリー（用意済みのツリー）からコピーしたツリーの、元の同梱ツリー（形式 4〜） */
export interface TreeSource {
  kind: 'bundled';
  /** 同梱ツリーの id */
  id: string;
  /** コピーした同梱ツリーの版（新しい版が出ても、コピーは上書きしない） */
  version: number;
  /** 同梱ツリーを作り終わった日時（ミリ秒） */
  finishedAt: number;
}

/**
 * 研究手順（段階8-1〜。ツリーから独立したデータ。IndexedDB の studies に保存する。src/tree/studies.ts）。
 * 手順は**平手の初期局面からの**指し手（USI）の並び。同じ手順（moves がまったく同じ）は 1 つだけにする
 */
export interface Study {
  id: string;
  name: string;
  /** メモ（複数行） */
  note: string;
  /** 平手の初期局面からの指し手（USI）の並び（1 手以上） */
  moves: string[];
  /** 研究する側 */
  mySide: Side;
  /** 登録したときに分かった戦型（同梱・自分で登録した戦型の id）。無ければ表示のたびに手順から推定する */
  templateId?: string;
  createdAt: number;
  updatedAt: number;
  /** 手順を最後に変えた日時（段階22-2。端末どうしで合わせるときに使う。無ければ updatedAt。`src/tree/deleted.ts`） */
  movesAt?: number;
  /** 手を最後に消した（短くした）日時（段階22-2。合わせるとき短い方の手順が勝つのは、これが相手の手の変更より新しいときだけ） */
  cutAt?: number;
  /** 手を消したときに見ていた手順（消す前の手順。段階22-2。この中に入る手だけが消える） */
  cutFrom?: string[];
  /** メモを最後に変えた日時（段階22-2。無ければ、メモがあるとき updatedAt） */
  noteAt?: number;
  /** 取り消し・戻すで復活させた日時（段階22-2。消した記録より勝つ。並び順には使わない） */
  restoredAt?: number;
}

/**
 * 形式 6（段階7-2）のツリーの中の研究手順。手順は「ツリーの開始局面からの」指し手。
 * 読むとき（端末の保存場所を新しい版にするとき・JSON を取り込むとき）に独立した研究手順（Study）へ移す
 */
export interface TreeStudy {
  id: string;
  name: string;
  note: string;
  moves: string[];
  createdAt: number;
  updatedAt: number;
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
  /** 戻すで復活させた日時（段階22-2。`src/tree/deleted.ts`） */
  restoredAt?: number;
  /** 名前を直した日時（段階22-2。合わせるとき、名前は中身とは別に、後で直した方） */
  renamedAt?: number;
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
  /** 同梱ツリーからコピーしたものなら、その同梱ツリー（一覧の「用意済み」の印・新しい版の知らせに使う） */
  source?: TreeSource;
  /**
   * どの戦型テンプレートから作ったか（形式 5〜。同梱・自分で登録した戦型の id）。トップ画面のグループ分けに使う。
   * 無いとき（形式 4 までのツリー・どの戦型にも当てはまらなかったツリー）は、開始局面までの手順から推定する（src/tree/organize.ts）
   */
  templateId?: string;
  /**
   * 形式 6 の研究手順（段階7-2）。形式 7 からは持たない（独立した研究手順に移す）。
   * 平手から始まらないツリーの研究手順は、平手からの手順に直せないので、消さずにここに残す
   */
  studies?: TreeStudy[];
}
