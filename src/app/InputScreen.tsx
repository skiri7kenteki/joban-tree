// 局面の入力画面：棋譜を貼り付ける／盤をタップして指す → 手順を前後して局面を選ぶ →
// 自分が先手か後手かを選ぶ → プリセット（ふつう・じっくり。PC 版は精密も）を選んで生成。
// 段階4-2：棋譜の貼り付け欄はふだん閉じておく（読み込んだら閉じる）。作るボタンは画面の下に固定して、いつでも押せるようにする。
// 段階5-1：「戦型から選ぶ」（グループ → 戦型 → 選ぶ）。選んだら手順を読み込んだ状態にし、自分の側は戦型の側のまま固定
// （手順を前後しても変えない。切り替えはできる）。戦型の出発点か、その先の局面なら、メモを盤の下に出し、ツリーの名前を戦型の名前にする。
// 段階5-2：「この局面を戦型として登録」（平手の初期局面からの手順だけ）。
// v0.12.4：スマホ縦では、盤・持ち駒の行・手順の操作（‹ ›）が、下に固定した作るボタンのバーの上にスクロールせず収まるよう、
// 盤の大きさを画面の高さに合わせて決める（boardFit.ts。貼り付け欄を開いている間はしない）。
// 段階5の手直し：戦型の出発点かその先にいるときは、盤の上の案内の行を「戦型：○○」にする（スマホ縦でスクロールしなくても見える）。
// 段階6-3：同梱ツリー（用意済みのツリー）がある局面・側なら、作るボタンの上に「用意済みのツリーを開く」を大きく出す。
// 開くとツリー一覧にコピーする（2 回目からはそのコピーを開く。新しい版が出たら知らせて、新しいコピーを作る）。

import { useEffect, useRef, useState } from 'preact/hooks';
import { Position, type Move } from 'tsshogi';
import { Board } from '../components/Board';
import { PromotionBox, useMoveInput } from '../components/useMoveInput';
import { parseKifu, type LinePosition } from '../shogi/kifu';
import { STARTPOS_SFEN, moveText, otherSide, sfenKey, sideToMove, type Side } from '../shogi/position';
import { listTrees, loadTree, saveTree, newTreeId, type TreeSummary } from '../storage/trees';
import { bundledStatus, type BundledTreeFile, type BundledTreeMeta } from '../tree/bundled';
import { carryStudies } from '../tree/studies';
import type { Study } from '../tree/types';
import { Dialog } from '../components/Dialog';
import { bundledFor } from '../tree/bundledCatalog';
import { createTree } from '../tree/generator';
import { closestTemplate, templateLine, templateRelation, type OpeningTemplate } from '../tree/templates';
import type { PresetId } from '../tree/presets';
import { availablePresets, effectivePcThreads, pcEngine } from './engineService';
import { openTree, startGeneration, isGenerating } from './generation';
import { go } from './router';
import { generationSettingsFor, presetLabel } from './settings';
import { RegisterTemplateDialog, TemplatePicker, allTemplates } from './TemplateDialogs';
import { boardFitProps, measureFitAbove, useBoardFit } from './boardFit';
import { copyBundledToList, fetchBundledFile } from './bundledTrees';

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
  /** 「この局面を戦型として登録」の窓を開いているか */
  const [registerOpen, setRegisterOpen] = useState(false);
  /** 登録についての一言（登録できない理由・登録した） */
  const [registerNote, setRegisterNote] = useState('');

  const current = line[index];
  const turn = sideToMove(current.sfen);
  // 初期値は「その局面の手番の反対側」（＝相手の手番から始まる）
  const mySide: Side = sideChoice ?? otherSide(turn);
  // 今の局面が、選んだ戦型の出発点か、その先か
  const relation = template ? templateRelation(template, line.slice(1, index + 1).map((p) => p.usi!)) : 'off';
  const onTemplate = template && (relation === 'at' || relation === 'after') ? template : null;
  const where = index === 0 ? '開始局面' : `${current.text}まで`;
  // 戦型の出発点なら戦型の名前、その先なら「戦型の名前 → ○○まで」
  const templateName = onTemplate ? (relation === 'at' ? onTemplate.name : `${onTemplate.name} → ${where}`) : null;
  const movesHere = line.slice(1, index + 1).map((p) => p.usi!);
  // この局面・この側から始まる同梱ツリー（用意済みのツリー）
  const bundled = bundledFor(sfenKey(current.sfen), mySide);

  function moveTo(i: number) {
    setIndex(Math.max(0, Math.min(line.length - 1, i)));
    input.clear();
    setRegisterNote('');
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
    // 盤の上の 1 行に出すので短く（v0.12.4）
    setMessage(`${result.line.length - 1} 手を読み込みました（‹ › で局面を選べます）`);
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

  /** 端末にあるツリーの一覧（同梱ツリーのコピーがあるかを見るため。同梱ツリーがある局面でだけ読む） */
  const [savedTrees, setSavedTrees] = useState<TreeSummary[] | null>(null);
  const [bundledBusy, setBundledBusy] = useState(false);
  /** 新しい版をコピーするときに、前の版のコピーの研究手順を引き継ぐかを聞いているところ（段階7-2） */
  const [carry, setCarry] = useState<{ meta: BundledTreeMeta; file: BundledTreeFile; oldName: string; carried: Study[]; lost: Study[] } | null>(null);
  useEffect(() => {
    if (!bundled) return;
    let alive = true;
    listTrees()
      .then((t) => alive && setSavedTrees(t))
      .catch(() => alive && setSavedTrees([]));
    return () => {
      alive = false;
    };
  }, [bundled?.id, bundled?.version]);
  const status = bundled && savedTrees ? bundledStatus(bundled, savedTrees) : null;

  /** 用意済みのツリーを開く（fresh：コピーがあっても新しくコピーする） */
  async function openBundled(meta: BundledTreeMeta, fresh: boolean) {
    if (bundledBusy || !status) return;
    if (!fresh && status.kind === 'copy') {
      go(`/tree/${status.treeId}`);
      return;
    }
    setBundledBusy(true);
    try {
      // 新しい版：前の版のコピーに研究手順があれば、引き継ぐかを聞く（たどれるものだけ引き継げる）
      if (status.kind === 'outdated') {
        const old = await loadTree(status.treeId);
        if (old?.studies && old.studies.length > 0) {
          const file = await fetchBundledFile(meta);
          setCarry({ meta, file, oldName: old.name, ...carryStudies(old.studies, file.tree) });
          setBundledBusy(false);
          return;
        }
      }
      await finishBundledCopy(meta);
    } catch (e) {
      bundledFailed(e);
    }
  }

  /** コピーを作って開く（引き継ぐ研究手順があれば一緒に） */
  async function finishBundledCopy(meta: BundledTreeMeta, file?: BundledTreeFile, studies?: Study[]) {
    setBundledBusy(true);
    const tree = await copyBundledToList(meta, { file, studies });
    openTree.value = tree;
    go(`/tree/${tree.id}`);
  }

  function bundledFailed(e: unknown) {
    setCarry(null);
    setMessage(
      `用意済みのツリーを読み込めませんでした（${e instanceof Error ? e.message : String(e)}）。通信できるところで、もう一度押してください（一度開けば、通信なしでも開けます）。`,
    );
    setBundledBusy(false);
  }

  // スマホ縦：盤・持ち駒の行・手順の操作が、作るボタンのバーの上に収まる盤の幅（成る・成らないの小窓は数えない）
  const boardRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const boardFit = useBoardFit(boardRef, (board) =>
    pasteOpen ? null : measureFitAbove(board, navRef.current, barRef.current?.offsetHeight ?? 0, [board.querySelector<HTMLElement>('.promote-box')]),
  );

  /** 「この局面を戦型として登録」を押した */
  function openRegister() {
    if (line[0].sfen !== STARTPOS_SFEN) {
      setRegisterNote('平手の初期局面から始まる手順だけ、戦型として登録できます（SFEN で途中の局面から始めた手順は登録できません）。');
      return;
    }
    setRegisterNote('');
    setRegisterOpen(true);
  }

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
    const name = templateName ?? `${where}（自分は${mySide === 'black' ? '先手' : '後手'}）`;
    // どの戦型から作ったか（段階7-1）：選んだ戦型の上なら、その戦型。そうでなければ、手順がいちばん長く一致する戦型
    const templateId = onTemplate?.id ?? (line[0].sfen === STARTPOS_SFEN ? closestTemplate(allTemplates(), movesHere)?.id : undefined);
    const tree = createTree({
      templateId,
      id: newTreeId(),
      name,
      rootSfen: current.sfen,
      mySide,
      prefix: { initialSfen: line[0].sfen, moves: movesHere },
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
          {/* 貼り付け欄を開いている間は、読み込めなかった理由などを欄の下に。閉じているときは盤の上の 1 行に出す */}
          {message && pasteOpen && (
            <p class="muted" data-testid="input-message">
              {message}
            </p>
          )}
        </div>
        <div ref={boardRef} {...boardFitProps(boardFit, 'input-board')}>
          {onTemplate ? (
            <p class="template-current" data-testid="template-current">
              戦型：{onTemplate.name}
              {relation === 'after' && ` → ${current.text ?? ''}`}
            </p>
          ) : message && !pasteOpen ? (
            // 読み込んだ手数などの一言は、案内の行と入れ替える（盤の上の行を増やさない。v0.12.4）
            <p class="muted" data-testid="input-message">
              {message}
            </p>
          ) : (
            <p class="muted">盤の駒をタップ → 行き先をタップで指せます。</p>
          )}
          <Board sfen={current.sfen} lastMove={current.usi} selection={input.selection} onSquare={input.onSquare} onHand={input.onHand} />

          <PromotionBox input={input} />
        </div>
        <div class="input-controls">
          <div class="move-nav" ref={navRef} data-testid="input-nav">
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
          <button type="button" class="btn btn-wide" data-testid="register-template" onClick={openRegister}>
            この局面を戦型として登録
          </button>
          {registerNote && (
            <p class="muted" role="status" data-testid="register-note">
              {registerNote}
            </p>
          )}
        </div>

        {/* 作るボタン：画面の下に固定（ホーム画面アプリでは、下の端のバーを避ける） */}
        <div class="start-bar" ref={barRef} data-testid="start-bar">
          {bundled && (
            <BundledOffer
              meta={bundled}
              status={status}
              busy={bundledBusy}
              onOpen={(fresh) => void openBundled(bundled, fresh)}
              onOpenOld={(id) => go(`/tree/${id}`)}
            />
          )}
          {/* 用意済みのツリーがあるときは、作るボタンの説明の行を省く（小さい画面で盤を隠さないため。局面は盤の上、側は下の欄にある） */}
          {!bundled && (
            <p class="start-bar-caption muted">
              {index === 0 ? '開始局面' : `${index}手目 ${current.text ?? ''}`}から作る（自分は{SIDE_TEXT[mySide]}）
            </p>
          )}
          <div class="preset-buttons">
            {availablePresets().map((id) => (
              <button
                type="button"
                key={id}
                class={id === 'normal' && !bundled ? 'btn btn-primary' : 'btn'}
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

      {carry && (
        <Dialog title="研究手順を引き継ぎますか？" onClose={() => setCarry(null)} testId="carry-dialog">
          <p data-testid="carry-summary">
            前の版のコピー「{carry.oldName}」に研究手順が {carry.carried.length + carry.lost.length} 件あります。
            新しい版でも手順がたどれる <strong>{carry.carried.length} 件</strong>を引き継げます。
          </p>
          {carry.lost.length > 0 && (
            <p class="muted" data-testid="carry-lost">
              新しい版ではたどれないもの（{carry.lost.length} 件）：{carry.lost.map((s) => `「${s.name}」`).join('')}（前の版のコピーには残ります）
            </p>
          )}
          <div class="dialog-actions dialog-actions-column">
            {carry.carried.length > 0 && (
              <button
                type="button"
                class="btn btn-primary"
                data-testid="carry-yes"
                onClick={() => {
                  const c = carry;
                  setCarry(null);
                  void finishBundledCopy(c.meta, c.file, c.carried).catch(bundledFailed);
                }}
              >
                引き継いで開く
              </button>
            )}
            <button
              type="button"
              class="btn"
              data-testid="carry-no"
              onClick={() => {
                const c = carry;
                setCarry(null);
                void finishBundledCopy(c.meta, c.file).catch(bundledFailed);
              }}
            >
              引き継がずに開く
            </button>
            <button type="button" class="btn btn-ghost" onClick={() => setCarry(null)}>
              やめる
            </button>
          </div>
        </Dialog>
      )}

      {pickerOpen && <TemplatePicker onPick={chooseTemplate} onClose={() => setPickerOpen(false)} />}
      {registerOpen && (
        <RegisterTemplateDialog
          moves={movesHere}
          mySide={mySide}
          defaultName={
            // 戦型の出発点そのものなら空（同じ手順の戦型が既にあるので、登録画面がそれを知らせる）
            relation === 'at' ? '' : templateName ?? (index === 0 ? '平手の初期局面' : `${index}手目 ${current.text ?? ''}まで`)
          }
          defaultGroup={(onTemplate ?? closestTemplate(allTemplates(), movesHere))?.group ?? ''}
          onSaved={(t) => {
            setRegisterOpen(false);
            // 登録した戦型を選んだのと同じ状態にする（名前・メモが出る）
            setTemplate(t);
            setSideChoice(t.mySide);
            setRegisterNote(`「${t.name}」を戦型として登録しました。「戦型から選ぶ」に出ます。`);
          }}
          onClose={() => setRegisterOpen(false)}
        />
      )}
    </>
  );
}

/** 作るボタンの上の「用意済みのツリーを開く」（作るボタンより目立たせる。深さ・局面の数・作った日を小さく添える） */
function BundledOffer({
  meta,
  status,
  busy,
  onOpen,
  onOpenOld,
}: {
  meta: BundledTreeMeta;
  status: ReturnType<typeof bundledStatus> | null;
  busy: boolean;
  onOpen: (fresh: boolean) => void;
  onOpenOld: (treeId: string) => void;
}) {
  const d = new Date(meta.finishedAt);
  const facts = `${meta.maxRounds} 往復（${meta.maxRounds * 2} 手先）・${meta.nodeCount.toLocaleString('ja-JP')} 局面・${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} 作成`;
  return (
    <div class="bundled-offer" data-testid="bundled-offer">
      {status?.kind === 'outdated' && (
        <p class="bundled-new" data-testid="bundled-new-version">
          新しい版があります。開くと新しい版をコピーします（前の版のコピーはそのまま残ります）
        </p>
      )}
      <div class="bundled-row">
        <button type="button" class="btn btn-primary bundled-open" data-testid="bundled-open" disabled={busy || !status} onClick={() => onOpen(false)}>
          <span class="bundled-open-title">{busy ? '読み込み中…' : '用意済みのツリーを開く'}</span>
          <span class="bundled-open-facts num" data-testid="bundled-facts">
            {facts}
          </span>
        </button>
        {status?.kind === 'copy' && (
          <button type="button" class="btn bundled-copy" data-testid="bundled-copy-again" disabled={busy} onClick={() => onOpen(true)}>
            新しく
            <br />
            コピー
          </button>
        )}
        {status?.kind === 'outdated' && (
          <button type="button" class="btn bundled-copy" data-testid="bundled-open-old" disabled={busy} onClick={() => onOpenOld(status.treeId)}>
            前の版
            <br />
            を開く
          </button>
        )}
      </div>
    </div>
  );
}
