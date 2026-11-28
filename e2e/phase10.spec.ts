// 段階10-1：定跡帳で直接指して研究を足す（新しい研究・枝を足す・取り消し・消す・読むだけ）
import { expect, test, type Page } from '@playwright/test';
import type { Study } from '../src/tree/types';
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

/** 研究手順の JSON を取り込む（トップ画面の研究手順のタブから） */
async function importStudies(page: Page, studies: Study[]) {
  await page.getByTestId('tab-studies').click();
  await expect(page.getByTestId('study-register')).toBeVisible();
  await page.getByTestId('study-import-file').setInputFiles({
    name: 'studies.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ app: 'joban-tree', kind: 'studies', version: 1, studies })),
  });
  await expect(page.getByTestId('study-count')).toHaveText(`研究手順 ${studies.length} 本`);
}

async function play(page: Page, from: string, to: string) {
  await page.locator(`[data-square="${from}"]`).click();
  await page.locator(`[data-square="${to}"]`).click();
}

/** 一覧へ戻って、研究手順のタブを開く */
async function backHome(page: Page) {
  await page.getByRole('button', { name: '‹ 一覧' }).click();
  await page.getByTestId('tab-studies').click();
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

/** 横歩取り △3三角型（▲3六飛まで）：17 手 */
const KAKU33 = '7g7f 3c3d 2g2f 8c8d 2f2e 8d8e 6i7h 4a3b 2e2d 2c2d 2h2d 8e8f 8g8f 8b8f 2d3d 2b3c 3d3f'.split(' ');
/** 研究A：△8四飛 ▲2六飛（19 手） */
const A = study('s-a', '研究A', [...KAKU33, '8f8d', '3f2f'], { updatedAt: 3, note: 'Aのメモ' });
/** 研究B：△8四飛 ▲5八玉 */
const B = study('s-b', '研究B', [...KAKU33, '8f8d', '5i5h'], { updatedAt: 2 });
/** 研究C：△5二玉 */
const C = study('s-c', '研究C', [...KAKU33, '5a5b'], { updatedAt: 1 });

test.describe('10-1 定跡帳で直接指して研究を足す', () => {
  test('新しい研究：＋ 研究手順を登録 → 戦型と側を選ぶ → 定跡帳で何手か指す → 一覧に 1 本できている', async ({ page }) => {
    await openHome(page);
    await page.getByTestId('tab-studies').click();
    await page.getByTestId('study-register').click();
    await page.getByTestId('study-register-template').click();
    await page.getByTestId('template-group').filter({ hasText: '横歩取り' }).click();
    await page.getByTestId('template-item').filter({ hasText: '△3三角型' }).click();
    // 自分の側の初期値は戦型の側（この戦型は先手）
    await expect(page.getByTestId('new-study-from')).toContainText('△3三角型');
    await expect(page.getByTestId('new-study-side-black')).toHaveAttribute('aria-checked', 'true');
    await page.getByTestId('new-study-open').click();

    // 空の定跡帳：出発点（17 手目）が開き、そのまま指せる
    await expect(page.getByTestId('book-title')).toHaveText('定跡帳横歩取り（先手番）');
    await expect(page.getByTestId('study-position')).toContainText('17手目');
    await expect(page.getByTestId('book-head-empty')).toContainText('研究手順はまだありません');
    await expect(page.getByTestId('study-book-empty')).toBeVisible();

    await play(page, '86', '84'); // △8四飛
    await expect(page.getByTestId('book-toast')).toContainText('△８四飛 を足しました');
    // 名前は、先手番の戦型のうちいちばん浅い基本図（15 手）の後から（段階10 の直し）
    await expect(page.getByTestId('study-title')).toHaveText('△３三角 ▲３六飛 △８四飛');
    await play(page, '36', '26'); // ▲2六飛
    await expect(page.getByTestId('study-title')).toHaveText('△３三角 ▲３六飛 △８四飛 ▲２六飛');
    await expect(page.getByTestId('study-position')).toContainText('19手目');
    await expect(page).toHaveURL(/#\/book\/[^/]+\/s-[\w-]+\/19$/);

    await backHome(page);
    await expect(page.getByTestId('study-count')).toHaveText(`研究手順 ${1} 本`);
    await expect(page.getByTestId('book-group')).toHaveText([/横歩取り（先手番）\s*研究 1本/]);
    const list = await openStudyList(page);
    await expect(list.getByTestId('study-item')).toContainText('△３三角 ▲３六飛 △８四飛 ▲２六飛');
    await expect(list.getByTestId('study-item')).toContainText('19 手');
  });

  test('新しい研究（平手から）：初期値は先手。初手を指すと 1 本目ができ、「その他（先手番）」に入る', async ({ page }) => {
    await openHome(page);
    await page.getByTestId('tab-studies').click();
    await page.getByTestId('study-register').click();
    await page.getByTestId('study-register-hirate').click();
    await expect(page.getByTestId('new-study-side-black')).toHaveAttribute('aria-checked', 'true');
    await page.getByTestId('new-study-open').click();
    await expect(page.getByTestId('book-title')).toHaveText('定跡帳平手から（先手番）');
    await expect(page.getByTestId('study-position')).toHaveText('初期局面');
    await play(page, '27', '26'); // ▲2六歩
    await expect(page.getByTestId('study-title')).toHaveText('▲２六歩');
    await backHome(page);
    await expect(page.getByTestId('book-group')).toHaveText([/その他（先手番）\s*研究 1本/]);
    // 一覧の研究手順を押すと、その終わりの局面で定跡帳（平手から）が開く
    await (await openStudyList(page)).getByTestId('study-item').click();
    await expect(page.getByTestId('book-title')).toHaveText('定跡帳平手から（先手番）');
    await expect(page.getByTestId('study-position')).toContainText('1手目 ▲２六歩');
  });

  test('枝を足す：既存の研究の定跡帳 → 途中の局面へ戻る → 別の手を指す → 研究手順が 2 本、「この局面からの研究」に 2 行', async ({ page }) => {
    await openHome(page);
    await importStudies(page, [A]);
    // 一覧から押すと、その研究手順の終わりの局面で定跡帳が開く
    await (await openStudyList(page)).getByTestId('study-item').click();
    await expect(page.getByTestId('book-title')).toHaveText('定跡帳横歩取り（先手番）');
    await expect(page.getByTestId('study-title')).toHaveText('研究A');
    await expect(page.getByTestId('study-position')).toContainText('19手目');
    await page.getByTestId('study-prev').click();
    await page.getByTestId('study-prev').click();
    await expect(page.getByTestId('study-position')).toContainText('17手目');
    // 同じ手（△8四飛）は進むだけ
    await play(page, '86', '84');
    await expect(page.getByTestId('study-position')).toContainText('18手目');
    await expect(page.getByTestId('book-toast')).toHaveCount(0);
    await page.getByTestId('study-prev').click();
    // 別の手（△5二玉）→ 新しい研究手順
    await play(page, '51', '52');
    await expect(page.getByTestId('book-toast')).toContainText('△５二玉 を足しました');
    await expect(page.getByTestId('study-title')).toHaveText('△３三角 ▲３六飛 △５二玉');
    await page.getByTestId('study-prev').click();
    await expect(page.getByTestId('study-book-head')).toHaveText('研究 2本');
    await expect(page.getByTestId('study-book-branch')).toHaveCount(2);
    await backHome(page);
    await expect(page.getByTestId('study-count')).toHaveText(`研究手順 ${2} 本`);
  });

  test('取り消し：手を足す → 取り消す → 元に戻る。続けて足したものを続けて取り消せる。読むだけにすると足さない', async ({ page }) => {
    await openHome(page);
    await importStudies(page, [A]);
    await (await openStudyList(page)).getByTestId('study-item').click();
    await expect(page.getByTestId('study-position')).toContainText('19手目');
    // 終わりの局面で指す → 研究A が延びる（名前は自分で付けたものなので変えない）
    await play(page, '31', '22'); // △2二銀
    await expect(page.getByTestId('study-position')).toContainText('20手目');
    await expect(page.getByTestId('study-title')).toHaveText('研究A');
    await page.getByTestId('book-toast-undo').click();
    await expect(page.getByTestId('study-position')).toContainText('19手目');
    await expect(page.getByTestId('study-last')).toBeDisabled();
    await expect(page.getByTestId('book-toast')).toContainText('取り消しました');
    await expectUndoDisabled(page);

    // 2 手足して、⋯ の「↶ 取り消す」で 2 回（段階14：盤の下から ⋯ へ）
    await play(page, '31', '22');
    await expect(page.getByTestId('study-position')).toContainText('20手目');
    await play(page, '59', '58'); // ▲5八玉
    await expect(page.getByTestId('study-position')).toContainText('21手目');
    await undoFromMenu(page);
    await expect(page.getByTestId('study-position')).toContainText('20手目');
    await undoFromMenu(page);
    await expect(page.getByTestId('study-position')).toContainText('19手目');
    await expectUndoDisabled(page);

    // 読むだけ：指しても足さない
    await page.getByTestId('book-menu').click();
    await page.getByTestId('book-write-off').click();
    await closeDialog(page);
    await expect(page.getByTestId('book-kicker')).toHaveText('定跡帳・読むだけ');
    await play(page, '31', '22');
    await expect(page.getByTestId('study-position')).toContainText('19手目');
    await expect(page.getByTestId('study-screen-status')).toContainText('読むだけ');
    await backHome(page);
    await expect((await openStudyList(page)).getByTestId('study-item')).toContainText('19 手');
  });

  test('消す：この手から先を消す → その枝の研究手順が消え、手前の研究は残る。取り消しで戻る', async ({ page }) => {
    await openHome(page);
    await importStudies(page, [A, B, C]);
    await (await openStudyList(page)).getByTestId('study-item').filter({ hasText: '研究A' }).click();
    await page.getByTestId('study-prev').click();
    await expect(page.getByTestId('study-position')).toContainText('18手目');
    const rows = page.getByTestId('study-book-branch');
    await expect(rows).toHaveCount(2);

    // ▲5八玉（研究B）から先を消す：研究A がこの局面を通るので、研究B を消すだけ
    await page.getByTestId('book-branch-menu').nth(1).click();
    await expect(page.getByTestId('book-cut-text')).toHaveText('研究手順 1 本を消します。');
    await page.getByTestId('book-cut-ok').click();
    await expect(rows).toHaveCount(1);
    await expect(page.getByTestId('book-toast')).toContainText('▲５八玉 から先を消しました（1 本）');

    // ▲2六飛（研究A）から先を消す：この局面を通る研究手順が無くなるので、研究A をこの局面で終わる形にして残す
    await page.getByTestId('book-branch-menu').click();
    await expect(page.getByTestId('book-cut-text')).toContainText('「研究A」は、この局面で終わる研究手順として残します');
    await page.getByTestId('book-cut-ok').click();
    await expect(rows).toHaveCount(0);
    await expect(page.getByTestId('study-book-ending')).toContainText('研究A');
    await expect(page.getByTestId('study-title')).toHaveText('研究A');

    // 取り消すと、研究A の ▲2六飛 が戻る
    await undoFromMenu(page);
    await expect(rows).toHaveCount(1);
    await expect(rows).toContainText('研究A');

    await backHome(page);
    await expect(page.getByTestId('study-count')).toHaveText(`研究手順 ${2} 本`);
    await expect((await openStudyList(page)).getByTestId('study-item').filter({ hasText: '研究A' })).toContainText('19 手');
  });

  test('ここで終わりにする・この研究手順を消す・名前を直す（⋯ と ★ の行から）', async ({ page }) => {
    await openHome(page);
    await importStudies(page, [A, B]);
    await (await openStudyList(page)).getByTestId('study-item').filter({ hasText: '研究A' }).click();
    // ★ の行を押すと名前を直す窓（自分の側は出さない）
    await page.getByTestId('book-head').click();
    await expect(page.getByTestId('study-side-black')).toHaveCount(0);
    await page.getByTestId('study-name').fill('本線');
    await page.getByTestId('study-save').click();
    await expect(page.getByTestId('study-title')).toHaveText('本線');

    // 17 手目でここで終わりにする：出発点なので使えない
    await page.getByTestId('study-first').click();
    await page.getByTestId('book-menu').click();
    await expect(page.getByTestId('book-end-here')).toBeDisabled();
    await closeDialog(page);
    // 18 手目：研究A・研究B を消して、本線（今の研究手順）を 18 手目で終わる形に
    await page.getByTestId('study-next').click();
    await page.getByTestId('book-menu').click();
    await page.getByTestId('book-end-here').click();
    await expect(page.getByTestId('book-cut-text')).toContainText('研究手順 2 本を消します。「本線」は、この局面で終わる研究手順として残します');
    await page.getByTestId('book-end-ok').click();
    await expect(page.getByTestId('study-book-ending')).toContainText('本線');
    await expect(page.getByTestId('study-last')).toBeDisabled();

    // この研究手順を消す → 定跡帳は空（木の外）。取り消すと戻る
    await page.getByTestId('book-menu').click();
    await page.getByTestId('book-delete-study').click();
    await page.getByTestId('book-delete-ok').click();
    await expect(page.getByTestId('book-head-empty')).toBeVisible();
    await undoFromMenu(page);
    await expect(page.getByTestId('study-title')).toHaveText('本線');
  });
});

test.describe('定跡帳の出発点がずれる不具合の直し', () => {
  /** 戦型から選んで定跡帳を開く */
  async function openFromTemplate(page: Page, name: string, side: 'black' | 'white') {
    await page.getByTestId('tab-studies').click();
    await page.getByTestId('study-register').click();
    await page.getByTestId('study-register-template').click();
    await page.getByTestId('template-group').filter({ hasText: '横歩取り' }).click();
    await page.getByTestId('template-item').filter({ hasText: name }).click();
    await page.getByTestId(`new-study-side-${side}`).click();
    await page.getByTestId('new-study-open').click();
  }

  test('「△3三角（後手番）」から ▲3六飛 を指しても出発点は 16 手目のまま。戻って ▲5八玉 を足すと 2 行', async ({ page }) => {
    await openHome(page);
    await openFromTemplate(page, '△3三角（後手番）', 'white');
    await expect(page.getByTestId('book-title')).toHaveText('定跡帳横歩取り（後手番）');
    await expect(page.getByTestId('study-position')).toContainText('16手目');
    await play(page, '34', '36'); // ▲3六飛
    await expect(page.getByTestId('study-title')).toHaveText('▲３六飛');
    await expect(page.getByTestId('study-first')).toHaveAttribute('aria-label', /△3三角（後手番）/);
    await expect(page.getByTestId('study-prev')).toBeEnabled();
    await page.getByTestId('study-prev').click();
    await expect(page.getByTestId('study-position')).toContainText('16手目');
    await play(page, '59', '58'); // ▲5八玉（青野流）
    await expect(page.getByTestId('study-title')).toHaveText('▲５八玉');
    await page.getByTestId('study-prev').click();
    const rows = page.getByTestId('study-book-branch');
    await expect(rows).toHaveCount(2);
    await expect(rows.filter({ hasText: '▲３六飛' })).toHaveCount(1);
    await expect(rows.filter({ hasText: '▲５八玉' })).toHaveCount(1);
    // 一覧から開き直しても、16 手目に戻れる
    await page.getByRole('button', { name: '‹ 一覧' }).click();
    await page.getByTestId('tab-studies').click();
    await (await openStudyList(page)).getByTestId('study-item').filter({ hasText: '▲３六飛' }).click();
    await expect(page.getByTestId('study-position')).toContainText('17手目');
    await page.getByTestId('study-prev').click();
    await expect(page.getByTestId('study-position')).toContainText('16手目');
    await expect(page.getByTestId('study-prev')).toBeDisabled();
  });

  test('先手番の基本図から △3三角 ▲3六飛 と指しても出発点は 15 手目のまま。戻って別の手を足せる', async ({ page }) => {
    await openHome(page);
    await openFromTemplate(page, '基本図', 'black');
    await expect(page.getByTestId('book-title')).toHaveText('定跡帳横歩取り（先手番）');
    await expect(page.getByTestId('study-position')).toContainText('15手目');
    await play(page, '22', '33'); // △3三角
    await play(page, '34', '36'); // ▲3六飛
    await expect(page.getByTestId('study-title')).toHaveText('△３三角 ▲３六飛');
    await expect(page.getByTestId('study-first')).toHaveAttribute('aria-label', /基本図/);
    await page.getByTestId('study-first').click();
    await expect(page.getByTestId('study-position')).toContainText('15手目');
    await play(page, '51', '52'); // △5二玉
    await expect(page.getByTestId('study-title')).toHaveText('△５二玉');
    await page.getByTestId('study-prev').click();
    await expect(page.getByTestId('study-book-branch')).toHaveCount(2);
  });
});

test('前の版でずれた研究手順（後手番に先手番の戦型・戦型の名前だけの名前）は直る。自分で付けた名前は変えない', async ({ page }) => {
  await openHome(page);
  await importStudies(page, [
    study('s-old', '横歩取り △3三角型（▲3六飛まで）', [...KAKU33], { mySide: 'white', templateId: 'yokofu-33kaku', updatedAt: 2 }),
    study('s-mine', '自分の名前', [...KAKU33, '8f8d'], { mySide: 'white', templateId: 'yokofu-33kaku', updatedAt: 1 }),
  ]);
  const list = await openStudyList(page);
  await expect(list.getByTestId('study-item').filter({ hasText: '▲３六飛' })).toHaveCount(1);
  await expect(list.getByTestId('study-item').filter({ hasText: '自分の名前' })).toHaveCount(1);
  await list.getByTestId('study-item').filter({ hasText: '▲３六飛' }).click();
  await expect(page.getByTestId('book-title')).toHaveText('定跡帳横歩取り（後手番）');
  await expect(page.getByTestId('study-first')).toHaveAttribute('aria-label', /△3三角（後手番）/);
  await page.getByTestId('study-prev').click();
  await expect(page.getByTestId('study-position')).toContainText('16手目');
});

/** ⋯ の「↶ 取り消す」（段階14：盤の下から ⋯ の中へ） */
async function undoFromMenu(page: Page) {
  await page.getByTestId('book-menu').click();
  await page.getByTestId('book-undo').click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
}

/** 取り消せるものが無いとき、⋯ の「↶ 取り消す」は押せない */
async function expectUndoDisabled(page: Page) {
  await page.getByTestId('book-menu').click();
  await expect(page.getByTestId('book-undo')).toBeDisabled();
  await page.locator('dialog[open]').last().getByRole('button', { name: '閉じる' }).click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
}
