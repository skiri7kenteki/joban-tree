// 画面をまたいで渡すもの（段階8-1）：研究手順の画面の「この局面からツリーを作る」→ 新しいツリーの画面に、手順を読み込んだ状態で移る。
// 新しいツリーの画面が開いたときに 1 回だけ読んで消す。

import { signal } from '@preact/signals';
import type { Side } from '../shogi/position';

export interface InputHandoff {
  /** 平手からの手順 */
  moves: string[];
  /** 開始局面として選んでおく局面（平手から何手目か） */
  index: number;
  mySide: Side;
  /** 研究手順の戦型（あれば、戦型を選んだときと同じ表示にする） */
  templateId?: string;
}

export const inputHandoff = signal<InputHandoff | null>(null);

/** 読んで消す */
export function takeInputHandoff(): InputHandoff | null {
  const h = inputHandoff.value;
  inputHandoff.value = null;
  return h;
}
