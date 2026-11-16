// 閲覧画面のスマホ縦（上下に並べる配置）で、候補手 3 行がスクロールせずに見えるよう、盤の幅の上限を決める（v0.12.2）。
// 盤の大きさ ＝「画面の幅」と「画面の高さから、盤の上の部分・持ち駒の行・パンくず・候補手の見出し・候補手 3 行を引いた高さ」の小さい方。
// 引く分は決め打ちにせず、実際の高さを測る（端末の文字を大きくしていても、その分だけ盤が縮む）。
// iPad 横など、盤と候補手を左右に並べる配置では制限しない。

import { useEffect, useLayoutEffect, useState } from 'preact/hooks';

type ElementRef = { readonly current: HTMLElement | null };

/** 盤と候補手を左右に並べる配置（app.css の .tree-layout と同じ条件） */
const SIDE_BY_SIDE = '(min-width: 768px) and (orientation: landscape)';
/** 候補手が 3 行に満たないときの 1 行の高さの見込み（px） */
const ROW_GUESS = 51;
/** 3 行目の下の、画面の端との余白（px） */
const BOTTOM_MARGIN = 4;
/** 盤をこれより小さくはしない（px）。とても低い画面（スマホの横向きなど）では、スクロールしてもらう */
const MIN_BOARD_W = 220;

/** 盤の幅の上限（px）を測る。制限しないときは null */
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
  // 候補手のカードの上端から、3 行目の下端まで
  const rows = card.querySelectorAll<HTMLElement>('[data-testid="candidate"]');
  let cardH: number;
  if (rows.length >= 3) {
    cardH = rows[2].getBoundingClientRect().bottom - cardRect.top;
  } else {
    const last = rows.length > 0 ? rows[rows.length - 1] : card.querySelector<HTMLElement>('.candidates-head');
    const lastBottom = last ? last.getBoundingClientRect().bottom : cardRect.top;
    const rowH = rows.length > 0 ? rows[0].getBoundingClientRect().height : ROW_GUESS;
    cardH = lastBottom - cardRect.top + (3 - rows.length) * rowH;
  }

  const availH = window.innerHeight - svgTop - belowSvg - gap - crumbH - cardH - BOTTOM_MARGIN;
  const width = Math.floor((availH * svgRect.width) / svgRect.height);
  return Math.max(MIN_BOARD_W, width);
}

/**
 * 盤の幅の上限を返す（描くたびと、画面の大きさが変わったときに測り直す）。
 * 盤の幅を変えても、盤の上の部分・パンくず・候補手の高さは変わらないので、測り直しても同じ値に落ち着く。
 */
export function useBoardFit(boardRef: ElementRef, sideRef: ElementRef): number | null {
  const [fit, setFit] = useState<number | null>(null);
  const [tick, setTick] = useState(0);

  useLayoutEffect(() => {
    const board = boardRef.current;
    const side = sideRef.current;
    if (!board || !side) return;
    const next = measureBoardFit(board, side);
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
