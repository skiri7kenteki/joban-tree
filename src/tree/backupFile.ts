// まとめてのバックアップのファイル（段階17、v0.41.0〜。持ち主の依頼書 stage17-prompt・判断 2026-11-23「おすすめの通りで」）。
// 研究手順・ツリー・復習の記録・自分で登録した戦型・設定を 1 つの JSON にする。ここは形を作る・確かめるだけ（保存場所の読み書きは src/storage/backup.ts）。
//
// ファイルの形：{ app: 'joban-tree', kind: 'backup', version: 1, createdAt, appVersion, data: { studies, trees, reviews, templates, prefs } }
// - あとから種類を足せる：data に新しい種類（段階18 の games など）を足すだけなら version は 1 のまま。
//   この版のアプリが知らない種類は読まずに、画面で「戻すとそれは入りません」と知らせる（unknownKinds）
// - version が新しい（形の違う）ファイルは、分かりやすく断る
// - 中身は信用せず、ツリー・研究手順・戦型は今の取り込みと同じ確かめ方、復習の記録と設定はここで確かめる。1 つでもおかしければ全体を読まない

import type { NodeRecord, ReviewRecord } from '../review/review';
import { treeProblem } from './backup';
import { checkStudy } from './studyFile';
import { checkTemplate } from './templates';
import { TREE_APP, type Study, type TreeData } from './types';
import type { OpeningTemplate } from './templates';

export const BACKUP_KIND = 'backup';
export const BACKUP_VERSION = 1;

/** バックアップに入れる端末の設定（localStorage の名前）。アプリの中だけで使う記録（自動で読み込み直した時刻・研究手順の移し替えの結果）は入れない */
export const PREF_KEYS = [
  'joban-tree.settings',
  'joban-tree:book-write',
  'joban-tree.home-collapsed',
  'joban-tree.hints-seen',
  'joban-tree.recent',
] as const;

/** 自分で登録した戦型（保存場所の形：登録日・更新日つき） */
export interface BackupTemplate extends OpeningTemplate {
  createdAt: number;
  updatedAt: number;
}

/** バックアップの中身（この版のアプリが知っている種類） */
export interface BackupData {
  studies: Study[];
  trees: TreeData[];
  reviews: ReviewRecord[];
  templates: BackupTemplate[];
  /** 端末の設定（localStorage の名前 → 値の文字列） */
  prefs: Record<string, string>;
}

/** この版のアプリが知っている種類（段階18 で games を足す） */
export const KNOWN_KINDS = ['studies', 'trees', 'reviews', 'templates', 'prefs'] as const;

/** 種類の名前（画面に出す） */
export const KIND_LABELS: Record<string, string> = {
  studies: '研究手順',
  trees: 'ツリー',
  reviews: '復習の記録',
  templates: '自分で登録した戦型',
  prefs: '設定',
  games: '実戦の棋譜',
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
export function parseBackupJson(text: string): BackupParseResult {
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
    return { ok: false, message: '新しい版のアプリで作ったバックアップです。アプリを最新にしてから戻してください。' };
  }
  if (!isNumber(raw.createdAt) || !isString(raw.appVersion) || !isObject(raw.data)) {
    return { ok: false, message: 'ファイルの中身が壊れています（作った日時・中身）。' };
  }
  const d = raw.data;
  const fail = (what: string) => ({ ok: false as const, message: `ファイルの中身がおかしいので、戻しませんでした（${what}）。` });

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
    duplicated(templates as BackupTemplate[], (t) => t.id);
  if (dup) return fail(`同じ id が 2 つあります：${dup}`);

  const knownPrefs: Record<string, string> = {};
  for (const k of PREF_KEYS) if (isString((prefs as Record<string, unknown>)[k])) knownPrefs[k] = (prefs as Record<string, string>)[k];

  const data: BackupData = {
    studies: studies as Study[],
    trees: trees as TreeData[],
    reviews: reviews as ReviewRecord[],
    templates: templates as BackupTemplate[],
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
  /** 入っている設定の数 */
  prefs: number;
}

export function backupCounts(data: BackupData): BackupCounts {
  return {
    studies: data.studies.length,
    trees: data.trees.length,
    reviewProblems: data.reviews.reduce((n, r) => n + Object.keys(r.nodes).length, 0),
    templates: data.templates.length,
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
