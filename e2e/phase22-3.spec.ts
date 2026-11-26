// 段階22-3（まずログインの確認、v0.50.1）：Google のログインへ行って戻る → 鍵を URL から消す → ドライブに届くか確かめる。
// Google のログインの画面とドライブの API は page.route で偽物にする（本物の Google には通信しない）
import { readFileSync } from 'node:fs';
import { expect, test, type Page, type Request } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const CLIENT_ID = '948519105202-l92dhqh0qe2bu9b047737ag1dbefpm34.apps.googleusercontent.com';

interface Fake {
  /** ログインの画面へ来たときの URL */
  logins: URL[];
  /** ドライブへ来た通信 */
  drive: Request[];
  status: number;
}

/** back：ログインの画面から戻るときに # の後ろに付けるもの（state は送られたものを使う） */
async function fakeGoogle(page: Page, back: (state: string) => Record<string, string>): Promise<Fake> {
  const fake: Fake = { logins: [], drive: [], status: 200 };
  await page.route('https://accounts.google.com/**', async (route) => {
    const url = new URL(route.request().url());
    fake.logins.push(url);
    const target = `${url.searchParams.get('redirect_uri')}#${new URLSearchParams(back(url.searchParams.get('state') ?? ''))}`;
    await route.fulfill({ contentType: 'text/html', body: `<script>location.replace(${JSON.stringify(target)})</script>` });
  });
  await page.route('https://www.googleapis.com/**', async (route) => {
    fake.drive.push(route.request());
    await route.fulfill({
      status: fake.status,
      headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization' },
      contentType: 'application/json',
      body: JSON.stringify({ files: [] }),
    });
  });
  return fake;
}

const good = (state: string) => ({ access_token: 'fake-token', token_type: 'Bearer', expires_in: '3599', scope: SCOPE, state });

async function openSettings(page: Page) {
  await page.goto('./');
  await expect(page.getByTestId('isolation')).toHaveAttribute('data-state', 'isolated', { timeout: 30_000 });
  await page.goto('./#/settings');
  await expect(page.getByTestId('data-section')).toBeVisible();
}

test('ログインして戻ると、URL から鍵が消えて、ドライブに届く。鍵はバックアップに入らない', async ({ page }) => {
  const fake = await fakeGoogle(page, good);
  await openSettings(page);
  await expect(page.getByTestId('drive-state')).toHaveText('ログインしていません');
  await page.getByTestId('drive-login').click();

  await expect(page.getByTestId('drive-message')).toHaveText('ドライブに届きました（このアプリのファイル 0 個）。', { timeout: 30_000 });
  await expect(page.getByTestId('drive-state')).toContainText('ログイン中');
  expect(page.url()).toMatch(/\/joban-tree\/#\/settings$/);
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);

  expect(fake.logins[0].searchParams.get('client_id')).toBe(CLIENT_ID);
  expect(fake.logins[0].searchParams.get('scope')).toBe(SCOPE);
  expect(fake.logins[0].searchParams.get('response_type')).toBe('token');
  expect(fake.logins[0].searchParams.get('redirect_uri')).toMatch(/\/joban-tree\/$/);
  const get = fake.drive.filter((r) => r.method() === 'GET');
  expect(get[0].url()).toContain('spaces=appDataFolder');
  expect(await get[0].headerValue('authorization')).toBe('Bearer fake-token');
  // ドライブへは読むだけ（何も送らない）
  expect(fake.drive.every((r) => r.method() === 'GET' || r.method() === 'OPTIONS')).toBe(true);

  const save = page.getByTestId('backup-save');
  await expect(save).toBeEnabled();
  const [download] = await Promise.all([page.waitForEvent('download'), save.click()]);
  expect(readFileSync((await download.path())!, 'utf8')).not.toContain('fake-token');

  await page.getByTestId('drive-logout').click();
  await expect(page.getByTestId('drive-state')).toHaveText('ログインしていません');
});

test('取りやめた・印の違う戻りは受け取らない。期限切れはログインし直し', async ({ page }) => {
  const fake = await fakeGoogle(page, (state) => ({ error: 'access_denied', state }));
  await openSettings(page);
  await page.getByTestId('drive-login').click();
  await expect(page.getByTestId('drive-message')).toContainText('取りやめられました', { timeout: 30_000 });
  await expect(page.getByTestId('drive-state')).toHaveText('ログインしていません');

  // このアプリから始めていない戻り（鍵の付いた URL を開かされた場合）
  await page.goto('./#/');
  await page.goto('about:blank');
  await page.goto(`./#${new URLSearchParams(good('someone-else'))}`);
  await expect(page.getByTestId('drive-message')).toContainText('確かめられませんでした', { timeout: 30_000 });
  await expect(page.getByTestId('drive-state')).toHaveText('ログインしていません');
  expect(page.url()).not.toContain('fake-token');
  expect(fake.drive).toHaveLength(0);

  // 鍵が切れていた
  fake.status = 401;
  await page.evaluate(() => localStorage.setItem('joban-tree.drive-token', JSON.stringify({ token: 'old', expiresAt: Date.now() + 3_000_000 })));
  await page.goto('./#/');
  await page.goto('./#/settings');
  await page.getByTestId('drive-check').click();
  await expect(page.getByTestId('drive-message')).toContainText('期限が切れました');
  await expect(page.getByTestId('drive-state')).toHaveText('ログインしていません');
});

test('戻った直後にアプリが読み込み直しても、結果は消えない', async ({ page }) => {
  await fakeGoogle(page, good);
  await openSettings(page);
  await page.getByTestId('drive-login').click();
  await expect(page.getByTestId('drive-message')).toContainText('ドライブに届きました', { timeout: 30_000 });
  await page.reload();
  await expect(page.getByTestId('drive-message')).toContainText('ドライブに届きました');
  await page.getByTestId('drive-logout').click();
  await page.reload();
  await expect(page.getByTestId('drive-section')).toBeVisible();
  await expect(page.getByTestId('drive-message')).toHaveCount(0);
});

test('開いたままのアプリで # の後ろだけが変わる戻りでも、受け取って URL から鍵を消す', async ({ page }) => {
  await fakeGoogle(page, good);
  await openSettings(page);
  await page.evaluate(() => localStorage.setItem('joban-tree.drive-login', JSON.stringify({ state: 'same-page', at: Date.now() })));
  await page.goto('./#/');
  const back = new URLSearchParams(good('same-page')).toString();
  await page.evaluate((hash) => (location.hash = hash), back);
  await expect(page.getByTestId('drive-message')).toContainText('ドライブに届きました', { timeout: 30_000 });
  expect(page.url()).toMatch(/\/joban-tree\/#\/settings$/);
});

test('ログインの直後に鍵が切れたら、画面を開き直しても「ログインできました」は出さない', async ({ page }) => {
  const fake = await fakeGoogle(page, good);
  await openSettings(page);
  await page.getByTestId('drive-login').click();
  await expect(page.getByTestId('drive-message')).toContainText('ドライブに届きました', { timeout: 30_000 });
  fake.status = 401;
  await page.getByTestId('drive-check').click();
  await expect(page.getByTestId('drive-message')).toContainText('期限が切れました');
  await page.goto('./#/');
  await page.goto('./#/settings');
  await expect(page.getByTestId('drive-state')).toHaveText('ログインしていません');
  await expect(page.getByTestId('drive-message')).toHaveCount(0);
});
