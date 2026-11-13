// ツリーの生成を動かし、進み具合を画面に知らせ、こまめに自動保存する。

import { signal } from '@preact/signals';
import { saveTree } from '../storage/trees';
import { FINISH_TEXT, TreeGenerator, type FinishReason, type GeneratorProgress } from '../tree/generator';
import type { GenerationSettings, TreeData } from '../tree/types';
import { getEngine } from './engineService';

export interface GenerationState {
  treeId: string;
  /** engine：エンジンの準備中、running：生成中、done：終わった */
  phase: 'engine' | 'running' | 'done';
  settings: GenerationSettings;
  /** 生成を始めた時刻（エンジンの準備が終わってから数える） */
  runStartedAt?: number;
  progress?: GeneratorProgress;
  finish?: FinishReason;
  error?: string;
}

/** いま（または最後に）動かした生成の状態 */
export const generation = signal<GenerationState | null>(null);
/** 開いているツリー（生成中は同じものが書き換わっていく） */
export const openTree = signal<TreeData | null>(null);
/** ツリーが書き換わるたびに増える数（画面の更新の合図） */
export const treeVersion = signal(0);

/** 自動保存の間隔（ミリ秒） */
const SAVE_INTERVAL_MS = 2000;

let current: TreeGenerator | null = null;
let stopRequested = false;

export function isGenerating(): boolean {
  const g = generation.value;
  return g !== null && g.phase !== 'done';
}

/** 生成を始める（同時に 1 つだけ） */
export async function startGeneration(tree: TreeData, settings: GenerationSettings, startKey?: string): Promise<void> {
  if (isGenerating()) return;
  stopRequested = false;
  generation.value = { treeId: tree.id, phase: 'engine', settings };
  tree.settings = settings;

  let reason: FinishReason;
  let error: string | undefined;
  let lastSave = 0;
  try {
    const engine = await getEngine();
    if (stopRequested) {
      reason = 'stopped';
    } else {
      const runStartedAt = Date.now();
      generation.value = { ...generation.value!, phase: 'running', runStartedAt };
      current = new TreeGenerator(engine, tree, settings, {
        onChange: (progress) => {
          generation.value = { ...generation.value!, progress };
          treeVersion.value++;
          // こまめに保存しておく（途中でアプリが閉じられても、そこまでのツリーが残るように）
          if (Date.now() - lastSave >= SAVE_INTERVAL_MS) {
            lastSave = Date.now();
            saveTree(tree).catch(() => undefined);
          }
        },
      });
      reason = await current.run(startKey);
      if (reason === 'error') error = current.errorMessage;
      tree.generation = {
        elapsedMs: Date.now() - runStartedAt,
        searched: generation.value?.progress?.searched ?? 0,
        finishedReason: FINISH_TEXT[reason],
      };
    }
  } catch (e) {
    reason = 'error';
    error = e instanceof Error ? e.message : String(e);
  } finally {
    current = null;
  }
  tree.updatedAt = Date.now();
  await saveTree(tree).catch(() => undefined);
  generation.value = { ...generation.value!, phase: 'done', finish: reason, error };
  treeVersion.value++;
}

/** 生成を止める（それまでのツリーは残る） */
export function stopGeneration(): void {
  stopRequested = true;
  current?.stop();
}
