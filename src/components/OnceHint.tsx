// 初めての 1 回だけ出す説明（段階11-3）。出したときに端末に「見た」を覚え、次に開いたときからは出さない。
// 端末に覚えられない（プライベートモードなど）ときは、アプリを開き直すたびに 1 回出る。

import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { takeHint, type HintId } from '../app/recent';

export function OnceHint({ id, children }: { id: HintId; children: ComponentChildren }) {
  // 最初に描いたときだけ決める（同じ画面を開いている間は出したまま）
  const [show] = useState(() => takeHint(id));
  if (!show) return null;
  return (
    <p class="muted once-hint" data-testid={`hint-${id}`}>
      {children}
    </p>
  );
}
