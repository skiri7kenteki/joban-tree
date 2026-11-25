// CLAUDE.md の「どの作業でも守ること」のうち、機械で確かめられるものを確かめる。
// 落ちたら、決まりに合わせてコードの方を直す。どうしても例外にするときは ALLOW に理由と一緒に足す（持ち主に聞いてから）。
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();

/** フォルダの中のファイルをすべて集める（パスは / 区切り） */
function walk(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    const path = join(dir, name);
    return statSync(join(ROOT, path)).isDirectory() ? walk(path) : [path.replace(/\\/g, '/')];
  });
}

// コメントを除いた行の中身（// の行、CSS・JS の「/* … */」のコメント、その続きの * で始まる行は除く）
function withoutComments(line: string): string {
  const t = line.trim();
  if (t.startsWith('//') || t.startsWith('*')) return '';
  return line.replace(/\/\*.*?(\*\/|$)/g, '');
}

/** 決まりに合わない行を「ファイル:行 中身」で集める */
function find(files: string[], pattern: RegExp, allow: string[] = []): string[] {
  return files
    .filter((f) => !allow.includes(f))
    .flatMap((f) =>
      readFileSync(join(ROOT, f), 'utf8')
        .split('\n')
        .map((line, i) => ({ line, i }))
        .filter(({ line }) => pattern.test(withoutComments(line)))
        .map(({ line, i }) => `${relative('.', f)}:${i + 1} ${line.trim()}`),
    );
}

const code = walk('src').filter((f) => /\.(ts|tsx|css)$/.test(f));

describe('どの作業でも守ること', () => {
  it('色は tokens.css の変数から使う（直書きしない）', () => {
    const ALLOW = [
      'src/styles/tokens.css', // 色の変数を決める所
    ];
    expect(find(code, /#[0-9a-fA-F]{3,8}\b(?![\w-])|\brgba?\(\s*\d/, ALLOW)).toEqual([]);
  });

  it('dangerouslySetInnerHTML を使わない（利用者の入力を HTML として解釈させない）', () => {
    expect(find(code, /dangerouslySetInnerHTML/)).toEqual([]);
  });

  it('外部の URL から読み込まない（外部 CDN を使わない）', () => {
    const pages = ['index.html', 'bench.html'];
    const load = /<(script|link|img)\b[^>]*\b(src|href)=["']https?:\/\/|@import\s+url\(\s*["']?https?:|url\(\s*["']?https?:|import\s+.*from\s+["']https?:/;
    expect(find([...pages, ...code], load)).toEqual([]);
  });

  it('パスは BASE_URL を基準にする（先頭が / の絶対パスを使わない）', () => {
    const absolute = /\b(src|href)=["']\/(?!\/)|\bfetch\(\s*["'`]\/(?!\/)|new URL\(\s*["'`]\/(?!\/)/;
    expect(find(code, absolute)).toEqual([]);
  });
});
