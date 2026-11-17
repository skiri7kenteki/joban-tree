// 同梱ツリー（public/trees/*.json）の一覧を作り、src/data/bundled-trees.json に書く（段階6-3）。
// アプリは起動時にはこの小さな一覧だけを読み、ツリーの中身は「用意済みのツリーを開く」を押したときに取りに行く。
// 使い方：pc/bake.bat で作った JSON を public/trees/ に置いてから `node scripts/bundled-catalog.mjs`
// （tests/unit/bundled-trees.test.ts が、一覧とファイルの中身が合っているかを確かめる）
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const treesDir = fileURLToPath(new URL('../public/trees/', import.meta.url));
const outFile = fileURLToPath(new URL('../src/data/bundled-trees.json', import.meta.url));

const trees = [];
for (const file of readdirSync(treesDir).filter((f) => f.endsWith('.json')).sort()) {
  const path = `${treesDir}${file}`;
  const data = JSON.parse(readFileSync(path, 'utf8'));
  if (data.app !== 'joban-tree' || data.kind !== 'bundled-tree') throw new Error(`${file} は同梱ツリーのファイルではありません`);
  const { bundle, tree } = data;
  trees.push({
    id: bundle.id,
    templateId: bundle.templateId,
    version: bundle.version,
    file,
    name: bundle.name,
    mySide: tree.mySide,
    rootKey: tree.rootKey,
    maxRounds: bundle.maxRounds,
    nodeCount: Object.keys(tree.nodes).length,
    finishedAt: bundle.finishedAt,
    bytes: statSync(path).size,
  });
}

writeFileSync(outFile, `${JSON.stringify({ trees }, null, 2)}\n`);
console.log(`${trees.length} 本を書きました：${trees.map((t) => t.file).join(', ')}`);
