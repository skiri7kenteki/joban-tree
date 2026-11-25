// 候補の表の窓と部品（段階21-1、v0.47.0〜。持ち主の判断 2026-11-25「すべておすすめの通りで」。計算は src/tree/candidates.ts）。
// - 候補の窓：見出しの行の要約（か ⋯ の「候補・局面メモ」）から画面の下に。手ごとに印・評価値・読み筋。局面メモはいちばん下
// - 印の付け替え：行の ⋯ の窓の中の「本命・次善・悪手・表から外す」。理由は打ちたいときだけ
// - どれも文字を打たなくても使える

import { useEffect, useRef, useState } from 'preact/hooks';
import { Dialog } from '../components/Dialog';
import { applyUsiMove, moveText, type Side } from '../shogi/position';
import { MARK_TEXT, PV_MAX, PV_SHOW, REASON_MAX, evalText, markText, type Candidate, type CandidateMark } from '../tree/candidates';
import { NOTE_MAX } from '../tree/positions';

/** 印の札（本命は墨の塗り、次善は木の茶、悪手は朱） */
export function MarkTag({ mark, text, testId }: { mark: CandidateMark; text: string; testId?: string }) {
  return (
    <span class={`mark-tag mark-${mark}`} data-testid={testId} data-mark={mark}>
      {text}
    </span>
  );
}

/** 読み筋の文字（その手を指した後の手を count 手まで） */
export function pvText(sfen: string, move: string, pv: readonly string[], count: number): string {
  const texts: string[] = [];
  let at = applyUsiMove(sfen, move)?.sfen;
  let prev = move;
  for (const m of pv.slice(0, count)) {
    if (!at) break;
    const next = applyUsiMove(at, m);
    if (!next) break;
    texts.push(moveText(at, m, prev));
    at = next.sfen;
    prev = m;
  }
  return texts.join(' ');
}

/** 「3秒・つようら王11micro（11/25）」：いちばん新しく調べた条件 */
function conditionText(table: readonly Candidate[]): string {
  const by = table.flatMap((c) => (c.by ? [c.by] : [])).sort((a, b) => b.at - a.at)[0];
  if (!by) return '';
  const d = new Date(by.at);
  return `${by.ms / 1000}秒・${by.engine}（${d.getMonth() + 1}/${d.getDate()}）`;
}

/**
 * 局面メモを書く欄（保存・消す）。書きかけのまま窓を離れたら（閉じる・ほかのボタン）自動で保存する。
 * 全部消した書きかけは保存しない（消すのは［メモを消す］か［メモを保存］を押したときだけ）
 */
function MemoEditor({
  initial,
  busy,
  rows,
  onSave,
  onAutoSave,
}: {
  initial: string;
  busy: boolean;
  rows: number;
  onSave: (text: string) => void;
  onAutoSave: (text: string) => void;
}) {
  const [text, setText] = useState(initial);
  /** 離れるときに保存する書きかけ（ボタンの保存に失敗しても残るように、保存したかは覚えない。同じ内容をもう一度書くだけ） */
  const draft = useRef(initial);
  /** 開いたときの局面に保存する */
  const autoSave = useRef(onAutoSave);
  useEffect(
    () => () => {
      const next = draft.current.trimEnd();
      if (next.trim() !== '' && next !== initial) autoSave.current(next);
    },
    [],
  );
  /** ［メモを消す］：書きかけも消す（離れるときに戻さないように） */
  const remove = () => {
    draft.current = '';
    onSave('');
  };
  return (
    <>
      <textarea
        class={rows < 4 ? 'memo-text memo-text-short' : 'memo-text'}
        data-testid="book-memo-text"
        aria-label="局面メモ"
        maxLength={NOTE_MAX}
        rows={rows}
        value={text}
        onInput={(e) => {
          draft.current = (e.target as HTMLTextAreaElement).value;
          setText(draft.current);
        }}
      />
      <div class="dialog-actions">
        <button type="button" class="btn" data-testid="book-memo-save" disabled={busy || text.trimEnd() === initial} onClick={() => onSave(text)}>
          メモを保存
        </button>
        {initial && (
          <button type="button" class="btn btn-danger dialog-action-end" data-testid="book-memo-delete" disabled={busy} onClick={remove}>
            メモを消す
          </button>
        )}
      </div>
    </>
  );
}

/** 相手の手番の局面メモの窓（画面の下から。全文を読む・直す・消す） */
export function MemoDialog({
  title,
  side,
  initial,
  busy,
  onSave,
  onAutoSave,
  onClose,
}: {
  title: string;
  side: Side;
  initial: string;
  busy: boolean;
  onSave: (text: string) => void;
  onAutoSave: (text: string) => void;
  onClose: () => void;
}) {
  return (
    <Dialog title="局面メモ" onClose={onClose} testId="book-memo-dialog" sheet>
      <p class="muted memo-sub">
        {title}（{side === 'black' ? '☗先手' : '☖後手'}の定跡帳）。手順前後で来ても同じメモが出ます。
      </p>
      <MemoEditor initial={initial} busy={busy} rows={5} onSave={onSave} onAutoSave={onAutoSave} />
    </Dialog>
  );
}

/** 自分の手番の候補の窓。局面メモはいちばん下 */
export function CandidateWindow({
  title,
  side,
  sfen,
  prev,
  table,
  memo,
  busy,
  onMenu,
  onAsk,
  onPick,
  onSaveMemo,
  onAutoSaveMemo,
  onClose,
}: {
  /** 「17手目 ▲5八玉 の局面」 */
  title: string;
  side: Side;
  sfen: string;
  prev: string | undefined;
  table: readonly Candidate[];
  memo: string;
  busy: boolean;
  /** 手の ⋯（印の付け替え） */
  onMenu: (move: string) => void;
  onAsk: () => void;
  /** 盤で指して調べる */
  onPick: () => void;
  onSaveMemo: (text: string) => void;
  onAutoSaveMemo: (text: string) => void;
  onClose: () => void;
}) {
  const condition = conditionText(table);
  return (
    <Dialog title="自分の手の候補" onClose={onClose} testId="book-cand-dialog" sheet>
      <p class="muted memo-sub">
        {title}（{side === 'black' ? '☗先手' : '☖後手'}の定跡帳）
      </p>
      {table.length === 0 ? (
        <>
          <p class="muted" data-testid="cand-empty">
            まだ候補の表はありません。［エンジンに聞く］→［表に残す］で作れます。
          </p>
          <button type="button" class="btn btn-wide" data-testid="cand-ask" onClick={onAsk}>
            エンジンに聞く
          </button>
        </>
      ) : (
        <ul class="cand-list">
          {table.map((c) => {
            const pv = pvText(sfen, c.move, c.pv ?? [], c.mark === 'bad' ? PV_MAX : PV_SHOW);
            return (
              <li key={c.move} class="cand-item" data-testid="cand-item" data-move={c.move}>
                <div class="cand-main">
                  <span class="cand-move">{moveText(sfen, c.move, prev)}</span>
                  <MarkTag mark={c.mark} text={markText(table, c)} />
                  <span class="cand-sub">
                    <span class="num">{evalText(c)}</span>
                    {pv && ` ${c.mark === 'bad' ? '咎め方：' : ''}${pv}`}
                  </span>
                  {c.reason && <span class="cand-reason">{c.reason}</span>}
                </div>
                <button type="button" class="candidate-menu" aria-label={`${moveText(sfen, c.move, prev)} の印を変える`} data-testid="cand-item-menu" onClick={() => onMenu(c.move)}>
                  ⋯
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <button type="button" class="btn btn-wide cand-pick" data-testid="cand-pick" onClick={onPick}>
        ほかの手を盤で指して調べる
      </button>
      {condition && <p class="muted memo-sub">{condition}</p>}
      <div class="cand-memo">
        <p class="menu-section-title">局面メモ</p>
        <MemoEditor initial={memo} busy={busy} rows={2} onSave={onSaveMemo} onAutoSave={onAutoSaveMemo} />
      </div>
    </Dialog>
  );
}

const MARKS: CandidateMark[] = ['main', 'alt', 'bad'];

/** 印の付け替えと理由（行の ⋯ の窓の中） */
export function MarkChooser({
  entry,
  busy,
  onMark,
  onReason,
}: {
  /** 表のこの手（表に無ければ undefined） */
  entry: Candidate | undefined;
  busy: boolean;
  onMark: (mark: CandidateMark | null) => void;
  onReason: (text: string) => void;
}) {
  const [reason, setReason] = useState(entry?.reason ?? '');
  return (
    <div class="mark-chooser">
      <p class="menu-section-title">候補の表の印</p>
      <div class="mark-choice" role="radiogroup" aria-label="候補の表の印">
        {MARKS.map((mark) => (
          <button
            type="button"
            key={mark}
            role="radio"
            aria-checked={entry?.mark === mark}
            class={entry?.mark === mark ? 'btn btn-toggle on' : 'btn btn-toggle'}
            data-testid={`mark-${mark}`}
            disabled={busy}
            onClick={() => entry?.mark !== mark && onMark(mark)}
          >
            {MARK_TEXT[mark]}
          </button>
        ))}
        {entry && (
          <button type="button" class="btn" data-testid="mark-remove" disabled={busy} onClick={() => onMark(null)}>
            表から外す
          </button>
        )}
      </div>
      {entry && (
        <div class="mark-reason">
          <input
            type="text"
            class="mark-reason-input"
            data-testid="mark-reason"
            aria-label="理由（書きたいときだけ）"
            placeholder="理由（書きたいときだけ）"
            maxLength={REASON_MAX}
            value={reason}
            onInput={(e) => setReason((e.target as HTMLInputElement).value)}
          />
          <button type="button" class="btn" data-testid="mark-reason-save" disabled={busy || reason.trim() === (entry.reason ?? '')} onClick={() => onReason(reason)}>
            保存
          </button>
        </div>
      )}
    </div>
  );
}
