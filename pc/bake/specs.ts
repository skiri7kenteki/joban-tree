// 同梱ツリーの作り方（どの戦型から、どの設定で）。新しい同梱ツリーを足すときは、ここに 1 つ足す。
//
// 時間の決め方（段階6-2）：PC のネイティブ版＋11mini（14 スレッドで約 300 万局面/秒）。
// 相手の局面は MultiPV 4 で候補を並べるので長め、自分の局面は MultiPV 1 で最善手を確定する。
// 全体が 1〜2 時間に収まるよう、試しの 3 往復の数から決めた（2026-11-17、PROGRESS.md に記録）：
//   横歩取り △3三角（後手番）は、相手の局面 1 → 4 → 16 → 54（1 往復で約 3.4〜4 倍）、応手は平均 3.7 個。
//   6 往復で相手の局面 約 870・自分の局面 約 3,200 の見込み。相手 5 秒・自分 3 秒では約 3 時間 54 分。
//   持ち主の判断（2026-11-17）：質を最優先して **相手 5 秒・自分 3 秒（約 4 時間）**。
//   （ほかの案：相手 2.5 秒・自分 1.5 秒で約 2 時間、相手 3.5 秒・自分 2 秒で約 2 時間 45 分）

import { DEFAULT_THRESHOLDS } from '../../src/tree/labels';
import { DEFAULT_WINDOW_CP } from '../../src/tree/presets';
import type { GenerationSettings } from '../../src/tree/types';

export interface BakeSpec {
  /** 同梱ツリーの id（ファイル名にも使う） */
  id: string;
  /** 出発点の戦型テンプレート */
  templateId: string;
  /** 同梱ツリーの版。作り直して入れ替えるときは上げる */
  version: number;
  evalId: 'mini' | 'micro';
  settings: GenerationSettings;
}

/** 時間と局面の数の上限は付けない（深さの上限まで作りきる。止めたくなったら止めて、後で続きから） */
const NO_LIMIT_MS = 30 * 24 * 3600_000;
const NO_LIMIT_NODES = 1_000_000;

export const BAKE_SPECS: BakeSpec[] = [
  {
    id: 'yokofu-33kaku-gote',
    templateId: 'yokofu-33kaku-gote',
    version: 1,
    evalId: 'mini',
    settings: {
      totalMs: NO_LIMIT_MS,
      maxNodes: NO_LIMIT_NODES,
      maxRounds: 6,
      multiPV: 4,
      windowCp: DEFAULT_WINDOW_CP,
      dubiousCp: DEFAULT_THRESHOLDS.goodMax,
      movetimeMs: 5000,
      replyMs: 3000,
    },
  },
];
