// 定跡帳で直接指して研究を足す・消す（段階10-1、持ち主の判断 2026-11-19「おすすめの通りで」）。画面は src/app/BookScreen.tsx。
// ここは画面から切り離した計算だけ（Vitest で確かめる）。データ（1 本ずつの研究手順）の形は変えない。木の葉の 1 本 1 本が研究手順。
//
// 盤で指したとき（今の局面＝平手から here の手順）。上から順に：
//   1. すでにある次の手と同じ手 → 1 手進むだけ（データは変えない。今の研究手順がその手を通ればそのまま、無ければいちばん最近直したものへ）。
//      段階22-4：手順前後の研究手順に、同じ局面・同じ次の手があるときも、足さずにそちらへ進む
//   2. here で終わる研究手順がある → その研究手順を 1 手延ばす
//   3. それ以外 → 「here＋指した手」の新しい研究手順を作る（研究の木の外にいるときも、これ）
//   - 足した結果がほかの研究手順とまったく同じ手順になる（別の側・別のグループにある）なら足さない
//   - 定跡帳のグループから外れる手は足さない（fits で確かめる）
// 名前：段階8 の決まり（分かれ目の手がわかる形）。分かれ目＝先に作った研究手順と分かれた、いちばん深い手。
//   延ばした・縮めたときは、名前が初期値のまま（分かれ目の手数付きの形も含む）なら付け直す。自分で付けた名前は変えない
// 消す：
//   - この手から先を消す：here＋その手 を通る研究手順をまとめて消す
//   - ここで終わりにする：here より先へ進む研究手順をまとめて消す
//   - どちらも、消した結果 here を通る研究手順が 1 本も無くなるなら、1 本だけ here で終わる研究手順として残す
//     （今たどっている研究手順。それが消すものでなければ、いちばん最近直したもの）。
//     here が定跡帳の出発点・戦型の出発点・初期局面なら、残すと 0 手の研究手順になるので残さない
// 取り消し：変更（BookChange）と、変更する前の一覧から、元に戻す変更を作る（inverseChange）

import { nameFromTexts, moveTexts, startsWith, startTemplate, studyTemplate, findSameStudy, defaultStudyName } from './studies';
import { closestTemplate, type OpeningTemplate } from './templates';
import type { Study } from './types';
import { sfenKey, type Side } from '../shogi/position';
import { studyPositions } from '../review/studyReview';
import { buildBookIndex } from '../games/compare';
import { bookAtPosition, branchTarget, type BookBranch } from './studyBook';

/**
 * 手順から付け直す戦型：**自分の側が同じ戦型**のうち、いちばん長く一致するもの。無ければ付けない
 * （段階10 の直し。後手番の研究に先手番向けの戦型を付けない。付けなくても、一覧のグループは手順から決まる）
 */
export function templateIdFor(moves: readonly string[], templates: readonly OpeningTemplate[], side: Side): string | undefined {
  return closestTemplate(
    templates.filter((t) => t.mySide === side),
    moves,
  )?.id;
}

/**
 * 1 本の手順をそのまま研究手順にして定跡帳に足せるか（棋譜を貼る・ツリーや新しいツリーの画面から。段階10-2）：
 * 手が 0 本（'empty'）、出発点の戦型（自分の側が同じ、いちばん浅いもの。`startTemplate`）そのもので終わる（'start'）なら足さない
 */
export function checkNewMoves(moves: readonly string[], templates: readonly OpeningTemplate[], side: Side): 'empty' | 'start' | null {
  if (moves.length === 0) return 'empty';
  if (startTemplate(moves, side, templates)?.moves.length === moves.length) return 'start';
  return null;
}

/** 1 本の手順から作る研究手順（名前は初期値、メモは空、戦型は自分の側が同じ戦型のうちいちばん長く一致するもの） */
export function studyFromMoves(moves: readonly string[], side: Side, templates: readonly OpeningTemplate[], now: number, id: string): Study {
  const templateId = templateIdFor(moves, templates, side);
  const shape = { moves: [...moves], ...(templateId ? { templateId } : {}), mySide: side };
  return { id, name: defaultStudyName(shape, templates), note: '', ...shape, createdAt: now, updatedAt: now };
}

/** 研究手順の一覧への変更（put：保存する、remove：消す） */
export interface BookChange {
  put: Study[];
  remove: Study[];
}

/** 定跡帳で書き込むときに使うもの */
export interface BookCtx {
  templates: readonly OpeningTemplate[];
  /** 定跡帳の自分の側 */
  side: Side;
  /** 定跡帳の出発点（平手から何手目か）。ここで終わる研究手順は作らない */
  start: number;
  now: number;
  newId: () => string;
  /** その研究手順を、この定跡帳に入れてよいか（グループから外れないか） */
  fits: (study: Study) => boolean;
}

const byLatest = (a: Pick<Study, 'updatedAt'>, b: Pick<Study, 'updatedAt'>): number => b.updatedAt - a.updatedAt;

/** 2 つの手順の、同じところの長さ */
function commonLength(a: readonly string[], b: readonly string[]): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

/**
 * 研究手順の分かれ目：先に作った研究手順と分かれた、いちばん深い手（0 始まり）。無ければ undefined。
 * 片方がそこで終わっているだけ（延ばしただけ）は分かれ目にしない
 */
export function branchPoint(study: Pick<Study, 'id' | 'moves' | 'createdAt'>, pool: readonly Pick<Study, 'id' | 'moves' | 'createdAt'>[]): number | undefined {
  let at = -1;
  for (const s of pool) {
    if (s.id === study.id || s.createdAt >= study.createdAt) continue;
    const i = commonLength(s.moves, study.moves);
    if (i < s.moves.length && i < study.moves.length) at = Math.max(at, i);
  }
  return at >= 0 ? at : undefined;
}

/**
 * 名前が、その手順の初期値（分かれ目の手数付きの形も含む）のままなら、その分かれ目（無ければ undefined）。初期値でなければ null。
 * 今の決まり（出発点の戦型の後から）のほかに、段階10 の直しより前の決まり（側を問わず、記録した戦型・いちばん長く一致する戦型の後から。
 * 後が 0 手なら戦型の名前）も初期値として見る（ずれた名前を直すため）
 */
export function defaultNameMatch(study: Pick<Study, 'name' | 'moves' | 'templateId' | 'mySide'>, templates: readonly OpeningTemplate[]): { branchAt?: number } | null {
  const texts = moveTexts(study.moves);
  const legacy = { moves: study.moves, ...(study.templateId ? { templateId: study.templateId } : {}) };
  const candidates = [
    startTemplate(study.moves, study.mySide, templates, true),
    studyTemplate(legacy, templates),
    closestTemplate(templates, study.moves),
    studyTemplate(study, templates),
    null,
  ];
  const seen = new Set<string>();
  for (const t of candidates) {
    const key = t?.id ?? '';
    if (seen.has(key)) continue;
    seen.add(key);
    if (nameFromTexts(texts, t) === study.name) return {};
    for (let b = 0; b < study.moves.length; b++) if (nameFromTexts(texts, t, b) === study.name) return { branchAt: b };
  }
  return null;
}

/** 名前が、その手順の初期値のままか */
export function isDefaultName(study: Pick<Study, 'name' | 'moves' | 'templateId' | 'mySide'>, templates: readonly OpeningTemplate[]): boolean {
  return defaultNameMatch(study, templates) !== null;
}

/** 名前の初期値（出発点は `startTemplate`。分かれ目は pool の中の、先に作った研究手順から決める） */
export function autoName(study: Pick<Study, 'id' | 'moves' | 'mySide' | 'createdAt'>, pool: readonly Study[], templates: readonly OpeningTemplate[]): string {
  return nameFromTexts(moveTexts(study.moves), startTemplate(study.moves, study.mySide, templates, true), branchPoint(study, pool));
}

/**
 * ずれてしまった研究手順を直す（段階10 の直し。アプリを開いたときに毎回確かめる。直すものが無ければ何もしない）：
 *   - 記録した戦型の自分の側が研究手順と違う・手順が通らない → 自分の側が同じ戦型で付け直す（記録した戦型が見つからないときは触らない）
 *   - 名前が初期値のまま（前の決まりの初期値も含む）→ 今の決まりで付け直す（分かれ目の手数付きなら、その分かれ目を残す）。自分で付けた名前は変えない
 *   - 直した日時は変えない（「いちばん最近直した研究手順」の並びを変えないため）
 * 直した研究手順だけを返す
 */
export function fixStudies(list: readonly Study[], templates: readonly OpeningTemplate[]): Study[] {
  const out: Study[] = [];
  for (const s of list) {
    let templateId = s.templateId;
    if (templateId) {
      const t = templates.find((x) => x.id === templateId);
      if (t && (t.mySide !== s.mySide || !startsWith(s.moves, t.moves))) templateId = templateIdFor(s.moves, templates, s.mySide);
    }
    const match = defaultNameMatch(s, templates);
    const name = match ? nameFromTexts(moveTexts(s.moves), startTemplate(s.moves, s.mySide, templates, true), match.branchAt) : s.name;
    if (name === s.name && templateId === s.templateId) continue;
    const { templateId: _old, ...rest } = s;
    void _old;
    out.push({ ...rest, name, ...(templateId ? { templateId } : {}) });
  }
  return out;
}

/**
 * 手順を変えたときの戦型：自分の側が同じ、いちばん長いもの。ただし記録していた戦型をまだ通り、
 * いちばん長いものが別のグループなら、記録していた戦型のまま（取り込みで選んだグループから出ないように。段階25-1）
 */
function reshapedTemplateId(original: Pick<Study, 'templateId' | 'mySide'>, moves: readonly string[], templates: readonly OpeningTemplate[]): string | undefined {
  const longest = templateIdFor(moves, templates, original.mySide);
  const kept = templates.find((t) => t.id === original.templateId);
  if (!kept || kept.mySide !== original.mySide || !startsWith(moves, kept.moves)) return longest;
  return templates.find((t) => t.id === longest)?.group === kept.group ? longest : kept.id;
}

/** 手順を変えた研究手順（戦型は付け直す。名前は初期値のままなら付け直す。メモ・側・作った日時はそのまま） */
export function reshaped(original: Study, moves: readonly string[], pool: readonly Study[], ctx: Pick<BookCtx, 'templates' | 'now'>): Study {
  const templateId = reshapedTemplateId(original, moves, ctx.templates);
  const { templateId: _old, ...rest } = original;
  void _old;
  const next: Study = { ...rest, moves: [...moves], ...(templateId ? { templateId } : {}), updatedAt: ctx.now };
  return isDefaultName(original, ctx.templates) ? { ...next, name: autoName(next, pool, ctx.templates) } : next;
}

/** 新しい研究手順（名前は自動、メモは空、側は定跡帳の側） */
export function createdStudy(moves: readonly string[], pool: readonly Study[], ctx: BookCtx): Study {
  // 戦型は、分かれ元（手順がいちばん長く同じ研究手順。同じ長さなら最近直したもの）の記録を引き継ぐ（決まりは reshapedTemplateId）
  const source = [...pool].sort((a, b) => commonLength(b.moves, moves) - commonLength(a.moves, moves) || byLatest(a, b))[0];
  const templateId = reshapedTemplateId({ templateId: source?.templateId, mySide: ctx.side }, moves, ctx.templates);
  const shape = { id: ctx.newId(), moves: [...moves], ...(templateId ? { templateId } : {}), mySide: ctx.side, createdAt: ctx.now };
  return { ...shape, name: autoName(shape, pool, ctx.templates), note: '', updatedAt: ctx.now };
}

export type PlayResult =
  /** 1 手進むだけ（target の研究手順の index 手目へ。データは変えない）。switched：手順前後の研究手順へ切り替わる */
  | { kind: 'advance'; target: Study; index: number; switched: boolean }
  /** 延ばした（extend）・新しく作った（create）。study が書き込んだ後の研究手順 */
  | { kind: 'extend' | 'create'; change: BookChange; study: Study }
  /** ほかの研究手順とまったく同じ手順になる（この定跡帳の外にある） */
  | { kind: 'same'; other: Study }
  /** 定跡帳のグループから外れる */
  | { kind: 'outside' }
  /** 出発点より前・0 手（作らない） */
  | { kind: 'too-short' };

/**
 * 定跡帳で指したとき。pool：定跡帳の研究手順、all：端末の研究手順すべて（同じ手順の確かめ）、
 * here：今の局面までの平手からの手順、currentId：今たどっている研究手順
 */
export function playInBook(pool: readonly Study[], all: readonly Study[], here: readonly string[], move: string, currentId: string | null, ctx: BookCtx): PlayResult {
  const next = [...here, move];
  const through = pool.filter((s) => startsWith(s.moves, next));
  if (through.length > 0) return { kind: 'advance', target: through.find((s) => s.id === currentId) ?? [...through].sort(byLatest)[0], index: next.length, switched: false };
  const sfen = studyPositions(here)[here.length];
  const branch = sfen === undefined ? undefined : bookAtPosition(buildBookIndex(pool, ctx.side), here, sfen).branches.find((b) => b.move === move);
  if (branch) {
    const to = branchTarget(branch, here, currentId);
    return { kind: 'advance', target: to.study, index: to.index, switched: to.switched };
  }
  if (next.length <= ctx.start) return { kind: 'too-short' };
  const ending = here.length > 0 ? findSameStudy(pool, here) : null;
  const study = ending ? reshaped(ending, next, pool, ctx) : createdStudy(next, pool, ctx);
  const other = findSameStudy(
    all.filter((s) => s.id !== study.id),
    next,
  );
  if (other) return { kind: 'same', other };
  if (!ctx.fits(study)) return { kind: 'outside' };
  return { kind: ending ? 'extend' : 'create', change: { put: [study], remove: [] }, study };
}

/** 手順を続けて足した結果（段階20-2「エンジンに聞く」の［足す］：相手の手と自分の対応の 2 手など） */
export type LineResult =
  /** 足した（または全部すでにあって進むだけ）。change は全部まとめた 1 つの変更（取り消しは 1 回で戻る）。study は最後にたどる研究手順、index は 1 手目を指した局面がその何手目か */
  | { kind: 'ok'; change: BookChange | null; study: Study; played: number; index: number }
  /** 1 手目から足せない（playInBook と同じ理由） */
  | Extract<PlayResult, { kind: 'same' | 'outside' | 'too-short' }>;

/**
 * 手順 moves を here から続けて指したことにする（1 手ずつ playInBook と同じ決まり）。
 * 途中の手が足せなければ、そこまでで止める（played が指せた手の数）
 */
export function playLineInBook(pool: readonly Study[], all: readonly Study[], here: readonly string[], moves: readonly string[], currentId: string | null, ctx: BookCtx): LineResult {
  let curPool = [...pool];
  let curAll = [...all];
  let curHere = [...here];
  let curId = currentId;
  let study: Study | null = null;
  let played = 0;
  /** 1 手目を指した局面（そこまでの手順） */
  let first: string[] = [];
  for (const move of moves) {
    const r = playInBook(curPool, curAll, curHere, move, curId, ctx);
    let reached = [...curHere, move];
    if (r.kind === 'advance') {
      study = r.target;
      // 手順前後の研究手順へ切り替わったら、続きはその手順の上で
      reached = r.target.moves.slice(0, r.index);
    } else if ('change' in r) {
      curPool = applyChange(curPool, r.change);
      curAll = applyChange(curAll, r.change);
      study = r.study;
    } else {
      if (played === 0) return r;
      break;
    }
    curId = study.id;
    curHere = reached;
    if (played === 0) first = reached;
    played++;
  }
  return { kind: 'ok', change: diffChange(all, curAll), study: study!, played, index: plyOfPosition(study!, first) };
}

/** study の中で、手順 path を指した局面が何手目か（同じ順ならその手数。手順前後なら局面で探す） */
function plyOfPosition(study: Study, path: readonly string[]): number {
  if (startsWith(study.moves, path)) return path.length;
  const target = studyPositions(path)[path.length];
  const found = studyPositions(study.moves).findIndex((s) => target !== undefined && sfenKey(s) === sfenKey(target));
  return found < 0 ? Math.min(path.length, study.moves.length) : found;
}

/** 前と後の一覧の違いを 1 つの変更にする（変わらなければ null） */
export function diffChange(before: readonly Study[], after: readonly Study[]): BookChange | null {
  const old = new Map(before.map((s) => [s.id, s]));
  const now = new Set(after.map((s) => s.id));
  const put = after.filter((s) => old.get(s.id) !== s);
  const remove = before.filter((s) => !now.has(s.id));
  return put.length + remove.length > 0 ? { put, remove } : null;
}

/** 消す変更と、残した研究手順（here で終わる形にしたもの。残さなければ null） */
export interface CutPlan extends BookChange {
  kept: Study | null;
}

/** removed を消す。here を通る研究手順が無くなるなら 1 本を here で終わる形にして残す */
function removeKeepingHere(pool: readonly Study[], here: readonly string[], removed: readonly Study[], currentId: string | null, ctx: Pick<BookCtx, 'templates' | 'now' | 'start' | 'side'>): CutPlan {
  const ids = new Set(removed.map((s) => s.id));
  const rest = pool.filter((s) => !ids.has(s.id));
  const covered = rest.some((s) => startsWith(s.moves, here));
  // 出発点（定跡帳の出発点・戦型の出発点・初期局面）で終わる研究手順は残さない
  if (covered || here.length <= ctx.start || checkNewMoves(here, ctx.templates, ctx.side) !== null) return { put: [], remove: [...removed], kept: null };
  const keep = removed.find((s) => s.id === currentId) ?? [...removed].sort(byLatest)[0];
  const kept = reshaped(keep, here, rest, ctx);
  return { put: [kept], remove: removed.filter((s) => s.id !== keep.id), kept };
}

/** この手から先を消す（here＋move を通る研究手順をまとめて）。消すものが無ければ null */
export function cutBranch(pool: readonly Study[], here: readonly string[], move: string, currentId: string | null, ctx: Pick<BookCtx, 'templates' | 'now' | 'start' | 'side'>): CutPlan | null {
  const removed = pool.filter((s) => startsWith(s.moves, [...here, move]));
  return removed.length > 0 ? removeKeepingHere(pool, here, removed, currentId, ctx) : null;
}

/** その研究手順が、局面 key で move を指すときの、そこまでの手順（指さなければ null） */
function prefixPlaying(study: Study, key: string, move: string): string[] | null {
  const positions = studyPositions(study.moves);
  const ply = study.moves.findIndex((m, i) => m === move && positions[i] !== undefined && sfenKey(positions[i]) === key);
  return ply < 0 ? null : study.moves.slice(0, ply);
}

/** 局面 key で move を指す、自分の側が同じ研究手順（手順前後も） */
export function studiesPlaying(studies: readonly Study[], side: Side, key: string, move: string): Study[] {
  return studies.filter((s) => s.mySide === side && prefixPlaying(s, key, move) !== null);
}

/**
 * 局面 key の move から先を消す（段階21-1：研究手順が通っている手を悪手にするとき）。手順前後で来る研究手順も。
 * 手順ごとに「この手から先を消す」と同じ決まり。count はその手を指していた研究手順の数。無ければ null
 */
export function cutMoveAt(
  studies: readonly Study[],
  side: Side,
  key: string,
  move: string,
  currentId: string | null,
  ctx: Pick<BookCtx, 'templates' | 'now' | 'start' | 'side'>,
): (BookChange & { count: number }) | null {
  const targets = studiesPlaying(studies, side, key, move);
  if (targets.length === 0) return null;
  const change = cutAll(studies, side, targets.map((s) => prefixPlaying(s, key, move)!), move, currentId, ctx);
  return change ? { ...change, count: targets.length } : null;
}

/** 手順 prefixes のそれぞれで「この手から先を消す」を順に行い、まとめて 1 つの変更にする */
function cutAll(
  studies: readonly Study[],
  side: Side,
  prefixes: readonly (readonly string[])[],
  move: string,
  currentId: string | null,
  ctx: Pick<BookCtx, 'templates' | 'now' | 'start' | 'side'>,
): BookChange | null {
  let same = studies.filter((s) => s.mySide === side);
  let all = [...studies];
  for (const prefix of prefixes) {
    const plan = cutBranch(same, prefix, move, currentId, ctx);
    if (!plan) continue;
    same = applyChange(same, plan);
    all = applyChange(all, plan);
  }
  return diffChange(studies, all);
}

/** 定跡帳の行の「この手から先を消す」の中身：消す変更と、その手を指していた研究手順の数・残す研究手順 */
export interface RowCut extends BookChange {
  count: number;
}

/**
 * 定跡帳の行の「この手から先を消す」（段階22-4：行は同じ局面の研究手順をまとめて出すので、手順前後で来るものも一緒に消す）。
 * **消すのは行に出ている研究手順だけ**で、切る位置は行を作ったときの局面（今の手順どおりのものは今の盤の位置。同じ局面を 2 回通っても前の所では切らない）。
 * 手順ごとの決まりは cutBranch と同じ。消すものが無ければ null
 */
export function cutRow(
  pool: readonly Study[],
  here: readonly string[],
  branch: BookBranch<Study>,
  currentId: string | null,
  ctx: Pick<BookCtx, 'templates' | 'now' | 'start' | 'side'>,
): RowCut | null {
  const prefixes = branch.studies.map((s) => (startsWith(s.moves, [...here, branch.move]) ? here : s.moves.slice(0, branch.plies?.get(s.id) ?? here.length)));
  const change = cutAll(pool, ctx.side, prefixes, branch.move, currentId, ctx);
  return change ? { ...change, count: branch.studies.length } : null;
}

/** ここで終わりにする（here より先へ進む研究手順をまとめて）。消すものが無ければ null */
export function endHere(pool: readonly Study[], here: readonly string[], currentId: string | null, ctx: Pick<BookCtx, 'templates' | 'now' | 'start' | 'side'>): CutPlan | null {
  const removed = pool.filter((s) => s.moves.length > here.length && startsWith(s.moves, here));
  return removed.length > 0 ? removeKeepingHere(pool, here, removed, currentId, ctx) : null;
}

/** 変更を取り消す変更（before：変更する前の研究手順の一覧） */
export function inverseChange(change: BookChange, before: readonly Study[]): BookChange {
  const old = new Map(before.map((s) => [s.id, s]));
  return {
    put: [...change.remove, ...change.put.flatMap((s) => (old.has(s.id) ? [old.get(s.id)!] : []))],
    remove: change.put.filter((s) => !old.has(s.id)),
  };
}

/** 一覧に変更を当てる（画面の外で確かめる用） */
export function applyChange(list: readonly Study[], change: BookChange): Study[] {
  const gone = new Set([...change.remove.map((s) => s.id), ...change.put.map((s) => s.id)]);
  return [...list.filter((s) => !gone.has(s.id)), ...change.put];
}

/** 盤に出す手順と局面 */
export interface BookView {
  /** 今たどっている研究手順（研究の木の外なら null） */
  id: string | null;
  /** 平手からの手順（研究手順の手順。木の外なら仮の手順） */
  line: string[];
  /** 平手から何手目か */
  index: number;
}

/**
 * 研究手順が変わった後の、盤に出す手順と局面：
 *   - prefer の研究手順が今の局面を通っていれば、そのまま
 *   - 無ければ、今の局面から前へ戻りながら、そこを通る研究手順を探す（今の手順といちばん長く同じもの → 最近直したもの）
 *   - 研究手順が 1 本も無ければ、今の手順のまま（木の外）
 */
export function settleView(pool: readonly Study[], line: readonly string[], index: number, prefer: string | null): BookView {
  const pref = pool.find((s) => s.id === prefer);
  if (pref && startsWith(pref.moves, line.slice(0, index))) return { id: pref.id, line: [...pref.moves], index };
  for (let i = Math.min(index, line.length); i >= 0; i--) {
    const here = line.slice(0, i);
    const found = pool
      .filter((s) => startsWith(s.moves, here))
      .sort((a, b) => commonLength(b.moves, line) - commonLength(a.moves, line) || byLatest(a, b))[0];
    if (found) return { id: found.id, line: [...found.moves], index: i };
  }
  return { id: null, line: [...line], index: Math.min(index, line.length) };
}

/** 研究の木（pool）が通っている、line のいちばん深い局面（平手から何手目か） */
export function coveredDepth(pool: readonly Pick<Study, 'moves'>[], line: readonly string[]): number {
  let depth = 0;
  for (const s of pool) depth = Math.max(depth, commonLength(s.moves, line));
  return pool.length > 0 ? depth : 0;
}
