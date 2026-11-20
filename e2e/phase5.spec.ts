// 段階5：戦型から選んでツリーを作る（5-1）・自分で戦型を登録する・配る（5-2）
import { expect, test, type Page } from '@playwright/test';
import type { Readable } from 'node:stream';
import { STARTPOS_SFEN, applyUsiMove, sfenKey } from '../src/shogi/position';
import { TREE_APP, TREE_FORMAT_VERSION, type TreeData, type TreeNode } from '../src/tree/types';

/**
 * 開いている窓を × で閉じる（窓が本当に開くまで待ってから押し、閉じたのを確かめる）。
 * Esc だと、遅い端末（GitHub の実行環境）で窓が開く前に押してしまい、後から開いた窓が次の操作をふさぐことがあった
 */
async function closeDialog(page: Page) {
  await page.locator('dialog[open]').last().getByRole('button', { name: '閉じる' }).click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
}

async function openNewTree(page: Page) {
  await page.goto('./');
  await expect(page.getByTestId('isolation')).toHaveAttribute('data-state', 'isolated', { timeout: 30_000 });
  await page.getByTestId('new-tree').click();
  await expect(page.getByRole('heading', { name: '新しいツリー' })).toBeVisible();
}

/** 「戦型から選ぶ」→ 横歩取り → 名前の戦型を選ぶ */
async function pickTemplate(page: Page, name: string) {
  await page.getByTestId('template-open').click();
  await expect(page.getByTestId('template-group')).toHaveCount(1);
  await page.getByTestId('template-group').filter({ hasText: '横歩取り' }).click();
  await page.getByTestId('template-item').filter({ hasText: name }).click();
  await expect(page.getByTestId('template-picker')).toHaveCount(0);
}

test.describe('5-1 戦型から選ぶ', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('グループ → 戦型 → 選ぶと、手順を読み込んだ状態になり、メモが盤の下に出る', async ({ page }) => {
    await openNewTree(page);
    await page.getByTestId('template-open').click();
    // グループの一覧（今は横歩取りだけ、7 つ）
    await expect(page.getByTestId('template-group')).toHaveText(/横歩取り\s*7/);
    await page.getByTestId('template-group').click();
    await expect(page.getByTestId('template-item')).toHaveCount(7);
    // 確認済みなので「未確認」は出ない
    await expect(page.getByTestId('template-unreviewed')).toHaveCount(0);
    // 戻ってグループの一覧に
    await page.getByTestId('template-back').click();
    await expect(page.getByTestId('template-group')).toBeVisible();
    await page.getByTestId('template-group').click();
    await page.getByTestId('template-item').filter({ hasText: '△3三角型' }).click();

    await expect(page.getByTestId('input-position')).toHaveText('17手目 ▲３六飛');
    await expect(page.getByTestId('template-note')).toContainText('横歩取り △3三角型（▲3六飛まで）');
    await expect(page.getByTestId('template-note')).toContainText('△3三角 ▲3六飛 の基本形');
    await expect(page.getByTestId('side-black')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('start-bar')).toContainText('17手目 ▲３六飛から作る（自分は☗先手）');

    // 手順を戻すと、戦型の途中なのでメモは隠れる。自分の側は先手のまま（戦型を選んだときは固定）
    await page.getByTestId('input-prev').click();
    await expect(page.getByTestId('input-position')).toHaveText('16手目 △３三角');
    await expect(page.getByTestId('template-note')).toHaveCount(0);
    await expect(page.getByTestId('side-black')).toHaveAttribute('aria-checked', 'true');
    // 自分の側は切り替えられる
    await page.getByTestId('side-white').click();
    await expect(page.getByTestId('side-white')).toHaveAttribute('aria-checked', 'true');
    await page.getByTestId('input-next').click();
    await expect(page.getByTestId('side-white')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('template-note')).toBeVisible();

    // 盤上で先へ進めても、戦型の続きとしてメモが残る（△8四飛）
    await page.locator('[data-square="86"]').click();
    await page.locator('[data-square="84"]').click();
    await expect(page.getByTestId('input-position')).toHaveText('18手目 △８四飛');
    await expect(page.getByTestId('template-note')).toContainText('からさらに進めた局面');
  });

  test('後手の戦型（△4五角戦法）は自分が後手。棋譜を読み込むと戦型は外れる', async ({ page }) => {
    await openNewTree(page);
    await pickTemplate(page, '△4五角戦法');
    await expect(page.getByTestId('input-position')).toHaveText('20手目 △４五角');
    await expect(page.getByTestId('side-white')).toHaveAttribute('aria-checked', 'true');
    // 盤とメモ・作るボタンが重ならない
    await expect(page.getByTestId('template-note')).toBeVisible();
    await expect(page.getByTestId('start-normal')).toBeInViewport({ ratio: 1 });

    await page.getByTestId('kifu-open').click();
    await page.getByTestId('kifu-input').fill('7g7f 3c3d');
    await page.getByTestId('kifu-load').click();
    await expect(page.getByTestId('template-note')).toHaveCount(0);
    // 2 手目の後＝先手の番なので、自分は後手（これまで通りの初期値）
    await expect(page.getByTestId('side-white')).toHaveAttribute('aria-checked', 'true');
    // 戦型を外した後は、これまで通り手順を動かすと自分の側も変わる
    await page.getByTestId('input-prev').click();
    await expect(page.getByTestId('side-black')).toHaveAttribute('aria-checked', 'true');
  });

  test.describe('エンジンを使う', () => {
    test.skip(!process.env.ENGINE_AVAILABLE, 'エンジンがビルドされていないので省略（GitHub Actions では実行される）');

    test('戦型から作ったツリーの名前は戦型の名前', async ({ page }) => {
      test.setTimeout(120_000);
      await openNewTree(page);
      await pickTemplate(page, '青野流（▲5八玉');
      await page.getByTestId('start-normal').click();
      await expect(page.getByRole('heading', { name: '横歩取り 青野流（▲5八玉まで）' })).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('gen-status')).toHaveAttribute('data-phase', /running|done/, { timeout: 60_000 });
      const stop = page.getByTestId('gen-stop');
      if (await stop.isVisible()) await stop.click();
    });
  });
});

// ---- 段階5-2：自分で戦型を登録する・配る ----

async function streamText(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

/** 平手から prefix の後の局面を開始局面に、相手の応手 1 つと自分の対応 1 つを持つ小さなツリー */
function smallTree(id: string, prefix: string[], reply: string, mine: string): TreeData {
  let sfen = STARTPOS_SFEN;
  for (const m of prefix) sfen = applyUsiMove(sfen, m)!.sfen;
  const nodes: Record<string, TreeNode> = {};
  const add = (s: string) => (nodes[sfenKey(s)] ??= { key: sfenKey(s), sfen: s, round: 0, edges: [] });
  const root = add(sfen);
  const a = applyUsiMove(sfen, reply)!.sfen;
  root.edges.push({ move: reply, to: add(a).key, score: { kind: 'cp', value: 50 }, diff: 0 });
  const b = applyUsiMove(a, mine)!.sfen;
  nodes[sfenKey(a)].edges.push({ move: mine, to: add(b).key, score: { kind: 'cp', value: 60 } });
  return {
    app: TREE_APP,
    version: TREE_FORMAT_VERSION,
    id,
    name: `段階5 ${id}`,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    mySide: sfen.split(' ')[1] === 'w' ? 'black' : 'white',
    rootKey: root.key,
    prefix: { initialSfen: STARTPOS_SFEN, moves: prefix },
    nodes,
    settings: { totalMs: 120_000, movetimeMs: 1500, multiPV: 4, maxRounds: 4, maxNodes: 3000, windowCp: 300, replyMs: 1000, dubiousCp: 150 },
  };
}

/** 入力画面で、今の局面を戦型として登録する */
async function register(page: Page, fields: { name?: string; group?: string; note?: string }) {
  await page.getByTestId('register-template').click();
  const dialog = page.getByTestId('template-register');
  await expect(dialog).toBeVisible();
  if (fields.name !== undefined) await page.getByTestId('template-name').fill(fields.name);
  if (fields.group !== undefined) await page.getByTestId('template-group-input').fill(fields.group);
  if (fields.note !== undefined) await page.getByTestId('template-note-input').fill(fields.note);
  await page.getByTestId('template-save').click();
  await expect(dialog).toHaveCount(0);
}

test.describe('5-2 自分で戦型を登録する・配る', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('入力画面から登録 → 一覧に「自分で登録」で並ぶ → 直す → 消す（確認あり）', async ({ page }) => {
    await openNewTree(page);
    await pickTemplate(page, '△3三角型');
    // 盤上で △8四飛 と進めてから登録。名前・グループの初期値は戦型から
    await page.locator('[data-square="86"]').click();
    await page.locator('[data-square="84"]').click();
    await page.getByTestId('register-template').click();
    await expect(page.getByTestId('template-name')).toHaveValue('横歩取り △3三角型（▲3六飛まで） → △８四飛まで');
    await expect(page.getByTestId('template-group-input')).toHaveValue('横歩取り');
    // 名前が空なら保存しない
    await page.getByTestId('template-name').fill(' ');
    await page.getByTestId('template-save').click();
    await expect(page.getByTestId('template-error')).toContainText('名前');
    await page.getByTestId('template-name').fill('マイ8四飛');
    await page.getByTestId('template-note-input').fill('自分の研究用');
    await page.getByTestId('template-save').click();
    await expect(page.getByTestId('register-note')).toContainText('「マイ8四飛」を戦型として登録しました');
    await expect(page.getByTestId('template-note')).toContainText('マイ8四飛');
    await expect(page.getByTestId('template-note')).toContainText('自分の研究用');

    // 「戦型から選ぶ」に、同梱のものと並ぶ（自分で登録の印）
    await page.getByTestId('template-open').click();
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

    // 選ぶと、その局面から（自分の側も登録したとき＝先手）
    await page.getByTestId('template-group').filter({ hasText: '自分の研究' }).click();
    await page.getByTestId('template-item').click();
    await expect(page.getByTestId('input-position')).toHaveText('18手目 △８四飛');
    await expect(page.getByTestId('side-black')).toHaveAttribute('aria-checked', 'true');

    // 再読み込みしても残っている（端末に保存）
    await page.reload();
    await page.getByTestId('template-open').click();
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
    await openNewTree(page);
    // 何も登録していなければ書き出せない
    await page.getByTestId('template-open').click();
    await expect(page.getByTestId('template-export')).toBeDisabled();
    await closeDialog(page);
    // 平手から ▲７六歩 △３四歩 を盤で指して登録（新しいグループ）
    await page.locator('[data-square="77"]').click();
    await page.locator('[data-square="76"]').click();
    await page.locator('[data-square="33"]').click();
    await page.locator('[data-square="34"]').click();
    await register(page, { name: '角道を開ける', group: '自分の研究', note: 'メモ' });

    await page.getByTestId('template-open').click();
    const download = page.waitForEvent('download');
    await page.getByTestId('template-export').click();
    const file = await download;
    expect(file.suggestedFilename()).toBe('序盤ツリーの戦型.json');
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

  test('閲覧画面の局面から登録（開始局面までの手順＋たどった手）', async ({ page }) => {
    const tree = smallTree('p52-tree', ['7g7f'], '3c3d', '2g2f');
    await page.goto('./');
    await expect(page.getByTestId('isolation')).toHaveAttribute('data-state', 'isolated', { timeout: 30_000 });
    await page.getByTestId('import-file').setInputFiles({ name: 't.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(tree)) });
    await expect(page.getByTestId('home-message')).toContainText('取り込みました');
    await page.goto(`./#/tree/${tree.id}`);
    await page.getByTestId('candidate').first().click();
    await page.getByTestId('register-template').click();
    await expect(page.getByTestId('template-register')).toContainText('平手の初期局面から 2 手の局面を、自分は☗先手');
    await expect(page.getByTestId('template-name')).toHaveValue('2手目 △３四歩まで');
    await page.getByTestId('template-group-input').fill('自分の研究');
    await page.getByTestId('template-save').click();
    await expect(page.getByTestId('tree-note')).toContainText('「2手目 △３四歩まで」を戦型として登録しました');

    await page.goto('./#/new');
    await page.getByTestId('template-open').click();
    await page.getByTestId('template-group').filter({ hasText: '自分の研究' }).click();
    await page.getByTestId('template-item').click();
    await expect(page.getByTestId('input-position')).toHaveText('2手目 △３四歩');
  });

  test('SFEN の途中の局面から始めた手順は登録できない（理由を出す）', async ({ page }) => {
    await openNewTree(page);
    await page.getByTestId('kifu-open').click();
    await page.getByTestId('kifu-input').fill('sfen lnsgkgsnl/1r5b1/ppppppppp/9/9/2P6/PP1PPPPPP/1B5R1/LNSGKGSNL w - 2');
    await page.getByTestId('kifu-load').click();
    await page.getByTestId('register-template').click();
    await expect(page.getByTestId('register-note')).toContainText('平手の初期局面から始まる手順だけ');
    await expect(page.getByTestId('template-register')).toHaveCount(0);
  });
});

// ---- 段階5の手直し（v0.12.0 のレビューから） ----

test.describe('5 手直し', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test('スマホ縦：戦型を選んだ直後、スクロールせずに戦型名が見える（その先へ進めたら「→ △８四飛」）', async ({ page }) => {
    await openNewTree(page);
    await expect(page.getByTestId('template-current')).toHaveCount(0);
    await pickTemplate(page, '青野流（▲5八玉');
    const current = page.getByTestId('template-current');
    await expect(current).toHaveText('戦型：横歩取り 青野流（▲5八玉まで）');
    await expect(current).toBeInViewport({ ratio: 1 });
    // 作るボタンのバーに隠れていない
    const bar = (await page.getByTestId('start-bar').boundingBox())!;
    const box = (await current.boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(bar.y);
    // 盤も、選ぶ前と同じくバーの上に収まる（案内の行と入れ替えたので高さが変わらない）
    const board = (await page.getByTestId('board').boundingBox())!;
    expect(board.y + board.height).toBeLessThanOrEqual(bar.y);

    await page.getByTestId('input-prev').click();
    await expect(current).toHaveCount(0);
    await page.getByTestId('input-next').click();
    await page.locator('[data-square="86"]').click();
    await page.locator('[data-square="84"]').click();
    await expect(current).toHaveText('戦型：横歩取り 青野流（▲5八玉まで） → △８四飛');
  });

  test('同梱の戦型と同じ局面は登録できない。自分で登録したものと同じなら ⋯ から直すよう案内', async ({ page }) => {
    await openNewTree(page);
    await pickTemplate(page, '青野流（▲5八玉');
    await page.getByTestId('register-template').click();
    await expect(page.getByTestId('template-same')).toHaveText(
      'この局面は「横歩取り 青野流（▲5八玉まで）」として、すでにあります（アプリに入っている戦型）。同じ局面は登録できません。',
    );
    // 出発点そのものなので、名前の初期値は空。登録するは押せない
    await expect(page.getByTestId('template-name')).toHaveValue('');
    await expect(page.getByTestId('template-save')).toBeDisabled();
    await closeDialog(page);

    // 1 手進めれば登録できる → 同じ局面でもう一度登録しようとすると、自分で登録した戦型として案内
    await page.locator('[data-square="86"]').click();
    await page.locator('[data-square="84"]').click();
    await register(page, { name: '青野流に△8四飛' });
    await page.getByTestId('register-template').click();
    await expect(page.getByTestId('template-same')).toContainText('この局面は「青野流に△8四飛」として、すでにあります（自分で登録した戦型）');
    await expect(page.getByTestId('template-same')).toContainText('一覧の ⋯ から');
    await expect(page.getByTestId('template-save')).toBeDisabled();
  });

  test('登録画面のグループの候補は枠線だけのチップ（「登録する」と見た目を分ける）', async ({ page }) => {
    await openNewTree(page);
    await pickTemplate(page, '青野流（▲5八玉');
    await page.locator('[data-square="86"]').click();
    await page.locator('[data-square="84"]').click();
    await page.getByTestId('register-template').click();
    const chip = page.getByTestId('group-choice').filter({ hasText: '横歩取り' });
    await expect(chip).toHaveAttribute('aria-pressed', 'true');
    await expect(chip).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(page.getByTestId('template-save')).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await page.getByTestId('template-group-input').fill('別のグループ');
    await expect(chip).toHaveAttribute('aria-pressed', 'false');
    await chip.click();
    await expect(page.getByTestId('template-group-input')).toHaveValue('横歩取り');
  });

  test('戦型の一覧では、名前の頭のグループ名を省く（ツリーの名前は省かない）', async ({ page }) => {
    await openNewTree(page);
    await page.getByTestId('template-open').click();
    await page.getByTestId('template-group').click();
    const names = page.getByTestId('template-item').locator('.template-item-name');
    await expect(names).toHaveText([
      '基本図（▲3四飛まで）',
      '△3三角（後手番）',
      '△3三角型（▲3六飛まで）',
      '△8四飛型・中住まい',
      '青野流（▲5八玉まで）',
      '△4五角戦法',
      '相横歩取り（△7六飛まで）',
    ]);
    await page.getByTestId('template-item').filter({ hasText: '青野流（▲5八玉' }).click();
    // 盤の上の戦型名・作るときのツリーの名前は元の名前のまま
    await expect(page.getByTestId('template-current')).toHaveText('戦型：横歩取り 青野流（▲5八玉まで）');
    await expect(page.getByTestId('template-note')).toContainText('横歩取り 青野流（▲5八玉まで）');
  });
});
