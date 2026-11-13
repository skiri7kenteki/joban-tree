// 貼り付けられた棋譜（KIF / KI2 / CSA / SFEN / USI の指し手列）を読み、
// 「初期局面から順に、各手を指した後の局面」の一覧にする。

import {
  Move,
  Record,
  RecordFormatType,
  detectRecordFormat,
  importCSA,
  importJKFString,
  importKI2,
  importKIF,
} from 'tsshogi';

/** 手順の 1 か所（その手を指した後の局面） */
export interface LinePosition {
  /** その局面の SFEN */
  sfen: string;
  /** その局面に至った指し手（USI 形式）。最初の局面には無い */
  usi?: string;
  /** 指し手の日本語表記（例：「▲７六歩」）。最初の局面には無い */
  text?: string;
}

export type ParseResult = { ok: true; line: LinePosition[] } | { ok: false; message: string };

/** USI 形式の指し手 1 つ（例：7g7f、8h2b+、P*5e） */
const USI_MOVE = String.raw`(?:[1-9][a-i][1-9][a-i]\+?|[PLNSGBR]\*[1-9][a-i])`;
/** 指し手だけが並んでいる（例：「7g7f 3c3d 2g2f」） */
const BARE_USI_MOVES = new RegExp(String.raw`^${USI_MOVE}(?:\s+${USI_MOVE})*$`);
/** SFEN だけ（例：「lnsgkgsnl/1r5b1/... b - 1」） */
const BARE_SFEN = /^[1-9lnsgkrbpLNSGKRBP+]+(?:\/[1-9lnsgkrbpLNSGKRBP+]+){8}\s+[bw]\s+\S+(?:\s+\d+)?/;

/** 貼り付けられた文字列を棋譜として読む */
export function parseKifu(input: string): ParseResult {
  const text = input.replace(/\r\n?/g, '\n').trim();
  if (!text) return { ok: false, message: '棋譜が空です' };

  const record = toRecord(text);
  if (record instanceof Error) {
    return { ok: false, message: `棋譜を読み取れませんでした（${record.message}）` };
  }
  return { ok: true, line: mainLine(record) };
}

/** 形式を見分けて tsshogi の Record にする */
function toRecord(text: string): Record | Error {
  // 指し手だけ・SFEN だけ・「startpos moves ...」は tsshogi の形式判定が苦手なので先に見分ける
  if (BARE_USI_MOVES.test(text)) return Record.newByUSI(`position startpos moves ${text}`);
  if (/^(startpos|sfen)\b/.test(text)) return Record.newByUSI(`position ${text}`);
  if (BARE_SFEN.test(text)) {
    const [board, color, hand, ply, ...rest] = text.split(/\s+/);
    const moves = rest[0] === 'moves' ? ` moves ${rest.slice(1).join(' ')}` : '';
    return Record.newByUSI(`position sfen ${board} ${color} ${hand} ${ply ?? '1'}${moves}`);
  }

  switch (detectRecordFormat(text)) {
    case RecordFormatType.USI:
    case RecordFormatType.SFEN:
      return Record.newByUSI(text);
    case RecordFormatType.KI2:
      return importKI2(text);
    case RecordFormatType.CSA:
      return importCSA(text);
    case RecordFormatType.JKF:
      return importJKFString(text);
    case RecordFormatType.USEN:
      return Record.newByUSEN(text);
    case RecordFormatType.KIF:
    default:
      return importKIF(text);
  }
}

/** 本譜（分岐を除いた手順）を、局面の一覧にする */
function mainLine(record: Record): LinePosition[] {
  record.goto(0);
  const line: LinePosition[] = [{ sfen: record.position.getSFEN(record.current.ply + 1) }];
  while (record.goForward()) {
    const node = record.current;
    // 「投了」などの特別な手は局面を変えないので含めない
    if (!(node.move instanceof Move)) break;
    line.push({
      sfen: record.position.getSFEN(node.ply + 1),
      usi: node.move.usi,
      text: node.displayText.replace('☗', '▲').replace('☖', '△'),
    });
  }
  return line;
}
