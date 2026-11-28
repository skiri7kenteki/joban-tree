// 実戦 1 局の照らし合わせの結果（段階18、#/game/<id>。持ち主の依頼書 stage18-prompt・判断 2026-11-23「おすすめの通りで」）。
// - 盤の画面の決まり（段階14）：1 画面に収める。上から 見出し → 外れ方の印と「研究通り◯手目まで」→ 盤と操作バー → 枠（結果のカード）
// - 開いたときの盤：外れた手を指した局面（研究の先まで・研究の途中で終局は、研究通りの最後の局面）。‹ › で実戦の手順を前後できる
// - 手順の一覧（手数を押すと画面の下から）：研究通りの手に「研究」、外れた手に外れ方の言葉。それより先は薄く
// - 結果のカードとボタン：
//   相手が研究にない手 →［この局面から研究を足す］（平手からの定跡帳を、定跡帳にある手順＋相手の手で開く。盤で指すと研究手順に足される）
//   自分が研究と違う手 → 研究の手と実戦の手を並べる・［研究の手を確かめる］（定跡帳をその研究手順の、外れた局面で開く）
//   研究の先まで →［定跡帳で続きを足す］（研究手順の終わりで開く）。最初から研究の外 →［この局面から研究を始める］

import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Board } from '../components/Board';
import { KifuPanel, KifuSheet, useWideLayout, type KifuRow } from '../components/KifuList';
import { MoveBar } from '../components/MoveBar';
import { KIND_TEXT, buildBookIndex, classifyGame, type GameMatch, type MatchKind } from '../games/compare';
import { gameTime, resultText, type Game } from '../games/game';
import { moveText, STARTPOS_SFEN } from '../shogi/position';
import { studyPositions } from '../review/studyReview';
import { hirateBookKey } from '../tree/organize';
import { moveTexts } from '../tree/studies';
import { boardFitProps, bottomInFrame, measureFitFrame, useBoardFit } from './boardFit';
import { ensureGames, gameList } from './games';
import { GameMenu, SIDE_TEXT, deviationText, gameDate, kindClass, matchedText, openLineInBook, opponentText } from './GamesScreen';
import { back, bookPath, go } from './router';
import { ensureStudies, library } from './studies';
import { allTemplates, myTemplates, refreshMyTemplates } from './TemplateDialogs';

/** 手順の一覧で、外れた手に添える言葉 */
const DEVIATION_NOTE: Record<MatchKind, string> = {
  opp: '研究にない',
  mine: '研究と違う',
  outside: '研究の外',
  beyond: '研究の先',
  finished: '',
};

export function GameScreen({ id }: { id: string }) {
  const games = gameList.value;
  const studies = library.value;
  const [error, setError] = useState('');

  useEffect(() => {
    ensureGames().catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    ensureStudies().catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    if (!myTemplates.value) void refreshMyTemplates().catch(() => undefined);
  }, []);

  const game = games?.find((g) => g.id === id);
  if (error) return <p class="status-ng">{error}</p>;
  if (!games || !studies) return <p class="muted">読み込み中…</p>;
  if (!game) {
    return (
      <>
        <div class="screen-header">
          <button type="button" class="btn btn-ghost" onClick={() => go('/games')}>
            ‹ 実戦
          </button>
          <h1>実戦</h1>
        </div>
        <p class="muted" data-testid="game-missing">
          この実戦は見つかりませんでした（消されたかもしれません）。
        </p>
      </>
    );
  }
  return <GameView key={`${game.id}:${game.mySide}`} game={game} />;
}

function GameView({ game }: { game: Game }) {
  const studies = library.value ?? [];
  const templates = allTemplates();
  const match = useMemo(() => classifyGame(game, buildBookIndex(studies, game.mySide), templates), [game, studies, myTemplates.value]);
  const positions = useMemo(() => studyPositions(game.moves), [game]);
  const texts = useMemo(() => moveTexts(game.moves), [game]);
  const last = positions.length - 1;
  const focus = Math.min(last, match.kind === 'beyond' || match.kind === 'finished' ? match.matched : match.matched + 1);
  const [ply, setPly] = useState(focus);
  // 研究を足して戻ってきたなど、結果が変わったら、外れた局面へ
  useEffect(() => setPly(focus), [focus]);
  const index = Math.max(0, Math.min(last, ply));
  const wide = useWideLayout();
  const [kifuOpen, setKifuOpen] = useState(false);
  const [menu, setMenu] = useState(false);

  const boardRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLElement>(null);
  const boardFit = useBoardFit(boardRef, (board) => {
    const frame = frameRef.current;
    return frame && cardRef.current ? measureFitFrame(board, frame, bottomInFrame(frame, cardRef.current)) : null;
  });

  const note = DEVIATION_NOTE[match.kind];
  const kifuRows: KifuRow[] = [
    { ply: 0, text: '初期局面' },
    ...texts.map((t, i) => {
      const p = i + 1;
      if (p <= match.matched) return { ply: p, text: t, note: '研究' };
      if (p === match.matched + 1 && note) return { ply: p, text: t, note };
      return { ply: p, text: t, ahead: true };
    }),
  ];
  const result = resultText(game);
  const kicker = [`実戦 ${gameDate(gameTime(game))}`, SIDE_TEXT[game.mySide], result].filter(Boolean).join('・');

  return (
    <div class="board-screen">
      <div class="screen-header">
        <button type="button" class="btn btn-ghost btn-back" aria-label="‹ 実戦" onClick={() => back('/games')}>
          ‹<span class="back-text"> 実戦</span>
        </button>
        <h1 class="tree-title book-title" data-testid="game-title">
          <span class="book-kicker">{kicker}</span>
          <span class="book-label">{opponentText(game)}</span>
        </h1>
        <button type="button" class="btn tree-menu-btn" aria-label="この実戦の操作" data-testid="game-screen-menu" onClick={() => setMenu(true)}>
          ⋯
        </button>
      </div>

      <div class="study-head">
        <p class="study-title study-title-line game-head" data-testid="game-head">
          <span class={kindClass(match.kind)} data-testid="game-kind" data-kind={match.kind}>
            {KIND_TEXT[match.kind]}
          </span>
          <strong class="num" data-testid="game-matched" data-matched={match.matched}>
            {matchedText(match)}
          </strong>
        </p>
      </div>

      <div class="tree-layout study-layout">
        <div class="board-col">
          <div ref={boardRef} {...boardFitProps(boardFit, 'tree-board')} data-testid="game-board">
            <Board sfen={positions[index] ?? STARTPOS_SFEN} lastMove={index > 0 ? game.moves[index - 1] : undefined} />
          </div>
          <MoveBar
            ids={{ bar: 'game-nav', first: 'game-first', prev: 'game-prev', center: 'game-position', next: 'game-next', last: 'game-last' }}
            firstLabel="初期局面へ"
            onFirst={() => setPly(0)}
            onPrev={() => setPly(index - 1)}
            onNext={() => setPly(index + 1)}
            onLast={() => setPly(last)}
            canPrev={index > 0}
            canNext={index < last}
            onCenter={wide ? undefined : () => setKifuOpen(true)}
          >
            {index === 0 ? '初期局面' : `${index}手目 ${texts[index - 1] ?? ''}`}
          </MoveBar>
        </div>

        <div class="tree-side board-frame" ref={frameRef}>
          <ResultCard cardRef={cardRef} game={game} match={match} positions={positions} texts={texts} />
          {wide && <KifuPanel rows={kifuRows} current={index} onJump={setPly} />}
        </div>
      </div>

      {kifuOpen && <KifuSheet rows={kifuRows} current={index} onJump={setPly} onClose={() => setKifuOpen(false)} />}
      {menu && <GameMenu game={game} onClose={() => setMenu(false)} onDeleted={() => go('/games')} />}
    </div>
  );
}

/** 結果のカード（外れ方ごとの説明とボタン） */
function ResultCard({
  cardRef,
  game,
  match,
  positions,
  texts,
}: {
  cardRef: { current: HTMLElement | null };
  game: Game;
  match: GameMatch;
  positions: string[];
  texts: string[];
}) {
  const at = match.matched;
  const P = positions[at] ?? STARTPOS_SFEN;
  const prev = at > 0 ? game.moves[at - 1] : undefined;
  const bookText = (m: string) => moveText(P, m, prev);
  const research = match.bookMoves.map((b) => `${bookText(b.move)}（${b.count} 本）`).join('・');
  const key = hirateBookKey(game.mySide);
  const actual = texts[at] ?? '';

  return (
    <section class="card game-result-card" ref={cardRef} data-testid="game-result">
      {match.kind === 'opp' && (
        <>
          <p class="game-result-text">
            {at + 1}手目 <strong>{actual}</strong> は、定跡帳にない手でした。定跡帳では {research}。
          </p>
          <button type="button" class="btn btn-primary btn-wide" data-testid="game-add-research" onClick={() => match.openLine && openLineInBook(game, match.openLine)}>
            この局面から研究を足す
          </button>
        </>
      )}
      {match.kind === 'mine' && (
        <>
          <div class="game-compare" data-testid="game-compare">
            <div>
              <span>研究</span>
              <strong>{match.bookMoves.map((b) => bookText(b.move)).join('・')}</strong>
            </div>
            <div>
              <span>実戦</span>
              <strong>{actual}</strong>
            </div>
          </div>
          <p class="game-result-text muted">この研究手順は、稽古で先に出します。</p>
          <button
            type="button"
            class="btn btn-wide"
            data-testid="game-check-research"
            onClick={() => match.study && go(bookPath(key, match.study.id, match.study.ply))}
          >
            研究の手を確かめる
          </button>
        </>
      )}
      {match.kind === 'beyond' && (
        <>
          <p class="game-result-text">
            研究手順の終わり（{at}手目 {texts[at - 1] ?? ''}）まで、研究通りに指せました。
          </p>
          <button type="button" class="btn btn-wide" data-testid="game-continue" onClick={() => match.study && go(bookPath(key, match.study.id, match.study.ply))}>
            定跡帳で続きを足す
          </button>
        </>
      )}
      {match.kind === 'finished' && (
        <>
          <p class="game-result-text">研究の途中で終局しました。</p>
          <button type="button" class="btn btn-wide" data-testid="game-continue" onClick={() => match.study && go(bookPath(key, match.study.id, match.study.ply))}>
            定跡帳で見る
          </button>
        </>
      )}
      {match.kind === 'outside' && (
        <>
          <p class="game-result-text">
            {match.bookMoves.length === 0 && at === 0
              ? `${SIDE_TEXT[game.mySide]}の研究手順がまだありません。`
              : `${deviationText(game, at)} から、研究の外でした（戦型の出発点より前）。`}
          </p>
          <button type="button" class="btn btn-wide" data-testid="game-add-research" onClick={() => match.openLine && openLineInBook(game, match.openLine)}>
            この局面から研究を始める
          </button>
        </>
      )}
    </section>
  );
}
