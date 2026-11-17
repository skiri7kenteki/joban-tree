// 同梱ツリーを PC で作るコマンド（段階6-2）。pc/bake.bat から動かす（README の「同梱ツリーを作る」）。
//
//   bake.bat                 作り始める。途中経過があれば続きから
//   bake.bat --fresh         最初から作り直す（前の途中経過は名前を変えて残す）
//   bake.bat --trial         試し：深さ 3 往復だけ作り、局面の数と時間から本番の見込みを出す（本番とは別に保存）
//   そのほか：--spec <id>（作るツリー。今は yokofu-33kaku-gote だけ）、--threads <数>（初期値：論理プロセッサの数 − 2）、
//             --hash <MB>（初期値 1024）、--rounds <数>、--opp-ms <ミリ秒>、--mine-ms <ミリ秒>（試しで時間を変えるとき）、
//             --allow-sleep（スリープを止めない）
//
// 途中経過：%LOCALAPPDATA%\joban-tree-pc\bake\<id>\progress.json（1 局面ごとに保存。OneDrive の外に置く）
// できあがり：ドキュメント\joban-tree-bake\<id>\<id>.v<版>.json と log.txt
// 止めるには：この黒い画面で Ctrl+C（調べている 1 局面が終わってから止まる）か、画面を閉じる。続きは同じコマンドで

import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, copyFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pkg from '../../package.json';
import { EVALS } from '../../src/engine/config';
import { checkBundledTree, bundledTreeFileName } from '../../src/tree/bundled';
import { createTree } from '../../src/tree/generator';
import { BUNDLED_TEMPLATES, templateLine } from '../../src/tree/templates';
import type { GenerationSettings } from '../../src/tree/types';
import { DATA_DIR, createEngineFiles } from '../engine-files.mjs';
import { Baker } from './baker';
import { completedRounds, formatDuration, formatRough, project, roundStats } from './estimate';
import { startNativeEngine } from './nodeEngine';
import { BAKE_SPECS } from './specs';
import { buildBundle, loadState, sameSettings, saveState, writeAtomic, type BakeState } from './state';

// ---- 引数 ----------------------------------------------------------------

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const option = (name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const numberOption = (name: string): number | undefined => {
  const v = option(name);
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) fail(`${name} には正の数を書いてください（${v}）`);
  return n;
};

function fail(message: string): never {
  console.error(`\nエラー：${message}\n`);
  process.exit(1);
}

const specId = option('--spec') ?? BAKE_SPECS[0].id;
const spec = BAKE_SPECS.find((s) => s.id === specId) ?? fail(`作り方 ${specId} がありません（${BAKE_SPECS.map((s) => s.id).join('・')}）`);
const template = BUNDLED_TEMPLATES.find((t) => t.id === spec.templateId) ?? fail(`戦型テンプレート ${spec.templateId} がありません`);
const trial = flag('--trial');
const settings: GenerationSettings = {
  ...spec.settings,
  maxRounds: numberOption('--rounds') ?? (trial ? 3 : spec.settings.maxRounds),
  movetimeMs: numberOption('--opp-ms') ?? spec.settings.movetimeMs,
  replyMs: numberOption('--mine-ms') ?? spec.settings.replyMs,
};
if (!trial && ['--rounds', '--opp-ms', '--mine-ms'].some(flag)) fail('深さや時間を変えられるのは試し（--trial）のときだけです。本番は pc/bake/specs.ts の設定で作ります');
const cpus = os.availableParallelism?.() ?? os.cpus().length;
const threads = Math.min(numberOption('--threads') ?? Math.max(1, cpus - 2), cpus);
const hashMB = numberOption('--hash') ?? 1024;

// ---- 置き場所 --------------------------------------------------------------

/** ドキュメントのフォルダ（OneDrive に移っていればそちら） */
function documentsDir(): string {
  if (process.platform === 'win32') {
    const r = spawnSync(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command', "[Console]::OutputEncoding=[Text.Encoding]::UTF8; [Environment]::GetFolderPath('MyDocuments')"],
      { encoding: 'utf8', windowsHide: true },
    );
    const dir = r.stdout?.trim();
    if (r.status === 0 && dir && existsSync(dir)) return dir;
  }
  return path.join(os.homedir(), 'Documents');
}

const workName = trial ? `${spec.id}-trial` : spec.id;
const workDir = path.join(DATA_DIR, 'bake', workName);
const stateFile = path.join(workDir, 'progress.json');
const logFile = path.join(workDir, 'log.txt');
mkdirSync(workDir, { recursive: true });

function log(text: string): void {
  const line = `${new Date().toLocaleString('ja-JP')}  ${text}`;
  console.log(line);
  try {
    appendFileSync(logFile, `${line}\n`);
  } catch {
    // 記録できなくても続ける
  }
}

// ---- スリープを止める ------------------------------------------------------

/**
 * 実行中だけ、Windows に「スリープしないで」と伝える（SetThreadExecutionState。管理者の権限は要らない）。
 * 小さな PowerShell を一緒に動かし、このコマンドが終わればそれも終わる。画面を消すのは止めない。
 * ノート PC のふたを閉じたときのスリープは止められない（README を参照）
 */
function preventSleep(): (() => void) | null {
  if (process.platform !== 'win32' || flag('--allow-sleep')) return null;
  const script = [
    "Add-Type -Namespace JobanTree -Name Power -MemberDefinition '[DllImport(\"kernel32.dll\")] public static extern uint SetThreadExecutionState(uint esFlags);'",
    // ES_CONTINUOUS | ES_SYSTEM_REQUIRED
    '[void][JobanTree.Power]::SetThreadExecutionState([uint32]2147483649)',
    `while (Get-Process -Id ${process.pid} -ErrorAction SilentlyContinue) { Start-Sleep -Seconds 20 }`,
  ].join('; ');
  try {
    const child = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { stdio: 'ignore', windowsHide: true });
    child.on('error', () => log('スリープを止める仕組みを動かせませんでした（電源の設定でスリープを「なし」にしてください）'));
    return () => child.kill();
  } catch {
    return null;
  }
}

// ---- 途中経過の用意 --------------------------------------------------------

function newState(): BakeState {
  const line = templateLine(template.moves);
  if (!line.ok) fail(`戦型テンプレートの ${line.index + 1} 手目が指せません`);
  const rootSfen = line.line[line.line.length - 1].sfen;
  const now = Date.now();
  return {
    app: 'joban-tree-bake',
    stateVersion: 1,
    specId: spec.id,
    trial,
    evalId: spec.evalId,
    settings,
    startedAt: now,
    elapsedMs: 0,
    sessions: 0,
    searched: 0,
    timings: { oppMs: 0, oppCount: 0, mineMs: 0, mineCount: 0 },
    tree: createTree({
      id: `bundled-${spec.id}`,
      name: template.name,
      rootSfen,
      mySide: template.mySide,
      prefix: { initialSfen: line.line[0].sfen, moves: [...template.moves] },
      settings,
      now,
    }),
  };
}

function prepareState(): BakeState {
  if (flag('--fresh') && existsSync(stateFile)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const old = path.join(workDir, `progress-${stamp}.json`);
    renameSync(stateFile, old);
    log(`前の途中経過は ${old} に残しました。最初から作ります`);
  }
  let state: BakeState | null;
  try {
    state = loadState(stateFile);
  } catch (error) {
    fail(`${error instanceof Error ? error.message : String(error)}。最初から作るときは --fresh を付けてください`);
  }
  if (!state) return newState();
  if (state.specId !== spec.id || !sameSettings(state.settings, settings)) {
    fail('途中経過は、今と違う設定で作り始めたものです。最初から作り直すときは --fresh を付けてください（前の途中経過は残します）');
  }
  return state;
}

// ---- 表示 --------------------------------------------------------------------

const avg = (ms: number, count: number, fallback: number) => (count > 0 ? ms / count : fallback);

function roundReport(state: BakeState, forRounds: number): string[] {
  const stats = roundStats(state.tree, Math.max(forRounds, state.settings.maxRounds));
  const lines = stats
    .filter((s) => s.opp > 0 || s.mine > 0)
    .map((s) => `    ${s.round + 1} 往復目：相手の局面 ${s.oppDone}/${s.opp}・自分の局面 ${s.mineDone}/${s.mine}`);
  const t = state.timings;
  // 1 局面にかかった時間 = 探索時間 + やり取りの分。試しで探索時間を変えていても、見込みは本番の探索時間で出す
  const oppMs = spec.settings.movetimeMs + Math.max(0, avg(t.oppMs, t.oppCount, state.settings.movetimeMs + 100) - state.settings.movetimeMs);
  const mineReply = state.settings.replyMs ?? 0;
  const mineMs = (spec.settings.replyMs ?? 0) + Math.max(0, avg(t.mineMs, t.mineCount, mineReply + 100) - mineReply);
  // 試しでは、本番の設定（深さ・時間）での見込みも出す
  const p = project(stats.slice(0, forRounds), oppMs, mineMs);
  if (p) {
    const total = state.elapsedMs + p.remainingMs;
    lines.push(
      `    見込み（${forRounds} 往復まで）：残り ${formatRough(p.remainingMs)}・合計 ${formatRough(total)}・局面の数 約 ${p.totalNodes.toLocaleString()}` +
        `（相手の局面 ${p.totalOpp.toLocaleString()}・自分の局面 ${p.totalMine.toLocaleString()}。1 往復で約 ${p.growth.toFixed(2)} 倍、応手は平均 ${p.minePerOpp.toFixed(2)} 個）`,
    );
  }
  lines.push(`    1 局面の見込み（本番の設定で）：相手 ${(oppMs / 1000).toFixed(1)} 秒・自分 ${(mineMs / 1000).toFixed(1)} 秒`);
  return lines;
}

function statusLine(state: BakeState): string {
  const stats = roundStats(state.tree, state.settings.maxRounds);
  const done = completedRounds(stats);
  return `[${formatDuration(state.elapsedMs)}] 調べた局面 ${state.searched.toLocaleString()}・ツリーの局面 ${Object.keys(state.tree.nodes).length.toLocaleString()}・いま ${Math.min(done + 1, state.settings.maxRounds)} 往復目`;
}

// ---- 本体 --------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('');
  console.log(`序盤ツリー：同梱ツリーを作る${trial ? '（試し）' : ''}`);
  console.log(`  戦型：${template.name}（${template.mySide === 'black' ? '先手' : '後手'}が自分）`);
  console.log(
    `  設定：${settings.maxRounds} 往復・相手の応手は最大 ${settings.multiPV}・W ${settings.windowCp}・相手の局面 ${settings.movetimeMs / 1000} 秒・自分の局面 ${(settings.replyMs ?? 0) / 1000} 秒`,
  );
  console.log(`  エンジン：${EVALS[spec.evalId].label}・${threads} スレッド・ハッシュ ${hashMB}MB`);
  console.log(`  途中経過：${stateFile}`);
  console.log('  止めるとき：Ctrl+C（今の 1 局面が終わってから止まる）か、この画面を閉じる。続きは同じコマンドで');
  console.log('');

  const state = prepareState();
  if (state.finishedAt) {
    log('このツリーはもう作り終わっています。できあがりのファイルを書き出し直します');
    finish(state);
    return;
  }
  log(state.searched > 0 ? `続きから作ります（${statusLine(state)}）` : '作り始めます');

  const files = createEngineFiles({ log: (...a: unknown[]) => log(a.map(String).join(' ')) });
  const prepared = await files.prepareEngine(spec.evalId, (text) => log(text));
  log(`エンジンを起動します（版 ${prepared.id}）`);
  const { engine, transport } = await startNativeEngine(prepared.exe, { threads, hashMB });
  state.engine = {
    name: transport.engineName || 'YaneuraOu',
    build: prepared.id,
    evalId: spec.evalId,
    evalLabel: EVALS[spec.evalId].label,
    threads,
    hashMB,
    cpu: os.cpus()[0]?.model?.trim() || 'unknown',
  };
  log(`エンジン：${state.engine.name}（${state.engine.cpu}）`);
  const allowSleep = preventSleep();

  let lastCompleted = completedRounds(roundStats(state.tree, settings.maxRounds));
  const baker = new Baker(engine, state, {
    save: () => saveState(stateFile, state),
    onSearched: () => {
      const done = completedRounds(roundStats(state.tree, settings.maxRounds));
      if (done > lastCompleted) {
        lastCompleted = done;
        log(`${done} 往復目まで調べ終わりました（${statusLine(state)}）`);
        for (const l of roundReport(state, trial ? spec.settings.maxRounds : settings.maxRounds)) log(l);
      }
    },
    onSweep: (count) => log(`確定していない自分の手が ${count} 個あったので、調べて確定させます`),
  });

  const timer = setInterval(() => console.log(statusLine(state)), 60_000);
  let stopping = false;
  const onSignal = (name: string) => {
    if (stopping) {
      // 2 回目はすぐ終わる（途中経過は 1 局面ごとに保存済み）
      transport.close();
      process.exit(1);
    }
    stopping = true;
    log(`止めます（${name}）。今の 1 局面が終わるまで少し待ってください`);
    baker.stop();
  };
  process.on('SIGINT', () => onSignal('Ctrl+C'));
  // 画面を閉じたとき（Windows）。数秒で強制終了されるが、途中経過は 1 局面ごとに保存済み
  process.on('SIGHUP', () => {
    transport.close();
    process.exit(1);
  });
  process.on('SIGBREAK', () => onSignal('Ctrl+Break'));

  const result = await baker.run();
  clearInterval(timer);
  transport.close();
  allowSleep?.();

  if (result.kind === 'stopped') {
    log(`止めました。${statusLine(state)}。続きは同じコマンドで`);
    return;
  }
  if (result.kind === 'error') {
    log(`エラーで止まりました：${result.message}。途中経過は残っています。同じコマンドで続きから作れます`);
    process.exitCode = 1;
    return;
  }
  log(`作り終わりました（${statusLine(state)}）`);
  for (const l of roundReport(state, trial ? spec.settings.maxRounds : settings.maxRounds)) log(l);
  finish(state);
}

/** できあがりのファイルを書き出す（試しでは途中経過の場所に） */
function finish(state: BakeState): void {
  const file = buildBundle({
    state,
    id: spec.id,
    templateId: spec.templateId,
    version: spec.version,
    name: template.name,
    appVersion: pkg.version,
  });
  const problems = checkBundledTree(file, template.moves);
  if (problems.length > 0) {
    for (const p of problems.slice(0, 20)) log(`  点検：${p}`);
    fail('できあがったツリーの点検で問題が見つかりました（上の一覧）');
  }
  const outDir = trial ? workDir : path.join(documentsDir(), 'joban-tree-bake', spec.id);
  mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, bundledTreeFileName(spec.id, spec.version));
  writeAtomic(out, JSON.stringify(file));
  log(`書き出しました：${out}（${(JSON.stringify(file).length / 1024 / 1024).toFixed(2)}MB、局面 ${file.bundle.nodeCount.toLocaleString()}、かかった時間 ${formatDuration(file.bundle.elapsedMs)}）`);
  if (!trial) copyFileSync(logFile, path.join(outDir, 'log.txt'));
}

main().catch((error: unknown) => {
  log(`エラー：${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
