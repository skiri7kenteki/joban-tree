// ビルドしたエンジンを Node.js で動かして、最低限の動作を確かめる（GitHub Actions 用）。
// ブラウザより前に「エンジン単体で答えを返すか」を切り分けるためのもの。
//
// 使い方：node engine/smoke.mjs <engine-dist のフォルダ> <パッケージ名> <評価関数のフォルダ>
//   例：node engine/smoke.mjs engine-dist sfnn_ka2_2048.noeval public/eval/tuyoura11micro-20261001
//
// 確かめること：usi → setoption（FV_SCALE=24 など）→ isready → position startpos → go movetime 500 で
// bestmove と評価値（score cp）が返ること。
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const [distDir, pkg, evalDir] = process.argv.slice(2);
if (!distDir || !pkg || !evalDir) {
  console.error('使い方: node engine/smoke.mjs <engine-dist> <パッケージ名> <評価関数のフォルダ>');
  process.exit(2);
}

const require = createRequire(import.meta.url);
const TIMEOUT_MS = 180_000;
const timer = setTimeout(() => {
  console.error(`[smoke] ${TIMEOUT_MS / 1000} 秒以内に終わりませんでした`);
  process.exit(1);
}, TIMEOUT_MS);

const factory = require(path.resolve(distDir, `yaneuraou.${pkg}.js`));
const t0 = Date.now();
const engine = await factory();
console.log(`[smoke] モジュール読み込み ${Date.now() - t0}ms`);

// 評価関数を仮想ファイルシステムの /eval/ に置く
engine.FS.mkdir('/eval');
for (const name of ['nn.bin', 'progress.bin']) {
  engine.FS.writeFile(`/eval/${name}`, fs.readFileSync(path.join(evalDir, name)));
}

const lines = [];
const waiters = [];
engine.addMessageListener((line) => {
  console.log(`< ${line}`);
  lines.push(line);
  for (const w of [...waiters]) {
    if (w.test(line)) {
      waiters.splice(waiters.indexOf(w), 1);
      w.resolve(line);
    }
  }
});

function send(cmd) {
  console.log(`> ${cmd}`);
  engine.postMessage(cmd);
}
function waitFor(test) {
  return new Promise((resolve) => waiters.push({ test, resolve }));
}

send('usi');
await waitFor((l) => l === 'usiok');
send('setoption name Threads value 1');
send('setoption name USI_Hash value 16');
send('setoption name EvalDir value eval');
send('setoption name FV_SCALE value 24');
send('setoption name MultiPV value 1');
const t1 = Date.now();
send('isready');
await waitFor((l) => l === 'readyok');
console.log(`[smoke] isready まで ${Date.now() - t1}ms`);
send('usinewgame');
send('position startpos');
send('go movetime 500');
const best = await waitFor((l) => l.startsWith('bestmove'));

const infos = lines.filter((l) => l.startsWith('info') && l.includes(' score '));
const last = infos[infos.length - 1] ?? '';
const ok = /^bestmove [1-9][a-i][1-9][a-i]\+?/.test(best) && /score (cp|mate) -?\d+/.test(last);
console.log(`[smoke] 最後の info: ${last}`);
console.log(`[smoke] ${best} → ${ok ? 'OK' : 'NG'}`);
clearTimeout(timer);
engine.terminate();
process.exit(ok ? 0 : 1);
