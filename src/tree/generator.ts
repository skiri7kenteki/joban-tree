// ツリー生成のロジック。エンジンの実装には依存せず、AnalysisEngine（型）だけを使う。
// テストでは偽物のエンジン（モック）を渡して確かめる。
//
// 流れ（CLAUDE.md「ツリー生成の仕様」）：
//   1. 相手ノードを MultiPV=N で調べる
//   2. 各候補の読み筋の 1 手目＝相手の応手、2 手目＝自分の対応（未検証）として枝を作る
//      （replyMs があれば 2 手目は使わず、自分ノードを MultiPV=1 で調べて確定した手を置く）
//   3. 自分の対応の後の局面（また相手ノード）を待ち行列へ。浅い順、同じ深さなら自分に良い順
//   4. 時間・深さ・局面数の上限か、停止で終わる。どこで終わっても、それまでのツリーは有効
//   自分ノードに手が複数あるとき（検証前の手・利用者が選んだ手）は、本線（いちばん上の手）の先だけをたどる（段階4-3）

import type { AnalysisEngine, AnalysisResult } from '../engine/engine';
import { negateScore, scoreToNumber, type PvLine } from '../engine/usi';
import { applyUsiMove, legalMoves, positionCommand, sfenKey, sideToMove, type Side } from '../shogi/position';
import {
  TREE_APP,
  TREE_FORMAT_VERSION,
  type GenerationSettings,
  type TreeData,
  type TreeEdge,
  type TreeNode,
} from './types';

/** 生成が終わった理由 */
export type FinishReason = 'completed' | 'time' | 'nodes' | 'stopped' | 'error';

export const FINISH_TEXT: Record<FinishReason, string> = {
  completed: '指定の深さまで作りました',
  time: '時間の上限に達しました',
  nodes: '局面の数の上限に達しました',
  stopped: '停止しました',
  error: 'エンジンでエラーが起きました',
};

/** 進み具合（画面表示用） */
export interface GeneratorProgress {
  elapsedMs: number;
  /** 探索した局面の数 */
  searched: number;
  /** ツリーの局面の数 */
  nodeCount: number;
  /** いま調べている深さ（何往復目か。1 から数える） */
  round: number;
}

interface QueueItem {
  key: string;
  round: number;
  /** 同じ深さの中での優先度（自分から見た評価値。大きいほど先） */
  priority: number;
}

/** 新しいツリーを作る（開始局面だけが入った状態） */
export function createTree(args: {
  id: string;
  name: string;
  rootSfen: string;
  mySide: Side;
  prefix: { initialSfen: string; moves: string[] };
  settings: GenerationSettings;
  now: number;
}): TreeData {
  const rootKey = sfenKey(args.rootSfen);
  const isOpp = sideToMove(args.rootSfen) !== args.mySide;
  return {
    app: TREE_APP,
    version: TREE_FORMAT_VERSION,
    id: args.id,
    name: args.name,
    createdAt: args.now,
    updatedAt: args.now,
    mySide: args.mySide,
    rootKey,
    prefix: args.prefix,
    nodes: { [rootKey]: { key: rootKey, sfen: args.rootSfen, round: isOpp ? 0 : -1, edges: [] } },
    settings: args.settings,
  };
}

/** その局面が相手の手番か（相手ノードか） */
export function isOpponentNode(tree: TreeData, node: TreeNode): boolean {
  return sideToMove(node.sfen) !== tree.mySide;
}

export class TreeGenerator {
  private stopped = false;
  private readonly queue: QueueItem[] = [];
  private readonly queued = new Set<string>();
  private searched = 0;
  private startedAt = 0;
  /** 相手ノードを調べる深さの上限（この値より小さい round だけ調べる） */
  private roundLimit = 0;
  /** 生成を始めた局面（「ここから展開」でここを選んだときは、疑問手の後でも先まで調べる） */
  private startKey = '';
  /** エラーになったときの内容 */
  errorMessage = '';

  constructor(
    private readonly engine: AnalysisEngine,
    private readonly tree: TreeData,
    private readonly settings: GenerationSettings,
    private readonly hooks: {
      /** ツリーが変わるたびに呼ばれる（画面の更新・自動保存用） */
      onChange?: (progress: GeneratorProgress) => void;
      /** 時刻（テストで差し替える） */
      now?: () => number;
    } = {},
  ) {}

  private now(): number {
    return this.hooks.now ? this.hooks.now() : Date.now();
  }

  /** 途中で止める（探索中の 1 局面はそこまでの結果を使ってから止まる） */
  stop(): void {
    this.stopped = true;
    this.engine.stop();
  }

  /** startKey の局面から生成する（既にある枝の先の、まだ調べていない局面から続ける） */
  async run(startKey: string = this.tree.rootKey): Promise<FinishReason> {
    this.startedAt = this.now();
    const start = this.tree.nodes[startKey];
    if (!start) return 'completed';
    this.startKey = startKey;
    const baseRound = isOpponentNode(this.tree, start) ? start.round : start.round + 1;
    this.roundLimit = baseRound + this.settings.maxRounds;
    this.collectFrontier(startKey);
    // 局面の数の上限は「この 1 回の生成で増やせる数」（段階6-3〜。それまではツリー全体の数だったので、
    // 大きな同梱ツリーから「ここから展開」できなかった）
    const baseCount = Object.keys(this.tree.nodes).length;

    while (this.queue.length > 0) {
      if (this.stopped) return 'stopped';
      const elapsed = this.now() - this.startedAt;
      if (elapsed >= this.settings.totalMs) return 'time';
      if (Object.keys(this.tree.nodes).length - baseCount >= this.settings.maxNodes) return 'nodes';

      const item = this.queue.shift()!;
      this.queued.delete(item.key);
      const node = this.tree.nodes[item.key];
      if (!node || node.searched || node.terminal) continue;

      const opp = isOpponentNode(this.tree, node);
      // 自分ノードは「自分の対応を調べる時間」があればそれを使う
      const baseMs = !opp && this.verifiesReplies() ? this.settings.replyMs! : this.settings.movetimeMs;
      // 残り時間が少なければ、そのぶん短く調べる（全体の時間を大きく超えないように）
      const movetimeMs = Math.max(100, Math.min(baseMs, this.settings.totalMs - elapsed));
      let result: AnalysisResult;
      try {
        result = await this.engine.analyze(positionCommand(node.sfen), {
          movetimeMs,
          multiPV: opp ? this.settings.multiPV : 1,
        });
      } catch (error) {
        this.errorMessage = error instanceof Error ? error.message : String(error);
        return 'error';
      }
      node.searched = { movetimeMs, multiPV: opp ? this.settings.multiPV : 1, depth: result.depth, nodes: result.nodes };
      if (opp) this.expandOpponent(node, result);
      else this.expandMine(node, result);
      this.searched++;
      this.tree.updatedAt = this.now();
      this.hooks.onChange?.({
        elapsedMs: this.now() - this.startedAt,
        searched: this.searched,
        nodeCount: Object.keys(this.tree.nodes).length,
        round: Math.max(1, node.round + 1),
      });
    }
    return this.stopped ? 'stopped' : 'completed';
  }

  /**
   * 除外した手を外して、相手の局面を 1 つだけ調べ直す（段階4-3）。
   * 除外した手以外の合法手の中から MultiPV の数だけ調べ（go searchmoves）、候補を補い、ラベル（最善手との差）を付け直す。
   * 新しく入った応手には、読み筋の 2 手目を「未検証」の自分の対応として置く（確定は「ここから展開」か「この手を検証」で）
   */
  async resample(key: string, movetimeMs: number): Promise<FinishReason> {
    this.startedAt = this.now();
    const node = this.tree.nodes[key];
    if (!node || node.terminal || !isOpponentNode(this.tree, node)) return 'completed';
    const excluded = new Set((node.excluded ?? []).map((e) => e.move));
    const allowed = legalMoves(node.sfen).filter((m) => !excluded.has(m));
    if (allowed.length === 0) {
      relabel(node);
      return 'completed';
    }
    let result: AnalysisResult;
    try {
      result = await this.engine.analyze(positionCommand(node.sfen), { movetimeMs, multiPV: this.settings.multiPV, searchMoves: allowed });
    } catch (error) {
      this.errorMessage = error instanceof Error ? error.message : String(error);
      return 'error';
    }
    node.searched = { movetimeMs, multiPV: this.settings.multiPV, depth: result.depth, nodes: result.nodes };
    const lines = result.lines.filter((l) => l.pv.length > 0 && l.score && !excluded.has(l.pv[0]));
    // 今ある応手の評価値は、新しく調べた値に直す
    for (const line of lines) {
      const edge = node.edges.find((e) => e.move === line.pv[0]);
      if (edge) edge.score = negateScore(line.score!);
    }
    // 新しい応手を足す（評価値の差は、残った手の中の最善手から。このあと relabel で全体を付け直す）
    const best = Math.max(...node.edges.map((e) => -scoreToNumber(e.score)), ...lines.map((l) => scoreToNumber(l.score!)));
    for (const line of lines) {
      const oppMove = line.pv[0];
      if (node.edges.some((e) => e.move === oppMove)) continue;
      const diff = best - scoreToNumber(line.score!);
      if (diff > this.settings.windowCp) continue;
      const afterOpp = applyUsiMove(node.sfen, oppMove);
      if (!afterOpp) continue;
      const myScore = negateScore(line.score!);
      const me = this.getOrCreate(afterOpp.sfen, node.round).node;
      node.edges.push({ move: oppMove, to: me.key, score: myScore, diff });
      if (me.edges.length > 0 || me.searched || me.terminal) continue;
      const myMove = line.pv[1];
      const afterMine = myMove ? applyUsiMove(afterOpp.sfen, myMove) : null;
      if (!myMove || !afterMine) continue;
      const next = this.getOrCreate(afterMine.sfen, node.round + 1).node;
      me.edges.push({ move: myMove, to: next.key, score: myScore, unverified: true });
    }
    relabel(node);
    this.searched++;
    this.tree.updatedAt = this.now();
    this.hooks.onChange?.({
      elapsedMs: this.now() - this.startedAt,
      searched: this.searched,
      nodeCount: Object.keys(this.tree.nodes).length,
      round: Math.max(1, node.round + 1),
    });
    return this.stopped ? 'stopped' : 'completed';
  }

  /**
   * 「自分の指したい手で調べる」（段階4-3 B）：自分ノード key で、利用者が選んだ手 move を本線にして、その先を作る。
   *   1. 同じ時間（compareMs）で、エンジンの最善手（MultiPV=1）と、選んだ手だけ（go searchmoves move）を調べる
   *   2. 選んだ手を「自分の手」（userChosen）としていちばん上に置き、最善手との差を loss に入れる。最善手はその下に残す
   *   3. 選んだ手の後の局面（相手の手番）から、この生成の条件で展開する（run と同じ）
   */
  async explore(key: string, move: string, compareMs: number): Promise<FinishReason> {
    this.startedAt = this.now();
    const node = this.tree.nodes[key];
    if (!node || node.terminal || isOpponentNode(this.tree, node)) return 'completed';
    const after = applyUsiMove(node.sfen, move);
    if (!after) {
      this.errorMessage = 'この局面では指せない手です';
      return 'error';
    }
    const position = positionCommand(node.sfen);
    let best: AnalysisResult;
    let mine: AnalysisResult;
    try {
      best = await this.engine.analyze(position, { movetimeMs: compareMs, multiPV: 1 });
      if (this.stopped) return 'stopped';
      mine = await this.engine.analyze(position, { movetimeMs: compareMs, multiPV: 1, searchMoves: [move] });
    } catch (error) {
      this.errorMessage = error instanceof Error ? error.message : String(error);
      return 'error';
    }
    const bestLine = best.lines.find((l) => l.pv.length > 0 && l.score);
    const mineLine = mine.lines.find((l) => l.pv[0] === move && l.score);
    if (!bestLine || !mineLine) {
      this.errorMessage = 'エンジンがこの手を調べられませんでした';
      return 'error';
    }
    node.searched = { movetimeMs: compareMs, multiPV: 1, depth: best.depth, nodes: best.nodes };
    this.placeMine(node, bestLine);
    // 選んだ手が最善手と同じなら損は 0。違えば、同じ時間で調べた評価値の差（自分の手番なので、そのまま自分から見た値）
    const same = bestLine.pv[0] === move;
    const score = same ? bestLine.score! : mineLine.score!;
    const loss = same ? 0 : Math.max(0, scoreToNumber(bestLine.score!) - scoreToNumber(mineLine.score!));
    const next = this.getOrCreate(after.sfen, node.round + 1).node;
    const chosen: TreeEdge = { move, to: next.key, score, userChosen: true, loss };
    node.edges = [chosen, ...node.edges.filter((e) => e.move !== move)];
    this.searched += 2;
    this.tree.updatedAt = this.now();
    this.hooks.onChange?.({
      elapsedMs: this.now() - this.startedAt,
      searched: this.searched,
      nodeCount: Object.keys(this.tree.nodes).length,
      round: Math.max(1, node.round + 1),
    });
    if (this.stopped) return 'stopped';
    return this.run(next.key);
  }

  /**
   * 「この手を検証」：自分ノードを 1 局面だけ、MultiPV=1 で調べ直す。
   * 最善手を「確定した自分の対応」として先頭に置く。読み筋から取った手（未検証）が別の手だったときは、
   * その枝も消さずに残す（その先のツリーを失わないため）。
   */
  async verify(key: string, movetimeMs: number): Promise<FinishReason> {
    this.startedAt = this.now();
    const node = this.tree.nodes[key];
    if (!node || node.terminal || isOpponentNode(this.tree, node)) return 'completed';
    let result: AnalysisResult;
    try {
      result = await this.engine.analyze(positionCommand(node.sfen), { movetimeMs, multiPV: 1 });
    } catch (error) {
      this.errorMessage = error instanceof Error ? error.message : String(error);
      return 'error';
    }
    node.searched = { movetimeMs, multiPV: 1, depth: result.depth, nodes: result.nodes };
    this.expandMine(node, result);
    this.searched++;
    this.tree.updatedAt = this.now();
    this.hooks.onChange?.({
      elapsedMs: this.now() - this.startedAt,
      searched: this.searched,
      nodeCount: Object.keys(this.tree.nodes).length,
      round: Math.max(1, node.round + 1),
    });
    return this.stopped ? 'stopped' : 'completed';
  }

  /** 自分の対応も探索して確定するか（replyMs が 1 以上） */
  private verifiesReplies(): boolean {
    return (this.settings.replyMs ?? 0) > 0;
  }

  /** 疑問手の先を止める設定のとき、この相手の応手は疑問手か */
  private isDubious(edge: TreeEdge): boolean {
    const limit = this.settings.dubiousCp;
    return limit !== undefined && edge.diff !== undefined && edge.diff > limit;
  }

  /**
   * この自分ノードの先（自分の手の後の局面）を調べないか：疑問手を通ってしか来られない局面なら、咎める手までで止める。
   * ほかの手順（本線・有力）からも来られる局面や、「ここから展開」で選んだ局面は先まで調べる
   */
  private stopsAfterAnswer(key: string): boolean {
    if (this.settings.dubiousCp === undefined || key === this.startKey) return false;
    let viaDubious = false;
    for (const node of Object.values(this.tree.nodes)) {
      for (const edge of node.edges) {
        if (edge.to !== key) continue;
        if (!this.isDubious(edge)) return false;
        viaDubious = true;
      }
    }
    return viaDubious;
  }

  /** startKey から既存の枝をたどり、まだ調べていない局面を待ち行列に入れる */
  private collectFrontier(startKey: string): void {
    const seen = new Set<string>();
    const stack: { key: string; priority: number }[] = [{ key: startKey, priority: 0 }];
    while (stack.length > 0) {
      const { key, priority } = stack.pop()!;
      if (seen.has(key)) continue;
      seen.add(key);
      const node = this.tree.nodes[key];
      if (!node || node.terminal) continue;
      if (!node.searched && node.edges.length === 0) {
        this.enqueue(node, priority);
        continue;
      }
      // 未検証の手しかない自分ノードは、確定させるために調べ直す（その先の枝もたどる）
      if (!node.searched && this.verifiesReplies() && !isOpponentNode(this.tree, node)) this.enqueue(node, priority);
      // 疑問手の後の自分ノードは、咎める手（の確定）までで止める
      if (!isOpponentNode(this.tree, node) && this.stopsAfterAnswer(key)) continue;
      // 自分ノードは本線（いちばん上の手）の先だけ。検証前の手・本線にしていない自分の手の先は広げない
      const edges = isOpponentNode(this.tree, node) ? node.edges : node.edges.slice(0, 1);
      for (const edge of edges) stack.push({ key: edge.to, priority: scoreToNumber(edge.score) });
    }
  }

  private enqueue(node: TreeNode, priority: number): void {
    if (this.queued.has(node.key) || node.searched || node.terminal) return;
    // 相手ノードは深さの上限まで。自分ノードは「その往復の残り」なので上限の内側なら調べる
    if (isOpponentNode(this.tree, node) ? node.round >= this.roundLimit : node.round + 1 > this.roundLimit) return;
    const item: QueueItem = { key: node.key, round: node.round, priority };
    // 浅い順、同じ深さなら優先度の高い順に並べておく
    let i = this.queue.length;
    while (i > 0 && compare(this.queue[i - 1], item) > 0) i--;
    this.queue.splice(i, 0, item);
    this.queued.add(node.key);
  }

  /** 局面を取り出す（無ければ作る） */
  private getOrCreate(sfen: string, round: number): { node: TreeNode; created: boolean } {
    const key = sfenKey(sfen);
    const found = this.tree.nodes[key];
    if (found) return { node: found, created: false };
    const node: TreeNode = { key, sfen, round, edges: [] };
    this.tree.nodes[key] = node;
    return { node, created: true };
  }

  /** 相手ノードを調べた結果から、相手の応手と自分の対応の枝を作る */
  private expandOpponent(node: TreeNode, result: AnalysisResult): void {
    const lines = result.lines.filter((l) => l.pv.length > 0 && l.score);
    if (lines.length === 0) {
      node.terminal = true;
      return;
    }
    // 評価値は相手（手番側）から見た値。最善手との差で採用を決める
    const best = Math.max(...lines.map((l) => scoreToNumber(l.score!)));
    for (const line of lines) {
      const diff = best - scoreToNumber(line.score!);
      if (diff > this.settings.windowCp) continue;
      const myScore = negateScore(line.score!);

      // 1 手目：相手の応手
      const oppMove = line.pv[0];
      const afterOpp = applyUsiMove(node.sfen, oppMove);
      if (!afterOpp) continue;
      if (node.edges.some((e) => e.move === oppMove)) continue;
      // 利用者が除外した手は採用しない
      if (node.excluded?.some((e) => e.move === oppMove)) continue;
      const me = this.getOrCreate(afterOpp.sfen, node.round).node;
      node.edges.push({ move: oppMove, to: me.key, score: myScore, diff });

      // 自分ノードに既に手があれば（合流など）、それを使う
      if (me.edges.length > 0 || me.searched || me.terminal) continue;

      // 自分の対応も調べる設定なら、自分ノードを待ち行列へ（調べたら expandMine が確定した手を置く）
      if (this.verifiesReplies()) {
        this.enqueue(me, scoreToNumber(myScore));
        continue;
      }

      // 2 手目：自分の対応（探索し直さず、読み筋をそのまま使う＝未検証）
      const myMove = line.pv[1];
      const afterMine = myMove ? applyUsiMove(afterOpp.sfen, myMove) : null;
      if (!myMove || !afterMine) {
        // 読み筋が 1 手しかない：自分ノードとして調べる
        this.enqueue(me, scoreToNumber(myScore));
        continue;
      }
      const next = this.getOrCreate(afterMine.sfen, node.round + 1).node;
      me.edges.push({ move: myMove, to: next.key, score: myScore, unverified: true });
      // 疑問手なら、咎める手までで止める
      if (!this.stopsAfterAnswer(me.key)) this.enqueue(next, scoreToNumber(myScore));
    }
  }

  /** 自分ノードを調べた結果から、自分の対応（確定）の枝を作る */
  private expandMine(node: TreeNode, result: AnalysisResult): void {
    const line = result.lines.find((l) => l.pv.length > 0 && l.score);
    if (!line) {
      node.terminal = true;
      return;
    }
    const edge = this.placeMine(node, line);
    if (!edge) {
      node.terminal = true;
      return;
    }
    // 本線になった手の先だけを調べる。疑問手の後の局面なら、咎める手を置いたところで止める（その先は調べない）
    if (node.edges[0] === edge && !this.stopsAfterAnswer(node.key)) this.enqueue(this.tree.nodes[edge.to], scoreToNumber(edge.score));
  }

  /**
   * 自分ノードに、エンジンの最善手（確定した手）を置く。ふつうはいちばん上（本線）に置くが、
   * 利用者が選んだ手（userChosen）が本線なら、本線はそのままにして、その下に置く（段階4-3 B）。
   * 前に置いた最善手（確定した手）が別の手だったら、それは「検証前の手」にする
   */
  private placeMine(node: TreeNode, line: PvLine): TreeEdge | null {
    const myMove = line.pv[0];
    const after = applyUsiMove(node.sfen, myMove);
    if (!after) return null;
    const next = this.getOrCreate(after.sfen, node.round + 1).node;
    const old = node.edges.find((e) => e.move === myMove);
    const edge: TreeEdge = { move: myMove, to: next.key, score: line.score! };
    // 利用者が選んだ手が最善手だった：印はそのまま、損は 0
    if (old?.userChosen) Object.assign(edge, { userChosen: true, loss: 0 });
    // ほかの手のうち、前の最善手（確定した手）は「検証前の手」にする
    const rest = node.edges
      .filter((e) => e.move !== myMove)
      .map((e) => (e.userChosen || e.unverified ? e : { ...e, unverified: true }));
    // 置く場所：利用者が選んだ手ならもとの場所。本線が利用者の手ならその下。それ以外はいちばん上
    const index = old?.userChosen ? node.edges.indexOf(old) : rest[0]?.userChosen ? 1 : 0;
    rest.splice(index, 0, edge);
    node.edges = rest;
    return edge;
  }
}

function compare(a: QueueItem, b: QueueItem): number {
  if (a.round !== b.round) return a.round - b.round;
  return b.priority - a.priority;
}

/**
 * 相手の応手のラベル（最善手との差 diff）を、今ある応手の中の最善手から付け直し、良い順に並べる（段階4-3）。
 * 除外した手は比べる相手から外す（最善手を除外したら、残った手の中の最善手が「本線」になる）
 */
export function relabel(node: TreeNode): void {
  if (node.edges.length === 0) return;
  // 評価値は自分から見た値なので、相手から見た値はその反対
  const oppValue = (e: TreeEdge) => -scoreToNumber(e.score);
  const best = Math.max(...node.edges.map(oppValue));
  for (const edge of node.edges) edge.diff = best - oppValue(edge);
  node.edges.sort((a, b) => a.diff! - b.diff!);
}

/** 相手の応手を除外する（edges から excluded に移し、ラベルを付け直す）。その手が無ければ false */
export function excludeMove(node: TreeNode, move: string): boolean {
  const edge = node.edges.find((e) => e.move === move);
  if (!edge) return false;
  node.edges = node.edges.filter((e) => e !== edge);
  node.excluded = [...(node.excluded ?? []), edge];
  relabel(node);
  return true;
}

/** 除外した手を戻す（excluded から edges に戻し、ラベルを付け直す）。その手が無ければ false */
export function restoreMove(node: TreeNode, move: string): boolean {
  const edge = node.excluded?.find((e) => e.move === move);
  if (!edge) return false;
  node.excluded = node.excluded!.filter((e) => e !== edge);
  if (node.excluded.length === 0) delete node.excluded;
  node.edges.push(edge);
  relabel(node);
  return true;
}

/**
 * 相手の疑問手を咎めた後の局面で、疑問手の先を止める設定（dubiousCp）のために調べていない局面か（画面の案内用）。
 * 入ってくる手順がすべて「疑問手 → 咎める手」のとき true
 */
export function isAfterDubiousOnly(tree: TreeData, key: string, dubiousCp: number | undefined = tree.settings.dubiousCp): boolean {
  if (dubiousCp === undefined) return false;
  const incoming = (to: string) => Object.values(tree.nodes).flatMap((n) => n.edges.filter((e) => e.to === to).map((e) => ({ from: n.key, edge: e })));
  const mine = incoming(key);
  if (mine.length === 0) return false;
  return mine.every(({ from }) => {
    const opp = incoming(from);
    return opp.length > 0 && opp.every(({ edge }) => edge.diff !== undefined && edge.diff > dubiousCp);
  });
}

/** 局面ごとに、そこへ入ってくる矢印の数（2 以上なら合流している） */
export function countParents(tree: TreeData): Map<string, number> {
  const counts = new Map<string, number>();
  for (const node of Object.values(tree.nodes)) {
    for (const edge of node.edges) counts.set(edge.to, (counts.get(edge.to) ?? 0) + 1);
  }
  return counts;
}
