// 段階11：画面の刷新（11-4 復習を小分けにする・11-1 画面の下のタブ・11-5 棋譜欄・11-2 盤の下の固定バー・11-3 メニューと説明文）
import { expect, test, type Page } from '@playwright/test';
import { STARTPOS_SFEN, applyUsiMove, sfenKey } from '../src/shogi/position';
import { TREE_APP, TREE_FORMAT_VERSION, type Study, type TreeData, type TreeNode } from '../src/tree/types';
import { openStudyReview } from './studyTree';
import { openStudyList } from './study-list';

/**
 * 開いている窓を × で閉じる（窓が本当に開くまで待ってから押し、閉じたのを確かめる）。
 * Esc だと、遅い端末（GitHub の実行環境）で窓が開く前に押してしまい、後から開いた窓が次の操作をふさぐことがあった
 */
async function closeDialog(page: Page) {
  await page.locator('dialog[open]').last().getByRole('button', { name: '閉じる' }).click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
}

test.use({ viewport: { width: 360, height: 740 }, hasTouch: true });

async function openHome(page: Page) {
  await page.goto('./');
  await expect(page.getByTestId('isolation')).toHaveAttribute('data-state', 'isolated', { timeout: 30_000 });
}

/** 画面が横にはみ出すとき、画面の幅からはみ出している部品（「タグ.クラス 右端 "文字"」。はみ出さなければ空） */
async function overflowing(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    // 画面が横にスクロールしないなら無し（横にスクロールする欄の中身＝パンくずなどは、はみ出しではない）
    if (document.documentElement.scrollWidth <= vw) return [];
    const out: string[] = [];
    for (const e of Array.from(document.querySelectorAll('body *'))) {
      const b = e.getBoundingClientRect();
      if (b.width > 0 && b.right > vw + 0.5) {
        const cls = typeof (e as HTMLElement).className === 'string' ? (e as HTMLElement).className : '';
        out.push(`${e.tagName.toLowerCase()}.${cls} ${Math.round(b.right)} "${(e.textContent ?? '').trim().slice(0, 20)}"`);
      }
    }
    return out.slice(0, 8);
  });
}

async function play(page: Page, from: string, to: string) {
  await page.locator(`[data-square="${from}"]`).click();
  await page.locator(`[data-square="${to}"]`).click();
}

/** 先手の手が 6 つある研究手順（▲7六歩 △3四歩 ▲2六歩 △8四歩 ▲2五歩 △8五歩 ▲7八金 △3二金 ▲2四歩 △同歩 ▲同飛） */
const LINE: Study = {
  id: 's-line',
  name: '横歩の手前',
  note: '',
  moves: '7g7f 3c3d 2g2f 8c8d 2f2e 8d8e 6i7h 4a3b 2e2d 2c2d 2h2d'.split(' '),
  mySide: 'black',
  createdAt: 1,
  updatedAt: 1,
};

test.describe('11-4 復習を小分けにする', () => {
  test('1 回の問題の数（設定で 5 問）を答えたら結果：正解の数・まちがえた問題（大きく見られる）・全体の数、もう 5 問', async ({ page }) => {
    await openHome(page);
    // 設定で 1 回 5 問に
    await page.getByTestId('tab-settings').click();
    await page.getByTestId('settings-row-trees').click();
    await expect(page.getByTestId('review-batch-10')).toHaveAttribute('aria-checked', 'true');
    await page.getByTestId('review-batch-5').click();
    await page.goto('./');
    await page.getByTestId('tab-studies').click();
    await expect(page.getByTestId('study-register')).toBeVisible();
    await page.getByTestId('study-import-file').setInputFiles({
      name: 's.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ app: 'joban-tree', kind: 'studies', version: 1, studies: [LINE] })),
    });
    // 段階19：研究手順の 1 局面ずつの復習は稽古に置きかえたので、ツリーの復習の「研究手順だけ」で確かめる
    await expect(page.getByTestId('study-count')).toHaveText(`研究手順 ${1} 本`);
    await openStudyReview(page);

    const progress = page.getByTestId('review-progress');
    await expect(progress).toHaveText('今日 1／5問');
    await expect(page.getByTestId('review-summary')).toContainText('問題 6（まだ 6');
    await play(page, '77', '76'); // 1 問目 正解
    await expect(progress).toHaveText('今日 2／5問');
    await play(page, '17', '16'); // 2 問目 まちがい
    await expect(page.getByTestId('review-wrong')).toBeVisible();
    await expect(progress).toHaveText('今日 2／5問');
    await page.getByTestId('review-show').click();
    await page.getByTestId('review-continue').click();
    await expect(progress).toHaveText('今日 3／5問');
    await play(page, '26', '25'); // 3 問目
    await expect(progress).toHaveText('今日 4／5問');
    await play(page, '69', '78'); // 4 問目
    await expect(progress).toHaveText('今日 5／5問');
    await play(page, '25', '24'); // 5 問目 → 結果

    await expect(page.getByTestId('review-result-score')).toHaveText('5 問中 4 問正解（1 回目で）');
    await expect(page.getByTestId('review-mistake')).toHaveCount(1);
    await expect(page.getByTestId('review-mistake')).toContainText('正解 ▲２六歩');
    await expect(page.getByTestId('review-mistake')).toContainText('指した手 ▲１六歩');
    await expect(page.getByTestId('review-result-overall')).toContainText('問題 6（まだ 1・前回まちがい 1');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
    await page.getByTestId('review-mistake').click();
    await expect(page.getByTestId('review-mistake-dialog')).toBeVisible();
    await closeDialog(page);

    // もう 5 問：新しい 1 回
    await expect(page.getByTestId('review-more')).toHaveText('もう 5 問');
    await page.getByTestId('review-more').click();
    await expect(progress).toHaveText('今日 1／5問');
  });
});

test.describe('11-1 画面の下のタブ', () => {
  test('開くと定跡帳。タブで切り替え、戻るボタンで前のタブ。盤の画面にはタブを出さない。設定のタブにバージョン', async ({ page }) => {
    await openHome(page);
    await expect(page.getByRole('heading', { name: '定跡帳' })).toBeVisible();
    await expect(page.getByTestId('tab-studies')).toHaveAttribute('aria-current', 'page');
    await expect(page.getByTestId('study-register')).toBeVisible();
    await expect(page.getByTestId('new-tree')).toHaveCount(0);

    // 段階18：ツリーのタブは実戦のタブに置きかわった（ツリーは設定から。e2e/phase18.spec.ts）
    await page.getByTestId('tab-games').click();
    await expect(page).toHaveURL(/#\/games$/);
    await expect(page.getByRole('heading', { name: '実戦' })).toBeVisible();
    await expect(page.getByTestId('games-paste')).toBeVisible();
    await expect(page.getByTestId('study-register')).toHaveCount(0);

    // 段階19：復習のタブは稽古のタブに置きかわった（e2e/phase19.spec.ts）
    await page.getByTestId('tab-practice').click();
    await expect(page).toHaveURL(/#\/practice$/);
    await expect(page.getByTestId('practice-empty')).toBeVisible();

    await page.getByTestId('tab-settings').click();
    await expect(page).toHaveURL(/#\/settings$/);
    await expect(page.getByTestId('app-version')).toHaveText(/^v\d+\.\d+\.\d+$/);
    await expect(page.getByTestId('feedback-open')).toBeVisible();
    // いちばん下まで送っても、タブに隠れない
    await page.getByTestId('feedback-open').scrollIntoViewIfNeeded();
    const tabTop = (await page.getByTestId('tabbar').boundingBox())!.y;
    const infoBottom = await page.getByTestId('feedback-open').evaluate((e) => e.getBoundingClientRect().bottom);
    expect(infoBottom).toBeLessThanOrEqual(tabTop);

    // 戻るボタンで前のタブへ
    await page.goBack();
    await expect(page.getByTestId('tab-practice')).toHaveAttribute('aria-current', 'page');
    await page.goBack();
    await expect(page.getByTestId('tab-games')).toHaveAttribute('aria-current', 'page');
    await page.goBack();
    await expect(page.getByTestId('tab-studies')).toHaveAttribute('aria-current', 'page');

    // 盤の画面（新しいツリー・定跡帳）にはタブを出さない
    await page.goto('./#/trees');
    await page.getByTestId('new-tree').click();
    await expect(page.getByTestId('board')).toBeVisible();
    await expect(page.getByTestId('tabbar')).toHaveCount(0);
    await page.goto(`./#/book/${encodeURIComponent('study:hirate|black')}`);
    await expect(page.getByTestId('book-head-empty')).toBeVisible();
    await expect(page.getByTestId('tabbar')).toHaveCount(0);
    // 横にはみ出す部品があれば、その名前を出す（GitHub の実行環境は字の幅が違うので、どこがはみ出したか分かるように）
    expect(await overflowing(page)).toEqual([]);
  });
});

/** 平手からの 1 本道のツリー（開始局面までの手 prefix の後に moves。どの局面もいちばん上の手だけ） */
function lineTree(id: string, prefix: string[], moves: string[]): TreeData {
  let sfen = STARTPOS_SFEN;
  for (const m of prefix) sfen = applyUsiMove(sfen, m)!.sfen;
  const nodes: Record<string, TreeNode> = {};
  const add = (s: string) => (nodes[sfenKey(s)] ??= { key: sfenKey(s), sfen: s, round: 0, edges: [] });
  const root = add(sfen);
  let node = root;
  for (const m of moves) {
    const next = add(applyUsiMove(node.sfen, m)!.sfen);
    node.edges.push({ move: m, to: next.key, score: { kind: 'cp', value: 0 }, diff: 0 } as never);
    node = next;
  }
  return {
    app: TREE_APP,
    version: TREE_FORMAT_VERSION,
    id,
    name: `棋譜欄 ${id}`,
    createdAt: 1,
    updatedAt: 1,
    mySide: 'white',
    rootKey: root.key,
    prefix: { initialSfen: STARTPOS_SFEN, moves: prefix },
    nodes,
    settings: { totalMs: 120_000, movetimeMs: 1500, multiPV: 4, maxRounds: 4, maxNodes: 3000, windowCp: 300, replyMs: 1000, dubiousCp: 150 },
  } as TreeData;
}

async function importStudy(page: Page, study: Study) {
  await page.getByTestId('tab-studies').click();
  await expect(page.getByTestId('study-register')).toBeVisible();
  await page.getByTestId('study-import-file').setInputFiles({
    name: 's.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ app: 'joban-tree', kind: 'studies', version: 1, studies: [study] })),
  });
  await expect(page.getByTestId('study-count')).toHaveText(`研究手順 ${1} 本`);
}

test.describe('11-5 手順の一覧（棋譜欄）', () => {
  test('スマホ縦：定跡帳の手数を押すと画面下から開く。今の行が目立ち、押すとその局面へ移って閉じる', async ({ page }) => {
    await openHome(page);
    await importStudy(page, LINE);
    await (await openStudyList(page)).getByTestId('study-item').click();
    const pos = page.getByTestId('study-position');
    await expect(pos).toHaveText('11手目 ▲同　飛');
    // スマホ縦では盤の横に出さない（盤の大きさは変わらない）
    await expect(page.getByTestId('kifu-panel')).toHaveCount(0);
    await pos.click();
    const sheet = page.getByTestId('kifu-sheet');
    await expect(sheet).toBeVisible();
    const rows = sheet.getByTestId('kifu-row');
    await expect(rows).toHaveCount(12);
    await expect(rows.first()).toHaveText('初期局面');
    await expect(sheet.locator('[aria-current="step"]')).toHaveAttribute('data-ply', '11');
    await expect(sheet.locator('[aria-current="step"]')).toBeInViewport();
    await rows.nth(3).click();
    await expect(sheet).toHaveCount(0);
    await expect(pos).toHaveText('3手目 ▲２六歩');
    // 開き直すと、今の行は 3 手目。先の手は少し薄く
    await pos.click();
    await expect(page.getByTestId('kifu-sheet').locator('[aria-current="step"]')).toHaveAttribute('data-ply', '3');
    await expect(page.getByTestId('kifu-sheet').getByTestId('kifu-row').nth(4)).toHaveClass(/ahead/);
    await closeDialog(page);
    expect(await overflowing(page)).toEqual([]);
  });

  test('スマホ縦：ツリーは固定バーの真ん中で開く。たどった手の先に本線を薄く出し、押すとそこまで進む。開始局面より前の手は押せない', async ({ page }) => {
    await openHome(page);
    const tree = lineTree('k1', ['7g7f'], ['3c3d', '2g2f', '8c8d', '2f2e']);
    await page.goto('./#/trees');
    await page.getByTestId('import-file').setInputFiles({ name: 't.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(tree)) });
    await page.getByTestId('tree-item').click();
    await expect(page.getByTestId('tree-position')).toHaveText('開始局面');
    await page.getByTestId('tree-position').click();
    const sheet = page.getByTestId('kifu-sheet');
    const rows = sheet.getByTestId('kifu-row');
    await expect(rows).toHaveText(['初期局面', /1▲７六歩開始局面/, /2△３四歩/, /3▲２六歩/, /4△８四歩/, /5▲２五歩/]);
    await expect(rows.nth(0)).toBeDisabled();
    await expect(rows.nth(1)).toHaveAttribute('aria-current', 'step');
    await expect(rows.nth(3)).toHaveClass(/ahead/);
    await rows.nth(4).click();
    await expect(sheet).toHaveCount(0);
    await expect(page.getByTestId('tree-position')).toHaveText('4手目 △８四歩');
    // 戻っても、さっきまでいた手が先に出る
    await page.getByTestId('nav-first').click();
    await expect(page.getByTestId('tree-position')).toHaveText('開始局面');
    await page.getByTestId('tree-position').click();
    await expect(page.getByTestId('kifu-sheet').getByTestId('kifu-row')).toHaveCount(6);
    await page.getByTestId('kifu-sheet').getByTestId('kifu-row').nth(2).click();
    await expect(page.getByTestId('tree-position')).toHaveText('2手目 △３四歩');
    expect(await overflowing(page)).toEqual([]);
  });

  test('スマホ縦：新しいツリーの画面も同じ部品。手数を押して局面を選ぶ', async ({ page }) => {
    await openHome(page);
    await page.goto('./#/trees');
    await page.getByTestId('new-tree').click();
    await page.getByTestId('kifu-open').click();
    await page.getByTestId('kifu-input').fill('7g7f 3c3d 2g2f 8c8d');
    await page.getByTestId('kifu-load').click();
    const pos = page.getByTestId('input-position');
    await expect(pos).toHaveText('4手目 △８四歩');
    await pos.click();
    const rows = page.getByTestId('kifu-sheet').getByTestId('kifu-row');
    await expect(rows).toHaveCount(5);
    await expect(rows.first()).toHaveText('開始局面');
    await rows.nth(1).click();
    await expect(pos).toHaveText('1手目 ▲７六歩');
  });
});

test.describe('11-5 手順の一覧（iPad 横）', () => {
  test.use({ viewport: { width: 1180, height: 820 } });

  test('盤の横に常に出す。今の行が目立ち、押すとその局面へ（定跡帳・ツリー）', async ({ page }) => {
    await openHome(page);
    await importStudy(page, LINE);
    await (await openStudyList(page)).getByTestId('study-item').click();
    const panel = page.getByTestId('kifu-panel');
    await expect(panel).toBeVisible();
    await expect(panel.locator('[aria-current="step"]')).toHaveAttribute('data-ply', '11');
    await expect(panel.locator('[aria-current="step"]')).toBeInViewport();
    // 手数を押しても窓は出ない（もう横に出ている）
    await page.getByTestId('study-position').click();
    await expect(page.getByTestId('kifu-sheet')).toHaveCount(0);
    await panel.getByTestId('kifu-row').nth(5).click();
    await expect(page.getByTestId('study-position')).toHaveText('5手目 ▲２五歩');
    await expect(panel.locator('[aria-current="step"]')).toHaveAttribute('data-ply', '5');
    // 盤と棋譜欄は左右に並ぶ
    const board = (await page.getByTestId('study-board').boundingBox())!;
    const box = (await panel.boundingBox())!;
    expect(box.x).toBeGreaterThan(board.x + board.width - 1);

    // ツリー
    await page.goto('./#/trees');
    const tree = lineTree('k2', [], ['7g7f', '3c3d', '2g2f']);
    await page.getByTestId('import-file').setInputFiles({ name: 't.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(tree)) });
    await page.getByTestId('tree-item').click();
    await page.getByTestId('kifu-panel').getByTestId('kifu-row').nth(2).click();
    await expect(page.getByTestId('tree-position')).toHaveText('2手目 △３四歩');
    // 真ん中を押しても窓は出ない（もう横に出ている）
    await page.getByTestId('tree-position').click();
    await expect(page.getByTestId('kifu-sheet')).toHaveCount(0);
    expect(await overflowing(page)).toEqual([]);
  });
});

/** 段階14：操作バーは盤（と持ち駒の行）のすぐ下。ページ全体はスクロールしない */
async function expectBarUnderBoard(page: Page, barId: string, boardSel: string, height: number) {
  const bar = (await page.getByTestId(barId).boundingBox())!;
  const board = (await page.locator(boardSel).first().boundingBox())!;
  expect(bar.y).toBeGreaterThanOrEqual(board.y + board.height - 1);
  expect(bar.y - (board.y + board.height)).toBeLessThan(16);
  expect(bar.y + bar.height).toBeLessThanOrEqual(height);
  expect(await page.evaluate(() => document.scrollingElement!.scrollHeight)).toBeLessThanOrEqual(height + 1);
  return bar;
}

test.describe('11-2 盤の下の固定バー', () => {
  test('定跡帳：‹ › の行と手順の行の代わりに、盤のすぐ下のバー（段階14）。真ん中を押すと手順の一覧。ページはスクロールしない', async ({ page }) => {
    await openHome(page);
    await importStudy(page, LINE);
    await (await openStudyList(page)).getByTestId('study-item').click();
    await expect(page.getByTestId('study-position')).toHaveText('11手目 ▲同　飛');
    await expectBarUnderBoard(page, 'study-nav', '[data-testid="study-board"]', 740);
    for (const id of ['study-first', 'study-prev', 'study-next', 'study-last']) {
      const b = (await page.getByTestId(id).boundingBox())!;
      expect(b.width).toBeGreaterThanOrEqual(44);
      expect(b.height).toBeGreaterThanOrEqual(44);
    }
    // 出発点（初期局面）へ・最後へ
    await expect(page.getByTestId('study-last')).toBeDisabled();
    await page.getByTestId('study-first').click();
    await expect(page.getByTestId('study-position')).toHaveText('初期局面');
    await expect(page.getByTestId('study-prev')).toBeDisabled();
    await page.getByTestId('study-next').click();
    await expect(page.getByTestId('study-position')).toHaveText('1手目 ▲７六歩');
    // 取り消す・まとめて復習は ⋯ の中（段階14：盤の下から外した）
    await page.getByTestId('book-menu').click();
    await expect(page.getByTestId('book-review')).toBeVisible();
    await expect(page.getByTestId('book-undo')).toBeVisible();
    await closeDialog(page);
    await page.getByTestId('study-position').click();
    await expect(page.getByTestId('kifu-sheet').locator('[aria-current="step"]')).toHaveAttribute('data-ply', '1');
    await closeDialog(page);
    expect(await overflowing(page)).toEqual([]);
  });

  test('ツリー：パンくずの行と操作のボタンは無く、操作は見出しの ⋯ に。バーは盤のすぐ下、候補手はその下（段階14）', async ({ page }) => {
    await openHome(page);
    const tree = lineTree('b1', ['7g7f'], ['3c3d', '2g2f', '8c8d']);
    await page.goto('./#/trees');
    await page.getByTestId('import-file').setInputFiles({ name: 't.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(tree)) });
    await page.getByTestId('tree-item').click();
    await expect(page.getByTestId('tree-title')).toHaveText('ツリー棋譜欄 b1');
    const bar = await expectBarUnderBoard(page, 'tree-nav', '.tree-board', 740);
    await expect(page.getByTestId('expand-here')).toHaveCount(0);
    await expect(page.getByTestId('candidate')).toHaveCount(1);
    const row = (await page.getByTestId('candidate').first().boundingBox())!;
    expect(row.y).toBeGreaterThanOrEqual(bar.y + bar.height);
    expect(row.y + row.height).toBeLessThanOrEqual(740);
    // › ›| で本線を進む、|‹ で開始局面へ
    await page.getByTestId('nav-forward').click();
    await expect(page.getByTestId('tree-position')).toHaveText('2手目 △３四歩');
    await page.getByTestId('nav-last').click();
    await expect(page.getByTestId('tree-position')).toHaveText('4手目 △８四歩');
    await expect(page.getByTestId('nav-forward')).toBeDisabled();
    await page.getByTestId('nav-first').click();
    await expect(page.getByTestId('tree-position')).toHaveText('開始局面');
    // 見出しの ⋯：この局面（ここから展開・定跡帳に足す・KIFをコピー・戦型として登録）、このツリー（書き出し・共有）
    await page.getByTestId('tree-menu').click();
    const menu = page.getByTestId('tree-menu-dialog');
    for (const id of ['expand-here', 'study-open', 'copy-kif', 'register-template', 'export-open']) await expect(menu.getByTestId(id)).toBeVisible();
    await menu.getByTestId('expand-here').click();
    await expect(page.getByTestId('expand-dialog')).toBeVisible();
    await closeDialog(page);
    expect(await overflowing(page)).toEqual([]);
  });

  test('復習：真ん中に「今日 n／10問」。問題を出している間は ‹ › を押せず、答えた後はさかのぼって見られる', async ({ page }) => {
    await openHome(page);
    const tree = lineTree('b2', [], ['7g7f', '3c3d', '2g2f']);
    await page.goto('./#/trees');
    await page.getByTestId('import-file').setInputFiles({ name: 't.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(tree)) });
    await page.getByTestId('tree-item').click();
    await page.getByTestId('review-open').click();
    await expect(page.getByTestId('review-prompt')).toHaveAttribute('data-phase', 'ask');
    await expect(page.getByTestId('review-progress')).toHaveText('今日 1／10問');
    await expectBarUnderBoard(page, 'review-nav', '.tree-board', 740);
    await expect(page.getByTestId('review-prev')).toBeDisabled();
    await expect(page.getByTestId('review-next-move')).toBeDisabled();
    // △3四歩と答える → 正解 → この先に問題が無いので手順の終わり
    await play(page, '33', '34');
    await expect(page.getByTestId('review-prompt')).toHaveAttribute('data-phase', 'end');
    await expect(page.getByTestId('review-viewing')).toHaveCount(0);
    await page.getByTestId('review-prev').click();
    await expect(page.getByTestId('review-viewing')).toHaveText('▲７六歩を表示中');
    await page.getByTestId('review-prev').click();
    await expect(page.getByTestId('review-viewing')).toHaveText('開始局面を表示中');
    await expect(page.getByTestId('review-prev')).toBeDisabled();
    await page.getByTestId('review-next-move').click();
    await page.getByTestId('review-next-move').click();
    await expect(page.getByTestId('review-viewing')).toHaveCount(0);
    await expect(page.getByTestId('review-next-move')).toBeDisabled();
    // 次の手順へ進むと、今の局面に戻る
    await page.getByTestId('review-prev').click();
    await page.getByTestId('review-next').click();
    await expect(page.getByTestId('review-viewing')).toHaveCount(0);
    expect(await overflowing(page)).toEqual([]);
  });

  test('新しいツリー：手順の操作は盤のすぐ下、作るボタンのバーは画面の下（段階14）。貼り付け欄は画面の下から出る窓', async ({ page }) => {
    await openHome(page);
    await page.goto('./#/trees');
    await page.getByTestId('new-tree').click();
    await page.getByTestId('kifu-open').click();
    await expectSheet(page, 'kifu-dialog', 740);
    await page.getByTestId('kifu-input').fill('7g7f 3c3d 2g2f 8c8d');
    await page.getByTestId('kifu-load').click();
    await expect(page.getByTestId('kifu-dialog')).toHaveCount(0);
    await expectBarUnderBoard(page, 'input-nav', '.input-board', 740);
    const bar = (await page.getByTestId('start-bar').boundingBox())!;
    const nav = (await page.getByTestId('input-nav').boundingBox())!;
    expect(nav.y + nav.height).toBeLessThanOrEqual(bar.y);
    expect(Math.round(bar.y + bar.height)).toBe(740);
    await expect(page.getByTestId('start-bar')).toContainText('この局面から作る（自分は☖後手）');
    await page.getByTestId('input-first').click();
    await expect(page.getByTestId('input-position')).toHaveText('開始局面');
    await page.getByTestId('input-last').click();
    await expect(page.getByTestId('input-position')).toHaveText('4手目 △８四歩');
    expect(await overflowing(page)).toEqual([]);
  });
});

/** 窓が画面の下から出ていること（下端が画面の下端）。窓が開き終わるまで待って測る（開く途中で測ると、GitHub の実行環境で落ちた） */
async function expectSheet(page: Page, testId: string, height: number) {
  const sheet = page.getByTestId(testId);
  await expect(sheet).toBeVisible();
  await expect
    .poll(async () => {
      const box = await sheet.boundingBox();
      return box ? Math.round(box.y + box.height) : null;
    })
    .toBe(height);
}

test.describe('11-3 ⋯ のメニューと説明文', () => {
  test('定跡帳：★ の行の右に［復習］。⋯ は画面の下から出て「この研究手順」「この局面」「定跡帳」で分かれ、ボタンは 1 行', async ({ page }) => {
    await openHome(page);
    await importStudy(page, LINE);
    // 一覧の行の ⋯ も画面の下から。文字は短く
    await (await openStudyList(page)).getByTestId('study-menu').click();
    await expectSheet(page, 'study-menu-dialog', 740);
    await expect(page.getByTestId('study-menu-edit')).toHaveText('名前・メモ');
    await expect(page.getByTestId('study-menu-json')).toHaveCount(0);
    await page.locator('dialog[open]').last().getByRole('button', { name: '閉じる' }).click();
    await closeDialog(page);
    // 初めての説明は、一覧を見るために定跡帳を開いた時点で出ているので、見ていないことにする
    await page.goto('./#/');
    await page.evaluate(() => localStorage.removeItem('joban-tree.hints-seen'));
    await page.reload();

    await (await openStudyList(page)).getByTestId('study-item').click();
    await expect(page.getByTestId('study-title')).toHaveText('横歩の手前');
    // 初めての 1 回だけ：盤で指すと足される
    await expect(page.getByTestId('hint-book-write')).toBeVisible();
    // ［復習］は ★ の行の中（行は増えない）
    const head = (await page.getByTestId('book-head').boundingBox())!;
    const review = (await page.getByTestId('book-head-review').boundingBox())!;
    expect(Math.abs(review.y + review.height / 2 - (head.y + head.height / 2))).toBeLessThan(2);
    expect(review.x).toBeGreaterThanOrEqual(head.x + head.width);
    expect(review.x + review.width).toBeLessThanOrEqual(360);

    await page.getByTestId('book-menu').click();
    await expectSheet(page, 'book-menu-dialog', 740);
    const menu = page.getByTestId('book-menu-dialog');
    // 段階20-3：「この局面」（ツリーを作る・ツリーで見る）と 1 本ずつの JSON・KIF で渡すを外した
    // 段階21-1：「この局面」は、候補の表・局面メモの窓の入口として戻った
    await expect(menu.locator('.menu-section-title')).toHaveText(['この研究手順（★ 横歩の手前）', 'この局面', '定跡帳']);
    await expect(menu.getByTestId('study-copy-kif')).toHaveText('KIFをコピー');
    await expect(menu.getByTestId('book-share-kif')).toHaveText('KIFで渡す（1本）');
    for (const b of await menu.locator('.dialog-actions-column .btn').all()) {
      expect((await b.boundingBox())!.height).toBeLessThan(50);
    }
    await closeDialog(page);

    // ［稽古］（段階19 まで［復習］）でこの研究手順の稽古へ。答え方の説明も初めての 1 回だけ
    await page.getByTestId('book-head-review').click();
    await expect(page).toHaveURL(/#\/practice\/play\/s-line$/);
    await expect(page.getByTestId('hint-answer-tap')).toBeVisible();
    // 定跡帳に戻ると、もう説明は出ない
    await page.goBack();
    await expect(page.getByTestId('study-title')).toHaveText('横歩の手前');
    await expect(page.getByTestId('hint-book-write')).toHaveCount(0);
    expect(await overflowing(page)).toEqual([]);
  });

  test('ツリー：手の ⋯・見出しの ⋯・書き出しは画面の下から。本線の説明は初めての 1 回だけ', async ({ page }) => {
    await openHome(page);
    const tree = lineTree('m1', ['7g7f'], ['3c3d', '2g2f']);
    // 開始局面（自分＝後手の手番）に、もう 1 つ手を足す（自分の手が 2 つあると ⋯ が出る）
    const root = tree.nodes[tree.rootKey];
    const sfen2 = applyUsiMove(root.sfen, '8c8d')!.sfen;
    tree.nodes[sfenKey(sfen2)] = { key: sfenKey(sfen2), sfen: sfen2, round: 0, edges: [] } as TreeNode;
    root.edges.push({ move: '8c8d', to: sfenKey(sfen2), score: { kind: 'cp', value: 0 } } as never);
    await page.goto('./#/trees');
    await page.getByTestId('import-file').setInputFiles({ name: 't.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(tree)) });
    await page.getByTestId('tree-item').click();
    await expect(page.getByTestId('candidate')).toHaveCount(2);

    await page.getByTestId('candidate-menu').first().click();
    await expectSheet(page, 'move-menu', 740);
    await expect(page.getByTestId('hint-tree-main')).toBeVisible();
    await closeDialog(page);
    await page.getByTestId('candidate-menu').first().click();
    await expect(page.getByTestId('make-main')).toBeVisible();
    await expect(page.getByTestId('hint-tree-main')).toHaveCount(0);
    await closeDialog(page);

    await page.getByTestId('tree-menu').click();
    await expectSheet(page, 'tree-menu-dialog', 740);
    await page.getByTestId('tree-menu-dialog').getByTestId('export-open').click();
    await expectSheet(page, 'export-dialog', 740);
    await expect(page.getByTestId('export-json')).toHaveText('JSONで渡す');
    await closeDialog(page);
    expect(await overflowing(page)).toEqual([]);
  });

  test('新しいツリー：「盤の駒をタップ…」は初めての 1 回だけ。手番の長い説明は出さない', async ({ page }) => {
    await openHome(page);
    await page.goto('./#/trees');
    await page.getByTestId('new-tree').click();
    await expect(page.getByTestId('hint-board-tap')).toBeVisible();
    await expect(page.getByText('この局面は自分の手番です')).toHaveCount(0);
    await page.goBack();
    await page.getByTestId('new-tree').click();
    await expect(page.getByTestId('side-black')).toBeVisible();
    await expect(page.getByTestId('hint-board-tap')).toHaveCount(0);
  });
});
