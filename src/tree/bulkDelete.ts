// 段階25-2：取り込みの直後の［取り消す］で何を消すか（計算だけ。画面は src/app/ImportUndo.tsx）

import type { Study } from './types';

/** 1 回の KIF の取り込みで足したもの。端末には保存しない（定跡帳の一覧を離れるまで覚える） */
export interface ImportRecord {
  /** その取り込みで新しく足した研究手順の id */
  studyIds: readonly string[];
  /** その取り込みで一緒に作った戦型（前からあった戦型を使ったときは入れない） */
  templateId?: string;
}

/** 取り消すときに消すもの。戦型は、残る研究手順が記録していれば消さない */
export function planImportUndo(record: ImportRecord, studies: readonly Study[]): { remove: Study[]; dropTemplate: boolean } {
  const ids = new Set(record.studyIds);
  const remove = studies.filter((s) => ids.has(s.id));
  const dropTemplate = record.templateId !== undefined && !studies.some((s) => !ids.has(s.id) && s.templateId === record.templateId);
  return { remove, dropTemplate };
}
