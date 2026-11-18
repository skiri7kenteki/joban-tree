// 段階8-1：ツリーから独立した研究手順（盤で指して登録・棋譜を貼って登録・研究手順の画面・この局面からツリーを作る・ツリーの★・
// ツリーで見る・ツリーを使わない復習・書き出しと取り込み・端末の保存場所の移し替え・ツリーの JSON の取り込み）
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { STARTPOS_SFEN, applyUsiMove, sfenKey } from '../src/shogi/position';
import { TREE_APP, TREE_FORMAT_VERSION, type Study, type TreeData, type TreeEdge, type TreeNode, type TreeStudy } from '../src/tree/types';

test.use({ viewport: { width: 360, height: 740 }, hasTouch: true });

async function openHome(page: Page) {
  await page.goto('./');
  await expect(page.getByTestId('isolation')).toHaveAttribute('data-state', 'isolated', { timeout: 30_000 });
}

async function importTrees(page: Page, trees: TreeData[]) {
  for (const t of trees) {
    await page.getByTestId('import-file').setInputFiles({ name: `${t.id}.json`, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(t)) });
    await expect(page.getByTestId('home-message')).toContainText(`「${t.name}」を取り込みました`);
  }
}

/** 研究手順の JSON を取り込む（トップ画面の研究手順のタブから） */
async function importStudies(page: Page, studies: Study[]) {
  await page.getByTestId('tab-studies').click();
  await page.getByTestId('study-import-file').setInputFiles({
    name: 'studies.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ app: 'joban-tree', kind: 'studies', version: 1, studies })),
  });
}

async function play(page: Page, from: string, to: string) {
  await page.locator(`[data-square="${from}"]`).click();
  await page.locator(`[data-square="${to}"]`).click();
}

const study = (id: string, name: string, moves: string[], opts: Partial<Study> = {}): Study => ({
  id,
  name,
  note: '',
  moves,
  mySide: 'white',
  createdAt: 1,
  updatedAt: 1,
  ...opts,
});

/**
 * 平手からの小さなツリー（後手番）：
 *   開始局面 ─▲7六歩─ △3四歩 ─▲2六歩─ △8四歩
 *                              └▲6六歩
 *            ─▲2六歩─ △8四歩
 */
function lineTree(id: string, name: string, studies?: TreeStudy[]): TreeData {
  const nodes: Record<string, TreeNode> = {};
  const put = (sfen: string, round: number) => {
    const key = sfenKey(sfen);
    nodes[key] ??= { key, sfen, round, edges: [] };
    return nodes[key];
  };
  const link = (from: TreeNode, move: string, round: number, diff?: number): TreeNode => {
    const to = put(applyUsiMove(from.sfen, move)!.sfen, round);
    const edge: TreeEdge = { move, to: to.key, score: { kind: 'cp', value: -30 }, ...(diff !== undefined ? { diff } : {}) };
    from.edges.push(edge);
    return to;
  };
  const root = put(STARTPOS_SFEN, 0);
  const a = link(root, '7g7f', 0, 0);
  const c = link(a, '3c3d', 1);
  const d = link(c, '2g2f', 1, 0);
  link(d, '8c8d', 2);
  link(c, '6g6f', 1, 20);
  const b = link(root, '2g2f', 0, 10);
  link(b, '8c8d', 1);
  return {
    app: TREE_APP,
    version: studies ? 6 : TREE_FORMAT_VERSION,
    id,
    name,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    mySide: 'white',
    rootKey: root.key,
    prefix: { initialSfen: STARTPOS_SFEN, moves: [] },
    nodes,
    settings: { totalMs: 30_000, movetimeMs: 400, multiPV: 3, maxRounds: 3, maxNodes: 3000, windowCp: 300, replyMs: 300, dubiousCp: 150 },
    ...(studies ? { studies } : {}),
  };
}

const KIF = (handicap: string, moves: string[]) =>
  [`手合割：${handicap}`, '手数----指手---------消費時間--', ...moves.map((m, i) => `${String(i + 1).padStart(4)} ${m}   ( 0:00/00:00:00)`), ''].join('\n');

test.describe('8-1 登録（エンジンを使わない）', () => {
  test('盤で指して登録 → 一覧に出る → 開く（終わりの局面）→ 前後に動かす → この局面からツリーを作る', async ({ page }) => {
    await openHome(page);
    await page.getByTestId('tab-studies').click();
    await expect(page.getByTestId('studies-empty')).toBeVisible();
    await page.getByTestId('study-register').click();
    await page.getByTestId('study-register-board').click();
    await expect(page).toHaveURL(/#\/new\/study$/);
    await expect(page.locator('h1')).toHaveText('研究手順を登録');
    // 作るボタンは無く、「研究手順として保存」
    await expect(page.getByTestId('start-normal')).toHaveCount(0);
    await expect(page.getByTestId('study-save-open')).toBeVisible();
    // 初期局面では保存できない
    await page.getByTestId('study-save-open').click();
    await expect(page.getByTestId('study-note-line')).toContainText('1 手以上進めた局面');

    await play(page, '77', '76');
    await play(page, '33', '34');
    await play(page, '27', '26');
    await expect(page.getByTestId('start-bar')).toContainText('3手目 ▲２六歩までを保存（自分は☗先手）');
    await page.getByTestId('study-save-open').click();
    await expect(page.getByTestId('study-dialog')).toContainText('研究手順として保存');
    await expect(page.getByTestId('study-moves')).toHaveText('▲７六歩 △３四歩 ▲２六歩');
    await expect(page.getByTestId('study-name')).toHaveValue('▲７六歩 △３四歩 ▲２六歩');
    await expect(page.getByTestId('study-side-black')).toHaveAttribute('aria-checked', 'true');
    await page.getByTestId('study-note').fill('狙い：早めの▲2六歩\n2 行目');
    await page.getByTestId('study-save').click();
    await expect(page.getByTestId('study-note-line')).toContainText('研究手順として保存しました');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);

    // 同じ手順でもう一度押すと、新しく作らずに直す画面
    await page.getByTestId('study-save-open').click();
    await expect(page.getByTestId('study-dialog')).toContainText('研究手順を直す');
    await page.getByTestId('study-dialog').getByRole('button', { name: 'やめる' }).click();

    // 一覧に出る
    await page.goto('./');
    await expect(page.getByTestId('tab-studies')).toContainText('研究手順 1');
    const item = page.getByTestId('study-item');
    await expect(item).toHaveCount(1);
    await expect(item).toContainText('▲７六歩 △３四歩 ▲２六歩');
    await expect(item).toContainText('3 手');
    await expect(item.getByTestId('study-item-note')).toHaveText('狙い：早めの▲2六歩');
    await expect(page.getByTestId('tree-group-head')).toHaveText([/その他\s*1/]);

    // 開く：終わりの局面・名前・メモ
    await item.click();
    await expect(page).toHaveURL(/#\/study\/s-[\w-]+$/);
    await expect(page.getByTestId('study-title')).toHaveText('▲７六歩 △３四歩 ▲２六歩');
    await expect(page.getByTestId('study-position')).toHaveText('3手目 ▲２六歩');
    await expect(page.getByTestId('study-screen-note')).toHaveText('狙い：早めの▲2六歩\n2 行目');
    await expect(page.getByTestId('study-meta')).toContainText('3 手');
    // ツリーが無いので「ツリーで見る」は出ない
    await expect(page.getByTestId('study-open-tree')).toHaveCount(0);
    // 前後に動かす
    await page.getByTestId('study-prev').click();
    await expect(page.getByTestId('study-position')).toHaveText('2手目 △３四歩');
    await page.getByTestId('study-crumb').first().click();
    await expect(page.getByTestId('study-position')).toHaveText('1手目 ▲７六歩');
    await page.getByTestId('study-next').click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);

    // この局面からツリーを作る：新しいツリーの画面に、手順を読み込んだ状態で移る（その局面・自分の側）
    await page.getByTestId('study-make-tree').click();
    await expect(page).toHaveURL(/#\/new$/);
    await expect(page.locator('h1')).toHaveText('新しいツリー');
    await expect(page.getByTestId('input-position')).toHaveText('2手目 △３四歩');
    await expect(page.getByTestId('side-black')).toHaveAttribute('aria-checked', 'true');
    await page.getByTestId('input-next').click();
    await expect(page.getByTestId('input-position')).toHaveText('3手目 ▲２六歩');
    await expect(page.getByTestId('start-normal')).toBeVisible();
  });

  test('棋譜を貼って登録：手順を前後して終わりの局面を選ぶ。戦型の後の手順で名前を付ける。平手以外は登録できない', async ({ page }) => {
    await openHome(page);
    await page.goto('./#/new/study');
    await page.getByTestId('kifu-open').click();
    await page.getByTestId('kifu-input').fill(KIF('平手', ['７六歩(77)', '３四歩(33)', '２六歩(27)', '８四歩(83)']));
    await page.getByTestId('kifu-load').click();
    await expect(page.getByTestId('input-position')).toHaveText('4手目 △８四歩');
    await page.getByTestId('input-prev').click();
    await page.getByTestId('study-save-open').click();
    await expect(page.getByTestId('study-name')).toHaveValue('▲７六歩 △３四歩 ▲２六歩');
    await page.getByTestId('study-save').click();
    await expect(page.getByTestId('study-note-line')).toContainText('保存しました');

    // 戦型の手順で始まる棋譜：名前は戦型の出発点の後の手順から
    await page.getByTestId('kifu-open').click();
    const yokofu = ['７六歩(77)', '３四歩(33)', '２六歩(27)', '８四歩(83)', '２五歩(26)', '８五歩(84)', '７八金(69)', '３二金(41)', '２四歩(25)', '同　歩(23)', '同　飛(28)', '８六歩(85)', '同　歩(87)', '同　飛(82)', '３四飛(24)', '３三角(22)', '３六飛(34)', '８四飛(86)'];
    await page.getByTestId('kifu-input').fill(KIF('平手', yokofu));
    await page.getByTestId('kifu-load').click();
    await page.getByTestId('study-save-open').click();
    // 同梱の戦型「横歩取り △3三角型（▲3六飛まで）」がいちばん長く一致するので、その後の手順から
    await expect(page.getByTestId('study-moves')).toHaveText('横歩取り △3三角型（▲3六飛まで） → △８四飛');
    await expect(page.getByTestId('study-name')).toHaveValue('△８四飛');
    await page.getByTestId('study-save').click();
    await expect(page.getByTestId('study-note-line')).toContainText('保存しました');

    // 香落ちの棋譜は登録できない
    await page.getByTestId('kifu-open').click();
    await page.getByTestId('kifu-input').fill(KIF('香落ち', ['３四歩(33)', '７六歩(77)']));
    await page.getByTestId('kifu-load').click();
    await page.getByTestId('study-save-open').click();
    await expect(page.getByTestId('study-note-line')).toContainText('平手の初期局面から始まる手順だけ');
    await expect(page.getByTestId('study-dialog')).toHaveCount(0);

    await page.goto('./');
    await page.getByTestId('tab-studies').click();
    await expect(page.getByTestId('study-item')).toHaveCount(2);
    // 戦型の手順で始まるものは、その戦型のグループ
    await expect(page.getByTestId('tree-group-head')).toHaveText([/横歩取り（後手番）\s*1/, /その他\s*1/]);
  });
});

test.describe('8-1 ツリーとのつながり・復習', () => {
  test('ツリーを開くと★が付く（独立して登録した研究手順でも）。終わりの局面で名前。ツリーで見る。ツリーから保存', async ({ page }) => {
    await openHome(page);
    await importTrees(page, [lineTree('line', '研究用ツリー')]);
    await importStudies(page, [study('s-a', '研究A', ['7g7f', '3c3d', '2g2f'], { note: 'Aのメモ' }), study('s-b', '研究B', ['2g2f', '3c3d'])]);
    await expect(page.getByTestId('home-message')).toContainText('研究手順 2 本を取り込みました');

    await page.getByTestId('tab-trees').click();
    await page.getByTestId('tree-item').click();
    const cand = page.getByTestId('candidate');
    await expect(cand.filter({ hasText: '▲７六歩' }).getByTestId('study-star')).toHaveCount(1);
    await expect(cand.filter({ hasText: '▲２六歩' }).getByTestId('study-star')).toHaveCount(1);
    await cand.filter({ hasText: '▲７六歩' }).click();
    await cand.filter({ hasText: '△３四歩' }).click();
    await expect(cand.filter({ hasText: '▲２六歩' }).getByTestId('study-star')).toHaveCount(1);
    await expect(cand.filter({ hasText: '▲６六歩' }).getByTestId('study-star')).toHaveCount(0);
    await cand.filter({ hasText: '▲２六歩' }).click();
    await expect(page.getByTestId('study-here')).toHaveText('★ 研究A');
    await expect(page.getByTestId('study-open')).toHaveText('研究手順を直す');
    // 手順前後で同じ局面（▲2六歩 △8四歩）でも、研究B（▲2六歩 △3四歩）とは違う手順なので★は付かない
    await page.getByTestId('crumb-start').click();
    await cand.filter({ hasText: '▲２六歩' }).click();
    await expect(cand.filter({ hasText: '△８四歩' }).getByTestId('study-star')).toHaveCount(0);

    // ツリーから保存（平手からの手順にして保存）
    await page.getByTestId('crumb-start').click();
    await cand.filter({ hasText: '▲７六歩' }).click();
    await cand.filter({ hasText: '△３四歩' }).click();
    await cand.filter({ hasText: '▲６六歩' }).click();
    await page.getByTestId('study-open').click();
    await expect(page.getByTestId('study-name')).toHaveValue('▲７六歩 △３四歩 ▲６六歩');
    await expect(page.getByTestId('study-side-white')).toHaveAttribute('aria-checked', 'true');
    await page.getByTestId('study-save').click();
    await expect(page.getByTestId('study-here')).toHaveText('★ ▲７六歩 △３四歩 ▲６六歩');

    // 研究手順の画面で開く → ツリーで見る（今の局面）
    await page.getByTestId('crumb').nth(1).click();
    await cand.filter({ hasText: '▲２六歩' }).click();
    await page.getByTestId('study-here').click();
    await expect(page.getByTestId('study-view-note')).toHaveText('Aのメモ');
    await page.getByTestId('study-view-open').click();
    await expect(page).toHaveURL(/#\/study\/s-a$/);
    await page.getByTestId('study-prev').click();
    await page.getByTestId('study-open-tree').click();
    await expect(page).toHaveURL(/#\/tree\/line\/study\/s-a\/2$/);
    await expect(page.getByTestId('crumb')).toHaveText(['▲７六歩', '△３四歩']);

    // 研究B はツリーで最後までたどれない（▲2六歩 △3四歩 はツリーに無い）。1 手目まで戻せばツリーで見られる
    await page.goto('./#/study/s-b');
    await expect(page.getByTestId('study-title')).toHaveText('研究B');
    await expect(page.getByTestId('study-open-tree')).toHaveCount(0);
    await page.getByTestId('study-prev').click();
    await expect(page.getByTestId('study-open-tree')).toBeVisible();
  });

  test('研究手順だけの復習が、ツリーなしの研究手順で動く（1 本・グループ・研究手順の画面から）', async ({ page }) => {
    await openHome(page);
    await importStudies(page, [
      study('s-1', '研究1', ['7g7f', '3c3d', '2g2f', '8c8d'], { note: 'メモの 1 行目\n2 行目', updatedAt: 3 }),
      study('s-2', '研究2', ['2g2f', '8c8d'], { updatedAt: 2 }),
    ]);
    await expect(page.getByTestId('study-item')).toHaveText([/研究1/, /研究2/]);
    await page.getByTestId('study-menu').first().click();
    await page.getByTestId('study-menu-review').click();
    await expect(page).toHaveURL(/#\/study-review\/s-1$/);
    await expect(page.getByTestId('review-summary')).toContainText('研究「研究1」だけ・問題 2（まだ 2');
    await expect(page.getByTestId('review-opponent')).toHaveText('相手は ▲７六歩');
    await play(page, '33', '34');
    await expect(page.getByTestId('review-answer')).toContainText('正解！');
    await expect(page.getByTestId('review-opponent')).toHaveText('相手は ▲２六歩');
    await play(page, '13', '14');
    await expect(page.getByTestId('review-wrong')).toContainText('△１四歩 ではありません');
    await page.getByTestId('review-retry').click();
    await play(page, '83', '84');
    await expect(page.getByTestId('review-end')).toHaveText('研究「研究1」を最後まで答えました（2 問中 1 問、1 回目で正解）。');
    await expect(page.getByTestId('review-study-note')).toHaveText('メモの 1 行目\n2 行目');
    await expect(page.getByTestId('review-next')).toHaveText('もう一度');
    await expect(page.getByTestId('review-summary')).toContainText('問題 2（まだ 0・前回まちがい 1');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);

    // グループ（その他）の研究手順を復習：記録は研究手順どうしで共通
    await page.goto('./');
    await page.getByTestId('tab-studies').click();
    await page.getByTestId('study-group-menu-open').click();
    await page.getByTestId('study-group-review').click();
    await expect(page).toHaveURL(/#\/study-review\/group\//);
    await expect(page.getByTestId('review-summary')).toContainText('「その他」の研究手順 2 本・問題 3（まだ 1・前回まちがい 1');
    await expect(page.getByTestId('review-prompt')).toHaveAttribute('data-phase', 'ask');

    // 研究手順の画面から
    await page.goto('./#/study/s-2');
    await page.getByTestId('study-screen-review').click();
    await expect(page).toHaveURL(/#\/study-review\/s-2$/);
    await expect(page.getByTestId('review-opponent')).toHaveText('相手は ▲２六歩');
    await play(page, '83', '84');
    await expect(page.getByTestId('review-end')).toContainText('研究「研究2」を最後まで答えました（1 問中 1 問');

    // ツリーの復習画面の「研究手順だけ」：ツリーの開始局面を通る研究手順
    await page.goto('./');
    await importTrees(page, [lineTree('rv', '復習するツリー')]);
    await page.getByTestId('tab-trees').click();
    await page.getByTestId('tree-item').click();
    await page.getByTestId('review-open').click();
    await expect(page.getByTestId('review-mode-all')).toHaveAttribute('aria-selected', 'true');
    await page.getByTestId('review-mode-studies').click();
    await expect(page).toHaveURL(/#\/review\/rv\/study$/);
    await expect(page.getByTestId('review-summary')).toContainText('研究手順 2 本・問題 3');
    await page.getByTestId('review-mode-all').click();
    await expect(page).toHaveURL(/#\/review\/rv$/);
    await expect(page.getByTestId('review-summary')).not.toContainText('研究手順');
  });
});

test.describe('8-1 書き出し・取り込み', () => {
  test('選んで JSON・KIF に書き出す。JSON の取り込みで同じ手順があれば、置き換える・両方残す・取り込まないを選ぶ', async ({ page }) => {
    await openHome(page);
    await importStudies(page, [study('s-1', '研究1', ['7g7f', '3c3d'], { note: 'メモ1' }), study('s-2', '研究2', ['2g2f', '8c8d'])]);
    await expect(page.getByTestId('study-item')).toHaveCount(2);

    await page.getByTestId('study-export-open').click();
    await expect(page.getByTestId('study-export-count')).toContainText('2 本');
    await page.getByTestId('study-export-none').click();
    await expect(page.getByTestId('study-export-json')).toBeDisabled();
    await page.getByTestId('study-export-check').first().click();
    await expect(page.getByTestId('study-export-count')).toContainText('1 本');
    await page.getByTestId('study-export-all').click();
    const [json] = await Promise.all([page.waitForEvent('download'), page.getByTestId('study-export-json').click()]);
    const file = JSON.parse(readFileSync((await json.path())!, 'utf8')) as { kind: string; studies: Study[] };
    expect(file.kind).toBe('studies');
    expect(file.studies.map((s) => s.name).sort()).toEqual(['研究1', '研究2']);
    const [kif] = await Promise.all([page.waitForEvent('download'), page.getByTestId('study-export-kif').click()]);
    expect(kif.suggestedFilename()).toMatch(/\.kifu$/);
    const kifText = readFileSync((await kif.path())!, 'utf8');
    expect(kifText).toContain('手合割：平手');
    expect(kifText).toContain('*★研究1');
    expect(kifText).toContain('*メモ1');
    expect(kifText).toContain('変化：1手');
    await page.keyboard.press('Escape');

    // 同じ手順で名前の違う研究手順を取り込む → 両方残す
    await importStudies(page, [study('x-1', '研究1（仲間）', ['7g7f', '3c3d'])]);
    await expect(page.getByTestId('study-import-conflict')).toContainText('「研究1（仲間）」（今は「研究1」）');
    await page.getByTestId('study-import-both').click();
    await expect(page.getByTestId('home-message')).toContainText('研究手順 1 本を取り込みました');
    await expect(page.getByTestId('study-item')).toHaveCount(3);
    // 置き換える
    await importStudies(page, [study('x-2', '研究2（直した）', ['2g2f', '8c8d'])]);
    await page.getByTestId('study-import-replace').click();
    await expect(page.getByTestId('study-item')).toHaveCount(3);
    await expect(page.getByTestId('study-item').filter({ hasText: '研究2（直した）' })).toHaveCount(1);
    // 取り込まない・まったく同じものは黙って飛ばす
    await importStudies(page, [study('x-3', '研究2（また別）', ['2g2f', '8c8d']), study('s-1', '研究1', ['7g7f', '3c3d'], { note: 'メモ1' })]);
    await page.getByTestId('study-import-skip').click();
    await expect(page.getByTestId('home-message')).toContainText('まったく同じもの 1 本は飛ばしました');
    await expect(page.getByTestId('home-message')).toContainText('同じ手順の 1 本は取り込みませんでした');
    await expect(page.getByTestId('study-item')).toHaveCount(3);
  });

  test('ツリーのタブの絞り込み欄の説明は「名前で絞り込む…」（切れない）', async ({ page }) => {
    await openHome(page);
    await importTrees(page, [lineTree('f', '絞り込みのツリー')]);
    await page.getByTestId('tab-trees').click();
    await expect(page.getByTestId('tree-filter')).toHaveAttribute('placeholder', '名前で絞り込む…');
    await importStudies(page, [study('s-1', '研究1', ['7g7f'])]);
    await expect(page.getByTestId('tree-filter')).toHaveAttribute('placeholder', '名前・メモで絞り込む…');
  });
});

test.describe('8-1 移し替え（段階7の研究手順 → 独立した研究手順）', () => {
  test('版 3 の端末のツリーの中の研究手順を、1 回だけ移す（消えない・二重にならない・記録も写す）。平手から始まらないツリーの分は残す', async ({ page }) => {
    await openHome(page);
    const a = lineTree('tree-a', 'ツリーA', [
      { id: 's-1', name: '古い名前', note: '古いメモ', moves: ['7g7f', '3c3d', '2g2f'], createdAt: 1, updatedAt: 10 },
      { id: 's-2', name: '研究2', note: '', moves: ['2g2f', '8c8d'], createdAt: 1, updatedAt: 5 },
    ]);
    const b = lineTree('tree-b', 'ツリーB', [{ id: 's-dup', name: '新しい名前', note: '新しいメモ', moves: ['7g7f', '3c3d', '2g2f'], createdAt: 2, updatedAt: 20 }]);
    const c = lineTree('tree-c', '途中から', [{ id: 's-c', name: '途中の研究', note: '', moves: ['7g7f'], createdAt: 1, updatedAt: 1 }]);
    c.prefix = { initialSfen: applyUsiMove(STARTPOS_SFEN, '5g5f')!.sfen, moves: [] };
    // ツリーAの復習の記録：▲7六歩の後（△3四歩が本線）を 2 回続けて正解
    const after76 = sfenKey(applyUsiMove(STARTPOS_SFEN, '7g7f')!.sfen);
    const review = [{ treeId: 'tree-a', version: 1, nodes: { [after76]: { seen: 2, correct: 2, streak: 2, lastOk: true, lastAt: 5 } } }];

    // 端末の保存場所を、版 3（段階7）の形で作り直す
    await page.evaluate(
      async ({ trees, review }) => {
        await new Promise<void>((resolve, reject) => {
          const r = indexedDB.deleteDatabase('joban-tree');
          r.onsuccess = () => resolve();
          r.onerror = () => reject(r.error);
        });
        await new Promise<void>((resolve, reject) => {
          const r = indexedDB.open('joban-tree', 3);
          r.onupgradeneeded = () => {
            const db = r.result;
            db.createObjectStore('trees', { keyPath: 'id' });
            db.createObjectStore('review', { keyPath: 'treeId' });
            db.createObjectStore('templates', { keyPath: 'id' });
          };
          r.onsuccess = () => {
            const db = r.result;
            const tx = db.transaction(['trees', 'review'], 'readwrite');
            for (const t of trees) tx.objectStore('trees').put(t);
            for (const x of review) tx.objectStore('review').put(x);
            tx.oncomplete = () => {
              db.close();
              resolve();
            };
            tx.onerror = () => reject(tx.error);
          };
          r.onerror = () => reject(r.error);
        });
      },
      { trees: [a, b, c], review },
    );

    // 新しい版で開く → 移し替え
    await page.reload();
    await expect(page.getByTestId('home-message')).toContainText('研究手順 2 本を「研究手順」の一覧に移しました');
    await expect(page.getByTestId('home-message')).toContainText('途中の局面から始まるツリーの研究手順 1 本は移せませんでした');
    await expect(page.getByTestId('tab-studies')).toContainText('研究手順 2');
    await page.getByTestId('tab-studies').click();
    await expect(page.getByTestId('study-item')).toHaveText([/新しい名前/, /研究2/]);
    await expect(page.getByTestId('study-item').first().getByTestId('study-item-note')).toHaveText('新しいメモ');

    // もう一度開いても増えない・知らせも出ない
    await page.reload();
    await expect(page.getByTestId('study-item')).toHaveCount(2);
    await expect(page.getByTestId('home-message')).toHaveCount(0);

    // メモは両方残る。記録も写っている（▲7六歩の後の △3四歩 は「覚えた」）
    await page.getByTestId('study-item').first().click();
    await expect(page.getByTestId('study-screen-note')).toHaveText('新しいメモ\n――\n古いメモ');
    await page.getByTestId('study-screen-review').click();
    await expect(page.getByTestId('review-summary')).toContainText('問題 1（まだ 0・前回まちがい 0・覚えた 1）');

    // ツリーには研究手順が無くなっても★は付く（手順が同じなので）
    await page.goto('./');
    await page.getByTestId('tab-trees').click();
    await page.getByTestId('tree-item').filter({ hasText: 'ツリーB' }).click();
    await expect(page.getByTestId('candidate').filter({ hasText: '▲７六歩' }).getByTestId('study-star')).toHaveCount(1);
  });

  test('研究手順の入ったツリーの JSON（形式 6）を取り込むと、研究手順も取り込む（同じ手順がすでにあれば二重にしない）', async ({ page }) => {
    await openHome(page);
    await importStudies(page, [study('mine', '自分の研究', ['7g7f', '3c3d', '2g2f'], { updatedAt: 5 })]);
    await page.getByTestId('tab-trees').click();
    const tree = lineTree('from-friend', '仲間のツリー', [
      { id: 'f-1', name: '仲間の研究（同じ手順）', note: '', moves: ['7g7f', '3c3d', '2g2f'], createdAt: 1, updatedAt: 1 },
      { id: 'f-2', name: '仲間の研究', note: '仲間のメモ', moves: ['7g7f', '3c3d', '6g6f'], createdAt: 1, updatedAt: 1 },
    ]);
    await page.getByTestId('import-file').setInputFiles({ name: 't.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(tree)) });
    await expect(page.getByTestId('home-message')).toContainText('「仲間のツリー」を取り込みました。研究手順 1 本も取り込みました（1 本はすでにありました）');
    await page.getByTestId('tab-studies').click();
    await expect(page.getByTestId('study-item')).toHaveText([/自分の研究/, /仲間の研究/]);
  });
});
