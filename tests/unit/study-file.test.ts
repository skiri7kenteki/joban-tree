// 段階8-1：研究手順の書き出しと取り込み（JSON・KIF）
import { describe, expect, it } from 'vitest';
import { importKIF } from 'tsshogi';
import {
  parseStudiesJson,
  planStudyImport,
  resolveStudyImport,
  studiesToJson,
  studiesToKif,
} from '../../src/tree/studyFile';
import type { Study } from '../../src/tree/types';

const study = (id: string, moves: string[], opts: Partial<Study> = {}): Study => ({
  id,
  name: `研究${id}`,
  note: '',
  moves,
  mySide: 'white',
  createdAt: 1,
  updatedAt: 2,
  ...opts,
});

describe('JSON', () => {
  it('書き出して、そのまま読める（名前・メモ・手順・自分の側・戦型・日付）', () => {
    const list = [study('a', ['7g7f', '3c3d'], { note: '1 行目\n2 行目', templateId: 'yokofu-kihon' }), study('b', ['2g2f'], { mySide: 'black' })];
    const text = studiesToJson(list);
    expect(JSON.parse(text)).toMatchObject({ app: 'joban-tree', kind: 'studies', version: 1 });
    const r = parseStudiesJson(text);
    expect(r).toEqual({ ok: true, studies: list });
  });

  it('おかしいところが 1 つでもあれば全体を読まず、どの研究手順の何がおかしいかを示す', () => {
    const bad = (s: unknown) => JSON.stringify({ app: 'joban-tree', kind: 'studies', version: 1, studies: [study('a', ['7g7f']), s] });
    const r1 = parseStudiesJson(bad(study('b', ['7g7f', '3c3d', '7f7e', '1a1c'])));
    expect(r1).toEqual({ ok: false, message: expect.stringContaining('2 本目「研究b」の4 手目が指せません') });
    expect(parseStudiesJson(bad({ ...study('c', ['7g7f']), mySide: 'x' }))).toMatchObject({ ok: false, message: expect.stringContaining('自分の側') });
    expect(parseStudiesJson(bad({ ...study('d', []) }))).toMatchObject({ ok: false, message: expect.stringContaining('手順') });
    expect(parseStudiesJson(bad({ ...study('e', ['7g7f']), name: ' ' }))).toMatchObject({ ok: false, message: expect.stringContaining('名前') });
    expect(parseStudiesJson('{')).toMatchObject({ ok: false });
    expect(parseStudiesJson(JSON.stringify({ app: 'joban-tree', kind: 'opening-templates', version: 1, templates: [] }))).toMatchObject({
      ok: false,
      message: expect.stringContaining('研究手順のファイルではありません'),
    });
    expect(parseStudiesJson(JSON.stringify({ app: 'joban-tree', kind: 'studies', version: 2, studies: [] }))).toMatchObject({
      ok: false,
      message: expect.stringContaining('新しい形式'),
    });
  });

  it('取り込みの見通し：同じ手順が無いもの・まったく同じもの・同じ手順で中身の違うもの', () => {
    const existing = [study('a', ['7g7f']), study('b', ['2g2f'])];
    const incoming = [
      study('a', ['7g7f']), // まったく同じ
      study('x', ['2g2f'], { name: '別の名前' }), // 同じ手順で中身が違う
      study('b', ['5g5f']), // 手順は新しいが id が重なる → 新しい id
      study('c', ['6g6f']),
    ];
    const plan = planStudyImport(incoming, existing);
    expect(plan.same).toBe(1);
    expect(plan.conflicts.map((c) => [c.incoming.id, c.existing.id])).toEqual([['x', 'b']]);
    expect(plan.fresh.map((s) => s.moves[0])).toEqual(['5g5f', '6g6f']);
    expect(plan.fresh[0].id).not.toBe('b');
    expect(plan.fresh[1].id).toBe('c');
  });

  it('同じ手順の研究手順が 2 本あるとき（両方残した後）：どちらかとまったく同じなら、並びに関係なく飛ばす。違えば同じ id のものと比べる', () => {
    const a = study('s-1', ['7g7f'], { name: '研究1' });
    const copy = study('s-0', ['7g7f'], { name: '研究1（仲間）' });
    for (const existing of [
      [a, copy],
      [copy, a],
    ]) {
      const plan = planStudyImport([study('s-1', ['7g7f'], { name: '研究1' })], existing);
      expect(plan.same).toBe(1);
      expect(plan.conflicts).toEqual([]);
      const other = planStudyImport([study('s-1', ['7g7f'], { name: '研究1（また別）' })], existing);
      expect(other.conflicts.map((c) => c.existing.id)).toEqual(['s-1']);
    }
  });

  it('置き換える（今の id と作った日時はそのまま）・両方残す（新しい id）・取り込まない', () => {
    const existing = [study('b', ['2g2f'], { createdAt: 100 })];
    const plan = planStudyImport([study('x', ['2g2f'], { name: '新しい名前', createdAt: 5 }), study('c', ['6g6f'])], existing);
    const replace = resolveStudyImport(plan, 'replace');
    expect(replace.put.map((s) => [s.id, s.name, s.createdAt])).toEqual([
      ['c', '研究c', 1],
      ['b', '新しい名前', 100],
    ]);
    expect(replace.skipped).toBe(0);
    const both = resolveStudyImport(plan, 'both', () => 'new-id');
    expect(both.put.map((s) => s.id)).toEqual(['c', 'new-id']);
    const skip = resolveStudyImport(plan, 'skip');
    expect(skip.put.map((s) => s.id)).toEqual(['c']);
    expect(skip.skipped).toBe(1);
  });
});

describe('KIF', () => {
  it('1 本：平手の KIF。最後の手のコメントに「★名前」とメモ', () => {
    const kif = studiesToKif([study('a', ['7g7f', '3c3d', '2g2f'], { name: '早めの▲2六歩', note: '狙い\n2 行目' })]);
    expect(kif).toContain('手合割：平手');
    const record = importKIF(kif);
    if (record instanceof Error) throw record;
    expect(record.moves.slice(1).map((n) => ('usi' in n.move ? n.move.usi : ''))).toEqual(['7g7f', '3c3d', '2g2f']);
    expect(record.moves[3].comment.trim()).toBe('★早めの▲2六歩\n狙い\n2 行目');
  });

  it('複数：共通の部分をまとめた変化付きの 1 つの KIF（最初の研究手順が本譜）。それぞれの終わりに名前とメモ', () => {
    const a = study('a', ['7g7f', '3c3d', '2g2f', '8c8d'], { name: 'A' });
    const b = study('b', ['7g7f', '3c3d', '6g6f'], { name: 'B', note: 'Bのメモ' });
    const c = study('c', ['7g7f', '3c3d'], { name: 'C' });
    const kif = studiesToKif([a, b, c]);
    expect(kif).toContain('変化：3手');
    const record = importKIF(kif);
    if (record instanceof Error) throw record;
    // 本譜は A
    expect(record.moves.slice(1).map((n) => ('usi' in n.move ? n.move.usi : ''))).toEqual(a.moves);
    // 2 手目（△3四歩）には C の名前、本譜の終わりに A、3 手目の変化（▲6六歩）に B
    expect(record.moves[2].comment.trim()).toBe('★C');
    expect(record.moves[4].comment.trim()).toBe('★A');
    const third = record.moves[3];
    expect(third.branch && 'usi' in third.branch.move ? third.branch.move.usi : '').toBe('6g6f');
    expect(third.branch?.comment.trim()).toBe('★B\nBのメモ');
  });
});
