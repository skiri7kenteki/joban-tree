// 同梱ツリーを作る本体（画面・ファイル・エンジンの起動はしない。テストでは偽物のエンジンを渡す）。
//
//   1. アプリと同じ TreeGenerator で、保存してあるツリーの「まだ調べていない局面」から続ける
//   2. 深さの上限まで作り終わったら、自分の局面に「調べて確定した手」が無いものが残っていないか点検し、
//      残っていればその局面を調べて確定させ、その先をまた作る（無くなるまで）
//   3. 1 局面調べるたびに save() を呼ぶ（途中で止まっても、そこから続けられる）

import type { AnalysisEngine, AnalysisResult, AnalyzeOptions } from '../../src/engine/engine';
import { unsearchedOpponent, unverifiedMine } from '../../src/tree/bundled';
import { TreeGenerator } from '../../src/tree/generator';
import type { BakeState } from './state';

export type BakeResult = { kind: 'completed' } | { kind: 'stopped' } | { kind: 'error'; message: string };

/** 1 局面を調べるのにかかった時間を記録するエンジンの包み */
class TimedEngine implements AnalysisEngine {
  constructor(
    private readonly inner: AnalysisEngine,
    private readonly state: BakeState,
    private readonly now: () => number,
  ) {}

  async analyze(position: string, options: AnalyzeOptions): Promise<AnalysisResult> {
    const t0 = this.now();
    const result = await this.inner.analyze(position, options);
    const ms = this.now() - t0;
    const t = this.state.timings;
    if (options.multiPV > 1) {
      t.oppMs += ms;
      t.oppCount++;
    } else {
      t.mineMs += ms;
      t.mineCount++;
    }
    return result;
  }

  stop(): void {
    this.inner.stop();
  }
}

export class Baker {
  private generator: TreeGenerator | null = null;
  private stopped = false;
  private readonly now: () => number;

  constructor(
    private readonly engine: AnalysisEngine,
    private readonly state: BakeState,
    private readonly hooks: {
      /** 途中経過を保存する（1 局面調べるたび） */
      save: () => void;
      /** 1 局面調べるたび（保存の後） */
      onSearched?: () => void;
      /** 点検で確定していない自分の手が見つかったとき */
      onSweep?: (count: number) => void;
      now?: () => number;
    },
  ) {
    this.now = hooks.now ?? Date.now;
  }

  /** 途中で止める（調べている 1 局面はそこまでの結果を使ってから止まる） */
  stop(): void {
    this.stopped = true;
    this.generator?.stop();
  }

  async run(): Promise<BakeResult> {
    const { state } = this;
    const { maxRounds } = state.settings;
    const sessionStart = this.now();
    const baseElapsed = state.elapsedMs;
    state.sessions++;
    const timed = new TimedEngine(this.engine, state, this.now);
    const generator = new TreeGenerator(timed, state.tree, state.settings, {
      now: this.now,
      onChange: () => {
        state.searched++;
        state.elapsedMs = baseElapsed + (this.now() - sessionStart);
        this.hooks.save();
        this.hooks.onSearched?.();
      },
    });
    this.generator = generator;
    if (this.stopped) generator.stop();

    for (let pass = 0; pass < 10; pass++) {
      const reason = await generator.run(state.tree.rootKey);
      if (reason === 'stopped' || this.stopped) return { kind: 'stopped' };
      if (reason === 'error') return { kind: 'error', message: generator.errorMessage };
      if (reason !== 'completed') return { kind: 'error', message: `生成が途中で終わりました（${reason}）` };

      const mine = unverifiedMine(state.tree, maxRounds);
      if (mine.length === 0 && unsearchedOpponent(state.tree, maxRounds).length === 0) {
        state.finishedAt = this.now();
        state.elapsedMs = baseElapsed + (this.now() - sessionStart);
        this.hooks.save();
        return { kind: 'completed' };
      }
      // 自分の手が確定していない局面を調べて確定させる（その先は次の run で作る）
      this.hooks.onSweep?.(mine.length);
      for (const node of mine) {
        if (this.stopped) return { kind: 'stopped' };
        const r = await generator.verify(node.key, state.settings.replyMs || state.settings.movetimeMs);
        if (r === 'error') return { kind: 'error', message: generator.errorMessage };
      }
    }
    return { kind: 'error', message: '点検をくり返しても、確定していない自分の手が残りました' };
  }
}
