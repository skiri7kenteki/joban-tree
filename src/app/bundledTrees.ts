// 「用意済みのツリーを開く」（段階6-3）：同梱ツリーを取ってきて、利用者のツリー一覧にコピーする。
// ファイルは public/trees/<id>.v<版>.json。一度取ってきたら端末に保存し（service worker と、ここでも）、通信なしでも開ける。
// コピーした後は普通のツリーなので、開くのは IndexedDB から（通信は要らない）。

import { listTrees, newTreeId, saveTree } from '../storage/trees';
import { copyBundledTree, copyName, parseBundledFile, type BundledTreeFile, type BundledTreeMeta } from '../tree/bundled';
import type { TreeData } from '../tree/types';
import { generationSettingsFor } from './settings';

/** src/sw.ts の TREES_CACHE と同じ名前（エンジン用の joban-tree-big とは分ける：あちらは古い版を消す処理があるため） */
export const TREES_CACHE = 'joban-tree-trees';

export function bundledUrl(meta: BundledTreeMeta): string {
  return new URL(`${import.meta.env.BASE_URL}trees/${meta.file}`, location.href).href;
}

/** 同梱ツリーのファイルを読む（端末に保存したものがあればそれ、無ければ取ってきて保存する） */
export async function fetchBundledFile(meta: BundledTreeMeta): Promise<BundledTreeFile> {
  const url = bundledUrl(meta);
  let cache: Cache | null = null;
  let response: Response | undefined;
  try {
    cache = await caches.open(TREES_CACHE);
    response = await cache.match(url, { ignoreVary: true });
  } catch {
    // 保存場所が使えない（プライベートモードなど）ときは、毎回取ってくる
  }
  if (!response) {
    response = await fetch(url);
    if (!response.ok) throw new Error(`ファイルを取ってこられませんでした（${response.status}）`);
    try {
      await cache?.put(url, response.clone());
    } catch {
      // 保存できなくても、今回は開ける
    }
  }
  const parsed = parseBundledFile(await response.text(), meta);
  if (typeof parsed === 'string') throw new Error(parsed);
  return parsed;
}

/** 同梱ツリーを取ってきて、新しいコピーとして保存する（生成の条件は端末の「ふつう」） */
export async function copyBundledToList(meta: BundledTreeMeta, opts: { file?: BundledTreeFile } = {}): Promise<TreeData> {
  const file = opts.file ?? (await fetchBundledFile(meta));
  const tree = copyBundledTree(file, {
    id: newTreeId(),
    name: copyName(meta, await listTrees()),
    now: Date.now(),
    settings: generationSettingsFor('normal'),
  });
  await saveTree(tree);
  return tree;
}
