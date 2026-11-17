// 同梱ツリーを PC で作るコマンド（pc/bake/、段階6-2）のテスト。本物のエンジンの代わりに偽物（MockEngine）を使う。
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import { Baker } from '../../pc/bake/baker';
import { completedRounds, formatRough, project, roundStats, type RoundStat } from '../../pc/bake/estimate';
import { BAKE_SPECS } from '../../pc/bake/specs';
import { buildBundle, loadState, sameSettings, saveState, type BakeState } from '../../pc/bake/state';
import { checkBundledTree, unsearchedOpponent, unverifiedMine } from '../../src/tree/bundled';
import { createTree, isOpponentNode } from '../../src/tree/generator';
import { BUNDLED_TEMPLATES, templateLine } from '../../src/tree/templates';
import type { GenerationSettings } from '../../src/tree/types';
import { MockEngine } from './mock-engine';

const template = BUNDLED_TEMPLATES.find((t) => t.id === 'yokofu-33kaku-gote')!;
const SETTINGS: GenerationSettings = {
  totalMs: 30 * 24 * 3600_000,
  maxNodes: 1_000_000,
  maxRounds: 3,
  multiPV: 3,
  windowCp: 300,
  // 偽物のエンジンは候補を 20 点ずつ下げて返すので、3 番目（差 40）が疑問手になる
  dubiousCp: 30,
  movetimeMs: 500,
  replyMs: 300,
};
const ENGINE = { name: 'Mock', build: 'test', evalId: 'mini' as const, evalLabel: 'つようら王11mini', threads: 2, hashMB: 64, cpu: 'test cpu' };

function newState(settings = SETTINGS): BakeState {
  const line = templateLine(template.moves);
  if (!line.ok) throw new Error('template');
  return {
    app: 'joban-tree-bake',
    stateVersion: 1,
    specId: 'yokofu-33kaku-gote',
    trial: false,
    evalId: 'mini',
    settings,
    startedAt: 1000,
    elapsedMs: 0,
    sessions: 0,
    searched: 0,
    timings: { oppMs: 0, oppCount: 0, mineMs: 0, mineCount: 0 },
    engine: ENGINE,
    tree: createTree({
      id: 'bundled-x',
      name: template.name,
      rootSfen: line.line[line.line.length - 1].sfen,
      mySide: template.mySide,
      prefix: { initialSfen: line.line[0].sfen, moves: [...template.moves] },
      settings,
      now: 1000,
    }),
  };
}

/** 時計（呼ばれるたびに 10 ミリ秒進む） */
function clock() {
  let t = 0;
  return () => (t += 10);
}

const bundleOf = (state: BakeState) =>
  buildBundle({ state, id: 'yokofu-33kaku-gote', templateId: 'yokofu-33kaku-gote', version: 1, name: template.name, appVersion: '0.0.0' });

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe('同梱ツリーを作る（Baker）', () => {
  test('深さの上限まで作りきり、自分の手に未検証が残らない。点検にも通る', async () => {
    const state = newState();
    let saves = 0;
    const r = await new Baker(new MockEngine(), state, { save: () => saves++, now: clock() }).run();
    expect(r).toEqual({ kind: 'completed' });
    expect(state.finishedAt).toBeDefined();
    expect(unverifiedMine(state.tree, 3)).toEqual([]);
    expect(unsearchedOpponent(state.tree, 3)).toEqual([]);
    // 1 局面ごとに保存する（最後にもう 1 回）
    expect(saves).toBe(state.searched + 1);
    expect(state.timings.oppCount + state.timings.mineCount).toBe(state.searched);
    // すべての自分の局面は MultiPV 1 で調べて確定、未検証の印が無い
    for (const node of Object.values(state.tree.nodes)) {
      if (!isOpponentNode(state.tree, node) && node.edges.length > 0) expect(node.edges[0].unverified).toBeUndefined();
    }
    expect(checkBundledTree(bundleOf(state), template.moves)).toEqual([]);
  });

  test('途中で止めて、保存したファイルから続けると、止めずに作ったものと同じツリーになる', async () => {
    const whole = newState();
    await new Baker(new MockEngine(), whole, { save: () => undefined, now: clock() }).run();

    const dir = mkdtempSync(path.join(os.tmpdir(), 'joban-bake-'));
    dirs.push(dir);
    const file = path.join(dir, 'progress.json');
    // 1 回目：7 局面目を調べている途中で止める（その局面の結果は使ってから止まる）
    const first = newState();
    let baker: Baker;
    const engine1 = new MockEngine({}, { onAnalyze: (n) => n === 7 && baker.stop() });
    baker = new Baker(engine1, first, { save: () => saveState(file, first), now: clock() });
    expect(await baker.run()).toEqual({ kind: 'stopped' });
    expect(first.searched).toBe(7);
    expect(first.finishedAt).toBeUndefined();

    // 2 回目：ファイルから読み直して続ける（別の実行のつもり）
    const second = loadState(file)!;
    expect(second.searched).toBe(7);
    const engine2 = new MockEngine();
    const r = await new Baker(engine2, second, { save: () => saveState(file, second), now: clock() }).run();
    expect(r).toEqual({ kind: 'completed' });
    // 調べ直した局面は無い（1 回目に調べた局面は 2 回目に調べない）
    const firstKeys = new Set(engine1.calls.map((c) => c.key));
    expect(engine2.calls.some((c) => firstKeys.has(c.key))).toBe(false);
    expect(second.searched).toBe(whole.searched);
    expect(second.sessions).toBe(2);
    expect(Object.keys(second.tree.nodes).sort()).toEqual(Object.keys(whole.tree.nodes).sort());
    for (const [key, node] of Object.entries(whole.tree.nodes)) {
      expect(second.tree.nodes[key].edges.map((e) => e.move)).toEqual(node.edges.map((e) => e.move));
    }
    // かかった時間は 2 回の合計（止まっていた間は入らない）
    expect(second.elapsedMs).toBeGreaterThan(first.elapsedMs);
    expect(checkBundledTree(bundleOf(loadState(file)!), template.moves)).toEqual([]);
  });

  test('作り終わった後に未検証の自分の手が見つかったら、調べて確定させてから終わる', async () => {
    const state = newState({ ...SETTINGS, maxRounds: 2 });
    await new Baker(new MockEngine(), state, { save: () => undefined, now: clock() }).run();
    // 自分の局面を 1 つ「調べた記録はあるのに、いちばん上の手が未検証」にする。
    // （まだ調べていない自分の局面は、生成の仕組み（collectFrontier）が自分で調べ直す。これはそれをすり抜けた場合の点検）
    const mine = Object.values(state.tree.nodes).find((n) => !isOpponentNode(state.tree, n) && n.edges.length > 0 && n.round === 1)!;
    mine.edges[0].unverified = true;
    delete state.finishedAt;
    expect(unverifiedMine(state.tree, 2)).toHaveLength(1);
    let swept = 0;
    const engine = new MockEngine();
    const r = await new Baker(engine, state, { save: () => undefined, onSweep: (n) => (swept = n), now: clock() }).run();
    expect(r).toEqual({ kind: 'completed' });
    expect(swept).toBe(1);
    expect(engine.calls.map((c) => c.key)).toContain(mine.key);
    expect(unverifiedMine(state.tree, 2)).toEqual([]);
  });

  test('エンジンのエラーは「エラー」で返し、それまでの途中経過は残る', async () => {
    const state = newState();
    const engine = new MockEngine({}, { onAnalyze: (n) => { if (n === 4) throw new Error('engine died'); } });
    const r = await new Baker(engine, state, { save: () => undefined, now: clock() }).run();
    expect(r).toEqual({ kind: 'error', message: 'engine died' });
    expect(state.searched).toBe(3);
  });
});

describe('途中経過のファイル', () => {
  test('設定が違えば続きから作れない（sameSettings）', () => {
    expect(sameSettings(SETTINGS, { ...SETTINGS })).toBe(true);
    expect(sameSettings(SETTINGS, { ...SETTINGS, totalMs: 1 })).toBe(true);
    expect(sameSettings(SETTINGS, { ...SETTINGS, movetimeMs: 600 })).toBe(false);
    expect(sameSettings(SETTINGS, { ...SETTINGS, maxRounds: 4 })).toBe(false);
  });

  test('形の違うファイルは読まない', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'joban-bake-'));
    dirs.push(dir);
    const file = path.join(dir, 'progress.json');
    expect(loadState(file)).toBeNull();
    saveState(file, newState());
    expect(loadState(file)!.specId).toBe('yokofu-33kaku-gote');
    expect(readFileSync(file, 'utf8').startsWith('{"app":"joban-tree-bake"')).toBe(true);
    saveState(file, { ...newState(), app: 'other' } as unknown as BakeState);
    expect(() => loadState(file)).toThrow(/形が違います/);
  });

  test('本番の設定：横歩取り △3三角（後手番）は 6 往復・応手は最大 4・W 300・11mini', () => {
    const spec = BAKE_SPECS.find((s) => s.id === 'yokofu-33kaku-gote')!;
    expect(spec.templateId).toBe('yokofu-33kaku-gote');
    expect(spec.evalId).toBe('mini');
    expect(spec.settings.maxRounds).toBe(6);
    expect(spec.settings.multiPV).toBe(4);
    expect(spec.settings.windowCp).toBe(300);
    expect(spec.settings.replyMs).toBeGreaterThan(0);
  });
});

describe('同梱ツリーの点検（checkBundledTree）', () => {
  async function made() {
    const state = newState({ ...SETTINGS, maxRounds: 2 });
    await new Baker(new MockEngine(), state, { save: () => undefined, now: clock() }).run();
    return bundleOf(state);
  }

  test('作った条件の記録が無ければ見つける', async () => {
    const f = await made();
    expect(checkBundledTree({ ...f, bundle: { ...f.bundle, engine: { ...f.bundle.engine, name: '' } } })).toContain('記録の engine.name がありません');
    expect(checkBundledTree({ ...f, bundle: { ...f.bundle, elapsedMs: undefined } })).toContain('記録の elapsedMs がありません');
    expect(checkBundledTree({ ...f, kind: 'tree' })).toEqual(['同梱ツリーのファイルではありません']);
  });

  test('指せない手・行き先の違い・出発点の違い・調べ残しを見つける', async () => {
    const f = await made();
    const nodes = structuredClone(f.tree.nodes);
    const root = nodes[f.tree.rootKey];
    // 指せない手
    root.edges[0] = { ...root.edges[0], move: '1a1b' };
    expect(checkBundledTree({ ...f, tree: { ...f.tree, nodes } }).some((p) => p.includes('指せない手'))).toBe(true);
    // 出発点がテンプレートと違う
    expect(checkBundledTree(f, ['7g7f'])).toContain('出発点がテンプレートの手順の後の局面と一致しません');
    // 調べ残し
    const nodes2 = structuredClone(f.tree.nodes);
    const opp = Object.values(nodes2).find((n) => n.round === 1 && n.searched && n.key !== f.tree.rootKey && isOpponentNode(f.tree, n))!;
    delete opp.searched;
    expect(checkBundledTree({ ...f, tree: { ...f.tree, nodes: nodes2 } }).some((p) => p.includes('まだ調べていない相手の局面'))).toBe(true);
  });
});

describe('見込み（estimate）', () => {
  const s = (round: number, opp: number, oppDone: number, mine: number, mineDone: number): RoundStat => ({ round, opp, oppDone, mine, mineDone });

  test('終わった往復が無いうちは見込みを出さない', () => {
    expect(project([s(0, 1, 0, 0, 0), s(1, 0, 0, 0, 0)], 5000, 3000)).toBeNull();
  });

  test('1 往復で 3 倍・応手 4 個なら、その割合で先を見込む', () => {
    // 0 往復目：相手 1・自分 4 が終わり、1 往復目の相手 3 がわかっている
    const stats = [s(0, 1, 1, 4, 4), s(1, 3, 0, 0, 0), s(2, 0, 0, 0, 0)];
    expect(completedRounds(stats)).toBe(1);
    const p = project(stats, 5000, 3000)!;
    expect(p.growth).toBe(3);
    expect(p.minePerOpp).toBe(4);
    // 相手：1 + 3 + 9 = 13、自分：4 + 12 + 36 = 52
    expect(p.totalOpp).toBe(13);
    expect(p.totalMine).toBe(52);
    // 残り：相手 12 × 5 秒 + 自分 48 × 3 秒
    expect(p.remainingMs).toBe(12 * 5000 + 48 * 3000);
  });

  test('実際のツリーから往復ごとの数を数え、作り終われば残りは 0', async () => {
    const state = newState();
    await new Baker(new MockEngine(), state, { save: () => undefined, now: clock() }).run();
    const stats = roundStats(state.tree, 3);
    expect(completedRounds(stats)).toBe(3);
    expect(stats[0].opp).toBe(1);
    expect(project(stats, 5000, 3000)!.remainingMs).toBe(0);
    expect(formatRough(80 * 60_000)).toBe('約 1 時間 20 分');
  });
});
