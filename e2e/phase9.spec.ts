// 段階9-1：研究手順の手順を編集する（手を足す・1 手戻す・保存・途中で別の手 → 別の研究手順・置き換える・ここで終わりにする・やめる・
// ほかと同じ手順・戻るボタン）
// 段階9-2：研究手順どうしをつないで見る（この局面からの研究・切り替え・定跡帳として見る・まとめて復習・定跡帳から編集）
import { expect, test, type Page } from '@playwright/test';
import type { Study } from '../src/tree/types';

test.use({ viewport: { width: 360, height: 740 }, hasTouch: true });

async function openHome(page: Page) {
  await page.goto('./');
  await expect(page.getByTestId('isolation')).toHaveAttribute('data-state', 'isolated', { timeout: 30_000 });
}

/** 研究手順の JSON を取り込む（トップ画面の研究手順のタブから） */
async function importStudies(page: Page, studies: Study[]) {
  await page.getByTestId('tab-studies').click();
  await page.getByTestId('study-import-file').setInputFiles({
    name: 'studies.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ app: 'joban-tree', kind: 'studies', version: 1, studies })),
  });
  await expect(page.getByTestId('study-item')).toHaveCount(studies.length);
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
  mySide: 'black',
  createdAt: 1,
  updatedAt: 1,
  ...opts,
});

/**
 * 研究手順の画面（#/study/<id>）で開く。段階10-1 から一覧の行は定跡帳を開くので、定跡帳の URL から id を取って移る
 * （研究手順の画面と編集モードは段階10-2 で片付けるので、そのときにこのテストも書き直す）
 */
async function openStudy(page: Page, name: string) {
  await page.getByTestId('study-item').filter({ hasText: name }).click();
  await expect(page).toHaveURL(/#\/book\/[^/]+\/s-[\w-]+\/\d+$/);
  const id = /\/(s-[\w-]+)\/\d+$/.exec(page.url())![1];
  await page.evaluate((sid) => (location.hash = `/study/${sid}`), id);
  await expect(page).toHaveURL(new RegExp(`#/study/${id}$`));
  await expect(page.getByTestId('study-title')).toHaveText(name);
}

test.describe('9-1 研究手順の手順を編集する', () => {
  test('手順を編集 → 手を足す（1 手戻す）→ 保存 → 見返すと延びている。ふだんは盤で指せない', async ({ page }) => {
    await openHome(page);
    await importStudies(page, [study('s-1', '研究1', ['7g7f', '3c3d', '2g2f'], { note: 'メモ' })]);
    await openStudy(page, '研究1');
    // ふだんは表示専用：盤をタップしても手順は変わらない
    await play(page, '83', '84');
    await expect(page.getByTestId('study-meta')).toContainText('3 手');
    await expect(page.getByTestId('study-edit-header')).toHaveCount(0);

    await page.getByTestId('study-edit-start').click();
    await expect(page).toHaveURL(/#\/study\/s-1\/edit$/);
    await expect(page.getByTestId('study-edit-header')).toContainText('手順を編集中');
    await expect(page.getByTestId('study-edit-status')).toContainText('手順の最後に足します');
    await expect(page.getByTestId('study-edit-undo')).toBeDisabled();
    await play(page, '83', '84');
    await play(page, '26', '25');
    await expect(page.getByTestId('study-position')).toHaveText('5手目 ▲２五歩');
    await expect(page.getByTestId('study-meta')).toContainText('5 手（保存前。元は 3 手）');
    // 1 手戻す
    await page.getByTestId('study-edit-undo').click();
    await expect(page.getByTestId('study-meta')).toContainText('4 手（保存前。元は 3 手）');
    await play(page, '26', '25');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);

    await page.getByTestId('study-edit-save').click();
    await expect(page).toHaveURL(/#\/study\/s-1$/);
    await expect(page.getByTestId('study-screen-status')).toHaveText('手順を保存しました（5 手）');
    await expect(page.getByTestId('study-meta')).toContainText('5 手');
    await expect(page.getByTestId('study-position')).toHaveText('5手目 ▲２五歩');
    // 自分で付けた名前とメモはそのまま
    await expect(page.getByTestId('study-title')).toHaveText('研究1');
    await expect(page.getByTestId('study-screen-note')).toHaveText('メモ');

    // 開き直しても延びている
    await page.reload();
    await expect(page.getByTestId('study-meta')).toContainText('5 手');
    await expect(page.getByTestId('study-crumb')).toHaveText(['▲７六歩', '△３四歩', '▲２六歩', '△８四歩', '▲２五歩']);
  });

  test('途中の局面で別の手を指す → 別の研究手順にする → 続けて編集して保存 → 一覧に 2 本並ぶ（元はそのまま）', async ({ page }) => {
    await openHome(page);
    await importStudies(page, [study('s-1', '研究1', ['7g7f', '3c3d', '2g2f', '8c8d'], { note: '元のメモ' })]);
    await openStudy(page, '研究1');
    await page.getByTestId('study-edit-start').click();
    // 2 手目の局面へ戻って、次の手（▲2六歩）と違う ▲6六歩
    await page.getByTestId('study-crumb').nth(1).click();
    await expect(page.getByTestId('study-position')).toHaveText('2手目 △３四歩');
    await expect(page.getByTestId('study-edit-status')).toContainText('置き換える');
    await play(page, '67', '66');
    await expect(page.getByTestId('study-fork-dialog')).toContainText('▲６六歩 を指しました');
    await expect(page.getByTestId('study-fork-dialog')).toContainText('次の手は ▲２六歩 です');
    await expect(page.getByTestId('study-fork-replace')).toHaveText('ここから先を置き換える（後ろの 2 手を消す）');
    await page.getByTestId('study-fork-branch').click();

    await expect(page).toHaveURL(/#\/study\/s-(?!1\/)[\w-]+\/edit$/);
    await expect(page.getByTestId('study-edit-status')).toHaveText('別の研究手順を作りました：「▲７六歩 △３四歩 ▲６六歩」');
    await expect(page.getByTestId('study-title')).toHaveText('▲７六歩 △３四歩 ▲６六歩');
    await expect(page.getByTestId('study-position')).toHaveText('3手目 ▲６六歩');
    // 続けて足して保存（名前は初期値のままなので付け直す）
    await play(page, '83', '84');
    await page.getByTestId('study-edit-save').click();
    await expect(page).toHaveURL(/#\/study\/s-[\w-]+$/);
    await expect(page.getByTestId('study-title')).toHaveText('▲７六歩 △３四歩 ▲６六歩 △８四歩');
    await expect(page.getByTestId('study-meta')).toContainText('4 手');
    await expect(page.locator('.study-note')).toHaveCount(0);

    await page.goto('./');
    await page.getByTestId('tab-studies').click();
    await expect(page.getByTestId('study-item')).toHaveCount(2);
    await expect(page.getByTestId('study-item')).toHaveText([/▲７六歩 △３四歩 ▲６六歩 △８四歩/, /研究1/]);
    await openStudy(page, '研究1');
    await expect(page.getByTestId('study-meta')).toContainText('4 手');
    await expect(page.getByTestId('study-crumb')).toHaveText(['▲７六歩', '△３四歩', '▲２六歩', '△８四歩']);
    await expect(page.getByTestId('study-screen-note')).toHaveText('元のメモ');
  });

  test('ここで終わりにする（確認あり）・やめると元に戻る・ここから先を置き換える', async ({ page }) => {
    await openHome(page);
    await importStudies(page, [study('s-1', '研究1', ['7g7f', '3c3d', '2g2f', '8c8d', '2f2e'])]);
    await openStudy(page, '研究1');
    await page.getByTestId('study-edit-start').click();
    await page.getByTestId('study-crumb').nth(2).click();
    await page.getByTestId('study-edit-truncate').click();
    await expect(page.getByTestId('study-truncate-dialog')).toContainText('後ろの 2 手を消します');
    await page.getByTestId('study-truncate-ok').click();
    await expect(page.getByTestId('study-meta')).toContainText('3 手（保存前。元は 5 手）');
    await expect(page.getByTestId('study-edit-truncate')).toBeDisabled();

    // やめる → 確認 → 元に戻る
    await page.getByTestId('study-edit-cancel').click();
    await page.getByTestId('study-cancel-ok').click();
    await expect(page).toHaveURL(/#\/study\/s-1$/);
    await expect(page.getByTestId('study-meta')).toContainText('5 手');
    await expect(page.getByTestId('study-screen-status')).toHaveText('編集をやめました（手順は元のままです）');

    // もう一度：ここで終わりにして保存
    await page.getByTestId('study-crumb').nth(2).click();
    await page.getByTestId('study-edit-start').click();
    await expect(page.getByTestId('study-position')).toHaveText('3手目 ▲２六歩');
    await page.getByTestId('study-edit-truncate').click();
    await page.getByTestId('study-truncate-ok').click();
    await page.getByTestId('study-edit-save').click();
    await expect(page.getByTestId('study-meta')).toContainText('3 手');

    // ここから先を置き換える
    await page.getByTestId('study-edit-start').click();
    await page.getByTestId('study-crumb').nth(0).click();
    await play(page, '83', '84');
    await page.getByTestId('study-fork-replace').click();
    await expect(page.getByTestId('study-meta')).toContainText('2 手（保存前。元は 3 手）');
    await page.getByTestId('study-edit-save').click();
    await expect(page.getByTestId('study-crumb')).toHaveText(['▲７六歩', '△８四歩']);
    // 初期局面では終わりにできない
    await page.getByTestId('study-edit-start').click();
    await page.getByTestId('study-crumb').nth(0).click();
    await page.getByRole('button', { name: '最初へ' }).click();
    await expect(page.getByTestId('study-edit-truncate')).toBeDisabled();
  });

  test('ほかの研究手順と同じ手順になると保存できない（編集に戻る／もう一方を開く）。戻るボタンで出ると変更を捨てるか聞く', async ({ page }) => {
    await openHome(page);
    await importStudies(page, [study('s-1', '研究1', ['7g7f', '3c3d'], { updatedAt: 2 }), study('s-2', '研究2', ['7g7f', '3c3d', '2g2f'])]);
    await openStudy(page, '研究1');
    await page.getByTestId('study-edit-start').click();
    await play(page, '27', '26');
    await page.getByTestId('study-edit-save').click();
    await expect(page.getByTestId('study-save-same-dialog')).toContainText('研究手順「研究2」とまったく同じ');
    await page.getByTestId('study-save-same-back').click();
    await expect(page.getByTestId('study-edit-header')).toBeVisible();
    await expect(page.getByTestId('study-meta')).toContainText('3 手（保存前。元は 2 手）');

    // 戻るボタン → 変更を捨てるか聞く → 編集に戻る
    await page.goBack();
    await expect(page.getByTestId('study-edit-leave-dialog')).toContainText('研究手順「研究1」の手順に、まだ保存していない変更があります');
    await page.getByTestId('study-edit-leave-back').click();
    await expect(page).toHaveURL(/#\/study\/s-1\/edit$/);
    await expect(page.getByTestId('study-meta')).toContainText('3 手（保存前。元は 2 手）');
    // もう一度戻る → 捨てる
    await page.goBack();
    await page.getByTestId('study-edit-leave-discard').click();
    await expect(page.getByTestId('study-edit-leave-dialog')).toHaveCount(0);
    await expect(page.getByTestId('study-meta')).toContainText('2 手');
    await expect(page.getByTestId('study-edit-header')).toHaveCount(0);

    // 同じ手順 → もう一方を開く（変更は捨てる）
    await page.getByTestId('study-edit-start').click();
    await play(page, '27', '26');
    await page.getByTestId('study-edit-save').click();
    await page.getByTestId('study-save-same-open').click();
    await expect(page).toHaveURL(/#\/study\/s-2$/);
    await expect(page.getByTestId('study-title')).toHaveText('研究2');
    await page.goBack();
    await expect(page).toHaveURL(/#\/study\/s-1$/);
    await expect(page.getByTestId('study-meta')).toContainText('2 手');
    await expect(page.getByTestId('study-edit-leave-dialog')).toHaveCount(0);

    // 分かれる手がすでにある研究手順と同じ → 知らせて、その編集へ移れる
    await page.getByTestId('study-edit-start').click();
    await page.getByTestId('study-crumb').nth(1).click();
    await expect(page.getByTestId('study-position')).toHaveText('2手目 △３四歩');
    await page.getByTestId('study-crumb').nth(0).click();
    await play(page, '83', '84');
    await page.getByTestId('study-fork-branch').click();
    await expect(page).toHaveURL(/#\/study\/s-[\w-]+\/edit$/);
    await page.getByTestId('study-edit-cancel').click();
    // 「▲７六歩 △８四歩」を作ったので、もう一度同じ手で分かれるとすでにある
    await page.goto('./#/study/s-1');
    await page.getByTestId('study-edit-start').click();
    await page.getByTestId('study-crumb').nth(0).click();
    await play(page, '83', '84');
    await page.getByTestId('study-fork-branch').click();
    await expect(page.getByTestId('study-branch-same-dialog')).toContainText('研究手順「▲７六歩 △８四歩」としてすでにあります');
    await page.getByTestId('study-branch-same-open').click();
    await expect(page.getByTestId('study-edit-status')).toHaveText('「▲７六歩 △８四歩」の編集に移りました');
  });
});

// 横歩取り △3三角型（▲3六飛まで）の 17 手（同梱の戦型 yokofu-33kaku）から分かれる 3 本（自分は先手）
const KAKU33 = '7g7f 3c3d 2g2f 8c8d 2f2e 8d8e 6i7h 4a3b 2e2d 2c2d 2h2d 8e8f 8g8f 8b8f 2d3d 2b3c 3d3f'.split(' ');
const BOOK = [
  study('s-a', '研究A', [...KAKU33, '8f8d', '3f2f'], { updatedAt: 3, note: 'Aのメモ\n2 行目' }),
  study('s-b', '研究B', [...KAKU33, '8f8d', '5i5h'], { updatedAt: 2 }),
  study('s-c', '研究C', [...KAKU33, '5a5b'], { updatedAt: 1, note: 'Cのメモ' }),
];

test.describe('9-2 研究手順どうしをつないで見る', () => {
  test('研究手順の画面の「この局面からの研究」：1 本だけの局面では出さない。別の手を押すと研究手順が切り替わる', async ({ page }) => {
    await openHome(page);
    await importStudies(page, BOOK);
    await openStudy(page, '研究A');
    // 終わりの局面：通るのは研究A だけ → 出さない
    await expect(page.getByTestId('study-position')).toContainText('19手目');
    await expect(page.getByTestId('study-book-list')).toHaveCount(0);

    // 1 手戻る（18 手目 △8四飛の後）：研究A・研究B が通る
    await page.getByTestId('study-prev').click();
    await expect(page.getByTestId('study-book-head')).toHaveText('この局面からの研究（2 本）');
    const rows = page.getByTestId('study-book-branch');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText('研究A'); // 数が同じなら最近直した方が上
    await expect(rows.nth(0)).toHaveAttribute('data-current', 'true');
    await expect(rows.nth(1)).toContainText('▲５八玉');
    await expect(rows.nth(1)).toContainText('研究B');
    // 3 行目まで（ここでは 2 行）がスクロールせずに見える
    const box = await rows.nth(1).boundingBox();
    expect(box && box.y + box.height).toBeLessThanOrEqual(740);

    // 違う手を押す → 研究B に切り替わり、その手を指した局面（履歴は増やさない）
    await rows.nth(1).click();
    await expect(page).toHaveURL(/#\/study\/s-b\/19$/);
    await expect(page.getByTestId('study-title')).toHaveText('研究B');
    await expect(page.getByTestId('study-position')).toHaveText('19手目 ▲５八玉');

    // 2 手戻る（17 手目）：3 本。△8四飛（2 本）が上、△5二玉（研究C）が下
    await page.getByTestId('study-prev').click();
    await page.getByTestId('study-prev').click();
    await expect(page.getByTestId('study-book-head')).toHaveText('この局面からの研究（3 本）');
    await expect(rows.nth(0)).toContainText('研究B・研究A');
    await expect(rows.nth(0)).toContainText('（2）');
    await expect(rows.nth(0)).toHaveAttribute('data-current', 'true');
    // 今の研究手順の次の手を押すと 1 手進むだけ
    await rows.nth(0).click();
    await expect(page.getByTestId('study-title')).toHaveText('研究B');
    await expect(page.getByTestId('study-position')).toContainText('18手目');
    await page.getByTestId('study-prev').click();
    await rows.nth(1).click();
    await expect(page.getByTestId('study-title')).toHaveText('研究C');
    // 研究C の終わり：通るのは 1 本だけ
    await expect(page.getByTestId('study-book-list')).toHaveCount(0);
    // 戻るボタンで、開く前の画面へ（切り替えで履歴は増えていない。段階10-1 から、一覧 → 定跡帳 → 研究手順の画面の順に開いている）
    await page.goBack();
    await expect(page.getByTestId('book-title')).toBeVisible();
    await page.goBack();
    await expect(page.getByTestId('study-item').first()).toBeVisible();
  });

  test('定跡帳として見る：出発点からたどる・研究手順の数・ここで終わる研究・まとめて復習・定跡帳で指して延ばす', async ({ page }) => {
    await openHome(page);
    await importStudies(page, BOOK);
    await page.getByTestId('study-group-menu-open').first().click();
    await page.getByTestId('study-group-book').click();
    await expect(page.getByTestId('book-title')).toHaveText('定跡帳横歩取り（先手番）');
    // 出発点は 3 本が全部通る戦型の出発点（△3三角型）。それより前には戻れない。いちばん最近直した研究A を見ている
    await expect(page.getByTestId('study-position')).toContainText('17手目');
    await expect(page.getByTestId('book-start-crumb')).toContainText('△3三角型');
    await expect(page.getByTestId('study-prev')).toBeDisabled();
    await expect(page.getByTestId('study-title')).toHaveText('研究A');
    await expect(page.getByTestId('study-meta')).toContainText('Aのメモ');
    await expect(page.getByTestId('study-book-head')).toHaveText('この局面からの研究（3 本）');
    const rows = page.getByTestId('study-book-branch');
    await expect(rows).toHaveCount(2);
    // 3 行目まで見える高さ（ここでは 2 行と、空けた分）
    const box = await rows.nth(1).boundingBox();
    expect(box && box.y + box.height).toBeLessThanOrEqual(740);

    // △8四飛 → 2 本
    await rows.nth(0).click();
    await expect(page.getByTestId('study-book-head')).toHaveText('この局面からの研究（2 本）');
    // ▲5八玉 → 研究B に切り替わる。研究B はここで終わる
    await rows.filter({ hasText: '▲５八玉' }).click();
    await expect(page.getByTestId('study-title')).toHaveText('研究B');
    await expect(page).toHaveURL(/#\/book\/[^/]+\/s-b\/19$/);
    await expect(page.getByTestId('study-book-head')).toHaveText('この局面からの研究（1 本）');
    await expect(page.getByTestId('study-book-ending')).toContainText('研究B');
    await expect(page.getByTestId('study-book-ending')).toHaveAttribute('data-current', 'true');

    // 定跡帳の盤で指すと研究B が延びる（段階10-1。研究B・20 手目）
    await play(page, '51', '52');
    await expect(page).toHaveURL(/#\/book\/[^/]+\/s-b\/20$/);
    await expect(page.getByTestId('study-title')).toHaveText('研究B');
    await expect(page.getByTestId('study-position')).toContainText('20手目');

    // 出発点へ戻る：今いちばん最近直したのは研究B。研究C へ切り替えて、その終わり
    await page.getByTestId('book-start-crumb').click();
    await expect(page.getByTestId('study-position')).toContainText('17手目');
    await rows.filter({ hasText: '研究C' }).click();
    await expect(page.getByTestId('study-title')).toHaveText('研究C');
    await expect(page.getByTestId('study-meta')).toContainText('Cのメモ');

    // まとめて復習
    await page.getByTestId('book-review').click();
    await expect(page).toHaveURL(/#\/study-review\/group\//);
    await expect(page.getByTestId('review-summary')).toContainText('研究手順 3 本');
  });

  test('定跡帳の KIF：研究手順の多い手が本譜、分かれ目は変化', async ({ page }) => {
    await openHome(page);
    await importStudies(page, BOOK);
    await page.goto(`./#/book/${encodeURIComponent('study:横歩取り|black')}`);
    await page.getByTestId('book-menu').click();
    const download = page.waitForEvent('download');
    await page.getByTestId('book-share-kif').click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^定跡帳-横歩取り（先手番）\.kifu$/);
    const text = await (await import('node:fs/promises')).readFile((await file.path())!, 'utf-8');
    expect(text).toContain('変化：18手');
    expect(text).toContain('変化：19手');
    // 本譜は △8四飛 → ▲2六飛（研究A）
    expect(text.indexOf('★研究A')).toBeGreaterThan(0);
    expect(text.indexOf('★研究A')).toBeLessThan(text.indexOf('★研究B'));
    expect(text.indexOf('★研究A')).toBeLessThan(text.indexOf('★研究C'));
  });
});
