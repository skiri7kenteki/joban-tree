// PC 用のやねうら王（Windows 版）と評価関数を、この PC に用意する（server.mjs が使う）。Node.js の標準機能だけで動く。
//
// - エンジンの一覧（manifest.json）を GitHub Pages から取ってくる。ネットにつながらなければ前回の分を使う
// - 動かすのは、manifest.json に書かれた sha256 と一致したエンジンだけ
// - 置き場所：%LOCALAPPDATA%\joban-tree-pc\<版>\<評価関数>\（engine.exe と eval\nn.bin・eval\progress.bin）

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/** エンジンと評価関数を置く場所（例：C:\Users\<名前>\AppData\Local\joban-tree-pc） */
export const DATA_DIR = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), '.local', 'share'), 'joban-tree-pc');
/** アプリの取り寄せ元（GitHub Pages） */
export const DEFAULT_UPSTREAM = 'https://skiri7kenteki.github.io';
export const BASE = '/joban-tree/';

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

/**
 * @param {{ upstream?: string, log?: (...a: unknown[]) => void }} [options]
 * @returns {{ loadManifest: () => Promise<any>, prepareEngine: (evalId: 'mini' | 'micro', onStatus?: (text: string) => void) => Promise<{ dir: string, id: string, exe: string }> }}
 */
export function createEngineFiles(options = {}) {
  const upstream = (options.upstream ?? DEFAULT_UPSTREAM).replace(/\/$/, '');
  const log = options.log ?? (() => undefined);
  let manifestPromise = null;
  const prepared = new Map();

  /** エンジンの一覧（manifest.json）を取ってくる。ネットにつながらなければ前回の分を使う */
  function loadManifest() {
    manifestPromise ??= (async () => {
      const local = path.join(DATA_DIR, 'manifest.json');
      try {
        const res = await fetch(`${upstream}${BASE}pc-engine/manifest.json`, { cache: 'no-store' });
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
    const res = await fetch(`${upstream}${BASE}${file.path}`);
    if (!res.ok) throw new Error(`${file.path} の取得に失敗（${res.status}）`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (sha256(buf) !== file.sha256) throw new Error(`${file.path} の中身が一覧と一致しません`);
    await mkdir(path.dirname(dest), { recursive: true });
    const tmp = `${dest}.download`;
    await writeFile(tmp, buf);
    await rename(tmp, dest);
  }

  /** 評価関数ごとに「エンジン本体＋ eval フォルダ」を用意し、そのフォルダを返す */
  function prepareEngine(evalId, onStatus = (text) => log(text)) {
    if (!prepared.has(evalId)) {
      const p = (async () => {
        const manifest = await loadManifest();
        const entry = manifest.engines?.[evalId];
        if (!entry) throw new Error(`評価関数 ${evalId} のエンジンがありません`);
        const dir = path.join(DATA_DIR, manifest.id, evalId);
        await ensureFile(entry.exe, path.join(dir, 'engine.exe'), onStatus);
        await ensureFile(entry.nn, path.join(dir, 'eval', 'nn.bin'), onStatus);
        await ensureFile(entry.progress, path.join(dir, 'eval', 'progress.bin'), onStatus);
        return { dir, id: manifest.id, exe: path.join(dir, 'engine.exe') };
      })();
      prepared.set(evalId, p);
      p.catch(() => prepared.delete(evalId));
    }
    return prepared.get(evalId);
  }

  return { loadManifest, prepareEngine };
}
