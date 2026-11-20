// 画面の通し確認（段階2）：取り込み・名前の変更・削除・書き出し・設定・オフライン・盤の向き・気づきを送る
// エンジンを使わないものだけ（エンジンを使う流れは app.spec.ts）
import { expect, test, type Page } from '@playwright/test';
import { inTreeMenu, treeMenu } from './treeMenu';
import { STARTPOS_SFEN, applyUsiMove, sfenKey } from '../src/shogi/position';
import { TREE_APP, TREE_FORMAT_VERSION, type TreeData } from '../src/tree/types';

/** 平手 → ▲７六歩（相手の応手・本線）→ △３四歩（自分の対応・未検証）の小さなツリー */
function sampleTree(id = 'e2e-tree-1', name = 'テスト用ツリー'): TreeData {
  const after1 = applyUsiMove(STARTPOS_SFEN, '7g7f')!.sfen;
  const after2 = applyUsiMove(after1, '3c3d')!.sfen;
  const [k0, k1, k2] = [STARTPOS_SFEN, after1, after2].map(sfenKey);
  return {
    app: TREE_APP,
    version: TREE_FORMAT_VERSION,
    id,
    name,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    mySide: 'white',
    rootKey: k0,
    prefix: { initialSfen: STARTPOS_SFEN, moves: [] },
    nodes: {
      [k0]: { key: k0, sfen: STARTPOS_SFEN, round: 0, edges: [{ move: '7g7f', to: k1, score: { kind: 'cp', value: -40 }, diff: 0 }] },
      [k1]: { key: k1, sfen: after1, round: 0, edges: [{ move: '3c3d', to: k2, score: { kind: 'cp', value: -40 }, unverified: true }] },
      [k2]: { key: k2, sfen: after2, round: 1, edges: [] },
    },
    settings: { totalMs: 30_000, movetimeMs: 400, multiPV: 3, maxRounds: 3, maxNodes: 3000, windowCp: 300 },
  };
}

async function openHome(page: Page) {
  await page.goto('./#/trees');
  await expect(page.getByTestId('isolation')).toHaveAttribute('data-state', 'isolated', { timeout: 30_000 });
}

async function importJson(page: Page, tree: TreeData) {
  await page.getByTestId('import-file').setInputFiles({
    name: 'tree.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(tree)),
  });
}

test('JSON を取り込み、名前を変えて、削除できる（同じツリーは上書きか別に追加かを聞く）', async ({ page }) => {
  await openHome(page);
  await importJson(page, sampleTree());
  await expect(page.getByTestId('home-message')).toContainText('取り込みました');
  await expect(page.getByTestId('tree-item')).toHaveCount(1);
  await expect(page.getByTestId('tree-item').first()).toContainText('テスト用ツリー');

  // 同じものをもう一度 → 確認が出る → 別のツリーとして追加
  await importJson(page, sampleTree());
  await expect(page.getByTestId('import-conflict')).toBeVisible();
  await page.getByTestId('import-copy').click();
  await expect(page.getByTestId('tree-item')).toHaveCount(2);

  // もう一度 → 上書き（数は増えない）
  await importJson(page, sampleTree());
  await page.getByTestId('import-overwrite').click();
  await expect(page.getByTestId('home-message')).toContainText('取り込みました');
  await expect(page.getByTestId('tree-item')).toHaveCount(2);

  // ほかのファイルは読まない
  await page.getByTestId('import-file').setInputFiles({ name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{"a":1}') });
  await expect(page.getByTestId('home-message')).toContainText('序盤ツリーのファイルではありません');

  // 名前の変更
  const item = page.getByTestId('tree-item').filter({ has: page.locator('.tree-item-name', { hasText: /^テスト用ツリー$/ }) });
  await page.locator('.tree-row').filter({ has: item }).getByTestId('tree-menu').click();
  await page.getByTestId('rename-input').fill('角換わりの研究');
  await page.getByTestId('rename-save').click();
  await expect(page.getByTestId('tree-item').filter({ hasText: '角換わりの研究' })).toHaveCount(1);

  // 削除（確認あり）
  await page.locator('.tree-row').filter({ hasText: '角換わりの研究' }).getByTestId('tree-menu').click();
  await page.getByTestId('delete-tree').click();
  await page.getByTestId('delete-confirm').click();
  await expect(page.getByTestId('tree-item')).toHaveCount(1);
  await expect(page.getByTestId('tree-item').first()).toContainText('（取り込み）');

  // 再読み込みしても残っている
  await page.reload();
  await expect(page.getByTestId('tree-item')).toHaveCount(1);
});

test('ツリー画面：ラベル・未検証の印、KIF のコピー、JSON・KIF の書き出し', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openHome(page);
  await importJson(page, sampleTree());
  await page.getByTestId('tree-item').first().click();

  const candidate = page.getByTestId('candidate').first();
  await expect(candidate).toContainText('▲７六歩');
  await expect(candidate).toContainText('本線');
  await candidate.click();
  await expect(page.getByTestId('candidate').first()).toContainText('未検証');
  // 自分の手番で、まだ調べていない局面には「この手を検証」が出る（見出しの ⋯ の中。段階11-2）
  await inTreeMenu(page, async (menu) => {
    await expect(menu.getByTestId('verify-here')).toBeVisible();
  });

  // KIF をコピー（この局面まで）
  await treeMenu(page, 'copy-kif');
  await expect(page.getByTestId('tree-note')).toContainText('コピーしました');
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain('７六歩(77)');

  // 書き出し（この PC の Chromium には共有メニューが無いので、ダウンロードになる）
  await treeMenu(page, 'export-open');
  const jsonDownload = page.waitForEvent('download');
  await page.getByTestId('export-json').click();
  const json = await jsonDownload;
  expect(json.suggestedFilename()).toBe('テスト用ツリー.json');
  const saved = JSON.parse(await streamText(await json.createReadStream()));
  expect(saved.app).toBe('joban-tree');
  expect(Object.keys(saved.nodes)).toHaveLength(3);

  await treeMenu(page, 'export-open');
  const kifDownload = page.waitForEvent('download');
  await page.getByTestId('export-tree-kif').click();
  const kif = await kifDownload;
  expect(kif.suggestedFilename()).toBe('テスト用ツリー.kifu');
  const kifText = await streamText(await kif.createReadStream());
  expect(kifText).toContain('手合割：平手');
  expect(kifText).toContain('３四歩(33)');
});

test('盤は常に先手が手前（自分が後手でも、9 一が左上・1 九が右下）', async ({ page }) => {
  await openHome(page);
  await page.getByTestId('new-tree').click();
  await page.getByTestId('side-white').click();
  const box = async (sq: string) => (await page.locator(`[data-square="${sq}"]`).boundingBox())!;
  const [nineOne, oneOne, oneNine] = [await box('91'), await box('11'), await box('19')];
  expect(nineOne.x).toBeLessThan(oneOne.x);
  expect(oneNine.y).toBeGreaterThan(oneOne.y);
});

test('設定：変えた値が保存され、プリセットのボタンに反映される。初期値に戻せる', async ({ page }) => {
  await openHome(page);
  await page.getByTestId('tab-settings').click();
  await expect(page.getByRole('heading', { name: '設定' })).toBeVisible();
  await page.getByTestId('normal-total').fill('90');
  await page.getByTestId('normal-total').blur();
  await page.getByTestId('window').fill('-10');
  await page.getByTestId('window').blur();
  // 範囲外の値は直る
  await expect(page.getByTestId('window')).toHaveValue('0');
  await page.getByTestId('eval-mini').click();
  await expect(page.getByTestId('eval-mini')).toHaveAttribute('aria-checked', 'true');

  await page.reload();
  await expect(page.getByTestId('normal-total')).toHaveValue('90');
  await expect(page.getByTestId('eval-mini')).toHaveAttribute('aria-checked', 'true');

  await page.goto('./#/new');
  await expect(page.getByTestId('start-normal')).toHaveText('ふつう（1分30秒）');
  await expect(page.getByTestId('start-deep')).toHaveText('じっくり（5分）');
  await expect(page.getByTestId('start-quick')).toHaveCount(0);
  // 「精密」は PC 版（start.bat から開いたとき）だけ
  await expect(page.getByTestId('start-precise')).toHaveCount(0);
  await expect(page.getByTestId('pc-engine-note')).toHaveCount(0);

  await page.goto('./#/settings');
  await page.getByTestId('reset-settings').click();
  await page.getByTestId('reset-confirm').click();
  await expect(page.getByTestId('normal-total')).toHaveValue('120');
  await expect(page.getByTestId('window')).toHaveValue('300');
  await expect(page.getByTestId('eval-micro')).toHaveAttribute('aria-checked', 'true');
});

test('オフラインでも開ける（一度開いたあとは、電波がなくても一覧とツリーが見られる）', async ({ page, context }) => {
  await openHome(page);
  // 手元の preview はヘッダを付けるので、service worker が働き始める前に isolated になる。
  // 公開版と同じ状態（service worker が担当している）になるまで待ち、もう一度開いて HTML を保存させる
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise((resolve) => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
    }
  });
  await page.reload();
  await importJson(page, sampleTree());
  await expect(page.getByTestId('tree-item')).toHaveCount(1);
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId('tabbar')).toBeVisible();
  await page.getByTestId('tree-item').first().click();
  await expect(page.getByTestId('candidate').first()).toContainText('▲７六歩');
  await context.setOffline(false);
});

test('気づきを送る：GitHub の Issue 作成画面を開くリンクに、入力した文が入る（ツリーは入らない）', async ({ page }) => {
  await openHome(page);
  // 気づきは設定のタブから送る（段階11-1）。「画面：」は設定のタブの前に見ていた画面
  await page.getByTestId('tab-settings').click();
  await page.getByTestId('feedback-open').click();
  // 空のままだと開かない
  await page.getByTestId('feedback-send').click();
  await expect(page.getByTestId('feedback-dialog')).toContainText('気づいたことを入力してください');
  await page.getByTestId('feedback-text').fill('盤をもう少し大きく');
  const href = await page.getByTestId('feedback-send').getAttribute('href');
  expect(href).toContain('https://github.com/skiri7kenteki/joban-tree/issues/new?title=');
  const url = new URL(href!);
  expect(url.searchParams.get('title')).toBe('【気づき】盤をもう少し大きく');
  expect(url.searchParams.get('body')).toContain('画面：ツリー（一覧）');
  expect(url.searchParams.get('body')).toMatch(/アプリのバージョン：\d+\.\d+\.\d+/);
});

async function streamText(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks).toString('utf8');
}
