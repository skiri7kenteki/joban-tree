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

// エンジンが出した最近の行（失敗したときの手がかり用）
const recent = [];

// 失敗の理由を GitHub Actions の「注記（annotation）」にも出す。
// ログは管理者しか読めないが、注記は誰でも見られるので原因を共有しやすい。
function fail(message) {
  const detail = [`[${pkg}] ${message}`, ...recent.filter((l) => !l.startsWith('option name')).slice(-25)].join('\n');
  console.error(detail);
  const escaped = detail.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  console.log(`::error title=エンジン単体の動作確認（${pkg}）::${escaped}`);
  process.exit(1);
}
// 例外の中身を文字にする（Emscripten の終了通知 ExitStatus などは Error ではないので stack が無い）
function describe(e) {
  if (e instanceof Error) return e.stack ?? String(e);
  if (e && typeof e === 'object') {
    const props = {};
    for (const k of Object.getOwnPropertyNames(e)) props[k] = String(e[k]);
    return `${e.constructor?.name ?? 'Object'} ${JSON.stringify(props)}`;
  }
  return String(e);
}
process.on('uncaughtException', (e) => fail(`例外: ${describe(e)}`));
process.on('unhandledRejection', (e) => fail(`例外: ${describe(e)}`));

const TIMEOUT_MS = 180_000;
const timer = setTimeout(() => fail(`${TIMEOUT_MS / 1000} 秒以内に終わりませんでした`), TIMEOUT_MS);

// このリポジトリの package.json は "type": "module"（.js を ES モジュール扱い）。
// Emscripten が出すエンジンの .js は古い形式（CommonJS）なので、そのフォルダだけ CommonJS 扱いにする。
fs.writeFileSync(path.join(distDir, 'package.json'), '{ "type": "commonjs" }\n');

const require = createRequire(import.meta.url);
const factory = require(path.resolve(distDir, `yaneuraou.${pkg}.js`));
const t0 = Date.now();
// エンジンのエラー出力（stderr）も手がかりとして残す
const engine = await factory({
  printErr: (line) => {
    console.error(`! ${line}`);
    recent.push(`! ${line}`);
  },
});
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
  recent.push(line);
  for (const w of [...waiters]) {
    if (w.test(line)) {
      waiters.splice(waiters.indexOf(w), 1);
      w.resolve(line);
    }
  }
});

function send(cmd) {
  console.log(`> ${cmd}`);
  recent.push(`> ${cmd}`);
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
if (!ok) fail(`答えがおかしい: ${best}`);
clearTimeout(timer);
engine.terminate();
process.exit(0);
