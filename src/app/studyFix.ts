// ずれてしまった研究手順を直す（段階10 の直し、持ち主の判断 2026-11-19「おすすめの通りで」。計算は src/tree/bookEdit.ts の fixStudies）。
// アプリを開いたときに毎回確かめる（直すものが無ければ何もしない）。直したらトップ画面に一度だけ知らせる。
// 自分で登録した戦型を読めなかったときは何もしない（その戦型が付いた研究手順を、取り違えて付け直さないように）

import { fixStudies } from '../tree/bookEdit';
import { ensureStudies, homeNotice, saveStudies } from './studies';
import { allTemplates, myTemplates, refreshMyTemplates } from './TemplateDialogs';

/** 端末の研究手順を確かめて直す。直した本数を返す */
export async function fixStoredStudies(): Promise<number> {
  if (!myTemplates.value) await refreshMyTemplates();
  const changed = fixStudies(await ensureStudies(), allTemplates());
  if (changed.length > 0) await saveStudies(changed);
  return changed.length;
}

/** アプリを開いたとき（main.tsx から 1 回） */
export function fixStudiesOnStart(): void {
  fixStoredStudies()
    .then((n) => {
      if (n > 0) homeNotice.value = `研究手順 ${n} 本の戦型と名前を直しました（自分の側に合う戦型にしました。自分で付けた名前は変えていません）`;
    })
    .catch(() => undefined);
}
