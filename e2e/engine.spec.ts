// エンジンがブラウザの中で答えを返すこと（GitHub Actions でエンジンをビルドしたときだけ実行）
import { expect, test } from '@playwright/test';

test.skip(!process.env.ENGINE_AVAILABLE, 'エンジンがビルドされていないので省略（GitHub Actions では実行される）');

for (const evalId of ['micro', 'mini']) {
  test(`速度測定ページの動作確認で bestmove が返る（${evalId}）`, async ({ page }) => {
    page.on('console', (msg) => console.log(`[browser] ${msg.text()}`));
    await page.goto('./bench.html');
    await expect(page.getByTestId('env')).toContainText('isolated：OK', { timeout: 30_000 });
    await page.getByLabel('評価関数').selectOption(evalId);
    await page.getByTestId('run-check').click();
    await expect(page.getByTestId('check-result')).toContainText(/bestmove [1-9][a-i][1-9][a-i]/, { timeout: 120_000 });
    await expect(page.getByTestId('check-result')).toContainText(/評価値 [+−0]/);
  });
}
