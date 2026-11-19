// トップ画面の整理（段階7-1）：ツリーを「戦型のグループ × 自分の側」でまとめる・名前で絞り込む・最近開いたもの。
// 画面から切り離した関数だけにして、テストで確かめる。
//
// どの戦型のツリーか（templateOf）：
//   1. ツリーに templateId（作ったときの戦型）があり、その戦型が今もあれば、それ
//   2. 無ければ（形式 4 までのツリーなど）、開始局面までの手順が、ある戦型の手順で始まっていればその戦型。
//      複数当てはまるときは、手順がいちばん長い戦型（closestTemplate）
//   3. どれにも当てはまらなければ「その他」
//   推定した結果はツリーに書き込まない（後から戦型を登録すれば、古いツリーもそこへ移る。持ち主の判断 2026-11-17）

import { STARTPOS_SFEN, type Side } from '../shogi/position';
import { closestTemplate, type OpeningTemplate } from './templates';
import type { TreeData } from './types';

/** グループ分けに使う、ツリーの要約（TreeSummary もこの形を持つ） */
export interface OrganizeItem {
  id: string;
  name: string;
  updatedAt: number;
  mySide: Side;
  templateId?: string;
  prefix: TreeData['prefix'];
  source?: TreeData['source'];
}

/** そのツリーの戦型（無ければ null＝「その他」） */
export function templateOf(item: Pick<OrganizeItem, 'templateId' | 'prefix'>, templates: readonly OpeningTemplate[]): OpeningTemplate | null {
  if (item.templateId) {
    const t = templates.find((x) => x.id === item.templateId);
    if (t) return t;
  }
  // 戦型の手順は平手の初期局面から。途中の局面（SFEN）から始めたツリーは当てはめない
  if (item.prefix.initialSfen !== STARTPOS_SFEN) return null;
  return closestTemplate(templates, item.prefix.moves);
}

/** その他のグループの key */
export const OTHER_GROUP = 'other';

export interface TreeGroup<T> {
  /** 開閉の状態を覚えるための key（例：「横歩取り|white」、その他は OTHER_GROUP） */
  key: string;
  /** 見出し（例：「横歩取り（後手番）」「その他」） */
  label: string;
  items: T[];
}

export const SIDE_GROUP_TEXT: Record<Side, string> = { black: '先手番', white: '後手番' };

/** 「自分の側が後手」を「後手番」と呼ぶ（研究する側） */
export function groupLabel(group: string, side: Side): string {
  return `${group}（${SIDE_GROUP_TEXT[side]}）`;
}

/** グループの中の並び：用意済みのツリーがいちばん上、あとは更新日の新しい順 */
function compareInGroup(a: OrganizeItem, b: OrganizeItem): number {
  const ab = a.source?.kind === 'bundled' ? 0 : 1;
  const bb = b.source?.kind === 'bundled' ? 0 : 1;
  if (ab !== bb) return ab - bb;
  return b.updatedAt - a.updatedAt;
}

/**
 * ツリーをグループに分ける。グループの順は固定（持ち主の判断 2026-11-17）：
 * 戦型の一覧に出てくる順（同梱の戦型 → 自分で登録した戦型）、同じグループの中は後手番 → 先手番、「その他」はいちばん下。
 * 中身の無いグループは出さない
 */
export function groupTrees<T extends OrganizeItem>(items: readonly T[], templates: readonly OpeningTemplate[]): TreeGroup<T>[] {
  const groupOrder: string[] = [];
  for (const t of templates) if (!groupOrder.includes(t.group)) groupOrder.push(t.group);
  const buckets = new Map<string, T[]>();
  for (const item of items) {
    const t = templateOf(item, templates);
    const key = t ? `${t.group}|${item.mySide}` : OTHER_GROUP;
    const list = buckets.get(key);
    if (list) list.push(item);
    else buckets.set(key, [item]);
  }
  const out: TreeGroup<T>[] = [];
  for (const group of groupOrder) {
    for (const side of ['white', 'black'] as Side[]) {
      const list = buckets.get(`${group}|${side}`);
      if (list) out.push({ key: `${group}|${side}`, label: groupLabel(group, side), items: [...list].sort(compareInGroup) });
    }
  }
  const other = buckets.get(OTHER_GROUP);
  if (other) out.push({ key: OTHER_GROUP, label: 'その他', items: [...other].sort(compareInGroup) });
  return out;
}

/** 絞り込みのために文字をそろえる（全角・半角、大文字・小文字を区別しない。「３六飛」でも「3六飛」でも当たる） */
export function normalizeForSearch(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** 名前（など）に、絞り込みの文字が含まれるか。空なら当てはまる */
export function matchesQuery(texts: readonly string[], query: string): boolean {
  const q = normalizeForSearch(query);
  if (q === '') return true;
  return texts.some((t) => normalizeForSearch(t).includes(q));
}

/** 名前で絞り込む（空なら全部）。段階8-1〜 ツリーの名前だけに当てる（研究手順はツリーの外に移したので） */
export function filterByName<T extends Pick<OrganizeItem, 'name'>>(items: readonly T[], query: string): T[] {
  return items.filter((t) => matchesQuery([t.name], query));
}

/** グループ分けに使う、研究手順の形 */
export interface StudyItem {
  id: string;
  name: string;
  note: string;
  moves: readonly string[];
  mySide: Side;
  templateId?: string;
  updatedAt: number;
}

/** 研究手順のグループの key（ツリーのグループと開閉の記録を分ける） */
export const STUDY_GROUP_PREFIX = 'study:';

/**
 * 研究手順の一覧（段階8-1〜 ツリーから独立した研究手順）：ツリーと同じ決まり（戦型のグループ × 自分の側）でまとめる。
 * 戦型は、記録した戦型が今もあればそれ、無ければ手順がいちばん長く一致する戦型。グループの中は直した日の新しい順。
 * 絞り込みは名前とメモに当てる
 */
export function groupStudies<S extends StudyItem>(studies: readonly S[], templates: readonly OpeningTemplate[], query: string): TreeGroup<S>[] {
  const items = studies
    .filter((s) => matchesQuery([s.name, s.note], query))
    .map((s) => ({
      study: s,
      id: s.id,
      name: s.name,
      updatedAt: s.updatedAt,
      mySide: s.mySide,
      templateId: s.templateId && templates.some((t) => t.id === s.templateId && startsWithMoves(s.moves, t.moves)) ? s.templateId : undefined,
      prefix: { initialSfen: STARTPOS_SFEN, moves: [...s.moves] },
    }));
  return groupTrees(items, templates).flatMap((g) => {
    const list = g.items.sort((a, b) => b.updatedAt - a.updatedAt).map((x) => x.study);
    if (g.key !== OTHER_GROUP) return [{ key: `${STUDY_GROUP_PREFIX}${g.key}`, label: g.label, items: list }];
    // 段階10-1（持ち主の判断 2026-11-19）：「その他」も自分の側で分ける（定跡帳で手を足すときに側が決まるように）。後手番 → 先手番
    return (['white', 'black'] as Side[]).flatMap((side) => {
      const items2 = list.filter((s) => s.mySide === side);
      return items2.length > 0 ? [{ key: otherStudyKey(side), label: groupLabel('その他', side), items: items2 }] : [];
    });
  });
}

/** 研究手順の「その他」のグループの key（自分の側ごと） */
export function otherStudyKey(side: Side): string {
  return `${STUDY_GROUP_PREFIX}${OTHER_GROUP}|${side}`;
}

/** その研究手順が入る、一覧のグループの key（groupStudies と同じ決まり） */
export function studyGroupKey(study: Pick<StudyItem, 'moves' | 'mySide' | 'templateId'>, templates: readonly OpeningTemplate[]): string {
  const valid = study.templateId ? templates.find((t) => t.id === study.templateId && startsWithMoves(study.moves, t.moves)) : undefined;
  const t = valid ?? closestTemplate(templates, study.moves);
  return t ? `${STUDY_GROUP_PREFIX}${t.group}|${study.mySide}` : otherStudyKey(study.mySide);
}

// ---------------------------------------------------------------------------
// 定跡帳の key（段階9-2・10-1）
//   - 戦型のグループの定跡帳：グループの key そのまま（study:<グループ>|<側>）。中身はそのグループの研究手順
//   - 平手からの定跡帳：study:hirate|<側>。中身はその側の研究手順すべて（平手から指していって戦型の形になっても消えないように）。
//     「その他」のグループから開く定跡帳はこれ

const HIRATE_BOOK = `${STUDY_GROUP_PREFIX}hirate|`;

/** 平手からの定跡帳の key */
export function hirateBookKey(side: Side): string {
  return `${HIRATE_BOOK}${side}`;
}

/** 平手からの定跡帳か */
export function isHirateBook(key: string): boolean {
  return key.startsWith(HIRATE_BOOK);
}

/** 一覧のグループから開く定跡帳の key（「その他」は平手からの定跡帳） */
export function bookKeyOfGroup(groupKey: string): string {
  const other = `${STUDY_GROUP_PREFIX}${OTHER_GROUP}|`;
  return groupKey.startsWith(other) ? hirateBookKey(groupKey.slice(other.length) as Side) : groupKey;
}

/** 定跡帳の自分の側（key から。分からなければ null） */
export function bookSide(key: string): Side | null {
  const side = key.slice(key.lastIndexOf('|') + 1);
  return side === 'black' || side === 'white' ? side : null;
}

/** 定跡帳の見出し（例：「横歩取り（後手番）」「平手から（先手番）」） */
export function bookLabel(key: string): string {
  const side = bookSide(key);
  if (!side) return 'その他';
  if (isHirateBook(key)) return groupLabel('平手から', side);
  const group = key.slice(STUDY_GROUP_PREFIX.length, key.lastIndexOf('|'));
  return groupLabel(group === OTHER_GROUP ? 'その他' : group, side);
}

/** 定跡帳の研究手順（グループの研究手順。平手からの定跡帳はその側の研究手順すべて。並びは直した日の新しい順） */
export function bookPool<S extends StudyItem>(key: string, studies: readonly S[], templates: readonly OpeningTemplate[]): S[] {
  if (isHirateBook(key)) {
    const side = bookSide(key);
    return studies.filter((s) => s.mySide === side).sort((a, b) => b.updatedAt - a.updatedAt);
  }
  return groupStudies(studies, templates, '').find((g) => g.key === key)?.items ?? [];
}

/** その研究手順を、定跡帳 key に入れてよいか（グループから外れる手は足さない。平手からの定跡帳は側が同じなら何でも） */
export function fitsBook(key: string, study: Pick<StudyItem, 'moves' | 'mySide' | 'templateId'>, templates: readonly OpeningTemplate[]): boolean {
  if (isHirateBook(key)) return study.mySide === bookSide(key);
  return studyGroupKey(study, templates) === key;
}

const startsWithMoves = (moves: readonly string[], head: readonly string[]) => moves.length >= head.length && head.every((m, i) => moves[i] === m);

/** 最近開いた記録（端末にだけ保存する。src/app/recent.ts） */
export interface RecentEntry {
  id: string;
  /** 最後に開いた日時（ミリ秒） */
  at: number;
}

/** 最近開いたツリー（新しい順、limit 件まで。消したツリーは出さない） */
export function recentItems<T extends Pick<OrganizeItem, 'id'>>(items: readonly T[], recent: readonly RecentEntry[], limit = 3): (T & { openedAt: number })[] {
  const byId = new Map(items.map((t) => [t.id, t]));
  return [...recent]
    .sort((a, b) => b.at - a.at)
    .flatMap((r) => {
      const t = byId.get(r.id);
      return t ? [{ ...t, openedAt: r.at }] : [];
    })
    .slice(0, limit);
}

/** 「最近開いた」を出すのは、ツリーが 4 つ以上あるときだけ（少ないときは一覧を見れば足りる） */
export const RECENT_MIN_TREES = 4;

/** 記録に 1 件足す（同じツリーは新しい日時で 1 件にまとめ、古いものは max 件を超えたら捨てる） */
export function addRecent(recent: readonly RecentEntry[], id: string, at: number, max = 20): RecentEntry[] {
  return [{ id, at }, ...recent.filter((r) => r.id !== id)].slice(0, max);
}
