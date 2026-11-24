// 段階20-2：エンジンに聞く（src/tree/ask.ts）の並べ方・評価値の向き・研究の手の調べ直し
import { describe, expect, it } from 'vitest';
import type { PvLine } from '../../src/engine/usi';
import { ASK_MULTIPV_MINE, ASK_MULTIPV_OPP, askMultiPV, askRows, lossText, missingBookMoves } from '../../src/tree/ask';
import { STARTPOS_SFEN } from '../../src/shogi/position';

const line = (multipv: number, cp: number, pv: string[]): PvLine => ({ multipv, score: { kind: 'cp', value: cp }, depth: 10, pv });

describe('エンジンに聞く', () => {
  it('候補の数：相手の手番は 4、自分の手番は 3', () => {
    expect(askMultiPV(STARTPOS_SFEN, 'white')).toBe(ASK_MULTIPV_OPP);
    expect(askMultiPV(STARTPOS_SFEN, 'black')).toBe(ASK_MULTIPV_MINE);
  });

  it('研究の手のうち候補に無いものだけを調べ直す', () => {
    const lines = [line(1, 50, ['7g7f', '3c3d']), line(2, 40, ['2g2f', '8c8d'])];
    expect(missingBookMoves(lines, ['2g2f', '5g5f'])).toEqual(['5g5f']);
    expect(missingBookMoves(lines, [])).toEqual([]);
  });

  it('相手の手番：評価値は自分の側から（向きを変える）、差は相手から見た最善手との差', () => {
    // 初期局面で自分は後手（相手＝先手の手番）
    const rows = askRows(STARTPOS_SFEN, 'white', [line(1, 60, ['2g2f', '8c8d']), line(2, 30, ['7g7f', '3c3d'])], [], ['7g7f']);
    expect(rows.map((r) => r.move)).toEqual(['2g2f', '7g7f']);
    expect(rows[0]).toMatchObject({ score: { kind: 'cp', value: -60 }, diff: 0, reply: '8c8d', inBook: false });
    expect(rows[1]).toMatchObject({ score: { kind: 'cp', value: -30 }, diff: 30, inBook: true });
  });

  it('自分の手番：評価値はそのまま。調べ直した研究の手は差の順に並ぶ', () => {
    const rows = askRows(STARTPOS_SFEN, 'black', [line(1, 60, ['2g2f']), line(2, 50, ['7g7f'])], [line(1, -20, ['9g9f'])], ['9g9f']);
    expect(rows.map((r) => [r.move, r.diff, r.inBook])).toEqual([
      ['2g2f', 0, false],
      ['7g7f', 10, false],
      ['9g9f', 80, true],
    ]);
    expect(rows[0].score).toEqual({ kind: 'cp', value: 60 });
    expect(rows[0].reply).toBeUndefined();
  });

  it('調べ直した手が最善手より良く出ても差は 0。同じ手は 1 行だけ', () => {
    const rows = askRows(STARTPOS_SFEN, 'black', [line(1, 60, ['2g2f'])], [line(1, 70, ['7g7f']), line(2, 0, ['2g2f'])], ['7g7f']);
    expect(rows.map((r) => [r.move, r.diff])).toEqual([
      ['2g2f', 0],
      ['7g7f', 0],
    ]);
  });

  it('候補が無ければ空', () => {
    expect(askRows(STARTPOS_SFEN, 'black', [], [], [])).toEqual([]);
  });

  it('差の言葉', () => {
    expect(lossText(0)).toBe('最善');
    expect(lossText(45)).toBe('最善から −45');
  });
});
