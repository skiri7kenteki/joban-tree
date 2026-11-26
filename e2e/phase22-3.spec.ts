// 段階22-3（v0.51.0）：Google ドライブで同期。ログインへ行って戻る → 鍵を URL から消す → 読む → 合わせる → 書き戻す。
// Google のログインの画面とドライブの API は route で偽物にする（本物の Google には通信しない）
import { readFileSync } from 'node:fs';
import { expect, test, type Browser, type Page } from '@playwright/test';
import type { Study } from '../src/tree/types';
import { openStudyList } from './study-list';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const CLIENT_ID = '948519105202-l92dhqh0qe2bu9b047737ag1dbefpm34.apps.googleusercontent.com';

const BASE = '7g7f 3c3d 2g2f 8c8d 2f2e 8d8e 6i7h 4a3b 2e2d 2c2d 2h2d';
const study = (id: string, name: string, tail: string, createdAt: number): Study => ({
  id,
  name,
  note: '',
  moves: `${BASE} ${tail}`.trim().split(' '),
  mySide: 'black',
  createdAt,
  updatedAt: createdAt,
});
const ONLY_A = study('s-a-only', 'iPad で足した研究', '8e8f', 6);
const ONLY_B = study('s-b-only', 'Android で足した研究', '5a5b', 7);

const good = (state: string) => ({ access_token: 'fake-token', token_type: 'Bearer', expires_in: '3599', scope: SCOPE, state });

/** 偽物の Google（何台かの端末で同じドライブを使う） */
class FakeGoogle {
  logins: URL[] = [];
  /** ドライブへ来た通信（方法と URL）と、付いていた鍵 */
  calls: string[] = [];
  auth: string[] = [];
  files = new Map<string, { name: string; text: string; version: number; parents?: string[] }>();
  /** これが終わるまで、中身を受け取る返事を待たせる */
  holdSend: Promise<void> | null = null;
  /** ドライブの返事を、この番号の失敗にする（0 はつながらない） */
  fail: number | null = null;
  private version = 0;
  private sessions = new Map<string, { id: string | null; name: string; parents?: string[] }>();

  /** back：ログインの画面から戻るときに # の後ろに付けるもの（state は送られたものを使う） */
  constructor(private back: (state: string) => Record<string, string> = good) {}

  private info(id: string) {
    const f = this.files.get(id)!;
    return { id, name: f.name, modifiedTime: `2026-11-26T00:00:${f.version}Z`, md5Checksum: String(f.version) };
  }

  async attach(page: Page) {
    await page.route('https://accounts.google.com/**', async (route) => {
      const url = new URL(route.request().url());
      this.logins.push(url);
      const target = `${url.searchParams.get('redirect_uri')}#${new URLSearchParams(this.back(url.searchParams.get('state') ?? ''))}`;
      await route.fulfill({ contentType: 'text/html', body: `<script>location.replace(${JSON.stringify(target)})</script>` });
    });
    await page.route('https://www.googleapis.com/**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const method = request.method();
      const headers = {
        'access-control-allow-origin': '*',
        'access-control-allow-headers': 'authorization,content-type,x-upload-content-type',
        'access-control-allow-methods': 'GET,POST,PATCH,PUT',
        'access-control-expose-headers': 'Location',
      };
      if (method === 'OPTIONS') return route.fulfill({ status: 204, headers });
      this.calls.push(`${method} ${url.pathname}${url.search}`);
      this.auth.push((await request.headerValue('authorization')) ?? '');
      if (this.fail === 0) return route.abort('internetdisconnected');
      const reply = (body: unknown, extra: Record<string, string> = {}, status = 200) =>
        route.fulfill({ status, headers: { ...headers, ...extra }, contentType: 'application/json', body: typeof body === 'string' ? body : JSON.stringify(body) });
      if (this.fail !== null) return reply({}, {}, this.fail);
      if (url.pathname === '/drive/v3/files' && method === 'GET') return reply({ files: [...this.files.keys()].map((id) => this.info(id)) });
      const one = /^\/drive\/v3\/files\/([^/]+)$/.exec(url.pathname);
      if (one && method === 'GET') return reply(this.files.get(one[1])!.text);
      const start = /^\/upload\/drive\/v3\/files(?:\/([^/]+))?$/.exec(url.pathname);
      if (start && (method === 'POST' || method === 'PATCH')) {
        const meta = JSON.parse(request.postData() ?? '{}') as { name?: string; parents?: string[] };
        const key = `session${this.sessions.size + 1}`;
        this.sessions.set(key, { id: start[1] ?? null, name: meta.name ?? '', parents: meta.parents });
        return reply({}, { Location: `https://www.googleapis.com/upload/session/${key}` });
      }
      const send = /^\/upload\/session\/(\w+)$/.exec(url.pathname);
      if (send && method === 'PUT') {
        await this.holdSend;
        const s = this.sessions.get(send[1])!;
        const id = s.id ?? `file${this.files.size + 1}`;
        const old = this.files.get(id);
        this.files.set(id, { name: old?.name ?? s.name, parents: old?.parents ?? s.parents, text: request.postData() ?? '', version: ++this.version });
        return reply(this.info(id));
      }
      return reply({}, {}, 404);
    });
  }
}

async function openApp(page: Page, studies: Study[] = []) {
  await page.goto('./');
  await expect(page.getByTestId('isolation')).toHaveAttribute('data-state', 'isolated', { timeout: 30_000 });
  if (studies.length > 0) {
    await page.getByTestId('study-import-file').setInputFiles({
      name: 's.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ app: 'joban-tree', kind: 'studies', version: 1, studies })),
    });
    await expect(page.getByTestId('study-count')).toHaveText(`研究手順 ${studies.length} 本`);
  }
}

async function openSettings(page: Page) {
  await page.goto('./#/');
  await page.goto('./#/settings');
  await expect(page.getByTestId('data-section')).toBeVisible();
}

/** ［Google ドライブで同期］を押して、結果が出るまで待つ（ログインと読み込み直しをはさんでもよい） */
async function sync(page: Page, expected: string) {
  await openSettings(page);
  await page.getByTestId('drive-sync').click();
  await expect(page.getByTestId('drive-message')).toContainText(expected, { timeout: 30_000 });
  await expect(page.getByTestId('drive-busy')).toHaveCount(0);
}

async function device(browser: Browser, google: FakeGoogle, studies: Study[]): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, acceptDownloads: true, serviceWorkers: 'allow' });
  const page = await context.newPage();
  await google.attach(page);
  await openApp(page, studies);
  return page;
}

async function names(page: Page, expected: string[]) {
  await page.goto('./#/');
  await expect(page.getByTestId('study-count')).toHaveText(`研究手順 ${expected.length} 本`);
  const list = await openStudyList(page);
  await expect(list.getByTestId('study-item')).toHaveCount(expected.length);
  for (const name of expected) await expect(list.getByTestId('study-item').filter({ hasText: name })).toHaveCount(1);
  await page.goto('./#/');
}

/** 一覧の行の ⋯ で消す */
async function deleteStudy(page: Page, name: string, left: number) {
  const list = await openStudyList(page);
  await list.getByTestId('study-item').filter({ hasText: name }).locator('..').getByTestId('study-menu').click();
  await page.getByTestId('study-menu-delete').click();
  await page.getByTestId('study-menu-delete-ok').click();
  await expect(list.getByTestId('study-item')).toHaveCount(left);
  await page.goto('./#/');
}

test('同期を押す → ログインして戻ると、続けて同期する。鍵は URL にもバックアップにもドライブの中にも残らない', async ({ page }) => {
  const google = new FakeGoogle();
  await google.attach(page);
  await openApp(page, [ONLY_A]);
  await page.evaluate(() => localStorage.setItem('joban-tree.wars-name', 'wars-secret-name'));
  await openSettings(page);
  await expect(page.getByTestId('drive-last')).toHaveText('まだありません');
  // 開いただけでは、ドライブと通信しない
  expect(google.calls).toHaveLength(0);
  await page.getByTestId('drive-sync').click();

  await expect(page.getByTestId('drive-message')).toContainText('同期しました', { timeout: 30_000 });
  await expect(page.getByTestId('drive-last')).not.toHaveText('まだありません');
  expect(page.url()).toMatch(/\/joban-tree\/#\/settings$/);
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);

  expect(google.logins[0].searchParams.get('client_id')).toBe(CLIENT_ID);
  expect(google.logins[0].searchParams.get('scope')).toBe(SCOPE);
  expect(google.logins[0].searchParams.get('response_type')).toBe('token');
  expect(google.logins[0].searchParams.get('redirect_uri')).toMatch(/\/joban-tree\/$/);
  expect(google.calls[0]).toContain('spaces=appDataFolder');
  expect(google.auth.every((a) => a === 'Bearer fake-token')).toBe(true);

  // 端末のファイルが 1 つ。アプリ専用の場所。設定と鍵は入らない
  const files = [...google.files.values()];
  expect(files).toHaveLength(1);
  expect(files[0].name).toMatch(/^joban-tree-sync-[\w-]+\.json$/);
  expect(files[0].parents).toEqual(['appDataFolder']);
  const sent = JSON.parse(files[0].text);
  expect(sent.data.studies.map((s: Study) => s.id)).toEqual(['s-a-only']);
  expect(sent.data.prefs).toEqual({});
  expect(files[0].text).not.toContain('fake-token');
  expect(files[0].text).not.toContain('wars-secret-name');

  const save = page.getByTestId('backup-save');
  await expect(save).toBeEnabled();
  const [download] = await Promise.all([page.waitForEvent('download'), save.click()]);
  expect(readFileSync((await download.path())!, 'utf8')).not.toContain('fake-token');

  // 中身が変わらなければ、もう一度押しても一覧を読むだけ
  const before = google.calls.length;
  await sync(page, 'この端末のデータは変わりません');
  expect(google.calls.slice(before)).toHaveLength(1);

  await page.getByTestId('drive-logout').click();
  await expect(page.getByTestId('drive-logout')).toHaveCount(0);
});

test('2 台で順に同期するとそろう。消した研究も伝わる。同期の前のデータに戻せる', async ({ browser }) => {
  const google = new FakeGoogle();
  const a = await device(browser, google, [ONLY_A]);
  const b = await device(browser, google, [ONLY_B]);

  await sync(a, '同期しました');
  await sync(b, '足した 1 本');
  await names(b, ['iPad で足した研究', 'Android で足した研究']);
  await sync(a, '足した 1 本');
  await names(a, ['iPad で足した研究', 'Android で足した研究']);
  expect(google.files.size).toBe(2);

  // A で消す → B で同期すると消えて、名前が出る
  await deleteStudy(a, 'Android で足した研究', 1);
  await sync(a, '同期しました');
  await sync(b, '消えた研究手順：Android で足した研究');
  await names(b, ['iPad で足した研究']);

  // 同期の前のデータに戻す → 次の同期で消えない（戻したものが勝つ）
  await openSettings(b);
  await b.getByTestId('snapshot-restore').click();
  await Promise.all([b.waitForEvent('load'), b.getByTestId('backup-restore-confirm').click()]);
  await names(b, ['iPad で足した研究', 'Android で足した研究']);
  await sync(b, '同期しました');
  await names(b, ['iPad で足した研究', 'Android で足した研究']);
});

test('ドライブのエラー・オフライン・ログイン切れは、理由を出してデータを変えない', async ({ browser }) => {
  const google = new FakeGoogle();
  const a = await device(browser, google, [ONLY_A]);
  const b = await device(browser, google, [ONLY_B]);
  await sync(a, '同期しました');
  const filesBefore = JSON.stringify([...google.files]);

  await openSettings(b);
  await b.evaluate(() => localStorage.setItem('joban-tree.drive-token', JSON.stringify({ token: 'old', expiresAt: Date.now() + 3_000_000 })));
  google.fail = 0;
  await sync(b, 'つながりませんでした');
  google.fail = 500;
  await sync(b, '使えませんでした（500）');
  google.fail = 401;
  await sync(b, '期限が切れました');
  await expect(b.getByTestId('drive-logout')).toHaveCount(0);
  await expect(b.getByTestId('drive-last')).toHaveText('まだありません');
  // 開き直しても、失敗の文のまま（前の成功の文は出ない）
  await openSettings(b);
  await expect(b.getByTestId('drive-message')).toContainText('期限が切れました');
  await names(b, ['Android で足した研究']);
  expect(JSON.stringify([...google.files])).toBe(filesBefore);
});

test('同期している間は、戻るボタンで画面を移っても操作できない', async ({ browser }) => {
  const google = new FakeGoogle();
  const a = await device(browser, google, [ONLY_A]);
  await sync(a, '同期しました');
  const b = await device(browser, google, [ONLY_B]);
  await b.evaluate(() => localStorage.setItem('joban-tree.drive-token', JSON.stringify({ token: 'fake-token', expiresAt: Date.now() + 3_000_000 })));
  let release = () => {};
  google.holdSend = new Promise((r) => (release = r));
  await openSettings(b);
  await b.getByTestId('drive-sync').click();
  await expect(b.getByTestId('drive-busy')).toBeVisible();
  await b.goBack();
  await expect(b.getByTestId('study-register')).toBeAttached();
  await expect(b.getByTestId('drive-busy')).toBeVisible();
  // 覆いの下のボタンは押せない
  await expect(b.getByTestId('study-register').click({ timeout: 1000 })).rejects.toThrow();
  release();
  await expect(b.getByTestId('drive-busy')).toHaveCount(0, { timeout: 30_000 });
  await names(b, ['iPad で足した研究', 'Android で足した研究']);
});

test('取りやめた・印の違う戻りは受け取らず、ドライブと通信しない', async ({ page }) => {
  const google = new FakeGoogle((state) => ({ error: 'access_denied', state }));
  await google.attach(page);
  await openApp(page);
  await openSettings(page);
  await page.getByTestId('drive-sync').click();
  await expect(page.getByTestId('drive-message')).toContainText('取りやめられました', { timeout: 30_000 });
  await expect(page.getByTestId('drive-logout')).toHaveCount(0);

  // このアプリから始めていない戻り（鍵の付いた URL を開かされた場合）
  await page.goto('./#/');
  await page.goto('about:blank');
  await page.goto(`./#${new URLSearchParams(good('someone-else'))}`);
  await expect(page.getByTestId('drive-message')).toContainText('確かめられませんでした', { timeout: 30_000 });
  await expect(page.getByTestId('drive-logout')).toHaveCount(0);
  expect(page.url()).not.toContain('fake-token');
  expect(google.calls).toHaveLength(0);
});

test('開いたままのアプリで # の後ろだけが変わる戻りでも、受け取って URL から鍵を消し、同期する', async ({ page }) => {
  const google = new FakeGoogle();
  await google.attach(page);
  await openApp(page);
  await openSettings(page);
  await page.evaluate(() => localStorage.setItem('joban-tree.drive-login', JSON.stringify({ state: 'same-page', at: Date.now() })));
  await page.goto('./#/');
  const back = new URLSearchParams(good('same-page')).toString();
  await page.evaluate((hash) => (location.hash = hash), back);
  await expect(page.getByTestId('drive-message')).toContainText('同期しました', { timeout: 30_000 });
  expect(page.url()).toMatch(/\/joban-tree\/#\/settings$/);
});

test('前の同期から 1 日以上なら、定跡帳のタブと設定に一言（幅 360）', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 640 });
  await openApp(page, [ONLY_A]);
  await expect(page.getByTestId('sync-nudge')).toHaveCount(0);
  await page.evaluate(() => localStorage.setItem('joban-tree.last-sync', String(Date.now() - 2 * 24 * 60 * 60 * 1000)));
  await page.reload();
  await expect(page.getByTestId('sync-nudge')).toBeVisible();
  const over = () => page.evaluate(() => document.scrollingElement!.scrollWidth - document.scrollingElement!.clientWidth);
  expect(await over()).toBeLessThanOrEqual(0);
  await page.getByTestId('sync-nudge-open').click();
  await expect(page.getByTestId('drive-late')).toBeVisible();
  expect(await over()).toBeLessThanOrEqual(0);
  await page.goto('./#/');
  await page.getByTestId('sync-nudge-close').click();
  await expect(page.getByTestId('sync-nudge')).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('study-count')).toHaveText(`研究手順 ${1} 本`);
  await expect(page.getByTestId('sync-nudge')).toHaveCount(0);
});
