// 段階5：戦型（一覧から選ぶ・自分で登録する・直す・消す・書き出して配る）。登録は定跡帳の ⋯ から
import { expect, test, type Page } from '@playwright/test';
import type { Readable } from 'node:stream';

/**
 * 開いている窓を × で閉じる（窓が本当に開くまで待ってから押し、閉じたのを確かめる）。
 * Esc だと、遅い端末（GitHub の実行環境）で窓が開く前に押してしまい、後から開いた窓が次の操作をふさぐことがあった
 */
async function closeDialog(page: Page) {
  await page.locator('dialog[open]').last().getByRole('button', { name: '閉じる' }).click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
}

async function openHome(page: Page) {
  await page.goto('./');
  await expect(page.getByTestId('isolation')).toHaveAttribute('data-state', 'isolated', { timeout: 30_000 });
}

/** 定跡帳のタブの「＋ 研究手順を登録」→「戦型から選ぶ」 */
async function openPicker(page: Page) {
  await page.goto('./#/');
  await page.getByTestId('study-register').click();
  await page.getByTestId('study-register-template').click();
  await expect(page.getByTestId('template-picker')).toBeVisible();
}

/** 戦型を選んで、その出発点の定跡帳を開く */
async function openFromTemplate(page: Page, name: string, side: 'black' | 'white' = 'black') {
  await openPicker(page);
  await page.getByTestId('template-group').filter({ hasText: '横歩取り' }).click();
  await page.getByTestId('template-item').filter({ hasText: name }).click();
  await page.getByTestId(`new-study-side-${side}`).click();
  await page.getByTestId('new-study-open').click();
  await expect(page.getByTestId('study-board')).toBeVisible();
}

async function play(page: Page, from: string, to: string) {
  await page.locator(`[data-square="${from}"]`).click();
  await page.locator(`[data-square="${to}"]`).click();
}

/** 定跡帳の ⋯「この局面を戦型として登録」の窓を開く */
async function openRegister(page: Page) {
  await page.getByTestId('book-menu').click();
  await page.getByTestId('book-register-template').click();
  await expect(page.getByTestId('template-register')).toBeVisible();
}

/** 今の局面を戦型として登録する */
async function register(page: Page, fields: { name?: string; group?: string; note?: string }) {
  await openRegister(page);
  if (fields.name !== undefined) await page.getByTestId('template-name').fill(fields.name);
  if (fields.group !== undefined) await page.getByTestId('template-group-input').fill(fields.group);
  if (fields.note !== undefined) await page.getByTestId('template-note-input').fill(fields.note);
  await page.getByTestId('template-save').click();
  await expect(page.getByTestId('template-register')).toHaveCount(0);
}

async function streamText(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

test.describe('戦型', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('定跡帳から登録 → 一覧に「自分で登録」で並ぶ → 直す → 消す（確認あり）', async ({ page }) => {
    await openHome(page);
    await openFromTemplate(page, '△3三角型');
    // 盤で △8四飛 と進めてから登録
    await play(page, '86', '84');
    await expect(page.getByTestId('study-position')).toContainText('18手目');
    await openRegister(page);
    // 名前が空なら保存しない
    await page.getByTestId('template-name').fill(' ');
    await page.getByTestId('template-save').click();
    await expect(page.getByTestId('template-error')).toContainText('名前');
    await page.getByTestId('template-name').fill('マイ8四飛');
    await page.getByTestId('template-group-input').fill('横歩取り');
    await page.getByTestId('template-note-input').fill('自分の研究用');
    await page.getByTestId('template-save').click();
    await expect(page.getByTestId('template-register')).toHaveCount(0);

    // 「戦型から選ぶ」に、同梱のものと並ぶ（自分で登録の印）
    await openPicker(page);
    await expect(page.getByTestId('template-group')).toHaveText(/横歩取り\s*8/);
    await page.getByTestId('template-group').click();
    await expect(page.getByTestId('template-item')).toHaveCount(8);
    await expect(page.getByTestId('template-mine')).toHaveCount(1);
    await expect(page.getByTestId('template-item').last()).toContainText('マイ8四飛');
    await expect(page.getByTestId('template-menu')).toHaveCount(1);

    // 直す：名前とグループを変える → 新しいグループができる
    await page.getByTestId('template-menu').click();
    await page.getByTestId('template-name').fill('8四飛の研究');
    await page.getByTestId('template-group-input').fill('自分の研究');
    await page.getByTestId('template-save').click();
    await expect(page.getByTestId('template-message')).toContainText('「8四飛の研究」を保存しました');
    // 直した戦型の新しいグループの一覧に移る
    await expect(page.getByTestId('template-picker').getByRole('heading')).toHaveText('自分の研究');
    await expect(page.getByTestId('template-item')).toHaveText([/8四飛の研究/]);
    await page.getByTestId('template-back').click();
    await expect(page.getByTestId('template-group')).toHaveCount(2);

    // 再読み込みしても残っている（端末に保存）
    await page.reload();
    await openPicker(page);
    await page.getByTestId('template-group').filter({ hasText: '自分の研究' }).click();
    // 消す：確認を出し、「やめる」なら消えない
    await page.getByTestId('template-menu').click();
    await page.getByTestId('template-delete').click();
    await expect(page.getByTestId('template-picker')).toContainText('元に戻せません');
    await page.getByTestId('template-delete-cancel').click();
    await page.getByTestId('template-delete').click();
    await page.getByTestId('template-delete-ok').click();
    await expect(page.getByTestId('template-message')).toContainText('「8四飛の研究」を消しました');
    await expect(page.getByTestId('template-group')).toHaveCount(1);
  });

  test('書き出し → 取り込み：同じものは取り込まず、id が重なれば確認。指せない手のファイルは読まない', async ({ page }) => {
    await openHome(page);
    // 何も登録していなければ書き出せない
    await openPicker(page);
    await expect(page.getByTestId('template-export')).toBeDisabled();
    await closeDialog(page);
    // 平手から ▲７六歩 △３四歩 を定跡帳で指して登録（新しいグループ。後手番の定跡帳なので自分は後手）
    await page.goto(`./#/book/${encodeURIComponent('study:hirate|white')}`);
    await play(page, '77', '76');
    await play(page, '33', '34');
    await register(page, { name: '角道を開ける', group: '自分の研究', note: 'メモ' });

    await openPicker(page);
    const download = page.waitForEvent('download');
    await page.getByTestId('template-export').click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^戦型-\d{8}\.json$/);
    const data = JSON.parse(await streamText(await file.createReadStream()));
    expect(data).toMatchObject({ app: 'joban-tree', kind: 'opening-templates', version: 1 });
    expect(data.templates).toHaveLength(1);
    expect(data.templates[0]).toMatchObject({ name: '角道を開ける', group: '自分の研究', mySide: 'white', moves: ['7g7f', '3c3d'], note: 'メモ', reviewed: true });

    const input = page.getByTestId('template-import-file');
    const put = (json: unknown) => input.setInputFiles({ name: 't.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(json)) });
    // 同じファイルをもう一度：同じものなので取り込まない
    await put(data);
    await expect(page.getByTestId('template-message')).toContainText('0 件の戦型を取り込みました。1 件は同じものがある');

    // 名前を変えたもの（同じ id）と新しいもの：確認 → 両方残す
    const t0 = data.templates[0];
    await put({ ...data, templates: [{ ...t0, name: '角道（直した）' }, { ...t0, id: 'friend-1', name: '友達の戦型', reviewed: false }] });
    await expect(page.getByTestId('template-conflict')).toContainText('角道（直した）');
    await page.getByTestId('import-both').click();
    await expect(page.getByTestId('template-message')).toContainText('2 件の戦型を取り込みました');
    await page.getByTestId('template-group').filter({ hasText: '自分の研究' }).click();
    await expect(page.getByTestId('template-item')).toHaveCount(3);
    // 取り込んだ戦型も「自分で登録」。reviewed: false なら「未確認」
    await expect(page.getByTestId('template-mine')).toHaveCount(3);
    await expect(page.getByTestId('template-item').filter({ hasText: '友達の戦型' }).getByTestId('template-unreviewed')).toBeVisible();
    await page.getByTestId('template-back').click();

    // 置き換える
    await put({ ...data, templates: [{ ...t0, note: '置き換えた' }] });
    await page.getByTestId('import-replace').click();
    await expect(page.getByTestId('template-message')).toContainText('1 件の戦型を取り込みました');
    await page.getByTestId('template-group').filter({ hasText: '自分の研究' }).click();
    await expect(page.getByTestId('template-item').filter({ hasText: '置き換えた' })).toHaveCount(1);
    await expect(page.getByTestId('template-item')).toHaveCount(3);
    await page.getByTestId('template-back').click();

    // 指せない手を含むファイルは読まない（どの戦型の何手目かを示す）
    await put({ ...data, templates: [{ ...t0, id: 'bad', name: '壊れた', moves: ['7g7f', '7g7f'] }] });
    await expect(page.getByTestId('template-message')).toContainText('「壊れた」の 2 手目（7g7f）が指せない手');
    // 同梱の戦型と同じ id：置き換えの選択肢は出ない
    await put({ ...data, templates: [{ ...t0, id: 'yokofu-kihon', name: '同梱と同じ id' }] });
    await expect(page.getByTestId('template-conflict')).toContainText('アプリの戦型は置き換えません');
    await expect(page.getByTestId('import-replace')).toHaveCount(0);
    await page.getByTestId('import-skip').click();
    await expect(page.getByTestId('template-message')).toContainText('1 件は id が重なるので取り込みませんでした');
  });

  test('同梱の戦型と同じ局面は登録できない。自分で登録したものと同じなら ⋯ から直すよう案内', async ({ page }) => {
    await openHome(page);
    await openFromTemplate(page, '青野流（▲5八玉');
    await openRegister(page);
    await expect(page.getByTestId('template-same')).toHaveText(
      'この局面は「横歩取り 青野流（▲5八玉まで）」として、すでにあります（アプリに入っている戦型）。同じ局面は登録できません。',
    );
    await expect(page.getByTestId('template-save')).toBeDisabled();
    await closeDialog(page);

    // 1 手進めれば登録できる → 同じ局面でもう一度登録しようとすると、自分で登録した戦型として案内
    await play(page, '86', '84');
    await register(page, { name: '青野流に△8四飛' });
    // 登録の後の確認の窓が出たら閉じる
    if (await page.locator('dialog[open]').count()) await closeDialog(page);
    await openRegister(page);
    await expect(page.getByTestId('template-same')).toContainText('この局面は「青野流に△8四飛」として、すでにあります（自分で登録した戦型）');
    await expect(page.getByTestId('template-same')).toContainText('一覧の ⋯ から');
    await expect(page.getByTestId('template-save')).toBeDisabled();
  });

  test('登録画面のグループの候補は枠線だけのチップ（「登録する」と見た目を分ける）', async ({ page }) => {
    await openHome(page);
    await openFromTemplate(page, '青野流（▲5八玉');
    await play(page, '86', '84');
    await openRegister(page);
    const chip = page.getByTestId('group-choice').filter({ hasText: '横歩取り' });
    await expect(chip).toHaveAttribute('aria-pressed', 'true');
    await expect(chip).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(page.getByTestId('template-save')).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await page.getByTestId('template-group-input').fill('別のグループ');
    await expect(chip).toHaveAttribute('aria-pressed', 'false');
    await chip.click();
    await expect(page.getByTestId('template-group-input')).toHaveValue('横歩取り');
  });

  test('戦型の一覧では、名前の頭のグループ名を省く', async ({ page }) => {
    await openHome(page);
    await openPicker(page);
    await expect(page.getByTestId('template-group')).toHaveText(/横歩取り\s*7/);
    await page.getByTestId('template-group').click();
    // 確認済みなので「未確認」は出ない
    await expect(page.getByTestId('template-unreviewed')).toHaveCount(0);
    await expect(page.getByTestId('template-item').locator('.template-item-name')).toHaveText([
      '基本図（▲3四飛まで）',
      '△3三角（後手番）',
      '△3三角型（▲3六飛まで）',
      '△8四飛型・中住まい',
      '青野流（▲5八玉まで）',
      '△4五角戦法',
      '相横歩取り（△7六飛まで）',
    ]);
  });
});
