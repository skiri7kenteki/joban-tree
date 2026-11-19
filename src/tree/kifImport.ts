// 変化付き KIF から研究手順をまとめて取り込む（段階8-2）。
// ShogiHome などで作った研究用の KIF を、そのまま研究手順にする。
//   - 本譜と、それぞれの変化（変化の中の変化も）の終わり 1 つにつき 1 本。手順は平手の初期局面からその終わりまで
//   - このアプリで書き出した KIF（studiesToKif）は、コメントの先頭が「★」の手も研究手順の終わりとして扱い、「★」の後を名前に読み戻す
//     （途中の局面で終わる研究手順も戻るように。持ち主の判断 2026-11-18）
//   - メモ：その終わりまでの手に付いたコメントを「n手目 ▲２六飛：コメント」の形で並べる（開始局面のコメントは「開始局面：」）。
//     ShogiHome が解析で自動で付ける「#」で始まる行（評価値・読み筋）は入れない（持ち主の判断）。ほかの研究手順の「★名前」のコメントも入れない。
//     3000 文字を超えたら後ろを「（以下略）」で切る
//   - 名前の初期値：戦型の出発点の後の手順から。長ければ分かれ目（その変化が分かれた手、手数付き）を間に入れる（持ち主の判断）
//   - 自分の側の初期値：本譜から推定（戦型が分かればその側、無ければ本譜の最後の手を指した側）。確認の画面でまとめて切り替える
//   - 平手以外の初期局面・読めない KIF は、理由を出して取り込まない
//   - 本数が多くても画面が固まらないよう、候補は少しずつ作る（buildCandidates）。一度に取り込めるのは KIF_IMPORT_MAX 本まで

import { Move, type ImmutableNode } from 'tsshogi';
import { toRecord } from '../shogi/kifu';
import { STARTPOS_SFEN, type Side } from '../shogi/position';
import { guessSide, nameFromTexts, newStudyId, startTemplate } from './studies';
import { templateIdFor } from './bookEdit';
import type { OpeningTemplate } from './templates';
import { KIF_NAME_MARK } from './studyFile';
import type { Study } from './types';

/** 一度に取り込める研究手順の数 */
export const KIF_IMPORT_MAX = 2000;
/** メモの上限（研究手順の名前・メモの決まりと同じ） */
export const NOTE_MAX = 3000;
const NAME_MAX = 100;
const CUT_MARK = '（以下略）';

export type KifReadResult =
  | {
      ok: true;
      /** 研究手順の終わりごとの、初期局面の次の手からの手の並び（本譜が最初） */
      ends: ImmutableNode[][];
      /** 初期局面（コメントを読む） */
      root: ImmutableNode;
      /** 本譜の手順（自分の側の推定に使う） */
      mainMoves: string[];
    }
  | { ok: false; message: string };

/** 指し手の子（本譜の続きと変化）。「投了」などの特別な手は除く */
function childrenOf(node: ImmutableNode): ImmutableNode[] {
  const out: ImmutableNode[] = [];
  for (let c = node.next; c; c = c.branch) if (c.move instanceof Move) out.push(c);
  return out;
}

/** コメントから、取り込まない行（「#」で始まる＝解析で自動で付いた行）を除く */
export function cleanComment(comment: string): string {
  return comment
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => !l.trimStart().startsWith('#'))
    .join('\n')
    .trim();
}

/** 「★名前」で始まるコメントか（このアプリで書き出した KIF の研究手順の終わり） */
function isNamedEnd(node: ImmutableNode): boolean {
  return cleanComment(node.comment).startsWith(KIF_NAME_MARK);
}

/** 貼り付けた・選んだ KIF を読み、研究手順の終わりを集める */
export function readKif(text: string): KifReadResult {
  const body = text.replace(/\r\n?/g, '\n').trim();
  if (!body) return { ok: false, message: '棋譜が空です。' };
  const record = toRecord(body);
  if (record instanceof Error) return { ok: false, message: `棋譜を読み取れませんでした（${record.message}）。KIF の形か確かめてください。` };
  record.goto(0);
  if (record.position.getSFEN(1) !== STARTPOS_SFEN) {
    return { ok: false, message: '平手の初期局面から始まる棋譜だけ取り込めます（この棋譜は駒落ちか、途中の局面から始まっています）。' };
  }
  const root = record.first;
  const ends: ImmutableNode[][] = [];
  let tooMany = false;
  const walk = (node: ImmutableNode, path: ImmutableNode[]) => {
    if (tooMany) return;
    const kids = childrenOf(node);
    if (path.length > 0 && (kids.length === 0 || isNamedEnd(node))) {
      ends.push(path);
      if (ends.length > KIF_IMPORT_MAX) {
        tooMany = true;
        return;
      }
    }
    for (const kid of kids) walk(kid, [...path, kid]);
  };
  walk(root, []);
  if (tooMany) {
    return { ok: false, message: `研究手順が ${KIF_IMPORT_MAX} 本を超えます。一度に取り込めるのは ${KIF_IMPORT_MAX} 本までです。KIF を分けて取り込んでください。` };
  }
  if (ends.length === 0) return { ok: false, message: '指し手がありません。' };
  const mainMoves: string[] = [];
  for (let n = childrenOf(root)[0]; n; n = childrenOf(n)[0]) mainMoves.push((n.move as Move).usi);
  return { ok: true, ends, root, mainMoves };
}

/** 確認の画面の 1 行（取り込む研究手順の候補） */
export interface KifCandidate {
  /** 並び（KIF の中の順。本譜が 0） */
  index: number;
  moves: string[];
  name: string;
  note: string;
  /** 分かれ目（その変化が分かれた手、0 始まり。本譜なら無い） */
  branchAt?: number;
  /** 手の文字（平手から 1 手ずつ。名前を自分の側で付け直すため） */
  texts: string[];
  /** 「★名前」から読み戻した名前か（自分で付けた名前なので、自分の側を切り替えても変えない） */
  named: boolean;
  /** メモを 3000 文字で切った */
  noteCut: boolean;
  /** 同じ手順の研究手順がすでにある（初期値は取り込まない） */
  existing: Study | null;
}

const textOf = (node: ImmutableNode) => node.displayText.replace('☗', '▲').replace('☖', '△');

/** 終わり 1 つぶんの候補を作る */
export function candidateOf(
  path: readonly ImmutableNode[],
  root: ImmutableNode,
  index: number,
  templates: readonly OpeningTemplate[],
  existing: ReadonlyMap<string, Study>,
  side: Side = 'black',
): KifCandidate {
  const moves = path.map((n) => (n.move as Move).usi);
  const texts = path.map(textOf);
  // 分かれ目：本譜の続き（1 番目の手）でない手のうち、いちばん後のもの（その変化が、すぐ上の手順から分かれたところ）
  let branchAt: number | undefined;
  path.forEach((n, i) => {
    if (!n.isFirstBranch) branchAt = i;
  });

  const lines: string[] = [];
  const rootComment = cleanComment(root.comment);
  if (rootComment && !rootComment.startsWith(KIF_NAME_MARK)) lines.push(`開始局面：${rootComment}`);
  let named: string | null = null;
  let namedBody = '';
  path.forEach((n, i) => {
    const c = cleanComment(n.comment);
    if (!c) return;
    if (c.startsWith(KIF_NAME_MARK)) {
      // このアプリで書き出した KIF の研究手順の終わり：終わりの手なら名前とメモ、途中ならほかの研究手順のものなので入れない
      if (i === path.length - 1) {
        const [first, ...rest] = c.split('\n');
        named = first.slice(KIF_NAME_MARK.length).trim() || null;
        namedBody = rest.join('\n').trim();
      }
      return;
    }
    lines.push(`${i + 1}手目 ${texts[i]}：${c}`);
  });
  if (namedBody) lines.push(namedBody);
  let note = lines.join('\n');
  const noteCut = note.length > NOTE_MAX;
  if (noteCut) note = `${note.slice(0, NOTE_MAX - CUT_MARK.length)}${CUT_MARK}`;

  const base = { moves, texts, branchAt, named: named !== null, name: named ?? '' };
  const name = candidateName(base, side, templates);
  return { index, moves, name, note, branchAt, texts, named: named !== null, noteCut, existing: existing.get(moves.join(' ')) ?? null };
}

/**
 * 候補の名前：「★名前」から読み戻したものはそのまま。それ以外は名前の初期値（段階10 の直し：自分の側が同じ、いちばん浅い戦型の後から。
 * 自分の側で出発点が変わるので、側を切り替えたら付け直す）
 */
export function candidateName(c: Pick<KifCandidate, 'moves' | 'texts' | 'branchAt' | 'named' | 'name'>, side: Side, templates: readonly OpeningTemplate[]): string {
  if (c.named) return c.name;
  return nameFromTexts(c.texts, startTemplate(c.moves, side, templates, true), c.branchAt).slice(0, NAME_MAX);
}

/**
 * 候補をまとめて作る。本数が多くても画面が固まらないよう、chunk 本ごとに一息つく（onProgress で進み具合を知らせる）
 */
export async function buildCandidates(
  read: Extract<KifReadResult, { ok: true }>,
  templates: readonly OpeningTemplate[],
  existing: readonly Study[],
  onProgress?: (done: number, total: number) => void,
  chunk = 50,
): Promise<KifCandidate[]> {
  const byMoves = new Map(existing.map((s) => [s.moves.join(' '), s]));
  // 名前の初期値は自分の側の初期値で付ける（画面で側を切り替えたら candidateName で付け直す）
  const side = kifSide(
    read,
    templates,
    read.ends.map((path) => path.map((n) => (n.move as Move).usi)),
  );
  const out: KifCandidate[] = [];
  for (let i = 0; i < read.ends.length; i++) {
    out.push(candidateOf(read.ends[i], read.root, i, templates, byMoves, side));
    if ((i + 1) % chunk === 0) {
      onProgress?.(i + 1, read.ends.length);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  onProgress?.(read.ends.length, read.ends.length);
  return out;
}

/**
 * 自分の側の初期値：取り込む研究手順の終わりの手が全部後手の手なら後手、全部先手の手なら先手（段階10-1 の小さな直し）。
 * 混ざっていれば（または ends を渡さなければ）本譜から推定（戦型が分かればその側、無ければ本譜の最後の手を指した側）
 */
export function kifSide(read: Extract<KifReadResult, { ok: true }>, templates: readonly OpeningTemplate[], ends: readonly (readonly string[])[] = []): Side {
  const lasts = ends.filter((m) => m.length > 0).map((m) => (m.length % 2 === 1 ? 'black' : 'white'));
  if (lasts.length > 0 && lasts.every((s) => s === lasts[0])) return lasts[0];
  return guessSide(read.mainMoves, templates);
}

/** 選んだ候補を研究手順にする（並びを保つよう、日時を 1 ミリ秒ずつずらす：KIF の最初のものが一覧のいちばん上） */
export function candidatesToStudies(
  list: readonly KifCandidate[],
  mySide: Side,
  templates: readonly OpeningTemplate[],
  now: number,
  newId: () => string = newStudyId,
): Study[] {
  return list.map((c, i) => {
    const templateId = templateIdFor(c.moves, templates, mySide);
    const at = now + (list.length - i);
    return {
      id: newId(),
      name: candidateName(c, mySide, templates),
      note: c.note,
      moves: [...c.moves],
      mySide,
      ...(templateId ? { templateId } : {}),
      createdAt: at,
      updatedAt: at,
    };
  });
}

/** 選んだファイルを文字にする：UTF-8 として読めなければ Shift_JIS（ShogiHome などの .kif は Shift_JIS、.kifu は UTF-8） */
export function decodeKifFile(buffer: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder('shift_jis').decode(buffer);
  }
}
