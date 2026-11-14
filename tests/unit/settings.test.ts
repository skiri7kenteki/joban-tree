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
    expect(generationSettingsFor('normal', s)).toEqual(PRESETS.normal.settings);
    expect(generationSettingsFor('deep', s)).toEqual(PRESETS.deep.settings);
    expect(s.presets.normal.replyMs).toBeGreaterThan(0);
  });

  it('おかしな値は、使える値に直す', () => {
    const s = normalizeSettings({
      evalId: 'huge',
      hashMB: 1024,
      threads: 99,
      windowCp: -5,
      thresholds: { mainMax: 200, goodMax: 100 },
      presets: { normal: { totalMs: 1, movetimeMs: 'x', multiPV: 50, maxRounds: 0, replyMs: -3 } },
    });
    expect(s.evalId).toBe('micro');
    expect(s.hashMB).toBe(32);
    // 探索に使えるのは 7 まで（8 にするとエンジンが止まる）
    expect(s.threads).toBe(7);
    expect(s.windowCp).toBe(0);
    // 「有力」の上限は「本線」の上限より小さくできない
    expect(s.thresholds).toEqual({ mainMax: 200, goodMax: 200 });
    expect(s.presets.normal).toEqual({ totalMs: 5000, movetimeMs: 1500, multiPV: 8, maxRounds: 1, replyMs: 0 });
    expect(s.presets.deep).toEqual(defaultSettings().presets.deep);
  });

  it('v0.3 までのプリセット（さっとがあり、自分の対応の時間が無い）は、新しい初期値に置き換える', () => {
    const s = normalizeSettings({
      presets: {
        quick: { totalMs: 30_000, movetimeMs: 400, multiPV: 3, maxRounds: 3 },
        normal: { totalMs: 120_000, movetimeMs: 800, multiPV: 4, maxRounds: 4 },
        deep: { totalMs: 300_000, movetimeMs: 1000, multiPV: 4, maxRounds: 5 },
      },
      windowCp: 200,
    });
    expect(s.presets).toEqual(defaultSettings().presets);
    expect('quick' in s.presets).toBe(false);
    // プリセット以外の設定は残る
    expect(s.windowCp).toBe(200);
  });

  it('プリセットの名前に全体の時間を出す', () => {
    const s = defaultSettings();
    expect(presetLabel('normal', s)).toBe('ふつう（2分）');
    expect(presetLabel('deep', s)).toBe('じっくり（5分）');
    expect(formatDuration(90_000)).toBe('1分30秒');
  });

  it('PC 版：精密プリセットがあり、PC のスレッド数・ハッシュを範囲内に直す。v0.5 の保存分には精密の初期値を足す', () => {
    const d = defaultSettings();
    expect(presetLabel('precise', d)).toBe('精密（10分）');
    expect(d.pcThreads).toBe(0);
    expect(d.pcHashMB).toBe(1024);
    const s = normalizeSettings({ pcThreads: -3, pcHashMB: 999 });
    expect(s.pcThreads).toBe(0);
    expect(s.pcHashMB).toBe(1024);
    expect(normalizeSettings({ pcThreads: 12, pcHashMB: 2048 })).toMatchObject({ pcThreads: 12, pcHashMB: 2048 });
    // v0.5 で保存した設定（精密が無い）でも、ふつうの値は残り、精密は初期値になる
    const v05 = { presets: { normal: { ...d.presets.normal, totalMs: 90_000 }, deep: d.presets.deep } };
    const loaded = normalizeSettings(v05);
    expect(loaded.presets.normal.totalMs).toBe(90_000);
    expect(loaded.presets.precise).toEqual(d.presets.precise);
  });
});
