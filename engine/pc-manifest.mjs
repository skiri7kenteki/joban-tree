// PC 用エンジンの一覧（public/pc-engine/manifest.json）を作る。GitHub Actions の中で使う。
// pc/server.mjs はこれを見て、エンジン（.exe）と評価関数を PC に取ってきて、sha256 で中身を確かめる。
//   使い方：node engine/pc-manifest.mjs <PC 用エンジンのキー> > public/pc-engine/manifest.json
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const id = process.argv[2];
if (!id) throw new Error('PC 用エンジンのキーを指定してください');

const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const file = (path) => ({ path, sha256: sha256(`public/${path}`) });

// src/engine/config.ts の EVALS と同じ評価関数のフォルダ
const ENGINES = {
  micro: { exe: 'yaneuraou-ka2-2048-avx2.exe', evalDir: 'eval/tuyoura11micro-20261001' },
  mini: { exe: 'yaneuraou-ka2-4096-avx2.exe', evalDir: 'eval/tuyoura11mini-20261003' },
};

const engines = {};
for (const [evalId, e] of Object.entries(ENGINES)) {
  engines[evalId] = {
    exe: file(`pc-engine/${id}/${e.exe}`),
    nn: file(`${e.evalDir}/nn.bin`),
    progress: file(`${e.evalDir}/progress.bin`),
  };
}

console.log(JSON.stringify({ app: 'joban-tree-pc-engine', version: 1, id, engines }, null, 2));
