// 段階7-1：一覧のまとめ方（どの戦型か・グループ分けと並び順。研究手順のグループも同じ決まり）
import { describe, expect, it } from 'vitest';
import { STARTPOS_SFEN } from '../../src/shogi/position';
import {
  OTHER_GROUP,
  groupTrees,
  templateOf,
  type OrganizeItem,
} from '../../src/tree/organize';
import type { OpeningTemplate } from '../../src/tree/templates';

const YOKOFU = '7g7f 3c3d 2g2f 8c8d 2f2e 8d8e 6i7h 4a3b 2e2d 2c2d 2h2d 8e8f 8g8f 8b8f 2d3d';
const tpl = (id: string, group: string, moves: string, mySide: 'black' | 'white' = 'black'): OpeningTemplate => ({
  id,
  name: id,
  group,
  mySide,
  moves: moves.split(' '),
  note: '',
  reviewed: true,
});
const KIHON = tpl('yokofu-kihon', '横歩取り', YOKOFU);
const KAKU = tpl('yokofu-33kaku', '横歩取り', `${YOKOFU} 2b3c`);
const KAKU_TO = tpl('yokofu-33kaku-to', '横歩取り', `${YOKOFU} 2b3c 5i5h`);
const KAKUGAWARI = tpl('kakugawari', '角換わり', '7g7f 8c8d 2g2f 3c3d 8h2b+');
const MINE = tpl('my-1', '自分の研究', '2g2f 8c8d 7g7f');
const TEMPLATES = [KIHON, KAKU, KAKU_TO, KAKUGAWARI, MINE];

let n = 0;
function item(moves: string, opts: Partial<OrganizeItem> = {}): OrganizeItem {
  n++;
  return {
    id: `t${n}`,
    name: `ツリー${n}`,
    updatedAt: n,
    mySide: 'white',
    prefix: { initialSfen: STARTPOS_SFEN, moves: moves === '' ? [] : moves.split(' ') },
    ...opts,
  };
}

describe('どの戦型のツリーか（templateOf）', () => {
  it('開始局面までの手順が戦型の手順で始まっていれば、その戦型（ちょうど出発点・その先）', () => {
    expect(templateOf(item(YOKOFU), TEMPLATES)?.id).toBe('yokofu-kihon');
    expect(templateOf(item(`${YOKOFU} 3a3b`), TEMPLATES)?.id).toBe('yokofu-kihon');
  });

  it('複数当てはまるときは、手順がいちばん長い戦型', () => {
    expect(templateOf(item(`${YOKOFU} 2b3c`), TEMPLATES)?.id).toBe('yokofu-33kaku');
    expect(templateOf(item(`${YOKOFU} 2b3c 5i5h 5a5b`), TEMPLATES)?.id).toBe('yokofu-33kaku-to');
  });

  it('当てはまらない（戦型の途中まで・外れた・SFEN の途中の局面から）なら null（その他）', () => {
    expect(templateOf(item('7g7f 3c3d 2g2f'), TEMPLATES)).toBeNull();
    expect(templateOf(item('5g5f 3c3d'), TEMPLATES)).toBeNull();
    expect(templateOf(item(''), TEMPLATES)).toBeNull();
    const fromSfen = item(YOKOFU, { prefix: { initialSfen: '9/9/9/9/9/9/9/9/9 b - 1', moves: YOKOFU.split(' ') } });
    expect(templateOf(fromSfen, TEMPLATES)).toBeNull();
  });

  it('自分で登録した戦型にも振り分ける', () => {
    expect(templateOf(item('2g2f 8c8d 7g7f 3c3d'), TEMPLATES)?.id).toBe('my-1');
  });

  it('記録した templateId があれば、手順よりそちらを使う。その戦型が消されていたら手順から推定する', () => {
    expect(templateOf(item(`${YOKOFU} 2b3c`, { templateId: 'yokofu-kihon' }), TEMPLATES)?.id).toBe('yokofu-kihon');
    expect(templateOf(item(`${YOKOFU} 2b3c`, { templateId: 'my-deleted' }), TEMPLATES)?.id).toBe('yokofu-33kaku');
    expect(templateOf(item('5g5f', { templateId: 'my-deleted' }), TEMPLATES)).toBeNull();
  });
});

describe('グループ分けと並び順（groupTrees）', () => {
  it('戦型のグループ × 自分の側でまとめ、グループの順は戦型の一覧の順（同じグループは後手番 → 先手番）、その他はいちばん下', () => {
    const items = [
      item('5g5f', { name: 'その他1' }),
      item('7g7f 8c8d 2g2f 3c3d 8h2b+', { name: '角換わり後手', mySide: 'white' }),
      item(YOKOFU, { name: '横歩先手', mySide: 'black' }),
      item(`${YOKOFU} 2b3c`, { name: '横歩後手', mySide: 'white' }),
      item('2g2f 8c8d 7g7f', { name: '自分の', mySide: 'black' }),
    ];
    const groups = groupTrees(items, TEMPLATES);
    expect(groups.map((g) => g.label)).toEqual(['横歩取り（後手番）', '横歩取り（先手番）', '角換わり（後手番）', '自分の研究（先手番）', 'その他']);
    expect(groups.map((g) => g.key)).toEqual(['横歩取り|white', '横歩取り|black', '角換わり|white', '自分の研究|black', OTHER_GROUP]);
    expect(groups.map((g) => g.items.map((t) => t.name))).toEqual([['横歩後手'], ['横歩先手'], ['角換わり後手'], ['自分の'], ['その他1']]);
  });

  it('グループの中は更新日の新しい順。中身の無いグループは出さない', () => {
    const items = [
      item(YOKOFU, { name: '古い', updatedAt: 100 }),
      item(`${YOKOFU} 2b3c 5i5h`, { name: '新しい', updatedAt: 300 }),
      item(YOKOFU, { name: '中くらい', updatedAt: 200 }),
    ];
    const groups = groupTrees(items, TEMPLATES);
    expect(groups).toHaveLength(1);
    expect(groups[0].items.map((t) => t.name)).toEqual(['新しい', '中くらい', '古い']);
    expect(groupTrees([], TEMPLATES)).toEqual([]);
  });
});
