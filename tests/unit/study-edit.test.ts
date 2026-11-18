// 段階9-1：研究手順の手順を編集する（手を足す・置き換える・分かれる手で別の研究手順・ここで終わりにする・1 手戻す・同じ手順の判定・戦型と名前の付け直し）
import { describe, expect, it } from 'vitest';
import { defaultStudyName } from '../../src/tree/studies';
import {
  branchMoves,
  branchStudy,
  checkEdited,
  draftChanged,
  editedStudy,
  moveDraftTo,
  movesAfter,
  playOnDraft,
  replaceFrom,
  startDraft,
  templateIdFor,
  truncateHere,
  undoDraft,
  type Draft,
} from '../../src/tree/studyEdit';
import type { OpeningTemplate } from '../../src/tree/templates';
import type { Study } from '../../src/tree/types';

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
const KIHON = tpl('yokofu-kihon', '横歩取り', YOKOFU, 'white', '横歩取り 基本図');
const KAKU = tpl('yokofu-33kaku', '横歩取り', [...YOKOFU, '2b3c'], 'white', '横歩取り △3三角');
const NAKA = tpl('naka', '中飛車', ['5g5f'], 'black', '中飛車');
const TEMPLATES = [KIHON, KAKU, NAKA];

const study = (id: string, moves: string[], extra: Partial<Study> = {}): Study => ({
  id,
  name: id,
  note: '',
  moves,
  mySide: 'white',
  createdAt: 1,
  updatedAt: 1,
  ...extra,
});

/** 盤で指したことにする（append・advance のときの下書き） */
function play(draft: Draft, move: string): Draft {
  const r = playOnDraft(draft, move);
  if (r.kind === 'fork') throw new Error(`fork at ${draft.index}`);
  return r.draft;
}

describe('編集の操作', () => {
  it('終わりの局面で指すと手順の最後に足す（続けて何手でも）', () => {
    let d = startDraft(['7g7f', '3c3d'], 2);
    d = play(d, '2g2f');
    d = play(d, '8c8d');
    expect(d.moves).toEqual(['7g7f', '3c3d', '2g2f', '8c8d']);
    expect(d.index).toBe(4);
    expect(playOnDraft(startDraft(['7g7f'], 1), '3c3d').kind).toBe('append');
  });

  it('途中の局面で次の手と同じ手を指すと 1 手進むだけ（手順は変えない・取り消しの対象にしない）', () => {
    const d = startDraft(['7g7f', '3c3d', '2g2f'], 1);
    const r = playOnDraft(d, '3c3d');
    expect(r.kind).toBe('advance');
    if (r.kind === 'fork') return;
    expect(r.draft.moves).toEqual(d.moves);
    expect(r.draft.index).toBe(2);
    expect(r.draft.undo).toEqual([]);
  });

  it('途中の局面で違う手を指すと選んでもらう → 置き換えると後ろの手を消して指した手から続ける', () => {
    const d = startDraft(['7g7f', '3c3d', '2g2f', '8c8d'], 2);
    const r = playOnDraft(d, '6g6f');
    expect(r).toEqual({ kind: 'fork', next: '2g2f' });
    expect(movesAfter(d)).toBe(2);
    const replaced = replaceFrom(d, '6g6f');
    expect(replaced.moves).toEqual(['7g7f', '3c3d', '6g6f']);
    expect(replaced.index).toBe(3);
    // 続けて足せる
    expect(play(replaced, '8c8d').moves).toEqual(['7g7f', '3c3d', '6g6f', '8c8d']);
  });

  it('ここで終わりにする：今の局面より後ろの手を消す。初期局面・終わりの局面では何もしない', () => {
    const d = startDraft(['7g7f', '3c3d', '2g2f', '8c8d'], 2);
    const cut = truncateHere(d);
    expect(cut.moves).toEqual(['7g7f', '3c3d']);
    expect(cut.index).toBe(2);
    expect(truncateHere(moveDraftTo(d, 0))).toEqual(moveDraftTo(d, 0));
    expect(truncateHere(moveDraftTo(d, 4))).toEqual(moveDraftTo(d, 4));
  });

  it('1 手戻す：最後の操作（足す・置き換える・終わりにする）を 1 つずつ取り消し、局面もその前に戻す', () => {
    let d = startDraft(['7g7f', '3c3d', '2g2f'], 3);
    d = play(d, '8c8d'); // 足す
    d = moveDraftTo(d, 1);
    d = replaceFrom(d, '8c8d'); // 置き換える
    d = truncateHere(moveDraftTo(d, 1)); // 終わりにする
    expect(d.moves).toEqual(['7g7f']);
    d = undoDraft(d);
    expect(d.moves).toEqual(['7g7f', '8c8d']);
    d = undoDraft(d);
    expect(d.moves).toEqual(['7g7f', '3c3d', '2g2f', '8c8d']);
    expect(d.index).toBe(1);
    d = undoDraft(d);
    expect(d.moves).toEqual(['7g7f', '3c3d', '2g2f']);
    expect(d.index).toBe(3);
    expect(undoDraft(d)).toEqual(d);
  });

  it('保存していない変更があるか', () => {
    const saved = ['7g7f', '3c3d'];
    const d = startDraft(saved, 2);
    expect(draftChanged(d, saved)).toBe(false);
    expect(draftChanged(play(d, '2g2f'), saved)).toBe(true);
    expect(draftChanged(undoDraft(play(d, '2g2f')), saved)).toBe(false);
  });
});

describe('保存するとき', () => {
  it('手が 0 本は保存できない・ほかの研究手順とまったく同じ手順なら知らせる（自分自身は数えない）', () => {
    const a = study('a', ['7g7f', '3c3d']);
    const b = study('b', ['7g7f', '3c3d', '2g2f']);
    expect(checkEdited([], [a, b], 'a')).toEqual({ kind: 'empty' });
    expect(checkEdited(['7g7f', '3c3d', '2g2f'], [a, b], 'a')).toEqual({ kind: 'same', other: b });
    expect(checkEdited(['7g7f', '3c3d'], [a, b], 'a')).toBeNull();
    expect(checkEdited(['7g7f', '3c3d', '2g2f', '8c8d'], [a, b], 'a')).toBeNull();
    // 新しく作るとき（selfId なし）は全部と比べる
    expect(checkEdited(['7g7f', '3c3d'], [a, b], null)).toEqual({ kind: 'same', other: a });
  });

  it('戦型は手順から付け直す（いちばん長く一致する戦型。外れたら付けない）', () => {
    const s = study('a', [...YOKOFU, '2b3c', '5i5h'], { templateId: KAKU.id });
    const shorter = editedStudy(s, [...YOKOFU, '5a5b'], TEMPLATES, 10);
    expect(shorter.templateId).toBe(KIHON.id);
    const off = editedStudy(s, ['2g2f', '8c8d'], TEMPLATES, 10);
    expect(off.templateId).toBeUndefined();
    expect('templateId' in off).toBe(false);
    expect(templateIdFor(['5g5f', '3c3d'], TEMPLATES)).toBe(NAKA.id);
    expect(editedStudy(s, ['5g5f', '3c3d'], TEMPLATES, 10).templateId).toBe(NAKA.id);
  });

  it('名前は初期値のままなら付け直し、自分で付けた名前は変えない。メモ・自分の側・作った日時はそのまま、直した日時は新しく', () => {
    const moves = [...YOKOFU, '2b3c', '5i5h'];
    const auto = study('a', moves, { templateId: KAKU.id, note: 'メモ', mySide: 'black', createdAt: 5 });
    auto.name = defaultStudyName(auto, TEMPLATES);
    expect(auto.name).toBe('▲５八玉');
    const longer = editedStudy(auto, [...moves, '5a5b'], TEMPLATES, 99);
    expect(longer.name).toBe('▲５八玉 △５二玉');
    expect(longer).toMatchObject({ note: 'メモ', mySide: 'black', createdAt: 5, updatedAt: 99, id: 'a' });
    const mine = editedStudy({ ...auto, name: '青野流の本命' }, [...moves, '5a5b'], TEMPLATES, 99);
    expect(mine.name).toBe('青野流の本命');
    // 手順が変わらなければそのまま（日時も変えない）
    expect(editedStudy(auto, moves, TEMPLATES, 99)).toBe(auto);
  });
});

describe('分かれる手として、別の研究手順にする', () => {
  it('今の局面までの手順＋指した手。名前は分かれ目の手がわかる形、メモは空、自分の側と戦型は元から', () => {
    const original = study('a', [...YOKOFU, '2b3c', '5i5h', '5a5b'], { templateId: KAKU.id, note: '元のメモ', mySide: 'white' });
    const d = startDraft(original.moves, YOKOFU.length + 1);
    expect(playOnDraft(d, '3i3h').kind).toBe('fork');
    const moves = branchMoves(d, '3i3h');
    expect(moves).toEqual([...YOKOFU, '2b3c', '3i3h']);
    const made = branchStudy(original, moves, TEMPLATES, 50, 's-new');
    expect(made).toMatchObject({ id: 's-new', note: '', mySide: 'white', templateId: KAKU.id, createdAt: 50, updatedAt: 50, moves });
    expect(made.name).toBe('▲３八銀');
    // 分かれた後に手を足して保存：名前に分かれ目（手数付き）が入る
    const branchAt = moves.length - 1;
    const later = editedStudy(made, [...moves, '5a5b', '5i5h', '7a6b', '7i6h', '6c6d'], TEMPLATES, 60, branchAt);
    expect(later.name).toBe('▲３八銀 … △６四歩');
  });

  it('分かれ目が戦型の出発点より後ろの途中にあるときは、名前の間に手数付きで入れる', () => {
    const original = study('a', [...YOKOFU, '2b3c', '5i5h', '5a5b', '3i3h', '7a6b'], { templateId: KAKU.id });
    const d = startDraft(original.moves, YOKOFU.length + 3);
    const moves = branchMoves(d, '7i6h');
    const made = branchStudy(original, moves, TEMPLATES, 50, 's-new');
    const branchAt = moves.length - 1;
    const later = editedStudy(made, [...moves, '7a6b', '3i3h', '6c6d'], TEMPLATES, 60, branchAt);
    expect(later.name).toBe(`▲５八玉 … ${branchAt + 1}手目 ▲６八銀 … △６四歩`);
  });

  it('元の戦型が分かれた手順に当てはまらなければ、手順から付け直す', () => {
    const original = study('a', [...YOKOFU, '2b3c', '5i5h'], { templateId: KAKU.id });
    const made = branchStudy(original, ['7g7f', '8c8d'], TEMPLATES, 1, 's-x');
    expect(made.templateId).toBeUndefined();
    expect(made.name).toBe('▲７六歩 △８四歩');
  });
});
