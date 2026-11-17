// 段階4-1：閲覧画面（スマホ縦で盤＋候補手 3 つが 1 画面に収まる、自分の対応の併記、枝の先の様子）
import { expect, test, type Page } from '@playwright/test';
import { STARTPOS_SFEN, applyUsiMove, sfenKey } from '../src/shogi/position';
import { TREE_APP, TREE_FORMAT_VERSION, type TreeData, type TreeNode } from '../src/tree/types';

const cp = (value: number) => ({ kind: 'cp' as const, value });

/**
 * prefix の後の局面（相手の手番）から、相手の応手を並べた小さなツリー。自分は相手の反対側。
 * replies：[応手, 最善手との差, 自分の対応（無ければ null）, 未検証か]
 */
function makeTree(id: string, prefix: string[], replies: [string, number, string | null, boolean][]): TreeData {
  let sfen = STARTPOS_SFEN;
  for (const m of prefix) sfen = applyUsiMove(sfen, m)!.sfen;
  const nodes: Record<string, TreeNode> = {};
  const add = (s: string, round: number) => (nodes[sfenKey(s)] ??= { key: sfenKey(s), sfen: s, round, edges: [] });
  const root = add(sfen, 0);
  root.searched = { movetimeMs: 1500, multiPV: 3, depth: 18, nodes: 1 };
  for (const [move, diff, reply, unverified] of replies) {
    const a = applyUsiMove(sfen, move)!.sfen;
    const me = add(a, 0);
    root.edges.push({ move, to: me.key, score: cp(100 - diff), diff });
    if (!reply) continue;
    const b = applyUsiMove(a, reply)!.sfen;
    add(b, 1);
    me.edges.push({ move: reply, to: sfenKey(b), score: cp(110 - diff), ...(unverified ? { unverified: true } : {}) });
  }
  return {
    app: TREE_APP,
    version: TREE_FORMAT_VERSION,
    id,
    name: `段階4 ${id}`,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    mySide: sfen.split(' ')[1] === 'w' ? 'black' : 'white',
    rootKey: root.key,
    prefix: { initialSfen: STARTPOS_SFEN, moves: prefix },
    nodes,
    settings: { totalMs: 120_000, movetimeMs: 1500, multiPV: 4, maxRounds: 4, maxNodes: 3000, windowCp: 300, replyMs: 1000, dubiousCp: 150 },
  };
}

/** 平手 ▲７六歩 の後。△３四歩（本線）・△８四歩（本線、対応は未検証）・△３二金（有力）・△９四歩（疑問手）・△１四歩（対応なし） */
const OPENING = makeTree('p4-opening', ['7g7f'], [
  ['3c3d', 0, '2g2f', false],
  ['8c8d', 20, '2g2f', true],
  ['4a3b', 90, '2g2f', false],
  ['9c9d', 200, '2g2f', false],
  ['1c1d', 220, null, false],
]);

async function openTree(page: Page, tree: TreeData) {
  await page.goto('./');
  await expect(page.getByTestId('isolation')).toHaveAttribute('data-state', 'isolated', { timeout: 30_000 });
  await page.getByTestId('import-file').setInputFiles({ name: 't.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(tree)) });
  await expect(page.getByTestId('home-message')).toContainText('取り込みました');
  await page.goto(`./#/tree/${tree.id}`);
  await expect(page.getByTestId('candidate').first()).toBeVisible();
}

// 段階4-1 の「390×844 で 3 行」を、細い・低い画面にも広げた（v0.12.2。持ち主の Android は幅 360 相当）。
// v0.12.3：候補手が 4 つ（「ふつう」「じっくり」の初期設定の数）のとき、盤を画面幅の 85% まで縮めて 4 行目まで収める。
// 収まらない低い画面では、4 行目がのぞく（上端が画面の中）。3 つ以下なら盤を無駄に縮めない。

/** 相手の応手 4 つ（2 つ目の自分の対応は未検証） */
const FOUR = makeTree('p4-four', ['7g7f'], [
  ['3c3d', 0, '2g2f', false],
  ['8c8d', 20, '2g2f', true],
  ['4a3b', 90, '2g2f', false],
  ['9c9d', 200, '2g2f', false],
]);
/** 相手の応手 3 つ */
const THREE = makeTree('p4-three', ['7g7f'], [
  ['3c3d', 0, '2g2f', false],
  ['8c8d', 20, '2g2f', true],
  ['4a3b', 90, '2g2f', false],
]);
/** 相手の応手 5 つのうち 1 つを除外（見出しの件数は 4） */
const FIVE_EXCLUDED: TreeData = (() => {
  const t = makeTree('p4-five-ex', ['7g7f'], [
    ['3c3d', 0, '2g2f', false],
    ['8c8d', 20, '2g2f', true],
    ['4a3b', 90, '2g2f', false],
    ['9c9d', 200, '2g2f', false],
    ['1c1d', 220, null, false],
  ]);
  const root = t.nodes[t.rootKey];
  root.excluded = root.edges.splice(4, 1);
  return t;
})();

/** ヘッダーのボタンが 1 行か（折り返すと高さが 44px を超え、文字の行も 2 つになる） */
async function expectOneLineButtons(page: Page) {
  for (const button of [page.getByRole('button', { name: '‹ 一覧' }), page.getByTestId('review-open')]) {
    const box = (await button.boundingBox())!;
    expect(box.height).toBeLessThanOrEqual(45);
    const lines = await button.evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      return new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size;
    });
    expect(lines).toBe(1);
  }
}

for (const [width, height, label, four] of [
  [360, 740, '細めの Android', 'fit'],
  [412, 800, '一般的な Android', 'fit'],
  [390, 844, 'iPhone 標準', 'fit'],
  [393, 852, 'iPhone 標準（新しめ）', 'fit'],
  [412, 915, '縦長の Android', 'fit'],
  [375, 667, 'iPhone SE', 'peek'],
  [360, 640, '幅 360・高さ 640（目標の下限）', 'peek'],
] as const) {
  test.describe(`スマホ縦（${width}×${height}、${label}）`, () => {
    test.use({ viewport: { width, height }, hasTouch: true });

    test(`候補手 4 つ：${four === 'fit' ? '盤を 85% 以上に保って 4 行目まで見える' : '3 行目まで見え、4 行目がのぞく'}。ヘッダーのボタン・見出しは 1 行`, async ({ page }) => {
      await openTree(page, FOUR);
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
      await expect(page.getByTestId('candidates-title')).toHaveText('相手の応手（4）');
      const header = (await page.locator('.screen-header').boundingBox())!;
      const board = (await page.getByTestId('board').boundingBox())!;
      const rows = page.getByTestId('candidate');
      const third = (await rows.nth(2).boundingBox())!;
      const fourth = (await rows.nth(3).boundingBox())!;
      expect(header.y).toBeGreaterThanOrEqual(0);
      expect(board.y).toBeGreaterThan(header.y);
      // 3 行目までは必ず収める
      expect(third.y + third.height).toBeLessThanOrEqual(height);
      if (four === 'fit') {
        expect(fourth.y + fourth.height).toBeLessThanOrEqual(height);
        expect(board.width).toBeGreaterThanOrEqual(width * 0.85 - 0.5);
      } else {
        // 4 行目の上端が画面の中（下にまだ手があることが分かる）
        expect(fourth.y).toBeLessThan(height);
      }
      // 盤は画面からはみ出さず、左右の真ん中
      expect(board.x).toBeGreaterThanOrEqual(0);
      expect(board.x + board.width).toBeLessThanOrEqual(width);
      expect(Math.abs(board.x + board.width / 2 - width / 2)).toBeLessThanOrEqual(2);
      await expectOneLineButtons(page);
      // 候補手のカードの見出しは 1 行
      const head = (await page.locator('.candidates-head').boundingBox())!;
      expect(head.height).toBeLessThanOrEqual(26);
    });
  });
}

for (const [width, height] of [
  [360, 740],
  [412, 800],
] as const) {
  test.describe(`スマホ縦（${width}×${height}）候補手 3 つ`, () => {
    test.use({ viewport: { width, height }, hasTouch: true });

    test('候補手が 3 つ以下なら、4 行目のために盤を縮めない', async ({ page }) => {
      await openTree(page, THREE);
      await expect(page.getByTestId('candidates-title')).toHaveText('相手の応手（3）');
      const board = (await page.getByTestId('board').boundingBox())!;
      const third = (await page.getByTestId('candidate').nth(2).boundingBox())!;
      expect(third.y + third.height).toBeLessThanOrEqual(height);
      // 画面の端まで（左右 4px ずつの余白）の大きさのまま
      expect(board.width).toBeGreaterThanOrEqual(width - 8 - 1);
    });
  });
}

test.describe('スマホ縦（360×740）見出しの件数', () => {
  test.use({ viewport: { width: 360, height: 740 }, hasTouch: true });

  test('除外した手は数えない。自分の手番の局面は「自分の対応（n）」', async ({ page }) => {
    await openTree(page, FIVE_EXCLUDED);
    await expect(page.getByTestId('candidates-title')).toHaveText('相手の応手（4）');
    await expect(page.getByTestId('candidate')).toHaveCount(4);
    await page.getByTestId('candidate').first().click();
    await expect(page.getByTestId('candidates-title')).toHaveText('自分の対応（1）');
  });
});

test.describe('スマホ縦（360×740）で文字を大きくしたとき', () => {
  test.use({ viewport: { width: 360, height: 740 }, hasTouch: true });

  test('文字を 1.25 倍にしても、ヘッダーのボタンは折り返さず、盤が縮んで候補手 3 行が見える', async ({ page }) => {
    // 候補手 3 つ（4 行目のために縮める分が無く、盤は画面の幅いっぱい）。文字が大きくなった分だけ縮む
    await openTree(page, THREE);
    const before = (await page.getByTestId('board').boundingBox())!;
    // 端末の文字の大きさの設定を、文字の大きさの変数を大きくして再現する
    await page.addStyleTag({ content: ':root { --font-size-body: 20px; --font-size-small: 16px; --font-size-heading: 23px; }' });
    await expect
      .poll(async () => (await page.getByTestId('board').boundingBox())!.width)
      .toBeLessThan(before.width);
    const third = (await page.getByTestId('candidate').nth(2).boundingBox())!;
    expect(third.y + third.height).toBeLessThanOrEqual(740);
    await expectOneLineButtons(page);
  });
});

test.describe('スマホ縦（390×844）', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('相手の応手の行に、自分の対応・ラベル（短く）・枝の先の様子が出る', async ({ page }) => {
    await openTree(page, OPENING);
    const rows = page.getByTestId('candidate');
    await expect(rows.nth(0)).toContainText('△３四歩');
    await expect(rows.nth(0).getByTestId('candidate-reply')).toHaveText('→ ▲２六歩');
    await expect(rows.nth(0)).toContainText('本線');
    await expect(rows.nth(0).getByTestId('candidate-ahead')).toHaveText('対応まで');
    // 評価値は自分の対応の後の値（+110）
    await expect(rows.nth(0)).toContainText('+110');
    // 未検証の対応には印
    await expect(rows.nth(1).getByTestId('candidate-reply')).toContainText('未検証');
    // 疑問手のラベルは短く、咎めまで
    await expect(rows.nth(3).locator('.chip-dubious')).toHaveText('疑問手');
    await expect(rows.nth(3).getByTestId('candidate-ahead')).toHaveText('咎めまで');
    // 自分の対応がまだ無い
    await expect(rows.nth(4).getByTestId('candidate-reply')).toHaveText('→ 未展開');
    // 行のタップは今までどおり 1 手進む
    await rows.nth(0).click();
    await expect(page.getByTestId('crumb')).toHaveText(['△３四歩']);
    await expect(rows.first()).toContainText('▲２六歩');
    // 「‹」で 1 手戻る
    await page.getByTestId('nav-back').click();
    await expect(page.getByTestId('crumb')).toHaveCount(0);
    await expect(page.getByTestId('nav-back')).toBeDisabled();
  });

  test('盤上に候補手の矢印・丸印は描かない（持ち主の判断 2026-11-14）', async ({ page }) => {
    await openTree(page, OPENING);
    // 盤の上の図形は、駒 40 枚の五角形と星 4 つだけ
    await expect(page.locator('[data-testid="board"] polygon')).toHaveCount(40);
    await expect(page.locator('[data-testid="board"] circle')).toHaveCount(4);
  });
});

test.describe('iPad 横（1180×820）', () => {
  test.use({ viewport: { width: 1180, height: 820 }, hasTouch: true });

  test('盤と候補手リストを左右に並べたまま', async ({ page }) => {
    await openTree(page, OPENING);
    const board = await page.getByTestId('board').boundingBox();
    const list = await page.locator('.candidates').boundingBox();
    expect(board!.x + board!.width).toBeLessThanOrEqual(list!.x);
    expect(list!.y).toBeLessThan(board!.y + board!.height / 2);
    await expect(page.getByTestId('candidate').nth(4)).toBeInViewport({ ratio: 1 });
  });
});

// ---- 段階4-2：そのほかの画面の手直し ----

test.describe('4-2 スマホ縦（390×844）', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('入力画面：作るボタンは画面の下に固定され、盤の操作と重ならない', async ({ page }) => {
    await page.goto('./#/new');
    await expect(page.getByTestId('isolation')).toHaveAttribute('data-state', 'isolated', { timeout: 30_000 });
    await expect(page.getByTestId('start-normal')).toBeInViewport({ ratio: 1 });
    const bar = (await page.getByTestId('start-bar').boundingBox())!;
    expect(bar.y + bar.height).toBeLessThanOrEqual(844 + 1);
    // 開いたときは、盤も手順の操作もバーの上（重なっていない）
    const board = (await page.getByTestId('board').boundingBox())!;
    expect(board.y + board.height).toBeLessThanOrEqual(bar.y);
    const nav = (await page.getByTestId('input-next').boundingBox())!;
    expect(nav.y + nav.height).toBeLessThanOrEqual(bar.y);
    // 貼り付け欄を開いても、作るボタンは押せる
    await page.getByTestId('kifu-open').click();
    await expect(page.getByTestId('start-normal')).toBeInViewport({ ratio: 1 });
    // いちばん下までスクロールしても、手順の操作はバーに隠れない
    await page.mouse.wheel(0, 3000);
    await expect(page.getByTestId('input-next')).toBeInViewport({ ratio: 1 });
    const next = (await page.getByTestId('input-next').boundingBox())!;
    const bar2 = (await page.getByTestId('start-bar').boundingBox())!;
    expect(next.y + next.height).toBeLessThanOrEqual(bar2.y);
  });

  test('一覧：自分の側と、開始局面までの最後の数手。速度測定は設定画面へ', async ({ page }) => {
    await openTree(page, makeTree('p42-list', ['7g7f', '3c3d', '2g2f', '8c8d'], [['2f2e', 0, null, false]]));
    await page.goto('./');
    await expect(page.getByTestId('tree-item-position')).toHaveText('自分：☖後手・…△３四歩 ▲２六歩 △８四歩');
    await expect(page.getByText('エンジンの速度測定')).toHaveCount(0);
    await page.getByTestId('open-settings').click();
    await expect(page.getByTestId('open-bench')).toHaveAttribute('href', /bench\.html$/);
  });

  test('復習：相手が直前に指した手を、盤（最終手のマス）と一言で示す。記録を消すは画面の下', async ({ page }) => {
    await openTree(page, OPENING);
    await page.getByTestId('review-open').click();
    await expect(page.getByTestId('review-prompt')).toHaveAttribute('data-phase', 'ask');
    const said = await page.getByTestId('review-opponent').innerText();
    expect(said).toMatch(/^相手は △/);
    // 盤の最終手のマス（行き先）と元のマスに印
    await expect(page.locator('[data-testid="board"] .sq-last')).toHaveCount(1);
    await expect(page.locator('[data-testid="board"] .sq-last-from')).toHaveCount(1);
    // 「記録を消す…」は盤と問題の下
    const clear = (await page.getByTestId('review-clear').boundingBox())!;
    const prompt = (await page.getByTestId('review-prompt').boundingBox())!;
    const line = (await page.getByTestId('review-line').boundingBox())!;
    expect(clear.y).toBeGreaterThan(prompt.y + prompt.height);
    expect(clear.y).toBeGreaterThan(line.y + line.height);
  });
});

test.describe('4-2 iPad 横（1180×820）', () => {
  test.use({ viewport: { width: 1180, height: 820 }, hasTouch: true });

  test('入力画面：左に盤、右に貼り付け・手順の操作・作るボタン（盤に重ならない）', async ({ page }) => {
    await page.goto('./#/new');
    await expect(page.getByTestId('isolation')).toHaveAttribute('data-state', 'isolated', { timeout: 30_000 });
    const board = (await page.getByTestId('board').boundingBox())!;
    const start = (await page.getByTestId('start-normal').boundingBox())!;
    const paste = (await page.getByTestId('kifu-open').boundingBox())!;
    expect(board.x + board.width).toBeLessThanOrEqual(start.x);
    expect(board.x + board.width).toBeLessThanOrEqual(paste.x);
    await expect(page.getByTestId('start-normal')).toBeInViewport({ ratio: 1 });
    await expect(page.getByTestId('board')).toBeInViewport({ ratio: 1 });
  });
});

// ---- 段階4-3 A：この手は調べない（除外） ----

test.describe('4-3 除外', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('除外した手はリストの下に畳まれ、「戻す」で戻る（保存される）', async ({ page }) => {
    const tree = makeTree('p43-restore', ['7g7f'], [
      ['3c3d', 0, '2g2f', false],
      ['8c8d', 20, '2g2f', false],
      ['9c9d', 200, '2g2f', false],
    ]);
    // △９四歩 を除外済みにしておく（形式 2）
    const root = tree.nodes[tree.rootKey];
    root.excluded = root.edges.filter((e) => e.move === '9c9d');
    root.edges = root.edges.filter((e) => e.move !== '9c9d');
    await openTree(page, tree);
    await expect(page.getByTestId('candidate')).toHaveCount(2);
    await expect(page.getByTestId('excluded-toggle')).toHaveText('除外した手（1）▸');
    // 盤＋候補手は今までどおり 1 画面に（「⋯」が付いても）
    await expect(page.getByTestId('candidate').nth(1)).toBeInViewport({ ratio: 1 });
    await page.getByTestId('excluded-toggle').click();
    await expect(page.getByTestId('excluded-item')).toContainText('△９四歩');
    await page.getByTestId('excluded-restore').click();
    await expect(page.getByTestId('candidate')).toHaveCount(3);
    await expect(page.getByTestId('excluded-box')).toHaveCount(0);
    await expect(page.getByTestId('candidate').nth(2)).toContainText('疑問手');
    // 開き直しても戻ったまま
    await page.reload();
    await expect(page.getByTestId('candidate')).toHaveCount(3);
  });

  test('「⋯」のメニューから除外できる（本物のエンジンで調べ直して候補を補う）', async ({ page }) => {
    test.skip(!process.env.ENGINE_AVAILABLE, 'エンジンがビルドされていないので省略（GitHub Actions では実行される）');
    test.setTimeout(120_000);
    // 候補が △３四歩 の 1 手だけのツリー（MultiPV=3）。除外すると、ほかの手が 3 手入るはず
    const tree = makeTree('p43-exclude', ['7g7f'], [['3c3d', 0, '2g2f', false]]);
    tree.settings = { ...tree.settings, multiPV: 3, movetimeMs: 800 };
    await openTree(page, tree);
    await page.getByTestId('candidate-menu').first().click();
    await expect(page.getByTestId('move-menu')).toContainText('△３四歩');
    await page.getByTestId('exclude-move').click();
    await expect(page.locator('[data-testid="gen-status"][data-kind="resample"][data-phase="done"]')).toBeVisible({ timeout: 90_000 });
    await expect(page.getByTestId('gen-status')).toContainText('候補を補いました');
    // エンジンが searchmoves に従っていれば、△３四歩 以外で 3 手そろう
    await expect(page.getByTestId('candidate')).toHaveCount(3);
    for (const text of await page.getByTestId('candidate').allInnerTexts()) expect(text).not.toContain('３四歩');
    await expect(page.getByTestId('candidate').first()).toContainText('本線');
    await expect(page.getByTestId('excluded-toggle')).toHaveText('除外した手（1）▸');
  });
});

// ---- 段階4-3 B：自分の指したい手で調べる・本線にする・消す ----

/** ▲７六歩 △３四歩 の後の自分の手番に、自分の手 ▲６六歩（最善より −80、本線）と最善手 ▲２六歩 があるツリー */
function chosenTree(id: string): TreeData {
  const tree = makeTree(id, ['7g7f'], [
    ['3c3d', 0, '2g2f', false],
    ['8c8d', 20, '2g2f', false],
  ]);
  const me = tree.nodes[tree.nodes[tree.rootKey].edges[0].to];
  me.searched = { movetimeMs: 1000, multiPV: 1, depth: 16, nodes: 1 };
  const after = applyUsiMove(me.sfen, '6g6f')!.sfen;
  tree.nodes[sfenKey(after)] = { key: sfenKey(after), sfen: after, round: 1, edges: [] };
  me.edges.unshift({ move: '6g6f', to: sfenKey(after), score: cp(30), userChosen: true, loss: 80 });
  return tree;
}

test.describe('4-3 自分の手', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('自分の手と最善手の印・損が出る。「⋯」から本線にする・消す（確認あり、保存される）', async ({ page }) => {
    await openTree(page, chosenTree('p43-chosen'));
    const rows = page.getByTestId('candidate');
    // 相手の応手の行の「→ 自分の対応」は、本線の自分の手
    await expect(rows.nth(0).getByTestId('candidate-reply')).toHaveText('→ ▲６六歩自分の手');
    await rows.nth(0).click();
    await expect(rows.nth(0)).toContainText('▲６六歩');
    await expect(rows.nth(0).getByTestId('mine-mark')).toHaveText('自分の手');
    await expect(rows.nth(0).getByTestId('candidate-loss')).toHaveText('最善より −80');
    await expect(rows.nth(1).getByTestId('mine-mark')).toHaveText('最善');
    // 盤＋自分の手 2 行が 1 画面に（「別の手を調べる」の行が増えても）
    await expect(rows.nth(1)).toBeInViewport({ ratio: 1 });

    // 最善手を本線に戻す
    await page.getByTestId('candidate-menu').nth(1).click();
    await page.getByTestId('make-main').click();
    await expect(rows.nth(0)).toContainText('▲２六歩');
    await expect(page.getByTestId('tree-note')).toContainText('本線にしました');
    await page.reload();
    await expect(rows.nth(0).getByTestId('candidate-reply')).toHaveText('→ ▲２六歩');

    // 自分の手を消す（確認で「やめる」なら消えない）
    await rows.nth(0).click();
    await page.getByTestId('candidate-menu').nth(1).click();
    await page.getByTestId('delete-move').click();
    await expect(page.getByTestId('delete-confirm')).toContainText('元に戻せません');
    await page.getByTestId('delete-cancel').click();
    await expect(rows).toHaveCount(2);
    await page.getByTestId('candidate-menu').nth(1).click();
    await page.getByTestId('delete-move').click();
    // ▲６六歩 の先はまだ調べていないので、手だけを消す
    await expect(page.getByTestId('delete-confirm')).toContainText('この手を消します。');
    await page.getByTestId('delete-ok').click();
    await expect(rows).toHaveCount(1);
    // 手が 1 つになったら「⋯」は出さない
    await expect(page.getByTestId('candidate-menu')).toHaveCount(0);
    await page.reload();
    await rows.nth(0).click();
    await expect(rows).toHaveCount(1);
  });

  test('「別の手を調べる」で盤をタップして手を選ぶと、調べ方を選ぶ小窓が出る（やめられる）', async ({ page }) => {
    await openTree(page, OPENING);
    // 相手の手番の局面には出さない
    await expect(page.getByTestId('explore-open')).toHaveCount(0);
    await page.getByTestId('candidate').nth(0).click();
    await page.getByTestId('explore-open').click();
    await expect(page.getByTestId('pick-bar')).toBeVisible();
    await page.locator('[data-square="67"]').click();
    await page.locator('[data-square="66"]').click();
    await expect(page.getByTestId('explore-dialog')).toContainText('▲６六歩 で調べる');
    await expect(page.getByTestId('explore-normal')).toBeVisible();
    await page.getByTestId('explore-cancel').click();
    await expect(page.getByTestId('explore-dialog')).toHaveCount(0);
    await expect(page.getByTestId('pick-bar')).toHaveCount(0);
    // やめた後は、盤をタップしても何も起きない
    await page.locator('[data-square="67"]').click();
    await page.locator('[data-square="66"]').click();
    await expect(page.getByTestId('explore-dialog')).toHaveCount(0);
  });

  test('本物のエンジンで、自分の手を最善手と比べて本線にし、その先を作る', async ({ page }) => {
    test.skip(!process.env.ENGINE_AVAILABLE, 'エンジンがビルドされていないので省略（GitHub Actions では実行される）');
    test.setTimeout(120_000);
    await openTree(page, OPENING);
    await page.getByTestId('candidate').nth(0).click();
    await page.getByTestId('explore-open').click();
    // ▲９六歩（端歩。最善手ではないはず）
    await page.locator('[data-square="97"]').click();
    await page.locator('[data-square="96"]').click();
    await page.getByTestId('explore-normal').click();
    const rows = page.getByTestId('candidate');
    // 比べ終わると、自分の手が本線になり、損が出る
    await expect(rows.nth(0).getByTestId('candidate-loss')).toBeVisible({ timeout: 60_000 });
    await expect(rows.nth(0)).toContainText('▲９六歩');
    await expect(rows.nth(0).getByTestId('mine-mark')).toHaveText('自分の手');
    await expect(rows.nth(1).getByTestId('mine-mark')).toHaveText('最善');
    // その先を作り始めたら止める（ふつうは 2 分かかるので）
    await expect(page.locator('[data-testid="gen-status"][data-kind="explore"]')).toContainText('調べた局面', { timeout: 30_000 });
    await page.getByTestId('gen-stop').click();
    await expect(page.locator('[data-testid="gen-status"][data-phase="done"]')).toContainText('自分の手は最善', { timeout: 30_000 });
    await expect(page.getByTestId('gen-status')).toContainText('（自分の手から）');
    // 自分の手の先に進める
    await rows.nth(0).click();
    await expect(page.getByTestId('crumb')).toHaveText(['△３四歩', '▲９六歩']);
  });
});

// ---- v0.12.4：入力画面・復習画面も、盤の大きさを画面の高さに合わせる ----

/** 入力画面：盤・先手の持ち駒の行・手順の操作が、作るボタンのバーの上に（スクロールせずに）収まっている */
async function expectInputAboveBar(page: Page, height: number) {
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  const bar = (await page.getByTestId('start-bar').boundingBox())!;
  expect(bar.y + bar.height).toBeLessThanOrEqual(height + 1);
  for (const id of ['board', 'hand-black', 'input-nav']) {
    const box = (await page.getByTestId(id).boundingBox())!;
    expect(box.y + box.height, id).toBeLessThanOrEqual(bar.y);
  }
}

for (const [width, height] of [
  [360, 740],
  [375, 667],
  [412, 800],
  [390, 844],
] as const) {
  test.describe(`入力画面・復習画面（${width}×${height}）`, () => {
    test.use({ viewport: { width, height }, hasTouch: true });

    test('入力画面：はじめ・戦型を選んだ後・棋譜を読み込んだ後のどれでも、手順の操作が作るボタンのバーの上', async ({ page }) => {
      await page.goto('./#/new');
      await expect(page.getByTestId('isolation')).toHaveAttribute('data-state', 'isolated', { timeout: 30_000 });
      await expectInputAboveBar(page, height);
      const first = (await page.getByTestId('board').boundingBox())!.width;

      await page.getByTestId('template-open').click();
      await page.getByTestId('template-group').click();
      await page.getByTestId('template-item').filter({ hasText: '青野流（▲5八玉' }).click();
      await expectInputAboveBar(page, height);

      await page.getByTestId('kifu-open').click();
      await page.getByTestId('kifu-input').fill('7g7f 3c3d 2g2f 8c8d');
      await page.getByTestId('kifu-load').click();
      await expect(page.getByTestId('input-message')).toHaveText('4 手を読み込みました（‹ › で局面を選べます）');
      await expectInputAboveBar(page, height);
      // 持ち駒の有無や一言が出ても、盤の大きさは変わらない（指している途中で盤が動かない）
      expect((await page.getByTestId('board').boundingBox())!.width).toBeCloseTo(first, 0);
      // 盤は左右の真ん中
      const board = (await page.getByTestId('board').boundingBox())!;
      expect(Math.abs(board.x + board.width / 2 - width / 2)).toBeLessThanOrEqual(2);
    });

    test('復習画面：問題の文と答えの操作（まちがえた後の「もう一度」「正解を見る」も）が画面の中', async ({ page }) => {
      await openTree(page, OPENING);
      await page.getByTestId('review-open').click();
      const prompt = page.getByTestId('review-prompt');
      await expect(prompt).toHaveAttribute('data-phase', 'ask');
      // 相手の手はランダムに選ばれる（疑問手なら「どう咎めますか？」）
      await expect(prompt).toContainText(/の手は？|どう咎めますか？/);
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
      await expect(prompt).toBeInViewport({ ratio: 1 });
      await expect(page.getByTestId('board')).toBeInViewport({ ratio: 1 });
      // まちがえる（▲１六歩。答えは ▲２六歩）
      await page.locator('[data-square="17"]').click();
      await page.locator('[data-square="16"]').click();
      await expect(page.getByTestId('review-wrong')).toBeVisible();
      await expect(prompt).toBeInViewport({ ratio: 1 });
      await expect(page.getByTestId('review-retry')).toBeInViewport({ ratio: 1 });
      await expect(page.getByTestId('review-show')).toBeInViewport({ ratio: 1 });
      await expect(page.getByTestId('board')).toBeInViewport({ ratio: 1 });
      // 「もう一度」で問題に戻っても、盤の大きさは変わらない（同じ問題の間は縮めた盤を戻さない）
      const wrongWidth = (await page.getByTestId('board').boundingBox())!.width;
      await page.getByTestId('review-retry').click();
      await expect(prompt).toHaveAttribute('data-phase', 'ask');
      await expect(prompt).toBeInViewport({ ratio: 1 });
      expect((await page.getByTestId('board').boundingBox())!.width).toBeCloseTo(wrongWidth, 0);
    });
  });
}
