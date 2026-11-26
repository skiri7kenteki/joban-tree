// 段階25-1：横歩取り以外の戦型を、取り込みと定跡帳から作る
import { describe, expect, it } from 'vitest';
import { playInBook, reshaped } from '../../src/tree/bookEdit';
import { autoTemplate, destinations, lacksOwnAfter, movedStudies, passesAll, startName, startRange } from '../../src/tree/importTemplate';
import { buildCandidates, candidatesToStudies, readKif } from '../../src/tree/kifImport';
import { studyGroupKey } from '../../src/tree/organize';
import type { OpeningTemplate } from '../../src/tree/templates';
import type { Study } from '../../src/tree/types';

const words = (s: string) => s.split(' ');

/** 角換わりの形。1〜12 手目まで同じで、13 手目と 15 手目で分かれる */
const COMMON = words('7g7f 8c8d 2g2f 8d8e 8h7g 3c3d 7i8h 4a3b 6i7h 2b7g+ 8h7g 3a4b');
const A = [...COMMON, ...words('3i4h 7a7b 4g4f 6c6d 4h4g')];
const B = [...COMMON, ...words('3i4h 7a7b 3g3f 6c6d 4h3g')];
const C = [...COMMON, ...words('3i3h 7a7b 3h2g')];
/** 初手から違う */
const OTHER = words('2g2f 8c8d 2f2e');

const tpl = (id: string, moves: string[], mySide: 'black' | 'white' = 'black', group = '角換わり'): OpeningTemplate => ({
  id,
  name: id,
  group,
  mySide,
  moves,
  note: '',
  reviewed: true,
});

const study = (id: string, moves: string[], mySide: 'black' | 'white' = 'black', templateId?: string): Study => ({
  id,
  name: id,
  note: '',
  moves,
  mySide,
  ...(templateId ? { templateId } : {}),
  createdAt: 1,
  updatedAt: 1,
});

describe('出発点の範囲', () => {
  it('分かれる手順は、全部が通る最後の局面が初期値', () => {
    expect(startRange([A, B, C], 'black')).toEqual({ initial: 12, max: 12, limit: 12 });
  });

  it('1 本だけなら、出発点より後に自分の手が 1 手残る所まで戻す', () => {
    // A は 17 手。先手の最後の手は 17 手目なので、16 手目の局面まで
    expect(startRange([A], 'black')).toEqual({ initial: 16, max: 17, limit: 16 });
    // 後手の最後の手は 16 手目なので、15 手目の局面まで
    expect(startRange([A], 'white')).toEqual({ initial: 15, max: 17, limit: 15 });
  });

  it('途中で終わる手順があれば、その手順にも自分の手が残る所まで戻す', () => {
    expect(startRange([A, COMMON.slice(0, 9)], 'black')).toEqual({ initial: 8, max: 9, limit: 8 });
  });

  it('初手が違えば作れない。手順が無くても作れない', () => {
    expect(startRange([A, OTHER], 'black')).toBeNull();
    expect(startRange([], 'black')).toBeNull();
  });

  it('初期局面は出発点にしない（自分の手が残らなくても 1 手目から）', () => {
    expect(startRange([['7g7f']], 'black')).toEqual({ initial: 1, max: 1, limit: 1 });
  });
});

describe('出発点より後に自分の手が無い手順', () => {
  it('1 本でもあれば分かる（自分の側を切り替えると変わる）', () => {
    expect(lacksOwnAfter([A], 'black', 16)).toBe(false);
    expect(lacksOwnAfter([A], 'white', 16)).toBe(true);
    expect(lacksOwnAfter([A, COMMON.slice(0, 9)], 'black', 12)).toBe(true);
  });
});

describe('戦型の名前の初期値', () => {
  it('「n手目 X まで」', () => {
    expect(startName(COMMON)).toMatch(/^12手目 △.+銀まで$/);
  });
});

describe('戦型を選ぶ', () => {
  it('全部が通る戦型だけ選べる', () => {
    expect(passesAll(tpl('t', COMMON), [A, B, C])).toBe(true);
    expect(passesAll(tpl('t', A.slice(0, 13)), [A, B, C])).toBe(false);
  });

  it('自動は、全部が通る・自分の側が同じ・いちばん長いもの', () => {
    const list = [tpl('short', COMMON.slice(0, 2)), tpl('long', COMMON), tpl('white', COMMON.slice(0, 11), 'white'), tpl('a-only', A.slice(0, 15))];
    expect(autoTemplate([A, B, C], 'black', list)?.id).toBe('long');
    expect(autoTemplate([A, B, C], 'white', list)?.id).toBe('white');
    expect(autoTemplate([A, OTHER], 'black', list)).toBeNull();
  });

  it('行き先のグループを本数と一緒に出す（分かれるときは複数）', () => {
    const list = [tpl('k', COMMON)];
    expect(destinations([study('a', A), study('b', B), study('o', OTHER)], list)).toEqual([
      { key: 'study:角換わり|black', label: '角換わり（先手番）', count: 2 },
      { key: 'study:other|black', label: 'その他（先手番）', count: 1 },
    ]);
  });

  it('戦型を足すと、「その他」の研究手順がそのグループへ移る。戦型を記録した研究手順は移らない', () => {
    const old = tpl('old', COMMON.slice(0, 2), 'black', '前の形');
    const list = [study('free', A), study('kept', B, 'black', 'old'), study('o', OTHER)];
    expect(movedStudies(list, [], tpl('k', COMMON)).map((s) => s.id)).toEqual(['free', 'kept']);
    expect(movedStudies(list, [old], tpl('k', COMMON)).map((s) => s.id)).toEqual(['free']);
  });
});

describe('取り込む研究手順の戦型', () => {
  const KIF = [
    '手合割：平手',
    '手数----指手---------消費時間--',
    ...['７六歩(77)', '８四歩(83)', '２六歩(27)', '８五歩(84)', '７七角(88)', '３四歩(33)'].map((m, i) => `${i + 1} ${m}`),
    '',
  ].join('\n');
  const MOVES = COMMON.slice(0, 6);

  async function made(templates: OpeningTemplate[], chosen?: OpeningTemplate, side: 'black' | 'white' = 'black') {
    const r = readKif(KIF);
    if (!r.ok) throw new Error(r.message);
    const list = await buildCandidates(r, templates, []);
    return candidatesToStudies(list, side, chosen ? [...templates, chosen] : templates, 1000, () => 'id', chosen);
  }

  it('作った戦型が templateId とグループに入り、名前は出発点の後から', async () => {
    const chosen = tpl('new', MOVES.slice(0, 4));
    const [s] = await made([], chosen);
    expect(s.templateId).toBe('new');
    expect(studyGroupKey(s, [chosen])).toBe('study:角換わり|black');
    expect(s.name).toBe('▲７七角 △３四歩');
  });

  it('選んだ戦型が、いちばん長いものでなくても、選んだ戦型になる', async () => {
    const short = tpl('short', MOVES.slice(0, 2), 'black', '短い方');
    const long = tpl('long', MOVES.slice(0, 4), 'black', '長い方');
    const [s] = await made([long], short);
    expect(s.templateId).toBe('short');
    expect(studyGroupKey(s, [long, short])).toBe('study:短い方|black');
  });

  it('側の違う戦型を選んだら、templateId には残さない（開き直すと外れるため）', async () => {
    const other = tpl('w', MOVES.slice(0, 4), 'white');
    const [s] = await made([], other);
    expect(s.templateId).toBeUndefined();
    expect(studyGroupKey(s, [other])).toBe('study:角換わり|black');
  });

  it('選んだ戦型を通らない研究手順は、自動のまま', async () => {
    const [s] = await made([], tpl('x', OTHER));
    expect(s.templateId).toBeUndefined();
  });
});

describe('手を延ばしても、選んだ戦型のグループから出ない', () => {
  const short = tpl('short', COMMON.slice(0, 2), 'black', '短い方');
  const long = tpl('long', COMMON.slice(0, 4), 'black', '長い方');

  it('ほかのグループの長い戦型を通っても、記録した戦型のまま', () => {
    const s = study('a', COMMON.slice(0, 6), 'black', 'short');
    expect(reshaped(s, COMMON.slice(0, 7), [s], { templates: [short, long], now: 2 }).templateId).toBe('short');
  });

  it('同じグループの長い戦型には、今まで通り付け直す', () => {
    const s = study('a', COMMON.slice(0, 3), 'black', 'short');
    const same = tpl('same', COMMON.slice(0, 4), 'black', '短い方');
    expect(reshaped(s, COMMON.slice(0, 5), [s], { templates: [short, same], now: 2 }).templateId).toBe('same');
  });

  it('途中で別の手を指して作る研究手順も、分かれ元の戦型のグループに入る', () => {
    const source = study('a', A.slice(0, 7), 'black', 'short');
    const branch = [...A.slice(0, 6), '9g9f'];
    const r = playInBook([source], [source], branch.slice(0, -1), '9g9f', 'a', {
      templates: [short, long],
      side: 'black',
      start: 2,
      now: 2,
      newId: () => 'n',
      fits: (s) => studyGroupKey(s, [short, long]) === 'study:短い方|black',
    });
    expect(r.kind).toBe('create');
    if (r.kind === 'create') expect(r.study.templateId).toBe('short');
  });

  it('自動で付いていた戦型（いちばん長いもの）を記録していれば、今まで通り', () => {
    const s = study('a', COMMON.slice(0, 5), 'black', 'long');
    expect(reshaped(s, COMMON.slice(0, 3), [s], { templates: [short, long], now: 2 }).templateId).toBe('short');
  });
});
