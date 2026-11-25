// git push の前に、遠くのリポジトリより遅れていないかを確かめる（PreToolUse フック）。
// 遅れていれば push を止めて「先に git pull --rebase」と Claude Code に返す。
import { execSync } from 'node:child_process';

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => (input += chunk));
process.stdin.on('end', () => {
  let command = '';
  try {
    command = JSON.parse(input)?.tool_input?.command ?? '';
  } catch {
    process.exit(0); // 読めなければ何もしない
  }

  const pushAt = command.search(/\bgit\s+push\b/);
  if (pushAt < 0) process.exit(0); // push でなければ何もしない

  // 同じコマンドの中で、push の前に pull --rebase しているならよい
  const before = command.slice(0, pushAt);
  if (/\bgit\s+pull\s+(.*\s)?--rebase\b/.test(before)) process.exit(0);

  try {
    execSync('git fetch --quiet', { stdio: 'ignore', timeout: 30000 });
    const behind = Number(
      execSync('git rev-list --count HEAD..@{u}', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(),
    );
    if (behind > 0) {
      console.error(`遠くのリポジトリが ${behind} 件進んでいます。push の前に git pull --rebase してください（CLAUDE.md の進め方）。`);
      process.exit(2); // 2 = この操作を止めて、理由を Claude Code に返す
    }
  } catch {
    // ネットにつながらない・追いかける枝が無いときは止めない
  }
  process.exit(0);
});
