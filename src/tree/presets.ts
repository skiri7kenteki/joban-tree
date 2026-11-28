// 前の版のツリー生成の設定の初期値。ツリーの画面は「機能の整理」で消したが、保存してある設定の値は
// 読んでそのまま持ち運ぶ（バックアップに入る設定の中身を変えないため。持ち主の判断 2026-11-28）。画面には出さない。

export type PresetId = 'normal' | 'deep' | 'precise';

/** プリセットの中身（保存している部分） */
export interface PresetValues {
  totalMs: number;
  movetimeMs: number;
  multiPV: number;
  maxRounds: number;
  /** 自分の対応を調べる時間（ミリ秒） */
  replyMs: number;
}

/** 応手の採用：最善手から何点以内か（初期値） */
export const DEFAULT_WINDOW_CP = 300;
/** 局面の数の上限 */
export const DEFAULT_MAX_NODES = 3000;

export const PRESET_DEFAULTS: Record<PresetId, PresetValues> = {
  normal: { totalMs: 120_000, movetimeMs: 1500, multiPV: 3, maxRounds: 4, replyMs: 1000 },
  deep: { totalMs: 300_000, movetimeMs: 2500, multiPV: 4, maxRounds: 5, replyMs: 1500 },
  precise: { totalMs: 600_000, movetimeMs: 3000, multiPV: 4, maxRounds: 5, replyMs: 1500 },
};
