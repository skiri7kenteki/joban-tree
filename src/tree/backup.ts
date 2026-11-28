// 前の版のツリー 1 本の形の確かめ（バックアップから戻す・同期で読むときに使う。ツリーの画面は消したが、データは持ち運ぶ）と、
// 書き出すファイルの名前。ほかの人から受け取ったファイルも読むので、中身は信用せず、形を確かめてから使う。

import { Position } from 'tsshogi';
import { sfenKey } from '../shogi/position';
import { TREE_APP, TREE_FORMAT_VERSION } from './types';

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isString = (v: unknown): v is string => typeof v === 'string';
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function isScore(v: unknown): boolean {
  if (!isObject(v)) return false;
  return (v.kind === 'cp' && isNumber(v.value)) || (v.kind === 'mate' && isNumber(v.plies));
}

/**
 * ツリー 1 本（JSON を読んだもの・保存場所のもの）の形を確かめる。問題が無ければ null、あれば理由（段階17：まとめてのバックアップから戻すときに使う）
 */
export function treeProblem(raw: unknown): string | null {
  if (!isObject(raw) || raw.app !== TREE_APP) return '将棋定跡帳のツリーではない';
  if (!isNumber(raw.version) || raw.version > TREE_FORMAT_VERSION) return 'アプリより新しい形式';
  return checkV1(raw);
}

function checkV1(t: Record<string, unknown>): string | null {
  if (!isString(t.id) || !/^[\w-]{1,64}$/.test(t.id)) return 'id';
  if (!isString(t.name)) return 'name';
  if (!isNumber(t.createdAt) || !isNumber(t.updatedAt)) return '日付';
  if (t.mySide !== 'black' && t.mySide !== 'white') return '自分の側';
  if (!isString(t.rootKey)) return '開始局面';
  if (!isObject(t.prefix) || !isString(t.prefix.initialSfen) || !Array.isArray(t.prefix.moves) || !t.prefix.moves.every(isString)) {
    return '開始局面までの手順';
  }
  if (!Position.newBySFEN(t.prefix.initialSfen)) return '初期局面';
  if (!isObject(t.settings)) return '生成の条件';
  if (t.templateId !== undefined && (!isString(t.templateId) || t.templateId.length > 200)) return '戦型';
  if (t.studies !== undefined) {
    // 研究手順：形だけ確かめる（たどれない手順があってもよい。画面で「途中までしかたどれません」と出す）
    if (!Array.isArray(t.studies)) return '研究手順';
    for (const s of t.studies as unknown[]) {
      if (!isObject(s) || !isString(s.id) || !isString(s.name) || !isString(s.note) || !isNumber(s.createdAt) || !isNumber(s.updatedAt)) return '研究手順';
      if (!Array.isArray(s.moves) || !s.moves.every(isString)) return `研究手順「${s.name}」の手順`;
    }
  }
  if (t.source !== undefined) {
    const s = t.source;
    if (!isObject(s) || s.kind !== 'bundled' || !isString(s.id) || !isNumber(s.version) || !isNumber(s.finishedAt)) return '用意済みのツリーの記録';
  }
  if (!isObject(t.nodes)) return '局面';
  for (const [key, node] of Object.entries(t.nodes)) {
    if (!isObject(node) || node.key !== key || !isString(node.sfen) || !isNumber(node.round) || !Array.isArray(node.edges)) {
      return `局面 ${key}`;
    }
    if (!Position.newBySFEN(node.sfen) || sfenKey(node.sfen) !== key) return `局面 ${key}`;
    if (node.excluded !== undefined && !Array.isArray(node.excluded)) return `局面 ${key} の除外した手`;
    for (const edge of [...node.edges, ...((node.excluded as unknown[] | undefined) ?? [])]) {
      if (!isObject(edge) || !isString(edge.move) || !isString(edge.to) || !isScore(edge.score)) return `局面 ${key} の手`;
      if (!(edge.to in t.nodes)) return `局面 ${key} の手の行き先`;
      if (edge.userChosen !== undefined && typeof edge.userChosen !== 'boolean') return `局面 ${key} の自分の手`;
      if (edge.loss !== undefined && !isNumber(edge.loss)) return `局面 ${key} の自分の手の損`;
    }
  }
  if (!(t.rootKey in t.nodes)) return '開始局面';
  return null;
}

/** 今日の日付（ファイル名用、20261121 の形） */
export function dateStamp(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

/** ファイル名に使えない文字を除く */
export function fileNameOf(name: string, ext: string): string {
  const base = name.replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 60) || 'joban-tree';
  return `${base}.${ext}`;
}
