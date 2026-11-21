// 戦型テンプレート（段階5）。戦型＝「その戦型の出発点の局面までの、平手の初期局面からの手順」。
// エンジンは戦型の名前を知らないので、ツリーの生成はこれまで通り「局面から」行う。
//
// ファイルの形（同梱のものも、書き出し・取り込みも同じ）：
//   { "app": "joban-tree", "kind": "opening-templates", "version": 1,
//     "templates": [ { id, name, group, mySide, moves, note, reviewed } ] }
// 同梱の戦型は src/data/templates/ の JSON（ここに置いたファイルはすべて読み込む）。
// 受け取ったファイルも読むので、中身は信用せず、形と手順の合法性を確かめてから使う。

import type { LinePosition } from '../shogi/kifu';
import { STARTPOS_SFEN, applyUsiMove, moveText, type Side } from '../shogi/position';
import { TREE_APP } from './types';

export const TEMPLATE_KIND = 'opening-templates';
export const TEMPLATE_FORMAT_VERSION = 1;

export interface OpeningTemplate {
  /** 重ならない名前（英数字・-・_） */
  id: string;
  /** 表示する名前。テンプレートから作ったツリーの名前の初期値にもなる */
  name: string;
  /** 「横歩取り」などのまとまり */
  group: string;
  /** 自分の側の初期値（同梱のものは「出発点で手番でない側」） */
  mySide: Side;
  /** 平手の初期局面からの手順（USI 形式） */
  moves: string[];
  /** 短い説明 */
  note: string;
  /** 有段者の確認が済んでいるか（false なら「未確認」の印を出す） */
  reviewed: boolean;
}

export interface TemplateFile {
  app: typeof TREE_APP;
  kind: typeof TEMPLATE_KIND;
  version: number;
  templates: OpeningTemplate[];
  note?: string;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isString = (v: unknown): v is string => typeof v === 'string';

/** 手順を初期局面から並べる。指せない手があれば、その位置（0 始まり）を返す */
export function templateLine(moves: readonly string[]): { ok: true; line: LinePosition[] } | { ok: false; index: number } {
  const line: LinePosition[] = [{ sfen: STARTPOS_SFEN }];
  for (let i = 0; i < moves.length; i++) {
    const prev = line[line.length - 1];
    const r = applyUsiMove(prev.sfen, moves[i]);
    if (!r) return { ok: false, index: i };
    line.push({ sfen: r.sfen, usi: moves[i], text: moveText(prev.sfen, moves[i], prev.usi) });
  }
  return { ok: true, line };
}

/** テンプレート 1 つの形と手順を確かめる。問題が無ければ null、あれば理由 */
export function checkTemplate(t: unknown): string | null {
  if (!isObject(t)) return '形';
  if (!isString(t.id) || !/^[\w-]{1,64}$/.test(t.id)) return 'id';
  const label = `「${isString(t.name) ? t.name : t.id}」`;
  if (!isString(t.name) || t.name.trim() === '' || t.name.length > 100) return `${label}の名前`;
  if (!isString(t.group) || t.group.trim() === '' || t.group.length > 50) return `${label}のグループ`;
  if (t.mySide !== 'black' && t.mySide !== 'white') return `${label}の自分の側`;
  if (!Array.isArray(t.moves) || !t.moves.every(isString) || t.moves.length > 300) return `${label}の手順`;
  if (!isString(t.note) || t.note.length > 1000) return `${label}のメモ`;
  if (typeof t.reviewed !== 'boolean') return `${label}の確認済みかどうか`;
  const line = templateLine(t.moves);
  if (!line.ok) return `${label}の ${line.index + 1} 手目（${t.moves[line.index]}）が指せない手`;
  return null;
}

export type TemplateParseResult = { ok: true; templates: OpeningTemplate[] } | { ok: false; message: string };

/** 戦型のファイル（JSON を読んだもの）を確かめる。1 つでもおかしければ全体を読まない */
export function checkTemplateFile(raw: unknown): TemplateParseResult {
  if (!isObject(raw) || raw.app !== TREE_APP || raw.kind !== TEMPLATE_KIND) {
    return { ok: false, message: '将棋定跡帳の戦型のファイルではありません。' };
  }
  if (typeof raw.version !== 'number' || raw.version > TEMPLATE_FORMAT_VERSION) {
    return { ok: false, message: 'アプリより新しい形式のファイルです。アプリを最新にしてから読み込んでください。' };
  }
  if (!Array.isArray(raw.templates)) return { ok: false, message: 'ファイルの中身が壊れています（戦型の一覧）。' };
  const ids = new Set<string>();
  for (const t of raw.templates) {
    const problem = checkTemplate(t);
    if (problem) return { ok: false, message: `ファイルの中身がおかしいので読み込みませんでした（${problem}）。` };
    const id = (t as OpeningTemplate).id;
    if (ids.has(id)) return { ok: false, message: `ファイルの中に同じ id の戦型が 2 つあります（${id}）。` };
    ids.add(id);
  }
  return { ok: true, templates: (raw.templates as OpeningTemplate[]).map(plain) };
}

/** 同梱の戦型のファイル（ファイル名の順） */
const BUNDLED_FILES = import.meta.glob<unknown>('../data/templates/*.json', { eager: true, import: 'default' });

/** 同梱の戦型。おかしいファイルは読まない（テストで確かめているので、ふつうは起きない） */
export const BUNDLED_TEMPLATES: OpeningTemplate[] = Object.keys(BUNDLED_FILES)
  .sort()
  .flatMap((path) => {
    const r = checkTemplateFile(BUNDLED_FILES[path]);
    if (!r.ok) {
      console.warn(`同梱の戦型 ${path} を読めませんでした：${r.message}`);
      return [];
    }
    return r.templates;
  });

/** グループごとにまとめる（グループも戦型も、最初に出てきた順） */
export function groupTemplates(list: readonly OpeningTemplate[]): { group: string; templates: OpeningTemplate[] }[] {
  const groups = new Map<string, OpeningTemplate[]>();
  for (const t of list) {
    const g = groups.get(t.group);
    if (g) g.push(t);
    else groups.set(t.group, [t]);
  }
  return [...groups].map(([group, templates]) => ({ group, templates }));
}

/**
 * 今の手順が、テンプレートの手順の上（またはその続き）にあるか。
 * @param moves 初期局面から今の局面までの手順
 * @returns 'before'（テンプレートの途中）・'at'（ちょうど出発点）・'after'（その先へ進めた）・'off'（外れた）
 */
export function templateRelation(template: OpeningTemplate, moves: readonly string[]): 'before' | 'at' | 'after' | 'off' {
  const n = Math.min(template.moves.length, moves.length);
  for (let i = 0; i < n; i++) if (template.moves[i] !== moves[i]) return 'off';
  if (moves.length < template.moves.length) return 'before';
  return moves.length === template.moves.length ? 'at' : 'after';
}

// ---- 段階5-2：自分で登録する・書き出す・取り込む ----

/** 自分で登録する戦型の新しい id */
export function newTemplateId(): string {
  return `my-${crypto.randomUUID()}`;
}

/** 戦型のファイルの形だけを取り出す（保存用の日付などは書き出さない） */
function plain(t: OpeningTemplate): OpeningTemplate {
  return { id: t.id, name: t.name, group: t.group, mySide: t.mySide, moves: [...t.moves], note: t.note, reviewed: t.reviewed };
}

/** 書き出すファイルの文字列 */
export function templatesToJson(list: readonly OpeningTemplate[]): string {
  const file: TemplateFile = { app: TREE_APP, kind: TEMPLATE_KIND, version: TEMPLATE_FORMAT_VERSION, templates: list.map(plain) };
  return JSON.stringify(file, null, 2);
}

/** 書き出したファイルの文字列を読む（形と手順を確かめる） */
export function parseTemplatesJson(text: string): TemplateParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, message: 'JSON として読めませんでした。戦型を書き出したファイルを選んでください。' };
  }
  return checkTemplateFile(raw);
}

/** 登録の入力欄（名前・グループ・メモ）を確かめる。問題が無ければ null */
export function checkTemplateFields(f: { name: string; group: string; note: string }): string | null {
  if (f.name.trim() === '') return '名前を入れてください。';
  if (f.name.trim().length > 100) return '名前は 100 文字までです。';
  if (f.group.trim() === '') return 'グループを入れてください（例：横歩取り）。';
  if (f.group.trim().length > 50) return 'グループは 50 文字までです。';
  if (f.note.trim().length > 1000) return 'メモは 1000 文字までです。';
  return null;
}

function sameTemplate(a: OpeningTemplate, b: OpeningTemplate): boolean {
  return JSON.stringify(plain(a)) === JSON.stringify(plain(b));
}

/** 取り込みの見通し */
export interface ImportPlan {
  /** id が重ならない戦型（そのまま足す） */
  fresh: OpeningTemplate[];
  /** まったく同じ戦型が既にある数（取り込まない） */
  same: number;
  /** id が重なり、中身が違う戦型。bundled は同梱の戦型と重なったもの（同梱の戦型は置き換えない） */
  conflicts: { incoming: OpeningTemplate; bundled: boolean }[];
}

export function planImport(
  incoming: readonly OpeningTemplate[],
  mine: readonly OpeningTemplate[],
  bundled: readonly OpeningTemplate[],
): ImportPlan {
  const plan: ImportPlan = { fresh: [], same: 0, conflicts: [] };
  for (const t of incoming) {
    const own = mine.find((m) => m.id === t.id);
    const existing = own ?? bundled.find((b) => b.id === t.id);
    if (!existing) plan.fresh.push(t);
    else if (sameTemplate(existing, t)) plan.same++;
    else plan.conflicts.push({ incoming: t, bundled: !own });
  }
  return plan;
}

/** id が重なったときの選び方：置き換える（自分で登録したものだけ）・両方残す（新しい id で足す）・取り込まない */
export type ConflictChoice = 'replace' | 'both' | 'skip';

/** 取り込む戦型を決める。skipped は取り込まなかった数（同じものは数えない） */
export function resolveImport(plan: ImportPlan, choice: ConflictChoice, newId: () => string = newTemplateId): { put: OpeningTemplate[]; skipped: number } {
  const put = [...plan.fresh];
  let skipped = 0;
  for (const c of plan.conflicts) {
    if (choice === 'replace' && !c.bundled) put.push(c.incoming);
    else if (choice === 'both') put.push({ ...c.incoming, id: newId() });
    else skipped++;
  }
  return { put, skipped };
}

/** 手順がどの戦型の上にあるか（いちばん長く一致する戦型。登録するときのグループの初期値に使う） */
export function closestTemplate(list: readonly OpeningTemplate[], moves: readonly string[]): OpeningTemplate | null {
  let best: OpeningTemplate | null = null;
  for (const t of list) {
    const r = templateRelation(t, moves);
    if ((r === 'at' || r === 'after') && (!best || t.moves.length > best.moves.length)) best = t;
  }
  return best;
}

/**
 * 同じ手順（平手の初期局面からの指し手の並びがまったく同じ）の戦型。登録の二重を防ぐのに使う。
 * 自分の側・名前・グループは見ない（自分の側は戦型を選んだ後に切り替えられるので、同じ局面とみなす）。
 */
export function findSameMoves<T extends OpeningTemplate>(list: readonly T[], moves: readonly string[]): T | null {
  return list.find((t) => t.moves.length === moves.length && t.moves.every((m, i) => m === moves[i])) ?? null;
}

/**
 * 一覧に出す名前：グループ名＋区切り（空白・「・」）で始まるなら、そこを省く
 * （例：グループ「横歩取り」の「横歩取り 青野流（▲5八玉まで）」→「青野流（▲5八玉まで）」。「相横歩取り（…）」はそのまま）。
 * データの name とツリーの名前は省かない。
 */
export function listName(t: Pick<OpeningTemplate, 'name' | 'group'>): string {
  if (!t.name.startsWith(t.group)) return t.name;
  const m = /^[\s　・]+(.+)$/u.exec(t.name.slice(t.group.length));
  return m ? m[1] : t.name;
}
