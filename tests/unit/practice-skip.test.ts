// 段階26-2：同じ出だしの早送り（どこから自分で指すか・今日正しく指した所・前回まちがえた手・今日の稽古の順）
import { describe, expect, it } from 'vitest';
import { todayOrder } from '../../src/practice/groups';
import { nextRecord, practicePlies, practiceStart, startOfDay } from '../../src/practice/practice';
import { answerKey, parseToday, parseWrong, skipStart, wrongPliesOf } from '../../src/practice/skip';
import { normalizeSettings } from '../../src/app/settings';
import { defaultStudyName } from '../../src/tree/studies';
import { BUNDLED_TEMPLATES } from '../../src/tree/templates';
import type { Study } from '../../src/tree/types';

const T = BUNDLED_TEMPLATES;
const NOW = new Date(2026, 10, 27, 10, 0, 0).getTime();
const BASE = '7g7f 3c3d 2g2f 8c8d 2f2e 8d8e 6i7h 4a3b 2e2d 2c2d 2h2d 8e8f 8g8f 8b8f 2d3d 2b3c'.split(' ');
const COMMON = [...BASE, '5i5h', '5a6b', '3g3f', '7a7b', '2i3g', '6c6d'];

const study = (id: string, moves: string[], updatedAt = 1, mySide: Study['mySide'] = 'white'): Study => {
  const s: Study = { id, name: '', note: '', moves, mySide, createdAt: updatedAt, updatedAt };
  return { ...s, name: defaultStudyName(s, T) };
};
// 自分（後手）の手は 17・19・21・23 番目（0 始まり）。A と B は 22 番目（相手の手）で分かれる
const A = study('a', [...COMMON, '3i4h', '7b6c'], 30);
const B = study('b', [...COMMON, '3i3h', '7b6c'], 20);

/** study の自分の手のうち plies を、今日 1 回目に正しく指したことにする */
const done = (s: Study, plies: number[]) => new Set(plies.map((p) => answerKey(s, p)));
const from = (s: Study, correct: Set<string>, wrong: readonly number[] | null = []) => skipStart(s, practicePlies(s, T), practiceStart(s, T), correct, wrong);

describe('どこから自分で指すか', () => {
  it('前提：稽古は 16 番目から。自分の手は 17・19・21・23 番目', () => {
    expect([practiceStart(B, T), practicePlies(B, T)]).toEqual([16, [17, 19, 21, 23]]);
  });

  it('その日の最初の 1 本は、出発点から', () => {
    expect(from(A, new Set())).toBe(16);
  });

  it('分かれ目（まだ正しく指していない最初の自分の手）の 1 つ前の自分の手から。相手の手で分かれても同じ', () => {
    // A を全部正解した後の B：22 番目の相手の手が違うので、まだの自分の手は 23。その 1 つ前の 21 から
    expect(from(B, done(A, [17, 19, 21, 23]))).toBe(21);
  });

  it('1 回目にまちがえた所は早送りしない', () => {
    // A で 19 をまちがえた（正しく指した中に無い）→ 19 の 1 つ前の 17 から
    expect(from(B, done(A, [17, 21, 23]))).toBe(17);
    // 最初の自分の手がまだなら、出発点から
    expect(from(B, done(A, [19, 21, 23]))).toBe(16);
  });

  it('全部が今日指した所に含まれる手順も、最後の自分の手 1 つは指す', () => {
    const short = study('s', COMMON.slice(0, 20));
    expect(from(short, done(A, [17, 19, 21, 23]))).toBe(19);
  });

  it('前回まちがえた手が早送りの中にあれば、その手より前から', () => {
    const all = done(A, [17, 19, 21, 23]);
    expect(from(B, all, [19])).toBe(17);
    expect(from(B, all, [17])).toBe(16);
    // 分かれ目より後のまちがいは関係ない
    expect(from(B, all, [23])).toBe(21);
  });

  it('前回まちがえた手が分からなければ、早送りしない', () => {
    expect(from(B, done(A, [17, 19, 21, 23]), null)).toBe(16);
  });

  it('同じ出だしは初手からの手順が同じこと。手順前後と、自分の側が違うものは別', () => {
    const swapped = study('w', [...BASE, '3g3f', '5a6b', '5i5h', '7a7b', '2i3g', '6c6d']);
    expect(from(swapped, done(A, [17, 19, 21, 23]))).toBe(16);
    expect(answerKey({ ...A, mySide: 'black' }, 17)).not.toBe(answerKey(A, 17));
  });
});

describe('前回まちがえた手の覚え（この端末だけ）', () => {
  const rec = nextRecord(undefined, 'a', 1, NOW);

  it('稽古の記録がまちがい 0 か、記録が無ければ、まちがえた手は無い', () => {
    expect(wrongPliesOf(undefined, {})).toEqual([]);
    expect(wrongPliesOf(nextRecord(undefined, 'a', 0, NOW), {})).toEqual([]);
  });

  it('覚えが記録と同じ稽古のものなら、その手。無いか古ければ分からない（null）', () => {
    expect(wrongPliesOf(rec, { a: { lastAt: rec.lastAt, plies: [19] } })).toEqual([19]);
    expect(wrongPliesOf(rec, {})).toBeNull();
    expect(wrongPliesOf(rec, { a: { lastAt: rec.lastAt - 1, plies: [19] } })).toBeNull();
    // 数が合わない覚えも使わない
    expect(wrongPliesOf(rec, { a: { lastAt: rec.lastAt, plies: [] } })).toBeNull();
  });

  it('壊れた保存は空として読む。日が変われば今日の分は捨てる', () => {
    expect(parseWrong(null)).toEqual({});
    expect(parseWrong({ a: { lastAt: 'x', plies: [1] }, b: { lastAt: 1, plies: [2] } })).toEqual({ b: { lastAt: 1, plies: [2] } });
    const today = { day: startOfDay(NOW), keys: ['k'] };
    expect([...parseToday(today, NOW)]).toEqual(['k']);
    expect([...parseToday(today, NOW + 24 * 60 * 60 * 1000)]).toEqual([]);
    expect([...parseToday({ day: 'x' }, NOW)]).toEqual([]);
  });
});

describe('今日の稽古の順', () => {
  it('定跡帳ごとにまとめ、中は手順の近い順。定跡帳の順は理由の優先で最初に出る順', () => {
    const C = study('c', [...BASE, '5i5h', '5a6b', '3g3f', 'P*8b', '3i3h', '7a7b'], 10);
    const O = study('o', ['7g7f', '3c3d', '6g6f', '8c8d', '2h6h'], 5, 'black');
    // 理由の順：C（横歩取り）→ O（その他）→ B・A（横歩取り）
    const items = [C, O, B, A].map((s) => ({ study: s }));
    expect(todayOrder(items, [A, B, C, O], new Map(), T).map((i) => i.study.id)).toEqual(['a', 'b', 'c', 'o']);
  });
});

describe('設定', () => {
  it('「同じ出だしを早送り」の初期値は「する」。前の版の設定にも無いので「する」', () => {
    expect(normalizeSettings(null).skipSameStart).toBe(true);
    expect(normalizeSettings({ reviewBatch: 5 }).skipSameStart).toBe(true);
    expect(normalizeSettings({ skipSameStart: false }).skipSameStart).toBe(false);
  });
});
