// テスト用の、前の版のツリー（手で組み立てる。ツリー生成は「機能の整理」で消した）
import { STARTPOS_SFEN, applyUsiMove, sfenKey, sideToMove } from '../../src/shogi/position';
import { TREE_APP, TREE_FORMAT_VERSION, type GenerationSettings, type TreeData } from '../../src/tree/types';

export const SETTINGS: GenerationSettings = { totalMs: 60_000, movetimeMs: 400, multiPV: 3, maxRounds: 3, maxNodes: 3000, windowCp: 300 };

/** prefix（平手からの開始局面までの手順）の局面から、line を 1 本だけ持つツリー */
export function lineTree(prefix: readonly string[] = [], line: readonly string[] = [], mySide: 'black' | 'white' = 'white', id = 't1'): TreeData {
  let sfen = STARTPOS_SFEN;
  for (const m of prefix) sfen = applyUsiMove(sfen, m)!.sfen;
  const node = (s: string, i: number) => ({ key: sfenKey(s), sfen: s, round: sideToMove(s) === mySide ? i : 0, edges: [] as TreeData['nodes'][string]['edges'] });
  const root = node(sfen, 0);
  const nodes: TreeData['nodes'] = { [root.key]: root };
  let from = root;
  line.forEach((move, i) => {
    const next = node(applyUsiMove(from.sfen, move)!.sfen, i + 1);
    from.edges.push({ move, to: next.key, score: { kind: 'cp', value: 0 } });
    nodes[next.key] = next;
    from = next;
  });
  return {
    app: TREE_APP,
    version: TREE_FORMAT_VERSION,
    id,
    name: id,
    createdAt: 0,
    updatedAt: 0,
    mySide,
    rootKey: root.key,
    prefix: { initialSfen: STARTPOS_SFEN, moves: [...prefix] },
    nodes,
    settings: SETTINGS,
  };
}
