// 設定の読み込み（壊れた値の補正）と、プリセットからの生成条件
import { describe, expect, it } from 'vitest';
import { defaultSettings, formatDuration, generationSettingsFor, normalizeSettings, presetLabel } from '../../src/app/settings';
import { PRESETS } from '../../src/tree/presets';

describe('設定', () => {
  it('何も保存されていなければ初期値（プリセットは確定した値）', () => {
    const s = normalizeSettings(null);
    expect(s).toEqual(defaultSettings());
    expect(s.evalId).toBe('micro');
    expect(s.hashMB).toBe(32);
    expect(s.windowCp).toBe(300);
    expect(s.thresholds).toEqual({ mainMax: 50, goodMax: 150 });
    expect(generationSettingsFor('quick', s)).toEqual(PRESETS.quick.settings);
    expect(generationSettingsFor('deep', s)).toEqual(PRESETS.deep.settings);
  });

  it('おかしな値は、使える値に直す', () => {
    const s = normalizeSettings({
      evalId: 'huge',
      hashMB: 1024,
      threads: 99,
      windowCp: -5,
      thresholds: { mainMax: 200, goodMax: 100 },
      presets: { quick: { totalMs: 1, movetimeMs: 'x', multiPV: 50, maxRounds: 0 } },
    });
    expect(s.evalId).toBe('micro');
    expect(s.hashMB).toBe(32);
    expect(s.threads).toBe(8);
    expect(s.windowCp).toBe(0);
    // 「有力」の上限は「本線」の上限より小さくできない
    expect(s.thresholds).toEqual({ mainMax: 200, goodMax: 200 });
    expect(s.presets.quick).toEqual({ totalMs: 5000, movetimeMs: 400, multiPV: 8, maxRounds: 1 });
    expect(s.presets.normal).toEqual(defaultSettings().presets.normal);
  });

  it('プリセットの名前に全体の時間を出す', () => {
    const s = defaultSettings();
    expect(presetLabel('quick', s)).toBe('さっと（30秒）');
    expect(presetLabel('normal', s)).toBe('ふつう（2分）');
    expect(presetLabel('deep', s)).toBe('じっくり（5分）');
    expect(formatDuration(90_000)).toBe('1分30秒');
  });
});
