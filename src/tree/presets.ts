// 生成のプリセット（段階0の測定で決めた値。CLAUDE.md の表と同じ）。
// いちばん遅い端末（Android、4 スレッドで 1 秒あたり約 15〜23 万局面）でも使えるように選んでいる。

import type { GenerationSettings } from './types';

export type PresetId = 'quick' | 'normal' | 'deep';

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
  quick: {
    id: 'quick',
    label: 'さっと（30秒）',
    settings: { totalMs: 30_000, movetimeMs: 400, multiPV: 3, maxRounds: 3, maxNodes: DEFAULT_MAX_NODES, windowCp: DEFAULT_WINDOW_CP },
  },
  normal: {
    id: 'normal',
    label: 'ふつう（2分）',
    settings: { totalMs: 120_000, movetimeMs: 800, multiPV: 4, maxRounds: 4, maxNodes: DEFAULT_MAX_NODES, windowCp: DEFAULT_WINDOW_CP },
  },
  deep: {
    id: 'deep',
    label: 'じっくり（5分）',
    settings: { totalMs: 300_000, movetimeMs: 1000, multiPV: 4, maxRounds: 5, maxNodes: DEFAULT_MAX_NODES, windowCp: DEFAULT_WINDOW_CP },
  },
};
