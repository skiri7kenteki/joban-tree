// 盤の画面で、盤の幅の上限を決める（v0.12.2〜。段階14（v0.38.0〜）で決め方を変えた）。
// 段階14：盤の画面（定跡帳の盤・ツリー・新しいツリー・復習）は 1 画面に収め、ページ全体はスクロールしない。
//   上から 見出し → 盤 → 操作バー → 一覧の枠（.board-frame）。一覧の枠は残りの高さいっぱいで、入りきらない分は枠の中だけスクロールする。
//   盤は「枠の中で見せたいところ」が見える大きさまで縮める（measureFitFrame）：
//     ツリー・定跡帳：候補手・研究候補の 3 行目まで（threeRowsNeed。4 行目からは枠の中でスクロール）
//     新しいツリー：「自分は」の行まで。復習：問題のカードまで（いちばん下の数・記録を消すは枠の中でスクロール）
//   盤は MIN_BOARD_W より小さくしない（360×640 の定跡帳は 2 行＋スクロールになる。持ち主の判断 2026-11-22）。
//   iPad 横（盤と一覧を左右に並べる配置）は、盤と操作バーの列が画面の高さに収まる大きさ。
// 引く分は決め打ちにせず、実際の高さを測る（端末の文字を大きくしていても、その分だけ盤が縮む）。

import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';

type ElementRef = { readonly current: HTMLElement | null };

/** 盤と候補手を左右に並べる配置（app.css の .tree-layout と同じ条件） */
const SIDE_BY_SIDE = '(min-width: 768px) and (orientation: landscape)';
/** 候補手が 3 行に満たないときの 1 行の高さの見込み（px） */
const ROW_GUESS = 51;
/** 最後に収める行の下の、画面の端との余白（px） */
const BOTTOM_MARGIN = 4;
/** 一覧の枠の中で、最後に見せる行の下に残す余白（px。段階14。小数点以下の端数で行が画面の下端を越えない分だけ） */
const FRAME_MARGIN = 0.5;
/** 盤をこれより小さくはしない（px） */
const MIN_BOARD_W = 220;

/**
 * 段階14（v0.38.0〜）：盤の画面は 1 画面に収める（ページ全体はスクロールしない）。上から 見出し → 盤 → 操作バー → 一覧の枠（.board-frame）。
 * 一覧の枠の中で need px（3 行目の下端までなど。枠の中身の先頭から測る）が見える盤の幅を返す。
 * 枠は残りの高さいっぱいに伸びるので、盤を縮めた分だけ枠が広がる（1 回で落ち着く）。
 * 盤と一覧を左右に並べる配置（iPad 横）では、盤と操作バーの列が画面の高さに収まる幅
 */
export function measureFitFrame(board: HTMLElement, frame: HTMLElement | null, need: number): number | null {
  const svg = board.querySelector<SVGSVGElement>('svg.board');
  const screen = board.closest<HTMLElement>('.board-screen');
  if (!svg || !screen) return null;
  const svgRect = svg.getBoundingClientRect();
  if (svgRect.width === 0 || svgRect.height === 0) return null;
  let extra: number;
  if (window.matchMedia(SIDE_BY_SIDE).matches) {
    // 盤の列の中身（盤と操作バー）の下端から画面の下端まで（列そのものは画面の高さまで伸びているので、最後の要素で測る）
    const col = board.closest<HTMLElement>('.board-col') ?? board;
    const last = col.lastElementChild ?? col;
    extra = screen.getBoundingClientRect().bottom - last.getBoundingClientRect().bottom;
  } else {
    if (!frame) return null;
    extra = frame.clientHeight - need;
  }
  // 枠の中は下の余白をほとんど取らない（枠の下端が画面の下端。盤を今より小さくしないため。0.5px は小数点以下の端数の分）
  const availH = svgRect.height + extra - (window.matchMedia(SIDE_BY_SIDE).matches ? BOTTOM_MARGIN : FRAME_MARGIN);
  return Math.max(MIN_BOARD_W, Math.floor((availH * svgRect.width) / svgRect.height));
}

/** 一覧の枠（frame）の中身の先頭から、el の下端までの高さ（枠がスクロールしていても同じ値） */
export function bottomInFrame(frame: HTMLElement, el: Element): number {
  return el.getBoundingClientRect().bottom - frame.getBoundingClientRect().top + frame.scrollTop;
}

/**
 * 一覧の枠の中で 3 行目の下端までの高さ（行が 3 つに満たないときは、あるとして同じだけ空ける。盤の大きさを局面で変えないため）。
 * rows：行の要素、head：行の上の見出し（行が 0 のとき、その下から数える）
 */
export function threeRowsNeed(frame: HTMLElement, rows: ArrayLike<HTMLElement>, head: HTMLElement | null, rowGuess = ROW_GUESS): number {
  if (rows.length >= 3) return bottomInFrame(frame, rows[2]);
  const last = rows.length > 0 ? rows[rows.length - 1] : head;
  const lastBottom = last ? bottomInFrame(frame, last) : 0;
  const rowH = rows.length > 0 ? rows[0].getBoundingClientRect().height : rowGuess;
  return lastBottom + (3 - rows.length) * rowH;
}

/**
 * 盤の幅の上限を返す（描くたびと、画面の大きさが変わったときに測り直す）。measure は上の measure… のどれかを呼ぶ。
 * 盤の幅を変えても、盤の上の部分・盤の下の操作の高さは変わらないので、測り直しても同じ値に落ち着く。
 * 返した値は boardFitProps で盤を包む要素に渡す。
 */
export function useBoardFit(boardRef: ElementRef, measure: (board: HTMLElement) => number | null): number | null {
  const [fit, setFit] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  /** 1 つ前に決めた値（段階14：2 つの値を行ったり来たりしたら、小さい方で止める） */
  const before = useRef<number | null>(null);

  useLayoutEffect(() => {
    const board = boardRef.current;
    if (!board) return;
    let next = measure(board);
    if (next === fit || (next !== null && fit !== null && Math.abs(next - fit) < 1)) return;
    if (next !== null && fit !== null && before.current !== null && Math.abs(next - before.current) < 1) next = Math.min(next, fit);
    before.current = fit;
    if (next !== fit) setFit(next);
  });

  useEffect(() => {
    const again = () => setTick((n) => n + 1);
    window.addEventListener('resize', again);
    window.visualViewport?.addEventListener('resize', again);
    // 生成中の表示が出入りするなど、画面の中身の高さが変わったときも測り直す
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(again) : null;
    const main = boardRef.current?.closest('.main');
    if (observer && main) observer.observe(main);
    // 段階14：1 画面に収める画面は外の箱の高さが変わらないので、中の見出し・★ の行・一覧の枠の高さの変化も見る
    const screen = boardRef.current?.closest('.board-screen');
    if (observer && screen) {
      for (const child of Array.from(screen.children)) observer.observe(child);
      // 枠そのものの高さは変わらないことが多いので、枠の中の部品（候補手のカードなど）の高さの変化も見る
      screen.querySelectorAll('.board-frame').forEach((el) => {
        observer.observe(el);
        for (const child of Array.from(el.children)) observer.observe(child);
      });
    }
    // 見出しの字体を読み終えて行の高さが変わったときも
    void document.fonts?.ready.then(again);
    return () => {
      window.removeEventListener('resize', again);
      window.visualViewport?.removeEventListener('resize', again);
      observer?.disconnect();
    };
  }, []);

  void tick;
  return fit;
}

/** 盤を包む要素に付ける class と style（app.css の .board-fit。盤を --board-fit-w までにして左右の真ん中に置く） */
export function boardFitProps(fit: number | null, base: string): { class: string; style?: Record<string, string> } {
  return fit === null ? { class: base } : { class: `${base} board-fit`, style: { '--board-fit-w': `${fit}px` } };
}
