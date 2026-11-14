// エンジンを包むモジュール。
// - USI コマンドの送受信をまとめ、「1 つ終わってから次」と順番待ちさせる
// - analyze() で「この局面を T ミリ秒、N 候補で調べて」を 1 回の呼び出しにする
//
// ツリー生成のロジックは、このファイルの AnalysisEngine（型）だけを使う。
// そうしておくと、テストでは偽物のエンジン（モック）に差し替えられ、
// 将来、別のエンジン（PC の AobaNNUE など）も足せる。

import { MultiPvCollector, parseBestmove, parseInfo, type InfoLine, type PvLine } from './usi';
import { EVALS, engineUrls, type EvalId } from './config';

/** 1 回の探索の指定 */
export interface AnalyzeOptions {
  /** 探索時間（ミリ秒） */
  movetimeMs: number;
  /** 候補手の数（MultiPV） */
  multiPV: number;
  /** info 行が届くたびに呼ばれる（進み具合の表示用） */
  onInfo?: (info: InfoLine) => void;
}

/** 1 回の探索の結果 */
export interface AnalysisResult {
  bestmove: string;
  ponder?: string;
  /** 候補ごとの最後の読み筋（multipv 順）。評価値は手番側から見た値 */
  lines: PvLine[];
  depth: number;
  nodes: number;
  nps: number;
  elapsedMs: number;
}

/** ツリー生成から見た「エンジン」 */
export interface AnalysisEngine {
  /**
   * 局面を調べる。
   * @param position USI の position コマンドの後ろの部分（例：`startpos moves 7g7f` / `sfen ... moves ...`）
   */
  analyze(position: string, options: AnalyzeOptions): Promise<AnalysisResult>;
  /** 探索中なら止める（analyze はそこまでの結果で終わる） */
  stop(): void;
}

/** エンジン本体との行のやり取り（Worker でもテスト用の偽物でもよい） */
export interface LineTransport {
  send(line: string): void;
  onLine(listener: (line: string) => void): void;
  /** エンジンが思いがけず終わったとき（PC 版で黒い画面を閉じたときなど）に呼んでもらう。無くてもよい */
  onClose?(listener: (reason: string) => void): void;
  close(): void;
}

/** エンジンの設定 */
export interface EngineSettings {
  threads: number;
  hashMB: number;
}

export interface EngineTimings {
  moduleMs: number;
  evalMs: number;
  evalBytes: number;
  isreadyMs: number;
}

/** USI でエンジンとやり取りする本体（AnalysisEngine の実装） */
export class UsiEngine implements AnalysisEngine {
  /** 順番待ちの最後尾（前のコマンドが終わってから次を始める） */
  private queue: Promise<unknown> = Promise.resolve();
  private readonly waiters: { test: (line: string) => boolean; resolve: (line: string) => void; reject: (error: Error) => void }[] = [];
  private lineListeners: ((line: string) => void)[] = [];
  /** エンジンが終わっていたら、その理由 */
  private dead: Error | null = null;
  private deadListeners: ((error: Error) => void)[] = [];

  constructor(private readonly transport: LineTransport) {
    transport.onLine((line) => this.receive(line));
    transport.onClose?.((reason) => this.fail(new Error(reason)));
  }

  /** エンジンが終わった。待っている処理はすべて失敗にする（止まったままにしない） */
  private fail(error: Error): void {
    if (this.dead) return;
    this.dead = error;
    for (const w of this.waiters.splice(0)) w.reject(error);
    for (const l of this.deadListeners) l(error);
  }

  /** エンジンが思いがけず終わったときに呼ばれる */
  onDead(listener: (error: Error) => void): void {
    if (this.dead) listener(this.dead);
    else this.deadListeners.push(listener);
  }

  /** 生の出力を見たいとき用（速度測定ページのログ表示など） */
  addLineListener(listener: (line: string) => void): void {
    this.lineListeners.push(listener);
  }

  private receive(line: string): void {
    for (const l of this.lineListeners) l(line);
    for (const w of [...this.waiters]) {
      if (w.test(line)) {
        this.waiters.splice(this.waiters.indexOf(w), 1);
        w.resolve(line);
      }
    }
  }

  private waitFor(test: (line: string) => boolean): Promise<string> {
    if (this.dead) return Promise.reject(this.dead);
    return new Promise((resolve, reject) => this.waiters.push({ test, resolve, reject }));
  }

  /** 順番待ちに仕事を入れる */
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const guarded = () => (this.dead ? Promise.reject(this.dead) : task());
    const run = this.queue.then(guarded, guarded);
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** usi → setoption → isready。かかった時間（ミリ秒）を返す */
  start(settings: EngineSettings): Promise<number> {
    return this.enqueue(async () => {
      this.transport.send('usi');
      await this.waitFor((l) => l === 'usiok');
      this.sendHashAndThreads(settings);
      this.transport.send('setoption name EvalDir value eval');
      this.transport.send('setoption name FV_SCALE value 24');
      // 定跡は使わない（研究したい局面そのものを調べるため）
      this.transport.send('setoption name BookFile value no_book');
      const t0 = performance.now();
      this.transport.send('isready');
      await this.waitFor((l) => l === 'readyok');
      this.transport.send('usinewgame');
      return Math.round(performance.now() - t0);
    });
  }

  /** スレッド数などを変える（isready まで待つ） */
  reconfigure(settings: EngineSettings): Promise<void> {
    return this.enqueue(async () => {
      this.sendHashAndThreads(settings);
      this.transport.send('isready');
      await this.waitFor((l) => l === 'readyok');
    });
  }

  /**
   * ハッシュの大きさとスレッド数を送る。**必ず USI_Hash が先**。
   * やねうら王は Threads を変えるとその時点の USI_Hash（初期値 1024MB）で置換表を作り直すが、
   * WASM 版はメモリの上限を 1GB にしているので、先に Threads を送ると確保に失敗してエンジンが終了する
   * （GitHub Actions の単体確認で実際に起きた）。
   */
  private sendHashAndThreads(settings: EngineSettings): void {
    this.transport.send(`setoption name USI_Hash value ${settings.hashMB}`);
    this.transport.send(`setoption name Threads value ${settings.threads}`);
  }

  analyze(position: string, options: AnalyzeOptions): Promise<AnalysisResult> {
    return this.enqueue(async () => {
      const collector = new MultiPvCollector();
      const onLine = (line: string) => {
        const info = parseInfo(line);
        if (!info) return;
        collector.add(info);
        options.onInfo?.(info);
      };
      this.lineListeners.push(onLine);
      try {
        this.transport.send(`setoption name MultiPV value ${options.multiPV}`);
        this.transport.send(`position ${position}`);
        const t0 = performance.now();
        this.transport.send(`go movetime ${options.movetimeMs}`);
        const line = await this.waitFor((l) => l.startsWith('bestmove'));
        const elapsedMs = performance.now() - t0;
        const best = parseBestmove(line) ?? { move: 'resign' };
        return {
          bestmove: best.move,
          ponder: best.ponder,
          lines: collector.lines(),
          depth: collector.depth,
          nodes: collector.nodes,
          nps: collector.nps,
          elapsedMs: Math.round(elapsedMs),
        };
      } finally {
        this.lineListeners = this.lineListeners.filter((l) => l !== onLine);
      }
    });
  }

  stop(): void {
    // 順番待ちに入れずにすぐ送る（探索中の go を止めるため）
    this.transport.send('stop');
  }

  close(): void {
    this.transport.close();
  }
}

/** Web Worker の中のやねうら王とやり取りする LineTransport */
class WorkerTransport implements LineTransport {
  private listener: (line: string) => void = () => undefined;
  constructor(private readonly worker: Worker) {}
  send(line: string): void {
    this.worker.postMessage({ type: 'cmd', line });
  }
  onLine(listener: (line: string) => void): void {
    this.listener = listener;
  }
  deliver(line: string): void {
    this.listener(line);
  }
  close(): void {
    this.worker.terminate();
  }
}

/**
 * やねうら王を Web Worker で起動し、usi〜isready まで済ませた UsiEngine を返す。
 * @param onStatus 読み込みの進み具合（画面表示用）
 */
export async function createYaneuraOu(
  evalId: EvalId,
  settings: EngineSettings,
  onStatus: (text: string) => void = () => undefined,
): Promise<{ engine: UsiEngine; timings: EngineTimings }> {
  const urls = engineUrls(evalId);
  const worker = new Worker(new URL('./yaneuraou.worker.ts', import.meta.url));
  const transport = new WorkerTransport(worker);

  const loaded = new Promise<Omit<EngineTimings, 'isreadyMs'>>((resolve, reject) => {
    worker.onmessage = (event: MessageEvent) => {
      const msg = event.data as { type: string; text?: string; line?: string; message?: string; timings?: Omit<EngineTimings, 'isreadyMs'> };
      if (msg.type === 'line' && msg.line !== undefined) transport.deliver(msg.line);
      else if (msg.type === 'status' && msg.text) onStatus(msg.text);
      else if (msg.type === 'ready' && msg.timings) resolve(msg.timings);
      else if (msg.type === 'error') reject(new Error(msg.message ?? 'エンジンの読み込みに失敗しました'));
    };
    worker.onerror = (event) => reject(new Error(event.message || 'エンジンの Worker でエラーが起きました'));
  });

  worker.postMessage({
    type: 'init',
    engineJs: urls.engineJs,
    engineDir: urls.engineDir,
    exportName: EVALS[evalId].exportName,
    nn: urls.nn,
    progress: urls.progress,
  });

  const engine = new UsiEngine(transport);
  try {
    const t = await loaded;
    onStatus('評価関数を準備中（isready）');
    const isreadyMs = await engine.start(settings);
    return { engine, timings: { ...t, isreadyMs } };
  } catch (error) {
    worker.terminate();
    throw error;
  }
}
