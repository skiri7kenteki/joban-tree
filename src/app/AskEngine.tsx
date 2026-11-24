// 「エンジンに聞く」の窓（段階20-2、v0.45.0〜。持ち主の判断 2026-11-24「全ておすすめの通りで」。計算は src/tree/ask.ts）。
// 定跡帳の今の局面だけを数秒調べて、候補を画面の下の窓に出す。結果は保存しない。
//
// - 相手の手番：相手の候補 4 つ（本線・有力・疑問手・評価値・自分の対応）。研究にある手は［進む］、無い手は［足す］（相手の手と自分の対応の 2 手）
// - 自分の手番：自分の候補 3 つ（最善・最善から −n）。研究にある手は［進む］、無い手は［足す］（その 1 手）
// - 研究の手が候補に入っていなければ、その手だけをもう一度調べて並べる（2 秒まで）
// - 窓を閉じたら探索を止める。ツリーの生成中は使えない（同じエンジンを使うため）

import { useEffect, useRef, useState } from 'preact/hooks';
import { Dialog } from '../components/Dialog';
import { EVALS } from '../engine/config';
import { formatScore } from '../engine/usi';
import type { UsiEngine } from '../engine/engine';
import { applyUsiMove, moveText, positionCommand, sideToMove, type Side } from '../shogi/position';
import { ASK_EXTRA_MAX_MS, ASK_MORE_MS, ASK_MS, askMultiPV, askRows, lossText, missingBookMoves, type AskRow } from '../tree/ask';
import { LABEL_TEXT, labelOf } from '../tree/labels';
import { getEngine, pcEngine } from './engineService';
import { isGenerating } from './generation';
import { settings } from './settings';

/** 探索の進み具合 */
type Phase =
  | { kind: 'load' }
  | { kind: 'search'; ms: number; run: number }
  | { kind: 'extra'; ms: number; run: number }
  | { kind: 'done'; ms: number; rows: AskRow[] }
  | { kind: 'error'; text: string };

export function AskEngine({
  sfen,
  mySide,
  prev,
  place,
  bookMoves,
  write,
  onAdvance,
  onAdd,
  onClose,
}: {
  sfen: string;
  /** 定跡帳の自分の側 */
  mySide: Side;
  /** 直前の手（「同」の表示用） */
  prev: string | undefined;
  /** 「16手目 △3三角 の局面」 */
  place: string;
  /** この局面からの研究の手（手順前後の手も含む） */
  bookMoves: readonly string[];
  /** 盤で指して書き込む（切なら［足す］は使えない） */
  write: boolean;
  onAdvance: (move: string) => void;
  /** 手順を足す（相手の手番なら相手の手と自分の対応の 2 手） */
  onAdd: (moves: string[]) => void;
  onClose: () => void;
}) {
  const mine = sideToMove(sfen) === mySide;
  const generating = isGenerating();
  const [phase, setPhase] = useState<Phase>(generating ? { kind: 'error', text: 'ツリーを生成中なので、エンジンを使えません。生成が終わるか止めてから聞いてください。' } : { kind: 'load' });
  /** 何回目の探索か（窓を閉じた・調べ直したら、前の探索の結果は使わない） */
  const runId = useRef(0);
  const engineRef = useRef<UsiEngine | null>(null);

  async function run(ms: number) {
    const run = ++runId.current;
    const alive = () => runId.current === run;
    setPhase({ kind: 'load' });
    try {
      const engine = await getEngine();
      if (!alive()) return;
      engineRef.current = engine;
      const position = positionCommand(sfen);
      setPhase({ kind: 'search', ms, run });
      const r = await engine.analyze(position, { movetimeMs: ms, multiPV: askMultiPV(sfen, mySide) });
      if (!alive()) return;
      // 研究の手が候補に入っていなければ、その手だけを調べ直す
      const missing = missingBookMoves(r.lines, bookMoves);
      let extra: typeof r.lines = [];
      if (missing.length > 0 && r.lines.length > 0) {
        const extraMs = Math.min(ASK_EXTRA_MAX_MS, ms);
        setPhase({ kind: 'extra', ms: extraMs, run });
        extra = (await engine.analyze(position, { movetimeMs: extraMs, multiPV: missing.length, searchMoves: missing })).lines;
        if (!alive()) return;
      }
      setPhase({ kind: 'done', ms, rows: askRows(sfen, mySide, r.lines, extra, bookMoves) });
    } catch (e) {
      if (alive()) setPhase({ kind: 'error', text: `エンジンを使えませんでした（${e instanceof Error ? e.message : String(e)}）` });
    }
  }

  // 開いたらすぐ 3 秒。閉じたら探索を止める
  useEffect(() => {
    if (!generating) void run(ASK_MS);
    return () => {
      const searching = runId.current > 0;
      runId.current++;
      if (searching) engineRef.current?.stop();
    };
  }, []);

  const running = phase.kind === 'load' || phase.kind === 'search' || phase.kind === 'extra';
  const evalName = pcEngine.value ? `PC・${EVALS[settings.value.evalId].label}` : EVALS[settings.value.evalId].label;
  const sec = phase.kind === 'done' || phase.kind === 'search' ? `${phase.ms / 1000}秒・` : '';
  const sideName = mySide === 'black' ? '☗先手' : '☖後手';

  return (
    <Dialog title={mine ? 'エンジンに聞く：自分の候補' : 'エンジンに聞く：相手の候補'} onClose={onClose} testId="ask-dialog" sheet>
      <p class="muted memo-sub" data-testid="ask-sub">
        {place}・{sec}
        {evalName}・評価値は{sideName}から
      </p>
      {phase.kind === 'load' && <p class="muted ask-status">エンジンを読み込んでいます…</p>}
      {(phase.kind === 'search' || phase.kind === 'extra') && (
        <>
          <div class="ask-progress" aria-hidden="true">
            <i key={`${phase.kind}-${phase.run}`} style={{ animationDuration: `${phase.ms}ms` }} />
          </div>
          <p class="muted ask-status" role="status" data-testid="ask-status">
            {phase.kind === 'search' ? `調べています（${phase.ms / 1000}秒）` : '研究の手を調べています'}
          </p>
        </>
      )}
      {phase.kind === 'error' && (
        <p class="notice" data-testid="ask-error">
          {phase.text}
        </p>
      )}
      {phase.kind === 'done' && phase.rows.length === 0 && <p class="muted ask-status">候補がありません（詰みの局面など）。</p>}
      {phase.kind === 'done' && phase.rows.length > 0 && (
        <>
          {!write && <p class="muted ask-status">読むだけにしているので、足せません（⋯ の「書き込む」で入にできます）。</p>}
          <ul class="ask-list" data-testid="ask-list">
            {phase.rows.map((row) => (
              <AskRowItem key={row.move} row={row} sfen={sfen} prev={prev} mine={mine} write={write} onAdvance={onAdvance} onAdd={onAdd} />
            ))}
          </ul>
        </>
      )}
      <div class="dialog-actions">
        {!generating && (
          <button type="button" class="btn" data-testid="ask-more" disabled={running} onClick={() => void run(ASK_MORE_MS)}>
            もっと調べる（{ASK_MORE_MS / 1000}秒）
          </button>
        )}
        <button type="button" class="btn dialog-action-end" data-testid="ask-close" onClick={onClose}>
          閉じる
        </button>
      </div>
    </Dialog>
  );
}

function AskRowItem({
  row,
  sfen,
  prev,
  mine,
  write,
  onAdvance,
  onAdd,
}: {
  row: AskRow;
  sfen: string;
  prev: string | undefined;
  mine: boolean;
  write: boolean;
  onAdvance: (move: string) => void;
  onAdd: (moves: string[]) => void;
}) {
  const text = moveText(sfen, row.move, prev);
  const after = applyUsiMove(sfen, row.move)?.sfen;
  const reply = row.reply && after ? moveText(after, row.reply, row.move) : '';
  const label = labelOf(row.diff, settings.value.thresholds);
  return (
    <li class="ask-row" data-testid="ask-row" data-move={row.move} data-in-book={row.inBook ? 'true' : 'false'}>
      <div class="ask-main">
        <span class="ask-move">{text}</span>
        {mine ? (
          <span class={row.diff === 0 ? 'ask-loss ask-best' : 'ask-loss'}>{lossText(row.diff)}</span>
        ) : (
          <span class={`chip chip-${label} chip-small`}>{LABEL_TEXT[label]}</span>
        )}
        {row.inBook && <span class="ask-has">研究あり</span>}
        {reply && <span class="ask-reply">→ {reply}</span>}
      </div>
      <span class="ask-score num">{formatScore(row.score)}</span>
      {row.inBook ? (
        <button type="button" class="btn ask-btn" data-testid="ask-advance" onClick={() => onAdvance(row.move)}>
          進む
        </button>
      ) : (
        <button
          type="button"
          class="btn ask-btn"
          data-testid="ask-add"
          disabled={!write}
          aria-label={!mine && reply ? `${text} と ${reply} を足す` : `${text} を足す`}
          onClick={() => onAdd(!mine && row.reply ? [row.move, row.reply] : [row.move])}
        >
          足す
        </button>
      )}
    </li>
  );
}
