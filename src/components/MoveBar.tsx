// 盤の下のバー（段階11-2）：「|‹  ‹  [17手目 ▲3六飛 ▾]  ›  ›|」。
// 定跡帳・稽古・実戦の画面で同じ部品を使い、どの画面も盤のすぐ下に置く（段階14）。
//   - 真ん中を押すと手順の一覧（棋譜欄）が開く（onCenter があるとき。広い画面では棋譜欄が盤の横に出ているので押しても何もしない）

import type { ComponentChildren, Ref } from 'preact';

export interface MoveBarProps {
  /** 真ん中に出す文字（「17手目 ▲3六飛」など） */
  children: ComponentChildren;
  /** 真ん中を押したとき（手順の一覧を開く）。無ければ文字だけ */
  onCenter?: () => void;
  /** onCenter が手順の一覧でないときの読み上げの名前（「▾」を付けない） */
  centerLabel?: string;
  onFirst?: () => void;
  onPrev: () => void;
  onNext: () => void;
  onLast?: () => void;
  canPrev: boolean;
  canNext: boolean;
  /** テストで使う名前（bar・first・prev・center・next・last） */
  ids: { bar: string; first?: string; prev: string; center: string; next: string; last?: string };
  /** 「|‹」の読み上げの名前（「出発点（基本図）へ」など） */
  firstLabel?: string;
  barRef?: Ref<HTMLDivElement>;
}

export function MoveBar(p: MoveBarProps) {
  return (
    <div class="move-bar" ref={p.barRef} data-testid={p.ids.bar}>
      <div class="move-bar-inner">
        {p.onFirst && (
          <button type="button" class="move-bar-btn" aria-label={p.firstLabel ?? '最初へ'} data-testid={p.ids.first} onClick={p.onFirst} disabled={!p.canPrev}>
            |‹
          </button>
        )}
        <button type="button" class="move-bar-btn" aria-label="1手戻る" data-testid={p.ids.prev} onClick={p.onPrev} disabled={!p.canPrev}>
          ‹
        </button>
        {p.onCenter ? (
          <button type="button" class={p.centerLabel ? 'move-bar-center move-bar-action num' : 'move-bar-center kifu-open num'} aria-label={p.centerLabel ?? '手順の一覧'} data-testid={p.ids.center} onClick={p.onCenter}>
            {p.children}
          </button>
        ) : (
          <div class="move-bar-center num" data-testid={p.ids.center}>
            {p.children}
          </div>
        )}
        <button type="button" class="move-bar-btn" aria-label="1手進む" data-testid={p.ids.next} onClick={p.onNext} disabled={!p.canNext}>
          ›
        </button>
        {p.onLast && (
          <button type="button" class="move-bar-btn" aria-label="最後へ" data-testid={p.ids.last} onClick={p.onLast} disabled={!p.canNext}>
            ›|
          </button>
        )}
      </div>
    </div>
  );
}
