// 研究手順の書き出し・取り込み（段階8-1）。
//   - JSON（このアプリで取り込むため）：{ app, kind: "studies", version: 1, studies: [研究手順] }
//     ほかの人から受け取ったファイルも読むので、形と手順（平手から指せるか）をすべて確かめ、1 つでもおかしければ全体を読まない
//   - KIF（ほかのソフトで見るため）：平手の棋譜。複数なら共通の部分をまとめた変化付きの 1 つの KIF。
//     それぞれの研究手順の最後の手のコメントに「★名前」とメモ（変化付き KIF の取り込み、段階8-2 で名前として読み戻す）
// 同じ手順の研究手順があるときの取り込みは「置き換える・両方残す・取り込まない」から選ぶ（戦型の取り込みと同じ）。

import { Position, Record, RecordMetadataKey, exportKIF } from 'tsshogi';
import { STARTPOS_SFEN } from '../shogi/position';
import { newStudyId, sameMoves } from './studies';
import { templateLine } from './templates';
import { TREE_APP, type Study } from './types';

export const STUDY_KIND = 'studies';
export const STUDY_FILE_VERSION = 1;

export interface StudyFile {
  app: typeof TREE_APP;
  kind: typeof STUDY_KIND;
  version: number;
  studies: Study[];
}

/** 書き出す形だけを取り出す */
function plain(s: Study): Study {
  return {
    id: s.id,
    name: s.name,
    note: s.note,
    moves: [...s.moves],
    mySide: s.mySide,
    ...(s.templateId ? { templateId: s.templateId } : {}),
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

/** JSON の文字列にする */
export function studiesToJson(list: readonly Study[]): string {
  const file: StudyFile = { app: TREE_APP, kind: STUDY_KIND, version: STUDY_FILE_VERSION, studies: list.map(plain) };
  return JSON.stringify(file, null, 2);
}

export type StudyParseResult = { ok: true; studies: Study[] } | { ok: false; message: string };

const isObject = (v: unknown): v is { [k: string]: unknown } => typeof v === 'object' && v !== null && !Array.isArray(v);
const isString = (v: unknown): v is string => typeof v === 'string';
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** 手を消した記録 1 件の形 */
function isCut(c: unknown): boolean {
  return isObject(c) && isNumber(c.at) && isNumber(c.keep) && c.keep >= 0 && Array.isArray(c.from) && c.from.length <= 2000 && c.from.every((x) => isString(x) && x.length <= 8);
}

/** 研究手順 1 本の形と手順を確かめる。問題が無ければ null、あれば理由 */
export function checkStudy(s: unknown): string | null {
  if (!isObject(s)) return '形';
  if (!isString(s.id) || !/^[\w-]{1,80}$/.test(s.id)) return 'id';
  if (!isString(s.name) || s.name.trim() === '' || s.name.trim().length > 100) return '名前';
  if (!isString(s.note) || s.note.length > 20000) return 'メモ';
  if (s.mySide !== 'black' && s.mySide !== 'white') return '自分の側';
  if (s.templateId !== undefined && (!isString(s.templateId) || s.templateId.length > 200)) return '戦型';
  if (!isNumber(s.createdAt) || !isNumber(s.updatedAt)) return '日付';
  if ([s.movesAt, s.noteAt, s.restoredAt].some((t) => t !== undefined && !isNumber(t))) return '日付';
  if (s.cuts !== undefined && !(Array.isArray(s.cuts) && s.cuts.length <= 100 && s.cuts.every(isCut))) return '消した手順';
  if (!Array.isArray(s.moves) || s.moves.length === 0 || !s.moves.every(isString)) return '手順';
  const line = templateLine(s.moves as string[]);
  if (!line.ok) return `${line.index + 1} 手目が指せません`;
  return null;
}

/** 書き出したファイルの文字列を読む */
export function parseStudiesJson(text: string): StudyParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, message: 'JSON として読めませんでした。研究手順を書き出したファイルを選んでください。' };
  }
  if (!isObject(raw) || raw.app !== TREE_APP || raw.kind !== STUDY_KIND) {
    return { ok: false, message: '研究手順のファイルではありません（研究手順の「書き出し」で作った JSON を選んでください）。' };
  }
  if (!isNumber(raw.version) || raw.version > STUDY_FILE_VERSION) {
    return { ok: false, message: 'アプリより新しい形式のファイルです。アプリを最新にしてから読み込んでください。' };
  }
  if (!Array.isArray(raw.studies) || raw.studies.length === 0) return { ok: false, message: '研究手順が入っていません。' };
  for (let i = 0; i < raw.studies.length; i++) {
    const problem = checkStudy(raw.studies[i]);
    if (problem) {
      const s = raw.studies[i] as { name?: unknown };
      const name = isString(s?.name) ? `「${s.name}」` : '';
      return { ok: false, message: `ファイルの中身がおかしいので、取り込みませんでした（${i + 1} 本目${name}の${problem}）。` };
    }
  }
  return { ok: true, studies: (raw.studies as Study[]).map((s) => ({ ...plain(s), name: s.name.trim() })) };
}

/** 取り込みの見通し */
export interface StudyImportPlan {
  /** 同じ手順が無い研究手順（そのまま足す） */
  fresh: Study[];
  /** まったく同じもの（手順・名前・メモ・自分の側）が既にある数（取り込まない） */
  same: number;
  /** 同じ手順で中身の違う研究手順が既にあるもの */
  conflicts: { incoming: Study; existing: Study }[];
}

export function planStudyImport(incoming: readonly Study[], existing: readonly Study[]): StudyImportPlan {
  const plan: StudyImportPlan = { fresh: [], same: 0, conflicts: [] };
  const ids = new Set(existing.map((s) => s.id));
  for (const s of incoming) {
    // 同じ手順の研究手順は「両方残す」で 2 本以上あることがある：どれかとまったく同じなら飛ばす。
    // 違えば、同じ id のもの（無ければ最初のもの）と比べて聞く（以前は最初の 1 本としか比べず、並び次第で「まったく同じ」を見落とした）
    const matches = existing.filter((e) => sameMoves(e.moves, s.moves));
    if (matches.length === 0) {
      // 手順の違う研究手順と id だけ重なった（または取り込むものどうしで重なった）ら、新しい id にする
      const study = ids.has(s.id) ? { ...s, id: newStudyId() } : s;
      ids.add(study.id);
      plan.fresh.push(study);
    } else if (matches.some((ex) => ex.name === s.name && ex.note === s.note && ex.mySide === s.mySide)) plan.same++;
    else plan.conflicts.push({ incoming: s, existing: matches.find((ex) => ex.id === s.id) ?? matches[0] });
  }
  return plan;
}

/** 同じ手順があるときの選び方：置き換える・両方残す（新しい id で足す）・取り込まない */
export type StudyConflictChoice = 'replace' | 'both' | 'skip';

/** 保存する研究手順を決める。skipped は取り込まなかった数（まったく同じものは数えない） */
export function resolveStudyImport(
  plan: StudyImportPlan,
  choice: StudyConflictChoice,
  newId: () => string = newStudyId,
): { put: Study[]; skipped: number } {
  const put = [...plan.fresh];
  let skipped = 0;
  for (const c of plan.conflicts) {
    // 置き換え：今の研究手順の id と作った日時はそのまま（★・開いている画面のリンクが切れないように）
    if (choice === 'replace') put.push({ ...c.incoming, id: c.existing.id, createdAt: c.existing.createdAt });
    else if (choice === 'both') put.push({ ...c.incoming, id: newId() });
    else skipped++;
  }
  return { put, skipped };
}

/** KIF のコメントの、研究手順の名前の印 */
export const KIF_NAME_MARK = '★';

/**
 * 研究手順を KIF にする（平手）。複数なら共通の部分をまとめた変化付きの 1 つの KIF（並びの最初の研究手順が本譜）。
 * それぞれの研究手順の最後の手のコメントに「★名前」と、その下にメモ
 */
/**
 * noteOf：局面メモ（段階20-1。定跡帳の書き出し）。その局面に来た手のコメントに「局面メモ：…」（手順前後の 2 回目からは書かない）。
 * 研究手順の終わりの「★名前」はコメントの先頭に置く（KIF から取り込むとき、★ で始まるコメントを研究手順の終わりとして読むため）
 * candidatesOf：その局面の候補の行（段階21-1「候補：▲２四歩（本命）、…」）。コメントに書くだけで、悪手は変化にしない
 */
export function studiesToKif(list: readonly Study[], title?: string, noteOf?: (sfen: string) => string, candidatesOf?: (sfen: string) => string): string {
  const position = Position.newBySFEN(STARTPOS_SFEN)!;
  const record = new Record(position);
  record.metadata.setStandardMetadata(RecordMetadataKey.TITLE, title ?? (list.length === 1 ? list[0].name : `研究手順（${list.length} 本）`));
  const noted = new Set<string>();
  for (const s of list) {
    record.goto(0);
    for (const usi of s.moves) {
      const move = record.position.createMoveByUSI(usi);
      // 既に同じ手があれば、その手へ進む（tsshogi の append）。共通の部分は 1 つにまとまる
      if (!move || !record.append(move)) throw new Error(`「${s.name}」の指し手 ${usi} を棋譜に入れられませんでした`);
      const sfen = record.position.sfen;
      const key = sfen.replace(/ \d+$/, '');
      if (noted.has(key)) continue;
      const memo = noteOf?.(sfen).trim();
      const lines = [candidatesOf?.(sfen) ?? '', memo ? `局面メモ：${memo}` : ''].filter(Boolean);
      if (lines.length > 0) {
        noted.add(key);
        record.current.comment = [record.current.comment, ...lines].filter(Boolean).join('\n');
      }
    }
    const text = [`${KIF_NAME_MARK}${s.name}`, ...(s.note.trim() ? [s.note.trimEnd()] : [])].join('\n');
    record.current.comment = record.current.comment ? `${text}\n${record.current.comment}` : text;
  }
  record.goto(0);
  return exportKIF(record);
}
