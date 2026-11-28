// 段階17（v0.41.0）：データを守る（持ち主の依頼書 stage17-prompt・判断 2026-11-23「おすすめの通りで」）
// - 設定の「データ」：データの保護の表示、［バックアップを保存］→ 全部消す →［バックアップから戻す］で研究手順（メモ）・前の版のツリーと復習の記録・局面メモ・候補の理由・戦型・設定が元どおり
// - 戻す前のデータは端末の中に取っておき、［戻す前のデータに戻す］で元に戻せる
// - おかしいファイルは断る。定跡帳の一覧の上の「しばらくバックアップしていません」（閉じたら 30 日は出さない）
import { openSettings } from './settings';
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { STARTPOS_SFEN, applyUsiMove, sfenKey } from '../src/shogi/position';
import { TREE_APP, TREE_FORMAT_VERSION, type Study, type TreeData, type TreeNode } from '../src/tree/types';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

const DAY = 24 * 60 * 60 * 1000;

const STUDIES: Study[] = [
  { id: 's-a', name: '横歩の手前', note: 'メモA', moves: '7g7f 3c3d 2g2f 8c8d 2f2e 8d8e 6i7h 4a3b 2e2d 2c2d 2h2d'.split(' '), mySide: 'black', createdAt: 1, updatedAt: 3 },
  { id: 's-b', name: '銀を上がる', note: '', moves: '7g7f 3c3d 2g2f 8c8d 2f2e 8d8e 6i7h 4a3b 3i3h'.split(' '), mySide: 'black', createdAt: 1, updatedAt: 2 },
];

function tree(): TreeData {
  const sfen = applyUsiMove(STARTPOS_SFEN, '7g7f')!.sfen;
  const nodes: Record<string, TreeNode> = {};
  const add = (s: string) => (nodes[sfenKey(s)] ??= ({ key: sfenKey(s), sfen: s, round: 0, edges: [] }) as TreeNode);
  const root = add(sfen);
  const to = add(applyUsiMove(sfen, '3c3d')!.sfen);
  root.edges.push({ move: '3c3d', to: to.key, score: { kind: 'cp', value: 40 }, diff: 0 } as never);
  return {
    app: TREE_APP, version: TREE_FORMAT_VERSION, id: 'bk-tree', name: '▲7六歩からの対策', createdAt: 1, updatedAt: 1, mySide: 'black',
    rootKey: root.key, prefix: { initialSfen: STARTPOS_SFEN, moves: ['7g7f'] }, nodes,
    settings: { totalMs: 120_000, movetimeMs: 1500, multiPV: 4, maxRounds: 4, maxNodes: 3000, windowCp: 300, replyMs: 1000, dubiousCp: 150 },
  } as TreeData;
}

async function openHome(page: Page) {
  await page.goto('./');
  await expect(page.getByTestId('isolation')).toHaveAttribute('data-state', 'isolated', { timeout: 30_000 });
}

/** 端末の保存場所に直接書く（復習の記録・自分で登録した戦型） */
async function putRecords(page: Page, store: string, list: unknown[]) {
  await page.evaluate(
    ({ store, list }) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('joban-tree');
        open.onsuccess = () => {
          const tx = open.result.transaction(store, 'readwrite');
          for (const item of list) tx.objectStore(store).put(item);
          tx.oncomplete = () => {
            open.result.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
        open.onerror = () => reject(open.error);
      }),
    { store, list },
  );
}

/** 今のデータ全部（5 つの保存場所の中身と、バックアップに入れる端末の設定）。並びは id でそろえる */
async function dump(page: Page) {
  return page.evaluate(
    () =>
      new Promise<Record<string, unknown>>((resolve, reject) => {
        const open = indexedDB.open('joban-tree');
        open.onsuccess = () => {
          const names = ['studies', 'trees', 'review', 'templates', 'positions'];
          const tx = open.result.transaction(names);
          const out: Record<string, unknown> = {};
          for (const n of names) {
            const r = tx.objectStore(n).getAll();
            r.onsuccess = () => {
              out[n] = (r.result as { id?: string; treeId?: string }[]).sort((a, b) => String(a.id ?? a.treeId).localeCompare(String(b.id ?? b.treeId)));
            };
          }
          tx.oncomplete = () => {
            open.result.close();
            const prefs: Record<string, string | null> = {};
            for (const k of ['joban-tree.settings', 'joban-tree:book-write']) prefs[k] = localStorage.getItem(k);
            out.prefs = prefs;
            resolve(out);
          };
          tx.onerror = () => reject(tx.error);
        };
        open.onerror = () => reject(open.error);
      }),
  );
}

/** 全部消す（5 つの保存場所を空に、端末の設定も消す） */
async function wipe(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('joban-tree');
        open.onsuccess = () => {
          const names = ['studies', 'trees', 'review', 'templates', 'positions'];
          const tx = open.result.transaction(names, 'readwrite');
          for (const n of names) tx.objectStore(n).clear();
          tx.oncomplete = () => {
            open.result.close();
            for (const k of ['joban-tree.settings', 'joban-tree:book-write']) localStorage.removeItem(k);
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
        open.onerror = () => reject(open.error);
      }),
  );
}

async function seed(page: Page) {
  await openHome(page);
  await page.getByTestId('study-import-file').setInputFiles({
    name: 's.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ app: 'joban-tree', kind: 'studies', version: 1, studies: STUDIES })),
  });
  await expect(page.getByTestId('study-count')).toHaveText(`研究手順 ${2} 本`);
  // 前の版のツリー（画面は無いが、データは持ち運ぶ）は保存場所に直接入れる
  await putRecords(page, 'trees', [tree()]);
  await putRecords(page, 'review', [
    { treeId: 'bk-tree', version: 1, nodes: { k1: { seen: 2, correct: 1, streak: 1, lastOk: true, lastAt: 5 } } },
    { treeId: 'studies', version: 1, nodes: { k2: { seen: 1, correct: 0, streak: 0, lastOk: false, lastAt: 6 } } },
  ]);
  await putRecords(page, 'templates', [
    { id: 'my-x', name: '自分の戦型', group: '横歩取り', mySide: 'white', moves: ['7g7f', '3c3d'], note: '', reviewed: true, createdAt: 3, updatedAt: 4 },
  ]);
  // 局面メモと、理由の入った候補の表
  const key = sfenKey(applyUsiMove(STARTPOS_SFEN, '7g7f')!.sfen);
  await putRecords(page, 'positions', [
    { id: `white|${key}`, side: 'white', key, note: '局面メモの中身', candidates: [{ move: '3c3d', mark: 'main', reason: '角道を開ける理由' }], updatedAt: 7 },
  ]);
  // 設定：定跡帳の「盤で指して書き込む」を切に。画面から消したツリーの設定（復習の 1 回は 5 問）もバックアップで運ぶ
  await page.evaluate(() => {
    localStorage.setItem('joban-tree:book-write', 'off');
    localStorage.setItem('joban-tree.settings', JSON.stringify({ version: 1, reviewBatch: 5, windowCp: 250 }));
  });
}

test.describe('段階17 データを守る', () => {
  test('設定の「データ管理」：保護の表示、バックアップを保存 → 全部消す → 戻す で元どおり。戻す前のデータにも戻せる', async ({ page }) => {
    await seed(page);
    const before = await dump(page);
    expect((before.studies as unknown[]).length).toBe(2);

    await openSettings(page, 'data');
    const section = page.getByTestId('data-section');
    await expect(section).toBeVisible();
    // データの保護：守られているかどうかを出す（守られていなければ説明）
    await expect(page.getByTestId('persist-state')).not.toHaveText('…');
    const state = await page.getByTestId('persist-state').getAttribute('data-state');
    if (state !== 'persisted') await expect(page.getByTestId('persist-help')).toContainText('ホーム画面に追加して開くと守られやすく');
    await expect(page.getByTestId('last-backup')).toHaveText('まだありません');

    // 保存（この PC の Chrome は共有できないのでダウンロード）
    const save = page.getByTestId('backup-save');
    await expect(save).toBeEnabled();
    await expect(save).toContainText('バックアップを保存（約');
    const [download] = await Promise.all([page.waitForEvent('download'), save.click()]);
    expect(download.suggestedFilename()).toMatch(/^将棋定跡帳-バックアップ-\d{4}-\d{2}-\d{2}-\d{4}\.json$/);
    const text = readFileSync((await download.path())!, 'utf8');
    const file = JSON.parse(text);
    expect(file).toMatchObject({ app: 'joban-tree', kind: 'backup', version: 1 });
    expect(file.data.studies).toHaveLength(2);
    expect(file.data.trees).toHaveLength(1);
    expect(file.data.reviews).toHaveLength(2);
    expect(file.data.templates).toHaveLength(1);
    // 画面に無いものも、そのままファイルに入る
    expect(file.data.trees[0]).toEqual(JSON.parse(JSON.stringify(tree())));
    expect(file.data.studies.find((x: Study) => x.id === 's-a').note).toBe('メモA');
    expect(file.data.positions[0]).toMatchObject({ note: '局面メモの中身', candidates: [{ reason: '角道を開ける理由' }] });
    await expect(page.getByTestId('backup-message')).toContainText('ダウンロードしました');
    await expect(page.getByTestId('last-backup')).not.toHaveText('まだありません');

    // 全部消す
    await wipe(page);
    await page.goto('./');
    await page.reload();
    await expect(page.getByTestId('study-count')).toHaveText(`研究手順 ${0} 本`);

    // 戻す：中身の数を見せて、置きかえることを確かめてから
    await openSettings(page, 'data');
    await page.getByTestId('backup-restore-file').setInputFiles({ name: 'b.json', mimeType: 'application/json', buffer: Buffer.from(text) });
    const dialog = page.getByTestId('backup-restore-dialog');
    await expect(dialog).toBeVisible();
    const summary = page.getByTestId('backup-restore-summary');
    await expect(summary).toContainText('研究手順 2 本');
    await expect(summary).toContainText('ツリー 1 本');
    await expect(summary).toContainText('復習の記録 2 問');
    await expect(summary).toContainText('自分で登録した戦型 1 個');
    await expect(summary).toContainText('全部このデータに置きかわります');
    await Promise.all([page.waitForEvent('load'), page.getByTestId('backup-restore-confirm').click()]);
    await expect(page.getByTestId('data-section')).toBeVisible();
    expect(await dump(page)).toEqual(before);
    // 戻した後にもう一度保存したファイルにも、同じものが入っている
    await openSettings(page, 'data');
    await expect(page.getByTestId('backup-save')).toBeEnabled();
    const [again] = await Promise.all([page.waitForEvent('download'), page.getByTestId('backup-save').click()]);
    const file2 = JSON.parse(readFileSync((await again.path())!, 'utf8'));
    expect(file2.data).toEqual(file.data);
    await page.goto('./');
    await expect(page.getByTestId('study-count')).toHaveText(`研究手順 ${2} 本`);

    // 戻す前のデータ（全部消した状態）に戻せる。戻したら今のデータが、また戻す前のデータになる
    await openSettings(page, 'data');
    await page.getByTestId('snapshot-restore').click();
    await expect(page.getByTestId('backup-restore-summary')).toContainText('研究手順 0 本');
    await Promise.all([page.waitForEvent('load'), page.getByTestId('backup-restore-confirm').click()]);
    await page.goto('./');
    await expect(page.getByTestId('study-count')).toHaveText(`研究手順 ${0} 本`);
    await openSettings(page, 'data');
    await page.getByTestId('snapshot-restore').click();
    await expect(page.getByTestId('backup-restore-summary')).toContainText('研究手順 2 本');
    await Promise.all([page.waitForEvent('load'), page.getByTestId('backup-restore-confirm').click()]);
    expect(await dump(page)).toEqual(before);
  });

  test('おかしいファイル・新しい版のファイルは断り、データは変えない。知らない種類は知らせる', async ({ page }) => {
    await seed(page);
    const before = await dump(page);
    await openSettings(page, 'data');
    const pick = (obj: unknown) =>
      page.getByTestId('backup-restore-file').setInputFiles({ name: 'x.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(obj)) });
    await pick({ app: 'joban-tree', kind: 'studies', version: 1, studies: STUDIES });
    await expect(page.getByTestId('backup-error')).toContainText('バックアップのファイルではありません');
    await pick({ app: 'joban-tree', kind: 'backup', version: 2, createdAt: 1, appVersion: '9.0.0', data: {} });
    await expect(page.getByTestId('backup-error')).toContainText('新しい版のアプリで作ったバックアップです');
    await pick({ app: 'joban-tree', kind: 'backup', version: 1, createdAt: 1, appVersion: '0.41.0', data: { studies: [{ ...STUDIES[0], moves: ['7g7f', '7g7f'] }] } });
    await expect(page.getByTestId('backup-error')).toContainText('研究手順 1 本目');
    await expect(page.getByTestId('backup-restore-dialog')).toHaveCount(0);
    expect(await dump(page)).toEqual(before);
    // あとの段階の局面メモなど、この版が知らない種類があるファイル：戻せるが、それは入らないと知らせる（段階18 から games、段階19 から practice は知っている種類）
    await pick({ app: 'joban-tree', kind: 'backup', version: 1, createdAt: 1, appVersion: '0.44.0', data: { studies: STUDIES, games: [], practice: [], notes: [] } });
    await expect(page.getByTestId('backup-unknown')).toContainText('notes');
    await expect(page.getByTestId('backup-unknown')).not.toContainText('実戦の棋譜');
  });

  test('定跡帳の一覧の上の「しばらくバックアップしていません」：30 日以上で出し、閉じたら 30 日は出さない', async ({ page }) => {
    await openHome(page);
    const old = Date.now() - 40 * DAY;
    await page.getByTestId('study-import-file').setInputFiles({
      name: 's.json', mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ app: 'joban-tree', kind: 'studies', version: 1, studies: STUDIES.map((s) => ({ ...s, createdAt: old, updatedAt: old })) })),
    });
    await expect(page.getByTestId('study-count')).toHaveText(`研究手順 ${2} 本`);
    await page.reload();
    const nudge = page.getByTestId('backup-nudge');
    await expect(nudge).toBeVisible();
    const close = (await page.getByTestId('backup-nudge-close').boundingBox())!;
    expect(close.height).toBeGreaterThanOrEqual(44);
    // 設定で保存 → データ管理の下の画面へ。開いたらすぐ［バックアップを保存］が押せる
    await page.getByTestId('backup-nudge-open').click();
    await expect(page).toHaveURL(/#\/settings\/data$/);
    await expect(page.getByTestId('backup-save')).toBeEnabled();
    await page.goto('./');
    await page.getByTestId('backup-nudge-close').click();
    await expect(nudge).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId('study-count')).toHaveText(`研究手順 ${2} 本`);
    await expect(nudge).toHaveCount(0);
    // 最近バックアップしていれば出さない
    await page.evaluate(() => {
      localStorage.removeItem('joban-tree.backup-nudge-hidden-until');
      localStorage.setItem('joban-tree.last-backup', String(Date.now() - 1000));
    });
    await page.reload();
    await expect(page.getByTestId('study-count')).toHaveText(`研究手順 ${2} 本`);
    await expect(nudge).toHaveCount(0);
  });
});
