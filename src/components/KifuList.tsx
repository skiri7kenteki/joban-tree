// 手順の一覧＝棋譜欄（段階11-5）。定跡帳・実戦の画面で同じ部品を使う。
//   - 1 行＝1 手（手数・手）。いちばん上は手を指す前の局面（「初期局面」「開始局面」）
//   - 今の局面の行を目立たせ、一覧の中だけをスクロールして見えるようにする（画面全体は動かさない）
//   - 行を押すとその局面へ。dim＝戦型の出発点より前の手（薄く）、ahead＝今の局面より先の手（少し薄く）
//   - iPad 横など広い画面では盤の横に常に出す（KifuPanel）。スマホ縦では手数のところを押すと画面下から開く（KifuSheet）

import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { Dialog } from './Dialog';

export interface KifuRow {
  /** 何手指した後の局面か（0＝指す前） */
  ply: number;
  /** 手（▲７六歩 など）。0 手目は局面の名前 */
  text: string;
  /** 出発点より前の手（薄く） */
  dim?: boolean;
  /** 今の局面より先の手（少し薄く） */
  ahead?: boolean;
  /** 押せない（出発点より前に戻らない画面） */
  disabled?: boolean;
  /** 右に小さく添える言葉（「出発点」など） */
  note?: string;
}

/** 広い画面（盤と操作を左右に並べる大きさ）か。CSS の @media と同じ条件 */
export const WIDE_QUERY = '(min-width: 768px) and (orientation: landscape)';

export function useWideLayout(): boolean {
  const query = typeof matchMedia === 'function' ? matchMedia(WIDE_QUERY) : null;
  const [wide, setWide] = useState(query?.matches ?? false);
  useEffect(() => {
    if (!query) return;
    const update = () => setWide(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return wide;
}

export function KifuList({ rows, current, onJump }: { rows: KifuRow[]; current: number; onJump: (ply: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);

  // 今の行が見えるように、一覧の中だけをスクロール（真ん中あたりへ）。
  // 画面下から開く窓では、窓が開く（高さが決まる）のはこの後なので、一覧の大きさが決まったときにもう一度
  useLayoutEffect(() => {
    const scroll = () => {
      const box = ref.current;
      const el = box?.querySelector<HTMLElement>('.kifu-row.current');
      if (!box || !el || box.clientHeight === 0) return;
      const top = el.offsetTop;
      const bottom = top + el.offsetHeight;
      if (top < box.scrollTop || bottom > box.scrollTop + box.clientHeight) box.scrollTop = Math.max(0, top - (box.clientHeight - el.offsetHeight) / 2);
    };
    scroll();
    if (typeof ResizeObserver !== 'function' || !ref.current) return;
    const watch = new ResizeObserver(scroll);
    watch.observe(ref.current);
    return () => watch.disconnect();
  }, [current, rows.length]);

  return (
    <div class="kifu-list" ref={ref} data-testid="kifu-list">
      {rows.map((r) => (
        <button
          type="button"
          key={r.ply}
          class={`kifu-row${r.ply === current ? ' current' : ''}${r.dim ? ' dim' : r.ahead ? ' ahead' : ''}`}
          data-testid="kifu-row"
          data-ply={r.ply}
          aria-current={r.ply === current ? 'step' : undefined}
          disabled={r.disabled}
          onClick={() => onJump(r.ply)}
        >
          <span class="kifu-ply num">{r.ply > 0 ? r.ply : ''}</span>
          <span class="kifu-move">{r.text}</span>
          {r.note && <span class="kifu-note">{r.note}</span>}
        </button>
      ))}
    </div>
  );
}

/** 広い画面：盤の横に常に出す棋譜欄 */
export function KifuPanel(props: { rows: KifuRow[]; current: number; onJump: (ply: number) => void }) {
  return (
    <section class="card kifu-panel" data-testid="kifu-panel" aria-label="手順">
      <KifuList {...props} />
    </section>
  );
}

/** スマホ縦：画面下から開く棋譜欄。行を押すとその局面へ移って閉じる */
export function KifuSheet({ rows, current, onJump, onClose }: { rows: KifuRow[]; current: number; onJump: (ply: number) => void; onClose: () => void }) {
  return (
    <Dialog title="手順" onClose={onClose} testId="kifu-sheet" sheet>
      <KifuList
        rows={rows}
        current={current}
        onJump={(ply) => {
          onJump(ply);
          onClose();
        }}
      />
    </Dialog>
  );
}
