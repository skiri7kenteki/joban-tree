// 段階8-1：ツリーから独立した研究手順（名前の初期値・同じ手順の判定・戦型の振り分け・前の版のツリーからの移し替え）
import { describe, expect, it } from 'vitest';
import { STARTPOS_SFEN, applyUsiMove } from '../../src/shogi/position';
import { groupStudies } from '../../src/tree/organize';
import {
  NOTE_JOIN,
  checkStudyFields,
  defaultStudyName,
  findSameStudy,
  firstLine,
  guessSide,
  liftTreeStudies,
  mergeSameMoves,
  migrateTrees,
  moveTexts,
  sameMoves,
  studyMovesText,
  studyTemplate,
} from '../../src/tree/studies';
import type { OpeningTemplate } from '../../src/tree/templates';
import type { Study, TreeData, TreeStudy } from '../../src/tree/types';
import { lineTree } from './tree-fixture';

const YOKOFU = '7g7f 3c3d 2g2f 8c8d 2f2e 8d8e 6i7h 4a3b 2e2d 2c2d 2h2d 8e8f 8g8f 8b8f 2d3d'.split(' ');
const tpl = (id: string, group: string, moves: string[], mySide: 'black' | 'white' = 'white', name = id): OpeningTemplate => ({
  id,
  name,
  group,
  mySide,
  moves,
  note: '',
  reviewed: true,
});
// 基本図（▲3四飛まで）は同梱の戦型と同じく先手番向け（段階10 の直し：名前・出発点は自分の側が同じ戦型を先に見る）
const KIHON = tpl('yokofu-kihon', '横歩取り', YOKOFU, 'black', '横歩取り 基本図');
const KAKU = tpl('yokofu-33kaku', '横歩取り', [...YOKOFU, '2b3c'], 'white', '横歩取り △3三角');
const AONO = tpl('yokofu-aono', '横歩取り', [...YOKOFU, '2b3c', '5i5h'], 'white', '横歩取り 青野流');
const NAKA = tpl('naka', '中飛車', ['5g5f'], 'black', '中飛車');
const TEMPLATES = [KIHON, KAKU, AONO, NAKA];

/** △3三角の後：▲3六飛 △8四飛 ▲2六飛 △2二銀 ▲5八玉 △4二玉 */
const AFTER_KAKU = ['3d3f', '8f8d', '3f2f', '3a2b', '5i5h', '5a4b'];

const study = (id: string, moves: string[], opts: Partial<Study> = {}): Study => ({
  id,
  name: id,
  note: '',
  moves,
  mySide: 'white',
  createdAt: 1,
  updatedAt: 1,
  ...opts,
});

describe('名前の初期値（研究の分かれ目がわかるように）', () => {
  it('戦型の出発点より後が 4 手までなら全部', () => {
    const moves = [...KAKU.moves, ...AFTER_KAKU.slice(0, 4)];
    expect(studyTemplate({ moves, mySide: 'white' }, [KAKU])?.moves.length).toBe(16);
    expect(defaultStudyName({ moves, mySide: 'white' }, TEMPLATES)).toBe('▲３六飛 △８四飛 ▲２六飛 △２二銀');
  });

  it('5 手以上なら最初の手と最後の手（最初の手は必ず入れる）', () => {
    const moves = [...KAKU.moves, ...AFTER_KAKU];
    expect(defaultStudyName({ moves, mySide: 'white' }, TEMPLATES)).toBe('▲３六飛 … △４二玉');
  });

  it('分かれ目（変化付き KIF で本譜から分かれた手）があれば、手数付きで間に入れる。最初・最後と同じなら入れない', () => {
    const moves = [...KAKU.moves, ...AFTER_KAKU];
    expect(defaultStudyName({ moves, mySide: 'white' }, TEMPLATES, 18)).toBe('▲３六飛 … 19手目 ▲２六飛 … △４二玉');
    expect(defaultStudyName({ moves, mySide: 'white' }, TEMPLATES, 16)).toBe('▲３六飛 … △４二玉');
    expect(defaultStudyName({ moves, mySide: 'white' }, TEMPLATES, 21)).toBe('▲３六飛 … △４二玉');
  });

  it('出発点は自分の側が同じ、いちばん浅い戦型（手順より短いもの）。戦型の名前だけの名前にしない。戦型に当てはまらなければ初期局面から', () => {
    // 先手番：基本図（15 手）の後から。△3三角型（16 手）や青野流（17 手）が一致しても、いちばん浅い基本図
    expect(defaultStudyName({ moves: [...KAKU.moves, '3d3f'], mySide: 'black' }, TEMPLATES)).toBe('△３三角 ▲３六飛');
    // 後手番：△3三角（16 手）の後から（先手番の基本図は使わない）
    expect(defaultStudyName({ moves: [...KAKU.moves, '3d3f'], mySide: 'white' }, TEMPLATES)).toBe('▲３六飛');
    // △3三角 ちょうどで終わる後手番の手順：自分の側の短い戦型が無いので、側を問わず短い基本図の後から（戦型の名前だけにはしない）
    expect(defaultStudyName({ moves: KAKU.moves, mySide: 'white' }, TEMPLATES)).toBe('△３三角');
    expect(defaultStudyName({ moves: ['2g2f', '3c3d'], mySide: 'white' }, TEMPLATES)).toBe('▲２六歩 △３四歩');
    expect(defaultStudyName({ moves: ['2g2f', '3c3d', '7g7f', '4c4d', '3i3h'], mySide: 'white' }, TEMPLATES)).toBe('▲２六歩 … ▲３八銀');
  });

  it('手順の文：戦型が分かれば「戦型名 → その後」', () => {
    expect(studyMovesText({ moves: [...KAKU.moves, '3d3f'], mySide: 'white' }, TEMPLATES)).toBe('横歩取り △3三角 → ▲３六飛');
    expect(studyMovesText({ moves: [...KAKU.moves, '3d3f'], mySide: 'black' }, TEMPLATES)).toBe('横歩取り 基本図 → △３三角 ▲３六飛');
    expect(studyMovesText({ moves: ['2g2f'], mySide: 'white' }, TEMPLATES)).toBe('▲２六歩');
    expect(moveTexts(['7g7f', '3c3d', '8h2b+', '3a2b'])).toEqual(['▲７六歩', '△３四歩', '▲２二角成', '△同　銀']);
  });
});

describe('戦型（7-1 と同じ決まり）', () => {
  it('記録した戦型が今もあり、手順がその戦型で始まればそれ。無ければいちばん長く一致する戦型', () => {
    const moves = [...AONO.moves, '3d3f'];
    expect(studyTemplate({ moves }, TEMPLATES)?.id).toBe('yokofu-aono');
    expect(studyTemplate({ moves, templateId: 'yokofu-kihon' }, TEMPLATES)?.id).toBe('yokofu-kihon');
    // 消した戦型・手順が合わない戦型は使わずに推定
    expect(studyTemplate({ moves, templateId: 'deleted' }, TEMPLATES)?.id).toBe('yokofu-aono');
    expect(studyTemplate({ moves, templateId: 'naka' }, TEMPLATES)?.id).toBe('yokofu-aono');
    expect(studyTemplate({ moves: ['2g2f'] }, TEMPLATES)).toBeNull();
  });

  it('一覧のグループ：戦型のグループ × 自分の側。グループの中は直した日の新しい順。その他はいちばん下', () => {
    const list = [
      study('a', [...KAKU.moves, '3d3f'], { updatedAt: 10, note: '狙いは△8四飛' }),
      study('b', [...AONO.moves, '3d3f'], { updatedAt: 30 }),
      study('c', [...KAKU.moves, '3d3f', '8f8d'], { updatedAt: 20, mySide: 'black' }),
      study('d', ['2g2f', '8c8d'], { updatedAt: 5 }),
      study('e', ['5g5f', '3c3d'], { updatedAt: 1, mySide: 'black' }),
    ];
    const groups = groupStudies(list, TEMPLATES);
    expect(groups.map((g) => [g.key, g.label, g.items.map((s) => s.id)])).toEqual([
      ['study:横歩取り|white', '横歩取り（後手番）', ['b', 'a']],
      ['study:横歩取り|black', '横歩取り（先手番）', ['c']],
      ['study:中飛車|black', '中飛車（先手番）', ['e']],
      ['study:other|white', 'その他（後手番）', ['d']],
    ]);
  });
});

describe('同じ手順の判定・名前とメモ', () => {
  it('平手からの手順がまったく同じものだけ「同じ」（名前・自分の側は見ない）', () => {
    const list = [study('a', ['7g7f', '3c3d']), study('b', ['7g7f', '3c3d', '2g2f'], { mySide: 'black' })];
    expect(findSameStudy(list, ['7g7f', '3c3d'])?.id).toBe('a');
    expect(findSameStudy(list, ['7g7f', '3c3d', '2g2f'])?.id).toBe('b');
    expect(findSameStudy(list, ['7g7f'])).toBeNull();
    expect(findSameStudy(list, ['2g2f', '3c3d', '7g7f'])).toBeNull();
    expect(sameMoves(['a'], ['a'])).toBe(true);
    expect(sameMoves(['a'], ['a', 'b'])).toBe(false);
  });

  it('名前は必須・100 文字まで、メモは 3000 文字まで。メモの最初の 1 行', () => {
    expect(checkStudyFields({ name: ' ', note: '' })).toContain('名前');
    expect(checkStudyFields({ name: 'x'.repeat(101), note: '' })).toContain('100');
    expect(checkStudyFields({ name: 'a', note: 'x'.repeat(3001) })).toContain('3000');
    expect(checkStudyFields({ name: 'a', note: 'b' })).toBeNull();
    expect(firstLine('\n  狙い  \n2 行目')).toBe('狙い');
  });

  it('自分の側の初期値：戦型が分かればその側、無ければ最後の手を指した側', () => {
    expect(guessSide([...KAKU.moves, '3d3f'], TEMPLATES)).toBe('white');
    expect(guessSide(['2g2f'], TEMPLATES)).toBe('black');
    expect(guessSide(['2g2f', '8c8d'], TEMPLATES)).toBe('white');
  });
});

// ---- 移し替え ----

/** 形式 6 のツリー（研究手順入り）。prefix：開始局面までの手順 */
function v6Tree(id: string, prefix: string[], studies: TreeStudy[], opts: Partial<TreeData> = {}): TreeData {
  return { ...lineTree(prefix, [], 'white', id), version: 6, studies, ...opts };
}
const ts = (id: string, moves: string[], note = '', updatedAt = 1, createdAt = 1): TreeStudy => ({ id, name: id, note, moves, createdAt, updatedAt });

describe('移し替え（ツリーの中の研究手順 → 独立した研究手順）', () => {
  it('手順は「ツリーの prefix＋ツリーの中の手順」。id・名前・メモ・日時はそのまま、自分の側はツリーの側、戦型はツリーの戦型', () => {
    const tree = v6Tree('t', ['7g7f', '3c3d'], [ts('s-1', ['2g2f', '8c8d'], 'メモ', 5, 2)], { templateId: 'tpl-x', mySide: 'black' });
    const m = migrateTrees([tree]);
    expect(m.studies).toEqual([
      { id: 's-1', name: 's-1', note: 'メモ', moves: ['7g7f', '3c3d', '2g2f', '8c8d'], mySide: 'black', templateId: 'tpl-x', createdAt: 2, updatedAt: 5 },
    ]);
    // ツリーからは外し、形式 7 にする。元のデータは変えない
    expect(m.changed).toHaveLength(1);
    expect(m.changed[0].studies).toBeUndefined();
    expect(m.changed[0].version).toBe(7);
    expect(tree.studies).toHaveLength(1);
    expect(m.leftover).toBe(0);
  });

  it('1 回だけ：移し替えた後のツリーをもう一度移し替えても、何も増えない', () => {
    const m = migrateTrees([v6Tree('t', [], [ts('s-1', ['7g7f'])])]);
    const again = migrateTrees(m.changed);
    expect(again.studies).toEqual([]);
    expect(again.changed).toEqual([]);
  });

  it('二重にならない：同じ手順が複数のツリーにあれば 1 本。名前は新しい方、メモは違えば両方つなぐ、作った日時は古い方', () => {
    const v1 = v6Tree('v1', [], [ts('old', ['7g7f', '3c3d'], '古いメモ', 10, 3), ts('only', ['2g2f'], '', 1, 1)]);
    const v2 = v6Tree('v2', ['7g7f'], [ts('new', ['3c3d'], '新しいメモ', 20, 5)]);
    const v3 = v6Tree('v3', ['7g7f'], [ts('dup', ['3c3d'], '新しいメモ', 15, 4)]);
    const m = migrateTrees([v1, v2, v3]);
    expect(m.studies).toHaveLength(2);
    const merged = m.studies.find((s) => sameMoves(s.moves, ['7g7f', '3c3d']))!;
    expect(merged.id).toBe('new');
    expect(merged.name).toBe('new');
    expect(merged.note).toBe(`新しいメモ${NOTE_JOIN}古いメモ`);
    expect(merged.createdAt).toBe(3);
    expect(m.changed.map((t) => t.id)).toEqual(['v1', 'v2', 'v3']);
  });

  it('平手から始まらないツリーの研究手順は、消さずにツリーの中に残す（数を知らせる）', () => {
    const tree = v6Tree('t', [], [ts('s-1', ['7g7f'])]);
    const sfenTree = { ...tree, prefix: { initialSfen: applyUsiMove(STARTPOS_SFEN, '2g2f')!.sfen, moves: [] } };
    expect(liftTreeStudies(sfenTree)).toBeNull();
    const m = migrateTrees([sfenTree]);
    expect(m).toEqual({ studies: [], changed: [], leftover: 1 });
  });

  it('メモが同じなら 1 つだけ。片方だけメモがあれば、そのメモ', () => {
    const merged = mergeSameMoves([
      study('a', ['7g7f'], { note: '', updatedAt: 3 }),
      study('b', ['7g7f'], { note: 'メモ', updatedAt: 2 }),
      study('c', ['7g7f'], { note: 'メモ', updatedAt: 1 }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe('a');
    expect(merged[0].note).toBe('メモ');
  });
});
