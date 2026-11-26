// 実戦のタブ（段階18、v0.42.0〜。持ち主の依頼書 stage18-prompt・判断 2026-11-23「おすすめの通りで」）。
// - いちばん上に［＋ 棋譜を貼る］（画面の下から出る窓。貼り付けの欄と［クリップボードから貼る］。クリップボードは押したときだけ読む）
// - 集計：最近 20 局の数・研究通りの平均手数（「最初から研究の外」を除く）・「相手が研究にない手」の回数
// - 次に研究する所：「相手が研究にない手を指した局面」を回数の多い順（同じなら最近の順）に 5 件まで。押すと定跡帳をその局面で開く
// - 対局の一覧（新しい順）：自分の側・相手・段級、日付・戦型・研究通り◯手目まで、外れ方の印・勝ち負け。行の ⋯ で 自分の側を直す・消す
// 照らし合わせの結果は保存せず、開くたびに今の定跡帳で計算する（src/games/compare.ts）

import { useEffect, useMemo, useState } from 'preact/hooks';
import { Dialog } from '../components/Dialog';
import { KIND_TEXT, matchGames, nextSpots, summarizeGames, gameGroup, type MatchedGame, type NextSpot } from '../games/compare';
import { newGameId, opponentOf, parseGame, resultText, sameGame, sideByName, gameTime, type Game, type GameDraft } from '../games/game';
import { moveTexts } from '../tree/studies';
import { hirateBookKey } from '../tree/organize';
import type { Side } from '../shogi/position';
import { bookFromGame, ensureGames, gameList, removeGame, saveGame, warsName } from './games';
import { bookLinePath, go } from './router';
import { ensureStudies, library } from './studies';
import { allTemplates, myTemplates, refreshMyTemplates } from './TemplateDialogs';

export const SIDE_MARK: Record<Side, string> = { black: '☗', white: '☖' };
export const SIDE_TEXT: Record<Side, string> = { black: '☗先手', white: '☖後手' };

/** 日付（今年なら 11/08、ほかの年は 2025/11/08） */
export function gameDate(t: number): string {
  const d = new Date(t);
  const md = `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
  return d.getFullYear() === new Date().getFullYear() ? md : `${d.getFullYear()}/${md}`;
}

/** 相手の名前と段級 */
export function opponentText(g: Game): string {
  const o = opponentOf(g);
  return [o.name || '相手', o.rank].filter(Boolean).join(' ');
}

/** 外れた手（matched＋1 手目）の文字（「21手目 ▲3七桂」） */
export function deviationText(g: Game, matched: number): string {
  const t = moveTexts(g.moves.slice(0, matched + 1))[matched];
  return t ? `${matched + 1}手目 ${t}` : '';
}

/** 一覧・結果の「研究通り◯手目まで」 */
export function matchedText(m: MatchedGame['match']): string {
  if (m.kind === 'outside') return `${m.matched + 1}手目から研究の外`;
  return `研究通り ${m.matched}手目まで`;
}

/** 印の class */
export function kindClass(kind: MatchedGame['match']['kind']): string {
  return `kind-tag kind-${kind}`;
}

/** 定跡帳を、外れた局面（相手の手の後）で開く */
export function openLineInBook(g: Game, line: readonly string[]): void {
  bookFromGame.value = { line: line.join('.'), text: `実戦 ${gameDate(gameTime(g))} の ${line.length}手目。指すと研究に足します` };
  go(bookLinePath(hirateBookKey(g.mySide), line));
}

const SPOTS_SHOWN = 5;

export function GamesScreen() {
  const games = gameList.value;
  const studies = library.value;
  const [error, setError] = useState('');
  const [pasting, setPasting] = useState(false);
  const [menu, setMenu] = useState<Game | null>(null);
  const [allSpots, setAllSpots] = useState(false);

  useEffect(() => {
    ensureGames().catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    ensureStudies().catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    if (!myTemplates.value) void refreshMyTemplates().catch(() => undefined);
  }, []);

  const templates = allTemplates();
  const list = useMemo(() => (games && studies ? matchGames(games, studies, templates) : null), [games, studies, myTemplates.value]);
  const summary = list ? summarizeGames(list) : null;
  const spots = list ? nextSpots(list) : [];

  return (
    <>
      <div class="screen-header list-header">
        <h1 class="page-title">実戦</h1>
        {games && (
          <span class="muted num" data-testid="games-count">
            {games.length}局
          </span>
        )}
        <span class="spacer" />
      </div>
      <div class="btn-row">
        <button type="button" class="btn btn-primary btn-wide" data-testid="games-paste" onClick={() => setPasting(true)}>
          ＋ 棋譜を貼る
        </button>
      </div>
      {error && <p class="status-ng">{error}</p>}
      {!list && !error && <p class="muted">読み込み中…</p>}
      {list && list.length === 0 && (
        <p class="muted" data-testid="games-empty">
          まだありません。将棋ウォーズで指した将棋の棋譜をコピーして、［＋ 棋譜を貼る］から入れてください。定跡帳と照らし合わせて、研究がどこまで通じたかを出します。
        </p>
      )}

      {list && summary && list.length > 0 && (
        <>
          <div class="card book-summary games-summary" data-testid="games-summary">
            <div class="book-summary-cell">
              <span class="book-summary-label">最近の実戦</span>
              <span class="book-summary-value num" data-testid="games-summary-count">
                {summary.games}
                <small>局</small>
              </span>
            </div>
            <div class="book-summary-cell">
              <span class="book-summary-label">研究通り（平均）</span>
              <span class="book-summary-value num" data-testid="games-summary-average">
                {summary.averageMatched === null ? '—' : summary.averageMatched.toFixed(1)}
                <small>手</small>
              </span>
            </div>
            <div class="book-summary-cell">
              <span class="book-summary-label">相手が研究にない手</span>
              <span class="book-summary-value num" data-testid="games-summary-opp">
                {summary.opp}
                <small>回</small>
              </span>
            </div>
          </div>

          {spots.length > 0 && (
            <>
              <h2 class="list-section-title">次に研究する所</h2>
              <div class="card next-spots" data-testid="next-spots">
                {(allSpots ? spots : spots.slice(0, SPOTS_SHOWN)).map((s) => (
                  <SpotRow key={s.key} spot={s} />
                ))}
                {!allSpots && spots.length > SPOTS_SHOWN && (
                  <button type="button" class="next-spot-more" data-testid="next-spots-more" onClick={() => setAllSpots(true)}>
                    もっと見る（あと {spots.length - SPOTS_SHOWN} 件）
                  </button>
                )}
              </div>
            </>
          )}

          <h2 class="list-section-title">対局</h2>
          <ul class="tree-list" data-testid="game-list">
            {list.map((g) => (
              <li class="tree-row" key={g.game.id}>
                <button type="button" class="tree-item game-item" data-testid="game-item" data-kind={g.match.kind} onClick={() => go(`/game/${g.game.id}`)}>
                  <span class="tree-item-title">
                    <span class="tree-item-name">
                      <span class="game-side" aria-label={SIDE_TEXT[g.game.mySide]}>
                        {SIDE_MARK[g.game.mySide]}
                      </span>{' '}
                      {opponentText(g.game)}
                    </span>
                  </span>
                  <span class="tree-item-meta num">
                    {[gameDate(gameTime(g.game)), gameGroup(g.game, templates), matchedText(g.match)].filter(Boolean).join('・')}
                  </span>
                  <span class="game-item-marks">
                    <span class={kindClass(g.match.kind)}>{KIND_TEXT[g.match.kind]}</span>
                    {resultText(g.game) && <span class={g.game.winner === g.game.mySide ? 'game-result win' : 'game-result'}>{resultText(g.game)}</span>}
                  </span>
                </button>
                <button type="button" class="btn tree-menu-btn" aria-label={`${opponentText(g.game)} 戦の操作`} data-testid="game-menu" onClick={() => setMenu(g.game)}>
                  ⋯
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {pasting && <PasteDialog onClose={() => setPasting(false)} />}
      {menu && <GameMenu game={menu} onClose={() => setMenu(null)} />}
    </>
  );
}

/** 次に研究する所の 1 行 */
function SpotRow({ spot }: { spot: NextSpot }) {
  const { game, match } = spot.latest;
  const group = gameGroup(game, allTemplates());
  return (
    <button type="button" class="next-spot" data-testid="next-spot" onClick={() => match.openLine && openLineInBook(game, match.openLine)}>
      <span class="next-spot-main">
        <span class="next-spot-move">{deviationText(game, match.matched)}</span>
        <span class="next-spot-meta">
          {[group, SIDE_TEXT[spot.side]].filter(Boolean).join('・')} ／ 最後は {gameDate(gameTime(game))}
        </span>
      </span>
      <span class="next-spot-count num" data-testid="next-spot-count">
        {spot.count}
        <small>回</small>
      </span>
    </button>
  );
}

/** 棋譜を貼る窓：貼る → 読む（その場で）→ 自分の側（ユーザー名で決まらなければ選ぶ）→ 照らし合わせる */
function PasteDialog({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState('');
  const [chosen, setChosen] = useState<Side | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const parsed = text.trim() ? parseGame(text) : null;
  const draft: GameDraft | null = parsed?.ok ? parsed.draft : null;
  const auto = draft ? sideByName(draft, warsName.value) : null;
  const side = auto ?? chosen;
  // 同じ棋譜がもう入っていれば、貼った時点で知らせる（増やさない）
  const same = draft ? ((gameList.value ?? []).find((g) => sameGame(g, draft)) ?? null) : null;
  const canPaste = typeof navigator.clipboard?.readText === 'function';

  async function fromClipboard() {
    setMessage('');
    try {
      const t = await navigator.clipboard.readText();
      if (t.trim()) setText(t);
      else setMessage('クリップボードが空でした。将棋ウォーズで棋譜をコピーしてから押してください。');
    } catch {
      setMessage('クリップボードを読めませんでした。欄を長押しして「ペースト」で貼ってください。');
    }
  }

  async function submit() {
    if (!draft || !side) return;
    if ((await ensureGames()).some((g) => sameGame(g, draft))) return;
    setBusy(true);
    try {
      const game: Game = { ...draft, id: newGameId(), mySide: side, addedAt: Date.now() };
      await saveGame(game);
      onClose();
      go(`/game/${game.id}`);
    } catch (e) {
      setBusy(false);
      setMessage(`保存できませんでした（${e instanceof Error ? e.message : String(e)}）`);
    }
  }

  return (
    <Dialog title="棋譜を貼る" onClose={onClose} testId="games-paste-dialog" sheet>
      <p class="muted dialog-lead">将棋ウォーズで「棋譜をコピー」して、ここに貼ってください。</p>
      <textarea
        class="kifu-input"
        data-testid="games-paste-text"
        rows={6}
        value={text}
        placeholder={'開始日時：…\n先手：…\n後手：…\n1 ７六歩(77)…'}
        onInput={(e) => {
          setText((e.currentTarget as HTMLTextAreaElement).value);
          setMessage('');
        }}
      />
      {canPaste && (
        <button type="button" class="btn btn-wide" data-testid="games-paste-clipboard" onClick={() => void fromClipboard()}>
          クリップボードから貼る
        </button>
      )}
      {parsed && !parsed.ok && (
        <p class="status-ng" data-testid="games-paste-error">
          {parsed.message}
        </p>
      )}
      {draft && (
        <div class="paste-preview" data-testid="games-paste-preview">
          <p>
            {draft.playedAt !== undefined && `${gameDate(draft.playedAt)} `}☗{[draft.black.name || '先手', draft.black.rank].filter(Boolean).join(' ')} 対 ☖
            {[draft.white.name || '後手', draft.white.rank].filter(Boolean).join(' ')}・{draft.moves.length}手
          </p>
          {auto ? (
            <p data-testid="games-paste-side-auto">
              あなたは <strong>{SIDE_TEXT[auto]}</strong>
              {side && resultText({ winner: draft.winner, mySide: side }) && `（${resultText({ winner: draft.winner, mySide: side })}）`}
            </p>
          ) : (
            <>
              <p class="muted">
                {warsName.value ? '設定のユーザー名が対局者にありません。' : '設定に将棋ウォーズのユーザー名を入れると、自動で決まります。'}あなたはどちらですか？
              </p>
              <div class="btn-row" role="radiogroup" aria-label="あなたの側">
                {(['black', 'white'] as const).map((s) => (
                  <button
                    type="button"
                    key={s}
                    role="radio"
                    aria-checked={chosen === s}
                    data-testid={`games-paste-side-${s}`}
                    class={chosen === s ? 'btn btn-toggle on' : 'btn btn-toggle'}
                    onClick={() => setChosen(s)}
                  >
                    {SIDE_TEXT[s]}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
      {same && (
        <p class="notice" data-testid="games-paste-same">
          この棋譜はもう入っています。{' '}
          <button type="button" class="btn btn-ghost" onClick={() => (onClose(), go(`/game/${same.id}`))}>
            開く
          </button>
        </p>
      )}
      {message && <p class="status-ng">{message}</p>}
      <div class="dialog-actions">
        <button type="button" class="btn btn-primary btn-wide" data-testid="games-paste-ok" disabled={!draft || !side || busy || same !== null} onClick={() => void submit()}>
          照らし合わせる
        </button>
      </div>
    </Dialog>
  );
}

/** 1 局の ⋯：自分の側を直す・消す（確認あり） */
export function GameMenu({ game, onClose, onDeleted }: { game: Game; onClose: () => void; onDeleted?: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const other: Side = game.mySide === 'black' ? 'white' : 'black';
  return (
    <Dialog title={`実戦：${opponentText(game)} 戦`} onClose={onClose} testId="game-menu-dialog" sheet>
      <div class="dialog-actions dialog-actions-column">
        <button
          type="button"
          class="btn"
          data-testid="game-switch-side"
          onClick={() => {
            void saveGame({ ...game, mySide: other }).then(onClose);
          }}
        >
          自分を {SIDE_TEXT[other]} にする
        </button>
        {!confirm ? (
          <button type="button" class="btn btn-danger" data-testid="game-delete" onClick={() => setConfirm(true)}>
            消す…
          </button>
        ) : (
          <>
            <p>この実戦の棋譜を消しますか？（定跡帳の研究手順は消えません）</p>
            <button
              type="button"
              class="btn btn-danger"
              data-testid="game-delete-ok"
              onClick={() => {
                void removeGame(game.id).then(() => {
                  onClose();
                  onDeleted?.();
                });
              }}
            >
              消す
            </button>
            <button type="button" class="btn" onClick={() => setConfirm(false)}>
              やめる
            </button>
          </>
        )}
      </div>
    </Dialog>
  );
}
