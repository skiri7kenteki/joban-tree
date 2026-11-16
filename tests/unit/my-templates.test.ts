// 自分で登録した戦型の書き出し・取り込み（段階5-2）
import { describe, expect, test } from 'vitest';
import {
  checkTemplateFields,
  closestTemplate,
  newTemplateId,
  parseTemplatesJson,
  planImport,
  resolveImport,
  templatesToJson,
  type OpeningTemplate,
} from '../../src/tree/templates';

const base: OpeningTemplate = {
  id: 'my-a',
  name: 'A',
  group: '横歩取り',
  mySide: 'black',
  moves: ['7g7f', '3c3d', '2g2f'],
  note: 'メモ',
  reviewed: true,
};
const b = { ...base, id: 'my-b', name: 'B' };
const bundled = { ...base, id: 'yokofu-kihon', name: '同梱' };

describe('書き出し・取り込み', () => {
  test('書き出したファイルはそのまま読める（日付などの保存用の項目は書き出さない）', () => {
    const stored = { ...base, createdAt: 1, updatedAt: 2 };
    const text = templatesToJson([stored, b]);
    const raw = JSON.parse(text);
    expect(raw).toMatchObject({ app: 'joban-tree', kind: 'opening-templates', version: 1 });
    expect(raw.templates[0]).not.toHaveProperty('createdAt');
    const r = parseTemplatesJson(text);
    expect(r).toEqual({ ok: true, templates: [base, b] });
  });

  test('JSON でない・指せない手を含むファイルは読まない', () => {
    expect(parseTemplatesJson('xx')).toMatchObject({ ok: false, message: expect.stringContaining('JSON') });
    const bad = templatesToJson([{ ...base, moves: ['7g7f', '7g7f'] }]);
    expect(parseTemplatesJson(bad)).toMatchObject({ ok: false, message: expect.stringContaining('「A」の 2 手目') });
    // ツリーの JSON を間違えて選んだ
    expect(parseTemplatesJson(JSON.stringify({ app: 'joban-tree', version: 3, nodes: {} }))).toMatchObject({ ok: false });
  });

  test('id が重ならないものは足す。同じものは数えるだけ。中身が違うものは重なりとして確認する', () => {
    const changed = { ...base, name: 'A（直した）' };
    const fresh = { ...base, id: 'my-c' };
    const plan = planImport([changed, b, fresh, { ...bundled, note: '別' }, bundled], [base, b], [bundled]);
    expect(plan.fresh).toEqual([fresh]);
    expect(plan.same).toBe(2);
    expect(plan.conflicts).toEqual([
      { incoming: changed, bundled: false },
      { incoming: { ...bundled, note: '別' }, bundled: true },
    ]);
  });

  test('重なったときの選び方：置き換える（同梱は置き換えない）・両方残す・取り込まない', () => {
    const plan = planImport([{ ...base, name: 'A2' }, { ...bundled, note: '別' }, { ...base, id: 'my-c' }], [base], [bundled]);
    let n = 0;
    const id = () => `new-${++n}`;
    const replace = resolveImport(plan, 'replace', id);
    expect(replace.put.map((t) => [t.id, t.name])).toEqual([
      ['my-c', 'A'],
      ['my-a', 'A2'],
    ]);
    expect(replace.skipped).toBe(1);
    const both = resolveImport(plan, 'both', id);
    expect(both.put.map((t) => t.id)).toEqual(['my-c', 'new-1', 'new-2']);
    expect(both.skipped).toBe(0);
    const skip = resolveImport(plan, 'skip', id);
    expect(skip.put.map((t) => t.id)).toEqual(['my-c']);
    expect(skip.skipped).toBe(2);
  });

  test('新しい id は形の決まり（英数字・-）に合い、毎回違う', () => {
    const a = newTemplateId();
    expect(a).toMatch(/^my-[\w-]{1,60}$/);
    expect(newTemplateId()).not.toBe(a);
  });
});

describe('登録', () => {
  test('名前・グループは必須、長さの上限', () => {
    expect(checkTemplateFields({ name: 'A', group: 'G', note: '' })).toBeNull();
    expect(checkTemplateFields({ name: ' ', group: 'G', note: '' })).toContain('名前');
    expect(checkTemplateFields({ name: 'A', group: '', note: '' })).toContain('グループ');
    expect(checkTemplateFields({ name: 'x'.repeat(101), group: 'G', note: '' })).toContain('100');
    expect(checkTemplateFields({ name: 'A', group: 'G', note: 'x'.repeat(1001) })).toContain('1000');
  });

  test('グループの初期値：手順がいちばん長く一致する戦型のグループ', () => {
    const short = { ...base, id: 's', group: 'G1', moves: ['7g7f'] };
    const long = { ...base, id: 'l', group: 'G2', moves: ['7g7f', '3c3d'] };
    expect(closestTemplate([short, long], ['7g7f', '3c3d', '2g2f'])?.group).toBe('G2');
    expect(closestTemplate([short, long], ['7g7f', '8c8d'])?.group).toBe('G1');
    expect(closestTemplate([short, long], ['2g2f'])).toBeNull();
  });
});
