// エンジンの動作確認と速度測定のページ（段階0。段階3で 8 スレッドと並列の測定を追加）。
// 持ち主がスマホ・iPad で開き、表示された数値を「結果をコピー」で報告する。
import { render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import '../styles/base.css';
import './bench.css';
import { APP_VERSION, Footer } from '../components/Footer';
import { ensureCrossOriginIsolated, type IsolationState } from '../isolation';
import { ENGINE_ID, EVALS, MAX_SEARCH_THREADS, pruneOldBigFiles, type EvalId } from '../engine/config';
import { createYaneuraOu, type EngineTimings, type UsiEngine } from '../engine/engine';
import { formatScore } from '../engine/usi';
import { BENCH_POSITIONS } from './positions';

interface Row {
  evalLabel: string;
  threads: number;
  mode: string;
  position: string;
  depth: number;
  nodes: number;
  nps: number;
  bestmove: string;
  score: string;
}

/** 測定の種類：プリセット「ふつう」の相手の局面（MultiPV3・1.5 秒）と自分の対応（MultiPV1・1 秒）に合わせる */
const MODES = [
  { label: 'MultiPV1・1000ms', multiPV: 1, movetimeMs: 1000 },
  { label: 'MultiPV3・1500ms', multiPV: 3, movetimeMs: 1500 },
];

/** 並列の測定：1 局面を調べる時間 */
const PARALLEL_MS = 3000;

interface ParallelRow {
  label: string;
  ok: boolean;
  totalNps: number;
  depth: number;
  message?: string;
}

const HASH_CHOICES = [16, 32, 64];

function threadChoices(): number[] {
  const hw = navigator.hardwareConcurrency || 1;
  if (!self.crossOriginIsolated) return [1];
  return [1, 2, 3, 4, 5, 6, 7].filter((n) => n <= Math.min(hw, MAX_SEARCH_THREADS));
}

/**
 * 並列の測定で比べる組み合わせ（合計のスレッド数は同じ）。
 * 合計 4：「1 エンジン×4」「2 エンジン×2」「4 エンジン×1」。8 コア以上なら合計 8 も
 */
function parallelPlans(): { engines: number; threads: number }[] {
  const max = threadChoices().at(-1) ?? 1;
  if (max < 4) return [];
  const plans = [1, 2, 4].map((k) => ({ engines: k, threads: 4 / k }));
  // 8 コア以上なら、合計 8 も（1 エンジンは 7 スレッドまでなので、1×7 と比べる）
  if (max >= 7 && (navigator.hardwareConcurrency || 0) >= 8) {
    plans.push({ engines: 1, threads: 7 }, { engines: 2, threads: 4 }, { engines: 4, threads: 2 });
  }
  return plans;
}

function Bench() {
  const [isolation, setIsolation] = useState<IsolationState | 'checking'>('checking');
  const [evalId, setEvalId] = useState<EvalId>('micro');
  const [hashMB, setHashMB] = useState(32);
  const [threads, setThreads] = useState(1);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [timings, setTimings] = useState<EngineTimings | null>(null);
  const [check, setCheck] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [parallelRows, setParallelRows] = useState<ParallelRow[]>([]);
  const [log, setLog] = useState<string[]>([]);
  const engineRef = useRef<{ engine: UsiEngine; evalId: EvalId } | null>(null);

  useEffect(() => {
    ensureCrossOriginIsolated().then((state) => {
      setIsolation(state);
      if (state === 'isolated') pruneOldBigFiles().catch(() => undefined);
    });
    return () => engineRef.current?.engine.close();
  }, []);

  const appendLog = (line: string) => setLog((old) => [...old.slice(-199), line]);

  /** エンジンを用意する（評価関数を変えたら作り直す） */
  async function getEngine(): Promise<UsiEngine> {
    const current = engineRef.current;
    if (current && current.evalId === evalId) {
      await current.engine.reconfigure({ threads, hashMB });
      return current.engine;
    }
    current?.engine.close();
    engineRef.current = null;
    setTimings(null);
    const t0 = performance.now();
    const created = await createYaneuraOu(evalId, { threads, hashMB }, setStatus);
    created.engine.addLineListener(appendLog);
    engineRef.current = { engine: created.engine, evalId };
    setTimings(created.timings);
    setStatus(`準備完了（${Math.round(performance.now() - t0)}ms）`);
    return created.engine;
  }

  async function run(task: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await task();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      engineRef.current?.engine.close();
      engineRef.current = null;
    } finally {
      setBusy(false);
    }
  }

  const runCheck = () =>
    run(async () => {
      setCheck('');
      const engine = await getEngine();
      setStatus('動作確認中（初期局面を 0.5 秒）');
      const r = await engine.analyze('startpos', { movetimeMs: 500, multiPV: 1 });
      const top = r.lines[0];
      setCheck(
        `bestmove ${r.bestmove}／評価値 ${top ? formatScore(top.score) : '—'}（手番側から見た値）／深さ ${r.depth}／${r.nodes.toLocaleString()} 局面`,
      );
      setStatus('動作確認 OK');
    });

  const runBench = () =>
    run(async () => {
      setRows([]);
      const list = threadChoices();
      const threadSet = [...new Set([1, Math.min(4, list[list.length - 1]), list[list.length - 1]])];
      const engine = await getEngine();
      for (const t of threadSet) {
        await engine.reconfigure({ threads: t, hashMB });
        for (const mode of MODES) {
          for (const pos of BENCH_POSITIONS) {
            setStatus(`測定中：${t} スレッド・${mode.label}・${pos.name}`);
            const r = await engine.analyze(pos.position, { movetimeMs: mode.movetimeMs, multiPV: mode.multiPV });
            const nps = r.nps || Math.round((r.nodes * 1000) / Math.max(1, r.elapsedMs));
            setRows((old) => [
              ...old,
              {
                evalLabel: EVALS[evalId].label,
                threads: t,
                mode: mode.label,
                position: pos.name,
                depth: r.depth,
                nodes: r.nodes,
                nps,
                bestmove: r.bestmove,
                score: r.lines[0] ? formatScore(r.lines[0].score) : '—',
              },
            ]);
          }
        }
      }
      // 測り終わったら、選んでいたスレッド数に戻す
      await engineRef.current?.engine.reconfigure({ threads, hashMB });
      setStatus('測定おわり。「結果をコピー」で送ってください');
    });

  /** 複数のエンジンを同時に動かして、別々の局面を調べる（合計のスレッド数は同じにして比べる） */
  const runParallel = () =>
    run(async () => {
      setParallelRows([]);
      // 1 つ目のエンジンは閉じて、メモリを空けておく
      engineRef.current?.engine.close();
      engineRef.current = null;
      for (const plan of parallelPlans()) {
        const label = `${plan.engines} エンジン × ${plan.threads} スレッド`;
        const engines: UsiEngine[] = [];
        try {
          for (let i = 0; i < plan.engines; i++) {
            setStatus(`並列の測定：${label}（エンジン ${i + 1} を準備中）`);
            const created = await createYaneuraOu(evalId, { threads: plan.threads, hashMB: 16 });
            engines.push(created.engine);
          }
          setStatus(`並列の測定：${label}（${PARALLEL_MS / 1000} 秒）`);
          const results = await Promise.all(
            engines.map((e, i) =>
              e.analyze(BENCH_POSITIONS[(i + 1) % BENCH_POSITIONS.length].position, { movetimeMs: PARALLEL_MS, multiPV: 1 }),
            ),
          );
          const totalNps = results.reduce((sum, r) => sum + (r.nps || Math.round((r.nodes * 1000) / Math.max(1, r.elapsedMs))), 0);
          const depth = results.reduce((sum, r) => sum + r.depth, 0) / results.length;
          setParallelRows((old) => [...old, { label, ok: true, totalNps, depth }]);
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          setParallelRows((old) => [...old, { label, ok: false, totalNps: 0, depth: 0, message }]);
        } finally {
          for (const e of engines) e.close();
        }
      }
      setStatus('並列の測定おわり。「結果をコピー」で送ってください');
    });

  const summary = () =>
    [
      `序盤ツリー v${APP_VERSION}（エンジン ${ENGINE_ID}）`,
      `端末: ${navigator.userAgent}`,
      `CPU数: ${navigator.hardwareConcurrency ?? '?'}／isolated: ${self.crossOriginIsolated}／ハッシュ: ${hashMB}MB`,
      timings
        ? `読み込み: エンジン ${timings.moduleMs}ms／評価関数 ${timings.evalMs}ms／isready ${timings.isreadyMs}ms`
        : '',
      check ? `動作確認: ${check}` : '',
      ...rows.map(
        (r) =>
          `${r.evalLabel} ${r.threads}T ${r.mode} ${r.position}: 深さ ${r.depth}／${r.nps.toLocaleString()} nps／${r.bestmove} ${r.score}`,
      ),
      ...parallelRows.map((r) =>
        r.ok
          ? `並列 ${r.label}: 合計 ${r.totalNps.toLocaleString()} nps／平均深さ ${r.depth.toFixed(1)}`
          : `並列 ${r.label}: 失敗（${r.message}）`,
      ),
      error ? `エラー: ${error}` : '',
    ]
      .filter(Boolean)
      .join('\n');

  async function copy() {
    const text = summary();
    try {
      await navigator.clipboard.writeText(text);
      setStatus('コピーしました');
    } catch {
      setStatus('コピーできませんでした。下の枠の文字を長押しで選んでコピーしてください');
    }
  }

  const ready = isolation === 'isolated';

  return (
    <div class="app">
      <main class="main">
        <h1>エンジンの速度測定</h1>

        <div class="card">
          <h2>この端末</h2>
          <p class="num" data-testid="env">
            cross-origin isolated：<b class={ready ? 'status-ok' : 'status-ng'}>{isolationLabel(isolation)}</b>
            <br />
            CPU 数（ブラウザの申告）：{navigator.hardwareConcurrency ?? '不明'}
            <br />
            エンジン：{ENGINE_ID}
          </p>
        </div>

        <div class="card">
          <h2>設定</h2>
          <div class="btn-row">
            <label class="field">
              評価関数
              <select value={evalId} disabled={busy} onChange={(e) => setEvalId(e.currentTarget.value as EvalId)}>
                {Object.values(EVALS).map((ev) => (
                  <option value={ev.id}>
                    {ev.label}（約{ev.approxMB}MB）
                  </option>
                ))}
              </select>
            </label>
            <label class="field">
              ハッシュ
              <select value={hashMB} disabled={busy} onChange={(e) => setHashMB(Number(e.currentTarget.value))}>
                {HASH_CHOICES.map((mb) => (
                  <option value={mb}>{mb}MB</option>
                ))}
              </select>
            </label>
            {threadChoices().length > 1 && (
              <label class="field">
                スレッド
                <select value={threads} disabled={busy} onChange={(e) => setThreads(Number(e.currentTarget.value))}>
                  {threadChoices().map((n) => (
                    <option value={n}>{n}</option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <div class="btn-row">
            <button class="btn btn-primary" disabled={!ready || busy} onClick={runCheck} data-testid="run-check">
              動作確認（初期局面を 0.5 秒）
            </button>
            <button class="btn" disabled={!ready || busy} onClick={runBench} data-testid="run-bench">
              速度測定（約 1 分）
            </button>
            {parallelPlans().length > 0 && (
              <button class="btn" disabled={!ready || busy} onClick={runParallel} data-testid="run-parallel">
                並列の測定（約 1 分）
              </button>
            )}
          </div>
          <p class="muted" data-testid="status">
            {status}
          </p>
          {error && (
            <p class="status-ng" data-testid="error">
              {error}
            </p>
          )}
          {check && (
            <p class="num" data-testid="check-result">
              {check}
            </p>
          )}
          {timings && (
            <p class="muted num">
              読み込み：エンジン {timings.moduleMs}ms／評価関数 {timings.evalMs}ms（
              {(timings.evalBytes / 1e6).toFixed(1)}MB）／isready {timings.isreadyMs}ms
            </p>
          )}
        </div>

        {rows.length > 0 && (
          <div class="card">
            <h2>結果</h2>
            <div class="table-wrap">
              <table class="bench-table num">
                <thead>
                  <tr>
                    <th>スレッド</th>
                    <th>条件</th>
                    <th>局面</th>
                    <th>深さ</th>
                    <th>局面/秒</th>
                    <th>最善手</th>
                    <th>評価値</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr>
                      <td>{r.threads}</td>
                      <td>{r.mode}</td>
                      <td>{r.position}</td>
                      <td>{r.depth}</td>
                      <td>{r.nps.toLocaleString()}</td>
                      <td>{r.bestmove}</td>
                      <td>{r.score}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p class="muted">評価値は手番側から見た値です。</p>
          </div>
        )}

        {parallelRows.length > 0 && (
          <div class="card">
            <h2>並列の測定</h2>
            <p class="muted">エンジンを同時に動かし、別々の局面を {PARALLEL_MS / 1000} 秒ずつ調べたときの合計の速さ。</p>
            <div class="table-wrap">
              <table class="bench-table num" data-testid="parallel-table">
                <thead>
                  <tr>
                    <th>組み合わせ</th>
                    <th>合計 局面/秒</th>
                    <th>平均深さ</th>
                  </tr>
                </thead>
                <tbody>
                  {parallelRows.map((r) => (
                    <tr>
                      <td>{r.label}</td>
                      <td>{r.ok ? r.totalNps.toLocaleString() : `失敗：${r.message}`}</td>
                      <td>{r.ok ? r.depth.toFixed(1) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div class="card">
          <div class="btn-row">
            <button class="btn" onClick={copy}>
              結果をコピー
            </button>
          </div>
          <textarea class="summary" readOnly value={summary()} />
        </div>

        <details class="card">
          <summary>エンジンの出力（最新 200 行）</summary>
          <pre class="log">{log.join('\n')}</pre>
        </details>
      </main>
      <Footer />
    </div>
  );
}

function isolationLabel(state: IsolationState | 'checking'): string {
  switch (state) {
    case 'checking':
      return '確認中…';
    case 'isolated':
      return 'OK';
    case 'reloading':
      return '再読み込みします…';
    case 'no-service-worker':
      return 'NG（service worker 非対応）';
    case 'failed':
      return 'NG（開き直してください）';
  }
}

render(<Bench />, document.getElementById('root')!);
