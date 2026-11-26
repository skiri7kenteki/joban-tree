// 段階25-1：横歩取り以外の変化付き KIF を取り込んで戦型を作る・定跡帳の ⋯ から戦型を登録する
import { expect, test, type Page } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

const line = (n: number, m: string) => `${String(n).padStart(4)} ${m}`;
const HEAD = ['手合割：平手', '手数----指手---------消費時間--'];
/** 角換わり。13 手目と 15 手目で分かれる 3 本 */
const KIF = [
  ...HEAD,
  ...[
    '７六歩(77)', '８四歩(83)', '２六歩(27)', '８五歩(84)', '７七角(88)', '３四歩(33)', '８八銀(79)', '３二金(41)', '７八金(69)',
    '７七角成(22)', '同　銀(88)', '４二銀(31)', '４八銀(39)', '７二銀(71)', '４六歩(47)', '６四歩(63)', '４七銀(48)',
  ].map((m, i) => line(i + 1, m)),
  '',
  '変化：15手',
  line(15, '３六歩(37)'),
  line(16, '６四歩(63)'),
  line(17, '３七銀(48)'),
  '',
  '変化：13手',
  line(13, '３八銀(39)'),
  line(14, '７二銀(71)'),
  line(15, '２七銀(38)'),
].join('\n');

async function readKif(page: Page) {
  await page.goto('./');
  await expect(page.getByTestId('isolation')).toHaveAttribute('data-state', 'isolated', { timeout: 30_000 });
  await page.goto('./#/study-import');
  await page.getByTestId('kif-bulk-input').fill(KIF);
  await page.getByTestId('kif-bulk-read').click();
  await expect(page.getByTestId('kif-bulk-row')).toHaveCount(3);
}

test('取り込みで新しい戦型を作ると、定跡帳のタブに新しいグループの行ができる', async ({ page }) => {
  await readKif(page);
  await expect(page.getByTestId('kif-bulk-template-name')).toHaveText('その他');
  await expect(page.getByTestId('kif-bulk-template-into')).toHaveText('「その他（先手番）」に入ります');

  await page.getByTestId('kif-bulk-template').click();
  // 横歩取りの戦型は手順が合わないので選べない
  await expect(page.getByTestId('import-pick-item').first()).toBeDisabled();
  await page.getByTestId('import-pick-new').click();
  // 出発点の初期値は、全部が通る最後の局面
  await expect(page.getByTestId('import-create-ply')).toContainText('12手目');
  await expect(page.getByTestId('import-create-next')).toBeDisabled();
  await expect(page.getByTestId('import-create-name')).toHaveValue(/^12手目 .+まで$/);
  // ‹ で戻すと名前も変わる
  await page.getByTestId('import-create-prev').click();
  await expect(page.getByTestId('import-create-name')).toHaveValue(/^11手目 /);
  await page.getByTestId('import-create-next').click();
  await page.getByTestId('import-create-group').fill('角換わり');
  await page.getByTestId('import-create-ok').click();
  await expect(page.getByTestId('kif-bulk-template-into')).toHaveText('「角換わり（先手番）」に入ります');
  await expect(page.getByTestId('kif-bulk-template-name')).toContainText('新しい戦型');

  await page.getByTestId('kif-bulk-import').click();
  await expect(page.getByTestId('home-message')).toContainText('研究手順 3 本を KIF から取り込みました');
  await expect(page.getByTestId('book-group')).toHaveCount(1);
  await expect(page.getByTestId('book-group')).toContainText('角換わり（先手番）');
  // 開き直しても同じグループ（戦型は端末に保存されている）
  await page.reload();
  await expect(page.getByTestId('book-group')).toContainText('角換わり（先手番）');
});

test('取り込まずに画面を離れたら、戦型は登録しない', async ({ page }) => {
  await readKif(page);
  await page.getByTestId('kif-bulk-template').click();
  await page.getByTestId('import-pick-new').click();
  await page.getByTestId('import-create-group').fill('角換わり');
  await page.getByTestId('import-create-ok').click();
  await page.goto('./#/');
  await page.goto('./#/study-import');
  await page.getByTestId('kif-bulk-input').fill(KIF);
  await page.getByTestId('kif-bulk-read').click();
  await page.getByTestId('kif-bulk-template').click();
  // 同梱の 7 つだけ
  await expect(page.getByTestId('import-pick-item')).toHaveCount(7);
});

test('定跡帳の ⋯ から戦型を登録すると、「その他」の研究手順が移り、移るか聞く', async ({ page }) => {
  await readKif(page);
  await page.getByTestId('kif-bulk-import').click();
  await expect(page.getByTestId('book-group')).toContainText('その他（先手番）');
  await page.getByTestId('book-group-open').click();
  await page.getByTestId('book-menu').click();
  // 平手の初期局面では登録できない
  await expect(page.getByTestId('book-register-template')).toBeDisabled();
  await page.keyboard.press('Escape');
  for (let i = 0; i < 12; i++) await page.getByRole('button', { name: '1手進む' }).click();
  await page.getByTestId('book-menu').click();
  await page.getByTestId('book-register-template').click();
  await page.getByTestId('template-group-input').fill('角換わり');
  await expect(page.getByTestId('book-register-moved')).toContainText('3 本');
  await page.getByTestId('template-save').click();
  await expect(page.getByTestId('book-registered-dialog')).toContainText('研究手順 3 本が「角換わり（先手番）」に移りました');
  await page.getByTestId('book-registered-go').click();
  await expect(page.getByRole('heading', { name: '角換わり（先手番）' })).toBeVisible();
  await page.goto('./#/');
  await expect(page.getByTestId('book-group')).toHaveCount(1);
  await expect(page.getByTestId('book-group')).toContainText('角換わり（先手番）');
});
