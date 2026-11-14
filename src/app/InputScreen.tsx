// 局面の入力画面：棋譜を貼り付ける／盤をタップして指す → 手順を前後して局面を選ぶ →
// 自分が先手か後手かを選ぶ → プリセット（ふつう・じっくり）を選んで生成。

import { useState } from 'preact/hooks';
import { Position, type Move } from 'tsshogi';
import { Board } from '../components/Board';
import { PromotionBox, useMoveInput } from '../components/useMoveInput';
import { parseKifu, type LinePosition } from '../shogi/kifu';
import { STARTPOS_SFEN, moveText, otherSide, sideToMove, type Side } from '../shogi/position';
import { saveTree, newTreeId } from '../storage/trees';
import { createTree } from '../tree/generator';
import { PRESET_IDS, type PresetId } from '../tree/presets';
import { openTree, startGeneration, isGenerating } from './generation';
import { go } from './router';
import { generationSettingsFor, presetLabel } from './settings';

const SIDE_TEXT: Record<Side, string> = { black: '☗先手', white: '☖後手' };

export function InputScreen() {
  const [kifu, setKifu] = useState('');
  const [message, setMessage] = useState('');
  const [line, setLine] = useState<LinePosition[]>([{ sfen: STARTPOS_SFEN }]);
  const [index, setIndex] = useState(0);
  const [sideChoice, setSideChoice] = useState<Side | null>(null);
  const [busy, setBusy] = useState(false);

  const current = line[index];
  const turn = sideToMove(current.sfen);
  // 初期値は「その局面の手番の反対側」（＝相手の手番から始まる）
  const mySide: Side = sideChoice ?? otherSide(turn);

  function moveTo(i: number) {
    setIndex(Math.max(0, Math.min(line.length - 1, i)));
    input.clear();
    setSideChoice(null);
  }

  function loadKifu() {
    const result = parseKifu(kifu);
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    setLine(result.line);
    setIndex(result.line.length - 1);
    input.clear();
    setSideChoice(null);
    setMessage(`${result.line.length - 1} 手を読み込みました。手順を動かして、研究したい局面を選んでください。`);
  }

  function resetToStart() {
    setLine([{ sfen: STARTPOS_SFEN }]);
    setIndex(0);
    input.clear();
    setSideChoice(null);
    setMessage('');
  }

  /** 指し手を確定して、手順の今の位置の後ろに足す（その先の手順は消える） */
  function commit(move: Move) {
    const position = Position.newBySFEN(current.sfen)!;
    const prevUsi = current.usi;
    const text = moveText(current.sfen, move.usi, prevUsi);
    position.doMove(move);
    const ply = Number(current.sfen.split(' ')[3] ?? '1') || 1;
    const next: LinePosition = { sfen: position.getSFEN(ply + 1), usi: move.usi, text };
    setLine([...line.slice(0, index + 1), next]);
    setIndex(index + 1);
    input.clear();
    setSideChoice(null);
  }

  const input = useMoveInput(current.sfen, commit);

  async function start(presetId: PresetId) {
    if (busy || isGenerating()) return;
    setBusy(true);
    const settings = generationSettingsFor(presetId);
    const where = index === 0 ? '開始局面' : `${current.text}まで`;
    const tree = createTree({
      id: newTreeId(),
      name: `${where}（自分は${mySide === 'black' ? '先手' : '後手'}）`,
      rootSfen: current.sfen,
      mySide,
      prefix: { initialSfen: line[0].sfen, moves: line.slice(1, index + 1).map((p) => p.usi!) },
      settings,
      now: Date.now(),
    });
    try {
      await saveTree(tree);
    } catch (e) {
      setMessage(`保存できませんでした（${e instanceof Error ? e.message : String(e)}）`);
      setBusy(false);
      return;
    }
    openTree.value = tree;
    go(`/tree/${tree.id}`);
    void startGeneration(tree, settings);
  }

  return (
    <>
      <div class="screen-header">
        <button type="button" class="btn btn-ghost" onClick={() => go('/')}>
          ‹ 一覧
        </button>
        <h1>新しいツリー</h1>
      </div>

      <details class="card kifu-box" open={line.length === 1}>
        <summary>棋譜を貼り付ける（KIF・KI2・CSA・SFEN・USI）</summary>
        <textarea
          class="kifu-input"
          data-testid="kifu-input"
          rows={5}
          placeholder={'例）7g7f 3c3d 2g2f\nKIF や KI2 の棋譜をそのまま貼り付けても読めます'}
          value={kifu}
          onInput={(e) => setKifu((e.target as HTMLTextAreaElement).value)}
        />
        <div class="btn-row">
          <button type="button" class="btn btn-primary" data-testid="kifu-load" onClick={loadKifu}>
            読み込む
          </button>
          <button type="button" class="btn" onClick={resetToStart}>
            平手の初期局面に戻す
          </button>
        </div>
      </details>
      {message && (
        <p class="muted" data-testid="input-message">
          {message}
        </p>
      )}

      <p class="muted">盤の駒をタップ → 行き先をタップで指せます。</p>
      <Board sfen={current.sfen} lastMove={current.usi} selection={input.selection} onSquare={input.onSquare} onHand={input.onHand} />

      <PromotionBox input={input} />

      <div class="move-nav">
        <button type="button" class="btn" aria-label="最初へ" onClick={() => moveTo(0)} disabled={index === 0}>
          |‹
        </button>
        <button type="button" class="btn" aria-label="1手戻る" data-testid="input-prev" onClick={() => moveTo(index - 1)} disabled={index === 0}>
          ‹
        </button>
        <span class="move-nav-text num" data-testid="input-position">
          {index === 0 ? '開始局面' : `${index}手目 ${current.text ?? ''}`}
        </span>
        <button type="button" class="btn" aria-label="1手進む" data-testid="input-next" onClick={() => moveTo(index + 1)} disabled={index >= line.length - 1}>
          ›
        </button>
        <button type="button" class="btn" aria-label="最後へ" onClick={() => moveTo(line.length - 1)} disabled={index >= line.length - 1}>
          ›|
        </button>
      </div>
      {line.length > 2 && (
        <input
          type="range"
          class="move-slider"
          min={0}
          max={line.length - 1}
          value={index}
          aria-label="手順"
          onInput={(e) => moveTo(Number((e.target as HTMLInputElement).value))}
        />
      )}

      <div class="card">
        <div class="side-choice" role="radiogroup" aria-label="自分は">
          <span>自分は</span>
          {(['black', 'white'] as Side[]).map((s) => (
            <button
              type="button"
              key={s}
              role="radio"
              aria-checked={mySide === s}
              data-testid={`side-${s}`}
              class={mySide === s ? 'btn btn-toggle on' : 'btn btn-toggle'}
              onClick={() => setSideChoice(s)}
            >
              {SIDE_TEXT[s]}
            </button>
          ))}
        </div>
        <p class="muted">
          {mySide === turn
            ? 'この局面は自分の手番です。まず自分の最善手を調べてから、相手の応手を広げます。'
            : 'この局面は相手の手番です。相手の応手と、それへの自分の対応を広げます。'}
        </p>
        {isGenerating() && <p class="muted">ほかのツリーを生成中です。終わるか止めてから作ってください。</p>}
        <div class="preset-buttons">
          {PRESET_IDS.map((id) => (
            <button
              type="button"
              key={id}
              class={id === 'normal' ? 'btn btn-primary' : 'btn'}
              data-testid={`start-${id}`}
              onClick={() => void start(id)}
              disabled={busy || isGenerating()}
            >
              {presetLabel(id)}で作る
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
