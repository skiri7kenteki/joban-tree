// 名前を空白ごとの語にして、語の途中では折り返さない（段階13）。
// 研究手順の名前「▲３六飛 △５二玉 ▲５八玉」が「▲５八／玉」や「▲／５八玉」のように手の途中で折れないように。
// 語は .word（white-space: nowrap）。入りきらないほど長い語だけ、語の途中で折り返す（app.css）。文字はそのまま（空白も残す）

export function Words({ text }: { text: string }) {
  const parts = text.split(/(\s+)/);
  return (
    <>
      {parts.map((p, i) => (p === '' ? null : /^\s+$/.test(p) ? p : <span key={i} class="word">{p}</span>))}
    </>
  );
}
