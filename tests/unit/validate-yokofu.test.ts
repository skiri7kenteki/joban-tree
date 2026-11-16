// 横歩取りの戦型テンプレート（yokofu-templates.json）を確かめるテスト。
// 持ち主から受け取ったテスト（段階5）。JSON の置き場所に合わせて import のパスだけ直した。
import { describe, expect, test } from 'vitest';
import { STARTPOS_SFEN, applyUsiMove, sideToMove } from '../../src/shogi/position';
import data from '../../src/data/templates/yokofu-templates.json';

describe('戦型テンプレート（横歩取り）', () => {
  test('形式', () => {
    expect(data.app).toBe('joban-tree');
    expect(data.kind).toBe('opening-templates');
    expect(data.version).toBe(1);
    expect(data.templates.length).toBe(6);
  });

  test('id が重複していない', () => {
    const ids = data.templates.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  for (const t of data.templates) {
    test(`${t.name}：手順がすべて合法で、自分の側が「出発点で手番でない側」になっている`, () => {
      let sfen = STARTPOS_SFEN;
      for (const move of t.moves) {
        const r = applyUsiMove(sfen, move);
        expect(r, `${t.id} の ${move} が合法でない`).not.toBeNull();
        sfen = r!.sfen;
      }
      const toMove = sideToMove(sfen);
      expect(t.mySide).toBe(toMove === 'black' ? 'white' : 'black');
      expect(t.reviewed).toBe(true);
    });
  }
});
