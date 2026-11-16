// スマホ縦（盤と操作を上下に並べる配置）で、盤の下の大事な所がスクロールせずに見えるよう、盤の幅の上限を決める（v0.12.2〜）。
// 引く分は決め打ちにせず、実際の高さを測る（端末の文字を大きくしていても、その分だけ盤が縮む）。
// iPad 横など、盤と操作を左右に並べる配置では制限しない。
//   閲覧画面：候補手（measureBoardFit。下の決め方）
//   入力画面：盤・持ち駒・手順の操作（‹ ›）を、下に固定した作るボタンのバーの上に（v0.12.4、measureFitAbove）
//   復習画面：盤と問題のカード（問題の文・答えの操作）を画面の中に（v0.12.4、measureFitAbove）
//
// 閲覧画面の決め方（v0.12.3）：
//
//   （持ち主の依頼。「ふつう」「じっくり」は候補手を 4 つ取るので、4 つ目があることに気づけるように）
//   1. 3 行目までは必ず収める（盤は MIN_BOARD_W より小さくしない）
//   2. 候補手が 4 つ以上あり、盤の幅を画面幅の KEEP_RATIO 以上に保ったまま 4 行目まで収まるなら、4 行目まで収める
//   3. 収まらなければ、4 行目の上半分が画面の下に見える（のぞく）ようにする。ただし、のぞかせるために KEEP_RATIO 未満には縮めない
//   4. 5 つ以上でも目標は 4 行まで（5 行目からはスクロール）

import { useEffect, useLayoutEffect, useState } from 'preact/hooks';

type ElementRef = { readonly current: HTMLElement | null };

/** 盤と候補手を左右に並べる配置（app.css の .tree-layout と同じ条件） */
const SIDE_BY_SIDE = '(min-width: 768px) and (orientation: landscape)';
/** 候補手が 3 行に満たないときの 1 行の高さの見込み（px） */
const ROW_GUESS = 51;
/** 最後に収める行の下の、画面の端との余白（px） */
const BOTTOM_MARGIN = 4;
/** 盤をこれより小さくはしない（px）。とても低い画面（スマホの横向きなど）では、スクロールしてもらう */
const MIN_BOARD_W = 220;
/** 4 行目を見せる（収める・のぞかせる）ために、盤をここまでは縮めてよい（画面幅に対する割合。仮の値） */
export const KEEP_RATIO = 0.85;
/** 4 行目をのぞかせるときに見せる、行の高さの割合 */
const PEEK_RATIO = 0.5;

/**
 * 盤（SVG）の下端から target の下端までと、画面の下に固定したもの（reserve px）を残して、盤が画面に収まる幅（px）。
 * skip の要素（成る・成らないの小窓など、一時的に出るもの）の高さは数えない（盤の大きさが変わらないように）。
 * 盤と操作を左右に並べる配置では null（制限しない）
 */
export function measureFitAbove(board: HTMLElement, target: HTMLElement | null, reserve = 0, skip: (HTMLElement | null)[] = []): number | null {
  if (window.matchMedia(SIDE_BY_SIDE).matches || !target) return null;
  const svg = board.querySelector<SVGSVGElement>('svg.board');
  if (!svg) return null;
  const svgRect = svg.getBoundingClientRect();
  if (svgRect.width === 0 || svgRect.height === 0) return null;
  const skipped = skip.reduce((sum, el) => sum + (el ? el.getBoundingClientRect().height : 0), 0);
  const below = target.getBoundingClientRect().bottom - svgRect.bottom - skipped;
  const availH = window.innerHeight - reserve - (svgRect.top + window.scrollY) - below - BOTTOM_MARGIN;
  return Math.max(MIN_BOARD_W, Math.floor((availH * svgRect.width) / svgRect.height));
}

/** 閲覧画面：盤の幅の上限（px）を測る。制限しないときは null */
export function measureBoardFit(board: HTMLElement, side: HTMLElement): number | null {
  if (window.matchMedia(SIDE_BY_SIDE).matches) return null;
  const svg = board.querySelector<SVGSVGElement>('svg.board');
  const wrap = board.querySelector<HTMLElement>('.board-wrap');
  const crumb = side.querySelector<HTMLElement>('.crumb-row');
  const card = side.querySelector<HTMLElement>('.candidates');
  if (!svg || !wrap || !crumb || !card) return null;
  const svgRect = svg.getBoundingClientRect();
  if (svgRect.width === 0 || svgRect.height === 0) return null;
  const wrapRect = wrap.getBoundingClientRect();
  const cardRect = card.getBoundingClientRect();

  // 盤（SVG）の上端（ページの先頭から。スクロールしていても同じ値）
  const svgTop = svgRect.top + window.scrollY;
  // 盤の下：先手の持ち駒の行、盤とパンくずの間
  const belowSvg = wrapRect.bottom - svgRect.bottom;
  const gap = side.getBoundingClientRect().top - wrapRect.bottom;
  // パンくずの行（下の余白を含む）。「別の手を調べる」の案内などは数えない（盤の大きさが変わらないように）
  const crumbH = crumb.offsetHeight + parseFloat(getComputedStyle(crumb).marginBottom || '0');
  /** 候補手のカードの上端から y（画面上の位置）までを画面に収める盤の幅 */
  const widthFor = (y: number) => {
    const availH = window.innerHeight - svgTop - belowSvg - gap - crumbH - (y - cardRect.top) - BOTTOM_MARGIN;
    return Math.floor((availH * svgRect.width) / svgRect.height);
  };

  // 1. 3 行目の下端まで
  const rows = card.querySelectorAll<HTMLElement>('[data-testid="candidate"]');
  let third: number;
  if (rows.length >= 3) {
    third = rows[2].getBoundingClientRect().bottom;
  } else {
    const last = rows.length > 0 ? rows[rows.length - 1] : card.querySelector<HTMLElement>('.candidates-head');
    const lastBottom = last ? last.getBoundingClientRect().bottom : cardRect.top;
    const rowH = rows.length > 0 ? rows[0].getBoundingClientRect().height : ROW_GUESS;
    third = lastBottom + (3 - rows.length) * rowH;
  }
  const w3 = Math.max(MIN_BOARD_W, widthFor(third));
  if (rows.length < 4) return w3;

  // 2・3. 4 行目：収める → のぞかせる（どちらも、盤を画面幅の KEEP_RATIO 未満には縮めない）
  const keep = Math.ceil(document.documentElement.clientWidth * KEEP_RATIO);
  const fourth = rows[3].getBoundingClientRect();
  const w4 = widthFor(fourth.bottom);
  if (w4 >= keep) return Math.min(w3, w4);
  const peek = widthFor(fourth.top + fourth.height * PEEK_RATIO);
  return Math.min(w3, Math.max(peek, keep));
}

/**
 * 盤の幅の上限を返す（描くたびと、画面の大きさが変わったときに測り直す）。measure は上の measure… のどれかを呼ぶ。
 * 盤の幅を変えても、盤の上の部分・盤の下の操作の高さは変わらないので、測り直しても同じ値に落ち着く。
 * 返した値は boardFitProps で盤を包む要素に渡す。
 */
export function useBoardFit(boardRef: ElementRef, measure: (board: HTMLElement) => number | null): number | null {
  const [fit, setFit] = useState<number | null>(null);
  const [tick, setTick] = useState(0);

  useLayoutEffect(() => {
    const board = boardRef.current;
    if (!board) return;
    const next = measure(board);
    if (next !== fit && !(next !== null && fit !== null && Math.abs(next - fit) < 1)) setFit(next);
  });

  useEffect(() => {
    const again = () => setTick((n) => n + 1);
    window.addEventListener('resize', again);
    window.visualViewport?.addEventListener('resize', again);
    // 生成中の表示が出入りするなど、画面の中身の高さが変わったときも測り直す
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(again) : null;
    const main = boardRef.current?.closest('.main');
    if (observer && main) observer.observe(main);
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
