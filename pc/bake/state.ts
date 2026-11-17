// 途中経過（progress.json）の読み書きと、同梱ツリーのファイルの組み立て。
// 1 局面調べるたびに保存する。書いている途中で止まっても壊れないよう、別の名前で書いてから名前を変える。

import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { BUNDLED_TREE_FILE_VERSION, BUNDLED_TREE_KIND, type BundleInfo, type BundledTreeFile } from '../../src/tree/bundled';
import type { GenerationSettings, TreeData } from '../../src/tree/types';

export const STATE_APP = 'joban-tree-bake';
export const STATE_VERSION = 1;

/** 1 局面を調べるのにかかった時間の合計（見込みの計算用） */
export interface Timings {
  oppMs: number;
  oppCount: number;
  mineMs: number;
  mineCount: number;
}

export interface BakeState {
  app: typeof STATE_APP;
  stateVersion: number;
  specId: string;
  /** 試し（深さを浅くして数と時間を測る）か */
  trial: boolean;
  evalId: 'mini' | 'micro';
  /** 実際に使う生成の設定（変わっていたら続きから作れない） */
  settings: GenerationSettings;
  startedAt: number;
  /** かかった時間（止まっていた間を除く） */
  elapsedMs: number;
  /** 何回目の実行か */
  sessions: number;
  searched: number;
  timings: Timings;
  /** 作り終わった日時（作り終わったら入る） */
  finishedAt?: number;
  /** エンジンの記録（最後に動かしたもの） */
  engine?: BundleInfo['engine'];
  tree: TreeData;
}

/** 設定が同じか（続きから作ってよいか） */
export function sameSettings(a: GenerationSettings, b: GenerationSettings): boolean {
  const keys: (keyof GenerationSettings)[] = ['maxRounds', 'multiPV', 'windowCp', 'dubiousCp', 'movetimeMs', 'replyMs'];
  return keys.every((k) => a[k] === b[k]);
}

/** 書いている途中で止まっても壊れないように保存する */
export function writeAtomic(file: string, text: string): void {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, text);
  // ウイルス対策ソフトなどが一瞬ファイルをつかんでいると名前を変えられないことがあるので、少し待ってやり直す
  for (let i = 0; ; i++) {
    try {
      renameSync(tmp, file);
      return;
    } catch (error) {
      if (i >= 20) throw error;
      const until = Date.now() + 100;
      while (Date.now() < until) {
        // 待つ
      }
    }
  }
}

export function saveState(file: string, state: BakeState): void {
  writeAtomic(file, JSON.stringify(state));
}

/** 途中経過を読む。無ければ null。形が違えば理由を投げる */
export function loadState(file: string): BakeState | null {
  if (!existsSync(file)) return null;
  const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<BakeState>;
  if (raw.app !== STATE_APP || raw.stateVersion !== STATE_VERSION || !raw.tree || !raw.settings) {
    throw new Error(`${file} は途中経過のファイルではないか、形が違います`);
  }
  return raw as BakeState;
}

/** 同梱ツリーのファイルを組み立てる */
export function buildBundle(args: {
  state: BakeState;
  id: string;
  templateId: string;
  version: number;
  name: string;
  appVersion: string;
}): BundledTreeFile {
  const { state } = args;
  const finishedAt = state.finishedAt ?? Date.now();
  const tree: TreeData = {
    ...state.tree,
    id: `bundled-${args.id}-v${args.version}`,
    name: args.name,
    createdAt: finishedAt,
    updatedAt: finishedAt,
    generation: { elapsedMs: state.elapsedMs, searched: state.searched, finishedReason: 'completed' },
  };
  const engine = state.engine;
  if (!engine) throw new Error('エンジンの記録がありません');
  return {
    app: 'joban-tree',
    kind: BUNDLED_TREE_KIND,
    version: BUNDLED_TREE_FILE_VERSION,
    bundle: {
      id: args.id,
      templateId: args.templateId,
      version: args.version,
      name: args.name,
      startedAt: state.startedAt,
      finishedAt,
      elapsedMs: state.elapsedMs,
      sessions: state.sessions,
      searched: state.searched,
      nodeCount: Object.keys(tree.nodes).length,
      maxRounds: state.settings.maxRounds,
      engine,
      settings: state.settings,
      appVersion: args.appVersion,
    },
    tree,
  };
}
