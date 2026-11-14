// 序盤ツリーの「PC で作る」ためのサーバー（start.bat から起動する）。Node.js の標準機能だけで動く。
//
// 役目は 2 つ：
// 1. アプリの画面を GitHub Pages から取ってきて、http://localhost:<PORT>/joban-tree/ で見せる（中継）
//    → PC のブラウザで、いつもと同じ画面が開く
// 2. PC 用のやねうら王（Windows 版、ネイティブなのでブラウザ版より何倍も速い）を動かし、
//    画面とエンジンの間で USI の行を受け渡す（/joban-tree/pc-api/...）
//
// 安全のため：
// - この PC の中（127.0.0.1）からしか接続できない
// - Host ヘッダが localhost / 127.0.0.1 でなければ断る（よそのサイトからの「DNS の付け替え」対策）
// - pc-api は合図のヘッダ（X-Joban-Tree）が無いと断る（よそのサイトのページからは付けられない）
// - 動かすのは、manifest.json に書かれた sha256 と一致したエンジンだけ
//
// データ（ツリー）はこのサーバーを通らない。ブラウザの中（この PC の IndexedDB）に保存される。

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

// ---- 設定 ----------------------------------------------------------------

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

/** ポート番号。変えると別のサイト扱いになり、保存したツリーが見えなくなるので変えない */
const PORT = Number(option('--port', '18765'));
/** アプリの取り寄せ元 */
const UPSTREAM = option('--upstream', 'https://skiri7kenteki.github.io').replace(/\/$/, '');
const BASE = '/joban-tree/';
const API = `${BASE}pc-api/`;
/** エンジンと評価関数を置く場所（例：C:\Users\<名前>\AppData\Local\joban-tree-pc） */
const DATA_DIR = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), '.local', 'share'), 'joban-tree-pc');
const VERSION = 1;

const ALLOWED_HOSTS = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`]);
const APP_URL = `http://localhost:${PORT}${BASE}`;

// ---- 小さな道具 ----------------------------------------------------------

const log = (...a) => console.log(new Date().toLocaleTimeString('ja-JP'), ...a);

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readBody(req, limit = 1_000_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('送られてきたデータが大きすぎます');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

// ---- エンジンと評価関数を PC に用意する -----------------------------------

let manifestPromise = null;

/** エンジンの一覧（manifest.json）を取ってくる。ネットにつながらなければ前回の分を使う */
function loadManifest() {
  manifestPromise ??= (async () => {
    const local = path.join(DATA_DIR, 'manifest.json');
    try {
      const res = await fetch(`${UPSTREAM}${BASE}pc-engine/manifest.json`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`manifest.json の取得に失敗（${res.status}）`);
      const text = await res.text();
      const manifest = JSON.parse(text);
      if (manifest.app !== 'joban-tree-pc-engine') throw new Error('manifest.json の形が違います');
      await mkdir(DATA_DIR, { recursive: true });
      await writeFile(local, text);
      return manifest;
    } catch (error) {
      if (existsSync(local)) {
        log('エンジンの一覧を取得できなかったので、前回の分を使います：', error.message);
        return JSON.parse(await readFile(local, 'utf8'));
      }
      manifestPromise = null;
      throw error;
    }
  })();
  return manifestPromise;
}

/** 1 つのファイルを用意する（無いか中身が違えば取ってくる。sha256 で確かめる） */
async function ensureFile(file, dest, onStatus) {
  if (existsSync(dest) && sha256(await readFile(dest)) === file.sha256) return;
  onStatus(`${path.basename(dest)} をダウンロード中`);
  const res = await fetch(`${UPSTREAM}${BASE}${file.path}`);
  if (!res.ok) throw new Error(`${file.path} の取得に失敗（${res.status}）`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (sha256(buf) !== file.sha256) throw new Error(`${file.path} の中身が一覧と一致しません`);
  await mkdir(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.download`;
  await writeFile(tmp, buf);
  await rename(tmp, dest);
}

const prepared = new Map();

/** 評価関数ごとに「エンジン本体＋ eval フォルダ」を用意し、そのフォルダを返す */
function prepareEngine(evalId, onStatus) {
  if (!prepared.has(evalId)) {
    const p = (async () => {
      const manifest = await loadManifest();
      const entry = manifest.engines?.[evalId];
      if (!entry) throw new Error(`評価関数 ${evalId} のエンジンがありません`);
      const dir = path.join(DATA_DIR, manifest.id, evalId);
      await ensureFile(entry.exe, path.join(dir, 'engine.exe'), onStatus);
      await ensureFile(entry.nn, path.join(dir, 'eval', 'nn.bin'), onStatus);
      await ensureFile(entry.progress, path.join(dir, 'eval', 'progress.bin'), onStatus);
      return { dir, id: manifest.id };
    })();
    prepared.set(evalId, p);
    p.catch(() => prepared.delete(evalId));
  }
  return prepared.get(evalId);
}

// ---- エンジンの実行（同時に 1 つだけ） ------------------------------------

/** いま動いているエンジン */
let current = null;
let nextSession = 1;

function stopCurrent(reason) {
  if (!current) return;
  const c = current;
  current = null;
  log(`エンジンを止めます（${reason}）`);
  try {
    c.child.stdin.write('quit\n');
  } catch {
    // すでに終わっている
  }
  setTimeout(() => c.child.kill(), 1000).unref();
  c.end();
}

async function startEngine(evalId) {
  stopCurrent('新しく起動するため');
  const { dir, id } = await prepareEngine(evalId, (text) => log(text));
  const child = spawn(path.join(dir, 'engine.exe'), [], { cwd: dir, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  try {
    // ほかの作業の邪魔をしないよう、優先度を少し下げる
    os.setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL);
  } catch {
    // 下げられなくても動く
  }
  const session = { id: nextSession++, child, lines: [], listener: null, ended: false, end: () => undefined };
  session.end = () => {
    session.ended = true;
    session.listener?.(null);
  };
  let rest = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    const parts = (rest + chunk).split('\n');
    rest = parts.pop() ?? '';
    for (const raw of parts) {
      const line = raw.replace(/\r$/, '');
      if (session.listener) session.listener(line);
      else session.lines.push(line);
    }
  });
  child.stderr.on('data', () => undefined);
  child.on('error', (error) => log('エンジンを起動できません：', error.message));
  child.on('exit', (code) => {
    log(`エンジンが終了しました（${code ?? '強制終了'}）`);
    if (current === session) current = null;
    session.end();
  });
  current = session;
  log(`エンジンを起動しました（${evalId}、版 ${id}）`);
  return session;
}

// ---- pc-api ----------------------------------------------------------------

async function handleApi(req, res, name) {
  // よそのサイトのページからは、この合図のヘッダを付けて送れない（付けると事前確認が必要になり、ここでは許可しない）
  if (req.headers['x-joban-tree'] !== '1') return sendJson(res, 403, { error: '合図のヘッダがありません' });

  if (name === 'info' && req.method === 'GET') {
    return sendJson(res, 200, {
      app: 'joban-tree-pc',
      version: VERSION,
      cpus: os.availableParallelism?.() ?? os.cpus().length,
      cpuName: os.cpus()[0]?.model?.trim() ?? '',
      totalMemMB: Math.round(os.totalmem() / 1024 / 1024),
    });
  }

  if (name === 'start' && req.method === 'POST') {
    const body = await readBody(req);
    const evalId = body.evalId === 'mini' ? 'mini' : 'micro';
    const session = await startEngine(evalId);
    return sendJson(res, 200, { session: session.id });
  }

  if (name === 'events' && req.method === 'GET') {
    const id = Number(new URL(req.url, APP_URL).searchParams.get('session'));
    const session = current && current.id === id ? current : null;
    if (!session || session.listener) return sendJson(res, 410, { error: 'このエンジンはもう動いていません' });
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    // ヘッダをすぐ送る（送らないと、エンジンが 1 行目を出すまで画面側が待ったままになり、usi も送れない）
    res.flushHeaders();
    // 画面を閉じたら（つながりが切れたら）、エンジンも止める
    res.on('close', () => {
      if (current === session) stopCurrent('画面が閉じられたため');
    });
    session.listener = (line) => {
      if (line === null) res.end();
      else res.write(`${line}\n`);
    };
    for (const line of session.lines.splice(0)) res.write(`${line}\n`);
    if (session.ended) res.end();
    return;
  }

  if (name === 'send' && req.method === 'POST') {
    const body = await readBody(req);
    if (!current || current.id !== body.session) return sendJson(res, 410, { error: 'このエンジンはもう動いていません' });
    const lines = Array.isArray(body.lines) ? body.lines.filter((l) => typeof l === 'string' && !/[\r\n]/.test(l)) : [];
    for (const line of lines) current.child.stdin.write(`${line}\n`);
    return sendJson(res, 200, { ok: true });
  }

  if (name === 'close' && req.method === 'POST') {
    const body = await readBody(req);
    if (current && current.id === body.session) stopCurrent('画面から閉じたため');
    return sendJson(res, 200, { ok: true });
  }

  return sendJson(res, 404, { error: 'ありません' });
}

// ---- アプリの中継 ----------------------------------------------------------

const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'transfer-encoding', 'content-encoding', 'content-length', 'alt-svc', 'strict-transport-security']);

async function proxy(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'GET だけです' });
  const headers = { 'user-agent': 'joban-tree-pc' };
  for (const h of ['accept', 'if-none-match', 'if-modified-since', 'range']) {
    if (req.headers[h]) headers[h] = req.headers[h];
  }
  let upstream;
  try {
    upstream = await fetch(`${UPSTREAM}${req.url}`, { method: req.method, headers, redirect: 'manual' });
  } catch {
    // ネットにつながらない。画面は service worker が保存した分で開く
    return sendJson(res, 502, { error: 'GitHub Pages につながりません' });
  }
  const out = {};
  upstream.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key)) out[key] = value;
  });
  // 取り寄せ元への転送（/joban-tree → /joban-tree/ など）は、この PC のアドレスに直す
  if (out.location?.startsWith(UPSTREAM)) out.location = out.location.slice(UPSTREAM.length);
  out['cross-origin-opener-policy'] = 'same-origin';
  out['cross-origin-embedder-policy'] = 'require-corp';
  out['cross-origin-resource-policy'] = 'same-origin';
  res.writeHead(upstream.status, out);
  if (!upstream.body || req.method === 'HEAD') return res.end();
  Readable.fromWeb(upstream.body).on('error', () => res.destroy()).pipe(res);
}

// ---- サーバー ---------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  try {
    if (!ALLOWED_HOSTS.has(req.headers.host ?? '')) return sendJson(res, 403, { error: 'このアドレスでは使えません' });
    const url = new URL(req.url, APP_URL);
    if (url.pathname === '/' || url.pathname === '/joban-tree') {
      res.writeHead(302, { location: BASE });
      return res.end();
    }
    if (url.pathname.startsWith(API)) return await handleApi(req, res, url.pathname.slice(API.length));
    if (url.pathname.startsWith(BASE)) return await proxy(req, res);
    return sendJson(res, 404, { error: 'ありません' });
  } catch (error) {
    log('エラー：', error instanceof Error ? error.message : String(error));
    if (!res.headersSent) sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
    else res.destroy();
  }
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`ポート ${PORT} はすでに使われています。序盤ツリーのサーバーがもう動いていないか確かめてください（黒い画面が別に開いていませんか）。`);
  } else {
    console.error('サーバーを起動できません：', error.message);
  }
  process.exit(1);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('');
  console.log('序盤ツリー（PC 版）のサーバーが動いています。');
  console.log(`  ブラウザで開く：${APP_URL}`);
  console.log('  終わるときは、この黒い画面を閉じてください。');
  console.log(`  エンジンの置き場所：${DATA_DIR}`);
  console.log('');
  // JOBAN_TREE_NO_OPEN=1 はテスト用（start.bat を試すときにブラウザを開かない）
  if (args.includes('--open') && process.env.JOBAN_TREE_NO_OPEN !== '1') {
    // 既定のブラウザで開く
    spawn('cmd', ['/c', 'start', '', APP_URL], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  }
});

process.on('exit', () => stopCurrent('サーバーを終了するため'));
process.on('SIGINT', () => process.exit(0));
