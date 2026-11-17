// 同梱ツリーの一覧（段階6-3）。中身（public/trees/*.json、1 本 約 2MB）は開くときに取りに行くので、
// アプリ本体に入れるのは、この小さな一覧（src/data/bundled-trees.json）だけ。
// 一覧は scripts/bundled-catalog.mjs が作り、tests/unit/bundled-trees.test.ts がファイルと合っているかを確かめる。

import catalog from '../data/bundled-trees.json';
import type { Side } from '../shogi/position';
import type { BundledTreeMeta } from './bundled';

export const BUNDLED_TREES: readonly BundledTreeMeta[] = (catalog as { trees: BundledTreeMeta[] }).trees;

/** その同梱ツリーの、いちばん新しい版 */
export function latestBundled(id: string, list: readonly BundledTreeMeta[] = BUNDLED_TREES): BundledTreeMeta | null {
  let best: BundledTreeMeta | null = null;
  for (const m of list) if (m.id === id && (!best || m.version > best.version)) best = m;
  return best;
}

/** この局面・この側から始まる同梱ツリー（あれば、いちばん新しい版） */
export function bundledFor(rootKey: string, mySide: Side, list: readonly BundledTreeMeta[] = BUNDLED_TREES): BundledTreeMeta | null {
  const hit = list.find((m) => m.rootKey === rootKey && m.mySide === mySide);
  return hit ? latestBundled(hit.id, list) : null;
}
