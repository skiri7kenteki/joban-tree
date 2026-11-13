// ツリーの JSON（このアプリ専用のバックアップ・共有用）の書き出しと読み込み。
// ほかの人から受け取ったファイルも読むので、中身は信用せず、形を確かめてから使う。

import { Position } from 'tsshogi';
import { sfenKey } from '../shogi/position';
import { TREE_APP, TREE_FORMAT_VERSION, type TreeData } from './types';

/** JSON の文字列にする（そのまま保存しているデータと同じ形） */
export function treeToJson(tree: TreeData): string {
  return JSON.stringify(tree);
}

export type ParseResult = { ok: true; tree: TreeData } | { ok: false; message: string };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isString = (v: unknown): v is string => typeof v === 'string';
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function isScore(v: unknown): boolean {
  if (!isObject(v)) return false;
  return (v.kind === 'cp' && isNumber(v.value)) || (v.kind === 'mate' && isNumber(v.plies));
}

/** JSON の文字列からツリーを読む */
export function parseTreeJson(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, message: 'JSON として読めませんでした。このアプリで書き出したファイルを選んでください。' };
  }
  if (!isObject(raw) || raw.app !== TREE_APP) {
    return { ok: false, message: '序盤ツリーのファイルではありません。' };
  }
  if (!isNumber(raw.version) || raw.version > TREE_FORMAT_VERSION) {
    return { ok: false, message: 'アプリより新しい形式のファイルです。アプリを最新にしてから読み込んでください。' };
  }
  // 形式 1 の確認（形式を変えたときは、ここで古い形から新しい形に直す）
  const problem = checkV1(raw);
  if (problem) return { ok: false, message: `ファイルの中身が壊れています（${problem}）。` };
  return { ok: true, tree: raw as unknown as TreeData };
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
  if (!isObject(t.nodes)) return '局面';
  for (const [key, node] of Object.entries(t.nodes)) {
    if (!isObject(node) || node.key !== key || !isString(node.sfen) || !isNumber(node.round) || !Array.isArray(node.edges)) {
      return `局面 ${key}`;
    }
    if (!Position.newBySFEN(node.sfen) || sfenKey(node.sfen) !== key) return `局面 ${key}`;
    for (const edge of node.edges) {
      if (!isObject(edge) || !isString(edge.move) || !isString(edge.to) || !isScore(edge.score)) return `局面 ${key} の手`;
      if (!(edge.to in t.nodes)) return `局面 ${key} の手の行き先`;
    }
  }
  if (!(t.rootKey in t.nodes)) return '開始局面';
  return null;
}

/** ファイル名に使えない文字を除く */
export function fileNameOf(name: string, ext: string): string {
  const base = name.replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 60) || 'joban-tree';
  return `${base}.${ext}`;
}
