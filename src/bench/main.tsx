// 段階0：エンジンの動作確認と速度測定のページ。
// 持ち主がスマホ・iPad で開き、表示された数値を「結果をコピー」で報告する。
import { render } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import '../styles/base.css';
import './bench.css';
import { APP_VERSION, Footer } from '../components/Footer';
import { ensureCrossOriginIsolated, type IsolationState } from '../isolation';
import { ENGINE_ID, EVALS, pruneOldBigFiles, type EvalId } from '../engine/config';
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

/** 測定の種類：プリセット「さっと」に近い条件も測っておく（プリセット見直しの材料） */
const MODES = [
  { label: 'MultiPV1・500ms', multiPV: 1, movetimeMs: 500 },
  { label: 'MultiPV3・400ms', multiPV: 3, movetimeMs: 400 },
];

const HASH_CHOICES = [16, 32, 64];
const MAX_THREADS = 4;

function threadChoices(): number[] {
  const hw = navigator.hardwareConcurrency || 1;
  if (!self.crossOriginIsolated) return [1];
  return [1, 2, 3, 4].filter((n) => n <= Math.min(hw, MAX_THREADS));
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
      const threadSet = [...new Set([1, list[list.length - 1]])];
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
              速度測定（約 20 秒）
            </button>
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
