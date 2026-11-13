// テスト用の偽物のエンジン（モック）と、ツリーを作る小道具
import type { AnalysisEngine, AnalysisResult, AnalyzeOptions } from '../../src/engine/engine';
import type { PvLine, Score } from '../../src/engine/usi';
import { STARTPOS_SFEN, applyUsiMove, sfenKey } from '../../src/shogi/position';
import { createTree } from '../../src/tree/generator';
import type { GenerationSettings, TreeData } from '../../src/tree/types';

/** 手順を指した後の局面のキー */
export function keyAfter(...moves: string[]): string {
  let sfen = STARTPOS_SFEN;
  for (const m of moves) sfen = applyUsiMove(sfen, m)!.sfen;
  return sfenKey(sfen);
}

export const cp = (value: number): Score => ({ kind: 'cp', value });

/** 台本に書く読み筋（depth は省略できる） */
export type ScriptLine = Omit<PvLine, 'depth'>;

/** 偽物のエンジン：局面ごとに決めた答えを返す。決めていない局面は、合法な手から機械的に答えを作る */
export class MockEngine implements AnalysisEngine {
  readonly calls: { key: string; options: AnalyzeOptions }[] = [];
  stopCount = 0;
  constructor(
    private readonly script: Record<string, ScriptLine[]> = {},
    private readonly hooks: { onAnalyze?: (call: number) => void } = {},
  ) {}

  async analyze(position: string, options: AnalyzeOptions): Promise<AnalysisResult> {
    const sfen = position.replace(/^sfen /, '');
    const key = sfenKey(sfen);
    this.calls.push({ key, options });
    this.hooks.onAnalyze?.(this.calls.length);
    const lines: PvLine[] = (this.script[key] ?? genericLines(sfen, options.multiPV))
      .slice(0, options.multiPV)
      .map((l) => ({ ...l, depth: 10 }));
    return {
      bestmove: lines[0]?.pv[0] ?? 'resign',
      lines,
      depth: 10,
      nodes: 1000,
      nps: 100000,
      elapsedMs: options.movetimeMs,
    };
  }
  stop(): void {
    this.stopCount++;
  }
}

/** 決めていない局面用：よくある手から合法なものを選び、評価値を 20 ずつ下げて並べる */
const COMMON_MOVES = ['7g7f', '2g2f', '5g5f', '6g6f', '3c3d', '8c8d', '4c4d', '6c6d', '1g1f', '9c9d', '1c1d', '9g9f', '4g4f', '5c5d'];
function genericLines(sfen: string, n: number): ScriptLine[] {
  const lines: ScriptLine[] = [];
  for (const move of COMMON_MOVES) {
    if (lines.length >= n) break;
    const after = applyUsiMove(sfen, move);
    if (!after) continue;
    const reply = COMMON_MOVES.find((m) => applyUsiMove(after.sfen, m));
    lines.push({ multipv: lines.length + 1, score: cp(-lines.length * 20), pv: reply ? [move, reply] : [move] });
  }
  return lines;
}

export const SETTINGS: GenerationSettings = {
  totalMs: 60_000,
  movetimeMs: 400,
  multiPV: 3,
  maxRounds: 3,
  maxNodes: 3000,
  windowCp: 300,
};

export function newTree(mySide: 'black' | 'white' = 'white', rootSfen = STARTPOS_SFEN, settings = SETTINGS): TreeData {
  return createTree({
    id: 't1',
    name: 'テスト',
    rootSfen,
    mySide,
    prefix: { initialSfen: rootSfen, moves: [] },
    settings,
    now: 0,
  });
}
