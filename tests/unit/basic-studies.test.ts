// 段階20-3：基本の研究（src/data/basic-studies.json・src/tree/basicStudies.ts）
// データの手順が合法手でつながるか（手の打ち間違いを見つける）と、入れる研究手順の作り方
import { describe, expect, it } from 'vitest';
import { BASIC_SETS, basicRows, basicToAdd } from '../../src/tree/basicStudies';
import { BUNDLED_TEMPLATES } from '../../src/tree/templates';
import { applyUsiMove, STARTPOS_SFEN } from '../../src/shogi/position';

describe('基本の研究のデータ', () => {
  it('横歩取り △3三角（後手番）の 4 本（青野流 3 本と ▲3六飛 1 本）。どれも出典があり、持ち主の確認済み', () => {
    const set = BASIC_SETS.find((s) => s.id === 'yokofu-33kaku-gote')!;
    expect(set.mySide).toBe('white');
    expect(set.reviewed).toBe(true);
    expect(set.lines.map((l) => l.moves.split(' ')[0])).toEqual(['5i5h', '5i5h', '5i5h', '3d3f']);
    for (const line of set.lines) {
      expect(line.note).not.toBe('');
      expect(line.source).not.toBe('');
    }
  });

  for (const set of BASIC_SETS) {
    it(`${set.name}：どの手順も戦型の出発点から合法手でつながる`, () => {
      const template = BUNDLED_TEMPLATES.find((x) => x.id === set.templateId)!;
      expect(template).toBeTruthy();
      expect(template.mySide).toBe(set.mySide);
      for (const line of set.lines) {
        let sfen = STARTPOS_SFEN;
        for (const m of template.moves) sfen = applyUsiMove(sfen, m)!.sfen;
        for (const m of line.moves.split(' ')) {
          const next = applyUsiMove(sfen, m);
          expect(next, `${line.note} の ${m} が指せない`).not.toBeNull();
          sfen = next!.sfen;
        }
      }
    });
  }
});

describe('入れる研究手順を作る', () => {
  const set = BASIC_SETS[0];
  let seq = 0;
  const newId = () => `b${++seq}`;

  it('戦型の出発点からの手順・自分の側・戦型・名前（自動）', () => {
    const rows = basicRows(set, BUNDLED_TEMPLATES, [], 1000, newId)!;
    expect(rows).toHaveLength(4);
    const template = BUNDLED_TEMPLATES.find((x) => x.id === set.templateId)!;
    for (const r of rows) {
      expect(r.have).toBeNull();
      expect(r.study.mySide).toBe('white');
      expect(r.study.templateId).toBe(set.templateId);
      expect(r.study.moves.slice(0, template.moves.length)).toEqual(template.moves);
      expect(r.study.name).not.toBe('');
    }
    expect(rows.map((r) => r.study.moves.length)).toEqual([26, 31, 24, 28]);
    // 名前はみな違う
    expect(new Set(rows.map((r) => r.study.name)).size).toBe(4);
    expect(rows.map((r) => r.study.createdAt)).toEqual([1000, 1001, 1002, 1003]);
  });

  it('同じ手順の研究手順がすでにあれば入れない（選んでいても）', () => {
    const first = basicRows(set, BUNDLED_TEMPLATES, [], 1000, newId)!;
    const existing = [first[1].study];
    const rows = basicRows(set, BUNDLED_TEMPLATES, existing, 2000, newId)!;
    expect(rows[1].have?.id).toBe(first[1].study.id);
    const picked = new Set(rows.map((r) => r.study.id));
    expect(basicToAdd(rows, picked).map((s) => s.moves)).toEqual([rows[0], rows[2], rows[3]].map((r) => r.study.moves));
    // 選ばなかったものは入れない
    expect(basicToAdd(rows, new Set([rows[0].study.id]))).toHaveLength(1);
  });

  it('先手番の研究手順は「すでにある」に数えない', () => {
    const first = basicRows(set, BUNDLED_TEMPLATES, [], 1000, newId)!;
    const black = { ...first[0].study, id: 'x', mySide: 'black' as const };
    expect(basicRows(set, BUNDLED_TEMPLATES, [black], 2000, newId)![0].have).toBeNull();
  });

  it('戦型が見つからなければ null', () => {
    expect(basicRows({ ...set, templateId: 'nai' }, BUNDLED_TEMPLATES, [], 0, newId)).toBeNull();
  });

});
