import { describe, expect, it } from 'vitest';
import {
  MultiPvCollector,
  formatScore,
  negateScore,
  parseBestmove,
  parseInfo,
  scoreToNumber,
} from '../../src/engine/usi';

describe('parseInfo', () => {
  it('評価値・深さ・読み筋を読み取る', () => {
    const info = parseInfo('info depth 12 seldepth 18 score cp 85 multipv 2 nodes 123456 nps 456789 time 270 pv 7g7f 3c3d 2g2f');
    expect(info).toEqual({
      depth: 12,
      seldepth: 18,
      score: { kind: 'cp', value: 85 },
      multipv: 2,
      nodes: 123456,
      nps: 456789,
      time: 270,
      pv: ['7g7f', '3c3d', '2g2f'],
    });
  });

  it('multipv が無ければ 1', () => {
    expect(parseInfo('info depth 1 score cp 0 pv 7g7f')?.multipv).toBe(1);
  });

  it('詰みの評価値（mate）を読み取る', () => {
    expect(parseInfo('info depth 5 score mate 7 pv 2b3c+')?.score).toEqual({ kind: 'mate', plies: 7 });
    expect(parseInfo('info depth 5 score mate -4 pv 1a1b')?.score).toEqual({ kind: 'mate', plies: -4 });
    expect(parseInfo('info depth 5 score mate + pv 1a1b')?.score).toEqual({ kind: 'mate', plies: 999 });
    expect(parseInfo('info depth 5 score mate - pv 1a1b')?.score).toEqual({ kind: 'mate', plies: -999 });
  });

  it('lowerbound / upperbound を読み取る', () => {
    const info = parseInfo('info depth 10 score cp 120 lowerbound nodes 10 pv 7g7f');
    expect(info?.bound).toBe('lower');
    expect(info?.score).toEqual({ kind: 'cp', value: 120 });
    expect(info?.nodes).toBe(10);
  });

  it('info string は文字列として読む', () => {
    expect(parseInfo('info string loading eval file : eval/nn.bin')?.string).toBe('loading eval file : eval/nn.bin');
  });

  it('info 行でなければ null', () => {
    expect(parseInfo('bestmove 7g7f')).toBeNull();
    expect(parseInfo('readyok')).toBeNull();
  });
});

describe('parseBestmove', () => {
  it('bestmove と ponder を読み取る', () => {
    expect(parseBestmove('bestmove 7g7f ponder 3c3d')).toEqual({ move: '7g7f', ponder: '3c3d' });
    expect(parseBestmove('bestmove resign')).toEqual({ move: 'resign' });
    expect(parseBestmove('info depth 1')).toBeNull();
  });
});

describe('評価値の大小比較', () => {
  it('詰み > 大きな cp > 小さな cp > 詰まされ', () => {
    const order = [
      { kind: 'mate', plies: 3 },
      { kind: 'mate', plies: 9 },
      { kind: 'cp', value: 3000 },
      { kind: 'cp', value: -50 },
      { kind: 'mate', plies: -10 },
      { kind: 'mate', plies: -2 },
    ] as const;
    const numbers = order.map((s) => scoreToNumber(s));
    const sorted = [...numbers].sort((a, b) => b - a);
    expect(numbers).toEqual(sorted);
  });

  it('反対側から見た値', () => {
    expect(negateScore({ kind: 'cp', value: 120 })).toEqual({ kind: 'cp', value: -120 });
    expect(negateScore({ kind: 'mate', plies: 5 })).toEqual({ kind: 'mate', plies: -5 });
  });

  it('表示用の文字', () => {
    expect(formatScore({ kind: 'cp', value: 120 })).toBe('+120');
    expect(formatScore({ kind: 'cp', value: -45 })).toBe('−45');
    expect(formatScore({ kind: 'cp', value: 0 })).toBe('0');
    expect(formatScore({ kind: 'mate', plies: 5 })).toBe('詰み 5手');
    expect(formatScore({ kind: 'mate', plies: -4 })).toBe('詰まされ 4手');
  });
});

describe('MultiPvCollector', () => {
  it('各候補について最後に出た行を採用する', () => {
    const c = new MultiPvCollector();
    const lines = [
      'info depth 1 score cp 10 multipv 1 pv 7g7f',
      'info depth 1 score cp 5 multipv 2 pv 2g2f',
      'info depth 2 score cp 30 multipv 1 nodes 100 nps 1000 pv 2g2f 8c8d',
      'info depth 2 score cp 20 multipv 2 nodes 200 nps 2000 pv 7g7f 3c3d',
      'info depth 3 currmove 7g7f currmovenumber 1',
      'info depth 3 score cp 25 multipv 1 lowerbound nodes 300 pv 2g2f 8c8d 2f2e',
    ];
    for (const l of lines) c.add(parseInfo(l)!);
    const result = c.lines();
    expect(result.map((r) => r.multipv)).toEqual([1, 2]);
    expect(result[0]).toMatchObject({ score: { kind: 'cp', value: 25 }, depth: 3, bound: 'lower', pv: ['2g2f', '8c8d', '2f2e'] });
    expect(result[1]).toMatchObject({ score: { kind: 'cp', value: 20 }, depth: 2, pv: ['7g7f', '3c3d'] });
    expect(c.depth).toBe(3);
    expect(c.nodes).toBe(300);
    expect(c.nps).toBe(2000);
  });
});
