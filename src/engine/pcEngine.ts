// PC 版：pc/server.mjs（start.bat で起動）が動かす Windows 版のやねうら王とやり取りする。
// 画面が http://localhost:<ポート>/joban-tree/ で開かれていて、サーバーが答えたときだけ使う。
// やり取りは USI の行のまま（UsiEngine をそのまま使う）。
//   送る：POST pc-api/send（何行かまとめて）
//   受け取る：GET pc-api/events（エンジンの出力が 1 行ずつ流れてくる）

import { UsiEngine, type EngineSettings, type LineTransport } from './engine';
import type { EvalId } from './config';

/** PC のサーバーの情報 */
export interface PcInfo {
  /** 論理プロセッサの数（スレッド数の上限の目安） */
  cpus: number;
  cpuName: string;
  totalMemMB: number;
}

/** サーバーへの合図（よそのサイトのページからは付けられないヘッダ。pc/server.mjs が確かめる） */
const HEADERS = { 'x-joban-tree': '1' };

const apiUrl = (name: string) => new URL(`${import.meta.env.BASE_URL}pc-api/${name}`, location.href).href;

/** この PC のサーバーから開いているか（localhost のときだけ問い合わせる） */
export async function detectPcEngine(): Promise<PcInfo | null> {
  if (location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return null;
  try {
    const res = await fetch(apiUrl('info'), { headers: HEADERS, cache: 'no-store', signal: AbortSignal.timeout(3000) });
    if (!res.ok) return null;
    const info = (await res.json()) as Partial<PcInfo> & { app?: string };
    if (info.app !== 'joban-tree-pc') return null;
    return { cpus: Math.max(1, Number(info.cpus) || 1), cpuName: String(info.cpuName ?? ''), totalMemMB: Number(info.totalMemMB) || 0 };
  } catch {
    return null;
  }
}

async function post(name: string, body: unknown): Promise<Response> {
  const res = await fetch(apiUrl(name), {
    method: 'POST',
    headers: { ...HEADERS, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(detail.error ?? `PC のサーバーがエラーを返しました（${res.status}）`);
  }
  return res;
}

/** PC のサーバー経由で USI の行をやり取りする */
class PcTransport implements LineTransport {
  private lineListener: (line: string) => void = () => undefined;
  private closeListener: (reason: string) => void = () => undefined;
  /** まだ送っていない行（同じタイミングで送られた行は 1 回にまとめる） */
  private pending: string[] = [];
  /** 送る順番を守るための鎖 */
  private chain: Promise<unknown> = Promise.resolve();
  private readonly abort = new AbortController();
  private closed = false;

  constructor(private readonly session: number) {}

  /** エンジンの出力を読み続ける（終わったら closeListener） */
  async listen(): Promise<void> {
    let reason = 'PC のエンジンが終了しました。start.bat の黒い画面が閉じられていないか確かめてください';
    try {
      const res = await fetch(`${apiUrl('events')}?session=${this.session}`, { headers: HEADERS, cache: 'no-store', signal: this.abort.signal });
      if (!res.ok || !res.body) throw new Error();
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let rest = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        const parts = (rest + value).split('\n');
        rest = parts.pop() ?? '';
        for (const line of parts) this.lineListener(line);
      }
    } catch {
      reason = 'PC のサーバーとのつながりが切れました。start.bat の黒い画面が閉じられていないか確かめてください';
    }
    if (!this.closed) {
      this.closed = true;
      this.closeListener(reason);
    }
  }

  send(line: string): void {
    if (this.closed) return;
    this.pending.push(line);
    if (this.pending.length > 1) return;
    // 同じタイミングで送られた行（setoption を何行かなど）を 1 回の POST にまとめる
    queueMicrotask(() => {
      const lines = this.pending.splice(0);
      this.chain = this.chain
        .then(() => post('send', { session: this.session, lines }))
        .catch((error: unknown) => {
          if (this.closed) return;
          this.closed = true;
          this.abort.abort();
          this.closeListener(error instanceof Error ? error.message : String(error));
        });
    });
  }

  onLine(listener: (line: string) => void): void {
    this.lineListener = listener;
  }

  onClose(listener: (reason: string) => void): void {
    this.closeListener = listener;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.abort.abort();
    void post('close', { session: this.session }).catch(() => undefined);
  }
}

/**
 * PC のエンジンを起動し、usi〜isready まで済ませた UsiEngine を返す。
 * 初回は、サーバーがエンジンと評価関数を PC にダウンロードする（数十秒かかることがある）。
 */
export async function createPcEngine(evalId: EvalId, settings: EngineSettings, onStatus: (text: string) => void = () => undefined): Promise<UsiEngine> {
  onStatus('PC のエンジンを起動中（初回はダウンロードがあります）');
  const res = await post('start', { evalId });
  const { session } = (await res.json()) as { session: number };
  const transport = new PcTransport(session);
  const engine = new UsiEngine(transport);
  void transport.listen();
  try {
    onStatus('評価関数を準備中（isready）');
    await engine.start(settings);
    return engine;
  } catch (error) {
    transport.close();
    throw error;
  }
}
