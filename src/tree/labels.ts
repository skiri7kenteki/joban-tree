// 相手の応手のラベル（本線・有力・疑問手）。しきい値は将来、設定で変えられるようにする。

export type MoveLabel = 'main' | 'good' | 'dubious';

export interface LabelThresholds {
  /** 差がこれ以下なら「本線」 */
  mainMax: number;
  /** 差がこれ以下なら「有力」（それより大きければ「疑問手」） */
  goodMax: number;
}

export const DEFAULT_THRESHOLDS: LabelThresholds = { mainMax: 50, goodMax: 150 };

export const LABEL_TEXT: Record<MoveLabel, string> = {
  main: '本線',
  good: '有力',
  dubious: '疑問手（咎められる）',
};

/** 最善手との差（0 以上）からラベルを決める */
export function labelOf(diff: number, t: LabelThresholds = DEFAULT_THRESHOLDS): MoveLabel {
  if (diff <= t.mainMax) return 'main';
  if (diff <= t.goodMax) return 'good';
  return 'dubious';
}
