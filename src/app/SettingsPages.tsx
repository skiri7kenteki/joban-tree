// 設定の下の画面の中身（設定の整理。目次と「‹ 設定」は SettingsScreen.tsx）。
// 値を変える画面は、変えたらすぐ保存する（端末の中だけ）。エンジンの設定は、次にエンジンに聞くときから使われる。

import { useEffect, useRef, useState } from 'preact/hooks';
import { EVALS, isOfflineReady, prepareOffline, type EvalId } from '../engine/config';
import { MAX_SEARCH_THREADS } from '../engine/config';
import type { PcInfo } from '../engine/pcEngine';
import { defaultPcThreads, defaultThreads, pcEngine } from './engineService';
import { DataSection } from './DataSection';
import { DriveSection } from './DriveSection';
import { setWarsName, warsName } from './games';
import type { SettingsPage } from './router';
import { HASH_CHOICES, PC_HASH_CHOICES, settings, updateSettings, type AppSettings } from './settings';

export const PAGES: Record<SettingsPage, { title: string; Body: () => preact.JSX.Element }> = {
  practice: { title: '稽古', Body: PracticePage },
  games: { title: '実戦', Body: GamesPage },
  data: { title: 'データ管理', Body: DataSection },
  sync: { title: 'Google ドライブで同期', Body: SyncPage },
  engine: { title: 'エンジン', Body: EnginePage },
};

/** 今の設定と、その一部を変えて保存する関数 */
function useSettings() {
  const s = settings.value;
  const set = (patch: Partial<AppSettings>) => updateSettings({ ...s, ...patch });
  return { s, set };
}

/** 値を変える画面の上の一言 */
const SavedNote = () => <p class="muted">変えるとすぐ保存されます（この端末の中だけ）。</p>;

function PracticePage() {
  const { s, set } = useSettings();
  return (
    <>
      <SavedNote />
      {/* 段階26-2：稽古の早送り */}
      <section class="card settings-section">
        <div class="form-field">
          <span>同じ出だしを早送り</span>
          <div class="btn-row" role="radiogroup" aria-label="同じ出だしを早送り">
            {[true, false].map((on) => (
              <button
                type="button"
                key={String(on)}
                role="radio"
                aria-checked={s.skipSameStart === on}
                data-testid={on ? 'skip-same-on' : 'skip-same-off'}
                class={s.skipSameStart === on ? 'btn btn-toggle on' : 'btn btn-toggle'}
                onClick={() => set({ skipSameStart: on })}
              >
                {on ? 'する' : 'しない'}
              </button>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}

/** 段階18：実戦の照らし合わせで、自分の側を決める */
function GamesPage() {
  return (
    <>
      <SavedNote />
      <section class="card settings-section">
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
    </>
  );
}

function SyncPage() {
  return (
    <section class="card settings-section">
      <DriveSection />
    </section>
  );
}

/** エンジンの設定と、エンジンに聞くでも使う本線・有力の境目 */
function EnginePage() {
  const { s, set } = useSettings();
  const pc = pcEngine.value;
  const isolated = self.crossOriginIsolated;
  const maxThreads = Math.min(MAX_SEARCH_THREADS, navigator.hardwareConcurrency || 1);
  return (
    <>
      <SavedNote />
      <section class="card settings-section">
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
        <h2>本線と有力の境目</h2>
        <p class="muted" data-testid="label-help">
          最善手との差で「本線」「有力」「疑問手」（咎められる手。オレンジ）に分けます。
        </p>
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
      </section>
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
      <span>オフライン（電波がなくてもエンジンに聞けるか）</span>
      {state === 'checking' && <span class="muted">確認中…</span>}
      {state === 'ready' && <span class="status-ok">準備できています（{EVALS[evalId].label}）</span>}
      {(state === 'missing' || state === 'error') && (
        <>
          <span class="muted">
            {EVALS[evalId].label} はまだ端末に保存されていません（一度エンジンに聞くと保存されます）。
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
