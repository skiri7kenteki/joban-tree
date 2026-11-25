// 「エンジンに聞く」の窓（段階20-2、v0.45.0〜。持ち主の判断 2026-11-24「全ておすすめの通りで」。計算は src/tree/ask.ts）。
// 定跡帳の今の局面だけを数秒調べて、候補を画面の下の窓に出す。自分の手番は［表に残す］で候補の表に残せる（段階21-1。ほかは保存しない）。
//
// - 相手の手番：相手の候補 4 つ（本線・有力・疑問手・評価値・自分の対応）。研究にある手は［進む］、無い手は［足す］（相手の手と自分の対応の 2 手）
// - 自分の手番：自分の候補 3 つ（最善・最善から −n）。研究にある手は［進む］、無い手は［足す］（その 1 手）
// - 研究の手が候補に入っていなければ、その手だけをもう一度調べて並べる（2 秒まで）。候補の表の手も同じ（もう一度残すとき、同じ条件の点にする）
// - 盤で指して調べる手（picked）が候補に無ければ、その手だけを調べる（読み筋を長くするため、1 手で）
// - 窓を閉じたら探索を止める。ツリーの生成中は使えない（同じエンジンを使うため）

import { useEffect, useRef, useState } from 'preact/hooks';
import { Dialog } from '../components/Dialog';
import { EVALS } from '../engine/config';
import { formatScore } from '../engine/usi';
import type { UsiEngine } from '../engine/engine';
import { applyUsiMove, moveText, positionCommand, sideToMove, type Side } from '../shogi/position';
import { ASK_EXTRA_MAX_MS, ASK_MORE_MS, ASK_MS, ASK_SHALLOW_MS, askMultiPV, askRows, lossText, missingBookMoves, shallowOf, type AskRow } from '../tree/ask';
import { LABEL_TEXT, labelOf } from '../tree/labels';
import { MARK_TEXT, hardMove, isUsiMove, mergeResults, type Candidate, type Shallow } from '../tree/candidates';
import { HardNote, HardTag, MarkTag } from './CandidateDialogs';
import { getEngine, pcEngine } from './engineService';
import { isGenerating } from './generation';
import { settings } from './settings';

/** 探索の進み具合 */
type Phase =
  | { kind: 'load' }
  | { kind: 'search'; ms: number; run: number }
  | { kind: 'extra'; ms: number; run: number }
  | { kind: 'done'; ms: number; rows: AskRow[]; by: NonNullable<Candidate['by']>; shallow: Shallow | undefined }
  | { kind: 'error'; text: string };

export function AskEngine({
  sfen,
  mySide,
  prev,
  place,
  bookMoves,
  table,
  picked,
  goodMax,
  write,
  onAdvance,
  onAdd,
  onSave,
  onPick,
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
  /** この局面の候補の表（自分の手番） */
  table: readonly Candidate[];
  /** 盤で指して調べる手 */
  picked: string | undefined;
  /** 次善と悪手の境目 */
  goodMax: number;
  /** 盤で指して書き込む（切なら［足す］は使えない。表は残せる） */
  write: boolean;
  onAdvance: (move: string) => void;
  /** 手順を足す（相手の手番なら相手の手と自分の対応の 2 手） */
  onAdd: (moves: string[]) => void;
  /** 候補の表に残す（dropped：8 手を超えて入らなかった数） */
  onSave: (table: Candidate[], dropped: number) => void;
  /** 盤で指して調べる */
  onPick: () => void;
  onClose: () => void;
}) {
  const mine = sideToMove(sfen) === mySide;
  const generating = isGenerating();
  const [phase, setPhase] = useState<Phase>(generating ? { kind: 'error', text: 'ツリーを生成中なので、エンジンを使えません。生成が終わるか止めてから聞いてください。' } : { kind: 'load' });
  /** 何回目の探索か（窓を閉じた・調べ直したら、前の探索の結果は使わない） */
  const runId = useRef(0);
  const engineRef = useRef<UsiEngine | null>(null);
  /** 表を書きかえる前の確認を出している */
  const [confirming, setConfirming] = useState(false);
  const evalName = pcEngine.value ? `PC・${EVALS[settings.value.evalId].label}` : EVALS[settings.value.evalId].label;

  async function run(ms: number) {
    const run = ++runId.current;
    const alive = () => runId.current === run;
    setPhase({ kind: 'load' });
    setConfirming(false);
    try {
      const engine = await getEngine();
      if (!alive()) return;
      engineRef.current = engine;
      const position = positionCommand(sfen);
      setPhase({ kind: 'search', ms, run });
      // 自分の手番は、先に「すぐの最善」を調べる（見えにくい手の目安。深い読みの前でないと意味がない）
      let quick = '';
      if (mine) {
        await engine.clearHash();
        if (!alive()) return;
        quick = (await engine.analyze(position, { movetimeMs: ASK_SHALLOW_MS, multiPV: 1 })).bestmove;
        if (!alive()) return;
      }
      const r = await engine.analyze(position, { movetimeMs: ms, multiPV: askMultiPV(sfen, mySide) });
      if (!alive()) return;
      // 研究の手・候補の表の手が候補に入っていなければ、その手だけを調べ直す
      const wanted = [...new Set([...bookMoves, ...table.map((c) => c.move)])];
      const missing = missingBookMoves(r.lines, wanted).filter((m) => m !== picked);
      const extra: typeof r.lines = [];
      const alone = picked ? missingBookMoves(r.lines, [picked]) : [];
      // 浅い読みの手がどこにも入らなければ、点を比べるためだけに調べる（一覧と表には出さない）
      const compare = isUsiMove(quick) && quick !== picked && !missing.includes(quick) ? missingBookMoves(r.lines, [quick]) : [];
      for (const moves of [alone, [...missing, ...compare]]) {
        if (moves.length === 0 || r.lines.length === 0) continue;
        const extraMs = Math.min(ASK_EXTRA_MAX_MS, ms);
        setPhase({ kind: 'extra', ms: extraMs, run: run });
        extra.push(...(await engine.analyze(position, { movetimeMs: extraMs, multiPV: moves.length, searchMoves: moves })).lines);
        if (!alive()) return;
      }
      const listed = extra.filter((l) => !compare.includes(l.pv[0]));
      setPhase({
        kind: 'done',
        ms,
        rows: askRows(sfen, mySide, r.lines, listed, bookMoves),
        by: { engine: evalName, ms, at: Date.now() },
        shallow: mine ? shallowOf(quick, r.lines, extra) : undefined,
      });
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
  /** ［表に残す］とどうなるか（自分の手番で、結果が出たとき） */
  const preview = mine && phase.kind === 'done' && phase.rows.length > 0 ? mergeResults(table, phase.rows, { goodMax, by: phase.by, picked, shallow: phase.shallow }) : null;
  /** 残すと本命になる手が、見えにくい手 */
  const hard = preview ? hardMove(preview.table) : undefined;
  const examined = preview && phase.kind === 'done' ? preview.table.filter((c) => phase.rows.some((r) => r.move === c.move)).length : 0;
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
              <AskRowItem
                key={row.move}
                row={row}
                sfen={sfen}
                prev={prev}
                mine={mine}
                write={write}
                picked={row.move === picked}
                saved={preview?.table.find((c) => c.move === row.move)}
                kept={table.some((c) => c.move === row.move)}
                hard={row.move === hard}
                onAdvance={onAdvance}
                onAdd={onAdd}
              />
            ))}
          </ul>
          {hard && <HardNote />}
        </>
      )}
      {preview && !confirming && (
        <>
          <button
            type="button"
            class="btn btn-primary btn-wide ask-save"
            data-testid="ask-save"
            onClick={() => (table.length > 0 ? setConfirming(true) : onSave(preview.table, preview.dropped))}
          >
            {table.length > 0 ? '表を書きかえる' : '表に残す'}（{examined}手）
          </button>
          {preview.dropped > 0 && <p class="muted memo-sub">表は 8 手までなので、{preview.dropped}手は入りません。</p>}
        </>
      )}
      {preview && confirming && (
        <div class="ask-confirm" data-testid="ask-save-confirm">
          <p>この局面の表を、新しい結果で書きかえます。手・印・理由は残し、点と読み筋を新しくします。</p>
          <div class="dialog-actions">
            <button type="button" class="btn btn-primary" data-testid="ask-save-ok" onClick={() => onSave(preview.table, preview.dropped)}>
              書きかえる
            </button>
            <button type="button" class="btn" onClick={() => setConfirming(false)}>
              やめる
            </button>
          </div>
        </div>
      )}
      {mine && !generating && (
        <button type="button" class="btn btn-wide" data-testid="ask-pick" onClick={onPick}>
          ほかの手を盤で指して調べる
        </button>
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
  picked,
  saved,
  kept,
  hard,
  onAdvance,
  onAdd,
}: {
  row: AskRow;
  sfen: string;
  prev: string | undefined;
  mine: boolean;
  write: boolean;
  /** 盤で指して調べた手 */
  picked: boolean;
  /** 残したときの表のこの手 */
  saved: Candidate | undefined;
  /** もう表にある手 */
  kept: boolean;
  /** 見えにくい手（残すと本命） */
  hard: boolean;
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
        {picked && <span class="ask-picked">指した手</span>}
        {saved && <MarkTag mark={saved.mark} text={kept ? `表：${MARK_TEXT[saved.mark]}` : `${MARK_TEXT[saved.mark]}にする`} testId="ask-mark" />}
        {hard && <HardTag />}
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
