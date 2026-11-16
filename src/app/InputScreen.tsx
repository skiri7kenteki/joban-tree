// 局面の入力画面：棋譜を貼り付ける／盤をタップして指す → 手順を前後して局面を選ぶ →
// 自分が先手か後手かを選ぶ → プリセット（ふつう・じっくり。PC 版は精密も）を選んで生成。
// 段階4-2：棋譜の貼り付け欄はふだん閉じておく（読み込んだら閉じる）。作るボタンは画面の下に固定して、いつでも押せるようにする。
// 段階5-1：「戦型から選ぶ」（グループ → 戦型 → 選ぶ）。選んだら手順を読み込んだ状態にし、自分の側は戦型の側のまま固定
// （手順を前後しても変えない。切り替えはできる）。戦型の出発点か、その先の局面なら、メモを盤の下に出し、ツリーの名前を戦型の名前にする。

import { useState } from 'preact/hooks';
import { Position, type Move } from 'tsshogi';
import { Board } from '../components/Board';
import { Dialog } from '../components/Dialog';
import { PromotionBox, useMoveInput } from '../components/useMoveInput';
import { parseKifu, type LinePosition } from '../shogi/kifu';
import { STARTPOS_SFEN, moveText, otherSide, sideToMove, type Side } from '../shogi/position';
import { saveTree, newTreeId } from '../storage/trees';
import { createTree } from '../tree/generator';
import { BUNDLED_TEMPLATES, groupTemplates, templateLine, templateRelation, type OpeningTemplate } from '../tree/templates';
import type { PresetId } from '../tree/presets';
import { availablePresets, effectivePcThreads, pcEngine } from './engineService';
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
  /** 棋譜の貼り付け欄を開いているか */
  const [pasteOpen, setPasteOpen] = useState(false);
  /** 「戦型から選ぶ」の窓を開いているか */
  const [pickerOpen, setPickerOpen] = useState(false);
  /** 選んだ戦型（棋譜を読み込む・初期局面に戻すと外れる） */
  const [template, setTemplate] = useState<OpeningTemplate | null>(null);

  const current = line[index];
  const turn = sideToMove(current.sfen);
  // 初期値は「その局面の手番の反対側」（＝相手の手番から始まる）
  const mySide: Side = sideChoice ?? otherSide(turn);
  // 今の局面が、選んだ戦型の出発点か、その先か
  const relation = template ? templateRelation(template, line.slice(1, index + 1).map((p) => p.usi!)) : 'off';
  const onTemplate = template && (relation === 'at' || relation === 'after') ? template : null;

  function moveTo(i: number) {
    setIndex(Math.max(0, Math.min(line.length - 1, i)));
    input.clear();
    // 戦型を選んだときは、その側のまま（手順を前後しても変えない）
    if (!template) setSideChoice(null);
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
    setTemplate(null);
    setMessage(`${result.line.length - 1} 手を読み込みました。手順を動かして、研究したい局面を選んでください。`);
    setPasteOpen(false);
  }

  function resetToStart() {
    setLine([{ sfen: STARTPOS_SFEN }]);
    setIndex(0);
    input.clear();
    setSideChoice(null);
    setTemplate(null);
    setMessage('');
    setPasteOpen(false);
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
    if (!template) setSideChoice(null);
  }

  const input = useMoveInput(current.sfen, commit);

  /** 戦型を選ぶ：手順を読み込み、出発点の局面にする */
  function chooseTemplate(t: OpeningTemplate) {
    setPickerOpen(false);
    const result = templateLine(t.moves);
    if (!result.ok) {
      setMessage(`「${t.name}」の手順を読めませんでした（${result.index + 1} 手目）。`);
      return;
    }
    setLine(result.line);
    setIndex(result.line.length - 1);
    input.clear();
    setSideChoice(t.mySide);
    setTemplate(t);
    setMessage('');
    setPasteOpen(false);
  }

  async function start(presetId: PresetId) {
    if (busy || isGenerating()) return;
    setBusy(true);
    const settings = generationSettingsFor(presetId);
    const where = index === 0 ? '開始局面' : `${current.text}まで`;
    // 戦型の出発点なら戦型の名前、その先なら「戦型の名前 → ○○まで」
    const name = onTemplate
      ? relation === 'at'
        ? onTemplate.name
        : `${onTemplate.name} → ${where}`
      : `${where}（自分は${mySide === 'black' ? '先手' : '後手'}）`;
    const tree = createTree({
      id: newTreeId(),
      name,
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

      {/* スマホ縦は上から「貼り付け・盤・操作」、iPad 横は左に盤、右に貼り付けと操作（盤が作るボタンに隠れないように） */}
      <div class="input-layout">
        <div class="input-paste">
          {!pasteOpen ? (
            <div class="input-sources">
              <button type="button" class="btn kifu-open" data-testid="kifu-open" onClick={() => setPasteOpen(true)}>
                棋譜を貼り付ける
              </button>
              <button type="button" class="btn" data-testid="template-open" onClick={() => setPickerOpen(true)}>
                戦型から選ぶ
              </button>
            </div>
          ) : (
            <div class="card kifu-box" data-testid="kifu-box">
              <textarea
                class="kifu-input"
                data-testid="kifu-input"
                rows={5}
                placeholder={'例）7g7f 3c3d 2g2f\nKIF・KI2・CSA・SFEN の棋譜をそのまま貼り付けても読めます'}
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
                <button type="button" class="btn btn-ghost" data-testid="kifu-close" onClick={() => setPasteOpen(false)}>
                  閉じる
                </button>
              </div>
            </div>
          )}
          {message && (
            <p class="muted" data-testid="input-message">
              {message}
            </p>
          )}
        </div>
        <div class="input-board">
          <p class="muted">盤の駒をタップ → 行き先をタップで指せます。</p>
          <Board sfen={current.sfen} lastMove={current.usi} selection={input.selection} onSquare={input.onSquare} onHand={input.onHand} />

          <PromotionBox input={input} />
        </div>
        <div class="input-controls">
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

          {/* 選んだ戦型の名前とメモ（スマホでは盤と手順の操作のすぐ下、iPad 横では右の列） */}
          {onTemplate && (
            <div class="card template-note" data-testid="template-note">
              <p class="template-note-name">
                <strong>{onTemplate.name}</strong>
                {!onTemplate.reviewed && <span class="chip chip-small chip-unverified">未確認</span>}
                {relation === 'after' && <span class="muted">からさらに進めた局面</span>}
              </p>
              {onTemplate.note && <p class="muted">{onTemplate.note}</p>}
            </div>
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
            {pcEngine.value && (
              <p class="notice" data-testid="pc-engine-note">
                PC のエンジンで作ります（{effectivePcThreads(pcEngine.value)} スレッド）。できたツリーは「JSON で渡す」で iPad やスマホに渡せます。
              </p>
            )}
          </div>
        </div>

        {/* 作るボタン：画面の下に固定（ホーム画面アプリでは、下の端のバーを避ける） */}
        <div class="start-bar" data-testid="start-bar">
          <p class="start-bar-caption muted">
            {index === 0 ? '開始局面' : `${index}手目 ${current.text ?? ''}`}から作る（自分は{SIDE_TEXT[mySide]}）
          </p>
          <div class="preset-buttons">
            {availablePresets().map((id) => (
              <button
                type="button"
                key={id}
                class={id === 'normal' ? 'btn btn-primary' : 'btn'}
                data-testid={`start-${id}`}
                onClick={() => void start(id)}
                disabled={busy || isGenerating()}
              >
                {presetLabel(id)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {pickerOpen && <TemplatePicker templates={BUNDLED_TEMPLATES} onPick={chooseTemplate} onClose={() => setPickerOpen(false)} />}
    </>
  );
}

/** 「戦型から選ぶ」：グループの一覧 → 戦型の一覧 → 選ぶ */
function TemplatePicker({
  templates,
  onPick,
  onClose,
}: {
  templates: readonly OpeningTemplate[];
  onPick: (t: OpeningTemplate) => void;
  onClose: () => void;
}) {
  const [group, setGroup] = useState<string | null>(null);
  const groups = groupTemplates(templates);
  const chosen = group === null ? null : groups.find((g) => g.group === group);

  return (
    <Dialog title={chosen ? chosen.group : '戦型から選ぶ'} onClose={onClose} testId="template-picker">
      {!chosen ? (
        <>
          <p class="muted">戦型の出発点の局面から始めます。選んだ後に、手順を前後したり盤上で指したりもできます。</p>
          <ul class="template-list">
            {groups.map((g) => (
              <li key={g.group}>
                <button type="button" class="template-item" data-testid="template-group" onClick={() => setGroup(g.group)}>
                  <span class="template-item-main">
                    <span class="template-item-name">{g.group}</span>
                  </span>
                  <span class="muted num">{g.templates.length}</span>
                  <span aria-hidden="true">›</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <>
          <button type="button" class="btn btn-ghost" data-testid="template-back" onClick={() => setGroup(null)}>
            ‹ グループ
          </button>
          <ul class="template-list">
            {chosen.templates.map((t) => (
              <li key={t.id}>
                <button type="button" class="template-item" data-testid="template-item" onClick={() => onPick(t)}>
                  <span class="template-item-main">
                    <span class="template-item-name">
                      {t.name}
                      {!t.reviewed && (
                        <span class="chip chip-small chip-unverified" data-testid="template-unreviewed">
                          未確認
                        </span>
                      )}
                    </span>
                    {t.note && <span class="template-item-note muted">{t.note}</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </Dialog>
  );
}
