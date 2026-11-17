// 段階7-1：トップ画面を戦型ごとに整理する（グループ・開閉・件数・最近開いた・絞り込み）と、小さな不具合 2 つ
// 段階7-2：研究手順（閲覧画面で保存 → トップ画面の一覧 → タップでその局面をパンくずリストごと開く → 直す → 消す）
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { STARTPOS_SFEN, applyUsiMove, sfenKey, type Side } from '../src/shogi/position';
import type { BundledTreeFile } from '../src/tree/bundled';
import { TREE_APP, TREE_FORMAT_VERSION, type Study, type TreeData, type TreeEdge, type TreeNode } from '../src/tree/types';

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
    await expect(page.getByTestId('filter-empty')).toContainText('「相掛かり」に当てはまるツリーはありません');

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

// ---- 段階7-2：研究手順 ----

/**
 * 小さなツリー（自分は後手）：
 *   開始局面 ─▲7六歩─ △3四歩 ─┬▲2六歩─ △8四歩
 *                              └▲6六歩（自分の手なし）
 *            ─▲2六歩─ △8四歩
 */
function lineTree(id: string, name: string, studies?: Study[]): TreeData {
  const nodes: Record<string, TreeNode> = {};
  const put = (sfen: string, round: number) => {
    const key = sfenKey(sfen);
    nodes[key] ??= { key, sfen, round, edges: [] };
    return nodes[key];
  };
  const link = (from: TreeNode, move: string, round: number, diff?: number): TreeNode => {
    const next = applyUsiMove(from.sfen, move)!.sfen;
    const to = put(next, round);
    const edge: TreeEdge = { move, to: to.key, score: { kind: 'cp', value: -30 }, ...(diff !== undefined ? { diff } : {}) };
    from.edges.push(edge);
    return to;
  };
  const root = put(STARTPOS_SFEN, 0);
  const a = link(root, '7g7f', 0, 0);
  const c = link(a, '3c3d', 1);
  const d = link(c, '2g2f', 1, 0);
  link(d, '8c8d', 2);
  link(c, '6g6f', 1, 20);
  const b = link(root, '2g2f', 0, 10);
  link(b, '8c8d', 1);
  return {
    app: TREE_APP,
    version: TREE_FORMAT_VERSION,
    id,
    name,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    mySide: 'white',
    rootKey: root.key,
    prefix: { initialSfen: STARTPOS_SFEN, moves: [] },
    nodes,
    settings: { totalMs: 30_000, movetimeMs: 400, multiPV: 3, maxRounds: 3, maxNodes: 3000, windowCp: 300, replyMs: 300, dubiousCp: 150 },
    ...(studies ? { studies } : {}),
  };
}

test.describe('7-2 研究手順（スマホ縦 360×740）', () => {
  test.use({ viewport: { width: 360, height: 740 }, hasTouch: true });

  test('閲覧画面で保存 → トップ画面の研究手順に出る → タップでその局面がパンくずリストごと開く → メモを直す → 消す', async ({ page }) => {
    await openHome(page);
    await importAll(page, [lineTree('line', '研究用ツリー')]);
    await page.getByTestId('tree-item').click();
    await expect(page.locator('h1')).toContainText('研究用ツリー');
    // 開始局面では保存できない
    await expect(page.getByTestId('study-open')).toBeDisabled();

    // ▲7六歩 △3四歩 ▲2六歩 まで進めて保存
    const cand = page.getByTestId('candidate');
    await cand.filter({ hasText: '▲７六歩' }).click();
    await cand.filter({ hasText: '△３四歩' }).click();
    await cand.filter({ hasText: '▲２六歩' }).click();
    await expect(page.getByTestId('crumb')).toHaveText(['▲７六歩', '△３四歩', '▲２六歩']);
    await expect(page.getByTestId('study-open')).toHaveText('この手順を研究として保存');
    await page.getByTestId('study-open').click();
    await expect(page.getByTestId('study-dialog')).toContainText('研究手順として保存');
    // 名前の初期値は最後の 3 手、メモは空
    await expect(page.getByTestId('study-name')).toHaveValue('▲７六歩 △３四歩 ▲２六歩');
    await expect(page.getByTestId('study-note')).toHaveValue('');
    await page.getByTestId('study-note').fill('狙い：早めに△8四歩\n2 行目のメモ');
    await page.getByTestId('study-save').click();
    await expect(page.getByTestId('tree-note')).toContainText('保存しました');
    // 終わりの局面：候補手の見出しの行に「★ 名前」
    await expect(page.getByTestId('study-here')).toHaveText('★ ▲７六歩 △３四歩 ▲２六歩');
    await expect(page.getByTestId('study-open')).toHaveText('研究手順を直す');

    // 開始局面に戻ると、研究手順の手（▲7六歩）にだけ★
    await page.getByTestId('crumb-start').click();
    await expect(page.getByTestId('study-here')).toHaveCount(0);
    await expect(cand.filter({ hasText: '▲７六歩' }).getByTestId('study-star')).toHaveCount(1);
    await expect(cand.filter({ hasText: '▲２六歩' }).getByTestId('study-star')).toHaveCount(0);
    // 同じ局面にもう一度来て保存を押すと、新しく作らずに直す画面
    await cand.filter({ hasText: '▲７六歩' }).click();
    await cand.filter({ hasText: '△３四歩' }).click();
    await expect(cand.filter({ hasText: '▲２六歩' }).getByTestId('study-star')).toHaveCount(1);
    await expect(cand.filter({ hasText: '▲６六歩' }).getByTestId('study-star')).toHaveCount(0);
    await cand.filter({ hasText: '▲２六歩' }).click();
    await page.getByTestId('study-open').click();
    await expect(page.getByTestId('study-dialog')).toContainText('研究手順を直す');
    await expect(page.getByTestId('study-name')).toHaveValue('▲７六歩 △３四歩 ▲２六歩');
    await page.getByTestId('study-dialog').getByRole('button', { name: 'やめる' }).click();

    // トップ画面の「研究手順」
    await page.goto('./');
    await expect(page.getByTestId('tab-studies')).toContainText('研究手順 1');
    await page.getByTestId('tab-studies').click();
    const item = page.getByTestId('study-item');
    await expect(item).toHaveCount(1);
    await expect(item).toContainText('▲７六歩 △３四歩 ▲２六歩');
    await expect(item.getByTestId('study-item-note')).toHaveText('狙い：早めに△8四歩');
    await expect(item).toContainText('研究用ツリー');
    await expect(page.getByTestId('tree-group-head')).toHaveText([/その他\s*1/]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);

    // タップ → そのツリーのその局面（パンくずリストごと）
    await item.click();
    await expect(page).toHaveURL(/#\/tree\/line\/study\/s-[\w-]+$/);
    await expect(page.getByTestId('crumb')).toHaveText(['▲７六歩', '△３四歩', '▲２六歩']);
    await expect(page.getByTestId('candidate')).toHaveText([/△８四歩/]);
    // パンくずで戻ったり進んだりもできる
    await page.getByTestId('crumb').nth(1).click();
    await expect(page.getByTestId('crumb')).toHaveText(['▲７六歩', '△３四歩']);
    await page.getByTestId('crumb').nth(1).click();
    await cand.filter({ hasText: '▲２六歩' }).click();

    // メモを見る → 直す
    await page.getByTestId('study-here').click();
    await expect(page.getByTestId('study-view-note')).toHaveText('狙い：早めに△8四歩\n2 行目のメモ');
    await page.getByTestId('study-edit').click();
    await page.getByTestId('study-name').fill('早めの△8四歩');
    await page.getByTestId('study-note').fill('直したメモ');
    await page.getByTestId('study-save').click();
    await expect(page.getByTestId('study-here')).toHaveText('★ 早めの△8四歩');

    // トップ画面：直した名前。研究手順の一覧のまま（戻ってきたときも同じ方）。絞り込みは名前・メモに当たる
    await page.goto('./');
    await expect(page.getByTestId('tab-studies')).toHaveAttribute('aria-selected', 'true');
    await expect(item).toContainText('早めの△8四歩');
    await page.getByTestId('tree-filter').fill('直した');
    await expect(item).toHaveCount(1);
    await page.getByTestId('tree-filter').fill('相掛かり');
    await expect(item).toHaveCount(0);
    await expect(page.getByTestId('filter-empty')).toContainText('当てはまる研究手順はありません');
    // ツリーの一覧の絞り込みも、研究手順の名前に当たる
    await page.getByTestId('tab-trees').click();
    await page.getByTestId('tree-filter').fill('早めの');
    await expect(page.getByTestId('tree-item')).toHaveText([/研究用ツリー/]);
    await page.getByTestId('tree-filter').fill('');

    // 消す（確認あり）
    await page.getByTestId('tab-studies').click();
    await item.click();
    await page.getByTestId('study-here').click();
    await page.getByTestId('study-delete').click();
    await expect(page.getByTestId('study-view')).toContainText('この研究手順を消しますか？');
    await page.getByTestId('study-delete-ok').click();
    await expect(page.getByTestId('study-here')).toHaveCount(0);
    await expect(page.getByTestId('tree-note')).toContainText('消しました');
    // 局面は消えない
    await expect(page.getByTestId('candidate')).toHaveText([/△８四歩/]);
    await page.goto('./');
    await expect(page.getByTestId('studies-empty')).toBeVisible();
    await expect(page.getByTestId('tab-studies')).toContainText('研究手順 0');
  });

  test('トップ画面の研究手順の ⋯ から、名前・メモを直す・消す（確認あり。ツリーの局面は消えない）', async ({ page }) => {
    await openHome(page);
    const s1: Study = { id: 's-1', name: '研究A', note: 'もとのメモ', moves: ['7g7f', '3c3d', '2g2f'], createdAt: 1, updatedAt: 2 };
    const s2: Study = { id: 's-2', name: '研究B', note: '', moves: ['2g2f', '8c8d'], createdAt: 1, updatedAt: 1 };
    await importAll(page, [lineTree('line3', '整理するツリー', [s1, s2])]);
    await page.getByTestId('tab-studies').click();
    const items = page.getByTestId('study-item');
    await expect(items).toHaveText([/研究A/, /研究B/]);

    // 直す
    await page.getByTestId('study-menu').first().click();
    await expect(page.getByTestId('study-menu-dialog')).toContainText('整理するツリー');
    await page.getByTestId('study-menu-edit').click();
    await expect(page.getByTestId('study-moves')).toHaveText('▲７六歩 △３四歩 ▲２六歩');
    await expect(page.getByTestId('study-name')).toHaveValue('研究A');
    await page.getByTestId('study-name').fill('研究A（直した）');
    await page.getByTestId('study-note').fill('新しいメモ');
    await page.getByTestId('study-save').click();
    await expect(page.getByTestId('home-message')).toContainText('「研究A（直した）」を直しました');
    await expect(items.first()).toContainText('研究A（直した）');
    await expect(items.first().getByTestId('study-item-note')).toHaveText('新しいメモ');

    // 消す：確認でやめると残る → 消すと 1 つになる
    const b = items.filter({ hasText: '研究B' });
    await page.getByTestId('study-menu').nth(1).click();
    await page.getByTestId('study-menu-delete').click();
    await expect(page.getByTestId('study-menu-dialog')).toContainText('この研究手順を消しますか？');
    await page.getByTestId('study-menu-dialog').getByRole('button', { name: 'やめる' }).click();
    await page.getByTestId('study-menu-delete').click();
    await page.getByTestId('study-menu-delete-ok').click();
    await expect(page.getByTestId('home-message')).toContainText('「研究B」を消しました');
    await expect(b).toHaveCount(0);
    await expect(items).toHaveCount(1);
    await expect(page.getByTestId('tab-studies')).toContainText('研究手順 1');

    // ツリーの局面は消えていない（▲2六歩 △8四歩 はたどれる）。直した名前は閲覧画面にも出る
    await page.getByTestId('tab-trees').click();
    await page.getByTestId('tree-item').click();
    await page.getByTestId('candidate').filter({ hasText: '▲２六歩' }).click();
    await expect(page.getByTestId('candidate')).toHaveText([/△８四歩/]);
    await page.getByTestId('crumb-start').click();
    for (const m of ['▲７六歩', '△３四歩', '▲２六歩']) await page.getByTestId('candidate').filter({ hasText: m }).click();
    await expect(page.getByTestId('study-here')).toHaveText('★ 研究A（直した）');
  });

  test('途中までしかたどれない研究手順：一覧に「途中まで」、開くとたどれるところまで開いて知らせる（消さない）', async ({ page }) => {
    await openHome(page);
    const broken: Study = { id: 's-broken', name: '△4四歩の研究', note: '', moves: ['7g7f', '3c3d', '6g6f', '4c4d'], createdAt: 1, updatedAt: 1 };
    await importAll(page, [lineTree('line2', '取り込んだツリー', [broken])]);
    await page.getByTestId('tab-studies').click();
    await expect(page.getByTestId('study-item').getByTestId('study-broken')).toHaveText('途中まで');
    await page.getByTestId('study-item').click();
    await expect(page.getByTestId('crumb')).toHaveText(['▲７六歩', '△３四歩', '▲６六歩']);
    await expect(page.getByTestId('tree-note')).toContainText('途中までしかたどれません（4 手のうち 3 手目まで）');
  });

  test('用意済みのツリーの新しい版：前の版のコピーの研究手順のうち、たどれるものを引き継げる（たどれないものの数と名前を知らせる）', async ({ page }) => {
    await openHome(page);
    const file = JSON.parse(readFileSync(new URL('../public/trees/yokofu-33kaku-gote.v1.json', import.meta.url), 'utf8')) as BundledTreeFile;
    const root = file.tree.nodes[file.tree.rootKey];
    const first = root.edges[0];
    const reply = file.tree.nodes[first.to].edges[0];
    const old = {
      ...file.tree,
      version: TREE_FORMAT_VERSION,
      id: 'old-copy',
      name: '前の版のコピー',
      source: { kind: 'bundled', id: file.bundle.id, version: 0, finishedAt: 1 },
      studies: [
        { id: 's-ok', name: 'たどれる研究', note: 'メモ', moves: [first.move, reply.move], createdAt: 1, updatedAt: 1 },
        { id: 's-ng', name: 'たどれない研究', note: '', moves: [first.move, '1c1d'], createdAt: 2, updatedAt: 2 },
      ],
    };
    await page.getByTestId('import-file').setInputFiles({ name: 'old.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(old)) });
    await expect(page.getByTestId('home-message')).toContainText('取り込みました');
    await page.getByTestId('new-tree').click();
    await page.getByTestId('template-open').click();
    await page.getByTestId('template-group').filter({ hasText: '横歩取り' }).click();
    await page.getByTestId('template-item').filter({ hasText: '△3三角（後手番）' }).click();
    await page.getByTestId('bundled-open').click();
    await expect(page.getByTestId('carry-summary')).toContainText('研究手順が 2 件');
    await expect(page.getByTestId('carry-summary')).toContainText('1 件');
    await expect(page.getByTestId('carry-lost')).toContainText('「たどれない研究」');
    await page.getByTestId('carry-yes').click();
    await expect(page).toHaveURL(/#\/tree\/[\w-]+$/);
    expect(page.url()).not.toMatch(/old-copy/);
    await expect(page.getByTestId('candidate').first().getByTestId('study-star')).toHaveCount(1);
    // トップ画面：前の版のコピーに 2 件（そのまま）、新しいコピーに 1 件
    await page.goto('./');
    await page.getByTestId('tab-studies').click();
    await expect(page.getByTestId('study-item')).toHaveCount(3);
    await expect(page.getByTestId('study-item').filter({ hasText: 'たどれる研究' })).toHaveCount(2);
  });
});

// ---- 研究手順だけを復習する（2026-11-17） ----

test.describe('研究手順だけを復習する（スマホ縦 360×740）', () => {
  test.use({ viewport: { width: 360, height: 740 }, hasTouch: true });

  const s1: Study = { id: 's-1', name: '研究1', note: 'メモの 1 行目\n2 行目', moves: ['7g7f', '3c3d', '2g2f', '8c8d'], createdAt: 1, updatedAt: 3 };
  const s2: Study = { id: 's-2', name: '研究2', note: '', moves: ['2g2f', '8c8d'], createdAt: 1, updatedAt: 2 };
  const broken: Study = { id: 's-3', name: '途中まで', note: '', moves: ['7g7f', '3c3d', '6g6f', '4c4d'], createdAt: 1, updatedAt: 1 };

  async function play(page: Page, from: string, to: string) {
    await page.locator(`[data-square="${from}"]`).click();
    await page.locator(`[data-square="${to}"]`).click();
  }

  test('復習画面の「研究手順だけ」：相手は研究手順どおり、自分の手番で研究手順の手を答える。終わるとメモを出す', async ({ page }) => {
    await openHome(page);
    await importAll(page, [lineTree('rv', '復習するツリー', [s1, s2])]);
    await page.getByTestId('tree-item').click();
    await page.getByTestId('review-open').click();
    await expect(page.getByTestId('review-mode-all')).toHaveAttribute('aria-selected', 'true');
    await page.getByTestId('review-mode-studies').click();
    await expect(page).toHaveURL(/#\/review\/rv\/study$/);
    await expect(page.getByTestId('review-summary')).toContainText('研究手順 2 本・問題 3（まだ 3');
    const prompt = page.getByTestId('review-prompt');
    await expect(prompt).toHaveAttribute('data-phase', 'ask');
    // どちらの研究手順が選ばれても、最後まで答える
    const opponent = page.getByTestId('review-opponent');
    if ((await opponent.textContent())?.includes('▲７六歩')) {
      await play(page, '33', '34');
      await expect(opponent).toContainText('▲２六歩');
    }
    await play(page, '83', '84');
    await expect(page.getByTestId('review-end')).toContainText('を最後まで答えました');
    await expect(page.getByTestId('review-next')).toHaveText('次の研究手順へ');
    await page.getByTestId('review-next').click();
    await expect(prompt).toHaveAttribute('data-phase', 'ask');
    // 全部に戻せる
    await page.getByTestId('review-mode-all').click();
    await expect(page).toHaveURL(/#\/review\/rv$/);
    await expect(page.getByTestId('review-summary')).not.toContainText('研究手順');
  });

  test('1 本だけ（トップ画面の研究手順の ⋯ から）：まちがえたら「もう一度」。終わりに結果とメモ、「もう一度」', async ({ page }) => {
    await openHome(page);
    await importAll(page, [lineTree('rv2', '復習するツリー', [s1, s2])]);
    await page.getByTestId('tab-studies').click();
    await page.getByTestId('study-item').filter({ hasText: '研究1' }).locator('..').getByTestId('study-menu').click();
    await page.getByTestId('study-menu-review').click();
    await expect(page).toHaveURL(/#\/review\/rv2\/study\/s-1$/);
    await expect(page.getByTestId('review-summary')).toContainText('研究「研究1」だけ・問題 2（まだ 2');
    await expect(page.getByTestId('review-opponent')).toHaveText('相手は ▲７六歩');
    await play(page, '33', '34');
    await expect(page.getByTestId('review-answer')).toContainText('正解！');
    await expect(page.getByTestId('review-opponent')).toHaveText('相手は ▲２六歩');
    // まちがえる（△1四歩）→ もう一度 → △8四歩
    await play(page, '13', '14');
    await expect(page.getByTestId('review-wrong')).toContainText('△１四歩 ではありません');
    await page.getByTestId('review-retry').click();
    await play(page, '83', '84');
    await expect(page.getByTestId('review-end')).toHaveText('研究「研究1」を最後まで答えました（2 問中 1 問、1 回目で正解）。');
    await expect(page.getByTestId('review-study-note')).toHaveText('メモの 1 行目\n2 行目');
    await expect(page.getByTestId('review-prompt')).toBeInViewport();
    await expect(page.getByTestId('review-next')).toHaveText('もう一度');
    // 記録：1 問正解・1 問まちがい
    await expect(page.getByTestId('review-summary')).toContainText('問題 2（まだ 0・前回まちがい 1');
    await page.getByTestId('review-next').click();
    await expect(page.getByTestId('review-opponent')).toHaveText('相手は ▲７六歩');
  });

  test('途中までしかたどれない研究手順は、たどれるところまで出して知らせる。研究手順が無いツリーでは切り替えを出さない', async ({ page }) => {
    await openHome(page);
    await importAll(page, [lineTree('rv3', '途中までのツリー', [broken]), lineTree('rv4', '研究なしのツリー')]);
    await page.goto('./#/review/rv3/study/s-3');
    await expect(page.getByTestId('review-opponent')).toHaveText('相手は ▲７六歩');
    await play(page, '33', '34');
    await expect(page.getByTestId('review-end')).toContainText('研究「途中まで」をたどれるところまで答えました（1 問中 1 問');
    await expect(page.getByTestId('review-study-broken')).toContainText('4 手のうち 3 手目まで');
    await page.goto('./#/review/rv4');
    await expect(page.getByTestId('review-prompt')).toHaveAttribute('data-phase', 'ask');
    await expect(page.getByTestId('review-mode-all')).toHaveCount(0);
  });
});
