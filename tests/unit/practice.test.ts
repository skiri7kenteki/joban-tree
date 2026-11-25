// 段階19：稽古の計算（間隔反復・始める手・今日の稽古の並び・集計）
import { describe, expect, it } from 'vitest';
import {
  LEARNED_STEP,
  NEW_PER_DAY,
  dueText,
  nextRecord,
  practicePlan,
  practicePlies,
  practiceProblem,
  practiceStart,
  startOfDay,
  summarizePractice,
  type PracticeRecord,
} from '../../src/practice/practice';
import { matchGames, missedStudies } from '../../src/games/compare';
import type { Game } from '../../src/games/game';
import { BUNDLED_TEMPLATES } from '../../src/tree/templates';
import type { Study } from '../../src/tree/types';

const T = BUNDLED_TEMPLATES;
const G1 = '7g7f 3c3d 2g2f 8c8d 2f2e 8d8e 6i7h 4a3b 2e2d 2c2d 2h2d 8e8f 8g8f 8b8f 2d3d 2b3c 5i5h 5a6b 3g3f P*8b 2i3g 8f8h+ 7i8h'.split(' ');
const NOW = new Date(2026, 10, 24, 10, 0, 0).getTime();
const DAY = 24 * 60 * 60 * 1000;

const study = (id: string, moves: string[], updatedAt = 1, mySide: Study['mySide'] = 'white'): Study => ({
  id,
  name: id,
  note: '',
  moves,
  mySide,
  createdAt: updatedAt,
  updatedAt,
});
const rec = (studyId: string, patch: Partial<PracticeRecord>): PracticeRecord => ({
  studyId,
  step: 0,
  dueAt: startOfDay(NOW),
  lastAt: NOW - DAY,
  firstAt: NOW - 10 * DAY,
  lastMistakes: 0,
  count: 1,
  ...patch,
});

describe('間隔反復', () => {
  it('全部正解なら 明日 → 3日 → 1週 → 2週 → 1か月 → 2か月 → 2か月…。まちがえたら翌日から', () => {
    const days: number[] = [];
    let r: PracticeRecord | undefined;
    let t = NOW;
    for (let i = 0; i < 8; i++) {
      r = nextRecord(r, 's', 0, t);
      days.push(Math.round((r.dueAt - startOfDay(t)) / DAY));
      t = r.dueAt + 9 * 60 * 60 * 1000;
    }
    expect(days).toEqual([1, 3, 7, 14, 30, 60, 60, 60]);
    const wrong = nextRecord(r, 's', 2, t);
    expect([wrong.step, Math.round((wrong.dueAt - startOfDay(t)) / DAY), wrong.lastMistakes, wrong.count]).toEqual([0, 1, 2, 9]);
    expect(wrong.firstAt).toBe(NOW);
  });

  it('次の稽古の日の言葉', () => {
    expect(dueText(undefined, NOW)).toBe('はじめて');
    expect(dueText(rec('s', { dueAt: startOfDay(NOW) - DAY }), NOW)).toBe('今日');
    expect(dueText(rec('s', { dueAt: startOfDay(NOW) + DAY }), NOW)).toBe('明日');
    expect(dueText(rec('s', { dueAt: startOfDay(NOW) + 3 * DAY }), NOW)).toBe('あと 3日');
  });
});

describe('始める手と答える手', () => {
  it('戦型の出発点（後手番の横歩取りは 16 手目 △3三角）の後から。自分の手番だけ答える', () => {
    const s = study('s', [...G1.slice(0, 20), '3i3h', '7a7b']);
    expect(practiceStart(s, T)).toBe(16);
    expect(practicePlies(s, T)).toEqual([17, 19, 21]);
  });
  it('出発点の後に自分の手番が無ければ初期局面から。戦型に当てはまらなければ初手から', () => {
    expect(practiceStart(study('s', G1.slice(0, 17)), T)).toBe(0);
    expect(practiceStart(study('s', ['7g7f', '3c3d', '6g6f', '8c8d']), T)).toBe(0);
    expect(practicePlies(study('s', ['7g7f', '3c3d', '6g6f', '8c8d']), T)).toEqual([1, 3]);
  });
});

describe('今日の稽古の並び', () => {
  const base = G1.slice(0, 16);
  const a = study('a', [...base, '5i5h', '5a6b'], 5);
  const b = study('b', [...base, '5i5h', '5a5b'], 4);
  const c = study('c', [...base, '3d3f', '8f8d'], 3);
  const d = study('d', [...base, '9g9f', '9c9d'], 2);
  // 後手番で ▲7六歩 だけ：自分（後手）の手が無い
  const noOwn = study('x', ['7g7f'], 9);

  it('①実戦で違う手 → ②前回まちがい → ③日が来た（遅れている順）→ ④はじめて。日の来ていないものは「これから」', () => {
    const records = new Map([
      ['a', rec('a', { dueAt: startOfDay(NOW) + 5 * DAY, lastAt: NOW - 3 * DAY })],
      ['b', rec('b', { dueAt: startOfDay(NOW), lastMistakes: 1 })],
      ['c', rec('c', { dueAt: startOfDay(NOW) - 2 * DAY })],
    ]);
    const missed = new Map([['a', NOW - DAY]]);
    const plan = practicePlan([a, b, c, d, noOwn], records, missed, T, NOW);
    expect(plan.today.map((i) => [i.study.id, i.reason])).toEqual([
      ['a', 'game'],
      ['b', 'wrong'],
      ['c', 'due'],
      ['d', 'new'],
    ]);
    expect(plan.later).toEqual([]);
    // 実戦が最後の稽古より前なら、ふつうの順（日が来ていなければ「これから」）
    const old = practicePlan([a], records, new Map([['a', NOW - 4 * DAY]]), T, NOW);
    expect([old.today.length, old.later.map((l) => l.study.id)]).toEqual([0, ['a']]);
  });

  it('前回まちがいの中では、見えにくい手をまちがえた研究手順が先（段階21-3）', () => {
    const records = new Map([
      ['a', rec('a', { dueAt: startOfDay(NOW) - 2 * DAY, lastMistakes: 1 })],
      ['b', rec('b', { dueAt: startOfDay(NOW), lastMistakes: 1, hardMistake: true })],
      ['c', rec('c', { dueAt: startOfDay(NOW) - 5 * DAY })],
    ]);
    const plan = practicePlan([a, b, c], records, new Map(), T, NOW);
    expect(plan.today.map((i) => i.study.id)).toEqual(['b', 'a', 'c']);
  });

  it('見えにくい手のまちがいは記録に残し、次に正解すれば消える', () => {
    const wrong = nextRecord(undefined, 's', 1, NOW, true);
    expect(wrong.hardMistake).toBe(true);
    expect('hardMistake' in nextRecord(wrong, 's', 0, NOW + DAY)).toBe(false);
    expect(practiceProblem(wrong)).toBeNull();
    expect(practiceProblem({ ...wrong, hardMistake: 'yes' })).toBe('見えにくい手');
  });

  it('はじめての研究手順は 1 日 5 本まで（今日はじめて稽古した分を引く）', () => {
    const many = Array.from({ length: 8 }, (_, i) => study(`n${i}`, [...base, '5i5h', i % 2 ? '5a5b' : '5a6b', '9g9f', `${(i % 4) + 1}c${(i % 4) + 1}d`], i));
    expect(practicePlan(many, new Map(), new Map(), T, NOW).today).toHaveLength(NEW_PER_DAY);
    const done = new Map([['n0', rec('n0', { firstAt: NOW - 60_000, dueAt: startOfDay(NOW) + DAY })], ['n1', rec('n1', { firstAt: NOW - 60_000, dueAt: startOfDay(NOW) + DAY })]]);
    expect(practicePlan(many, done, new Map(), T, NOW).today).toHaveLength(NEW_PER_DAY - 2);
  });

  it('集計：今日・身についた（1 週以上空く段）・前回まちがい', () => {
    const records = new Map([
      ['a', rec('a', { step: LEARNED_STEP })],
      ['b', rec('b', { step: 1, lastMistakes: 2 })],
    ]);
    expect(summarizePractice([a, b, c, noOwn], records, 3, T)).toEqual({ today: 3, learned: 1, total: 3, wrong: 1 });
  });
});

describe('実戦で違う手を指した研究手順', () => {
  it('段階18 の照らし合わせの「自分が研究と違う手」から、研究手順といちばん新しい日時', () => {
    const s = study('s-2', [...G1.slice(0, 17), '5a5b', '3g3f']);
    const game = (id: string, playedAt: number): Game => ({ id, kifu: '', moves: G1, black: { name: 'a' }, white: { name: 'b' }, playedAt, mySide: 'white', winner: null, addedAt: playedAt });
    const list = matchGames([game('g1', 100), game('g2', 300)], [s], T);
    expect([...missedStudies(list)]).toEqual([['s-2', 300]]);
  });
});

describe('バックアップの形', () => {
  it('おかしい記録を断る', () => {
    expect(practiceProblem(rec('s', {}))).toBeNull();
    expect(practiceProblem({ ...rec('s', {}), step: -1 })).toBe('段');
    expect(practiceProblem({ ...rec('s', {}), dueAt: 'x' })).toBe('日時');
    expect(practiceProblem(null)).toBe('形');
  });
});
