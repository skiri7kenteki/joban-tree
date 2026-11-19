// 研究手順どうしをつないで見る（段階9-2、自分の定跡帳）。エンジンは使わない。
// 持ち主の判断（2026-11-18「おすすめの通りで」）：
//   - つなぐのは、平手の初期局面からの手順がまったく同じ部分だけ（★と同じ考え方。手順前後で同じ局面に合流してもつながない）
//   - つないだツリーは保存せず、開くたびに研究手順の一覧から組み立てる（データの形は変えない）
//   - 次の手の並びは、その手を通る研究手順の多い順。同じなら、いちばん最近直した研究手順が新しい順。KIF の本譜・変化の並びも同じ
//   - 違う手を押したら、その手を通る研究手順のうち、いちばん最近直したものに切り替える
//   - 定跡帳の出発点は、そのグループの研究手順が全部通る、自分の側が同じ、いちばん浅い戦型の出発点（段階10 の直し。前はいちばん深いもの）（無ければ平手の初期局面）

import { startsWith } from './studies';
import type { OpeningTemplate } from './templates';
import type { Study } from './types';

type BookStudy = Pick<Study, 'moves' | 'updatedAt'>;

/** ある局面からの次の手 1 つと、その手を通る研究手順（いちばん最近直したものが先） */
export interface BookBranch<S extends BookStudy> {
  move: string;
  studies: S[];
}

/** ある局面（平手からの手順 movesHere）での、研究手順のつながり */
export interface BookPosition<S extends BookStudy> {
  /** この局面を通る（ここで終わるものも含む）研究手順の数 */
  count: number;
  /** 次の手ごとの研究手順（並びは研究手順の多い順 → いちばん最近直した日の新しい順） */
  branches: BookBranch<S>[];
  /** この局面で終わる研究手順（いちばん最近直したものが先） */
  ending: S[];
}

/** 直した日の新しい順 */
const byLatest = <S extends BookStudy>(a: S, b: S): number => b.updatedAt - a.updatedAt;

/** 次の手の並べ方：研究手順の多い順、同じならいちばん最近直したものが新しい順 */
function compareBranches<S extends BookStudy>(a: BookBranch<S>, b: BookBranch<S>): number {
  if (a.studies.length !== b.studies.length) return b.studies.length - a.studies.length;
  return b.studies[0].updatedAt - a.studies[0].updatedAt;
}

/** 平手からの手順 movesHere の局面で、研究手順 studies がどうつながっているか */
export function bookAt<S extends BookStudy>(studies: readonly S[], movesHere: readonly string[]): BookPosition<S> {
  const through = studies.filter((s) => startsWith(s.moves, movesHere));
  const ending: S[] = [];
  const byMove = new Map<string, S[]>();
  for (const s of through) {
    if (s.moves.length === movesHere.length) {
      ending.push(s);
      continue;
    }
    const move = s.moves[movesHere.length];
    const list = byMove.get(move);
    if (list) list.push(s);
    else byMove.set(move, [s]);
  }
  const branches = [...byMove].map(([move, list]) => ({ move, studies: list.sort(byLatest) })).sort(compareBranches);
  return { count: through.length, branches, ending: ending.sort(byLatest) };
}

/** 次の手を押したときに切り替える研究手順：その手を通るもののうち、いちばん最近直したもの */
export function switchTarget<S extends BookStudy>(branch: BookBranch<S>): S {
  return branch.studies[0];
}

/**
 * 定跡帳の出発点（平手から何手目か）。段階10 の直し（持ち主の判断 2026-11-19）：研究を足しても奥へずれないように、
 * 研究手順（と今の手順）が全部通る、**自分の側が同じ戦型のうち、いちばん浅いもの**。
 * 自分の側が同じ戦型で全部が通るものが無ければ、側を問わず全部が通るいちばん浅いもの。それも無ければ 0（平手の初期局面）。
 * 横歩取りの例：後手番は 16 手目 △3三角、先手番は 15 手目 ▲3四飛（基本図）
 */
export function bookStart(
  studies: readonly Pick<Study, 'moves'>[],
  templates: readonly Pick<OpeningTemplate, 'moves' | 'mySide'>[],
  side: OpeningTemplate['mySide'],
): number {
  if (studies.length === 0) return 0;
  const all = templates.filter((t) => studies.every((s) => startsWith(s.moves, t.moves)));
  const pick = (list: readonly Pick<OpeningTemplate, 'moves'>[]) => (list.length > 0 ? Math.min(...list.map((t) => t.moves.length)) : null);
  return pick(all.filter((t) => t.mySide === side)) ?? pick(all) ?? 0;
}

/**
 * KIF に書き出す並び：出発点から、各局面の次の手を bookAt と同じ順にたどった順（深さ優先）。
 * studiesToKif は最初の研究手順を本譜にし、同じ局面の手は入れた順に変化として並ぶので、画面の並びと KIF の並びがそろう。
 * その局面で終わる研究手順は、その局面から先の研究手順の後に置く（本譜が途中で止まらないように）
 */
export function bookOrder<S extends BookStudy>(studies: readonly S[]): S[] {
  const out: S[] = [];
  const walk = (list: readonly S[], depth: number) => {
    const here = bookAt(list, list[0].moves.slice(0, depth));
    for (const b of here.branches) walk(b.studies, depth + 1);
    out.push(...here.ending);
  };
  if (studies.length > 0) walk(studies, 0);
  return out;
}
