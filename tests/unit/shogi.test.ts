// 局面・指し手の小さな関数と、棋譜の貼り付けの読み取りを確かめる
import { describe, expect, it } from 'vitest';
import { parseKifu } from '../../src/shogi/kifu';
import { STARTPOS_SFEN, applyUsiMove, moveText, sfenKey, sideToMove } from '../../src/shogi/position';

describe('局面と指し手', () => {
  it('局面のキーは手数を除いた SFEN', () => {
    expect(sfenKey(STARTPOS_SFEN)).toBe('lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b -');
  });

  it('指し手を指した後の局面を返し、反則なら null', () => {
    const after = applyUsiMove(STARTPOS_SFEN, '7g7f');
    expect(after?.sfen).toBe('lnsgkgsnl/1r5b1/ppppppppp/9/9/2P6/PP1PPPPPP/1B5R1/LNSGKGSNL w - 2');
    expect(sideToMove(after!.sfen)).toBe('white');
    expect(applyUsiMove(STARTPOS_SFEN, '7g7e')).toBeNull();
    expect(applyUsiMove(STARTPOS_SFEN, '3c3d')).toBeNull();
  });

  it('指し手を日本語で表す（同の表記を含む）', () => {
    expect(moveText(STARTPOS_SFEN, '7g7f')).toBe('▲７六歩');
    const sfen = 'lnsgkgsnl/1r5b1/pppppp1pp/6p2/9/2P6/PP1PPPPPP/1B5R1/LNSGKGSNL b - 3';
    expect(moveText(sfen, '8h2b+', '3c3d')).toBe('▲２二角成');
    const sfen2 = 'lnsgkgsnl/1r5+B1/pppppp1pp/6p2/9/2P6/PP1PPPPPP/7R1/LNSGKGSNL w B 4';
    expect(moveText(sfen2, '3a2b', '8h2b+')).toBe('△同　銀');
  });
});

describe('棋譜の貼り付け', () => {
  const after2 = 'lnsgkgsnl/1r5b1/pppppp1pp/6p2/9/2P6/PP1PPPPPP/1B5R1/LNSGKGSNL b - 3';

  it.each([
    ['USI の指し手だけ', '7g7f 3c3d'],
    ['position コマンド', 'position startpos moves 7g7f 3c3d'],
    ['startpos moves', 'startpos moves 7g7f 3c3d'],
    ['KIF', '手合割：平手\n手数----指手---------消費時間--\n   1 ７六歩(77)   ( 0:00/00:00:00)\n   2 ３四歩(33)   ( 0:00/00:00:00)\n'],
    ['KI2', '▲７六歩 △３四歩'],
    ['CSA', 'PI\n+\n+7776FU\n-3334FU\n'],
  ])('%s を読める', (_name, text) => {
    const result = parseKifu(text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.line).toHaveLength(3);
    expect(result.line[0].sfen).toBe(STARTPOS_SFEN);
    expect(result.line.map((p) => p.usi)).toEqual([undefined, '7g7f', '3c3d']);
    expect(result.line[1].text).toBe('▲７六歩');
    expect(result.line[2].sfen).toBe(after2);
  });

  it('SFEN だけを貼ると、その局面 1 つになる', () => {
    const result = parseKifu(after2);
    // 手数は tsshogi が 1 に戻すことがあるので、手数を除いたキーで比べる
    expect(result.ok && result.line.map((p) => sfenKey(p.sfen))).toEqual([sfenKey(after2)]);
  });

  it('読めないときはエラーの説明を返す', () => {
    expect(parseKifu('').ok).toBe(false);
    expect(parseKifu('7g7f 7g7f').ok).toBe(false);
  });
});
