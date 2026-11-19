// 1 本の手順を定跡帳に足す（段階10-2、持ち主の判断 2026-11-19）。
// 研究手順の画面と登録の画面（#/new/study）を片付けたので、1 本だけ足す入口はここにまとめる：
//   - 棋譜を貼って 1 本登録（トップ画面の「＋ 研究手順を登録」の中。KifPasteDialog）
//   - ツリーの閲覧画面・新しいツリーの画面の「定跡帳に足す」（AddToBookDialog）
// 名前は初期値（分かれ目がわかる形）で、メモは空。名前・メモは定跡帳の ★ の行から直す。自分の側だけ確かめる。
// 手が 0 本・戦型の出発点そのもので終わる手順は足さない。同じ手順がすでにあれば足さずに、それを定跡帳で開けるようにする

import { useState } from 'preact/hooks';
import { Dialog } from '../components/Dialog';
import { parseKifu } from '../shogi/kifu';
import { STARTPOS_SFEN, type Side } from '../shogi/position';
import { checkNewMoves, studyFromMoves } from '../tree/bookEdit';
import { bookKeyOfGroup, studyGroupKey } from '../tree/organize';
import { findSameStudy, guessSide, newStudyId, studyMovesText } from '../tree/studies';
import type { Study } from '../tree/types';
import { bookPath, go } from './router';
import { ensureStudies, saveStudies } from './studies';
import { allTemplates } from './TemplateDialogs';

const SIDE_TEXT: Record<Side, string> = { black: '☗先手', white: '☖後手' };

/** その研究手順を開く定跡帳の URL（「#」より後ろ）。ply を渡さなければ終わりの局面 */
export function studyBookUrl(study: Pick<Study, 'id' | 'moves' | 'mySide' | 'templateId'>, ply?: number): string {
  const key = bookKeyOfGroup(studyGroupKey(study, allTemplates()));
  return bookPath(key, study.id, Math.min(study.moves.length, ply ?? study.moves.length));
}

/** 足せない手順の理由（足せれば null）。出発点の戦型は自分の側で変わるので side を渡す（段階10 の直し） */
export function addProblem(moves: readonly string[] | null, side: Side): string | null {
  if (!moves) return '平手の初期局面から始まる手順だけ、研究手順にできます（駒落ちや、SFEN で途中の局面から始めた手順は足せません）。';
  const problem = checkNewMoves(moves, allTemplates(), side);
  if (problem === 'empty') return '1 手以上進めた局面を選んでください（初期局面そのものは研究手順にできません）。';
  if (problem === 'start') return '戦型の出発点そのものは研究手順にできません。1 手以上進めた局面で足してください。';
  return null;
}

/** 足した結果：足した研究手順か、すでにあった研究手順 */
export type AddResult = { kind: 'added' | 'exists'; study: Study };

/** 手順を研究手順として保存する（同じ手順がすでにあれば足さない） */
export async function addMovesToBook(moves: readonly string[], side: Side): Promise<AddResult> {
  const existing = findSameStudy(await ensureStudies(), moves);
  if (existing) return { kind: 'exists', study: existing };
  const study = studyFromMoves(moves, side, allTemplates(), Date.now(), newStudyId());
  await saveStudies([study]);
  return { kind: 'added', study };
}

/** 自分の側を選ぶ行（目立たせる） */
function SidePicker({ side, onChange, testPrefix }: { side: Side; onChange: (s: Side) => void; testPrefix: string }) {
  return (
    <div class="side-choice side-choice-strong" role="radiogroup" aria-label="自分は">
      <span>自分は</span>
      {(['black', 'white'] as Side[]).map((s) => (
        <button
          type="button"
          key={s}
          role="radio"
          aria-checked={side === s}
          data-testid={`${testPrefix}-side-${s}`}
          class={side === s ? 'btn btn-toggle on' : 'btn btn-toggle'}
          onClick={() => onChange(s)}
        >
          {SIDE_TEXT[s]}
        </button>
      ))}
    </div>
  );
}

/** 「定跡帳に足す」の窓（ツリーの閲覧画面・新しいツリーの画面）：手順と自分の側を確かめて足す */
export function AddToBookDialog({
  moves,
  side: initialSide,
  onDone,
  onClose,
}: {
  moves: readonly string[];
  side: Side;
  onDone: (r: AddResult) => void;
  onClose: () => void;
}) {
  const [side, setSide] = useState<Side>(initialSide);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function add() {
    const problem = addProblem(moves, side);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    try {
      onDone(await addMovesToBook(moves, side));
    } catch (e) {
      setError(`保存できませんでした（${e instanceof Error ? e.message : String(e)}）`);
      setBusy(false);
    }
  }
  return (
    <Dialog title="定跡帳に足す" onClose={onClose} testId="add-book-dialog">
      <p class="study-moves muted" data-testid="add-book-moves">
        {studyMovesText({ moves: [...moves], mySide: side }, allTemplates())}
      </p>
      <SidePicker side={side} onChange={setSide} testPrefix="add-book" />
      <p class="muted">名前は自動で付けます。名前とメモは、定跡帳の「★」の行から直せます。</p>
      {error && (
        <p class="status-ng" role="alert">
          {error}
        </p>
      )}
      <div class="dialog-actions">
        <button type="button" class="btn btn-primary" data-testid="add-book-ok" disabled={busy} onClick={() => void add()}>
          定跡帳に足す
        </button>
        <button type="button" class="btn" onClick={onClose}>
          やめる
        </button>
      </div>
    </Dialog>
  );
}

/**
 * 棋譜を貼って 1 本登録（トップ画面の「＋ 研究手順を登録」の中）：貼り付けて読み取る → 手順と自分の側を確かめる → 足して、その定跡帳を開く。
 * 棋譜の最後の手までを 1 本にする（短くしたいときは、定跡帳の「ここで終わりにする」で）
 */
export function KifPasteDialog({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState('');
  const [moves, setMoves] = useState<string[] | null>(null);
  const [side, setSide] = useState<Side>('black');
  const [message, setMessage] = useState('');
  const [existing, setExisting] = useState<Study | null>(null);
  const [busy, setBusy] = useState(false);

  function read() {
    setMessage('');
    setExisting(null);
    const r = parseKifu(text);
    if (!r.ok) {
      setMessage(r.message);
      return;
    }
    const list = r.line.slice(1).map((p) => p.usi ?? '');
    const guessed = guessSide(list, allTemplates());
    const problem = addProblem(r.line[0].sfen === STARTPOS_SFEN ? list : null, guessed);
    if (problem) {
      setMessage(problem);
      return;
    }
    setMoves(list);
    setSide(guessed);
  }

  async function add() {
    if (!moves) return;
    const problem = addProblem(moves, side);
    if (problem) {
      setMessage(problem);
      return;
    }
    setMessage('');
    setBusy(true);
    try {
      const r = await addMovesToBook(moves, side);
      if (r.kind === 'exists') {
        setExisting(r.study);
        setBusy(false);
        return;
      }
      go(studyBookUrl(r.study));
    } catch (e) {
      setMessage(`保存できませんでした（${e instanceof Error ? e.message : String(e)}）`);
      setBusy(false);
    }
  }

  return (
    <Dialog title="棋譜を貼って 1 本登録" onClose={onClose} testId="kif-paste-dialog">
      {!moves ? (
        <>
          <p class="muted">KIF・KI2・CSA・USI の棋譜を貼り付けてください（平手の初期局面からの棋譜だけ）。最後の手までを 1 本の研究手順にします。</p>
          <textarea
            class="kifu-input"
            rows={6}
            value={text}
            data-testid="kif-paste-input"
            onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
          />
          {message && (
            <p class="status-ng" role="alert" data-testid="kif-paste-message">
              {message}
            </p>
          )}
          <div class="dialog-actions">
            <button type="button" class="btn btn-primary" data-testid="kif-paste-read" disabled={text.trim() === ''} onClick={read}>
              読み取る
            </button>
            <button type="button" class="btn" onClick={onClose}>
              やめる
            </button>
          </div>
        </>
      ) : (
        <>
          <p class="study-moves muted" data-testid="kif-paste-moves">
            {moves.length} 手：{studyMovesText({ moves, mySide: side }, allTemplates())}
          </p>
          <SidePicker side={side} onChange={setSide} testPrefix="kif-paste" />
          <p class="muted">名前は自動で付けます。名前とメモは、定跡帳の「★」の行から直せます。</p>
          {existing && (
            <p role="status" data-testid="kif-paste-exists">
              この手順は、研究手順「{existing.name}」としてすでにあります。
              <button type="button" class="btn btn-ghost" data-testid="kif-paste-open-existing" onClick={() => go(studyBookUrl(existing))}>
                定跡帳で開く
              </button>
            </p>
          )}
          {message && (
            <p class="status-ng" role="alert">
              {message}
            </p>
          )}
          <div class="dialog-actions">
            <button type="button" class="btn btn-primary" data-testid="kif-paste-add" disabled={busy || existing !== null} onClick={() => void add()}>
              足して定跡帳を開く
            </button>
            <button
              type="button"
              class="btn"
              onClick={() => {
                setMoves(null);
                setExisting(null);
              }}
            >
              貼り直す
            </button>
          </div>
        </>
      )}
    </Dialog>
  );
}
