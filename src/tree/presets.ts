// 生成のプリセット（CLAUDE.md の表と同じ）。
// いちばん遅い端末（Android、4 スレッドで 1 秒あたり約 15〜23 万局面）でも、序盤の手の質が保てるように選んでいる。
//
// v0.4.0 で見直し（持ち主の判断 2026-11-14）：
//   段階0の値（さっと 0.4 秒など）では Android で深さ 9〜13 しか届かず、評価値のぶれと自分の対応の悪さが目立った。
//   1 局面の時間を延ばし、自分の対応も別に調べて確定する（replyMs）。代わりに枝は少なくなる。「さっと」はやめた。

import type { GenerationSettings } from './types';

export type PresetId = 'normal' | 'deep';

/** 画面に出す順 */
export const PRESET_IDS: PresetId[] = ['normal', 'deep'];

export interface Preset {
  id: PresetId;
  label: string;
  settings: GenerationSettings;
}

/** 応手の採用：最善手から何点以内か（初期値） */
export const DEFAULT_WINDOW_CP = 300;
/** 局面の数の上限（念のための歯止め） */
export const DEFAULT_MAX_NODES = 3000;

export const PRESETS: Record<PresetId, Preset> = {
  normal: {
    id: 'normal',
    label: 'ふつう（2分）',
    settings: {
      totalMs: 120_000,
      movetimeMs: 1500,
      multiPV: 3,
      maxRounds: 4,
      maxNodes: DEFAULT_MAX_NODES,
      windowCp: DEFAULT_WINDOW_CP,
      replyMs: 1000,
    },
  },
  deep: {
    id: 'deep',
    label: 'じっくり（5分）',
    settings: {
      totalMs: 300_000,
      movetimeMs: 2500,
      multiPV: 4,
      maxRounds: 5,
      maxNodes: DEFAULT_MAX_NODES,
      windowCp: DEFAULT_WINDOW_CP,
      replyMs: 1500,
    },
  },
};
