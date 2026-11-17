// PC のやねうら王（Windows 版の engine.exe）を、Node.js から直接動かす。
// やり取りは USI の行のまま。アプリと同じ UsiEngine（src/engine/engine.ts）に、この「行の受け渡し」をつなぐ。

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { UsiEngine, type EngineSettings, type LineTransport } from '../../src/engine/engine';

export class ChildTransport implements LineTransport {
  private lineListener: (line: string) => void = () => undefined;
  private closeListener: (reason: string) => void = () => undefined;
  private closed = false;
  /** エンジンが名乗った名前（id name） */
  engineName = '';

  constructor(private readonly child: ChildProcessWithoutNullStreams) {
    let rest = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      const parts = (rest + chunk).split('\n');
      rest = parts.pop() ?? '';
      for (const raw of parts) {
        const line = raw.replace(/\r$/, '');
        if (line.startsWith('id name ')) this.engineName = line.slice('id name '.length).trim();
        this.lineListener(line);
      }
    });
    child.stderr.on('data', () => undefined);
    child.on('error', (error) => this.finish(`エンジンを起動できません：${error.message}`));
    child.on('exit', (code) => this.finish(`エンジンが終了しました（${code ?? '強制終了'}）`));
  }

  private finish(reason: string): void {
    if (this.closed) return;
    this.closed = true;
    this.closeListener(reason);
  }

  send(line: string): void {
    if (this.closed) return;
    this.child.stdin.write(`${line}\n`);
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
    try {
      this.child.stdin.write('quit\n');
    } catch {
      // すでに終わっている
    }
    setTimeout(() => this.child.kill(), 1000).unref();
  }
}

/** engine.exe を起動し、usi〜isready まで済ませる */
export async function startNativeEngine(exe: string, settings: EngineSettings): Promise<{ engine: UsiEngine; transport: ChildTransport }> {
  const child = spawn(exe, [], { cwd: path.dirname(exe), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  try {
    // ほかの作業の邪魔をしないよう、優先度を少し下げる（PC 版のサーバーと同じ）
    os.setPriority(child.pid!, os.constants.priority.PRIORITY_BELOW_NORMAL);
  } catch {
    // 下げられなくても動く
  }
  const transport = new ChildTransport(child);
  const engine = new UsiEngine(transport);
  try {
    await engine.start(settings);
  } catch (error) {
    transport.close();
    throw error;
  }
  return { engine, transport };
}
