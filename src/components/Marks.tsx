// 段階12-3：小さな印（グループの見出しの「芽」の紋・覚えた割合の輪）。色は app.css（tokens.css の変数）。

/** アプリのアイコンの「芽」を金の線で描いた小さな紋（グループの見出し・「この局面からの研究」の見出しの左） */
export function SproutMark() {
  return (
    <span class="sprout-mark" aria-hidden="true">
      <svg viewBox="2 4 20 18" width="17" height="17">
        <path d="M7 20.5 H17" class="sprout-line" />
        <path d="M12 20.5 V11" class="sprout-line" />
        <path d="M12 16.2 C9.2 16.2 6.7 14.7 6.2 11.4 C9.2 11.3 11.6 13 12 16.2 Z" class="sprout-leaf" />
        <path d="M12 13.6 C14.9 13.6 17.3 11.9 17.8 8.7 C14.9 8.5 12.4 10.5 12 13.6 Z" class="sprout-leaf" />
        <circle cx="12" cy="9.2" r="1.9" class="sprout-bud" />
      </svg>
    </span>
  );
}

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
