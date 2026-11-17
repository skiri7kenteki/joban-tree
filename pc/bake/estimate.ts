// 進み具合と、全体の見込み（局面の数・時間）。ツリーの中身だけから計算する（途中から再開しても同じ値になる）。

import { isOpponentNode } from '../../src/tree/generator';
import { liveNodes } from '../../src/tree/bundled';
import type { TreeData } from '../../src/tree/types';

/** 往復ごとの数 */
export interface RoundStat {
  round: number;
  /** 調べる相手の局面の数（わかっている分）・調べ終わった数 */
  opp: number;
  oppDone: number;
  /** 調べる自分の局面の数（わかっている分）・調べ終わった数 */
  mine: number;
  mineDone: number;
}

export function roundStats(tree: TreeData, maxRounds: number): RoundStat[] {
  const stats: RoundStat[] = Array.from({ length: maxRounds }, (_, round) => ({ round, opp: 0, oppDone: 0, mine: 0, mineDone: 0 }));
  for (const node of liveNodes(tree, maxRounds)) {
    const opp = isOpponentNode(tree, node);
    const round = node.round < 0 ? 0 : node.round;
    if (round >= maxRounds) continue;
    const s = stats[round];
    const done = !!node.searched || !!node.terminal;
    if (opp) {
      s.opp++;
      if (done) s.oppDone++;
    } else {
      s.mine++;
      if (done) s.mineDone++;
    }
  }
  return stats;
}

/** 終わった往復の数（0 往復目から続けて、相手の局面も自分の局面もすべて調べ終わった往復の数） */
export function completedRounds(stats: RoundStat[]): number {
  let n = 0;
  for (const s of stats) {
    if (s.opp === 0 || s.oppDone < s.opp || s.mineDone < s.mine) break;
    n++;
  }
  return n;
}

export interface Projection {
  /** 終わった往復の数 */
  completed: number;
  /** 往復ごとの相手の局面の数の伸び（1 往復でおよそ何倍になるか） */
  growth: number;
  /** 相手の局面 1 つあたりの自分の局面の数（相手の応手の数の平均） */
  minePerOpp: number;
  /** 全体の見込み：相手の局面・自分の局面の数（調べるもの） */
  totalOpp: number;
  totalMine: number;
  /** ツリーの局面の数の見込み（深さの上限の葉も含む） */
  totalNodes: number;
  /** 残りの時間の見込み（ミリ秒） */
  remainingMs: number;
}

/**
 * 1 往復目以降が終わったところで、終わった往復の数から先を見込む。
 * 伸び（growth）は、最後に終わった往復の「相手の局面の数」と、その次の往復の相手の局面の数（わかっている）の比。
 * oppMs・mineMs は、実際に 1 局面を調べるのにかかった時間の平均
 */
export function project(stats: RoundStat[], oppMs: number, mineMs: number): Projection | null {
  const completed = completedRounds(stats);
  if (completed === 0) return null;
  const last = stats[completed - 1];
  const next = stats[completed];
  const minePerOpp = last.opp > 0 ? last.mine / last.opp : 0;
  // 最後の往復まで終わった：残りは無い
  if (!next) {
    const totalOpp = stats.reduce((a, s) => a + s.opp, 0);
    const totalMine = stats.reduce((a, s) => a + s.mine, 0);
    return { completed, growth: 0, minePerOpp, totalOpp, totalMine, totalNodes: 1 + 2 * totalMine, remainingMs: 0 };
  }
  const growth = last.opp > 0 ? next.opp / last.opp : 0;
  let totalOpp = 0;
  let totalMine = 0;
  let remainingMs = 0;
  for (const s of stats) {
    let opp = s.opp;
    let mine = s.mine;
    if (s.round >= completed) {
      // 次の往復の相手の局面の数はわかっている。その先は伸びから見込む（わかっている数より少なくはしない）
      if (s.round > completed) opp = Math.max(s.opp, next.opp * growth ** (s.round - completed));
      // 自分の局面は、まだ調べていない相手の局面 1 つあたり minePerOpp 個
      mine = s.mine + Math.max(0, opp - s.oppDone) * minePerOpp;
    }
    totalOpp += opp;
    totalMine += mine;
    remainingMs += Math.max(0, opp - s.oppDone) * oppMs + Math.max(0, mine - s.mineDone) * mineMs;
  }
  return {
    completed,
    growth,
    minePerOpp,
    totalOpp: Math.round(totalOpp),
    totalMine: Math.round(totalMine),
    // 自分の局面 1 つにつき、その手の後の局面が 1 つ（合流の分だけ少し多めの見込み）
    totalNodes: Math.round(1 + 2 * totalMine),
    remainingMs: Math.round(remainingMs),
  };
}

/** 1:23:45 の形 */
export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

/** 「約 1 時間 20 分」の形 */
export function formatRough(ms: number): string {
  const min = Math.max(1, Math.round(ms / 60_000));
  if (min < 60) return `約 ${min} 分`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `約 ${h} 時間` : `約 ${h} 時間 ${m} 分`;
}
