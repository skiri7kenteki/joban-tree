// ツリーの閲覧画面（中心となる画面）。
// 上に盤面、下に「この局面の候補手リスト」。候補手をタップで 1 手進む。戻るボタン・左右スワイプで戻る/進む。
// 段階4：スマホ縦で「盤＋候補手 3 つ」が 1 画面に収まるよう詰めた。相手の応手の行には自分の対応と枝の先の様子を併記する。
// 段階4-3：相手の応手の行の「⋯」から「この手を除外」。除外した手はリストの下に畳み、「戻す」で戻せる。
//          自分の手番では「別の手を調べる」で盤をタップして自分の指したい手を選び、最善手と比べてからその先を作る。
//          自分の対応の行の「⋯」から「本線にする」「消す」。
// 生成中も、できた枝からたどれる。
// 局面ごとの操作：「ここから展開」「この手を検証」「KIF をコピー」、ツリーの書き出し・共有。
// v0.12.2：スマホ縦では、盤の大きさを画面の高さに合わせて決める（幅 360・高さ 640 以上で候補手 3 行がスクロールなしで見える。boardFit.ts）。
// v0.12.3：候補手が 4 つ以上なら 4 行目も見せる（盤を画面幅の 85% まで縮めて収める、収まらなければ半分のぞかせる）。見出しに件数。
// 段階7-2：研究手順。「この手順を研究として保存」、研究手順の上の候補手に★、終わりの局面では候補手の見出しの行に「★ 名前」（押すとメモ・直す・消す）。
//          #/tree/<id>/study/<研究手順の id> で開くと、その局面をパンくずリストごと開く。
// 段階8-1：研究手順はツリーの外（端末の研究手順の置き場所）にある。平手からの手順（ツリーの開始局面までの手順＋たどった手）が
//          研究手順の途中と同じなら★、同じ手順で終わる研究手順があれば「★ 名前」。保存は平手からの手順にして独立した研究手順へ。
//          段階10-2：「この手順を研究として保存」は「定跡帳に足す」（自分の側だけ確かめる。名前は自動）。足した後・★ の手順なら「定跡帳で開く」。

import { useEffect, useRef, useState } from 'preact/hooks';
import { Board } from '../components/Board';
import { Dialog } from '../components/Dialog';
import { KifuPanel, KifuSheet, useWideLayout } from '../components/KifuList';
import { treeKifu } from '../tree/treeKifu';
import { PromotionBox, useMoveInput } from '../components/useMoveInput';
import { formatScore, scoreToNumber, type Score } from '../engine/usi';
import { STARTPOS_SFEN, moveText } from '../shogi/position';
import { loadTree } from '../storage/trees';
import { fileNameOf, treeToJson } from '../tree/backup';
import { FINISH_TEXT, countParents, excludeMove, isAfterDubiousOnly, isOpponentNode, restoreMove } from '../tree/generator';
import { pathToKif, treeToKif } from '../tree/kif';
import { MINE_MARK_TEXT, branchInfo, branchText, lastPrefixMove, lossText, mineMark, replyOf, type MineMark } from '../tree/browse';
import { countRemoved, deleteMove, makeMainMove } from '../tree/edit';
import { LABEL_TEXT, labelOf } from '../tree/labels';
import type { PresetId } from '../tree/presets';
import { closestTemplate, templateLine } from '../tree/templates';
import { movesOfPath, startsWith, studyEndingAt, studyMovesText, studyNextMoves, traceStudy, treeBaseMoves } from '../tree/studies';
import { boardFitProps, measureBoardFit, useBoardFit } from './boardFit';
import { availablePresets } from './engineService';
import type { Study, TreeData, TreeEdge } from '../tree/types';
import {
  generation,
  isGenerating,
  openTree,
  saveEdited,
  startExplore,
  startGeneration,
  startResample,
  startVerify,
  stopGeneration,
  treeVersion,
} from './generation';
import { markOpened } from './recent';
import { go } from './router';
import { generationSettingsFor, presetLabel, settings } from './settings';
import { OUTCOME_TEXT, copyText, shareFile } from './share';
import { RegisterTemplateDialog, allTemplates } from './TemplateDialogs';
import { StudyEditDialog, StudyViewDialog } from './StudyDialogs';
import { AddToBookDialog, addProblem, studyBookUrl } from './addToBook';
import { ensureStudies, library, removeStudy, updateStudyFields } from './studies';


export function TreeScreen({ id, studyId, ply }: { id: string; studyId?: string; ply?: number }) {
  const [error, setError] = useState('');
  const tree = openTree.value?.id === id ? openTree.value : null;
  // 研究手順（★・終わりの局面の名前・研究手順から開く局面）を読む
  const studies = library.value;
  useEffect(() => {
    ensureStudies().catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  // 最近開いたツリーとして、端末に記録する（段階7-1）
  useEffect(() => {
    markOpened(id);
  }, [id]);

  useEffect(() => {
    if (tree) return;
    loadTree(id)
      .then((loaded) => {
        if (loaded) openTree.value = loaded;
        else setError('このツリーは見つかりませんでした');
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, [id, tree]);

  if (error) return <p class="status-ng">{error}</p>;
  if (!tree || !studies) return <p class="muted">読み込み中…</p>;
  return <TreeView key={`${tree.id}/${studyId ?? ''}/${ply ?? ''}`} tree={tree} studies={studies} studyId={studyId} ply={ply} />;
}

/** 研究手順から開くときの、最初の局面（研究手順の終わり、または平手から ply 手目。たどれるところまで）と一言 */
function initialPath(tree: TreeData, studies: readonly Study[], studyId?: string, ply?: number): { path: string[]; note: string } {
  if (!studyId) return { path: [tree.rootKey], note: '' };
  const study = studies.find((s) => s.id === studyId);
  if (!study) return { path: [tree.rootKey], note: 'この研究手順は見つかりませんでした（消されたかもしれません）。' };
  const moves = study.moves.slice(0, ply ?? study.moves.length);
  const base = treeBaseMoves(tree);
  if (!base || !startsWith(moves, base)) return { path: [tree.rootKey], note: `研究手順「${study.name}」は、このツリーの開始局面を通りません。` };
  const trace = traceStudy(tree, moves.slice(base.length));
  return {
    path: trace.keys,
    note: trace.complete ? '' : `研究手順「${study.name}」は、このツリーでは途中までしかたどれません（${moves.length} 手のうち ${base.length + trace.reached} 手目まで）。`,
  };
}

function TreeView({ tree, studies, studyId, ply }: { tree: TreeData; studies: readonly Study[]; studyId?: string; ply?: number }) {
  // 生成が進むたびに描き直す
  void treeVersion.value;
  const [initial] = useState(() => initialPath(tree, studies, studyId, ply));
  /** 開始局面から今の局面までの、局面のキーの並び */
  const [path, setPath] = useState<string[]>(initial.path);
  /** 戻ったときに覚えておく「進む」先（スワイプで進む用） */
  const [forward, setForward] = useState<string[]>([]);
  /** 開いている小窓（ここから展開・書き出し） */
  const [dialog, setDialog] = useState<'expand' | 'export' | 'register' | 'study-edit' | 'study-view' | 'add-book' | null>(null);
  /** 「⋯」を押した候補手（手のメニューを出す） */
  const [menuEdge, setMenuEdge] = useState<TreeEdge | null>(null);
  /** 除外した手の欄を開いているか */
  const [showExcluded, setShowExcluded] = useState(false);
  /** 「別の手を調べる」：盤をタップして自分の手を選んでいるところか */
  const [picking, setPicking] = useState(false);
  /** 盤で選んだ自分の手（USI。調べ方を選ぶ小窓を出す） */
  const [pickedMove, setPickedMove] = useState<string | null>(null);
  /** 消すかどうか確認している自分の手 */
  const [deleting, setDeleting] = useState<TreeEdge | null>(null);
  /** 操作の結果（「コピーしました」など） */
  const [note, setNote] = useState(initial.note);
  const crumbsRef = useRef<HTMLDivElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const sideRef = useRef<HTMLDivElement>(null);
  // スマホ縦：候補手 3 行が画面に収まる盤の幅（制限しないときは null）
  const boardFit = useBoardFit(boardRef, (board) => (sideRef.current ? measureBoardFit(board, sideRef.current) : null));
  const thresholds = settings.value.thresholds;

  const key = path[path.length - 1];
  const node = tree.nodes[key];
  const parents = countParents(tree);
  const opp = isOpponentNode(tree, node);
  const incoming = path.length > 1 ? edgeBetween(tree, path[path.length - 2], key) : undefined;
  const gen = generation.value?.treeId === tree.id ? generation.value : null;
  // 平手の初期局面から今の局面までの手順（開始局面までの手順＋そこからたどった手）
  const movesHere = [...tree.prefix.moves, ...path.slice(1).map((k, i) => edgeBetween(tree, path[i], k)?.move ?? '')];
  const busy = isGenerating();
  // 研究手順（段階8-1）：平手から今の局面までの手順（平手から始まらないツリーは null）・★を付ける手・この局面で終わる研究手順
  const base = treeBaseMoves(tree);
  const fullMoves = base ? [...base, ...movesOfPath(tree, path)] : null;
  const starMoves = fullMoves ? studyNextMoves(studies, fullMoves) : new Set<string>();
  const studyHere = fullMoves ? studyEndingAt(studies, fullMoves) : null;
  const templates = allTemplates();
  // 「この手を検証」は、まだ調べていない自分の手番の局面だけ
  const canVerify = !opp && !node.searched && !node.terminal;
  // 「別の手を調べる」：盤のタップで自分の手を選ぶ（入力画面・復習と同じ仕組み）
  const input = useMoveInput(
    node.sfen,
    (move) => {
      setPicking(false);
      setPickedMove(move.usi);
    },
    picking && !busy,
  );

  // 局面が変わったら、手を選んでいる途中のものは取りやめる
  useEffect(() => {
    setPicking(false);
    input.clear();
  }, [key]);

  useEffect(() => {
    // パンくずリストは、今の局面が見えるよう右端までスクロール
    const el = crumbsRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [path.length]);

  function advance(edge: TreeEdge) {
    setPath([...path, edge.to]);
    setForward(forward[0] === edge.to ? forward.slice(1) : []);
    setNote('');
  }
  function goBack() {
    if (path.length <= 1) return;
    setForward([key, ...forward]);
    setPath(path.slice(0, -1));
    setNote('');
  }
  function goForward() {
    const next = forward[0] ?? node.edges[0]?.to;
    if (!next) return;
    const edge = node.edges.find((e) => e.to === next);
    if (edge) advance(edge);
  }
  function jumpTo(length: number) {
    if (length >= path.length) return;
    setForward([...path.slice(length), ...forward]);
    setPath(path.slice(0, length));
    setNote('');
  }

  // 棋譜欄（段階11-5）：たどった手順と、その先（さっきまでいた手順・本線）。広い画面は盤の横、スマホ縦は「手順」で画面下から
  const wide = useWideLayout();
  const [kifuOpen, setKifuOpen] = useState(false);
  const kifu = treeKifu(tree, path, forward);
  function jumpPly(ply: number) {
    const length = ply - kifu.base + 1;
    if (length < 1) return;
    if (length <= path.length) {
      jumpTo(length);
      return;
    }
    const add = kifu.ahead.slice(0, length - path.length);
    setPath([...path, ...add]);
    setForward(add.every((k, i) => forward[i] === k) ? forward.slice(add.length) : []);
    setNote('');
  }

  function expand(id: PresetId) {
    setDialog(null);
    setNote('');
    void startGeneration(tree, generationSettingsFor(id), key);
  }
  function verify() {
    setNote('');
    void startVerify(tree, key, settings.value.verifyMs);
  }
  /** 相手の応手を除外して、この局面を調べ直す（候補を補い、ラベルを付け直す） */
  async function exclude(edge: TreeEdge) {
    setMenuEdge(null);
    if (isGenerating() || !excludeMove(node, edge.move)) return;
    setForward([]);
    setNote('');
    await saveEdited(tree);
    void startResample(tree, key);
  }
  /** 盤で選んだ自分の手を、最善手と比べてから本線にして、その先を作る */
  function explore(move: string, id: PresetId) {
    setPickedMove(null);
    setNote('');
    setForward([]);
    void startExplore(tree, key, move, generationSettingsFor(id));
  }
  function startPicking() {
    setNote('');
    setPicking(true);
  }
  function cancelPicking() {
    setPicking(false);
    input.clear();
  }
  /** 自分の対応の手を本線（いちばん上）にする */
  async function makeMain(edge: TreeEdge) {
    setMenuEdge(null);
    if (isGenerating() || !makeMainMove(node, edge.move)) return;
    setForward([]);
    setNote('本線にしました（復習の正解・書き出しの本譜・「ここから展開」でたどる手になります）');
    await saveEdited(tree);
  }
  /** 自分の対応の手と、その先の局面を消す（確認の後） */
  async function remove(edge: TreeEdge) {
    setDeleting(null);
    if (isGenerating() || !deleteMove(tree, key, edge.move)) return;
    setForward([]);
    setNote('消しました');
    await saveEdited(tree);
  }
  /** 除外した手を戻す（調べ直しはしない。ラベルは付け直す） */
  async function restore(edge: TreeEdge) {
    if (isGenerating() || !restoreMove(node, edge.move)) return;
    setNote('');
    await saveEdited(tree);
  }
  /**
   * 「定跡帳に足す」（段階10-2）：平手からの手順にして、自分の側だけ確かめて足す（名前は自動）。
   * この局面で終わる研究手順がもうあれば「定跡帳で開く」（その研究手順の終わりの局面で定跡帳）
   */
  function openStudy() {
    if (studyHere) {
      go(studyBookUrl(studyHere));
      return;
    }
    const problem = addProblem(fullMoves, tree.mySide);
    if (problem) {
      setNote(problem);
      return;
    }
    setNote('');
    setDialog('add-book');
  }
  /** 研究手順の名前・メモ・自分の側を直す（★ の窓の「直す」） */
  async function saveStudy(f: { name: string; note: string; mySide: Study['mySide'] }) {
    setDialog(null);
    if (!studyHere) return;
    try {
      await updateStudyFields(studyHere, f);
      setNote(`研究手順「${f.name.trim()}」を直しました`);
    } catch (e) {
      setNote(`保存できませんでした（${e instanceof Error ? e.message : String(e)}）`);
    }
  }
  async function deleteStudy() {
    if (!studyHere) return;
    setDialog(null);
    await removeStudy(studyHere.id);
    setNote(`研究手順「${studyHere.name}」を消しました`);
  }

  /** 「戦型として登録」：平手の初期局面から始まるツリーだけ */
  function openRegister() {
    if (tree.prefix.initialSfen !== STARTPOS_SFEN) {
      setNote('平手の初期局面から始まるツリーだけ、局面を戦型として登録できます（SFEN で途中の局面から始めたツリーは登録できません）。');
      return;
    }
    setNote('');
    setDialog('register');
  }

  async function copyKif() {
    const ok = await copyText(pathToKif(tree, path, thresholds));
    setNote(ok ? 'この局面までの KIF をコピーしました。iShogi などの「クリップボードから読み込み」で貼り付けられます。' : 'コピーできませんでした');
  }
  async function exportAs(kind: 'tree-kif' | 'path-kif' | 'json') {
    // 共有メニューは「押した直後」でないと出ないので、ファイルの中身はここで（待たずに）作る
    const outcome =
      kind === 'json'
        ? await shareFile(fileNameOf(tree.name, 'json'), treeToJson(tree), 'application/json')
        : await shareFile(
            fileNameOf(kind === 'tree-kif' ? tree.name : `${tree.name}_手順`, 'kifu'),
            kind === 'tree-kif' ? treeToKif(tree, thresholds) : pathToKif(tree, path, thresholds),
            'text/plain',
          );
    if (outcome !== 'cancelled') {
      setDialog(null);
      setNote(OUTCOME_TEXT[outcome]);
    }
  }

  // 左右スワイプ：右へ払うと 1 手戻る、左へ払うと 1 手進む
  const touch = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: TouchEvent) => {
    const t = e.touches[0];
    touch.current = { x: t.clientX, y: t.clientY };
  };
  const onTouchEnd = (e: TouchEvent) => {
    const start = touch.current;
    touch.current = null;
    if (!start) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    if (dx > 0) goBack();
    else goForward();
  };

  const sideText = tree.mySide === 'black' ? '☗先手' : '☖後手';

  return (
    <>
      <div class="screen-header">
        <button type="button" class="btn btn-ghost" onClick={() => go('/trees')}>
          ‹ 一覧
        </button>
        <h1 class="tree-title">{tree.name}</h1>
        <button type="button" class="btn" data-testid="review-open" onClick={() => go(`/review/${tree.id}`)}>
          復習
        </button>
      </div>

      {gen && <GenerationPanel tree={tree} />}

      <div class="tree-layout">
        <div
          ref={boardRef}
          {...boardFitProps(boardFit, 'tree-board')}
          data-fit-width={boardFit ?? undefined}
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
        >
          <Board
            sfen={node.sfen}
            lastMove={path.length > 1 ? incoming?.move : lastPrefixMove(tree)}
            {...(picking ? { selection: input.selection, onSquare: input.onSquare, onHand: input.onHand } : {})}
          />
        </div>

        <div class="tree-side" ref={sideRef}>
          {/* 1 手戻る＋手順のパンくずリストを 1 行に（「開始局面」のパンくずで開始局面へ戻る） */}
          <div class="crumb-row">
            <button type="button" class="crumb crumb-back" data-testid="nav-back" onClick={goBack} disabled={path.length <= 1} aria-label="1手戻る">
              ‹
            </button>
            <div class="crumbs" ref={crumbsRef} data-testid="crumbs">
              <button type="button" class={path.length === 1 ? 'crumb current' : 'crumb'} data-testid="crumb-start" onClick={() => jumpTo(1)}>
                開始局面
              </button>
              {path.slice(1).map((k, i) => {
                const from = tree.nodes[path[i]];
                const edge = edgeBetween(tree, path[i], k);
                const prev = i > 0 ? edgeBetween(tree, path[i - 1], path[i])?.move : undefined;
                return (
                  <button
                    type="button"
                    key={`${i}-${k}`}
                    class={i + 2 === path.length ? 'crumb current' : 'crumb'}
                    data-testid="crumb"
                    onClick={() => jumpTo(i + 2)}
                  >
                    {edge ? moveText(from.sfen, edge.move, prev) : '?'}
                  </button>
                );
              })}
            </div>
            {!wide && (
              <button type="button" class="btn kifu-open-btn" data-testid="kifu-open" onClick={() => setKifuOpen(true)}>
                手順 ▾
              </button>
            )}
          </div>
          {wide && <KifuPanel rows={kifu.rows} current={kifu.current} onJump={jumpPly} />}
          {kifuOpen && <KifuSheet rows={kifu.rows} current={kifu.current} onJump={jumpPly} onClose={() => setKifuOpen(false)} />}

          {picking && (
            <div class="card pick-bar" data-testid="pick-bar">
              <span>盤の駒をタップして、調べたい自分の手を指してください</span>
              <button type="button" class="btn btn-ghost" data-testid="pick-cancel" onClick={cancelPicking}>
                やめる
              </button>
            </div>
          )}
          <PromotionBox input={input} />

          <div class="card candidates">
            <div class="candidates-head">
              {/* 件数（除外した手は数えない）。4 つ目以降が画面の外にあっても、あることが分かるように（v0.12.3） */}
              <strong data-testid="candidates-title">
                {opp ? '相手の応手' : '自分の対応'}
                {node.edges.length > 0 && `（${node.edges.length}）`}
              </strong>
              {/* 1 行に収める（スマホ縦で候補手を上に寄せるため）。入りきらなければ説明の方を … で縮める。
                  研究手順の終わりの局面では、説明の代わりに「★ 名前」（盤の大きさが変わらないよう、行を増やさない） */}
              {studyHere ? (
                <button type="button" class="study-here" data-testid="study-here" onClick={() => setDialog('study-view')}>
                  ★ {studyHere.name}
                </button>
              ) : (
                <span class="muted candidates-note">
                  評価値：{opp ? '対応の後・' : ''}
                  {sideText}から
                </span>
              )}
            </div>
            {node.edges.length === 0 && <EmptyNote tree={tree} nodeKey={key} generating={busy} />}
            <ul class="candidate-list">
              {node.edges.map((edge) => {
                // 相手の応手の行は、自分の対応の後の評価値を主に見せる（まだ対応が無ければ応手の評価値）
                const reply = opp ? replyOf(tree, edge) : undefined;
                const info = branchInfo(tree, edge);
                return (
                  <li key={edge.move} class="candidate-item">
                    <button type="button" class="candidate" data-testid="candidate" onClick={() => advance(edge)}>
                      <span class="candidate-line">
                        {starMoves.has(edge.move) && (
                          <span class="study-star" data-testid="study-star" title="研究手順の手">
                            ★
                          </span>
                        )}
                        <span class="candidate-move">{moveText(node.sfen, edge.move, incoming?.move)}</span>
                        {opp && edge.diff !== undefined && <LabelChip diff={edge.diff} />}
                        {!opp && <MineChip mark={mineMark(node, edge)} />}
                        {(parents.get(edge.to) ?? 0) > 1 && <span class="chip chip-merge">合流</span>}
                        <ScoreText score={reply?.score ?? edge.score} />
                      </span>
                      <span class="candidate-line candidate-sub">
                        {opp && <ReplyText tree={tree} edge={edge} reply={reply} />}
                        {!opp && edge.userChosen && edge.loss !== undefined && (
                          <span class={edge.loss > 0 ? 'candidate-loss loss-bad' : 'candidate-loss'} data-testid="candidate-loss">
                            {lossText(edge.loss)}
                          </span>
                        )}
                        {(!opp || reply) && (
                          <span class={`candidate-ahead ahead-${info.kind}`} data-testid="candidate-ahead">
                            {branchText(info)}
                          </span>
                        )}
                      </span>
                    </button>
                    {(opp || node.edges.length > 1) && (
                      <button
                        type="button"
                        class="candidate-menu"
                        data-testid="candidate-menu"
                        aria-label={`${moveText(node.sfen, edge.move, incoming?.move)} の操作`}
                        onClick={() => setMenuEdge(edge)}
                      >
                        ⋯
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
            {node.excluded && node.excluded.length > 0 && (
              <div class="excluded-box" data-testid="excluded-box">
                <button
                  type="button"
                  class="excluded-toggle"
                  data-testid="excluded-toggle"
                  aria-expanded={showExcluded}
                  onClick={() => setShowExcluded(!showExcluded)}
                >
                  除外した手（{node.excluded.length}）{showExcluded ? '▾' : '▸'}
                </button>
                {showExcluded && (
                  <ul class="excluded-list">
                    {node.excluded.map((edge) => (
                      <li key={edge.move} class="excluded-item" data-testid="excluded-item">
                        <span class="candidate-move">{moveText(node.sfen, edge.move, incoming?.move)}</span>
                        <span class="muted">調べません</span>
                        <button type="button" class="btn btn-ghost" data-testid="excluded-restore" disabled={busy} onClick={() => void restore(edge)}>
                          戻す
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          {/* 局面ごとの操作（主役の候補手リストを先に見せるため、その下に置く） */}
          <div class="node-actions">
            <button type="button" class="btn" data-testid="expand-here" onClick={() => setDialog('expand')} disabled={busy || node.terminal}>
              ここから展開
            </button>
            {canVerify && (
              <button type="button" class="btn" data-testid="verify-here" onClick={verify} disabled={busy}>
                この手を検証
              </button>
            )}
            {!opp && !node.terminal && (
              <button type="button" class="btn" data-testid="explore-open" onClick={startPicking} disabled={busy || picking}>
                別の手を調べる
              </button>
            )}
            <button type="button" class="btn" data-testid="study-open" onClick={openStudy} disabled={fullMoves?.length === 0}>
              {studyHere ? '定跡帳で開く' : '定跡帳に足す'}
            </button>
            <button type="button" class="btn" data-testid="copy-kif" onClick={() => void copyKif()}>
              KIFをコピー
            </button>
            <button type="button" class="btn" data-testid="register-template" onClick={openRegister}>
              戦型として登録
            </button>
            <button type="button" class="btn" data-testid="export-open" onClick={() => setDialog('export')}>
              書き出し・共有
            </button>
          </div>
          {note && (
            <p class="muted" role="status" data-testid="tree-note">
              {note}
            </p>
          )}
        </div>
      </div>

      {dialog === 'expand' && (
        <Dialog title="ここから展開" onClose={() => setDialog(null)} testId="expand-dialog">
          <p>この局面から先の、まだ調べていない枝を広げます。今あるツリーに枝を足します。</p>
          <div class="dialog-actions dialog-actions-column">
            {availablePresets().map((id) => (
              <button type="button" key={id} class="btn btn-primary" data-testid={`expand-${id}`} onClick={() => expand(id)}>
                {presetLabel(id)}
              </button>
            ))}
          </div>
        </Dialog>
      )}

      {menuEdge && !opp && (
        <Dialog title={moveText(node.sfen, menuEdge.move, incoming?.move)} onClose={() => setMenuEdge(null)} testId="move-menu">
          <div class="dialog-actions dialog-actions-column">
            <button
              type="button"
              class="btn btn-primary"
              data-testid="make-main"
              disabled={busy || node.edges[0]?.move === menuEdge.move}
              onClick={() => void makeMain(menuEdge)}
            >
              {node.edges[0]?.move === menuEdge.move ? 'これが本線です' : '本線にする'}
            </button>
            <button
              type="button"
              class="btn btn-danger"
              data-testid="delete-move"
              disabled={busy}
              onClick={() => {
                setMenuEdge(null);
                setDeleting(menuEdge);
              }}
            >
              消す
            </button>
          </div>
          <p class="muted">本線（いちばん上の手）が、復習の正解・書き出しの本譜・「ここから展開」でたどる手になります。</p>
          {busy && <p class="muted">生成中は変えられません。止めてから操作してください。</p>}
        </Dialog>
      )}

      {deleting && (
        <Dialog title={`${moveText(node.sfen, deleting.move, incoming?.move)} を消しますか？`} onClose={() => setDeleting(null)} testId="delete-confirm">
          <p>
            {countRemoved(tree, key, deleting.move) > 0 ? `この手と、その先の ${countRemoved(tree, key, deleting.move)} 局面を消します。` : 'この手を消します。'}
            <strong>元に戻せません。</strong>（ほかの手順からも来られる局面は残します）
          </p>
          <div class="dialog-actions">
            <button type="button" class="btn" data-testid="delete-cancel" onClick={() => setDeleting(null)}>
              やめる
            </button>
            <button type="button" class="btn btn-danger" data-testid="delete-ok" disabled={busy} onClick={() => void remove(deleting)}>
              消す
            </button>
          </div>
        </Dialog>
      )}

      {pickedMove && (
        <Dialog title={`${moveText(node.sfen, pickedMove, incoming?.move)} で調べる`} onClose={() => setPickedMove(null)} testId="explore-dialog">
          <p>
            エンジンの最善手とこの手を同じ時間で調べて、最善手からどれだけ損かを出します。
            この手を本線（いちばん上）にして、その先を作ります。最善手は消さずに下に残ります。
          </p>
          <div class="dialog-actions dialog-actions-column">
            {availablePresets().map((id) => (
              <button type="button" key={id} class="btn btn-primary" data-testid={`explore-${id}`} disabled={busy} onClick={() => explore(pickedMove, id)}>
                {presetLabel(id)}
              </button>
            ))}
            <button type="button" class="btn btn-ghost" data-testid="explore-cancel" onClick={() => setPickedMove(null)}>
              やめる
            </button>
          </div>
        </Dialog>
      )}

      {menuEdge && opp && (
        <Dialog title={moveText(node.sfen, menuEdge.move, incoming?.move)} onClose={() => setMenuEdge(null)} testId="move-menu">
          <p>
            人があまり指さない手などを除外すると、この局面を調べ直して（約{Math.round(tree.settings.movetimeMs / 100) / 10}秒）代わりの候補を補います。
            除外した手は、調べ直しても「ここから展開」しても採用しません。リストの下の「除外した手」から戻せます。
          </p>
          <div class="dialog-actions dialog-actions-column">
            <button type="button" class="btn btn-primary" data-testid="exclude-move" disabled={busy} onClick={() => void exclude(menuEdge)}>
              この手を除外
            </button>
          </div>
          {busy && <p class="muted">生成中は除外できません。止めてから除外してください。</p>}
        </Dialog>
      )}

      {dialog === 'add-book' && fullMoves && (
        <AddToBookDialog
          moves={fullMoves}
          side={tree.mySide}
          onDone={(r) => {
            setDialog(null);
            setNote(
              r.kind === 'added'
                ? `定跡帳に足しました：「${r.study.name}」（「定跡帳で開く」で開けます）`
                : `この手順は、研究手順「${r.study.name}」としてすでにあります`,
            );
          }}
          onClose={() => setDialog(null)}
        />
      )}

      {dialog === 'study-edit' && studyHere && (
        <StudyEditDialog
          study={studyHere}
          defaultName={studyHere.name}
          movesText={studyMovesText(studyHere, templates)}
          side={tree.mySide}
          onSave={(f) => void saveStudy(f)}
          onClose={() => setDialog(null)}
        />
      )}

      {dialog === 'study-view' && studyHere && (
        <StudyViewDialog
          study={studyHere}
          onOpen={() => go(studyBookUrl(studyHere))}
          onEdit={() => setDialog('study-edit')}
          onDelete={() => void deleteStudy()}
          onClose={() => setDialog(null)}
        />
      )}

      {dialog === 'register' && (
        <RegisterTemplateDialog
          moves={movesHere}
          mySide={tree.mySide}
          defaultName={path.length === 1 ? tree.name : registerName(movesHere)}
          defaultGroup={closestTemplate(allTemplates(), movesHere)?.group ?? ''}
          onSaved={(t) => {
            setDialog(null);
            setNote(`「${t.name}」を戦型として登録しました。新しいツリーの「戦型から選ぶ」に出ます。`);
          }}
          onClose={() => setDialog(null)}
        />
      )}

      {dialog === 'export' && (
        <Dialog title="書き出し・共有" onClose={() => setDialog(null)} testId="export-dialog">
          <div class="dialog-actions dialog-actions-column">
            <button type="button" class="btn" data-testid="export-tree-kif" onClick={() => void exportAs('tree-kif')}>
              分岐付き KIF（ツリー全体）
            </button>
            <button type="button" class="btn" data-testid="export-path-kif" onClick={() => void exportAs('path-kif')}>
              この局面までの手順の KIF
            </button>
            <button type="button" class="btn" data-testid="export-json" onClick={() => void exportAs('json')}>
              JSON（このアプリ用。仲間に渡す・バックアップ）
            </button>
          </div>
          <p class="muted">
            iPad では共有メニューの「"ファイル"に保存」で保存できます。共有メニューが出ない端末では、ファイルをダウンロードします。
          </p>
        </Dialog>
      )}
    </>
  );
}

/** 生成の進み具合と停止ボタン */
function GenerationPanel({ tree }: { tree: TreeData }) {
  const gen = generation.value!;
  const [, setTick] = useState(0);
  // 経過時間を 1 秒ごとに更新
  useEffect(() => {
    if (gen.phase === 'done') return;
    const timer = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(timer);
  }, [gen.phase]);

  const where = gen.kind === 'explore' ? '（自分の手から）' : gen.startKey === tree.rootKey ? '' : '（途中の局面から）';
  // 自分の手で調べたとき：その手の損（最善手との差）
  const chosen = gen.kind === 'explore' ? tree.nodes[gen.startKey]?.edges[0] : undefined;
  const lossNote = chosen?.userChosen && chosen.loss !== undefined ? `自分の手は${lossText(chosen.loss)}。` : '';

  if (gen.phase === 'done') {
    let text: string;
    if (gen.kind === 'verify') {
      text = gen.finish === 'completed' ? '検証しました（自分の対応のいちばん上が、確定した手です）' : FINISH_TEXT[gen.finish ?? 'stopped'];
    } else if (gen.kind === 'resample') {
      text =
        gen.finish === 'completed'
          ? '除外した手のほかに候補を補いました（ラベルは残った手の中の最善手から付け直しました）'
          : FINISH_TEXT[gen.finish ?? 'stopped'];
    } else {
      text = `${lossNote}${gen.finish ? FINISH_TEXT[gen.finish] : '終わりました'}${where}`;
      if (gen.progress) text += `（調べた局面 ${gen.progress.searched}・全部で ${gen.progress.nodeCount} 局面）`;
    }
    return (
      <div class={gen.error ? 'gen-panel gen-error' : 'gen-panel'} data-testid="gen-status" data-phase="done" data-kind={gen.kind}>
        <span>{text}</span>
        {gen.error && <span class="gen-error-text">{gen.error}</span>}
      </div>
    );
  }

  const elapsed = gen.runStartedAt ? Math.floor((Date.now() - gen.runStartedAt) / 1000) : 0;
  const total = Math.round(gen.settings.totalMs / 1000);
  let text: string;
  if (gen.phase === 'engine') text = 'エンジンを準備中…';
  else if (gen.kind === 'verify') text = `検証中（${total}秒）…`;
  else if (gen.kind === 'resample') text = `調べ直し中（${total}秒）…`;
  else text = `生成中${where} ${Math.min(elapsed, total)}秒／${total}秒・調べた局面 ${gen.progress?.searched ?? 0}・${gen.progress?.round ?? 1}往復目`;
  return (
    <div class="gen-panel" data-testid="gen-status" data-phase={gen.phase} data-kind={gen.kind}>
      <span class="num">{text}</span>
      <button type="button" class="btn btn-danger" data-testid="gen-stop" onClick={stopGeneration}>
        停止
      </button>
      <progress max={gen.settings.totalMs} value={gen.phase === 'engine' ? undefined : Math.min(elapsed * 1000, gen.settings.totalMs)} />
    </div>
  );
}

/** 候補手が無いときの説明 */
function EmptyNote({ tree, nodeKey, generating }: { tree: TreeData; nodeKey: string; generating: boolean }) {
  const node = tree.nodes[nodeKey];
  let text = 'この局面はまだ調べていません。「ここから展開」で調べられます。';
  if (!isOpponentNode(tree, node)) text = '自分の手はまだ調べていません。「この手を検証」か「ここから展開」で調べられます。';
  if (node.terminal) text = '指せる手がありません（詰み・投了など）。';
  else if (isOpponentNode(tree, node) && isAfterDubiousOnly(tree, nodeKey))
    text = '相手の疑問手を咎めた後の局面なので、この先は調べていません（疑問手の先は浅くしています）。必要なら「ここから展開」で調べられます。';
  else if (generating) text = 'この局面はこれから調べます。';
  return (
    <p class="muted" data-testid="empty-note">
      {text}
    </p>
  );
}

/** 相手の応手の行の 2 段目：「→ ▲２六歩」（自分の対応）。まだ無ければ「→ 未展開」 */
function ReplyText({ tree, edge, reply }: { tree: TreeData; edge: TreeEdge; reply: TreeEdge | undefined }) {
  const me = tree.nodes[edge.to];
  if (!reply) {
    return (
      <span class="candidate-reply muted" data-testid="candidate-reply">
        {me?.terminal ? '→ 指せる手なし' : '→ 未展開'}
      </span>
    );
  }
  return (
    <span class="candidate-reply" data-testid="candidate-reply">
      → {moveText(me.sfen, reply.move, edge.move)}
      {reply.userChosen && <span class="chip chip-chosen chip-small">自分の手</span>}
      {!reply.userChosen && reply.unverified && <span class="chip chip-unverified chip-small">未検証</span>}
    </span>
  );
}

function ScoreText({ score }: { score: Score }) {
  const n = scoreToNumber(score);
  const cls = n >= 50 ? 'eval-good' : n <= -50 ? 'eval-bad' : 'eval-even';
  return <span class={`candidate-score num ${cls}`}>{formatScore(score)}</span>;
}

/** 自分の対応の印：自分の手／最善／検証済み／検証前の手（検証で別の手が最善になった）／未検証 */
const MINE_CHIP_CLASS: Record<MineMark, string> = {
  chosen: 'chip-chosen',
  best: 'chip-verified',
  verified: 'chip-verified',
  'before-verify': 'chip-unverified',
  unverified: 'chip-unverified',
  none: '',
};
function MineChip({ mark }: { mark: MineMark }) {
  if (mark === 'none') return null;
  return (
    <span class={`chip ${MINE_CHIP_CLASS[mark]}`} data-testid="mine-mark">
      {MINE_MARK_TEXT[mark]}
    </span>
  );
}

function LabelChip({ diff }: { diff: number }) {
  const label = labelOf(diff, settings.value.thresholds);
  return <span class={`chip chip-${label}`}>{LABEL_TEXT[label]}</span>;
}

/** 局面 from から局面 to への矢印 */
/** 登録する戦型の名前の初期値（例：「18手目 △８四飛まで」） */
function registerName(moves: readonly string[]): string {
  const r = templateLine(moves);
  if (!r.ok || moves.length === 0) return '平手の初期局面';
  return `${moves.length}手目 ${r.line[r.line.length - 1].text ?? ''}まで`;
}

function edgeBetween(tree: TreeData, from: string, to: string): TreeEdge | undefined {
  return tree.nodes[from]?.edges.find((e) => e.to === to);
}
