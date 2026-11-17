// 同梱ツリー（段階6-3）：public/trees/ のファイルの中身・一覧との一致・コピーと版の扱い・局面の数の上限
import { readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { summarize, emptyRecord } from '../../src/review/review';
import { applyUsiMove, sfenKey, sideToMove } from '../../src/shogi/position';
import { parseTreeJson, treeToJson } from '../../src/tree/backup';
import {
  bundledStatus,
  checkBundledTree,
  copyBundledTree,
  copyName,
  parseBundledFile,
  type BundledTreeFile,
  type BundledTreeMeta,
} from '../../src/tree/bundled';
import { BUNDLED_TREES, bundledFor, latestBundled } from '../../src/tree/bundledCatalog';
import { TreeGenerator, isOpponentNode } from '../../src/tree/generator';
import { BUNDLED_TEMPLATES } from '../../src/tree/templates';
import { TREE_FORMAT_VERSION, type GenerationSettings } from '../../src/tree/types';
import { MockEngine, SETTINGS, newTree } from './mock-engine';

const publicPath = (file: string) => new URL(`../../public/trees/${file}`, import.meta.url);
const readFile = (meta: BundledTreeMeta) => readFileSync(publicPath(meta.file), 'utf8');

const NORMAL: GenerationSettings = { totalMs: 120_000, movetimeMs: 1500, multiPV: 4, maxRounds: 4, maxNodes: 3000, windowCp: 300, replyMs: 1000, dubiousCp: 150 };

describe('同梱ツリーのファイル（public/trees/）', () => {
  it('一覧に 1 本以上あり、まず「横歩取り △3三角（後手番）」がある', () => {
    expect(BUNDLED_TREES.length).toBeGreaterThanOrEqual(1);
    const m = BUNDLED_TREES.find((t) => t.id === 'yokofu-33kaku-gote');
    expect(m).toBeDefined();
    expect(m!.file).toBe('yokofu-33kaku-gote.v1.json');
    expect(m!.mySide).toBe('white');
  });

  for (const meta of BUNDLED_TREES) {
    describe(meta.file, () => {
      const text = readFile(meta);
      const file = JSON.parse(text) as BundledTreeFile;
      const template = BUNDLED_TEMPLATES.find((t) => t.id === meta.templateId);

      it('点検に通る：すべての手が合法・行き先が正しい・出発点がテンプレートの手順と一致・たどれない局面なし・調べ残しなし・未検証なし', () => {
        expect(template).toBeDefined();
        expect(checkBundledTree(file, template!.moves)).toEqual([]);
      });

      it('出発点：テンプレートの手順を指した後の局面で、相手の手番。自分の側はテンプレートと同じ', () => {
        let sfen = file.tree.prefix.initialSfen;
        for (const m of template!.moves) sfen = applyUsiMove(sfen, m)!.sfen;
        expect(file.tree.rootKey).toBe(sfenKey(sfen));
        expect(file.tree.prefix.moves).toEqual(template!.moves);
        expect(file.tree.mySide).toBe(template!.mySide);
        expect(sideToMove(sfen)).not.toBe(file.tree.mySide);
      });

      it('ツリーの形：手の行き先はすべてある局面、出発点からすべてたどれる、合流（2 つ以上の手から来る局面）がある、深さは 6 往復まで', () => {
        const nodes = file.tree.nodes;
        const incoming = new Map<string, number>();
        for (const node of Object.values(nodes)) {
          for (const e of [...node.edges, ...(node.excluded ?? [])]) {
            expect(nodes[e.to]).toBeDefined();
            incoming.set(e.to, (incoming.get(e.to) ?? 0) + 1);
          }
        }
        // 出発点以外は、どこかから手が来ている
        for (const key of Object.keys(nodes)) if (key !== file.tree.rootKey) expect(incoming.get(key) ?? 0).toBeGreaterThan(0);
        expect(incoming.get(file.tree.rootKey) ?? 0).toBe(0);
        const merges = [...incoming.values()].filter((n) => n >= 2).length;
        expect(merges).toBeGreaterThan(0);
        // 相手の局面の深さは 0〜maxRounds（maxRounds の局面は葉）
        for (const node of Object.values(nodes)) {
          expect(node.round).toBeLessThanOrEqual(meta.maxRounds);
          if (isOpponentNode(file.tree, node) && node.round >= meta.maxRounds) expect(node.searched).toBeUndefined();
        }
        // 相手の局面の応手は最大 4 つ、自分の局面の手はすべて確定（検証済み）
        for (const node of Object.values(nodes)) {
          if (isOpponentNode(file.tree, node)) expect(node.edges.length).toBeLessThanOrEqual(4);
          else for (const e of node.edges) expect(e.unverified).toBeFalsy();
        }
      });

      it('作った条件の記録がある（エンジン・評価関数・スレッド数・設定・日時・局面の数・時間）', () => {
        const b = file.bundle;
        expect(b.engine.name).toMatch(/YaneuraOu/);
        expect(b.engine.evalId).toBe('mini');
        expect(b.engine.evalLabel).toBeTruthy();
        expect(b.engine.threads).toBeGreaterThan(0);
        expect(b.engine.hashMB).toBeGreaterThan(0);
        expect(b.engine.cpu).toBeTruthy();
        expect(b.settings).toMatchObject({ maxRounds: 6, multiPV: 4, windowCp: 300 });
        expect(b.settings.replyMs).toBeGreaterThan(0);
        expect(b.finishedAt).toBeGreaterThan(b.startedAt);
        expect(b.elapsedMs).toBeGreaterThan(0);
        expect(b.searched).toBeGreaterThan(0);
        expect(b.nodeCount).toBe(Object.keys(file.tree.nodes).length);
        expect(b.appVersion).toMatch(/^\d+\.\d+\.\d+$/);
      });

      it('一覧（src/data/bundled-trees.json）がファイルと合っている（違えば node scripts/bundled-catalog.mjs で作り直す）', () => {
        expect(meta).toEqual({
          id: file.bundle.id,
          templateId: file.bundle.templateId,
          version: file.bundle.version,
          file: `${file.bundle.id}.v${file.bundle.version}.json`,
          name: file.bundle.name,
          mySide: file.tree.mySide,
          rootKey: file.tree.rootKey,
          maxRounds: file.bundle.maxRounds,
          nodeCount: Object.keys(file.tree.nodes).length,
          finishedAt: file.bundle.finishedAt,
          bytes: statSync(publicPath(meta.file)).size,
        });
        expect(meta.name).toBe(template!.name);
      });

      it('アプリで読む（parseBundledFile）→ コピーすると、普通のツリーとして読み書きでき、復習の問題も数えられる', () => {
        const parsed = parseBundledFile(text, meta);
        expect(typeof parsed).not.toBe('string');
        const copy = copyBundledTree(parsed as BundledTreeFile, { id: 'copy-1', name: meta.name, now: 123, settings: NORMAL });
        const back = parseTreeJson(treeToJson(copy));
        expect(back.ok).toBe(true);
        expect(Object.keys(copy.nodes).length).toBe(meta.nodeCount);
        const s = summarize(copy, emptyRecord(copy.id));
        expect(s.total).toBeGreaterThan(100);
      });
    });
  }
});

describe('同梱ツリーのコピー', () => {
  const meta: BundledTreeMeta = {
    id: 'b1',
    templateId: 'b1',
    version: 2,
    file: 'b1.v2.json',
    name: '用意済み',
    mySide: 'white',
    rootKey: newTree().rootKey,
    maxRounds: 3,
    nodeCount: 1,
    finishedAt: 1000,
    bytes: 1,
  };
  function fileOf(): BundledTreeFile {
    const tree = newTree('white', undefined, { ...SETTINGS, totalMs: 30 * 24 * 3600_000, maxNodes: 1_000_000 });
    tree.version = 3;
    return {
      app: 'joban-tree',
      kind: 'bundled-tree',
      version: 1,
      bundle: { id: 'b1', templateId: 'b1', version: 2, finishedAt: 1000 } as BundledTreeFile['bundle'],
      tree,
    };
  }

  it('コピーは新しい id・名前・日付、生成の条件は端末の「ふつう」、元の同梱ツリーの記録（source）、今の形式。元のファイルは変えない', () => {
    const file = fileOf();
    const before = JSON.stringify(file);
    const copy = copyBundledTree(file, { id: 'new-id', name: '名前', now: 5000, settings: NORMAL });
    expect(copy).toMatchObject({ id: 'new-id', name: '名前', createdAt: 5000, updatedAt: 5000, version: TREE_FORMAT_VERSION, settings: NORMAL });
    expect(copy.source).toEqual({ kind: 'bundled', id: 'b1', version: 2, finishedAt: 1000 });
    copy.nodes[copy.rootKey].edges.push({ move: '7g7f', to: 'x', score: { kind: 'cp', value: 0 } });
    expect(JSON.stringify(file)).toBe(before);
  });

  it('parseBundledFile：形が違う・一覧と版が違う・出発点が違うものは読まない', () => {
    const ok = JSON.stringify(fileOf());
    expect(typeof parseBundledFile(ok, meta)).toBe('object');
    expect(parseBundledFile('{', meta)).toMatch(/JSON/);
    expect(parseBundledFile(JSON.stringify({ ...fileOf(), kind: 'x' }), meta)).toMatch(/ファイルではありません/);
    expect(parseBundledFile(ok, { ...meta, version: 3 })).toMatch(/版/);
    expect(parseBundledFile(ok, { ...meta, rootKey: 'other' })).toMatch(/壊れて/);
  });

  it('bundledStatus：コピーが無い → none、今の版のコピー → いちばん最近使ったものを開く、前の版だけ → 新しい版があります', () => {
    const src = (version: number) => ({ kind: 'bundled' as const, id: 'b1', version, finishedAt: 1 });
    expect(bundledStatus(meta, [])).toEqual({ kind: 'none' });
    expect(bundledStatus(meta, [{ id: 'a', updatedAt: 1 }, { id: 'b', updatedAt: 2, source: { ...src(2), id: 'other' } }])).toEqual({ kind: 'none' });
    expect(
      bundledStatus(meta, [
        { id: 'old', updatedAt: 9, source: src(1) },
        { id: 'c1', updatedAt: 3, source: src(2) },
        { id: 'c2', updatedAt: 5, source: src(2) },
      ]),
    ).toEqual({ kind: 'copy', treeId: 'c2' });
    expect(bundledStatus(meta, [{ id: 'old', updatedAt: 9, source: src(1) }])).toEqual({ kind: 'outdated', treeId: 'old', copyVersion: 1 });
  });

  it('2 つ目のコピーからは名前に番号を付ける（前の版のコピーも数える）', () => {
    const src = { kind: 'bundled' as const, id: 'b1', version: 1, finishedAt: 1 };
    expect(copyName(meta, [])).toBe('用意済み');
    expect(copyName(meta, [{ id: 'x', updatedAt: 1, source: src }])).toBe('用意済み（2）');
  });

  it('bundledFor・latestBundled：局面と側が合うものの、いちばん新しい版', () => {
    const list = [meta, { ...meta, version: 1, file: 'b1.v1.json' }, { ...meta, id: 'b2', mySide: 'black' as const }];
    expect(bundledFor(meta.rootKey, 'white', list)?.version).toBe(2);
    expect(bundledFor(meta.rootKey, 'black', list)?.id).toBe('b2');
    expect(bundledFor('nothing', 'white', list)).toBeNull();
    expect(latestBundled('b1', list)?.file).toBe('b1.v2.json');
    expect(latestBundled('zz', list)).toBeNull();
  });

  it('JSON の取り込み：source の形がおかしいものは読まない。形式 4 より新しいものも読まない', () => {
    const tree = { ...newTree(), source: { kind: 'bundled', id: 'b1', version: 1, finishedAt: 1 } };
    expect(parseTreeJson(JSON.stringify(tree)).ok).toBe(true);
    expect(parseTreeJson(JSON.stringify({ ...tree, source: { kind: 'bundled', id: 'b1' } })).ok).toBe(false);
    expect(parseTreeJson(JSON.stringify({ ...tree, version: TREE_FORMAT_VERSION + 1 })).ok).toBe(false);
  });
});

describe('局面の数の上限は「1 回の生成で増やせる数」（段階6-3）', () => {
  it('すでに上限より多い局面があるツリーからでも、上限の数まで増やせる', async () => {
    // まず大きめのツリーを作る
    const tree = newTree('white');
    await new TreeGenerator(new MockEngine(), tree, SETTINGS).run();
    const before = Object.keys(tree.nodes).length;
    expect(before).toBeGreaterThan(20);
    // 上限 10 で続きを作る（深さを 1 つ増やす）
    const g = new TreeGenerator(new MockEngine(), tree, { ...SETTINGS, maxRounds: 4, maxNodes: 10 });
    const reason = await g.run();
    expect(reason).toBe('nodes');
    const added = Object.keys(tree.nodes).length - before;
    expect(added).toBeGreaterThanOrEqual(10);
    expect(added).toBeLessThan(10 + 10);
  });
});
