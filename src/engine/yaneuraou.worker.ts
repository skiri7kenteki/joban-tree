// やねうら王（WASM 版）を動かす Web Worker。
// 画面の処理（メインスレッド）とは別のスレッドで動くので、エンジンが重くても画面は固まらない。
//
// 「classic worker」として動かし、importScripts でエンジンの JS を読み込む
// （エンジンの JS は ES モジュールではなく、グローバル関数を作る形式のため）。
// このファイルでは import を使わない（classic worker では使えないため）。
//
// メインスレッドとのやり取り：
//   受け取る：{ type: 'init', ... } … エンジンと評価関数を読み込む
//             { type: 'cmd', line } … USI コマンドを 1 行送る
//   送り出す：{ type: 'status', text } … 読み込みの進み具合
//             { type: 'ready', timings } … 準備完了（この後 usi などを送れる）
//             { type: 'line', line } … エンジンが出力した 1 行
//             { type: 'error', message } … 失敗

declare function importScripts(...urls: string[]): void;

interface EngineModule {
  FS: {
    mkdir(path: string): void;
    writeFile(path: string, data: Uint8Array): void;
  };
  addMessageListener(listener: (line: string) => void): void;
  postMessage(command: string): void;
  terminate(): void;
}

type EngineFactory = (options: Record<string, unknown>) => Promise<EngineModule>;

interface InitMessage {
  type: 'init';
  engineJs: string;
  engineDir: string;
  exportName: string;
  nn: string;
  progress: string;
}

interface CmdMessage {
  type: 'cmd';
  line: string;
}

// Worker の中の self（型は最低限だけ書く）
const ctx = self as unknown as {
  postMessage(message: unknown): void;
  onmessage: ((event: MessageEvent<InitMessage | CmdMessage>) => void) | null;
  [name: string]: unknown;
};

let engine: EngineModule | null = null;
/** 準備完了より前に届いたコマンド（順番を守って後で送る） */
const pending: string[] = [];

ctx.onmessage = (event) => {
  const msg = event.data;
  if (msg.type === 'init') {
    init(msg).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      ctx.postMessage({ type: 'error', message });
    });
  } else if (msg.type === 'cmd') {
    if (engine) engine.postMessage(msg.line);
    else pending.push(msg.line);
  }
};

function reportStatus(text: string): void {
  ctx.postMessage({ type: 'status', text });
}

/** ファイルを読み込む（service worker が端末に保存していれば、そこから読む） */
async function fetchBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} を読み込めませんでした（${response.status}）`);
  return new Uint8Array(await response.arrayBuffer());
}

async function init(msg: InitMessage): Promise<void> {
  if (typeof SharedArrayBuffer === 'undefined') {
    throw new Error('この画面では SharedArrayBuffer が使えません（cross-origin isolated になっていません）');
  }
  const t0 = performance.now();

  // 評価関数のダウンロードは、エンジンの読み込みと同時に始めておく
  reportStatus('評価関数を読み込み中');
  const evalFiles = Promise.all([fetchBytes(msg.nn), fetchBytes(msg.progress)]);

  reportStatus('エンジンを読み込み中');
  importScripts(msg.engineJs);
  const factory = ctx[msg.exportName] as EngineFactory | undefined;
  if (typeof factory !== 'function') throw new Error(`エンジンの関数 ${msg.exportName} が見つかりません`);

  const module = await factory({
    // .wasm と .worker.js の場所
    locateFile: (path: string) => msg.engineDir + path,
    // エンジン内部のスレッド（さらに別の Worker）が読み込む JS の場所
    mainScriptUrlOrBlob: msg.engineJs,
  });
  const tModule = performance.now();

  const [nn, progress] = await evalFiles;
  const tEval = performance.now();

  // 評価関数を仮想ファイルシステムの /eval/ に置く（EvalDir=eval で読まれる）
  module.FS.mkdir('/eval');
  module.FS.writeFile('/eval/nn.bin', nn);
  module.FS.writeFile('/eval/progress.bin', progress);

  module.addMessageListener((line) => ctx.postMessage({ type: 'line', line }));
  engine = module;
  for (const line of pending.splice(0)) engine.postMessage(line);

  ctx.postMessage({
    type: 'ready',
    timings: {
      moduleMs: Math.round(tModule - t0),
      evalMs: Math.round(tEval - t0),
      evalBytes: nn.byteLength + progress.byteLength,
    },
  });
}
