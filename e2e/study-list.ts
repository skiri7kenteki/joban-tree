// 段階22-4：研究手順の 1 本ずつの一覧は、定跡帳の ⋯「研究手順の一覧」に移った。画面の通し確認で使う道具
import type { Locator, Page } from '@playwright/test';

/** 定跡帳のタブから、定跡帳（book：行の文字。無ければいちばん上）を開いて、研究手順の一覧の窓を出す */
export async function openStudyList(page: Page, book?: string | RegExp): Promise<Locator> {
  await page.goto('./#/');
  const rows = page.getByTestId('book-group');
  await (book ? rows.filter({ hasText: book }) : rows.first()).getByTestId('book-group-open').click();
  await page.getByTestId('book-menu').click();
  await page.getByTestId('book-study-list').click();
  return page.getByTestId('study-list-dialog');
}
