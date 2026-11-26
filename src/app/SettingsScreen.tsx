// 設定画面：評価関数・スレッド数・ハッシュ・W・ラベルのしきい値・検証の時間・プリセットの中身、オフラインの準備。
// 変えたらすぐ保存する（端末の中だけ）。エンジンの設定は、次に生成するときから使われる。

import { useEffect, useRef, useState } from 'preact/hooks';
import { EVALS, isOfflineReady, prepareOffline, type EvalId } from '../engine/config';
import { MAX_SEARCH_THREADS } from '../engine/config';
import type { PcInfo } from '../engine/pcEngine';
import type { PresetId } from '../tree/presets';
import { availablePresets, defaultPcThreads, defaultThreads, pcEngine } from './engineService';
import { isGenerating } from './generation';
import { AppInfo } from '../components/Footer';
import { DataSection } from './DataSection';
import { setWarsName, warsName } from './games';
import { go } from './router';
import { HASH_CHOICES, PC_HASH_CHOICES, REVIEW_BATCH_CHOICES, presetLabel, resetSettings, settings, updateSettings, type AppSettings, type PresetValues } from './settings';

export function SettingsScreen() {
  const s = settings.value;
  const pc = pcEngine.value;
  const [confirmReset, setConfirmReset] = useState(false);
  const isolated = self.crossOriginIsolated;
  const maxThreads = Math.min(MAX_SEARCH_THREADS, navigator.hardwareConcurrency || 1);

  const set = (patch: Partial<AppSettings>) => updateSettings({ ...s, ...patch });
  const setPreset = (id: PresetId, patch: Partial<PresetValues>) =>
    updateSettings({ ...s, presets: { ...s.presets, [id]: { ...s.presets[id], ...patch } } });

  return (
    <>
      <div class="screen-header">
        <h1 class="page-title">設定</h1>
      </div>
      <p class="muted">変えるとすぐ保存されます（この端末の中だけ）。</p>
      {isGenerating() && <p class="notice">生成中です。エンジンの設定は、次の生成から使われます。</p>}

      {/* 段階18：実戦の照らし合わせで、自分の側を決める */}
      <section class="card settings-section">
        <h2>実戦</h2>
        <label class="form-field">
          <span>将棋ウォーズのユーザー名</span>
          <input
            type="text"
            class="text-input"
            data-testid="wars-name"
            value={warsName.value}
            autocomplete="off"
            autocapitalize="off"
            spellcheck={false}
            maxLength={40}
            onChange={(e) => setWarsName((e.currentTarget as HTMLInputElement).value)}
          />
        </label>
        <p class="muted">棋譜の先手・後手の名前と照らして、あなたの側を自動で決めます。</p>
      </section>

      {/* 段階17：データの保護とまとめてのバックアップ */}
      <DataSection />

      {/* 段階11-4：復習は決まった数で 1 回が終わる */}
      <section class="card settings-section">
        <h2>復習</h2>
        <div class="form-field">
          <span>1 回の問題の数</span>
          <div class="btn-row" role="radiogroup" aria-label="1 回の問題の数">
            {REVIEW_BATCH_CHOICES.map((n) => (
              <button
                type="button"
                key={n}
                role="radio"
                aria-checked={s.reviewBatch === n}
                data-testid={`review-batch-${n}`}
                class={s.reviewBatch === n ? 'btn btn-toggle on' : 'btn btn-toggle'}
                onClick={() => set({ reviewBatch: n })}
              >
                {n} 問
              </button>
            ))}
          </div>
        </div>
      </section>

      <section class="card settings-section">
        <h2>エンジン</h2>
        <div class="form-field">
          <span>評価関数</span>
          <div class="btn-row" role="radiogroup" aria-label="評価関数">
            {(Object.keys(EVALS) as EvalId[]).map((id) => (
              <button
                type="button"
                key={id}
                role="radio"
                aria-checked={s.evalId === id}
                data-testid={`eval-${id}`}
                class={s.evalId === id ? 'btn btn-toggle on' : 'btn btn-toggle'}
                onClick={() => set({ evalId: id })}
              >
                {EVALS[id].label}
              </button>
            ))}
          </div>
          <span class="muted">
            mini は強め・読みは浅め（初回 約{EVALS.mini.approxMB}MB）
          </span>
        </div>

        {pc ? (
          <PcEngineFields info={pc} s={s} set={set} />
        ) : (
          <>
            <label class="form-field">
              <span>スレッド数（同時に計算する数）</span>
              {isolated ? (
                <select value={s.threads} data-testid="threads" onChange={(e) => set({ threads: Number((e.target as HTMLSelectElement).value) })}>
                  <option value={0}>おまかせ（{defaultThreads()}）</option>
                  {Array.from({ length: maxThreads }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              ) : (
                <span class="muted">この端末では 1 スレッドだけ使えます</span>
              )}
            </label>

            <label class="form-field">
              <span>ハッシュ（エンジンが使うメモリ）</span>
              <select value={s.hashMB} data-testid="hash" onChange={(e) => set({ hashMB: Number((e.target as HTMLSelectElement).value) })}>
                {HASH_CHOICES.map((mb) => (
                  <option key={mb} value={mb}>
                    {mb} MB
                  </option>
                ))}
              </select>
            </label>

            <OfflineStatus evalId={s.evalId} />
          </>
        )}
      </section>

      <section class="card settings-section">
        <h2>応手の選び方とラベル</h2>
        <p class="muted" data-testid="label-help">
          最善手との差で「本線」「有力」「疑問手」（咎められる手。オレンジ）に分けます。
        </p>
        <NumberField
          label="採用する応手：最善手から何点以内（W）"
          value={s.windowCp}
          unit="点"
          testId="window"
          onChange={(v) => set({ windowCp: v })}
        />
        <NumberField
          label="「本線」：最善手との差がこれ以下"
          value={s.thresholds.mainMax}
          unit="点"
          testId="main-max"
          onChange={(v) => set({ thresholds: { ...s.thresholds, mainMax: v } })}
        />
        <NumberField
          label="「有力」：差がこれ以下（これより大きいと「疑問手」）"
          value={s.thresholds.goodMax}
          unit="点"
          testId="good-max"
          onChange={(v) => set({ thresholds: { ...s.thresholds, goodMax: v } })}
        />
        <NumberField label="1 回で増やす局面の数の上限" value={s.maxNodes} unit="局面" testId="max-nodes" onChange={(v) => set({ maxNodes: v })} />
        <NumberField
          label="「この手を検証」で調べる時間"
          value={s.verifyMs / 1000}
          unit="秒"
          step={0.5}
          testId="verify-sec"
          onChange={(v) => set({ verifyMs: v * 1000 })}
        />
      </section>

      <section class="card settings-section">
        <h2>プリセットの中身</h2>
        {availablePresets().map((id) => {
          const p = s.presets[id];
          return (
            <fieldset key={id} class="preset-field" data-testid={`preset-${id}`}>
              <legend>{presetLabel(id)}</legend>
              <NumberField
                label="全体の時間"
                value={p.totalMs / 1000}
                unit="秒"
                testId={`${id}-total`}
                onChange={(v) => setPreset(id, { totalMs: v * 1000 })}
              />
              <NumberField
                label="相手の局面を調べる時間"
                value={p.movetimeMs}
                unit="ミリ秒"
                step={100}
                testId={`${id}-movetime`}
                onChange={(v) => setPreset(id, { movetimeMs: v })}
              />
              <NumberField
                label="自分の対応を調べる時間（0 なら調べず「未検証」のまま）"
                value={p.replyMs}
                unit="ミリ秒"
                step={100}
                testId={`${id}-reply`}
                onChange={(v) => setPreset(id, { replyMs: v })}
              />
              <NumberField
                label="候補手の数（N）"
                value={p.multiPV}
                unit="手"
                testId={`${id}-multipv`}
                onChange={(v) => setPreset(id, { multiPV: v })}
              />
              <NumberField
                label="深さ（往復の数）"
                value={p.maxRounds}
                unit="往復"
                testId={`${id}-rounds`}
                onChange={(v) => setPreset(id, { maxRounds: v })}
              />
            </fieldset>
          );
        })}
      </section>

      {/* 一覧画面から移した（段階4-2） */}
      <section class="card settings-section">
        <h2>エンジンの速度測定</h2>
        <p class="muted">1 秒あたり何局面調べられるかを測ります。</p>
        <a class="btn" href={`${import.meta.env.BASE_URL}bench.html`} data-testid="open-bench">
          速度測定のページを開く
        </a>
      </section>

      <div class="btn-row">
        {!confirmReset ? (
          <button type="button" class="btn btn-danger" data-testid="reset-settings" onClick={() => setConfirmReset(true)}>
            設定を初期値に戻す…
          </button>
        ) : (
          <>
            <span>すべての設定を初期値に戻しますか？（ツリーは消えません）</span>
            <button
              type="button"
              class="btn btn-danger"
              data-testid="reset-confirm"
              onClick={() => {
                resetSettings();
                setConfirmReset(false);
              }}
            >
              戻す
            </button>
            <button type="button" class="btn" onClick={() => setConfirmReset(false)}>
              やめる
            </button>
          </>
        )}
      </div>

      {/* 段階18：ツリーのタブをなくし、入口をここに残した（データは消していない） */}
      <section class="card settings-section">
        <h2>ツリー（以前の機能）</h2>
        <p class="muted">エンジンで応手を調べたツリーの一覧です。</p>
        <button type="button" class="btn" data-testid="open-trees" onClick={() => go('/trees')}>
          ツリーの一覧を開く
        </button>
      </section>

      {/* 段階11-1：画面のいちばん下から移した */}
      <AppInfo />
    </>
  );
}

/** PC 版（start.bat から開いたとき）のエンジンの設定 */
function PcEngineFields({ info, s, set }: { info: PcInfo; s: AppSettings; set: (patch: Partial<AppSettings>) => void }) {
  return (
    <>
      <p class="notice" data-testid="pc-engine-info">
        PC のエンジン（Windows 版やねうら王）を使います。{info.cpuName && `CPU：${info.cpuName}`}
      </p>
      <label class="form-field">
        <span>PC のスレッド数</span>
        <select value={s.pcThreads} data-testid="pc-threads" onChange={(e) => set({ pcThreads: Number((e.target as HTMLSelectElement).value) })}>
          <option value={0}>おまかせ（{defaultPcThreads(info)}）</option>
          {Array.from({ length: info.cpus }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <span class="muted">多いほど速いが、PC のほかの作業が重くなります。</span>
      </label>
      <label class="form-field">
        <span>PC のハッシュ（エンジンが使うメモリ）</span>
        <select value={s.pcHashMB} data-testid="pc-hash" onChange={(e) => set({ pcHashMB: Number((e.target as HTMLSelectElement).value) })}>
          {PC_HASH_CHOICES.filter((mb) => !info.totalMemMB || mb <= info.totalMemMB / 4).map((mb) => (
            <option key={mb} value={mb}>
              {mb} MB
            </option>
          ))}
        </select>
      </label>
    </>
  );
}

/** 数の入力欄（入力を終えたとき＝欄を離れたときに保存。範囲外は近い値に直る） */
function NumberField({
  label,
  value,
  unit,
  step = 1,
  testId,
  onChange,
}: {
  label: string;
  value: number;
  unit: string;
  step?: number;
  testId: string;
  onChange: (value: number) => void;
}) {
  // 範囲外の値は保存のときに直るので、直った値を欄に出し直す（最新の値をここに覚えておく）
  const latest = useRef(value);
  latest.current = value;
  return (
    <label class="form-field form-field-number">
      <span>{label}</span>
      <span class="form-field-input">
        <input
          type="number"
          inputMode="decimal"
          step={step}
          value={value}
          data-testid={testId}
          onChange={(e) => {
            const input = e.target as HTMLInputElement;
            const n = Number(input.value);
            if (input.value !== '' && Number.isFinite(n)) onChange(n);
            setTimeout(() => {
              input.value = String(latest.current);
            }, 0);
          }}
        />
        <span class="muted">{unit}</span>
      </span>
    </label>
  );
}

/** オフラインで使えるか（エンジンと評価関数が端末に保存されているか） */
function OfflineStatus({ evalId }: { evalId: EvalId }) {
  const [state, setState] = useState<'checking' | 'ready' | 'missing' | 'loading' | 'error'>('checking');
  const [detail, setDetail] = useState('');

  useEffect(() => {
    setState('checking');
    isOfflineReady(evalId)
      .then((ok) => setState(ok ? 'ready' : 'missing'))
      .catch(() => setState('missing'));
  }, [evalId]);

  async function prepare() {
    setState('loading');
    try {
      await prepareOffline(evalId, (done, total) => setDetail(`${done}/${total}`));
      setState('ready');
    } catch (e) {
      setDetail(e instanceof Error ? e.message : String(e));
      setState('error');
    }
  }

  return (
    <div class="form-field" data-testid="offline-status" data-state={state}>
      <span>オフライン（電波がなくても生成できるか）</span>
      {state === 'checking' && <span class="muted">確認中…</span>}
      {state === 'ready' && <span class="status-ok">準備できています（{EVALS[evalId].label}）</span>}
      {(state === 'missing' || state === 'error') && (
        <>
          <span class="muted">
            {EVALS[evalId].label} はまだ端末に保存されていません（一度生成すると保存されます）。
            {state === 'error' && `失敗しました：${detail}`}
          </span>
          <button type="button" class="btn" data-testid="offline-prepare" onClick={() => void prepare()}>
            今すぐ保存する（約{EVALS[evalId].approxMB}MB）
          </button>
        </>
      )}
      {state === 'loading' && <span class="muted">保存中… {detail}</span>}
    </div>
  );
}
