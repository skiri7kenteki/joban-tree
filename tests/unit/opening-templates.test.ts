// 同梱の戦型テンプレート（src/data/templates/*.json）をまとめて確かめるテスト（段階5-1）。
// ほかの戦型の JSON が増えても、このフォルダに置けばここで確かめる。下書き（reviewed: false）も入れられるよう、
// 件数と、確認済みかどうかは確かめない（以前あった横歩取りだけのテスト validate-yokofu.test.ts は、
// 件数 6・すべて確認済みを前提にしていたので、持ち主の依頼で削除した。2026-11-16）。
import { describe, expect, test } from 'vitest';
import { STARTPOS_SFEN, applyUsiMove, sideToMove } from '../../src/shogi/position';
import {
  BUNDLED_TEMPLATES,
  checkTemplateFile,
  groupTemplates,
  templateLine,
  templateRelation,
  type OpeningTemplate,
} from '../../src/tree/templates';

const files = import.meta.glob<unknown>('../../src/data/templates/*.json', { eager: true, import: 'default' });

describe('同梱の戦型テンプレート（全ファイル）', () => {
  test('ファイルがある', () => {
    expect(Object.keys(files).length).toBeGreaterThan(0);
  });

  const all: { file: string; t: OpeningTemplate }[] = [];
  for (const [file, data] of Object.entries(files)) {
    const d = data as { app: string; kind: string; version: number; templates: OpeningTemplate[] };
    test(`${file}：形式`, () => {
      expect(d.app).toBe('joban-tree');
      expect(d.kind).toBe('opening-templates');
      expect(d.version).toBe(1);
      expect(Array.isArray(d.templates)).toBe(true);
      // アプリが読むときと同じ確かめ方でも通る
      const r = checkTemplateFile(d);
      expect(r.ok, r.ok ? '' : r.message).toBe(true);
    });
    for (const t of d.templates) all.push({ file, t });
  }

  test('id がファイルをまたいでも重複していない', () => {
    const ids = all.map(({ t }) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  for (const { file, t } of all) {
    test(`${t.name}（${file}）：手順がすべて合法で、自分の側が「出発点で手番でない側」`, () => {
      let sfen = STARTPOS_SFEN;
      for (const move of t.moves) {
        const r = applyUsiMove(sfen, move);
        expect(r, `${t.id} の ${move} が合法でない`).not.toBeNull();
        sfen = r!.sfen;
      }
      expect(t.mySide).toBe(sideToMove(sfen) === 'black' ? 'white' : 'black');
      expect(typeof t.reviewed).toBe('boolean');
      expect(t.group.length).toBeGreaterThan(0);
    });
  }

  test('アプリに全部読み込まれている', () => {
    expect(BUNDLED_TEMPLATES.length).toBe(all.length);
  });

  test('横歩取り △3三角（後手番）（段階6-1）：持ち主の指定どおりの 16 手で、後手が自分・先手番で始まる', () => {
    const t = BUNDLED_TEMPLATES.find((x) => x.id === 'yokofu-33kaku-gote')!;
    expect(t).toBeDefined();
    expect(t.name).toBe('横歩取り △3三角（後手番）');
    expect(t.group).toBe('横歩取り');
    expect(t.mySide).toBe('white');
    expect(t.reviewed).toBe(true);
    expect(t.moves.join(' ')).toBe('7g7f 3c3d 2g2f 8c8d 2f2e 8d8e 6i7h 4a3b 2e2d 2c2d 2h2d 8e8f 8g8f 8b8f 2d3d 2b3c');
    const r = templateLine(t.moves);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // 画面の表記は全角の数字と「同　歩」。持ち主の書いた表記（半角・空白なし）にそろえて比べる
    const plain = (s: string) => s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/　/g, '');
    expect(r.line.slice(1).map((p) => plain(p.text!)).join(' ')).toBe(
      '▲7六歩 △3四歩 ▲2六歩 △8四歩 ▲2五歩 △8五歩 ▲7八金 △3二金 ▲2四歩 △同歩 ▲同飛 △8六歩 ▲同歩 △同飛 ▲3四飛 △3三角',
    );
    expect(sideToMove(r.line[r.line.length - 1].sfen)).toBe('black');
  });
});

describe('戦型テンプレートの扱い', () => {
  const t: OpeningTemplate = {
    id: 'x',
    name: 'テスト',
    group: 'G',
    mySide: 'white',
    moves: ['7g7f', '3c3d', '2g2f'],
    note: '',
    reviewed: false,
  };

  test('手順を並べると、日本語の手と SFEN が付く', () => {
    const r = templateLine(t.moves);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.line).toHaveLength(4);
    expect(r.line[0].sfen).toBe(STARTPOS_SFEN);
    expect(r.line[1].text).toContain('７六歩');
    expect(r.line[3].usi).toBe('2g2f');
    expect(sideToMove(r.line[3].sfen)).toBe('white');
  });

  test('指せない手があれば、その位置を返す', () => {
    expect(templateLine(['7g7f', '7g7f'])).toEqual({ ok: false, index: 1 });
  });

  test('今の手順と戦型の関係', () => {
    expect(templateRelation(t, ['7g7f'])).toBe('before');
    expect(templateRelation(t, ['7g7f', '3c3d', '2g2f'])).toBe('at');
    expect(templateRelation(t, ['7g7f', '3c3d', '2g2f', '8c8d'])).toBe('after');
    expect(templateRelation(t, ['7g7f', '8c8d'])).toBe('off');
    expect(templateRelation(t, ['2g2f', '3c3d', '7g7f'])).toBe('off');
  });

  test('グループごとに、最初に出てきた順でまとめる', () => {
    const list = [
      { ...t, id: 'a', group: '横歩取り' },
      { ...t, id: 'b', group: '角換わり' },
      { ...t, id: 'c', group: '横歩取り' },
    ];
    expect(groupTemplates(list).map((g) => [g.group, g.templates.map((x) => x.id)])).toEqual([
      ['横歩取り', ['a', 'c']],
      ['角換わり', ['b']],
    ]);
  });

  test('ファイルの確かめ：おかしいものは理由を付けて断る', () => {
    const file = (templates: unknown[]) => ({ app: 'joban-tree', kind: 'opening-templates', version: 1, templates });
    expect(checkTemplateFile(file([t])).ok).toBe(true);
    expect(checkTemplateFile({ app: 'joban-tree', templates: [] })).toMatchObject({ ok: false });
    expect(checkTemplateFile({ ...file([]), version: 2 })).toMatchObject({ ok: false, message: expect.stringContaining('新しい形式') });
    const bad = checkTemplateFile(file([{ ...t, moves: ['7g7f', '7g7f'] }]));
    expect(bad).toMatchObject({ ok: false, message: expect.stringContaining('2 手目（7g7f）') });
    expect(checkTemplateFile(file([t, t]))).toMatchObject({ ok: false, message: expect.stringContaining('同じ id') });
    expect(checkTemplateFile(file([{ ...t, id: 'a b' }]))).toMatchObject({ ok: false });
    expect(checkTemplateFile(file([{ ...t, mySide: 'up' }]))).toMatchObject({ ok: false });
    expect(checkTemplateFile(file([{ ...t, reviewed: 'yes' }]))).toMatchObject({ ok: false });
  });
});
