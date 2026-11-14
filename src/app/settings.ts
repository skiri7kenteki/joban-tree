// 設定（評価関数・スレッド数・ハッシュ・W・ラベルのしきい値・プリセットの中身など）。
// 端末の中（localStorage）にだけ保存する。読み込むときは、壊れた値や古い形でも使える値に直す。

import { signal } from '@preact/signals';
import { MAX_SEARCH_THREADS, type EvalId } from '../engine/config';
import { DEFAULT_THRESHOLDS, type LabelThresholds } from '../tree/labels';
import { DEFAULT_MAX_NODES, DEFAULT_WINDOW_CP, PRESETS, type PresetId } from '../tree/presets';
import type { GenerationSettings } from '../tree/types';

/** プリセットのうち、設定で変えられる部分 */
export interface PresetValues {
  totalMs: number;
  movetimeMs: number;
  multiPV: number;
  maxRounds: number;
  /** 自分の対応を調べる時間（ミリ秒）。0 なら調べず、読み筋の 2 手目を使う（未検証） */
  replyMs: number;
}

export interface AppSettings {
  version: 1;
  evalId: EvalId;
  /** スレッド数。0 は「おまかせ」（使える範囲で最大、上限 7） */
  threads: number;
  hashMB: number;
  /** PC 版（start.bat）のスレッド数。0 は「おまかせ」（論理プロセッサの数 − 2） */
  pcThreads: number;
  /** PC 版のハッシュ（MB） */
  pcHashMB: number;
  /** 最善手から何点以内の応手を採用するか（W） */
  windowCp: number;
  /** 局面の数の上限 */
  maxNodes: number;
  thresholds: LabelThresholds;
  /** 「この手を検証」で 1 局面を調べる時間（ミリ秒） */
  verifyMs: number;
  presets: Record<PresetId, PresetValues>;
}

export const HASH_CHOICES = [16, 32, 64] as const;
/** PC 版のハッシュの選択肢（PC はメモリに余裕がある） */
export const PC_HASH_CHOICES = [256, 512, 1024, 2048] as const;
/** PC 版のスレッド数の上限（設定の値の歯止め。実際は PC の論理プロセッサの数まで） */
export const PC_MAX_THREADS = 256;
const STORAGE_KEY = 'joban-tree.settings';

export function defaultSettings(): AppSettings {
  const presets = {} as Record<PresetId, PresetValues>;
  for (const id of Object.keys(PRESETS) as PresetId[]) {
    const { totalMs, movetimeMs, multiPV, maxRounds, replyMs = 0 } = PRESETS[id].settings;
    presets[id] = { totalMs, movetimeMs, multiPV, maxRounds, replyMs };
  }
  return {
    version: 1,
    evalId: 'micro',
    threads: 0,
    hashMB: 32,
    pcThreads: 0,
    pcHashMB: 1024,
    windowCp: DEFAULT_WINDOW_CP,
    maxNodes: DEFAULT_MAX_NODES,
    thresholds: { ...DEFAULT_THRESHOLDS },
    verifyMs: 2000,
    presets,
  };
}

/** 数を範囲の中に収める（数でなければ初期値） */
function num(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback;
  return Math.max(min, Math.min(max, n));
}

/** 保存されていた値（中身は信用しない）を、使える設定に直す */
export function normalizeSettings(raw: unknown): AppSettings {
  const d = defaultSettings();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Record<string, unknown>;
  const t = (r.thresholds ?? {}) as Record<string, unknown>;
  const mainMax = num(t.mainMax, d.thresholds.mainMax, 0, 2000);
  const presetsRaw = (r.presets ?? {}) as Record<string, Record<string, unknown> | undefined>;
  // v0.4.0 でプリセットの中身を見直した。それより前に保存された値（replyMs が無い）は新しい初期値に置き換える
  const oldPresets = Object.values(presetsRaw).some((p) => p && !('replyMs' in p));
  const presets = {} as Record<PresetId, PresetValues>;
  for (const id of Object.keys(d.presets) as PresetId[]) {
    const p = (oldPresets ? undefined : presetsRaw[id]) ?? {};
    const def = d.presets[id];
    presets[id] = {
      totalMs: num(p.totalMs, def.totalMs, 5_000, 3_600_000),
      movetimeMs: num(p.movetimeMs, def.movetimeMs, 100, 60_000),
      multiPV: num(p.multiPV, def.multiPV, 1, 8),
      maxRounds: num(p.maxRounds, def.maxRounds, 1, 20),
      replyMs: num(p.replyMs, def.replyMs, 0, 60_000),
    };
  }
  return {
    version: 1,
    evalId: r.evalId === 'mini' ? 'mini' : 'micro',
    threads: num(r.threads, d.threads, 0, MAX_SEARCH_THREADS),
    hashMB: HASH_CHOICES.includes(r.hashMB as 16) ? (r.hashMB as number) : d.hashMB,
    pcThreads: num(r.pcThreads, d.pcThreads, 0, PC_MAX_THREADS),
    pcHashMB: PC_HASH_CHOICES.includes(r.pcHashMB as 256) ? (r.pcHashMB as number) : d.pcHashMB,
    windowCp: num(r.windowCp, d.windowCp, 0, 5000),
    maxNodes: num(r.maxNodes, d.maxNodes, 50, 20_000),
    thresholds: { mainMax, goodMax: num(t.goodMax, d.thresholds.goodMax, mainMax, 5000) },
    verifyMs: num(r.verifyMs, d.verifyMs, 200, 60_000),
    presets,
  };
}

function load(): AppSettings {
  try {
    const text = localStorage.getItem(STORAGE_KEY);
    return normalizeSettings(text ? JSON.parse(text) : null);
  } catch {
    return defaultSettings();
  }
}

/** いまの設定（変えると画面がすぐ反映する） */
export const settings = signal<AppSettings>(typeof localStorage === 'undefined' ? defaultSettings() : load());

/** 設定を変えて保存する */
export function updateSettings(next: AppSettings): void {
  const normalized = normalizeSettings(next);
  settings.value = normalized;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // 保存できなくても（プライベートモードなど）、開いている間は使える
  }
}

/** 設定を初期値に戻す */
export function resetSettings(): void {
  updateSettings(defaultSettings());
}

/** プリセットと設定から、生成の条件を作る */
export function generationSettingsFor(id: PresetId, s: AppSettings = settings.value): GenerationSettings {
  return { ...s.presets[id], windowCp: s.windowCp, maxNodes: s.maxNodes };
}

/** プリセットのボタンに出す名前（例：「ふつう（2分）」） */
export function presetLabel(id: PresetId, s: AppSettings = settings.value): string {
  const name = { normal: 'ふつう', deep: 'じっくり', precise: '精密' }[id];
  return `${name}（${formatDuration(s.presets[id].totalMs)}）`;
}

/** 30000 → 「30秒」、120000 → 「2分」、90000 → 「1分30秒」 */
export function formatDuration(ms: number): string {
  const sec = Math.round(ms / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m === 0) return `${s}秒`;
  return s === 0 ? `${m}分` : `${m}分${s}秒`;
}
