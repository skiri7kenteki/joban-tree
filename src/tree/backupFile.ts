// まとめてのバックアップのファイル（段階17、v0.41.0〜。持ち主の依頼書 stage17-prompt・判断 2026-11-23「おすすめの通りで」）。
// 研究手順・ツリー・復習の記録・自分で登録した戦型・設定を 1 つの JSON にする。ここは形を作る・確かめるだけ（保存場所の読み書きは src/storage/backup.ts）。
//
// ファイルの形：{ app: 'joban-tree', kind: 'backup', version: 1, createdAt, appVersion, data: { studies, trees, reviews, templates, games, practice, positions, deleted, prefs } }
//   （段階22-2 で deleted＝消した記録を足した。ほかの端末と合わせるときに「消した」ことを運ぶ）
// - あとから種類を足せる：data に新しい種類を足すだけなら version は 1 のまま（段階18 で games＝実戦の棋譜、段階19 で practice＝稽古の記録、段階20-1 で positions＝局面メモを足した。無いファイルは空として読む）。
//   この版のアプリが知らない種類は読まずに、画面で「戻すとそれは入りません」と知らせる（unknownKinds）
// - version が新しい（形の違う）ファイルは、分かりやすく断る
// - 中身は信用せず、ツリー・研究手順・戦型は今の取り込みと同じ確かめ方、復習の記録と設定はここで確かめる。1 つでもおかしければ全体を読まない

import type { NodeRecord, ReviewRecord } from '../review/review';
import { treeProblem } from './backup';
import { checkStudy } from './studyFile';
import { checkTemplate } from './templates';
import { gameProblem, type Game } from '../games/game';
import { practiceProblem, type PracticeRecord } from '../practice/practice';
import { positionProblem, type PositionNote } from './positions';
import { TREE_APP, type Study, type TreeData } from './types';
import type { OpeningTemplate } from './templates';
import { deletedProblem, type DeletedRecord } from './deleted';

export const BACKUP_KIND = 'backup';
export const BACKUP_VERSION = 1;

/** バックアップに入れる端末の設定（localStorage の名前）。アプリの中だけで使う記録（自動で読み込み直した時刻・研究手順の移し替えの結果）は入れない */
export const PREF_KEYS = [
  'joban-tree.settings',
  'joban-tree:book-write',
  'joban-tree.home-collapsed',
  'joban-tree.hints-seen',
  'joban-tree.recent',
  'joban-tree.wars-name',
] as const;

/** 自分で登録した戦型（保存場所の形：登録日・更新日つき） */
export interface BackupTemplate extends OpeningTemplate {
  createdAt: number;
  updatedAt: number;
  restoredAt?: number;
}

/** バックアップの中身（この版のアプリが知っている種類） */
export interface BackupData {
  studies: Study[];
  trees: TreeData[];
  reviews: ReviewRecord[];
  templates: BackupTemplate[];
  /** 実戦の棋譜（段階18） */
  games: Game[];
  /** 稽古の記録（段階19） */
  practice: PracticeRecord[];
  /** 局面メモと食い違いの「このままでよい」（段階20-1） */
  positions: PositionNote[];
  /** 消した記録（段階22-2） */
  deleted: DeletedRecord[];
  /** 端末の設定（localStorage の名前 → 値の文字列） */
  prefs: Record<string, string>;
}

/** この版のアプリが知っている種類（段階18 で games を足した） */
export const KNOWN_KINDS = ['studies', 'trees', 'reviews', 'templates', 'games', 'practice', 'positions', 'deleted', 'prefs'] as const;

/** 種類の名前（画面に出す） */
export const KIND_LABELS: Record<string, string> = {
  studies: '研究手順',
  trees: 'ツリー',
  reviews: '復習の記録',
  templates: '自分で登録した戦型',
  prefs: '設定',
  games: '実戦の棋譜',
  practice: '稽古の記録',
  positions: '局面メモ',
  deleted: '消した記録',
};

export interface BackupFile {
  app: typeof TREE_APP;
  kind: typeof BACKUP_KIND;
  version: typeof BACKUP_VERSION;
  /** 作った日時（ミリ秒） */
  createdAt: number;
  /** 作ったアプリの版（package.json の version） */
  appVersion: string;
  data: BackupData;
}

/** バックアップのファイルの中身を作る */
export function makeBackup(data: BackupData, createdAt: number, appVersion: string): BackupFile {
  return { app: TREE_APP, kind: BACKUP_KIND, version: BACKUP_VERSION, createdAt, appVersion, data };
}

/** ファイルの文字列にする（大きいツリーもあるので、字下げはしない） */
export function backupToJson(file: BackupFile): string {
  return JSON.stringify(file);
}

/** ファイル名（例：将棋定跡帳-バックアップ-2026-11-23-1305.json。同じ日に何度保存しても分かるように時刻も付ける） */
export function backupFileName(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `将棋定跡帳-バックアップ-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.json`;
}

export type BackupParseResult =
  | { ok: true; file: BackupFile; unknownKinds: string[] }
  | { ok: false; message: string };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isString = (v: unknown): v is string => typeof v === 'string';
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** 復習の記録 1 つ（ツリー 1 本ぶん、または研究手順用）の形を確かめる */
export function reviewProblem(r: unknown): string | null {
  if (!isObject(r)) return '形';
  if (!isString(r.treeId) || r.treeId.length === 0 || r.treeId.length > 100) return 'どの記録か';
  if (r.version !== 1) return '形式';
  if (r.restoredAt !== undefined && !isNumber(r.restoredAt)) return '日時';
  if (!isObject(r.nodes)) return '問題の一覧';
  for (const [key, n] of Object.entries(r.nodes)) {
    if (key.length > 400 || !isObject(n)) return '問題';
    const rec = n as Partial<NodeRecord>;
    if (!isNumber(rec.seen) || !isNumber(rec.correct) || !isNumber(rec.streak) || !isNumber(rec.lastAt)) return '問題の数';
    if (rec.lastOk !== undefined && typeof rec.lastOk !== 'boolean') return '問題の答え';
  }
  return null;
}

/** 種類ごとに、同じ id が 2 つないか */
function duplicated<T>(list: readonly T[], id: (t: T) => string): string | null {
  const seen = new Set<string>();
  for (const t of list) {
    const k = id(t);
    if (seen.has(k)) return k;
    seen.add(k);
  }
  return null;
}

/** ファイルの文字列を読む。形を確かめ、おかしければ理由を返す */
export function parseBackupJson(text: string, use: 'restore' | 'merge' = 'restore'): BackupParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, message: 'JSON として読めませんでした。［バックアップを保存］で作ったファイルを選んでください。' };
  }
  if (!isObject(raw) || raw.app !== TREE_APP || raw.kind !== BACKUP_KIND) {
    return { ok: false, message: '将棋定跡帳のバックアップのファイルではありません。［バックアップを保存］で作ったファイルを選んでください。' };
  }
  if (!isNumber(raw.version) || raw.version > BACKUP_VERSION) {
    return { ok: false, message: `新しい版のアプリで作ったバックアップです。アプリを最新にしてから${use === 'merge' ? '合わせて' : '戻して'}ください。` };
  }
  if (!isNumber(raw.createdAt) || !isString(raw.appVersion) || !isObject(raw.data)) {
    return { ok: false, message: 'ファイルの中身が壊れています（作った日時・中身）。' };
  }
  const d = raw.data;
  const fail = (what: string) => ({ ok: false as const, message: `ファイルの中身がおかしいので、${use === 'merge' ? '合わせ' : '戻し'}ませんでした（${what}）。` });

  const studies = d.studies ?? [];
  if (!Array.isArray(studies)) return fail('研究手順');
  for (let i = 0; i < studies.length; i++) {
    const p = checkStudy(studies[i]);
    if (p) return fail(`研究手順 ${i + 1} 本目の${p}`);
  }
  const trees = d.trees ?? [];
  if (!Array.isArray(trees)) return fail('ツリー');
  for (let i = 0; i < trees.length; i++) {
    const p = treeProblem(trees[i]);
    if (p) return fail(`ツリー ${i + 1} 本目の${p}`);
  }
  const reviews = d.reviews ?? [];
  if (!Array.isArray(reviews)) return fail('復習の記録');
  for (let i = 0; i < reviews.length; i++) {
    const p = reviewProblem(reviews[i]);
    if (p) return fail(`復習の記録 ${i + 1} つ目の${p}`);
  }
  const templates = d.templates ?? [];
  if (!Array.isArray(templates)) return fail('自分で登録した戦型');
  for (let i = 0; i < templates.length; i++) {
    const t = templates[i];
    const p = checkTemplate(t) ?? (isObject(t) && isNumber(t.createdAt) && isNumber(t.updatedAt) ? null : '日付');
    if (p) return fail(`戦型 ${i + 1} つ目の${p}`);
  }
  const games = d.games ?? [];
  if (!Array.isArray(games)) return fail('実戦の棋譜');
  for (let i = 0; i < games.length; i++) {
    const p = gameProblem(games[i]);
    if (p) return fail(`実戦 ${i + 1} 局目の${p}`);
  }
  const practice = d.practice ?? [];
  if (!Array.isArray(practice)) return fail('稽古の記録');
  for (let i = 0; i < practice.length; i++) {
    const p = practiceProblem(practice[i]);
    if (p) return fail(`稽古の記録 ${i + 1} つ目の${p}`);
  }
  const positions = d.positions ?? [];
  if (!Array.isArray(positions)) return fail('局面メモ');
  for (let i = 0; i < positions.length; i++) {
    const p = positionProblem(positions[i]);
    if (p) return fail(`局面メモ ${i + 1} つ目の${p}`);
  }
  const deleted = d.deleted ?? [];
  if (!Array.isArray(deleted)) return fail('消した記録');
  for (let i = 0; i < deleted.length; i++) {
    const p = deletedProblem(deleted[i]);
    if (p) return fail(`消した記録 ${i + 1} つ目の${p}`);
  }
  // 戻した日時（ツリー・戦型。研究手順と実戦は上の確かめに入っている）
  const dated = [...(trees as unknown[]), ...(templates as unknown[])];
  if (dated.some((x) => isObject(x) && [x.restoredAt, x.renamedAt].some((t) => t !== undefined && !isNumber(t)))) return fail('日時');
  const prefs = d.prefs ?? {};
  if (!isObject(prefs)) return fail('設定');
  for (const [k, v] of Object.entries(prefs)) {
    if (!(PREF_KEYS as readonly string[]).includes(k)) continue;
    if (!isString(v) || v.length > 200_000) return fail(`設定（${k}）`);
  }

  const dup =
    duplicated(studies as Study[], (s) => s.id) ??
    duplicated(trees as TreeData[], (t) => t.id) ??
    duplicated(reviews as ReviewRecord[], (r) => r.treeId) ??
    duplicated(templates as BackupTemplate[], (t) => t.id) ??
    duplicated(games as Game[], (g) => g.id) ??
    duplicated(practice as PracticeRecord[], (r) => r.studyId) ??
    duplicated(positions as PositionNote[], (r) => r.id);
  if (dup) return fail(`同じ id が 2 つあります：${dup}`);

  const knownPrefs: Record<string, string> = {};
  for (const k of PREF_KEYS) if (isString((prefs as Record<string, unknown>)[k])) knownPrefs[k] = (prefs as Record<string, string>)[k];

  const data: BackupData = {
    studies: studies as Study[],
    trees: trees as TreeData[],
    reviews: reviews as ReviewRecord[],
    templates: templates as BackupTemplate[],
    games: games as Game[],
    practice: practice as PracticeRecord[],
    positions: positions as PositionNote[],
    deleted: deleted as DeletedRecord[],
    prefs: knownPrefs,
  };
  const unknownKinds = Object.keys(d).filter((k) => !(KNOWN_KINDS as readonly string[]).includes(k));
  return {
    ok: true,
    file: { app: TREE_APP, kind: BACKUP_KIND, version: BACKUP_VERSION, createdAt: raw.createdAt, appVersion: raw.appVersion, data },
    unknownKinds,
  };
}

/** 中身の数（戻す前の確認に出す） */
export interface BackupCounts {
  studies: number;
  trees: number;
  /** 復習の記録の問題の数（ツリーと研究手順の合計） */
  reviewProblems: number;
  templates: number;
  /** 実戦の数 */
  games: number;
  /** 稽古の記録の数（研究手順の本数） */
  practice: number;
  /** 局面メモの数（メモの入っているものだけ） */
  positions: number;
  /** 候補の表のある局面の数（段階21-1） */
  tables: number;
  /** 入っている設定の数 */
  prefs: number;
}

export function backupCounts(data: BackupData): BackupCounts {
  return {
    studies: data.studies.length,
    trees: data.trees.length,
    reviewProblems: data.reviews.reduce((n, r) => n + Object.keys(r.nodes).length, 0),
    templates: data.templates.length,
    games: (data.games ?? []).length,
    practice: (data.practice ?? []).length,
    positions: (data.positions ?? []).filter((p) => p.note.trim() !== '').length,
    tables: (data.positions ?? []).filter((p) => (p.candidates?.length ?? 0) > 0).length,
    prefs: Object.keys(data.prefs).length,
  };
}

/** 30 日（バックアップのすすめを出すまで・閉じたあと出さない間） */
export const NUDGE_DAYS = 30;
const DAY = 24 * 60 * 60 * 1000;

/**
 * 定跡帳の一覧の上に「しばらくバックアップしていません」を出すか。
 * 研究手順が 1 本以上あり、最後のバックアップ（まだなら、いちばん古い研究手順を作った日）から 30 日以上たっていて、閉じてから 30 日たっていれば出す
 */
export function shouldNudge(now: number, studies: readonly Pick<Study, 'createdAt'>[], lastBackupAt: number | null, hiddenUntil: number | null): boolean {
  if (studies.length === 0) return false;
  if (hiddenUntil !== null && now < hiddenUntil) return false;
  const since = lastBackupAt ?? Math.min(...studies.map((s) => s.createdAt));
  return now - since >= NUDGE_DAYS * DAY;
}

/** 閉じたあと、次に出してよい日時 */
export function nudgeHiddenUntil(now: number): number {
  return now + NUDGE_DAYS * DAY;
}
