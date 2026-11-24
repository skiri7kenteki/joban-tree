// 基本の研究（段階20-3、v0.46.0〜。持ち主の判断 2026-11-24「全ておすすめの通りで」）。
// 戦型ごとに、同梱ツリーの本線から作った研究手順の組（src/data/basic-studies.json。作り方は scripts/make-basic-studies.mjs）。
// 「＋ 研究手順を登録」→「基本の研究を入れる」で選んで定跡帳に入れる。入れた後は自分の研究手順と同じ（直す・消す・稽古）。
// reviewed が false の組は「未確認」の印で出す（有段者の持ち主が中身を確かめたら true にする）

import data from '../data/basic-studies.json';
import type { Side } from '../shogi/position';
import { autoName, studyFromMoves } from './bookEdit';
import type { OpeningTemplate } from './templates';
import type { Study } from './types';

/** 基本の研究の組（1 つの戦型・自分の側） */
export interface BasicSet {
  id: string;
  /** 戦型の id（出発点。手順はこの戦型の後から） */
  templateId: string;
  name: string;
  mySide: Side;
  /** 持ち主が中身を確かめたか（false なら「未確認」） */
  reviewed: boolean;
  /** 元にした同梱ツリーと版 */
  source: { tree: string; version: number };
  /** 戦型の出発点からの手（USI）を空白でつないだもの */
  lines: string[];
}

export const BASIC_SETS: readonly BasicSet[] = data.sets as BasicSet[];

/** 窓の 1 行：入れる研究手順と、同じ手順ですでにある研究手順（あれば入れない） */
export interface BasicRow {
  study: Study;
  have: Study | null;
}

const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((m, i) => m === b[i]);

/**
 * 組から、入れる研究手順を作る（戦型が見つからなければ null）。
 * 名前は自動（今の研究手順と、先に並ぶ基本の研究との分かれ目から）。作った日時は 1 ミリ秒ずつずらす（並びと分かれ目のため）
 */
export function basicRows(set: BasicSet, templates: readonly OpeningTemplate[], existing: readonly Study[], now: number, newId: () => string): BasicRow[] | null {
  const template = templates.find((t) => t.id === set.templateId);
  if (!template) return null;
  const pool: Study[] = existing.filter((s) => s.mySide === set.mySide);
  return set.lines.map((line, i) => {
    const moves = [...template.moves, ...line.split(' ')];
    const have = existing.find((s) => s.mySide === set.mySide && same(s.moves, moves)) ?? null;
    const made = studyFromMoves(moves, set.mySide, templates, now + i, newId());
    const study = { ...made, name: autoName(made, pool, templates) };
    if (!have) pool.push(study);
    return { study, have };
  });
}

/** 選んだ行のうち、まだ無い研究手順（保存するもの） */
export function basicToAdd(rows: readonly BasicRow[], picked: ReadonlySet<string>): Study[] {
  return rows.filter((r) => !r.have && picked.has(r.study.id)).map((r) => r.study);
}

/** 手数（「28手目まで」） */
export function lineEnd(row: BasicRow): string {
  return `${row.study.moves.length}手目まで`;
}
