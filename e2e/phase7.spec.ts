// 段階7-1：トップ画面を戦型ごとに整理する（グループ・開閉・件数・最近開いた・絞り込み）と、小さな不具合 2 つ
import { expect, test, type Page } from '@playwright/test';
import { STARTPOS_SFEN, applyUsiMove, sfenKey, type Side } from '../src/shogi/position';
import { TREE_APP, TREE_FORMAT_VERSION, type TreeData } from '../src/tree/types';

const YOKOFU = '7g7f 3c3d 2g2f 8c8d 2f2e 8d8e 6i7h 4a3b 2e2d 2c2d 2h2d 8e8f 8g8f 8b8f 2d3d'.split(' ');

/** 開始局面だけのツリー（形式 4 の形。templateId なし＝手順から振り分ける） */
function tree(id: string, name: string, moves: string[], mySide: Side, updatedAt: number): TreeData {
  let sfen = STARTPOS_SFEN;
  for (const m of moves) sfen = applyUsiMove(sfen, m)!.sfen;
  const key = sfenKey(sfen);
  return {
    app: TREE_APP,
    version: Math.min(4, TREE_FORMAT_VERSION),
    id,
    name,
    createdAt: updatedAt,
    updatedAt,
    mySide,
    rootKey: key,
    prefix: { initialSfen: STARTPOS_SFEN, moves },
    nodes: { [key]: { key, sfen, round: 0, edges: [] } },
    settings: { totalMs: 30_000, movetimeMs: 400, multiPV: 3, maxRounds: 3, maxNodes: 3000, windowCp: 300 },
  };
}

const DAY = 86_400_000;
const T0 = Date.now() - 10 * DAY;
const TREES = [
  tree('aono', '青野流 → △７六飛まで', [...YOKOFU, '2b3c', '5i5h'], 'white', T0 + 3 * DAY),
  tree('kihon', '横歩取りの基本', YOKOFU, 'white', T0 + 1 * DAY),
  tree('sente', '先手で横歩取り', [...YOKOFU, '5a5b'], 'black', T0 + 2 * DAY),
  tree('naka', '中飛車', ['5g5f', '3c3d'], 'black', T0 + 4 * DAY),
  tree('start', '初手から', [], 'white', T0),
];

async function openHome(page: Page) {
  await page.goto('./');
  await expect(page.getByTestId('isolation')).toHaveAttribute('data-state', 'isolated', { timeout: 30_000 });
}

async function importAll(page: Page, trees: TreeData[]) {
  for (const t of trees) {
    await page.getByTestId('import-file').setInputFiles({ name: `${t.id}.json`, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(t)) });
    await expect(page.getByTestId('home-message')).toContainText(`「${t.name}」を取り込みました`);
  }
}

const group = (page: Page, label: string) => page.getByTestId('tree-group').filter({ has: page.getByTestId('tree-group-head').filter({ hasText: label }) });

/** 閲覧画面で開いてから、一覧に戻る */
async function openAndBack(page: Page, name: string) {
  await page.getByTestId('tree-item').filter({ hasText: name }).click();
  await expect(page).toHaveURL(/#\/tree\//);
  // 閲覧画面が開いてから（開いたことの記録は閲覧画面が出たときに付ける）
  await expect(page.locator('h1')).toContainText(name);
  await page.goBack();
  await expect(page.getByTestId('tree-group').first()).toBeVisible();
}

test.describe('7-1 トップ画面（スマホ縦 360×740）', () => {
  test.use({ viewport: { width: 360, height: 740 }, hasTouch: true });

  test('戦型のグループ × 自分の側でまとまり、件数が出る。グループの中は新しい順、その他はいちばん下。行は幅 360 で崩れない', async ({ page }) => {
    await openHome(page);
    await importAll(page, TREES);
    await expect(page.getByTestId('tree-group-head')).toHaveText([/横歩取り（後手番）\s*2/, /横歩取り（先手番）\s*1/, /その他\s*2/]);
    await expect(group(page, '横歩取り（後手番）').getByTestId('tree-item')).toHaveText([/青野流/, /横歩取りの基本/]);
    await expect(group(page, 'その他').getByTestId('tree-item')).toHaveText([/中飛車/, /初手から/]);
    // 横にはみ出さない
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
    for (const box of await page.getByTestId('tree-item').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().right))) {
      expect(box).toBeLessThanOrEqual(360);
    }
    // 最近開いた：まだ開いていないので出ない
    await expect(page.getByTestId('recent')).toHaveCount(0);
  });

  test('グループを閉じる・開く。閉じた状態は端末に覚える', async ({ page }) => {
    await openHome(page);
    await importAll(page, TREES);
    const sente = group(page, '横歩取り（先手番）');
    await sente.getByTestId('tree-group-head').click();
    await expect(sente.getByTestId('tree-group-head')).toHaveAttribute('aria-expanded', 'false');
    await expect(sente.getByTestId('tree-group-head')).toContainText('▶');
    await expect(sente.getByTestId('tree-item')).toHaveCount(0);
    // 件数は閉じていても出る
    await expect(sente.getByTestId('tree-group-count')).toHaveText('1');
    await page.reload();
    await expect(sente.getByTestId('tree-group-head')).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByTestId('tree-item')).toHaveCount(4);
    await sente.getByTestId('tree-group-head').click();
    await expect(sente.getByTestId('tree-item')).toHaveCount(1);
    await expect(page.getByTestId('tree-item')).toHaveCount(5);
  });

  test('最近開いた：開いた新しい順に 3 件まで（ツリーが 4 つ以上のとき）', async ({ page }) => {
    await openHome(page);
    await importAll(page, TREES);
    await openAndBack(page, '中飛車');
    await expect(page.getByTestId('recent-item')).toHaveText([/中飛車/]);
    await openAndBack(page, '横歩取りの基本');
    await openAndBack(page, '初手から');
    await openAndBack(page, '先手で横歩取り');
    await expect(page.getByTestId('recent-item')).toHaveText([/先手で横歩取り/, /初手から/, /横歩取りの基本/]);
    await expect(page.getByTestId('recent-item').first()).toContainText('開いた 今日');
    // 同じツリーをもう一度開くと、先頭に移る（2 件にならない）
    await openAndBack(page, '初手から');
    await expect(page.getByTestId('recent-item')).toHaveText([/初手から/, /先手で横歩取り/, /横歩取りの基本/]);
    // 一覧の数は変わらない（最近開いたは別の欄）
    await expect(page.getByTestId('tree-item')).toHaveCount(5);
  });

  test('ツリーが 3 つ以下なら「最近開いた」は出さない', async ({ page }) => {
    await openHome(page);
    await importAll(page, TREES.slice(0, 3));
    await openAndBack(page, '青野流');
    await expect(page.getByTestId('recent')).toHaveCount(0);
  });

  test('名前で絞り込む：全部のグループを開いて、当てはまるツリーだけ。全角・半角を区別しない', async ({ page }) => {
    await openHome(page);
    await importAll(page, TREES);
    await openAndBack(page, '中飛車');
    await openAndBack(page, '青野流');
    await openAndBack(page, '初手から');
    await openAndBack(page, '先手で横歩取り');
    // 1 つ閉じておく
    await group(page, 'その他').getByTestId('tree-group-head').click();
    await expect(page.getByTestId('tree-item')).toHaveCount(3);

    await page.getByTestId('tree-filter').fill('横歩');
    await expect(page.getByTestId('recent')).toHaveCount(0);
    await expect(page.getByTestId('tree-group-head')).toHaveText([/横歩取り（後手番）\s*1/, /横歩取り（先手番）\s*1/]);
    await expect(page.getByTestId('tree-item')).toHaveText([/横歩取りの基本/, /先手で横歩取り/]);

    // 閉じたグループも、絞り込み中は開く（半角の 7 で全角の ７ に当たる）
    await page.getByTestId('tree-filter').fill('7六');
    await expect(page.getByTestId('tree-item')).toHaveText([/青野流/]);
    await page.getByTestId('tree-filter').fill('中飛');
    await expect(page.getByTestId('tree-group-head')).toHaveText([/その他\s*1/]);
    await expect(page.getByTestId('tree-group-head')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByTestId('tree-item')).toHaveText([/中飛車/]);

    await page.getByTestId('tree-filter').fill('相掛かり');
    await expect(page.getByTestId('tree-item')).toHaveCount(0);
    await expect(page.getByTestId('filter-empty')).toContainText('「相掛かり」が名前に入っているツリーはありません');

    // 消すと元どおり（閉じたグループは閉じたまま、最近開いたも出る）
    await page.getByTestId('tree-filter').fill('');
    await expect(page.getByTestId('recent-item')).toHaveCount(3);
    await expect(page.getByTestId('tree-item')).toHaveCount(3);
  });

  test('新しく作ったツリーは、選んだ戦型のグループに入る（作った戦型を記録する）', async ({ page }) => {
    await openHome(page);
    await page.getByTestId('new-tree').click();
    await page.getByTestId('template-open').click();
    await page.getByTestId('template-group').filter({ hasText: '横歩取り' }).click();
    await page.getByTestId('template-item').filter({ hasText: '青野流（▲5八玉' }).click();
    await page.getByTestId('start-normal').click();
    await expect(page).toHaveURL(/#\/tree\//);
    // エンジンが無い環境でもツリー自体は保存される。止めて一覧へ
    if (await page.getByTestId('gen-stop').isVisible().catch(() => false)) await page.getByTestId('gen-stop').click();
    await page.goto('./');
    // 青野流（▲5八玉まで）は先手番の戦型
    await expect(page.getByTestId('tree-group-head')).toHaveText([/横歩取り（先手番）\s*1/]);
    await expect(page.getByTestId('tree-item')).toContainText('青野流');
  });
});

test.describe('小さな不具合', () => {
  test.use({ viewport: { width: 360, height: 640 }, hasTouch: true });

  test('幅 360 で「棋譜を貼り付ける」「戦型から選ぶ」が 1 行', async ({ page }) => {
    await page.goto('./#/new');
    await expect(page.getByTestId('isolation')).toHaveAttribute('data-state', 'isolated', { timeout: 30_000 });
    for (const id of ['kifu-open', 'template-open']) {
      const button = page.getByTestId(id);
      const lines = await button.evaluate((el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        return new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size;
      });
      expect(lines, id).toBe(1);
      expect((await button.boundingBox())!.height, id).toBeLessThanOrEqual(48);
    }
    await expect(page.getByTestId('kifu-open')).toHaveText('棋譜を貼り付ける');
  });

  test('入力画面の持ち駒は小さな札（行の高さ 32px）。駒を取っても行の高さは変わらず、札を押して打てる', async ({ page }) => {
    await page.goto('./#/new');
    await expect(page.getByTestId('isolation')).toHaveAttribute('data-state', 'isolated', { timeout: 30_000 });
    const hand = page.getByTestId('hand-black');
    expect(Math.round((await hand.boundingBox())!.height)).toBe(32);
    // 角換わり：▲7六歩 △3四歩 ▲2二角成 △同銀 → 先手の持ち駒に角
    await page.getByTestId('kifu-open').click();
    await page.getByTestId('kifu-input').fill('7g7f 3c3d 8h2b+ 3a2b');
    await page.getByTestId('kifu-load').click();
    expect(Math.round((await hand.boundingBox())!.height)).toBe(32);
    const piece = hand.locator('button.hand-tap');
    await expect(piece).toHaveText('角');
    const chip = (await hand.locator('.hand-piece').boundingBox())!;
    expect(chip.height).toBeLessThanOrEqual(22);
    const tap = (await piece.boundingBox())!;
    expect(tap.height).toBeGreaterThanOrEqual(32);
    // 押すと選んだ状態 → 盤に打てる（▲5五角）
    await piece.click();
    await expect(piece).toHaveAttribute('aria-pressed', 'true');
    await page.locator('[data-square="55"]').click();
    await expect(page.getByTestId('input-position')).toContainText('5手目');
  });
});
