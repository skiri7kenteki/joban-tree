// 段階10-1：定跡帳で直接指して研究を足す・消す（src/tree/bookEdit.ts）と、定跡帳の key（src/tree/organize.ts）
import { describe, expect, it } from 'vitest';
import {
  applyChange,
  autoName,
  branchPoint,
  coveredDepth,
  cutBranch,
  endHere,
  inverseChange,
  isDefaultName,
  playInBook,
  settleView,
  checkNewMoves,
  fixStudies,
  defaultNameMatch,
  studyFromMoves,
  templateIdFor,
  type BookCtx,
} from '../../src/tree/bookEdit';
import { candidateName, kifSide } from '../../src/tree/kifImport';
import { bookKeyOfGroup, bookLabel, bookPool, fitsBook, groupStudies, hirateBookKey, studyGroupKey } from '../../src/tree/organize';
import { defaultStudyName, moveTexts, nameFromTexts } from '../../src/tree/studies';
import { bookStart } from '../../src/tree/studyBook';
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
/** 横歩取り △3三角（16 手） */
const KAKU = tpl('yokofu-33kaku', '横歩取り', [...YOKOFU, '2b3c'], 'white', '横歩取り △3三角');
const NAKA = tpl('naka', '中飛車', ['5g5f'], 'black', '中飛車');
const TEMPLATES = [KAKU, NAKA];
const K = KAKU.moves;

const study = (id: string, moves: string[], opts: Partial<Study> = {}): Study => {
  const shape = { moves, templateId: KAKU.id, mySide: 'white' as const };
  return { id, name: defaultStudyName(shape, TEMPLATES), note: '', ...shape, createdAt: 1, updatedAt: 1, ...opts };
};

let seq = 0;
const ctx = (over: Partial<BookCtx> = {}): BookCtx => ({
  templates: TEMPLATES,
  side: 'white',
  start: K.length,
  now: 100,
  newId: () => `n${++seq}`,
  fits: () => true,
  ...over,
});

/** A：▲3六飛 △8四飛 ▲2六飛 △2二銀（本線） */
const A = study('A', [...K, '3d3f', '8f8d', '3f2f', '3a2b'], { createdAt: 1, updatedAt: 1 });
/** B：▲2六飛 の後 △4二玉（A から分かれた） */
const B = study('B', [...K, '3d3f', '8f8d', '3f2f', '5a4b'], { createdAt: 2, updatedAt: 2 });

describe('定跡帳で指す：延ばす・同じ手で進む・新しい枝', () => {
  it('終わりの局面で指すと、その研究手順を 1 手延ばす（名前が初期値なら付け直す）', () => {
    const r = playInBook([A], [A], A.moves, '5i5h', 'A', ctx());
    expect(r.kind).toBe('extend');
    if (r.kind !== 'extend') return;
    expect(r.study.id).toBe('A');
    expect(r.study.moves).toEqual([...A.moves, '5i5h']);
    expect(r.study.name).toBe('▲３六飛 … ▲５八玉');
    expect(r.study.updatedAt).toBe(100);
    expect(r.study.createdAt).toBe(1);
    expect(r.change).toEqual({ put: [r.study], remove: [] });
  });

  it('自分で付けた名前は、延ばしても変えない。メモ・作った日時もそのまま', () => {
    const named = { ...A, name: '本線', note: 'メモ' };
    const r = playInBook([named], [named], named.moves, '5i5h', 'A', ctx());
    expect(r.kind === 'extend' && [r.study.name, r.study.note]).toEqual(['本線', 'メモ']);
  });

  it('途中の局面で、すでにある次の手と同じ手 → 1 手進むだけ（今の研究手順が通ればそれ、無ければいちばん最近直したもの）', () => {
    const here = [...K, '3d3f', '8f8d', '3f2f'];
    expect(playInBook([A, B], [A, B], here.slice(0, -1), '3f2f', 'A', ctx())).toEqual({ kind: 'advance', target: A });
    // 今の研究手順（A）が通らない手：その手を通る B へ
    expect(playInBook([A, B], [A, B], here, '5a4b', 'A', ctx())).toEqual({ kind: 'advance', target: B });
    // どちらも通る手で、今の研究手順が無い（木の外から来た）ときは、いちばん最近直した B
    expect(playInBook([A, B], [A, B], K, '3d3f', null, ctx())).toEqual({ kind: 'advance', target: B });
  });

  it('途中の局面で新しい手 → 「その局面までの手順＋指した手」の新しい研究手順（名前は分かれ目がわかる形・側は定跡帳の側）', () => {
    const here = [...K, '3d3f'];
    const r = playInBook([A], [A], here, '5a4b', 'A', ctx({ now: 200 }));
    expect(r.kind).toBe('create');
    if (r.kind !== 'create') return;
    expect(r.study.moves).toEqual([...here, '5a4b']);
    expect(r.study.name).toBe('▲３六飛 △４二玉');
    expect(r.study.mySide).toBe('white');
    expect(r.study.note).toBe('');
    expect(r.study.templateId).toBe(KAKU.id);
    expect([r.study.createdAt, r.study.updatedAt]).toEqual([200, 200]);
  });

  it('枝を延ばして長くなったら、名前に分かれ目の手（手数付き）を入れる', () => {
    // B は A と 20 手目（△4二玉）で分かれた。延ばすと「最初の手 … 20手目 △４二玉 … 最後の手」
    expect(branchPoint(B, [A, B])).toBe(19);
    expect(branchPoint(A, [A, B])).toBeUndefined(); // 先に作った方には分かれ目を付けない
    const r = playInBook([A, B], [A, B], B.moves, '5i5h', 'B', ctx());
    expect(r.kind === 'extend' && r.study.name).toBe('▲３六飛 … 20手目 △４二玉 … ▲５八玉');
    // 分かれ目付きの名前も「初期値のまま」として、さらに延ばしたときに付け直す
    if (r.kind !== 'extend') return;
    expect(isDefaultName(r.study, TEMPLATES)).toBe(true);
    const r2 = playInBook([A, r.study], [A, r.study], r.study.moves, '5c5d', 'B', ctx());
    expect(r2.kind === 'extend' && r2.study.name).toBe('▲３六飛 … 20手目 △４二玉 … △５四歩');
  });

  it('研究の木の外（研究手順が 1 本も無い・戦型の出発点）で指すと、1 本目の研究手順ができる。0 手の研究手順は作らない', () => {
    const r = playInBook([], [], K, '3d3f', null, ctx());
    expect(r.kind === 'create' && r.study.moves).toEqual([...K, '3d3f']);
    // 出発点より前（出発点で終わる手順になる）は作らない
    expect(playInBook([], [], K.slice(0, -1), '2b3c', null, ctx()).kind).toBe('too-short');
    // 平手からの定跡帳（出発点 0）でも、初手から 1 手以上
    const r0 = playInBook([], [], [], '7g7f', null, ctx({ start: 0, side: 'black' }));
    expect(r0.kind === 'create' && [r0.study.moves, r0.study.mySide, r0.study.name]).toEqual([['7g7f'], 'black', '▲７六歩']);
  });

  it('ほかの研究手順とまったく同じ手順（別の側にある）なら足さない。グループから外れる手も足さない', () => {
    const other = study('X', [...K, '3d3f'], { mySide: 'black' });
    expect(playInBook([], [other], K, '3d3f', null, ctx())).toEqual({ kind: 'same', other });
    expect(playInBook([A], [A], A.moves, '5i5h', 'A', ctx({ fits: () => false })).kind).toBe('outside');
  });
});

describe('定跡帳で消す：この手から先を消す・ここで終わりにする', () => {
  const C = study('C', [...K, '3d3f', '5a4b'], { createdAt: 3, updatedAt: 3 });

  it('この手から先を消す：その手を通る研究手順をまとめて消す。手前の局面を通る研究手順が残っていれば、それだけ', () => {
    const here = [...K, '3d3f', '8f8d', '3f2f'];
    expect(cutBranch([A, B, C], here, '5a4b', 'A', ctx())).toEqual({ put: [], remove: [B], kept: null });
    expect(cutBranch([A, B, C], here, '9a9b', 'A', ctx())).toBeNull();
  });

  it('消すと手前の局面を通る研究手順が無くなるなら、今の研究手順をその局面で終わる形にして 1 本残す（名前は付け直す・メモはそのまま）', () => {
    const here = [...K, '3d3f'];
    const a = { ...A, note: '本線のメモ' };
    const plan = cutBranch([a, B], here, '8f8d', 'A', ctx());
    expect(plan?.remove).toEqual([B]);
    expect(plan?.kept?.id).toBe('A');
    expect(plan?.kept?.moves).toEqual(here);
    expect(plan?.kept?.name).toBe('▲３六飛');
    expect(plan?.kept?.note).toBe('本線のメモ');
    expect(plan?.put).toEqual([plan?.kept]);
    // 今の研究手順が消すものでなければ、いちばん最近直したもの（B）を残す
    expect(cutBranch([a, B], here, '8f8d', null, ctx())?.kept?.id).toBe('B');
    // 自分で付けた名前は残す
    expect(cutBranch([{ ...a, name: '本線' }, B], here, '8f8d', 'A', ctx())?.kept?.name).toBe('本線');
  });

  it('出発点で消すと、残すと 0 手（出発点で終わる）になるので何も残さない', () => {
    expect(cutBranch([A, B], K, '3d3f', 'A', ctx())).toEqual({ put: [], remove: [A, B], kept: null });
  });

  it('ここで終わりにする：この局面より先へ進む研究手順を消し、今の研究手順をここで終わる形にして残す。ここで終わる研究手順がすでにあればそれが残る', () => {
    const here = [...K, '3d3f'];
    const plan = endHere([A, B, C], here, 'B', ctx());
    expect(plan?.kept?.id).toBe('B');
    expect(plan?.kept?.moves).toEqual(here);
    expect(plan?.remove.map((s) => s.id)).toEqual(['A', 'C']);
    const D = study('D', here, { createdAt: 4 });
    expect(endHere([A, B, D], here, 'A', ctx())).toEqual({ put: [], remove: [A, B], kept: null });
    // 先へ進む研究手順が無い・出発点
    expect(endHere([A], A.moves, 'A', ctx())).toBeNull();
    expect(endHere([A], K, 'A', ctx())?.kept).toBeNull();
  });
});

describe('取り消し・盤の局面', () => {
  it('取り消し：延ばす・作る・消す（1 本残す）を、それぞれ元の一覧に戻せる', () => {
    const before = [A, B];
    const ext = playInBook(before, before, A.moves, '5i5h', 'A', ctx());
    const made = playInBook(before, before, [...K, '3d3f'], '5a4b', 'A', ctx());
    const cut = cutBranch(before, [...K, '3d3f'], '8f8d', 'A', ctx());
    for (const change of [ext.kind === 'extend' ? ext.change : null, made.kind === 'create' ? made.change : null, cut]) {
      expect(change).not.toBeNull();
      const after = applyChange(before, change!);
      expect(after).not.toEqual(before);
      const back = applyChange(after, inverseChange(change!, before));
      expect([...back].sort((x, y) => x.id.localeCompare(y.id))).toEqual(before);
    }
  });

  it('続けて取り消す：足した順と逆に戻すと、最初の一覧に戻る', () => {
    let list: Study[] = [A];
    const undo: ReturnType<typeof inverseChange>[] = [];
    let here = A.moves;
    for (const move of ['5i5h', '5a4b', '6g6f']) {
      const r = playInBook(list, list, here, move, 'A', ctx());
      if (r.kind !== 'extend') throw new Error(r.kind);
      undo.push(inverseChange(r.change, list));
      list = applyChange(list, r.change);
      here = r.study.moves;
    }
    expect(list[0].moves).toEqual([...A.moves, '5i5h', '5a4b', '6g6f']);
    while (undo.length > 0) list = applyChange(list, undo.pop()!);
    expect(list).toEqual([A]);
  });

  it('研究手順が変わった後の局面：今の研究手順が通ればそのまま、無ければ前へ戻って通る研究手順へ。1 本も無ければ木の外のまま', () => {
    expect(settleView([A, B], B.moves, 18, 'A')).toEqual({ id: 'A', line: A.moves, index: 18 });
    // A を消した：A の終わりにいた → B が通る 19 手目まで戻る
    expect(settleView([B], A.moves, A.moves.length, 'A')).toEqual({ id: 'B', line: B.moves, index: 19 });
    expect(settleView([], A.moves, 18, 'A')).toEqual({ id: null, line: A.moves, index: 18 });
    expect(coveredDepth([B], A.moves)).toBe(19);
    expect(coveredDepth([], A.moves)).toBe(0);
  });

  it('名前の初期値：分かれ目は先に作った研究手順から', () => {
    expect(autoName({ ...B, moves: [...B.moves, '5i5h'] }, [A, B], TEMPLATES)).toBe('▲３六飛 … 20手目 △４二玉 … ▲５八玉');
  });
});

describe('定跡帳の key（グループ・平手から）', () => {
  const s1 = study('s1', [...K, '3d3f'], { updatedAt: 5 });
  const s2 = study('s2', ['2g2f', '8c8d'], { updatedAt: 9 });
  const s3 = study('s3', ['7g7f'], { mySide: 'black', updatedAt: 7, templateId: undefined });

  it('「その他」は自分の側で分ける。そこから開く定跡帳は「平手から」（その側の研究手順すべて）', () => {
    const groups = groupStudies([s1, s2, s3], TEMPLATES);
    expect(groups.map((g) => [g.key, g.label])).toEqual([
      ['study:横歩取り|white', '横歩取り（後手番）'],
      ['study:other|white', 'その他（後手番）'],
      ['study:other|black', 'その他（先手番）'],
    ]);
    expect(bookKeyOfGroup('study:other|white')).toBe(hirateBookKey('white'));
    expect(bookKeyOfGroup('study:横歩取り|white')).toBe('study:横歩取り|white');
    expect(bookPool(hirateBookKey('white'), [s1, s2, s3], TEMPLATES).map((s) => s.id)).toEqual(['s2', 's1']);
    expect(bookPool('study:横歩取り|white', [s1, s2, s3], TEMPLATES).map((s) => s.id)).toEqual(['s1']);
    expect(bookLabel(hirateBookKey('black'))).toBe('平手から（先手番）');
    expect(bookLabel('study:横歩取り|white')).toBe('横歩取り（後手番）');
  });

  it('グループから外れる手順は、その定跡帳に入れない（平手からの定跡帳は側が同じなら何でも）', () => {
    expect(studyGroupKey(s1, TEMPLATES)).toBe('study:横歩取り|white');
    expect(fitsBook('study:横歩取り|white', s1, TEMPLATES)).toBe(true);
    expect(fitsBook('study:横歩取り|white', s2, TEMPLATES)).toBe(false);
    expect(fitsBook(hirateBookKey('white'), s1, TEMPLATES)).toBe(true);
    expect(fitsBook(hirateBookKey('black'), s1, TEMPLATES)).toBe(false);
  });
});

describe('変化付き KIF の取り込み：自分の側の初期値（段階10-1 の小さな直し）', () => {
  const read = { ok: true, mainMoves: ['7g7f'] } as unknown as Parameters<typeof kifSide>[0];
  it('終わりの手が全部後手なら後手、全部先手なら先手、混ざっていれば本譜から', () => {
    expect(kifSide(read, [], [['7g7f', '3c3d'], ['2g2f', '8c8d']])).toBe('white');
    expect(kifSide(read, [], [['7g7f'], ['2g2f', '8c8d', '2f2e']])).toBe('black');
    expect(kifSide(read, [], [['7g7f'], ['2g2f', '8c8d']])).toBe('black'); // 本譜 ▲7六歩 で終わる → 先手
  });
});

describe('1 本の手順を定跡帳に足す（棋譜を貼る・ツリーから。段階10-2）', () => {
  it('手が 0 本・戦型の出発点そのもので終わる手順は足さない。1 手でも先なら足せる', () => {
    expect(checkNewMoves([], TEMPLATES, 'white')).toBe('empty');
    expect(checkNewMoves(K, TEMPLATES, 'white')).toBe('start');
    expect(checkNewMoves(['5g5f'], TEMPLATES, 'black')).toBe('start'); // 中飛車の出発点
    expect(checkNewMoves([...K, '3d3f'], TEMPLATES, 'white')).toBeNull();
    expect(checkNewMoves(['7g7f'], TEMPLATES, 'white')).toBeNull(); // どの戦型にも当てはまらない 1 手
  });

  it('作る研究手順：名前は初期値（戦型の出発点の後の手順から）、メモは空、戦型はいちばん長く一致するもの、自分の側は選んだもの', () => {
    const s = studyFromMoves([...K, '3d3f', '8f8d'], 'white', TEMPLATES, 50, 'x');
    expect(s).toEqual({
      id: 'x',
      name: '▲３六飛 △８四飛',
      note: '',
      moves: [...K, '3d3f', '8f8d'],
      templateId: KAKU.id,
      mySide: 'white',
      createdAt: 50,
      updatedAt: 50,
    });
    // 先手番の研究には後手番向けの戦型を付けない（名前は側を問わず短い戦型の後から）
    const b = studyFromMoves([...K, '3d3f', '8f8d'], 'black', TEMPLATES, 50, 'z');
    expect('templateId' in b).toBe(false);
    expect(b.name).toBe('▲３六飛 △８四飛');
    expect('templateId' in studyFromMoves(['7g7f', '3c3d'], 'white', TEMPLATES, 1, 'y')).toBe(false);
  });

  it('戦型は手順から付け直す（延ばした・縮めたときも。外れたら付けない）', () => {
    expect(templateIdFor(['5g5f', '3c3d'], TEMPLATES, 'black')).toBe(NAKA.id);
    expect(templateIdFor(['5g5f', '3c3d'], TEMPLATES, 'white')).toBeUndefined();
    expect(templateIdFor(['7g7f'], TEMPLATES, 'black')).toBeUndefined();
    const plan = cutBranch([A], [...K, '3d3f'], '8f8d', 'A', ctx({ start: 0 }));
    expect(plan?.kept?.templateId).toBe(KAKU.id);
    // 平手からの定跡帳（出発点 0）でも、戦型の出発点で終わる研究手順は残さない
    expect(cutBranch([A], K, '3d3f', 'A', ctx({ start: 0 }))?.kept).toBeNull();
  });
});

describe('定跡帳の出発点がずれる不具合の直し（段階10 の直し。自分の側が同じ戦型）', () => {
  // 同梱の戦型と同じ形：基本図（15 手・先手番）、△3三角（16 手・後手番）、△3三角型（▲3六飛まで。17 手・先手番）
  const KIHON = tpl('yokofu-kihon', '横歩取り', YOKOFU, 'black', '横歩取り 基本図（▲3四飛まで）');
  const KAKU_G = tpl('yokofu-33kaku-gote', '横歩取り', [...YOKOFU, '2b3c'], 'white', '横歩取り △3三角（後手番）');
  const KAKU36 = tpl('yokofu-33kaku', '横歩取り', [...YOKOFU, '2b3c', '3d3f'], 'black', '横歩取り △3三角型（▲3六飛まで）');
  const T = [KIHON, KAKU_G, KAKU36];
  const c = (side: 'black' | 'white', start: number): BookCtx => ({ templates: T, side, start, now: 10, newId: () => `m${++seq}`, fits: () => true });

  it('後手番：△3三角 から ▲3六飛 を指しても、戦型は後手番の △3三角 のまま。名前は「▲３六飛」。出発点は 16 手目のまま', () => {
    const r = playInBook([], [], KAKU_G.moves, '3d3f', null, c('white', 16));
    if (r.kind !== 'create') throw new Error(r.kind);
    expect(r.study.templateId).toBe(KAKU_G.id);
    expect(r.study.name).toBe('▲３六飛');
    expect(bookStart([r.study], T, 'white')).toBe(16);
    // 延ばしても出発点は 16 手目、名前は 16 手目の後から
    const r2 = playInBook([r.study], [r.study], r.study.moves, '8f8d', r.study.id, c('white', 16));
    if (r2.kind !== 'extend') throw new Error(r2.kind);
    expect(r2.study.name).toBe('▲３六飛 △８四飛');
    expect(bookStart([r2.study], T, 'white')).toBe(16);
    // 16 手目に戻って ▲5八玉（青野流）を足せる → 「この局面からの研究」に 2 本
    const r3 = playInBook([r2.study], [r2.study], KAKU_G.moves, '5i5h', r2.study.id, c('white', 16));
    expect(r3.kind).toBe('create');
  });

  it('先手番：基本図から △3三角 ▲3六飛 と指しても、出発点は 15 手目のまま。16 手目に △8八角成 を足せる', () => {
    const r = playInBook([], [], KIHON.moves, '2b3c', null, c('black', 15));
    if (r.kind !== 'create') throw new Error(r.kind);
    expect(r.study.templateId).toBe(KIHON.id);
    expect(r.study.name).toBe('△３三角');
    const r2 = playInBook([r.study], [r.study], r.study.moves, '3d3f', r.study.id, c('black', 15));
    if (r2.kind !== 'extend') throw new Error(r2.kind);
    expect(r2.study.templateId).toBe(KAKU36.id); // 先手番の戦型なので付け直す
    expect(r2.study.name).toBe('△３三角 ▲３六飛');
    expect(bookStart([r2.study], T, 'black')).toBe(15);
    expect(playInBook([r2.study], [r2.study], KIHON.moves, '2b8h+', r2.study.id, c('black', 15)).kind).toBe('create');
  });

  it('ずれた研究手順を直す：側の違う戦型を付け直し、初期値のままの名前を付け直す（分かれ目は残す）。自分で付けた名前・直した日時は変えない', () => {
    const moves = [...KAKU36.moves, '8f8d', '3f2f', '3a2b', '5i5h', '5a4b'];
    // 前の決まりで付いた名前：△3三角型（▲3六飛まで）の後から（分かれ目 19 手目）。戦型も先手番のもの
    const legacy = nameFromTexts(moveTexts(moves), KAKU36, 18);
    const a: Study = { id: 'a', name: legacy, note: 'メモ', moves, templateId: KAKU36.id, mySide: 'white', createdAt: 1, updatedAt: 5 };
    // 戦型の名前だけになった研究手順
    const b: Study = { id: 'b', name: KAKU36.name, note: '', moves: KAKU36.moves, templateId: KAKU36.id, mySide: 'white', createdAt: 1, updatedAt: 6 };
    // 自分で付けた名前
    const u: Study = { ...b, id: 'u', name: '本線' };
    // もう正しいもの
    const ok: Study = { id: 'ok', name: '▲３六飛', note: '', moves: KAKU36.moves, templateId: KAKU_G.id, mySide: 'white', createdAt: 1, updatedAt: 7 };
    expect(defaultNameMatch(a, T)).toEqual({ branchAt: 18 });
    const fixed = fixStudies([a, b, u, ok], T);
    expect(fixed.map((s) => [s.id, s.name, s.templateId, s.updatedAt, s.note])).toEqual([
      ['a', '▲３六飛 … 19手目 ▲２六飛 … △４二玉', KAKU_G.id, 5, 'メモ'],
      ['b', '▲３六飛', KAKU_G.id, 6, ''],
      ['u', '本線', KAKU_G.id, 6, ''],
    ]);
    // 何度直しても同じ（直したものをもう一度直しても変わらない）
    expect(fixStudies(fixed, T)).toEqual([]);
  });

  it('変化付き KIF の取り込み：名前の初期値は選んだ自分の側で付ける（★名前から読み戻したものは変えない）', () => {
    const moves = [...KAKU36.moves, '8f8d'];
    const cand = { moves, texts: moveTexts(moves), branchAt: undefined, named: false, name: '' };
    expect(candidateName(cand, 'white', T)).toBe('▲３六飛 △８四飛');
    expect(candidateName(cand, 'black', T)).toBe('△３三角 ▲３六飛 △８四飛');
    expect(candidateName({ ...cand, named: true, name: '本線' }, 'black', T)).toBe('本線');
  });
});
