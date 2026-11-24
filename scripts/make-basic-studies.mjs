// 基本の研究（段階20-3）の手順を、同梱ツリーの本線から作って src/data/basic-studies.json に書く。
// アプリは同梱ツリー（約 2MB）を読まずに、この小さなファイルだけを使う（「＋ 研究手順を登録」→「基本の研究を入れる」）。
// 使い方：`node scripts/make-basic-studies.mjs`（同梱ツリーを作り直したら、版を合わせて作り直す）
//
// 手順の選び方（持ち主の判断 2026-11-24「全ておすすめの通りで」。設計案の 8 本と同じ決まり）：
//   - 相手の手番：1 回目は最善手との差 150 以内（本線・有力）、2 回目は差 50 以内（本線）の手をすべて。3 回目からは最善手だけ
//   - 自分の手番：いちばん上の手（ツリーの本線）だけ
//   - ツリーの終わり（28 手目）まで
//   - 分かれ目（1・2 回目の相手の手）が端歩（▲9六歩・▲1六歩）の手順は外す（基本の研究には入れない）
// 確認：tests/unit/basic-studies.test.ts が、このファイルとツリーが合っているかを確かめる
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** 作る基本の研究（同梱ツリーのファイル・戦型） */
const SOURCES = [{ file: 'yokofu-33kaku-gote.v1.json' }];
/** 相手の 1 回目・2 回目の手の、最善手との差の上限 */
const BRANCH_DIFF = [150, 50];
/** 分かれ目にあれば外す手（端歩） */
const EDGE_PAWNS = new Set(['9g9f', '1g1f', '9c9d', '1c1d']);

const treesDir = fileURLToPath(new URL('../public/trees/', import.meta.url));
const outFile = fileURLToPath(new URL('../src/data/basic-studies.json', import.meta.url));

/** 局面のキーから手番（SFEN の 2 つ目の欄） */
const turnOf = (key) => (key.split(' ')[1] === 'b' ? 'black' : 'white');

function linesOf(tree) {
  const out = [];
  const walk = (key, path, oppCount, edge) => {
    const node = tree.nodes[key];
    if (!node || node.edges.length === 0) {
      out.push({ moves: path, edge });
      return;
    }
    if (turnOf(key) !== tree.mySide) {
      const limit = BRANCH_DIFF[oppCount] ?? 0;
      const picked = node.edges.filter((e) => (e.diff ?? 0) <= limit);
      for (const e of picked.length > 0 ? picked : node.edges.slice(0, 1)) {
        const isEdge = edge || (oppCount < BRANCH_DIFF.length && EDGE_PAWNS.has(e.move));
        walk(e.to, [...path, e.move], oppCount + 1, isEdge);
      }
    } else {
      const e = node.edges[0];
      walk(e.to, [...path, e.move], oppCount, edge);
    }
  };
  walk(tree.rootKey, [], 0, false);
  return out;
}

const sets = [];
for (const { file } of SOURCES) {
  const { bundle, tree } = JSON.parse(readFileSync(`${treesDir}${file}`, 'utf8'));
  const all = linesOf(tree);
  // 1 本＝戦型の出発点からの手（USI）を空白でつないだ文字（読みやすいように）
  const lines = all.filter((l) => !l.edge).map((l) => l.moves.join(' '));
  sets.push({
    id: bundle.id,
    templateId: bundle.templateId,
    name: bundle.name,
    mySide: tree.mySide,
    // 有段者（持ち主）が中身を確かめたら true にする
    reviewed: false,
    source: { tree: bundle.id, version: bundle.version },
    lines,
  });
  console.log(`${bundle.id}: ${all.length} 本のうち端歩の ${all.length - lines.length} 本を外して ${lines.length} 本`);
}
writeFileSync(outFile, `${JSON.stringify({ sets }, null, 2)}\n`);
console.log(`書きました：${outFile}`);
