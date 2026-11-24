// 段階20-3：基本の研究（src/data/basic-studies.json・src/tree/basicStudies.ts）
// データが同梱ツリーの本線と合っているか（作り直し忘れ・手の打ち間違いを見つける）と、入れる研究手順の作り方
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BASIC_SETS, basicRows, basicToAdd } from '../../src/tree/basicStudies';
import { BUNDLED_TEMPLATES } from '../../src/tree/templates';
import type { TreeData } from '../../src/tree/types';
import { applyUsiMove, STARTPOS_SFEN } from '../../src/shogi/position';

const tree = (id: string, version: number): TreeData =>
  JSON.parse(readFileSync(new URL(`../../public/trees/${id}.v${version}.json`, import.meta.url), 'utf8')).tree as TreeData;

describe('基本の研究のデータ', () => {
  it('横歩取り △3三角（後手番）の 4 本（端歩の手順は外した）。どれも未確認', () => {
    const set = BASIC_SETS.find((s) => s.id === 'yokofu-33kaku-gote')!;
    expect(set.mySide).toBe('white');
    expect(set.reviewed).toBe(false);
    expect(set.lines).toHaveLength(4);
    // 分かれ目の相手の手（17・19 手目）に端歩が無い
    for (const line of set.lines) {
      const m = line.split(' ');
      expect(['9g9f', '1g1f']).not.toContain(m[0]);
      expect(['9g9f', '1g1f']).not.toContain(m[2]);
    }
  });

  for (const set of BASIC_SETS) {
    it(`${set.name}：どの手順も同梱ツリーの中を通り、合法手で、ツリーの終わりまで`, () => {
      const t = tree(set.source.tree, set.source.version);
      const template = BUNDLED_TEMPLATES.find((x) => x.id === set.templateId)!;
      expect(template).toBeTruthy();
      expect(template.mySide).toBe(set.mySide);
      for (const line of set.lines) {
        let key = t.rootKey;
        let sfen = STARTPOS_SFEN;
        for (const m of template.moves) sfen = applyUsiMove(sfen, m)!.sfen;
        for (const m of line.split(' ')) {
          const edge = t.nodes[key]?.edges.find((e) => e.move === m);
          expect(edge, `${line} の ${m}`).toBeTruthy();
          key = edge!.to;
          const next = applyUsiMove(sfen, m);
          expect(next, `${m} が指せない`).not.toBeNull();
          sfen = next!.sfen;
        }
        expect(t.nodes[key]?.edges.length ?? 0).toBe(0);
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
      expect(r.study.moves).toHaveLength(28);
      expect(r.study.name).not.toBe('');
    }
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
