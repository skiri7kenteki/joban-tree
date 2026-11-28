// 段階8-1：研究手順（棋譜を貼って登録・稽古・書き出しと取り込み・端末の保存場所の移し替え）。8-2：変化付き KIF からまとめて取り込む
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { Position, Record as KifRecord, exportKIF } from 'tsshogi';
import { STARTPOS_SFEN, applyUsiMove, sfenKey } from '../src/shogi/position';
import { TREE_APP, TREE_FORMAT_VERSION, type Study, type TreeData, type TreeEdge, type TreeNode, type TreeStudy } from '../src/tree/types';
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
  // タブが切り替わってから（前のタブの画面に渡さないように。段階11-1）
  await expect(page.getByTestId('study-register')).toBeVisible();
  await page.getByTestId('study-import-file').setInputFiles({
    name: 'studies.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ app: 'joban-tree', kind: 'studies', version: 1, studies })),
  });
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
  mySide: 'white',
  createdAt: 1,
  updatedAt: 1,
  ...opts,
});

/**
 * 平手からの小さなツリー（後手番）：
 *   開始局面 ─▲7六歩─ △3四歩 ─▲2六歩─ △8四歩
 *                              └▲6六歩
 *            ─▲2六歩─ △8四歩
 */
function lineTree(id: string, name: string, studies?: TreeStudy[]): TreeData {
  const nodes: Record<string, TreeNode> = {};
  const put = (sfen: string, round: number) => {
    const key = sfenKey(sfen);
    nodes[key] ??= { key, sfen, round, edges: [] };
    return nodes[key];
  };
  const link = (from: TreeNode, move: string, round: number, diff?: number): TreeNode => {
    const to = put(applyUsiMove(from.sfen, move)!.sfen, round);
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
    version: studies ? 6 : TREE_FORMAT_VERSION,
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

const KIF = (handicap: string, moves: string[]) =>
  [`手合割：${handicap}`, '手数----指手---------消費時間--', ...moves.map((m, i) => `${String(i + 1).padStart(4)} ${m}   ( 0:00/00:00:00)`), ''].join('\n');

/** 保存場所の研究手順のメモ（欄は整理-2 で隠したので、中身で確かめる） */
const savedNote = (page: Page, name: string) =>
  page.evaluate(
    (name) =>
      new Promise<string>((resolve, reject) => {
        const open = indexedDB.open('joban-tree');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const r = open.result.transaction('studies').objectStore('studies').getAll();
          r.onsuccess = () => {
            open.result.close();
            resolve((r.result as { name: string; note: string }[]).find((s) => s.name.includes(name))?.note ?? '（その名前の研究手順が無い）');
          };
        };
      }),
    name,
  );

test.describe('8-1 登録（エンジンを使わない）', () => {
  // 段階10-2：登録の画面（#/new/study）を片付けたので、棋譜を貼って 1 本登録する窓と定跡帳で確かめる
  test('棋譜を貼って 1 本登録 → 定跡帳（終わりの局面）が開く → 一覧に出る → 前後に動かす（⋯ にツリーの操作は無い。段階20-3）', async ({ page }) => {
    await openHome(page);
    await page.getByTestId('tab-studies').click();
    await expect(page.getByTestId('studies-empty')).toBeVisible();
    await page.getByTestId('study-register').click();
    await page.getByTestId('study-register-paste').click();
    await page.getByTestId('kif-paste-input').fill(KIF('平手', ['７六歩(77)', '３四歩(33)', '２六歩(27)']));
    await page.getByTestId('kif-paste-read').click();
    await expect(page.getByTestId('kif-paste-moves')).toHaveText('3 手：▲７六歩 △３四歩 ▲２六歩');
    // 自分の側の初期値：戦型が無ければ最後の手を指した側（先手）
    await expect(page.getByTestId('kif-paste-side-black')).toHaveAttribute('aria-checked', 'true');
    await page.getByTestId('kif-paste-add').click();
    await expect(page).toHaveURL(/#\/book\/[^/]+\/s-[\w-]+\/3$/);
    await expect(page.getByTestId('book-title')).toHaveText('定跡帳平手から（先手番）');
    await expect(page.getByTestId('study-title')).toHaveText('▲７六歩 △３四歩 ▲２六歩');
    await expect(page.getByTestId('study-position')).toHaveText('3手目 ▲２六歩');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);

    // 一覧に出る
    await page.getByRole('button', { name: '‹ 一覧' }).click();
    await page.getByTestId('tab-studies').click();
    await expect(page.getByTestId('study-count')).toHaveText('研究手順 1 本');
    await expect(page.getByTestId('book-group')).toHaveText([/その他（先手番）\s*研究 1本/]);
    const item = (await openStudyList(page)).getByTestId('study-item');
    await expect(item).toHaveCount(1);
    await expect(item).toContainText('▲７六歩 △３四歩 ▲２六歩');
    await expect(item).toContainText('3 手');

    // 開く（定跡帳の、その研究手順の終わりの局面）
    await item.click();
    await expect(page.getByTestId('study-position')).toHaveText('3手目 ▲２六歩');
    // 段階20-3：定跡帳の ⋯ から「ツリーを作る」「ツリーで見る」と 1 本ずつの JSON・KIF で渡すを外した
    await page.getByTestId('book-menu').click();
    await expect(page.getByTestId('book-menu-dialog')).toBeVisible();
    await expect(page.getByTestId('study-make-tree')).toHaveCount(0);
    await expect(page.getByTestId('study-open-tree')).toHaveCount(0);
    await expect(page.getByTestId('study-share-json')).toHaveCount(0);
    await expect(page.getByTestId('study-copy-kif')).toBeVisible();
    await closeDialog(page);
    // 前後に動かす
    await page.getByTestId('study-prev').click();
    await expect(page.getByTestId('study-position')).toHaveText('2手目 △３四歩');
    await page.getByTestId('study-prev').click();
    await expect(page.getByTestId('study-position')).toHaveText('1手目 ▲７六歩');
    await page.getByTestId('study-next').click();
    await expect(page.getByTestId('study-position')).toHaveText('2手目 △３四歩');
  });

  test('棋譜を貼って登録：戦型の後の手順で名前を付ける。同じ手順・平手以外・戦型の出発点そのものは足さない', async ({ page }) => {
    await openHome(page);
    await page.getByTestId('tab-studies').click();
    const yokofu = ['７六歩(77)', '３四歩(33)', '２六歩(27)', '８四歩(83)', '２五歩(26)', '８五歩(84)', '７八金(69)', '３二金(41)', '２四歩(25)', '同　歩(23)', '同　飛(28)', '８六歩(85)', '同　歩(87)', '同　飛(82)', '３四飛(24)', '３三角(22)', '３六飛(34)'];
    const paste = async (kif: string) => {
      await page.getByTestId('study-register').click();
      await page.getByTestId('study-register-paste').click();
      await page.getByTestId('kif-paste-input').fill(kif);
      await page.getByTestId('kif-paste-read').click();
    };
    // 出発点の戦型は、自分の側が同じ戦型のうちいちばん浅いもの（段階10 の直し）：先手番なら基本図、後手番なら △3三角（後手番）
    await paste(KIF('平手', [...yokofu, '８四飛(86)']));
    await expect(page.getByTestId('kif-paste-side-black')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('kif-paste-moves')).toHaveText('18 手：横歩取り 基本図（▲3四飛まで） → △３三角 ▲３六飛 △８四飛');
    await page.getByTestId('kif-paste-side-white').click();
    await expect(page.getByTestId('kif-paste-moves')).toHaveText('18 手：横歩取り △3三角（後手番） → ▲３六飛 △８四飛');
    await page.getByTestId('kif-paste-add').click();
    await expect(page.getByTestId('book-title')).toHaveText('定跡帳横歩取り（後手番）');
    await expect(page.getByTestId('study-title')).toHaveText('▲３六飛 △８四飛');

    // 同じ手順：足さずに知らせ、定跡帳で開ける
    await page.getByRole('button', { name: '‹ 一覧' }).click();
    await page.getByTestId('tab-studies').click();
    await paste(KIF('平手', [...yokofu, '８四飛(86)']));
    await page.getByTestId('kif-paste-add').click();
    await expect(page.getByTestId('kif-paste-exists')).toContainText('研究手順「▲３六飛 △８四飛」としてすでにあります');
    await page.getByTestId('kif-paste-open-existing').click();
    await expect(page.getByTestId('study-title')).toHaveText('▲３六飛 △８四飛');

    // 戦型の出発点そのもの（先手番の基本図ちょうど）・香落ちは足さない
    await page.getByRole('button', { name: '‹ 一覧' }).click();
    await page.getByTestId('tab-studies').click();
    await paste(KIF('平手', yokofu.slice(0, 15)));
    await expect(page.getByTestId('kif-paste-message')).toContainText('戦型の出発点そのものは研究手順にできません');
    await page.getByTestId('kif-paste-input').fill(KIF('香落ち', ['３四歩(33)', '７六歩(77)']));
    await page.getByTestId('kif-paste-read').click();
    await expect(page.getByTestId('kif-paste-message')).toContainText('平手の初期局面から始まる手順だけ');
    await closeDialog(page);
    await expect(page.getByTestId('study-count')).toHaveText(`研究手順 ${1} 本`);
  });
});

test.describe('8-1 稽古', () => {
  test('研究手順の稽古（段階19 で復習から置きかえ）が、ツリーなしの研究手順で動く（1 本・グループ・定跡帳から）', async ({ page }) => {
    await openHome(page);
    await importStudies(page, [
      study('s-1', '研究1', ['7g7f', '3c3d', '2g2f', '8c8d'], { note: 'メモの 1 行目\n2 行目', updatedAt: 3 }),
      study('s-2', '研究2', ['2g2f', '8c8d'], { updatedAt: 2 }),
    ]);
    const list = await openStudyList(page);
    await expect(list.getByTestId('study-item')).toHaveText([/研究1/, /研究2/]);
    await list.getByTestId('study-menu').first().click();
    await page.getByTestId('study-menu-review').click();
    await expect(page).toHaveURL(/#\/practice\/play\/s-1$/);
    // 相手の ▲7六歩 はアプリが指す → △3四歩（正解）→ ▲2六歩 → △1四歩（まちがい）→ 正解の △8四歩 を指して続く
    await expect(page.getByTestId('practice-card')).toHaveAttribute('data-phase', 'ask');
    await expect(page.getByTestId('practice-card')).toContainText('相手は ▲７六歩');
    await play(page, '33', '34');
    await expect(page.getByTestId('practice-card')).toContainText('相手は ▲２六歩');
    await play(page, '13', '14');
    await expect(page.getByTestId('practice-wrong')).toContainText('△１四歩 ではありません');
    await play(page, '83', '84');
    await expect(page.getByTestId('practice-end')).toContainText('4手目 △８四歩');
    await expect(page.getByTestId('practice-next')).toHaveText('終わる');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);

    // グループ（その他）の研究手順を稽古
    await page.goto('./#/');
    await page.getByTestId('book-group-open').click();
    await page.getByTestId('book-menu').click();
    await page.getByTestId('book-review').click();
    await expect(page).toHaveURL(/#\/practice\/group\//);
    await expect(page.getByTestId('practice-title')).toContainText('稽古 1／2本');

    // 定跡帳の ⋯ から
    await page.goto('./#/');
    await (await openStudyList(page)).getByTestId('study-item').filter({ hasText: '研究2' }).click();
    await expect(page.getByTestId('book-title')).toBeVisible();
    await page.getByTestId('book-menu').click();
    await page.getByTestId('book-study-review').click();
    await expect(page).toHaveURL(/#\/practice\/play\/s-2$/);
    await expect(page.getByTestId('practice-card')).toContainText('相手は ▲２六歩');
    await play(page, '83', '84');
    await expect(page.getByTestId('practice-end')).toContainText('全部正解');
  });
});

test.describe('8-1 書き出し・取り込み', () => {
  test('選んで KIF に書き出す。JSON の取り込みで同じ手順があれば、置き換える・両方残す・取り込まないを選ぶ', async ({ page }) => {
    await openHome(page);
    await importStudies(page, [study('s-1', '研究1', ['7g7f', '3c3d'], { note: 'メモ1' }), study('s-2', '研究2', ['2g2f', '8c8d'])]);
    await expect(page.getByTestId('study-count')).toHaveText(`研究手順 ${2} 本`);

    // 段階20-3：書き出しは定跡帳のタブの右上から、設定の「データ」へ移した
    await expect(page.getByTestId('study-export-open')).toHaveCount(0);
    await page.getByTestId('tab-settings').click();
    await page.getByTestId('settings-row-data').click();
    await page.getByTestId('study-export-open').click();
    await expect(page.getByTestId('study-export-count')).toContainText('2 本');
    await page.getByTestId('study-export-none').click();
    await expect(page.getByTestId('study-export-kif')).toBeDisabled();
    await page.getByTestId('study-export-check').first().click();
    await expect(page.getByTestId('study-export-count')).toContainText('1 本');
    await page.getByTestId('study-export-all').click();
    const [kif] = await Promise.all([page.waitForEvent('download'), page.getByTestId('study-export-kif').click()]);
    expect(kif.suggestedFilename()).toMatch(/\.kifu$/);
    const kifText = readFileSync((await kif.path())!, 'utf8');
    expect(kifText).toContain('手合割：平手');
    expect(kifText).toContain('*★研究1');
    expect(kifText).toContain('*メモ1');
    expect(kifText).toContain('変化：1手');
    await closeDialog(page);

    // 同じ手順で名前の違う研究手順を取り込む → 両方残す
    await importStudies(page, [study('x-1', '研究1（仲間）', ['7g7f', '3c3d'])]);
    await expect(page.getByTestId('study-import-conflict')).toContainText('「研究1（仲間）」（今は「研究1」）');
    await page.getByTestId('study-import-both').click();
    await expect(page.getByTestId('home-message')).toContainText('研究手順 1 本を取り込みました');
    await expect(page.getByTestId('study-count')).toHaveText(`研究手順 ${3} 本`);
    // 置き換える
    await importStudies(page, [study('x-2', '研究2（直した）', ['2g2f', '8c8d'])]);
    await page.getByTestId('study-import-replace').click();
    await expect(page.getByTestId('study-count')).toHaveText(`研究手順 ${3} 本`);
    await expect((await openStudyList(page)).getByTestId('study-item').filter({ hasText: '研究2（直した）' })).toHaveCount(1);
    await page.goto('./#/');
    // 取り込まない・まったく同じものは黙って飛ばす
    await importStudies(page, [study('x-3', '研究2（また別）', ['2g2f', '8c8d']), study('s-1', '研究1', ['7g7f', '3c3d'], { note: 'メモ1' })]);
    await page.getByTestId('study-import-skip').click();
    await expect(page.getByTestId('home-message')).toContainText('まったく同じもの 1 本は飛ばしました');
    await expect(page.getByTestId('home-message')).toContainText('同じ手順の 1 本は取り込みませんでした');
    await expect(page.getByTestId('study-count')).toHaveText(`研究手順 ${3} 本`);
  });
});

test.describe('8-1 移し替え（段階7の研究手順 → 独立した研究手順）', () => {
  test('版 3 の端末のツリーの中の研究手順を、1 回だけ移す（消えない・二重にならない・記録も写す）。平手から始まらないツリーの分は残す', async ({ page }) => {
    await openHome(page);
    const a = lineTree('tree-a', 'ツリーA', [
      { id: 's-1', name: '古い名前', note: '古いメモ', moves: ['7g7f', '3c3d', '2g2f'], createdAt: 1, updatedAt: 10 },
      { id: 's-2', name: '研究2', note: '', moves: ['2g2f', '8c8d'], createdAt: 1, updatedAt: 5 },
    ]);
    const b = lineTree('tree-b', 'ツリーB', [{ id: 's-dup', name: '新しい名前', note: '新しいメモ', moves: ['7g7f', '3c3d', '2g2f'], createdAt: 2, updatedAt: 20 }]);
    const c = lineTree('tree-c', '途中から', [{ id: 's-c', name: '途中の研究', note: '', moves: ['7g7f'], createdAt: 1, updatedAt: 1 }]);
    c.prefix = { initialSfen: applyUsiMove(STARTPOS_SFEN, '5g5f')!.sfen, moves: [] };
    // ツリーAの復習の記録：▲7六歩の後（△3四歩が本線）を 2 回続けて正解
    const after76 = sfenKey(applyUsiMove(STARTPOS_SFEN, '7g7f')!.sfen);
    const review = [{ treeId: 'tree-a', version: 1, nodes: { [after76]: { seen: 2, correct: 2, streak: 2, lastOk: true, lastAt: 5 } } }];

    // 端末の保存場所を、版 3（段階7）の形で作り直す
    await page.evaluate(
      async ({ trees, review }) => {
        await new Promise<void>((resolve, reject) => {
          const r = indexedDB.deleteDatabase('joban-tree');
          r.onsuccess = () => resolve();
          r.onerror = () => reject(r.error);
        });
        await new Promise<void>((resolve, reject) => {
          const r = indexedDB.open('joban-tree', 3);
          r.onupgradeneeded = () => {
            const db = r.result;
            db.createObjectStore('trees', { keyPath: 'id' });
            db.createObjectStore('review', { keyPath: 'treeId' });
            db.createObjectStore('templates', { keyPath: 'id' });
          };
          r.onsuccess = () => {
            const db = r.result;
            const tx = db.transaction(['trees', 'review'], 'readwrite');
            for (const t of trees) tx.objectStore('trees').put(t);
            for (const x of review) tx.objectStore('review').put(x);
            tx.oncomplete = () => {
              db.close();
              resolve();
            };
            tx.onerror = () => reject(tx.error);
          };
          r.onerror = () => reject(r.error);
        });
      },
      { trees: [a, b, c], review },
    );

    // 新しい版で開く → 移し替え
    await page.reload();
    await expect(page.getByTestId('home-message')).toContainText('研究手順 2 本を「研究手順」の一覧に移しました');
    await expect(page.getByTestId('home-message')).toContainText('途中の局面から始まるツリーの研究手順 1 本は移せませんでした');
    await page.getByTestId('tab-studies').click();
    await expect(page.getByTestId('study-count')).toHaveText('研究手順 2 本');
    const moved = await openStudyList(page);
    await expect(moved.getByTestId('study-item')).toHaveText([/新しい名前/, /研究2/]);
    await page.goto('./#/');

    // もう一度開いても増えない・知らせも出ない
    await page.reload();
    await expect(page.getByTestId('study-count')).toHaveText(`研究手順 ${2} 本`);
    await expect(page.getByTestId('home-message')).toHaveCount(0);

    // メモは両方残る。記録も写っている（▲7六歩の後の △3四歩 は「覚えた」）
    expect(await savedNote(page, '新しい名前')).toBe('新しいメモ\n――\n古いメモ');
    // 復習の記録は研究手順用の記録へ写っている（▲7六歩の後の △3四歩）。ツリーは消えず、研究手順を外して残る
    const stored = await page.evaluate(
      () =>
        new Promise<{ trees: { id: string; studies?: unknown[] }[]; review: { treeId: string; nodes: Record<string, { lastOk: boolean }> }[] }>((resolve, reject) => {
          const open = indexedDB.open('joban-tree');
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const tx = open.result.transaction(['trees', 'review'], 'readonly');
            const trees = tx.objectStore('trees').getAll();
            const review = tx.objectStore('review').getAll();
            tx.oncomplete = () => {
              open.result.close();
              resolve({ trees: trees.result, review: review.result });
            };
          };
        }),
    );
    expect(stored.trees.map((t) => [t.id, t.studies?.length ?? 0])).toEqual([
      ['tree-a', 0],
      ['tree-b', 0],
      ['tree-c', 1],
    ]);
    expect(stored.review.find((r) => r.treeId === 'studies')?.nodes[`${after76}>3c3d`]?.lastOk).toBe(true);
    expect(stored.review.find((r) => r.treeId === 'tree-a')).toBeTruthy();
  });

});

// ---- 段階8-2：変化付き KIF からまとめて取り込む ----

const KIF_HEAD = ['# KIF形式棋譜ファイル Generated by ShogiHome', '手合割：平手', '手数----指手---------消費時間--'];
const kmv = (n: number, m: string, branch = false) => `${String(n).padStart(4)} ${m}   ( 0:00/00:00:00)${branch ? '+' : ''}`;
/** 本譜・変化・変化の中の変化とコメント（ShogiHome の「#」で始まる解析のコメント入り） */
const NESTED_KIF = [
  ...KIF_HEAD,
  kmv(1, '７六歩(77)'),
  '*#評価値=30',
  '*初手は角道',
  kmv(2, '３四歩(33)'),
  kmv(3, '２六歩(27)', true),
  kmv(4, '８四歩(83)'),
  '',
  '変化：3手',
  kmv(3, '６六歩(67)'),
  kmv(4, '８四歩(83)', true),
  '*△8四歩なら',
  kmv(5, '６八飛(28)'),
  '',
  '変化：4手',
  kmv(4, '６二銀(71)'),
  kmv(5, '５六歩(57)'),
  '',
].join('\n');

/** 文字を Shift_JIS のバイトにする（テスト用。Node の TextDecoder の表を逆に引く） */
function toShiftJis(text: string): Buffer {
  const table = new Map<string, number[]>();
  const dec = new TextDecoder('shift_jis');
  for (let hi = 0x81; hi <= 0xef; hi++) {
    if (hi > 0x9f && hi < 0xe0) continue;
    for (let lo = 0x40; lo <= 0xfc; lo++) {
      const ch = dec.decode(new Uint8Array([hi, lo]));
      if (ch.length === 1 && ch !== '�' && !table.has(ch)) table.set(ch, [hi, lo]);
    }
  }
  const bytes: number[] = [];
  for (const ch of text) {
    if (ch.charCodeAt(0) < 0x80) bytes.push(ch.charCodeAt(0));
    else bytes.push(...(table.get(ch) ?? [0x3f]));
  }
  return Buffer.from(bytes);
}

test.describe('8-2 変化付き KIF からまとめて取り込む', () => {
  test('貼り付け → 確認の画面（本数・名前・手数・すでにあり・自分の側）→ 取り込み → 一覧に出る', async ({ page }) => {
    await openHome(page);
    await importStudies(page, [study('s-main', '前から登録した本譜', ['7g7f', '3c3d', '2g2f', '8c8d'])]);
    await page.getByTestId('study-register').click();
    await page.getByTestId('study-register-kif').click();
    await expect(page).toHaveURL(/#\/study-import$/);
    await page.getByTestId('kif-bulk-input').fill(NESTED_KIF);
    await page.getByTestId('kif-bulk-read').click();

    await expect(page.getByTestId('kif-bulk-summary')).toHaveText('3 本の研究手順になります（同じ手順がすでにある 1 本は外してあります）。');
    const rows = page.getByTestId('kif-bulk-row');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText('▲７六歩 △３四歩 ▲２六歩 △８四歩');
    await expect(rows.nth(0)).toContainText('4 手');
    await expect(rows.nth(0)).not.toContainText('メモあり');
    await expect(rows.nth(0).getByTestId('kif-bulk-exists')).toHaveText('すでにあり');
    await expect(rows.nth(0).getByTestId('kif-bulk-check')).not.toBeChecked();
    await expect(rows.nth(1)).toContainText('▲７六歩 … 3手目 ▲６六歩 … ▲６八飛');
    await expect(rows.nth(1).getByTestId('kif-bulk-check')).toBeChecked();
    await expect(rows.nth(2)).toContainText('▲７六歩 … 4手目 △６二銀 … ▲５六歩');
    await expect(rows.nth(2)).toContainText('5 手');
    // 自分の側：本譜の最後の手を指した側（後手）。まとめて先手に切り替える
    await expect(page.getByTestId('kif-bulk-side-white')).toHaveAttribute('aria-checked', 'true');
    await page.getByTestId('kif-bulk-side-black').click();
    await expect(page.getByTestId('kif-bulk-import')).toHaveText('2 本を取り込む');
    // 全部外すと取り込めない。全部選ぶと 3 本
    await page.getByTestId('kif-bulk-none').click();
    await expect(page.getByTestId('kif-bulk-import')).toBeDisabled();
    await page.getByTestId('kif-bulk-all').click();
    await expect(page.getByTestId('kif-bulk-import')).toHaveText('3 本を取り込む');
    await rows.nth(0).getByTestId('kif-bulk-check').click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);

    await page.getByTestId('kif-bulk-import').click();
    await expect(page).toHaveURL(/#\/$/);
    await expect(page.getByTestId('home-message')).toHaveText('研究手順 2 本を KIF から取り込みました（1 本は取り込みませんでした）');
    await expect(page.getByTestId('tab-studies')).toHaveAttribute('aria-current', 'page');
    // 「その他」は自分の側で分かれる（後手番 → 先手番。段階10-1）
    await expect(page.getByTestId('book-group')).toHaveText([/その他（後手番）\s*研究 1本/, /その他（先手番）\s*研究 2本/]);
    await expect((await openStudyList(page, '後手番')).getByTestId('study-item')).toHaveText([/前から登録した本譜/]);
    await expect((await openStudyList(page, '先手番')).getByTestId('study-item')).toHaveText([/3手目 ▲６六歩/, /4手目 △６二銀/]);

    // メモ：その変化の終わりまでの手のコメントを手数付きで。「#」の行は入らない
    await (await openStudyList(page, '先手番')).getByTestId('study-item').filter({ hasText: '3手目 ▲６六歩' }).click();
    await expect(page.getByTestId('study-position')).toBeVisible();
    expect(await savedNote(page, '3手目 ▲６六歩')).toBe('1手目 ▲７六歩：初手は角道\n4手目 △８四歩：△8四歩なら');
    await expect(page.getByTestId('book-title')).toContainText('平手から（先手番）');
  });

  test('ファイルを選んで取り込む（Shift_JIS の .kif も読める）。平手以外は理由を出して取り込まない', async ({ page }) => {
    await openHome(page);
    await page.goto('./#/study-import');
    await page.getByTestId('kif-bulk-file').setInputFiles({ name: '研究.kif', mimeType: 'text/plain', buffer: toShiftJis(NESTED_KIF) });
    await expect(page.getByTestId('kif-bulk-summary')).toContainText('3 本の研究手順になります');
    await expect(page.getByTestId('kif-bulk-row').nth(1)).toContainText('3手目 ▲６六歩');

    await page.getByTestId('kif-bulk-again').click();
    await page.getByTestId('kif-bulk-input').fill(['手合割：香落ち', '手数----指手---------消費時間--', kmv(1, '３四歩(33)'), ''].join('\n'));
    await page.getByTestId('kif-bulk-read').click();
    await expect(page.getByTestId('kif-bulk-error')).toContainText('平手の初期局面から始まる棋譜だけ取り込めます');
    await expect(page.getByTestId('kif-bulk-row')).toHaveCount(0);
  });

  test('多いとき（120 本）も取り込める', async ({ page }) => {
    await openHome(page);
    // 1 手目 10 通り × 2 手目 12 通り＝ 120 本の変化（tsshogi で変化付きの KIF を作る）
    const firsts = ['7g7f', '2g2f', '5g5f', '6g6f', '1g1f', '9g9f', '4g4f', '3g3f', '8g8f', '5i5h'];
    const seconds = ['3c3d', '8c8d', '5c5d', '6c6d', '1c1d', '9c9d', '4c4d', '7c7d', '2c2d', '5a5b', '4a3b', '6a5b'];
    const record = new KifRecord(Position.newBySFEN(STARTPOS_SFEN)!);
    for (const a of firsts) {
      for (const b of seconds) {
        record.goto(0);
        for (const usi of [a, b]) record.append(record.position.createMoveByUSI(usi)!);
      }
    }
    const kif = exportKIF(record);
    await page.goto('./#/study-import');
    await page.getByTestId('kif-bulk-input').fill(kif);
    await page.getByTestId('kif-bulk-read').click();
    await expect(page.getByTestId('kif-bulk-summary')).toContainText('120 本の研究手順になります', { timeout: 15_000 });
    await expect(page.getByTestId('kif-bulk-import')).toHaveText('120 本を取り込む');
    await page.getByTestId('kif-bulk-import').click();
    await expect(page.getByTestId('home-message')).toContainText('研究手順 120 本を KIF から取り込みました');
    await expect(page.getByTestId('study-count')).toHaveText('研究手順 120 本');
  });
});
