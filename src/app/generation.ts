// ツリーの生成（と「この手を検証」）を動かし、進み具合を画面に知らせ、こまめに自動保存する。
// 生成中は Wake Lock で画面を点けたままにする（iOS は画面が消えると計算が止まるため）。

import { signal } from '@preact/signals';
import { saveTree } from '../storage/trees';
import { FINISH_TEXT, TreeGenerator, type FinishReason, type GeneratorProgress } from '../tree/generator';
import { TREE_FORMAT_VERSION, type GenerationSettings, type TreeData } from '../tree/types';
import { getEngine } from './engineService';

export interface GenerationState {
  treeId: string;
  /**
   * generate：生成（ここから展開も同じ）、verify：この手を検証、resample：除外した手を外して 1 局面を調べ直す、
   * explore：自分の指したい手で調べる（最善手と比べてから、その手の先を作る）
   */
  kind: 'generate' | 'verify' | 'resample' | 'explore';
  /** どの局面から（または、どの局面を）調べているか */
  startKey: string;
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

/** 生成を始める（同時に 1 つだけ）。startKey を渡すと「ここから展開」になる */
export function startGeneration(tree: TreeData, settings: GenerationSettings, startKey: string = tree.rootKey): Promise<void> {
  tree.settings = settings;
  return runJob(tree, 'generate', startKey, settings, (g) => g.run(startKey));
}

/** 「この手を検証」：自分の手番の局面を 1 つだけ調べ直す */
export function startVerify(tree: TreeData, key: string, movetimeMs: number): Promise<void> {
  const settings: GenerationSettings = { ...tree.settings, totalMs: movetimeMs, movetimeMs, multiPV: 1 };
  return runJob(tree, 'verify', key, settings, (g) => g.verify(key, movetimeMs));
}

/** 除外した手を外して、相手の手番の局面を 1 つだけ調べ直す（候補を補う。段階4-3） */
export function startResample(tree: TreeData, key: string): Promise<void> {
  // ツリーを作ったときと同じ 1 局面の時間・候補手の数で
  const { movetimeMs } = tree.settings;
  const settings: GenerationSettings = { ...tree.settings, totalMs: movetimeMs };
  tree.version = TREE_FORMAT_VERSION;
  return runJob(tree, 'resample', key, settings, (g) => g.resample(key, movetimeMs));
}

/** 最善手と自分の手を比べるときの、1 手あたりの時間：その条件の「自分の対応を調べる時間」（無ければ 1 局面の時間） */
export function compareMsOf(settings: GenerationSettings): number {
  return settings.replyMs && settings.replyMs > 0 ? settings.replyMs : settings.movetimeMs;
}

/**
 * 「自分の指したい手で調べる」（段階4-3 B）：自分の手番の局面 key で、手 move を最善手と同じ時間で比べ、
 * 本線にして、その手の後から settings（プリセット）で展開する
 */
export function startExplore(tree: TreeData, key: string, move: string, settings: GenerationSettings): Promise<void> {
  tree.settings = settings;
  tree.version = TREE_FORMAT_VERSION;
  return runJob(tree, 'explore', key, settings, (g) => g.explore(key, move, compareMsOf(settings)));
}

/** 生成していないときに、ツリーを書き換えて保存する（除外した手を戻すなど） */
export async function saveEdited(tree: TreeData): Promise<void> {
  tree.version = TREE_FORMAT_VERSION;
  tree.updatedAt = Date.now();
  treeVersion.value++;
  await saveTree(tree);
}

async function runJob(
  tree: TreeData,
  kind: GenerationState['kind'],
  startKey: string,
  settings: GenerationSettings,
  work: (generator: TreeGenerator) => Promise<FinishReason>,
): Promise<void> {
  if (isGenerating()) return;
  stopRequested = false;
  generation.value = { treeId: tree.id, kind, startKey, phase: 'engine', settings };
  const wakeLock = new ScreenWakeLock();
  void wakeLock.acquire();

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
      reason = await work(current);
      if (reason === 'error') error = current.errorMessage;
      if (kind === 'generate' || kind === 'explore') {
        tree.generation = {
          elapsedMs: Date.now() - runStartedAt,
          searched: generation.value?.progress?.searched ?? 0,
          finishedReason: FINISH_TEXT[reason],
        };
      }
    }
  } catch (e) {
    reason = 'error';
    error = e instanceof Error ? e.message : String(e);
  } finally {
    current = null;
    wakeLock.release();
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

/**
 * 画面を点けたままにする（Wake Lock API）。使えない端末では何もしない。
 * アプリを裏に回すと自動で外れるので、表に戻ったときに取り直す。
 */
class ScreenWakeLock {
  private sentinel: WakeLockSentinel | null = null;
  private active = false;
  private readonly onVisible = () => {
    if (this.active && document.visibilityState === 'visible') void this.request();
  };

  async acquire(): Promise<void> {
    this.active = true;
    document.addEventListener('visibilitychange', this.onVisible);
    await this.request();
  }

  private async request(): Promise<void> {
    if (!('wakeLock' in navigator) || (this.sentinel && !this.sentinel.released)) return;
    try {
      this.sentinel = await navigator.wakeLock.request('screen');
      // 取れたときにはもう終わっていた（すぐ終わる検証など）
      if (!this.active) void this.sentinel.release();
    } catch {
      // 電池残量が少ないときなどは断られる。生成はそのまま続ける
    }
  }

  release(): void {
    this.active = false;
    document.removeEventListener('visibilitychange', this.onVisible);
    void this.sentinel?.release().catch(() => undefined);
    this.sentinel = null;
  }
}
