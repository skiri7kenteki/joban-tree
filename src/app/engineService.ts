// アプリで使うエンジンを 1 つだけ用意する（最初に必要になったときに読み込む）。
// 設定（評価関数・スレッド数・ハッシュ）が変わっていたら、次に使うときに作り直す。
//
// PC 版：start.bat（pc/server.mjs）から開いたときは、ブラウザの中の WASM 版ではなく、
// PC の Windows 版やねうら王を使う（ブラウザ版の約 3 倍速い）。どちらを使うかは開いたときに決まる。

import { signal } from '@preact/signals';
import { MAX_SEARCH_THREADS } from '../engine/config';
import { createYaneuraOu, type UsiEngine } from '../engine/engine';
import { createPcEngine, detectPcEngine, type PcInfo } from '../engine/pcEngine';
import { settings, type AppSettings } from './settings';

/** 読み込みの進み具合（画面表示用） */
export const engineStatus = signal('');

/** PC 版のサーバーの情報（PC 版でなければ null。調べている間は undefined） */
export const pcEngine = signal<PcInfo | null | undefined>(undefined);

/** PC 版かどうかを調べる（アプリを開いたときに 1 回） */
const pcDetection: Promise<PcInfo | null> =
  typeof location === 'undefined'
    ? Promise.resolve(null)
    : detectPcEngine().then((info) => {
        pcEngine.value = info;
        return info;
      });

/**
 * 「おまかせ」のときのスレッド数（端末のコア数と上限 7 の小さい方）。
 * 段階3の測定（iPad）で 4→7 スレッドにすると 1 秒に調べる局面が約 3 割増えたため、上限 4 から変えた（持ち主の判断 2026-11-14）
 */
export function defaultThreads(): number {
  if (!self.crossOriginIsolated) return 1;
  return Math.max(1, Math.min(MAX_SEARCH_THREADS, navigator.hardwareConcurrency || 1));
}

/** 設定から、実際に使うスレッド数を決める */
export function effectiveThreads(s: AppSettings = settings.value): number {
  if (!self.crossOriginIsolated) return 1;
  return s.threads > 0 ? Math.min(s.threads, MAX_SEARCH_THREADS) : defaultThreads();
}

/**
 * PC 版の「おまかせ」のスレッド数：論理プロセッサの数 − 2（ブラウザやほかの作業の分を残す）。
 * 段階3の測定（Ryzen 7 250、16 論理）で、14 と 16 の速さはほぼ同じだった
 */
export function defaultPcThreads(info: PcInfo): number {
  return Math.max(1, info.cpus - 2);
}

/** PC 版で実際に使うスレッド数 */
export function effectivePcThreads(info: PcInfo, s: AppSettings = settings.value): number {
  return s.pcThreads > 0 ? Math.min(s.pcThreads, info.cpus) : defaultPcThreads(info);
}

let enginePromise: Promise<UsiEngine> | null = null;
/** いまのエンジンを作ったときの設定（変わったら作り直す） */
let engineKey = '';

function keyOf(s: AppSettings, pc: PcInfo | null): string {
  return pc ? `pc/${s.evalId}/${effectivePcThreads(pc, s)}/${s.pcHashMB}` : `${s.evalId}/${effectiveThreads(s)}/${s.hashMB}`;
}

/** 設定に合ったエンジンを新しく作る */
async function createEngine(s: AppSettings, pc: PcInfo | null): Promise<UsiEngine> {
  const onStatus = (text: string) => {
    engineStatus.value = text;
  };
  if (pc) return createPcEngine(s.evalId, { threads: effectivePcThreads(pc, s), hashMB: s.pcHashMB }, onStatus);
  const { engine } = await createYaneuraOu(s.evalId, { threads: effectiveThreads(s), hashMB: s.hashMB }, onStatus);
  return engine;
}

/** エンジンを返す（まだ無い・設定が変わったなら読み込む。失敗したら次に呼ばれたときにやり直す） */
export async function getEngine(): Promise<UsiEngine> {
  const pc = await pcDetection;
  const s = settings.value;
  const key = keyOf(s, pc);
  if (enginePromise && engineKey !== key) {
    // 古いエンジンは閉じる（Worker を止めてメモリを空ける）
    const old = enginePromise;
    enginePromise = null;
    old.then((e) => e.close()).catch(() => undefined);
  }
  if (!enginePromise) {
    engineKey = key;
    engineStatus.value = 'エンジンを読み込み中';
    const created = createEngine(s, pc)
      .then((engine) => {
        engineStatus.value = '';
        // エンジンが思いがけず終わったら（PC 版で黒い画面を閉じたなど）、次に使うときに作り直す
        engine.onDead(() => {
          if (enginePromise === created) enginePromise = null;
        });
        return engine;
      })
      .catch((error: unknown) => {
        if (enginePromise === created) enginePromise = null;
        engineStatus.value = '';
        throw error;
      });
    enginePromise = created;
  }
  return enginePromise;
}
