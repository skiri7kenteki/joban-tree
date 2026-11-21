// 段階12-3：覚えた割合の輪。色は app.css（tokens.css の変数）。段階13 でグループの見出しの「芽」の紋はやめた。

/** 覚えた割合の輪（learned／total。total が 0 なら何も出さない） */
export function LearnRing({ learned, total, size = 36, testId }: { learned: number; total: number; size?: number; testId?: string }) {
  if (total <= 0) return null;
  const pct = Math.round((learned / total) * 100);
  const r = 15;
  const len = 2 * Math.PI * r;
  return (
    <span class="learn-ring" style={{ width: `${size}px`, height: `${size}px` }} data-testid={testId} role="img" aria-label={`覚えた問題 ${learned}／${total}（${pct}%）`}>
      <svg viewBox="0 0 36 36" width={size} height={size} aria-hidden="true">
        <circle cx="18" cy="18" r={r} class="learn-ring-track" />
        {learned > 0 && (
          <circle cx="18" cy="18" r={r} class="learn-ring-arc" stroke-dasharray={`${(len * learned) / total} ${len}`} transform="rotate(-90 18 18)" />
        )}
      </svg>
      <span class="learn-ring-text num">{pct}%</span>
    </span>
  );
}
