// エンジンを包むモジュール（UsiEngine）を、偽物のエンジンで確かめる
import { describe, expect, it } from 'vitest';
import { UsiEngine, type LineTransport } from '../../src/engine/engine';

/** USI コマンドに決まった返事をする偽物のエンジン */
class FakeEngine implements LineTransport {
  readonly received: string[] = [];
  private listener: (line: string) => void = () => undefined;
  private multiPV = 1;

  send(line: string): void {
    this.received.push(line);
    const reply = (l: string) => setTimeout(() => this.listener(l), 1);
    if (line === 'usi') {
      reply('id name Fake');
      reply('usiok');
    } else if (line === 'isready') {
      reply('readyok');
    } else if (line.startsWith('setoption name MultiPV value ')) {
      this.multiPV = Number(line.split(' ').pop());
    } else if (line.startsWith('go')) {
      for (let k = 1; k <= this.multiPV; k++) reply(`info depth 1 score cp ${100 - k} multipv ${k} pv m${k} r${k}`);
      for (let k = 1; k <= this.multiPV; k++) reply(`info depth 2 score cp ${200 - k * 10} multipv ${k} nodes 500 nps 1000 pv m${k} r${k} x${k}`);
      reply('bestmove m1 ponder r1');
    }
  }
  onLine(listener: (line: string) => void): void {
    this.listener = listener;
  }
  close(): void {}
}

describe('UsiEngine', () => {
  it('start で usi〜isready を送る（FV_SCALE=24 を含む）', async () => {
    const fake = new FakeEngine();
    const engine = new UsiEngine(fake);
    await engine.start({ threads: 1, hashMB: 32 });
    expect(fake.received).toContain('setoption name FV_SCALE value 24');
    expect(fake.received).toContain('setoption name USI_Hash value 32');
    expect(fake.received.indexOf('usi')).toBeLessThan(fake.received.indexOf('isready'));
  });

  it('analyze は各候補の最後の読み筋を返す', async () => {
    const fake = new FakeEngine();
    const engine = new UsiEngine(fake);
    await engine.start({ threads: 1, hashMB: 16 });
    const r = await engine.analyze('startpos moves 7g7f', { movetimeMs: 400, multiPV: 3 });
    expect(fake.received).toContain('position startpos moves 7g7f');
    expect(fake.received).toContain('go movetime 400');
    expect(r.bestmove).toBe('m1');
    expect(r.ponder).toBe('r1');
    expect(r.lines.map((l) => l.pv)).toEqual([
      ['m1', 'r1', 'x1'],
      ['m2', 'r2', 'x2'],
      ['m3', 'r3', 'x3'],
    ]);
    expect(r.lines.map((l) => l.score)).toEqual([
      { kind: 'cp', value: 190 },
      { kind: 'cp', value: 180 },
      { kind: 'cp', value: 170 },
    ]);
    expect(r.depth).toBe(2);
  });

  it('続けて呼んでも順番に処理する（前の bestmove を待ってから次の position を送る）', async () => {
    const fake = new FakeEngine();
    const engine = new UsiEngine(fake);
    const [a, b] = await Promise.all([
      engine.analyze('startpos', { movetimeMs: 100, multiPV: 1 }),
      engine.analyze('startpos moves 2g2f', { movetimeMs: 100, multiPV: 2 }),
    ]);
    expect(a.lines).toHaveLength(1);
    expect(b.lines).toHaveLength(2);
    const firstGo = fake.received.indexOf('go movetime 100');
    const secondPosition = fake.received.indexOf('position startpos moves 2g2f');
    expect(firstGo).toBeLessThan(secondPosition);
  });
});
