// アプリで使うエンジンを 1 つだけ用意する（最初に必要になったときに読み込む）。
// 設定（評価関数・スレッド数・ハッシュ）が変わっていたら、次に使うときに作り直す。

import { signal } from '@preact/signals';
import { MAX_SEARCH_THREADS } from '../engine/config';
import { createYaneuraOu, type UsiEngine } from '../engine/engine';
import { settings, type AppSettings } from './settings';

/** 読み込みの進み具合（画面表示用） */
export const engineStatus = signal('');

/** スレッド数の上限（段階0の測定で、4 まではほぼ比例して速くなった） */
const MAX_THREADS = 4;

/** 「おまかせ」のときのスレッド数（端末のコア数と上限 4 の小さい方） */
export function defaultThreads(): number {
  if (!self.crossOriginIsolated) return 1;
  return Math.max(1, Math.min(MAX_THREADS, navigator.hardwareConcurrency || 1));
}

/** 設定から、実際に使うスレッド数を決める */
export function effectiveThreads(s: AppSettings = settings.value): number {
  if (!self.crossOriginIsolated) return 1;
  return s.threads > 0 ? Math.min(s.threads, MAX_SEARCH_THREADS) : defaultThreads();
}

let enginePromise: Promise<UsiEngine> | null = null;
/** いまのエンジンを作ったときの設定（変わったら作り直す） */
let engineKey = '';

function keyOf(s: AppSettings): string {
  return `${s.evalId}/${effectiveThreads(s)}/${s.hashMB}`;
}

/** エンジンを返す（まだ無い・設定が変わったなら読み込む。失敗したら次に呼ばれたときにやり直す） */
export function getEngine(): Promise<UsiEngine> {
  const s = settings.value;
  const key = keyOf(s);
  if (enginePromise && engineKey !== key) {
    // 古いエンジンは閉じる（Worker を止めてメモリを空ける）
    const old = enginePromise;
    enginePromise = null;
    old.then((e) => e.close()).catch(() => undefined);
  }
  if (!enginePromise) {
    engineKey = key;
    engineStatus.value = 'エンジンを読み込み中';
    enginePromise = createYaneuraOu(s.evalId, { threads: effectiveThreads(s), hashMB: s.hashMB }, (text) => {
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
