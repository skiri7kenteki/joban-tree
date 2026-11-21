// 段階12：デザインの刷新（C 案「対局室」）
// 12-1 色・文字・部品の土台：藍の地・生成りのカード・金の主なボタン・明朝体の見出し。全画面で文字と地の色の差を確かめる
import { expect, test, type Page } from '@playwright/test';
import { STARTPOS_SFEN, applyUsiMove, sfenKey } from '../src/shogi/position';
import { TREE_APP, TREE_FORMAT_VERSION, type Study, type TreeData, type TreeNode } from '../src/tree/types';

test.use({ viewport: { width: 360, height: 740 }, hasTouch: true });

async function openHome(page: Page) {
  await page.goto('./');
  await expect(page.getByTestId('isolation')).toHaveAttribute('data-state', 'isolated', { timeout: 30_000 });
}

async function closeDialog(page: Page) {
  await page.locator('dialog[open]').last().getByRole('button', { name: '閉じる' }).click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
}

const STUDIES: Study[] = [
  {
    id: 's-line',
    name: '横歩の手前',
    note: '飛車先を交換して、△8六歩に備える形',
    moves: '7g7f 3c3d 2g2f 8c8d 2f2e 8d8e 6i7h 4a3b 2e2d 2c2d 2h2d'.split(' '),
    mySide: 'black',
    createdAt: 1,
    updatedAt: 3,
  },
  {
    id: 's-line2',
    name: '銀を上がる',
    note: '急がずに',
    moves: '7g7f 3c3d 2g2f 8c8d 2f2e 8d8e 6i7h 4a3b 3i3h'.split(' '),
    mySide: 'black',
    createdAt: 1,
    updatedAt: 2,
  },
];

/** 開始局面（▲7六歩の後）で相手の応手 4 つ（本線・有力・疑問手）、それぞれに自分の対応 1 つ */
function sampleTree(): TreeData {
  const sfen = applyUsiMove(STARTPOS_SFEN, '7g7f')!.sfen;
  const nodes: Record<string, TreeNode> = {};
  const add = (s: string) => (nodes[sfenKey(s)] ??= ({ key: sfenKey(s), sfen: s, round: 0, edges: [] }) as TreeNode);
  const root = add(sfen);
  const link = (from: TreeNode, m: string, cp: number, diff?: number) => {
    const to = add(applyUsiMove(from.sfen, m)!.sfen);
    from.edges.push({ move: m, to: to.key, score: { kind: 'cp', value: cp }, ...(diff !== undefined ? { diff } : {}) } as never);
    return to;
  };
  for (const [m, cp, diff] of [
    ['3c3d', 40, 0],
    ['8c8d', 60, 20],
    ['4c4d', 90, 60],
    ['5c5d', 160, 170],
  ] as [string, number, number][]) {
    link(link(root, m, cp, diff), '2g2f', cp);
  }
  return {
    app: TREE_APP,
    version: TREE_FORMAT_VERSION,
    id: 'c-tree',
    name: '▲7六歩からの対策',
    createdAt: 1,
    updatedAt: 1,
    mySide: 'black',
    rootKey: root.key,
    prefix: { initialSfen: STARTPOS_SFEN, moves: ['7g7f'] },
    nodes,
    settings: { totalMs: 120_000, movetimeMs: 1500, multiPV: 4, maxRounds: 4, maxNodes: 3000, windowCp: 300, replyMs: 1000, dubiousCp: 150 },
  } as TreeData;
}

/**
 * 画面の文字のうち、地との色の差が足りないもの（「比 "文字" タグ.クラス」）。
 * 文字の後ろの色は、親をたどって重ねて求める。本文は 4.5:1、大きな文字（24px 以上・太字 18.66px 以上）は 3:1 が基準。
 * 押せないボタン・わざと薄くしたもの（opacity）・盤の中（SVG）の文字は除く
 */
async function lowContrast(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    type C = [number, number, number, number];
    const parse = (s: string): C | null => {
      const m = s.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
      return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1];
    };
    const over = (top: C, bottom: C): C => {
      const a = top[3];
      return [top[0] * a + bottom[0] * (1 - a), top[1] * a + bottom[1] * (1 - a), top[2] * a + bottom[2] * (1 - a), 1];
    };
    const lum = (c: C) => {
      const f = (v: number) => {
        const x = v / 255;
        return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
    };
    const bgOf = (el: Element): C => {
      const layers: C[] = [];
      for (let e: Element | null = el; e; e = e.parentElement) {
        const c = parse(getComputedStyle(e).backgroundColor);
        if (c && c[3] > 0) {
          layers.push(c);
          if (c[3] >= 1) break;
        }
      }
      let bg: C = layers.length > 0 && layers[layers.length - 1][3] >= 1 ? layers.pop()! : [255, 255, 255, 1];
      while (layers.length > 0) bg = over(layers.pop()!, bg);
      return bg;
    };
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      if (el.closest('svg, button:disabled, [aria-disabled="true"], fieldset:disabled')) continue;
      const own = Array.from(el.childNodes).some((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim() !== '');
      if (!own) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility !== 'visible') continue;
      let faded = false;
      for (let e: Element | null = el; e; e = e.parentElement) if (Number(getComputedStyle(e).opacity) < 1) faded = true;
      if (faded) continue;
      const bg = bgOf(el);
      const fg0 = parse(cs.color);
      if (!fg0) continue;
      const fg = fg0[3] < 1 ? over(fg0, bg) : fg0;
      const [a, b] = [lum(fg), lum(bg)];
      const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      const size = parseFloat(cs.fontSize);
      const large = size >= 24 || (size >= 18.66 && Number(cs.fontWeight) >= 700);
      if (ratio < (large ? 3 : 4.5)) {
        const cls = typeof (el as HTMLElement).className === 'string' ? (el as HTMLElement).className : '';
        out.push(`${ratio.toFixed(2)} "${(el.textContent ?? '').trim().slice(0, 16)}" ${el.tagName.toLowerCase()}.${cls}`);
      }
    }
    return out;
  });
}

test.describe('12-1 色・文字・部品の土台（段階13 で洗練）', () => {
  test('一覧は生成りの地に藍の見出しの帯、グループは 1 枚のカード、主なボタンは平らな金。盤の画面は藍の地で盤の下は生成り。下のタブと操作バーは濃い藍', async ({ page }) => {
    await openHome(page);
    await page.getByTestId('study-import-file').setInputFiles({
      name: 's.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ app: 'joban-tree', kind: 'studies', version: 1, studies: STUDIES })),
    });
    await expect(page.getByTestId('study-item')).toHaveCount(2);
    const style = (sel: string, prop: string) => page.locator(sel).first().evaluate((e, p) => getComputedStyle(e).getPropertyValue(p), prop);
    // 一覧の画面：本文の地は明るい生成り、見出しの帯と集計は藍
    expect(await style('.app', 'background-color')).toBe('rgb(243, 238, 227)');
    expect(await style('.list-header', 'background-color')).toBe('rgb(28, 39, 64)');
    expect(await style('.list-header h1', 'color')).toBe('rgb(243, 236, 220)');
    // グループは 1 枚のアイボリーのカード（行はカードの中で細い線で区切る。行に影は付けない）
    expect(await style('.tree-group', 'background-color')).toBe('rgb(255, 253, 248)');
    expect(await style('.tree-group .tree-row', 'box-shadow')).toBe('none');
    // 主なボタンは平らな金（グラデーション・影なし）
    expect(await style('[data-testid="study-register"]', 'background-color')).toBe('rgb(201, 165, 76)');
    expect(await style('[data-testid="study-register"]', 'background-image')).toBe('none');
    expect(await style('[data-testid="study-register"]', 'box-shadow')).toBe('none');
    expect(await style('h1', 'font-family')).toContain('Joban Mincho');
    expect(await style('.tabbar', 'background-color')).toBe('rgb(21, 29, 49)');
    expect(await style('.tabbar-tab.on', 'color')).toBe('rgb(226, 199, 125)');
    // 生成りの地には青海波を敷かない
    expect(await page.locator('.app').evaluate((e) => getComputedStyle(e, '::before').backgroundImage)).toBe('none');
    // 明朝体はアプリに入っている（端末に無くても出る）
    expect(await page.evaluate(() => document.fonts.check('600 21px "Joban Mincho"', '定跡帳'))).toBe(true);

    await page.getByTestId('study-item').first().click();
    await expect(page.getByTestId('study-position')).toBeVisible();
    // 盤の画面：藍の地（上に青海波をごく薄く）、盤の下の一覧は生成りの地
    expect(await style('.app', 'background-color')).toBe('rgb(28, 39, 64)');
    expect(await page.locator('.app').evaluate((e) => getComputedStyle(e, '::before').backgroundImage)).toContain("stroke-opacity='0.05'");
    expect(await style('.tree-side', 'background-color')).toBe('rgb(243, 238, 227)');
    expect(await style('.move-bar-fixed', 'background-color')).toBe('rgb(21, 29, 49)');
    expect(await style('.move-bar-btn', 'color')).toBe('rgb(243, 236, 220)');
  });

  test('全画面で、文字と地の色の差が足りる（本文 4.5:1、大きな文字 3:1）', async ({ page }) => {
    const found: string[] = [];
    const check = async (name: string) => {
      await page.waitForTimeout(150);
      for (const f of await lowContrast(page)) found.push(`${name}: ${f}`);
    };
    await openHome(page);
    await page.getByTestId('study-import-file').setInputFiles({
      name: 's.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ app: 'joban-tree', kind: 'studies', version: 1, studies: STUDIES })),
    });
    await expect(page.getByTestId('study-item')).toHaveCount(2);
    await check('定跡帳のタブ');
    await page.getByTestId('study-menu').first().click();
    await check('研究手順の行の ⋯');
    await closeDialog(page);
    await page.getByTestId('study-register').click();
    await check('研究手順を登録');
    await closeDialog(page);

    // 定跡帳（盤）と ⋯
    await page.getByTestId('study-item').first().click();
    await expect(page.getByTestId('study-position')).toBeVisible();
    for (let i = 0; i < 3; i++) await page.getByTestId('study-prev').click();
    await check('定跡帳');
    await page.getByTestId('book-menu').click();
    await check('定跡帳の ⋯');
    await closeDialog(page);

    // 研究手順の復習（まちがえた後のカードも）
    await page.goto('./#/study-review/s-line');
    await expect(page.getByTestId('review-progress')).toBeVisible();
    await check('復習');
    await page.locator('[data-square="17"]').click();
    await page.locator('[data-square="16"]').click();
    await expect(page.getByTestId('review-wrong')).toBeVisible();
    await check('復習（まちがえた後）');

    // ツリー
    await page.goto('./#/trees');
    await page.getByTestId('import-file').setInputFiles({ name: 't.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(sampleTree())) });
    await expect(page.getByTestId('tree-item')).toHaveCount(1);
    await check('ツリーのタブ');
    await page.getByTestId('tree-item').click();
    await expect(page.getByTestId('candidate')).toHaveCount(4);
    await check('ツリー');
    await page.getByTestId('tree-menu').click();
    await check('ツリーの ⋯');
    await closeDialog(page);

    // 新しいツリー・復習のタブ・設定
    await page.goto('./#/trees');
    await page.getByTestId('new-tree').click();
    await expect(page.getByRole('heading', { name: '新しいツリー' })).toBeVisible();
    await check('新しいツリー');
    await page.goto('./#/reviews');
    await check('復習のタブ');
    await page.goto('./#/settings');
    await check('設定');

    expect(found).toEqual([]);
  });
});

test.describe('12-2 盤と駒', () => {
  test('盤は木目と金の縁、駒は明朝体で影付き。選んだマスは藍に金の線。盤の大きさは前（v0.29.0）より小さくない', async ({ page }) => {
    await openHome(page);
    await page.goto('./#/trees');
    await page.getByTestId('new-tree').click();
    const board = page.getByTestId('board');
    await expect(board).toBeVisible();
    const css = (sel: string, prop: string) => page.locator(sel).first().evaluate((e, p) => getComputedStyle(e).getPropertyValue(p), prop);
    expect(await css('svg.board', 'background-image')).toContain('wood');
    // 盤のまわりは金の細い線 1 本（段階13）
    expect(await css('svg.board', 'box-shadow')).toContain('rgba(201, 165, 76, 0.55) 0px 0px 0px 1px');
    expect(await css('.piece-text', 'font-family')).toContain('Joban Koma');
    expect(await css('.board-coord', 'font-family')).toContain('Joban Mincho');
    // 影は駒と同じ数（初期配置は 40 枚）。CSS の filter は使わない
    await expect(page.locator('svg.board .piece-body')).toHaveCount(40);
    await expect(page.locator('svg.board .piece-shadow')).toHaveCount(40);
    expect(await css('.piece-body', 'filter')).toBe('none');
    // 360×740 の新しいツリーの盤の幅は v0.29.0 で 352px
    expect(Math.round((await board.boundingBox())!.width)).toBeGreaterThanOrEqual(352);

    await page.locator('[data-square="77"]').click();
    const sel = page.locator('[data-square="77"] rect');
    await expect(sel).toHaveClass('sq-selected');
    expect(await sel.evaluate((e) => getComputedStyle(e).stroke)).toBe('rgb(201, 165, 76)');
  });
});

/** 研究手順の復習の記録を端末の保存場所に書く（s-line の問題のうち、はじめの 3 問を覚えた・4 問目を前回まちがい） */
async function seedStudyRecord(page: Page) {
  const keys: string[] = [];
  let sfen = STARTPOS_SFEN;
  for (const m of STUDIES[0].moves) {
    // 問題＝自分（先手）の手番の局面。キーは「局面のキー>正解の手」（src/review/studyReview.ts と同じ）
    if (sfen.split(' ')[1] === 'b') keys.push(`${sfenKey(sfen)}>${m}`);
    sfen = applyUsiMove(sfen, m)!.sfen;
  }
  const nodes: Record<string, unknown> = {};
  for (const k of keys.slice(0, 3)) nodes[k] = { seen: 2, correct: 2, streak: 2, lastOk: true, lastAt: 1 };
  nodes[keys[3]] = { seen: 1, correct: 0, streak: 0, lastOk: false, lastAt: 1 };
  await page.evaluate(
    (rec) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('joban-tree');
        open.onsuccess = () => {
          const tx = open.result.transaction('review', 'readwrite');
          tx.objectStore('review').put(rec);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        };
        open.onerror = () => reject(open.error);
      }),
    { treeId: 'studies', nodes },
  );
}

test.describe('12-3 定跡帳', () => {
  test('一覧の上の集計（研究手順の数・覚えた問題・前回まちがい）、行ごとの覚えた割合の輪（段階13 で芽の紋はやめた）', async ({ page }) => {
    await openHome(page);
    await page.getByTestId('study-import-file').setInputFiles({
      name: 's.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ app: 'joban-tree', kind: 'studies', version: 1, studies: STUDIES })),
    });
    await expect(page.getByTestId('study-item')).toHaveCount(2);
    await seedStudyRecord(page);
    await page.reload();
    // 問題は s-line が 6、銀を上がるが 5（はじめの 4 つは同じ局面・同じ正解なので 1 問）＝全部で 7
    await expect(page.getByTestId('book-summary-studies')).toHaveText('2 本');
    await expect(page.getByTestId('book-summary-learned')).toHaveText('3 / 7');
    await expect(page.getByTestId('book-summary-wrong')).toHaveText('1 問');
    await expect(page.getByTestId('book-summary-ring')).toHaveAttribute('aria-label', '覚えた問題 3／7（43%）');
    const rings = page.getByTestId('study-ring');
    await expect(rings).toHaveCount(2);
    await expect(rings.nth(0)).toHaveAttribute('aria-label', '覚えた問題 3／6（50%）');
    await expect(rings.nth(1)).toHaveAttribute('aria-label', '覚えた問題 3／5（60%）');
    await expect(page.locator('.sprout-mark')).toHaveCount(0);
    // 研究手順の行は 1 枚のカード（行と ⋯ が同じ箱）
    const row = await page.locator('.tree-row').first().boundingBox();
    const menu = await page.getByTestId('study-menu').first().boundingBox();
    expect(menu!.x + menu!.width).toBeLessThanOrEqual(row!.x + row!.width + 0.5);
    expect(Math.round(menu!.height)).toBeGreaterThanOrEqual(44);
  });

  test('定跡帳の盤の画面：［復習］は金、「この局面からの研究」に、その手を通る研究手順の割合の棒（名前の下）', async ({ page }) => {
    await openHome(page);
    await page.getByTestId('study-import-file').setInputFiles({
      name: 's.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ app: 'joban-tree', kind: 'studies', version: 1, studies: STUDIES })),
    });
    await page.getByTestId('study-item').first().click();
    await expect(page.getByTestId('study-position')).toBeVisible();
    // 8 手目（△3二金の後）：次の手は ▲2四歩・▲3八銀 の 2 つ、それぞれ 2 本のうち 1 本
    for (let i = 0; i < 3; i++) await page.getByTestId('study-prev').click();
    await expect(page.getByTestId('study-book-branch')).toHaveCount(2);
    expect(await page.getByTestId('book-head-review').evaluate((e) => getComputedStyle(e).backgroundColor)).toBe('rgb(201, 165, 76)');
    const bars = page.getByTestId('study-book-bar');
    await expect(bars).toHaveCount(2);
    for (const i of [0, 1]) {
      const [bar, fill] = await Promise.all([bars.nth(i).boundingBox(), bars.nth(i).locator('.book-bar-fill').boundingBox()]);
      expect(Math.round((fill!.width / bar!.width) * 100)).toBe(50);
      // 棒は名前の下（段階13。名前の幅を広げるため）
      const names = (await page.getByTestId('study-book-branch').nth(i).locator('.book-names').boundingBox())!;
      expect(bar!.y).toBeGreaterThanOrEqual(names.y + names.height - 1);
    }
  });
});

test.describe('12-4 残りの画面', () => {
  test('ツリーのラベルは本線＝藍・有力＝金・疑問手＝オレンジ、文字と地の差も足りる', async ({ page }) => {
    await openHome(page);
    await page.goto('./#/trees');
    await page.getByTestId('import-file').setInputFiles({ name: 't.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(sampleTree())) });
    await page.getByTestId('tree-item').click();
    await expect(page.getByTestId('candidate')).toHaveCount(4);
    const color = (sel: string) => page.locator(sel).first().evaluate((e) => getComputedStyle(e).color);
    expect(await color('.chip-main')).toBe('rgb(28, 39, 64)');
    expect(await color('.chip-good')).toBe('rgb(107, 79, 18)');
    expect(await page.locator('.chip-dubious').first().evaluate((e) => getComputedStyle(e).backgroundColor)).toBe('rgb(185, 82, 12)');
    expect(await lowContrast(page)).toEqual([]);
  });

  test('復習で正解すると、指したマスに金の光が一瞬出る。結果は生成りのカード（文字と地の差も足りる）', async ({ page }) => {
    await openHome(page);
    await page.getByTestId('tab-settings').click();
    await page.getByTestId('review-batch-5').click();
    await page.goto('./');
    await page.getByTestId('study-import-file').setInputFiles({
      name: 's.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ app: 'joban-tree', kind: 'studies', version: 1, studies: [STUDIES[0]] })),
    });
    // 取り込みの保存が終わってから復習を開く（終わる前に開くと問題が 0 になることがあった）
    await expect(page.getByTestId('study-item')).toHaveCount(1);
    await page.goto('./#/study-review/s-line');
    const progress = page.getByTestId('review-progress');
    await expect(progress).toHaveText('今日 1／5問');
    const play = async (from: string, to: string) => {
      await page.locator(`[data-square="${from}"]`).click();
      await page.locator(`[data-square="${to}"]`).click();
    };
    await play('77', '76');
    // 光は指したマス（7六）に出て、0.6 秒で消える
    const flash = page.getByTestId('answer-flash');
    await expect(flash).toHaveCount(1);
    const [sq, fl] = await Promise.all([page.locator('[data-square="76"] rect').boundingBox(), flash.boundingBox()]);
    expect(Math.abs(sq!.x + sq!.width / 2 - (fl!.x + fl!.width / 2))).toBeLessThan(3);
    await expect(progress).toHaveText('今日 2／5問');
    await expect(flash).toHaveCount(0);
    // まちがえたときは出ない
    await play('17', '16');
    await expect(page.getByTestId('review-wrong')).toBeVisible();
    await expect(flash).toHaveCount(0);
    await page.getByTestId('review-show').click();
    await expect(flash).toHaveCount(0);
    await page.getByTestId('review-continue').click();
    await expect(progress).toHaveText('今日 3／5問');
    await play('26', '25');
    await expect(progress).toHaveText('今日 4／5問');
    await play('69', '78');
    await expect(progress).toHaveText('今日 5／5問');
    await play('25', '24');
    await expect(page.getByTestId('review-result-score')).toBeVisible();
    expect(await page.getByTestId('review-result').evaluate((e) => getComputedStyle(e).backgroundColor)).toBe('rgb(255, 253, 248)');
    expect(await lowContrast(page)).toEqual([]);
  });

  test('動きを減らす設定の端末では、正解の光を出さない', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openHome(page);
    await page.getByTestId('study-import-file').setInputFiles({
      name: 's.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ app: 'joban-tree', kind: 'studies', version: 1, studies: [STUDIES[0]] })),
    });
    await expect(page.getByTestId('study-item')).toHaveCount(1);
    await page.goto('./#/study-review/s-line');
    await expect(page.getByTestId('review-progress')).toBeVisible();
    await page.locator('[data-square="77"]').click();
    await page.locator('[data-square="76"]').click();
    await expect(page.getByTestId('answer-flash')).toHaveCount(1);
    expect(await page.getByTestId('answer-flash').evaluate((e) => getComputedStyle(e).display)).toBe('none');
  });
});

test.describe('段階12 の追加：駒と駒台（v0.34.0）', () => {
  // 角交換 → 飛車先の歩の交換 → 両方の龍（持ち駒：先手 角・歩 2、後手 角・歩 2）
  const MID: Study = {
    id: 's-mid',
    name: '両方の龍',
    note: '',
    moves: '7g7f 3c3d 8h2b+ 3a2b 2g2f 8c8d 2f2e 8d8e 2e2d 2c2d 2h2d 8e8f 8g8f 8b8f 2d2c+ 8f8h+'.split(' '),
    mySide: 'black',
    createdAt: 1,
    updatedAt: 1,
  };

  test('駒は駒専用の太い字体で、側面・2 段の影・光のふち付き。持ち駒は駒台に盤と同じ形の駒、2 枚以上は金の数字', async ({ page }) => {
    await openHome(page);
    await page.getByTestId('study-import-file').setInputFiles({
      name: 's.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ app: 'joban-tree', kind: 'studies', version: 1, studies: [MID] })),
    });
    await page.getByTestId('study-item').first().click();
    const board = page.getByTestId('board');
    await expect(board).toBeVisible();
    // 駒の字体がアプリの中から読み込まれる（オフラインでも出る）
    expect(await page.evaluate(async () => (await document.fonts.load('28px "Joban Koma"', '歩龍')).length)).toBeGreaterThan(0);
    // 盤の上の駒 34 枚それぞれに 遠い影・近い影・側面・面・光のふち。filter は使わない
    for (const cls of ['piece-shadow-far', 'piece-shadow', 'piece-side', 'piece-body', 'piece-rim']) {
      await expect(board.locator(`polygon.${cls}`)).toHaveCount(34);
    }
    expect(await board.locator('.piece-side').first().evaluate((e) => getComputedStyle(e).filter)).toBe('none');
    // 成った駒（龍）は赤い字
    await expect(board.locator('.piece-text.promoted')).toHaveCount(2);

    // 先手の駒台：「☗ 先手」の札・角・歩（2 枚なので数字 2）。行の高さは前と同じ 32px
    const black = page.getByTestId('hand-black');
    expect(Math.round((await black.boundingBox())!.height)).toBe(32);
    await expect(black.locator('.hand-mark')).toHaveText('☗ 先手');
    await expect(black.locator('button.hand-tap')).toHaveText(['角', '歩2']);
    await expect(black.locator('svg.hand-piece polygon.piece-body')).toHaveCount(2);
    await expect(black.locator('.hand-count')).toHaveText(['2']);
    await expect(page.getByTestId('hand-white').locator('.hand-mark')).toHaveText('☖ 後手');
    await expect(page.getByTestId('hand-white').locator('.hand-count')).toHaveText(['2']);
    // 駒台の駒は盤の駒の 8 割ほど（盤の駒の面の高さと比べる）
    const big = (await board.locator('polygon.piece-body').first().boundingBox())!.height;
    const small = (await black.locator('svg.hand-piece polygon.piece-body').first().boundingBox())!.height;
    expect(small / big).toBeGreaterThan(0.7);
    expect(small / big).toBeLessThan(0.95);

    // 選んだ持ち駒は金の地と金の内枠。押せる範囲は高さ 32px のまま
    const kaku = black.locator('button.hand-tap').first();
    expect((await kaku.boundingBox())!.height).toBeGreaterThanOrEqual(32);
    await kaku.click();
    await expect(kaku).toHaveAttribute('aria-pressed', 'true');
    expect(await kaku.evaluate((e) => getComputedStyle(e).boxShadow)).toContain('rgb(226, 199, 125)');
  });

  test('閲覧の盤（ツリー）の駒台は高さ 24px のまま。小さな盤（復習の結果）の駒台は 1 行で、札は ☗☖ だけ', async ({ page }) => {
    await openHome(page);
    await page.goto('./#/trees');
    await page.getByTestId('import-file').setInputFiles({ name: 't.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(sampleTree())) });
    await page.getByTestId('tree-item').click();
    await expect(page.getByTestId('candidate')).toHaveCount(4);
    for (const side of ['black', 'white']) {
      expect(Math.round((await page.getByTestId(`hand-${side}`).boundingBox())!.height)).toBe(24);
    }

    // 復習の結果のまちがえた問題（1 回 5 問、全部まちがえる）
    await page.goto('./');
    await page.getByTestId('study-import-file').setInputFiles({
      name: 's.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ app: 'joban-tree', kind: 'studies', version: 1, studies: [MID] })),
    });
    await expect(page.getByTestId('study-item')).toHaveCount(1);
    await page.goto('./#/settings');
    await page.getByTestId('review-batch-5').click();
    await page.goto('./#/study-review/s-mid');
    const progress = page.getByTestId('review-progress');
    for (let i = 1; i <= 5; i++) {
      await expect(progress).toContainText(`今日 ${i}／5問`);
      await page.locator('[data-square="17"]').click();
      await page.locator('[data-square="16"]').click();
      await expect(page.getByTestId('review-wrong')).toBeVisible();
      await page.getByTestId('review-show').click();
      // 5 問目の後は「結果を見る」（同じボタン）
      await page.getByTestId('review-continue').click();
    }
    await expect(page.getByTestId('review-result-score')).toBeVisible();
    const mini = page.locator('.mini-board').first();
    for (const side of ['black', 'white']) {
      const hand = mini.getByTestId(`hand-${side}`);
      expect((await hand.boundingBox())!.height).toBeLessThanOrEqual(20);
      expect(await hand.locator('.hand-side').evaluate((e) => getComputedStyle(e).display)).toBe('none');
    }
  });
});
