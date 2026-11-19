// 研究手順：気になる手順に名前とメモを付けて保存する（しおり）。
// 段階7-2 ではツリーの中に保存していたが、段階8-1（持ち主の判断 2026-11-18）から**ツリーとは独立したデータ**にした。
//   - 手順は「平手の初期局面からの指し手（USI）の並び」。駒落ち・途中の局面から始まる手順は対象外
//   - 登録にエンジンは使わない（盤で指す・棋譜を貼る・ツリーの中から）
//   - ツリーとは「平手からの手順がまったく同じか」だけでつなぐ（★・終わりの局面の名前・「ツリーで見る」）。
//     手順前後で同じ局面に合流した場合は対象外
//   - 同じ手順の研究手順は 1 つだけ（保存を押すと、すでにあればそれを直す画面）
// 形式 6 までのツリーの中の研究手順は、migrateTrees で独立した研究手順へ移す（端末の保存場所を新しい版にするとき・JSON を取り込むとき）。

import { STARTPOS_SFEN, applyUsiMove, moveText, type Side } from '../shogi/position';
import { closestTemplate, type OpeningTemplate } from './templates';
import type { Study, TreeData, TreeStudy } from './types';

export type { Study } from './types';

/** 新しい研究手順の id */
export function newStudyId(): string {
  return `s-${crypto.randomUUID()}`;
}

/** 手順がまったく同じか */
export const sameMoves = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((m, i) => m === b[i]);

/** moves が head で始まるか（head と同じ長さも含む） */
export const startsWith = (moves: readonly string[], head: readonly string[]): boolean =>
  moves.length >= head.length && head.every((m, i) => moves[i] === m);

/** 同じ手順の研究手順（あれば） */
export function findSameStudy<S extends Pick<Study, 'moves'>>(list: readonly S[], moves: readonly string[]): S | null {
  return list.find((s) => sameMoves(s.moves, moves)) ?? null;
}

/** 名前とメモを確かめる。問題が無ければ null */
export function checkStudyFields(f: { name: string; note: string }): string | null {
  if (f.name.trim() === '') return '名前を入れてください。';
  if (f.name.trim().length > 100) return '名前は 100 文字までです。';
  if (f.note.length > 3000) return 'メモは 3000 文字までです。';
  return null;
}

/** メモの最初の 1 行（一覧用） */
export function firstLine(note: string): string {
  return note.split(/\r?\n/).find((l) => l.trim() !== '')?.trim() ?? '';
}

// ---------------------------------------------------------------------------
// 手順の文字・戦型・名前の初期値

/** 平手からの手順を 1 手ずつ日本語にする（例：["▲７六歩", "△３四歩"]）。指せない手があれば、そこまで */
export function moveTexts(moves: readonly string[]): string[] {
  const texts: string[] = [];
  let sfen = STARTPOS_SFEN;
  let prev: string | undefined;
  for (const move of moves) {
    const next = applyUsiMove(sfen, move);
    if (!next) break;
    texts.push(moveText(sfen, move, prev));
    sfen = next.sfen;
    prev = move;
  }
  return texts;
}

/**
 * 研究手順の戦型：記録した戦型が今もあればそれ、無ければ手順がいちばん長く一致する戦型（7-1 と同じ決まり）。
 * 段階10 の直し（持ち主の判断 2026-11-19）：自分の側（mySide）を渡すと、**自分の側が同じ戦型**を先に見る
 * （記録した戦型の側が違えば使わない。自分の側が同じ戦型が 1 つも当てはまらなければ、側を問わずいちばん長いもの）。
 * 研究手順だけの復習の出題は、この戦型の出発点の後から
 */
export function studyTemplate(study: Pick<Study, 'moves' | 'templateId'> & { mySide?: Side }, templates: readonly OpeningTemplate[]): OpeningTemplate | null {
  const side = study.mySide;
  if (study.templateId) {
    const t = templates.find((x) => x.id === study.templateId);
    if (t && startsWith(study.moves, t.moves) && (!side || t.mySide === side)) return t;
  }
  if (side) {
    const same = closestTemplate(
      templates.filter((t) => t.mySide === side),
      study.moves,
    );
    if (same) return same;
  }
  return closestTemplate(templates, study.moves);
}

/** 戦型の出発点が何手目か（手順がどの戦型にも当てはまらなければ 0＝初期局面） */
export function studyStartIndex(study: Pick<Study, 'moves' | 'templateId'> & { mySide?: Side }, templates: readonly OpeningTemplate[]): number {
  return studyTemplate(study, templates)?.moves.length ?? 0;
}

/** いちばん浅い（手数が短い）戦型 */
function shallowest(list: readonly OpeningTemplate[]): OpeningTemplate | null {
  return list.reduce<OpeningTemplate | null>((best, t) => (!best || t.moves.length < best.moves.length ? t : best), null);
}

/**
 * 研究手順の出発点の戦型（段階10 の直し）：手順が通る、**自分の側が同じ戦型のうち、いちばん浅いもの**。
 * 自分の側が同じ戦型が 1 つも通らなければ、側を問わずいちばん浅いもの。どれも通らなければ null（平手の初期局面）。
 * shorter：手順より短い戦型だけ（名前を付けるとき。出発点の後が 0 手の名前＝戦型の名前だけ、にしないため）。
 * 横歩取りの例：後手番は 16 手目 △3三角、先手番は 15 手目 ▲3四飛（基本図）
 */
export function startTemplate(moves: readonly string[], side: Side, templates: readonly OpeningTemplate[], shorter = false): OpeningTemplate | null {
  const passing = templates.filter((t) => startsWith(moves, t.moves) && (!shorter || t.moves.length < moves.length));
  return shallowest(passing.filter((t) => t.mySide === side)) ?? shallowest(passing);
}

/**
 * 名前の初期値：研究の分かれ目がわかるように、出発点の戦型（`startTemplate`。分からなければ初期局面）より後の手順から作る。
 * 段階10 の直し：出発点は、その研究手順が通る自分の側が同じ、いちばん浅い戦型（手順より短いもの。戦型の名前だけの名前にしない）
 *   - 4 手までなら全部（「▲３六飛 △８四飛 ▲２六飛 △２二銀」）
 *   - 5 手以上なら最初の手と最後の手（「▲３六飛 … △２二銀」）。最初の手（いちばん大事な分かれ目）は必ず入れる
 *   - branchAt（変化付き KIF の取り込み、段階8-2）：本譜から分かれた手（0 始まり）。最初と最後の間なら手数付きで入れる
 *     （「▲３六飛 … 20手目 △８四飛 … ▲３四飛」）
 *   - 出発点そのもので終わるなら、戦型の名前（無ければ「平手の初期局面」）
 */
export function defaultStudyName(study: Pick<Study, 'moves' | 'mySide'>, templates: readonly OpeningTemplate[], branchAt?: number): string {
  return nameFromTexts(moveTexts(study.moves), startTemplate(study.moves, study.mySide, templates, true), branchAt);
}

/** 名前の初期値を、手の文字（平手から 1 手ずつ）と戦型から作る（defaultStudyName の中身。文字を作り直さずに済むように分けた） */
export function nameFromTexts(texts: readonly string[], template: Pick<OpeningTemplate, 'name' | 'moves'> | null, branchAt?: number): string {
  const start = template?.moves.length ?? 0;
  const rest = texts.slice(start);
  if (rest.length === 0) return template?.name ?? '平手の初期局面';
  if (rest.length <= 4) return rest.join(' ');
  const last = texts.length - 1;
  const parts = [texts[start]];
  if (branchAt !== undefined && branchAt > start && branchAt < last) parts.push(`${branchAt + 1}手目 ${texts[branchAt]}`);
  parts.push(texts[last]);
  return parts.join(' … ');
}

/** 手順の文（保存の窓に出す）：出発点の戦型（名前と同じ決まり）が分かれば「戦型名 → その後の手順」、無ければ初手から */
export function studyMovesText(study: Pick<Study, 'moves' | 'mySide'>, templates: readonly OpeningTemplate[]): string {
  const template = startTemplate(study.moves, study.mySide, templates, true);
  const texts = moveTexts(study.moves);
  if (!template) return texts.join(' ');
  const rest = texts.slice(template.moves.length);
  return rest.length > 0 ? `${template.name} → ${rest.join(' ')}` : template.name;
}

// ---------------------------------------------------------------------------
// ツリーとのつながり（平手からの手順がまったく同じときだけ）

/** ツリーの開始局面までの、平手からの手順（平手の初期局面から始まらないツリーは null） */
export function treeBaseMoves(tree: Pick<TreeData, 'prefix'>): string[] | null {
  return tree.prefix.initialSfen === STARTPOS_SFEN ? tree.prefix.moves : null;
}

/** 開始局面からのキーの並び（閲覧画面の path）を、指し手の並びにする */
export function movesOfPath(tree: TreeData, path: readonly string[]): string[] {
  const moves: string[] = [];
  for (let i = 1; i < path.length; i++) {
    const edge = tree.nodes[path[i - 1]]?.edges.find((e) => e.to === path[i]);
    if (!edge) break;
    moves.push(edge.move);
  }
  return moves;
}

export interface StudyTrace {
  /** たどれた局面のキー（開始局面から。閲覧画面の path にそのまま使える） */
  keys: string[];
  /** たどれた手の数 */
  reached: number;
  /** 最後までたどれたか */
  complete: boolean;
}

/** ツリーの開始局面からの手順を、ツリーの手（除外した手は使わない）でたどる */
export function traceStudy(tree: TreeData, moves: readonly string[]): StudyTrace {
  const keys = [tree.rootKey];
  for (const move of moves) {
    const node = tree.nodes[keys[keys.length - 1]];
    const edge = node?.edges.find((e) => e.move === move);
    if (!edge || !tree.nodes[edge.to]) break;
    keys.push(edge.to);
  }
  return { keys, reached: keys.length - 1, complete: keys.length - 1 === moves.length };
}

/**
 * 平手からの手順（の最初の ply 手）が、ツリーの中に最後まであれば、閲覧画面の path（開始局面からのキーの並び）。
 * ツリーの開始局面を通らない・途中でたどれなければ null（「ツリーで見る」の対象にしない）
 */
export function pathInTree(tree: TreeData, moves: readonly string[]): string[] | null {
  const base = treeBaseMoves(tree);
  if (!base || !startsWith(moves, base)) return null;
  const trace = traceStudy(tree, moves.slice(base.length));
  return trace.complete ? trace.keys : null;
}

/**
 * 平手から今の局面までの手順が、研究手順の途中なら、その研究手順の次の手（★を付ける手）。
 * どこで作った研究手順か（ツリーの中・独立して登録）は関係ない。合流（別の手順から同じ局面に来た）では付けない
 */
export function studyNextMoves(studies: readonly Pick<Study, 'moves'>[], movesHere: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const s of studies) {
    if (s.moves.length > movesHere.length && startsWith(s.moves, movesHere)) out.add(s.moves[movesHere.length]);
  }
  return out;
}

/** 今の局面で終わる研究手順（同じ手順は 1 つだけなので、あれば 1 つ） */
export function studyEndingAt<S extends Pick<Study, 'moves'>>(studies: readonly S[], movesHere: readonly string[]): S | null {
  return findSameStudy(studies, movesHere);
}

// ---------------------------------------------------------------------------
// 形式 6 までのツリーの中の研究手順 → 独立した研究手順（移し替え）

/** ツリーの中の研究手順を、平手からの手順の研究手順にする（ツリーは書き換えない）。平手から始まらないツリーは null */
export function liftTreeStudies(tree: TreeData): Study[] | null {
  const base = treeBaseMoves(tree);
  if (!base) return null;
  return (tree.studies ?? [])
    .map(
      (s: TreeStudy): Study => ({
        id: s.id,
        name: s.name,
        note: s.note,
        moves: [...base, ...s.moves],
        mySide: tree.mySide,
        ...(tree.templateId ? { templateId: tree.templateId } : {}),
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      }),
    )
    .filter((s) => s.moves.length > 0);
}

/** メモをつなぐときの区切り */
export const NOTE_JOIN = '\n――\n';

/**
 * 同じ手順の研究手順を 1 本にまとめる（持ち主の判断 2026-11-18）：
 * 名前・id・自分の側・戦型は直した日時が新しい方、メモは違えば両方つなぐ（消えるものが無いように）、作った日時はいちばん古いもの
 */
export function mergeSameMoves(list: readonly Study[]): Study[] {
  const out: Study[] = [];
  const sorted = [...list].sort((a, b) => b.updatedAt - a.updatedAt);
  for (const s of sorted) {
    const base = findSameStudy(out, s.moves);
    if (!base) {
      out.push({ ...s, moves: [...s.moves] });
      continue;
    }
    base.createdAt = Math.min(base.createdAt, s.createdAt);
    const note = s.note.trim();
    if (note !== '' && !base.note.split(NOTE_JOIN).some((part) => part.trim() === note)) {
      base.note = base.note.trim() === '' ? s.note : `${base.note}${NOTE_JOIN}${s.note}`;
    }
  }
  return out;
}

export interface TreeMigration {
  /** 独立した研究手順（同じ手順はまとめた） */
  studies: Study[];
  /** 研究手順を外したツリー（書き戻す。形式は 7 にする） */
  changed: TreeData[];
  /** 平手から始まらないツリーに残した研究手順の数（消さない） */
  leftover: number;
}

/**
 * ツリーの中の研究手順を、独立した研究手順に移す見通しを作る（ツリーは複製して書き換えるので、元のデータは変えない）。
 * 端末の保存場所を版 4 にするときに 1 回だけ使う（src/storage/db.ts）。JSON を取り込むときも同じ
 */
export function migrateTrees(trees: readonly TreeData[]): TreeMigration {
  const lifted: Study[] = [];
  const changed: TreeData[] = [];
  let leftover = 0;
  for (const tree of trees) {
    if (!tree.studies || tree.studies.length === 0) continue;
    const studies = liftTreeStudies(tree);
    if (!studies) {
      leftover += tree.studies.length;
      continue;
    }
    lifted.push(...studies);
    const { studies: _removed, ...rest } = tree;
    changed.push({ ...rest, version: Math.max(tree.version, 7) });
  }
  return { studies: mergeSameMoves(lifted), changed, leftover };
}

/**
 * 取り込んだ研究手順のうち、まだ無い手順のものだけ（同じ手順がすでにあれば足さない。ツリーの JSON の取り込み用）。
 * 取り込むものどうしで同じ手順なら、まとめてから比べる
 */
export function missingStudies(existing: readonly Pick<Study, 'moves'>[], incoming: readonly Study[]): { added: Study[]; skipped: number } {
  const merged = mergeSameMoves(incoming);
  const added = merged.filter((s) => !findSameStudy(existing, s.moves));
  return { added, skipped: incoming.length - added.length };
}

/** 自分の側の初期値（棋譜から登録するとき）：戦型が分かればその側、無ければ最後の手を指した側 */
export function guessSide(moves: readonly string[], templates: readonly OpeningTemplate[]): Side {
  const t = closestTemplate(templates, moves);
  if (t) return t.mySide;
  return moves.length % 2 === 1 ? 'black' : 'white';
}
