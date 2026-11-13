// 速度測定に使う局面の手順が、将棋のルール上正しいことを tsshogi で確かめる
import { describe, expect, it } from 'vitest';
import { Record } from 'tsshogi';
import { BENCH_POSITIONS } from '../../src/bench/positions';

describe('速度測定の局面', () => {
  for (const p of BENCH_POSITIONS) {
    it(`${p.name} は合法な手順`, () => {
      const record = Record.newByUSI(`position ${p.position}`);
      expect(record).not.toBeInstanceOf(Error);
      const expectedMoves = p.position.includes(' moves ') ? p.position.split(' moves ')[1].split(' ').length : 0;
      // moves[0] は開始局面なので、指し手の数は length - 1
      expect((record as Record).moves.length - 1).toBe(expectedMoves);
    });
  }
});
