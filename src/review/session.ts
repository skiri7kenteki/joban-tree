// 復習の「1 回」（段階11-4、持ち主の判断 2026-11-20「おすすめの通りで」）：決まった数（初期値 10。設定で 5／10／20）の問題で 1 回が終わる。
// 出題の選び方（まだ出していない・前回まちがえた問題が出やすい）は今のまま（review.ts・studyReview.ts）。ここは 1 回分の数え方だけ。
//   - 1 問＝自分の手番で 1 回目に答えたとき（「もう一度」は数えない。記録と同じ）
//   - 決まった数を答えたら、その問題の答えを見せた後で結果へ（手順の途中でも）
//   - 結果：正解の数（1 回目で）、まちがえた問題（その局面・正しい手・指した手）
// ツリーの復習（ReviewScreen）と研究手順の復習（StudyReviewScreen）で同じものを使う。記録の形は変えない

/** 1 回の中の 1 問の結果 */
export interface SessionItem {
  /** 問題の局面（SFEN） */
  sfen: string;
  /** その局面の直前の手（相手の手。盤に印を付ける） */
  lastMove?: string;
  /** 正しい手（USI） */
  answer: string;
  /** 1 回目に指した手（まちがえたときだけ） */
  tried?: string;
  /** 1 回目で正解したか */
  ok: boolean;
}

/** 1 回分の復習 */
export interface ReviewSession {
  /** 1 回の問題の数 */
  limit: number;
  items: SessionItem[];
}

export function newSession(limit: number): ReviewSession {
  return { limit: Math.max(1, Math.round(limit)), items: [] };
}

/** 1 問の結果を足す（元の値は変えない） */
export function addItem(session: ReviewSession, item: SessionItem): ReviewSession {
  return { ...session, items: [...session.items, item] };
}

/** 決まった数を答え終わったか */
export function sessionDone(session: ReviewSession): boolean {
  return session.items.length >= session.limit;
}

/** 答えた数と、1 回目で正解した数 */
export function sessionScore(session: ReviewSession): { asked: number; ok: number } {
  return { asked: session.items.length, ok: session.items.filter((i) => i.ok).length };
}

/** まちがえた問題（答えた順） */
export function sessionMistakes(session: ReviewSession): SessionItem[] {
  return session.items.filter((i) => !i.ok);
}

/**
 * 今の 1 回の進み具合の文（「今日 3／10問」）。asking：今、問題を出しているか（出している問題も数える）。
 * 答えた数が決まった数を超えることはないので、表示も超えない
 */
export function progressText(session: ReviewSession, asking: boolean): string {
  const n = Math.min(session.limit, session.items.length + (asking ? 1 : 0));
  return `今日 ${n}／${session.limit}問`;
}
