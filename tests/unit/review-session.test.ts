// 段階11-4：復習を小分けにする（1 回＝決まった数の問題）
import { describe, expect, it } from 'vitest';
import { addItem, newSession, progressText, sessionDone, sessionMistakes, sessionScore } from '../../src/review/session';
import { defaultSettings, normalizeSettings } from '../../src/app/settings';

const item = (ok: boolean, answer = '7g7f') => ({ sfen: 'sfen', answer, ok, ...(ok ? {} : { tried: '2g2f' }) });

describe('復習の 1 回', () => {
  it('決まった数を答えたら終わり。正解の数とまちがえた問題（答えた順）', () => {
    let s = newSession(3);
    expect(sessionDone(s)).toBe(false);
    s = addItem(s, item(true, 'a'));
    s = addItem(s, item(false, 'b'));
    expect(sessionDone(s)).toBe(false);
    s = addItem(s, item(false, 'c'));
    expect(sessionDone(s)).toBe(true);
    expect(sessionScore(s)).toEqual({ asked: 3, ok: 1 });
    expect(sessionMistakes(s).map((m) => [m.answer, m.tried])).toEqual([
      ['b', '2g2f'],
      ['c', '2g2f'],
    ]);
  });

  it('進み具合の文：出している問題も数える（決まった数を超えない）', () => {
    let s = newSession(10);
    expect(progressText(s, true)).toBe('今日 1／10問');
    s = addItem(s, item(true));
    expect(progressText(s, false)).toBe('今日 1／10問');
    expect(progressText(s, true)).toBe('今日 2／10問');
    for (let i = 0; i < 9; i++) s = addItem(s, item(true));
    expect(progressText(s, true)).toBe('今日 10／10問');
  });

  it('設定：1 回の問題の数は 5／10／20（初期値 10。前の版の設定・おかしな値も 10）', () => {
    expect(defaultSettings().reviewBatch).toBe(10);
    expect(normalizeSettings({ reviewBatch: 20 }).reviewBatch).toBe(20);
    expect(normalizeSettings({ reviewBatch: 5 }).reviewBatch).toBe(5);
    expect(normalizeSettings({ reviewBatch: 7 }).reviewBatch).toBe(10);
    expect(normalizeSettings({ evalId: 'mini' }).reviewBatch).toBe(10);
  });
});
