// 研究手順どうしをつないで見る（段階9-2、自分の定跡帳）。エンジンは使わない。
// 持ち主の判断（2026-11-18「おすすめの通りで」）：
//   - 定跡帳の画面は、**同じ局面**（手数を除いた SFEN）を通る研究手順をつなぐ（段階22-4。`bookAtPosition`。前は手順がまったく同じ部分だけ）。
//     KIF の書き出し（`bookAt`・`bookOrder`）は今まで通り、手順がまったく同じ部分だけ
//   - つないだツリーは保存せず、開くたびに研究手順の一覧から組み立てる（データの形は変えない）
//   - 次の手の並びは、その手を通る研究手順の多い順。同じなら、いちばん最近直した研究手順が新しい順。KIF の本譜・変化の並びも同じ
//   - 違う手を押したら、その手を通る研究手順のうち、いちばん最近直したものに切り替える
//   - 定跡帳の出発点は、そのグループの研究手順が全部通る、自分の側が同じ、いちばん浅い戦型の出発点（段階10 の直し。前はいちばん深いもの）（無ければ平手の初期局面）

import type { BookIndex } from '../games/compare';
import { sfenKey } from '../shogi/position';
import { startsWith } from './studies';
import type { OpeningTemplate } from './templates';
import type { Study } from './types';

type BookStudy = Pick<Study, 'moves' | 'updatedAt'>;

/** ある局面からの次の手 1 つと、その手を通る研究手順（いちばん最近直したものが先） */
export interface BookBranch<S extends BookStudy> {
  move: string;
  studies: S[];
  /** 研究手順ごとの、この局面が何手目か（局面でつなぐときだけ） */
  plies?: ReadonlyMap<string, number>;
  /** どの研究手順も、今の手順とは違う順でこの局面に来る（手順前後） */
  transposed?: boolean;
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

/**
 * 局面でつなぐ（段階22-4）：局面 sfen を通る研究手順すべての次の手。index は定跡帳の研究手順の局面の索引（`buildBookIndex`）、
 * here は今の局面までの手順。並びは bookAt と同じ
 */
export function bookAtPosition(index: BookIndex, here: readonly string[], sfen: string): BookPosition<Study> {
  /** 研究手順ごとに、この局面が何手目か（2 回通るなら、今の手順と同じ所。無ければ最初） */
  const plies = new Map<Study, number>();
  for (const { study, ply } of index.get(sfenKey(sfen))?.through ?? []) {
    if (!plies.has(study) || (ply === here.length && startsWith(study.moves, here))) plies.set(study, ply);
  }
  const ending: Study[] = [];
  const byMove = new Map<string, Study[]>();
  for (const [study, ply] of plies) {
    if (ply >= study.moves.length) {
      ending.push(study);
      continue;
    }
    const move = study.moves[ply];
    const list = byMove.get(move);
    if (list) list.push(study);
    else byMove.set(move, [study]);
  }
  const branches = [...byMove]
    .map(([move, list]) => ({
      move,
      studies: list.sort(byLatest),
      plies: new Map(list.map((s) => [s.id, plies.get(s)!])),
      transposed: !list.some((s) => startsWith(s.moves, [...here, move])),
    }))
    .sort(compareBranches);
  return { count: plies.size, branches, ending: ending.sort(byLatest) };
}

/**
 * 局面でつないだ行を押したときの行き先。今の手順どおりに進める研究手順があれば、その中で今たどっているもの、無ければいちばん最近直したもの。
 * 無ければ手順前後の研究手順の、同じ局面の次へ（switched：たどる手順が切り替わる）。index は行き先が何手目か
 */
export function branchTarget(branch: BookBranch<Study>, here: readonly string[], currentId: string | null): { study: Study; index: number; switched: boolean } {
  const next = [...here, branch.move];
  const same = branch.studies.filter((s) => startsWith(s.moves, next));
  const list = same.length > 0 ? same : branch.studies;
  const study = list.find((s) => s.id === currentId) ?? list[0];
  return same.length > 0 ? { study, index: next.length, switched: false } : { study, index: (branch.plies?.get(study.id) ?? here.length) + 1, switched: true };
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
