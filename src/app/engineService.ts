// アプリで使うエンジンを 1 つだけ用意する（最初に必要になったときに読み込む）。

import { signal } from '@preact/signals';
import { createYaneuraOu, type UsiEngine } from '../engine/engine';
import type { EvalId } from '../engine/config';

/** 読み込みの進み具合（画面表示用） */
export const engineStatus = signal('');

/** 使う評価関数（設定画面は段階2。いまは 11micro 固定） */
const EVAL_ID: EvalId = 'micro';
/** ハッシュの大きさ（MB） */
const HASH_MB = 32;
/** スレッド数の上限（段階0の測定で、4 まではほぼ比例して速くなった） */
const MAX_THREADS = 4;

/** 使えるスレッド数（端末のコア数と上限の小さい方） */
export function defaultThreads(): number {
  if (!self.crossOriginIsolated) return 1;
  return Math.max(1, Math.min(MAX_THREADS, navigator.hardwareConcurrency || 1));
}

let enginePromise: Promise<UsiEngine> | null = null;

/** エンジンを返す（まだなら読み込む。失敗したら次に呼ばれたときにやり直す） */
export function getEngine(): Promise<UsiEngine> {
  if (!enginePromise) {
    engineStatus.value = 'エンジンを読み込み中';
    enginePromise = createYaneuraOu(EVAL_ID, { threads: defaultThreads(), hashMB: HASH_MB }, (text) => {
      engineStatus.value = text;
    })
      .then(({ engine }) => {
        engineStatus.value = '';
        return engine;
      })
      .catch((error: unknown) => {
        enginePromise = null;
        engineStatus.value = '';
        throw error;
      });
  }
  return enginePromise;
}
