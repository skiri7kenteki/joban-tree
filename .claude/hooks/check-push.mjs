// git push の前に、遠くのリポジトリより遅れていないかを確かめる（PreToolUse フック。Bash と PowerShell の両方）。
// 遅れていれば push を止めて「先に git pull --rebase」と Claude Code に返す。
// git push を見たときは、check-push.log に 1 行ずつ残す（フックが自動で呼ばれたかを後から確かめるため）。
import { execSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';

const LOG = new URL('./check-push.log', import.meta.url);

/** 記録を 1 行足す（日時・道具・結果・コマンド）。書けなくてもフックは止めない */
function record(tool, command, result) {
  try {
    const time = new Date().toLocaleString('sv-SE'); // 例 2026-11-25 12:34:56
    // JSON.stringify で、何行もあるコマンドも 1 行にする
    appendFileSync(LOG, `${time}\t${tool}\t${result}\t${JSON.stringify(command)}\n`);
  } catch {
    // 何もしない
  }
}

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => (input += chunk));
process.stdin.on('end', () => {
  let tool = '?';
  let command = '';
  try {
    const data = JSON.parse(input);
    tool = data?.tool_name ?? '?';
    command = data?.tool_input?.command ?? ''; // Bash も PowerShell も同じ項目名
  } catch {
    process.exit(0); // 読めなければ何もしない
  }

  const pushAt = command.search(/\bgit\s+push\b/);
  if (pushAt < 0) process.exit(0); // push でなければ何もしない

  /** 記録してから終わる。code 2 = この操作を止める */
  const finish = (code, result) => {
    record(tool, command, result);
    process.exit(code);
  };

  // 同じコマンドの中で、push の前に pull --rebase しているならよい。
  // --rebase は git pull と同じ区切りの中（; & | と改行をまたがない）にあるものだけを数える
  const before = command.slice(0, pushAt);
  if (/\bgit\s+pull\b[^;&|\n]*\s--rebase\b/.test(before)) finish(0, '通した（同じコマンドで先に pull --rebase）');

  try {
    execSync('git fetch --quiet', { stdio: 'ignore', timeout: 30000 });
    const behind = Number(
      execSync('git rev-list --count HEAD..@{u}', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(),
    );
    if (behind > 0) {
      console.error(`遠くのリポジトリが ${behind} 件進んでいます。push の前に git pull --rebase してください（CLAUDE.md の進め方）。`);
      finish(2, `止めた（${behind} 件遅れ）`); // 2 = この操作を止めて、理由を Claude Code に返す
    }
  } catch {
    // ネットにつながらない・追いかける枝が無いときは止めない
    finish(0, '通した（遅れを確かめられなかった）');
  }
  finish(0, '通した（遅れなし）');
});
