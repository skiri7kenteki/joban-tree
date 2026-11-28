// 段階25：横歩取り以外の変化付き KIF を取り込んで戦型を作る・定跡帳の ⋯ から戦型を登録する・取り込みを取り消す・選んで消す
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

/** 本譜だけ（上の 3 本のうちの 1 本と同じ手順） */
const MAIN_ONLY = KIF.split('\n\n')[0].split('\n変化')[0];

async function importText(page: Page, text: string) {
  await page.goto('./#/study-import');
  await page.getByTestId('kif-bulk-input').fill(text);
  await page.getByTestId('kif-bulk-read').click();
  await expect(page.getByTestId('kif-bulk-summary')).toBeVisible();
}

const deletedRecords = (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem('joban-tree.deleted') ?? '[]') as { kind: string; onlyId?: boolean }[]);

test('取り込みの直後に取り消すと、その取り込みで足した分と作った戦型だけが消える', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByTestId('isolation')).toHaveAttribute('data-state', 'isolated', { timeout: 30_000 });
  await importText(page, MAIN_ONLY);
  await page.getByTestId('kif-bulk-import').click();
  await expect(page.getByTestId('study-count')).toHaveText('研究手順 1 本');

  // 同じ手順の 1 本は「すでにあり」で外れ、残りの 2 本を新しい戦型で取り込む
  await importText(page, KIF);
  await expect(page.getByTestId('kif-bulk-exists')).toHaveCount(1);
  await page.getByTestId('kif-bulk-template').click();
  await page.getByTestId('import-pick-new').click();
  await page.getByTestId('import-create-group').fill('角換わり');
  await page.getByTestId('import-create-ok').click();
  await page.getByTestId('kif-bulk-import').click();
  await expect(page.getByTestId('study-count')).toHaveText('研究手順 3 本');

  await page.getByTestId('import-undo').click();
  await expect(page.getByTestId('import-undo-dialog')).toContainText('取り込んだ 2 本を消します');
  await expect(page.getByTestId('import-undo-dialog')).toContainText('戦型「12手目');
  await page.getByTestId('import-undo-ok').click();
  await expect(page.getByTestId('study-count')).toHaveText('研究手順 1 本');
  await expect(page.getByTestId('home-message')).toContainText('取り込みを取り消しました');
  await expect(page.getByTestId('import-undo')).toHaveCount(0);
  // 戦型も消えたので「その他」に戻る
  await expect(page.getByTestId('book-group')).toHaveCount(1);
  await expect(page.getByTestId('book-group')).toContainText('その他（先手番）');
  const records = await deletedRecords(page);
  expect(records.filter((r) => r.kind === 'study').map((r) => r.onlyId)).toEqual([true, true]);
  expect(records.filter((r) => r.kind === 'template')).toHaveLength(1);
});

test('定跡帳の一覧を離れると、取り消すボタンは消える', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByTestId('isolation')).toHaveAttribute('data-state', 'isolated', { timeout: 30_000 });
  await importText(page, KIF);
  await page.getByTestId('kif-bulk-import').click();
  await expect(page.getByTestId('import-undo')).toBeVisible();
  await page.getByTestId('book-group-open').click();
  await expect(page.getByTestId('book-menu')).toBeVisible();
  await page.goto('./#/');
  await expect(page.getByTestId('study-count')).toHaveText('研究手順 3 本');
  await expect(page.getByTestId('import-undo')).toHaveCount(0);
});

test('研究手順の一覧で 3 本選んで消す', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByTestId('isolation')).toHaveAttribute('data-state', 'isolated', { timeout: 30_000 });
  // 4 本：角換わりの 3 本と、短い別の 1 本
  await importText(page, [...HEAD, line(1, '７六歩(77)'), line(2, '３四歩(33)'), line(3, '２六歩(27)')].join('\n'));
  await page.getByTestId('kif-bulk-side-black').click();
  await page.getByTestId('kif-bulk-import').click();
  await expect(page.getByTestId('study-count')).toHaveText('研究手順 1 本');
  await importText(page, KIF);
  await page.getByTestId('kif-bulk-import').click();
  await expect(page.getByTestId('study-count')).toHaveText('研究手順 4 本');

  await page.getByTestId('book-group-open').click();
  // 盤の取り消しの記録を先に 1 つ作る（名前を直す）
  await page.getByTestId('book-menu').click();
  await page.getByTestId('book-edit-fields').click();
  await page.getByTestId('study-name').fill('消す前に直した名前');
  await page.getByRole('button', { name: '保存' }).click();
  await page.getByTestId('book-menu').click();
  await expect(page.getByTestId('book-undo')).toBeEnabled();
  await page.getByTestId('book-study-list').click();
  await page.getByTestId('study-select').click();
  await expect(page.getByTestId('study-select-delete')).toBeDisabled();
  await page.getByTestId('study-select-all').click();
  await expect(page.getByTestId('study-select-delete')).toHaveText('4 本を消す');
  await page.getByTestId('study-select-none').click();
  for (let i = 0; i < 3; i++) await page.getByTestId('study-select-item').nth(i).click();
  await page.getByTestId('study-select-delete').click();
  await expect(page.getByTestId('study-bulk-dialog')).toContainText('研究手順 3 本を消しますか');
  await page.getByTestId('study-bulk-ok').click();
  await expect(page.getByTestId('study-list-message')).toHaveText('研究手順 3 本を消しました');
  await expect(page.getByTestId('study-item')).toHaveCount(1);
  expect((await deletedRecords(page)).filter((r) => r.kind === 'study' && !r.onlyId)).toHaveLength(3);

  // 盤の取り消しの記録は捨てているので、消した研究手順は戻らない
  await page.getByTestId('study-list-dialog').getByRole('button', { name: '閉じる' }).click();
  await page.getByTestId('book-menu').click();
  await expect(page.getByTestId('book-undo')).toBeDisabled();
  await page.goto('./#/');
  await expect(page.getByTestId('study-count')).toHaveText('研究手順 1 本');
});

test('本数が多くても「n 本を消す」は窓の下に出たまま。まとめて全部消せる', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByTestId('isolation')).toHaveAttribute('data-state', 'isolated', { timeout: 30_000 });
  // 初手と 2 手目の歩の突き方を変えた 40 本
  const studies = Array.from({ length: 40 }, (_, i) => {
    const first = (i % 9) + 1;
    const second = Math.floor(i / 9) + 1;
    return { id: `s-many-${i}`, name: `研究 ${i + 1}`, note: '', moves: [`${first}g${first}f`, `${second}c${second}d`], mySide: 'black', createdAt: i + 1, updatedAt: i + 1 };
  });
  await page.getByTestId('study-import-file').setInputFiles({
    name: 's.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ app: 'joban-tree', kind: 'studies', version: 1, studies })),
  });
  await expect(page.getByTestId('study-count')).toHaveText('研究手順 40 本');
  await page.getByTestId('book-group-open').click();
  await page.getByTestId('book-menu').click();
  await page.getByTestId('book-study-list').click();
  await page.getByTestId('study-select').click();
  await expect(page.getByTestId('study-select-delete')).toBeInViewport({ ratio: 1 });
  await page.getByTestId('study-select-all').click();
  await page.getByTestId('study-select-item').last().scrollIntoViewIfNeeded();
  await expect(page.getByTestId('study-select-delete')).toBeInViewport({ ratio: 1 });
  await page.getByTestId('study-select-delete').click();
  await page.getByTestId('study-bulk-ok').click();
  await expect(page.getByTestId('study-list-message')).toHaveText('研究手順 40 本を消しました');
  await expect(page.getByTestId('study-select-delete')).toHaveCount(0);
  await page.goto('./#/');
  await expect(page.getByTestId('study-count')).toHaveText('研究手順 0 本');
});
