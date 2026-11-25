// Claude Code のステータスライン：モデルの名前と、コンテキスト（会話の長さ）の使用率を 1 行で出す。
// 受け取る JSON（標準入力）の項目は https://code.claude.com/docs/en/statusline の通り：
//   model.display_name（例 "Opus"）、context_window.used_percentage（0〜100。会話の始めは null のことがある）
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => (input += chunk));
process.stdin.on('end', () => {
  let data = {};
  try {
    data = JSON.parse(input);
  } catch {
    // 読めなければ空のまま
  }
  const model = data?.model?.display_name ?? data?.model?.id ?? '?';
  const used = data?.context_window?.used_percentage;
  const context = typeof used === 'number' ? `${Math.round(used)}%` : '—';
  console.log(`${model} ・ コンテキスト ${context}`);
});
