// 設定の整理：設定のタブの行の右に小さく出す「今の値」の文字
import { describe, expect, it } from 'vitest';
import { evalSummary, lastBackupSummary, lastSyncSummary, skipSameSummary, warsNameSummary } from '../../src/app/settingsSummary';

describe('設定のタブの行の今の値', () => {
  it('早送り', () => {
    expect(skipSameSummary(true)).toBe('早送り する');
    expect(skipSameSummary(false)).toBe('早送り しない');
  });

  it('将棋ウォーズの名前（空なら未設定）', () => {
    expect(warsNameSummary('sample_user')).toBe('sample_user');
    expect(warsNameSummary('')).toBe('未設定');
    expect(warsNameSummary('   ')).toBe('未設定');
  });

  it('最後のバックアップは月と日だけ', () => {
    expect(lastBackupSummary(new Date(2026, 10, 27, 9, 12).getTime())).toBe('バックアップ 11/27');
    expect(lastBackupSummary(null)).toBe('未バックアップ');
  });

  it('最後の同期は月・日と時刻', () => {
    expect(lastSyncSummary(new Date(2026, 10, 7, 9, 5).getTime())).toBe('11/7 9:05');
    expect(lastSyncSummary(null)).toBe('未同期');
  });

  it('評価関数の名前', () => {
    expect(evalSummary('micro')).toBe('つようら王11micro');
    expect(evalSummary('mini')).toBe('つようら王11mini');
  });
});
