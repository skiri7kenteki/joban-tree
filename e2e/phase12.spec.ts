// 段階12：デザインの刷新（C 案「対局室」）。段階16（v0.40.0）で「明るい対局室」に（藍と金をやめた）
// 12-1 色・文字・部品の土台：明るい地・白いカード・墨の主なボタン・明朝体の見出し。全画面で文字と地の色の差と、藍・金が残っていないことを確かめる
import { openSettings } from './settings';
import { expect, test, type Page } from '@playwright/test';
import type { Study } from '../src/tree/types';
import { openStudyList } from './study-list';

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

/** 段階16：藍と金の色（段階12〜15）が、画面のどこかの文字・地・縁・影に残っていれば、その要素を返す */
async function oldColors(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const old = ['191, 160, 99', '216, 194, 144', '132, 105, 58', '28, 39, 64', '21, 29, 49', '243, 238, 227', '255, 253, 248'];
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      const cs = getComputedStyle(el);
      const all = [cs.color, cs.backgroundColor, cs.borderTopColor, cs.borderLeftColor, cs.boxShadow, cs.outlineColor, cs.fill, cs.stroke].join(' ');
      const hit = old.find((c) => all.includes(`rgb(${c})`) || all.includes(`rgba(${c},`));
      if (hit) out.push(`${el.tagName.toLowerCase()}.${typeof (el as HTMLElement).className === 'string' ? (el as HTMLElement).className : ''} ${hit}`);
    }
    return out;
  });
}

test.describe('12-1 色・文字・部品の土台（段階16 で明るい対局室）', () => {
  test('どの画面も明るい地に白いカード。見出しは帯なし、主なボタン・操作バー・選んでいる切り替えは墨、下のタブは白。藍と金はどこにも残らない', async ({ page }) => {
    await openHome(page);
    await page.getByTestId('study-import-file').setInputFiles({
      name: 's.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ app: 'joban-tree', kind: 'studies', version: 1, studies: STUDIES })),
    });
    await expect(page.getByTestId('study-count')).toHaveText(`研究手順 ${2} 本`);
    const style = (sel: string, prop: string) => page.locator(sel).first().evaluate((e, p) => getComputedStyle(e).getPropertyValue(p), prop);
    // 一覧の画面：地は #F7F5F1、見出しは帯なし（地と同じ）で墨の明朝（「書き出し」は段階20-3 で設定へ移した）
    expect(await style('.app', 'background-color')).toBe('rgb(247, 245, 241)');
    expect(await style('.list-header', 'background-color')).toBe('rgba(0, 0, 0, 0)');
    // 段階24：4 画面の見出しは少し暖かい墨（#292722）の 22px
    expect(await style('.list-header h1', 'color')).toBe('rgb(41, 39, 34)');
    expect(await style('.list-header h1', 'font-size')).toBe('22px');
    // 集計は白いカード 1 枚。グループの見出しはカードの外、行はグループごとに白いカード 1 枚の中（行に影は付けない）
    expect(await style('.book-summary', 'background-color')).toBe('rgb(255, 255, 255)');
    expect(await style('.tree-group', 'background-color')).toBe('rgba(0, 0, 0, 0)');
    expect(await style('.tree-group .tree-list', 'background-color')).toBe('rgb(255, 255, 255)');
    expect(await style('.tree-group .tree-row', 'box-shadow')).toBe('none');
    // 主なボタンは墨の塗りに白い文字と少しの影（グラデーションなし）
    expect(await style('[data-testid="study-register"]', 'background-color')).toBe('rgb(45, 45, 45)');
    expect(await style('[data-testid="study-register"]', 'color')).toBe('rgb(255, 255, 255)');
    expect(await style('[data-testid="study-register"]', 'background-image')).toBe('none');
    expect(await style('[data-testid="study-register"]', 'box-shadow')).toBe('rgba(0, 0, 0, 0.15) 0px 4px 12px 0px');
    expect(await style('h1', 'font-family')).toContain('Joban Mincho');
    // 下のタブ：白い地に上の 1px の線。選んでいるタブは墨の太い文字、ほかは補助の文字の色
    expect(await style('.tabbar', 'background-color')).toBe('rgb(255, 255, 255)');
    expect(await style('.tabbar', 'border-top-color')).toBe('rgb(232, 227, 218)');
    expect(await style('.tabbar-tab.on', 'color')).toBe('rgb(45, 45, 45)');
    expect(await style('.tabbar-tab:not(.on)', 'color')).toBe('rgb(102, 99, 94)');
    // 青海波は敷かない
    expect(await page.locator('.app').evaluate((e) => getComputedStyle(e, '::before').backgroundImage)).toBe('none');
    expect(await oldColors(page)).toEqual([]);
    // 明朝体はアプリに入っている（端末に無くても出る）
    expect(await page.evaluate(() => document.fonts.check('600 21px "Joban Mincho"', '定跡帳'))).toBe(true);

    await (await openStudyList(page)).getByTestId('study-item').first().click();
    await expect(page.getByTestId('study-position')).toBeVisible();
    // 盤の画面：地は一覧と同じ #F7F5F1（盤のまわりに色の地を敷かない）。盤と駒台は影で浮かせる
    expect(await style('.app', 'background-color')).toBe('rgb(247, 245, 241)');
    expect(await page.locator('.app').evaluate((e) => getComputedStyle(e, '::before').backgroundImage)).toBe('none');
    expect(await style('.board-wrap', 'box-shadow')).toBe('rgba(60, 45, 25, 0.22) 0px 6px 20px 0px, rgba(60, 45, 25, 0.2) 0px 1px 3px 0px');
    // 見出し：小さい文字で「定跡帳」、その下に大きい明朝で名前（帯なし）
    expect(await style('[data-testid="book-kicker"]', 'display')).toBe('block');
    // 段階14：操作バーは盤のすぐ下。段階16 から墨の塗りに白い文字
    expect(await style('.move-bar', 'background-color')).toBe('rgb(45, 45, 45)');
    expect(await style('.move-bar-btn', 'color')).toBe('rgb(255, 255, 255)');
    expect(await oldColors(page)).toEqual([]);
    expect(await lowContrast(page)).toEqual([]);
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
    await expect(page.getByTestId('study-count')).toHaveText(`研究手順 ${2} 本`);
    await check('定跡帳のタブ');
    await (await openStudyList(page)).getByTestId('study-menu').first().click();
    await check('研究手順の行の ⋯');
    await page.locator('dialog[open]').last().getByRole('button', { name: '閉じる' }).click();
    await check('研究手順の一覧');
    await closeDialog(page);
    await page.goto('./#/');
    await page.getByTestId('study-register').click();
    await check('研究手順を登録');
    await closeDialog(page);

    // 定跡帳（盤）と ⋯
    await (await openStudyList(page)).getByTestId('study-item').first().click();
    await expect(page.getByTestId('study-position')).toBeVisible();
    for (let i = 0; i < 3; i++) await page.getByTestId('study-prev').click();
    await check('定跡帳');
    await page.getByTestId('book-menu').click();
    await check('定跡帳の ⋯');
    await closeDialog(page);

    // 実戦・稽古・設定
    // 段階19：稽古のタブと稽古の画面、段階18：実戦のタブ
    await page.goto('./#/practice');
    await expect(page.getByTestId('practice-start')).toBeVisible();
    await check('稽古のタブ');
    await page.goto('./#/practice/play/s-line');
    await expect(page.getByTestId('practice-card')).toHaveAttribute('data-phase', 'ask');
    await check('稽古');
    await page.locator('[data-square="17"]').click();
    await page.locator('[data-square="16"]').click();
    await expect(page.getByTestId('practice-wrong')).toBeVisible();
    await check('稽古（まちがえた後）');
    await page.goto('./#/games');
    await expect(page.getByTestId('games-empty')).toBeVisible();
    await check('実戦のタブ');
    // 段階16：藍と金がどの画面にも残っていない（設定のタブと下の画面）
    for (const sub of [undefined, 'practice', 'games', 'data', 'sync', 'engine'] as const) {
      await openSettings(page, sub);
      await check(`設定 ${sub ?? ''}`);
      expect(await oldColors(page)).toEqual([]);
    }

    expect(found).toEqual([]);
  });
});

test.describe('12-2 盤と駒', () => {
  test('盤は木目と木の茶の縁、駒は明朝体で影付き。駒台も盤と同じ木目。選んだマスは墨の線', async ({ page }) => {
    await openHome(page);
    await page.goto(`./#/book/${encodeURIComponent('study:hirate|black')}`);
    const board = page.getByTestId('board');
    await expect(board).toBeVisible();
    const css = (sel: string, prop: string) => page.locator(sel).first().evaluate((e, p) => getComputedStyle(e).getPropertyValue(p), prop);
    expect(await css('svg.board', 'background-image')).toContain('wood');
    // 段階15：盤は素材の木目に #8B6B4F の 5px の縁。段階16：影は盤と駒台をまとめた .board-wrap に、駒台も盤と同じ木目（境目は盤の枠だけ）
    expect(await css('svg.board', 'background-image')).toContain('board-wood');
    expect(await css('svg.board', 'border-top-width')).toBe('5px');
    expect(await css('svg.board', 'border-top-color')).toBe('rgb(139, 107, 79)');
    expect(await css('svg.board', 'box-shadow')).toBe('none');
    expect(await css('.board-wrap', 'box-shadow')).toContain('rgba(60, 45, 25, 0.22) 0px 6px 20px 0px');
    expect(await css('[data-testid="hand-black"]', 'box-shadow')).toBe('none');
    expect(await css('[data-testid="hand-black"]', 'background-image')).toContain('board-wood');
    expect(await css('[data-testid="hand-black"]', 'border-top-width')).toBe('0px');
    // 札（☗ 先手）は墨の地に白い文字
    expect(await css('[data-testid="hand-black"] .hand-mark', 'background-color')).toBe('rgb(45, 45, 45)');
    expect(await css('[data-testid="hand-black"] .hand-mark', 'color')).toBe('rgb(255, 255, 255)');
    expect(await css('.piece-text', 'font-family')).toContain('Joban Koma');
    expect(await css('.board-coord', 'font-family')).toContain('Joban Mincho');
    // 駒は 40 枚。影は形を下へずらした 2 段（段階15。filter は使わない）
    await expect(page.locator('svg.board .piece-body')).toHaveCount(40);
    await expect(page.locator('svg.board .piece-drop-near')).toHaveCount(40);
    await expect(page.locator('svg.board [filter]')).toHaveCount(0);
    expect(await css('.piece-body', 'filter')).toBe('none');
    expect(await css('g.piece', 'filter')).toBe('none');
    expect(Math.round((await board.boundingBox())!.width)).toBeGreaterThanOrEqual(290);

    await page.locator('[data-square="77"]').click();
    const sel = page.locator('[data-square="77"] rect');
    await expect(sel).toHaveClass('sq-selected');
    expect(await sel.evaluate((e) => getComputedStyle(e).stroke)).toBe('rgb(45, 45, 45)');
  });
});

/** 稽古の記録（段階19）を端末の保存場所に書く：s-line は 1 週空く段（身についた）、s-line2 は前回まちがい（今日やる） */
async function seedPractice(page: Page) {
  const DAY = 24 * 60 * 60 * 1000;
  const today = new Date(new Date().toDateString()).getTime();
  const recs = [
    { studyId: 's-line', step: 2, dueAt: today + 7 * DAY, lastAt: Date.now() - DAY, firstAt: Date.now() - 20 * DAY, lastMistakes: 0, count: 3 },
    { studyId: 's-line2', step: 0, dueAt: today, lastAt: Date.now() - DAY, firstAt: Date.now() - 2 * DAY, lastMistakes: 1, count: 1 },
  ];
  await page.evaluate(
    (list) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('joban-tree');
        open.onsuccess = () => {
          const tx = open.result.transaction('practice', 'readwrite');
          for (const r of list) tx.objectStore('practice').put(r);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        };
        open.onerror = () => reject(open.error);
      }),
    recs,
  );
}

test.describe('12-3 定跡帳', () => {
  test('一覧の上の集計（段階19 から稽古：今日の稽古・身についた・前回まちがい）、行ごとの次の稽古の日', async ({ page }) => {
    await openHome(page);
    await page.getByTestId('study-import-file').setInputFiles({
      name: 's.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ app: 'joban-tree', kind: 'studies', version: 1, studies: STUDIES })),
    });
    await expect(page.getByTestId('study-count')).toHaveText(`研究手順 ${2} 本`);
    await seedPractice(page);
    await page.reload();
    await expect(page.getByTestId('book-summary-today')).toHaveText('1 本');
    await expect(page.getByTestId('book-summary-learned')).toHaveText('1 / 2本');
    await expect(page.getByTestId('book-summary-wrong')).toHaveText('1 本');
    // 段階22-4：定跡帳ごとに 1 行（今日の分があれば「今日」・覚えた割合の輪）
    await expect(page.getByTestId('book-group')).toHaveCount(1);
    await expect(page.getByTestId('book-group').getByTestId('study-due')).toHaveText('稽古 今日');
    await expect(page.getByTestId('book-group-ring')).toContainText('50%');
    const list = await openStudyList(page);
    await expect(list.getByTestId('study-item').filter({ hasText: '銀' }).getByTestId('study-due')).toHaveText('稽古 今日');
    await expect(list.getByTestId('study-item').filter({ hasNotText: '銀' }).getByTestId('study-due')).toHaveText('稽古 あと 7日');
    await expect(page.locator('.sprout-mark')).toHaveCount(0);
    // 研究手順の行は 1 枚のカード（行と ⋯ が同じ箱）
    const row = await page.locator('.tree-row').first().boundingBox();
    const menu = await page.getByTestId('study-menu').first().boundingBox();
    expect(menu!.x + menu!.width).toBeLessThanOrEqual(row!.x + row!.width + 0.5);
    expect(Math.round(menu!.height)).toBeGreaterThanOrEqual(44);
    // 集計を押すと稽古のタブ
    await page.goto('./#/');
    await page.getByTestId('book-summary').click();
    await expect(page).toHaveURL(/#\/practice$/);
  });

  test('定跡帳の盤の画面：［復習］は墨、「この局面からの研究」の行（割合の棒は段階23 でやめた）', async ({ page }) => {
    await openHome(page);
    await page.getByTestId('study-import-file').setInputFiles({
      name: 's.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ app: 'joban-tree', kind: 'studies', version: 1, studies: STUDIES })),
    });
    await (await openStudyList(page)).getByTestId('study-item').first().click();
    await expect(page.getByTestId('study-position')).toBeVisible();
    // 8 手目（△3二金の後）：次の手は ▲2四歩・▲3八銀 の 2 つ、それぞれ 2 本のうち 1 本
    for (let i = 0; i < 3; i++) await page.getByTestId('study-prev').click();
    await expect(page.getByTestId('study-book-branch')).toHaveCount(2);
    expect(await page.getByTestId('book-head-review').evaluate((e) => getComputedStyle(e).backgroundColor)).toBe('rgb(45, 45, 45)');
  });
});

test.describe('12-4 残りの画面', () => {
  test('稽古で 1 回目に正解すると、指したマスに木の茶の光が一瞬出る。まちがえたとき・その指し直しでは出ない', async ({ page }) => {
    await openHome(page);
    await page.getByTestId('study-import-file').setInputFiles({
      name: 's.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ app: 'joban-tree', kind: 'studies', version: 1, studies: [STUDIES[0]] })),
    });
    await expect(page.getByTestId('study-count')).toHaveText(`研究手順 ${1} 本`);
    await page.goto('./#/practice/play/s-line');
    const card = page.getByTestId('practice-card');
    await expect(card).toHaveAttribute('data-phase', 'ask');
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
    await expect(flash).toHaveCount(0);
    await expect(card).toContainText('相手は △３四歩');
    // まちがえたときは出ない。指し直しの正解でも出ない
    await play('17', '16');
    await expect(page.getByTestId('practice-wrong')).toBeVisible();
    await expect(flash).toHaveCount(0);
    await play('27', '26');
    await expect(card).toContainText('相手は △８四歩');
    await expect(flash).toHaveCount(0);
  });

  test('動きを減らす設定の端末では、正解の光を出さない', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openHome(page);
    await page.getByTestId('study-import-file').setInputFiles({
      name: 's.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ app: 'joban-tree', kind: 'studies', version: 1, studies: [STUDIES[0]] })),
    });
    await expect(page.getByTestId('study-count')).toHaveText(`研究手順 ${1} 本`);
    await page.goto('./#/practice/play/s-line');
    await expect(page.getByTestId('practice-card')).toHaveAttribute('data-phase', 'ask');
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
    await (await openStudyList(page)).getByTestId('study-item').first().click();
    const board = page.getByTestId('board');
    await expect(board).toBeVisible();
    // 駒の字体がアプリの中から読み込まれる（オフラインでも出る）
    expect(await page.evaluate(async () => (await document.fonts.load('28px "Joban Koma"', '歩龍')).length)).toBeGreaterThan(0);
    // 段階15：盤の上の駒 34 枚それぞれに 遠い影・近い影・側面・面（ふち 1 本）。filter は使わない
    for (const cls of ['piece-drop-far', 'piece-drop-near', 'piece-side', 'piece-body']) {
      await expect(board.locator(`polygon.${cls}`)).toHaveCount(34);
    }
    for (const cls of ['piece-shadow-far', 'piece-shadow', 'piece-rim']) {
      await expect(board.locator(`.${cls}`)).toHaveCount(0);
    }
    await expect(board.locator('[filter]')).toHaveCount(0);
    // 駒の面は素材の画像：pattern は盤に 1 つだけ（駒ごとに画像を増やさない）。読めないときの縦の濃淡 #F4E6D2 → #E6CCAD
    await expect(board.locator('pattern#piece-face')).toHaveCount(1);
    await expect(board.locator('image')).toHaveCount(1);
    // 駒の面の画像は 1KB と小さいので、ビルドでプログラムの中に埋め込まれる（別のファイルを読まない）
    expect(await board.locator('pattern#piece-face image').getAttribute('href')).toMatch(/^data:image\/webp;base64,|piece-face/);
    expect(await board.locator('.piece-body').first().evaluate((e) => getComputedStyle(e).fill)).toContain('piece-face');
    const stop = (sel: string) => page.locator(sel).first().evaluate((e) => getComputedStyle(e).stopColor);
    expect(await stop('.piece-grad-top')).toBe('rgb(244, 230, 210)');
    expect(await stop('.piece-grad-bottom')).toBe('rgb(230, 204, 173)');
    // ふち #9E784D・0.6、字 #1F1F1F・23px
    const body = board.locator('.piece-body').first();
    expect(await body.evaluate((e) => getComputedStyle(e).stroke)).toBe('rgb(158, 120, 77)');
    expect(await body.evaluate((e) => getComputedStyle(e).strokeWidth)).toBe('0.6px');
    expect(await board.locator('.piece-text').first().evaluate((e) => getComputedStyle(e).fill)).toBe('rgb(31, 31, 31)');
    expect(await board.locator('.piece-text').first().evaluate((e) => getComputedStyle(e).fontSize)).toBe('23px');
    // 成った駒（龍）は赤い字（#C62828）
    await expect(board.locator('.piece-text.promoted')).toHaveCount(2);
    expect(await board.locator('.piece-text.promoted').first().evaluate((e) => getComputedStyle(e).fill)).toBe('rgb(198, 40, 40)');
    // 盤の地（段階16 から駒台も同じ）の画像はオフライン用の保存に入っている（service worker の事前キャッシュ。駒の面はプログラムの中）
    const cached = await page.evaluate(async () => {
      const names = await caches.keys();
      const urls: string[] = [];
      for (const n of names) for (const r of await (await caches.open(n)).keys()) urls.push(r.url);
      return urls;
    });
    for (const f of ['board-wood']) {
      expect(cached.some((u) => u.includes(f) && u.endsWith('.webp')), f).toBe(true);
    }

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

    // 選んだ持ち駒は薄い墨の地と墨の内枠（段階16。前は金）。押せる範囲は高さ 32px のまま
    const kaku = black.locator('button.hand-tap').first();
    expect((await kaku.boundingBox())!.height).toBeGreaterThanOrEqual(32);
    await kaku.click();
    await expect(kaku).toHaveAttribute('aria-pressed', 'true');
    expect(await kaku.evaluate((e) => getComputedStyle(e).boxShadow)).toContain('rgb(45, 45, 45)');
  });

});
