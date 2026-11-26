// 段階25-2：KIF の取り込みの直後に、定跡帳のタブの一言の下に出す［取り消す］（何を消すかは src/tree/bulkDelete.ts）

import { useState } from 'preact/hooks';
import { Dialog } from '../components/Dialog';
import { deleteMyTemplate } from '../storage/templates';
import { planImportUndo } from '../tree/bulkDelete';
import { ensureStudies, removeStudies, type importUndo } from './studies';
import { refreshMyTemplates } from './TemplateDialogs';

type Undo = NonNullable<typeof importUndo.value>;

export function ImportUndoButton({ undo, onDone }: { undo: Undo; onDone: (message: string) => void }) {
  /** 確認の窓に出すもの（null なら窓を閉じている） */
  const [plan, setPlan] = useState<ReturnType<typeof planImportUndo> | null>(null);
  const [busy, setBusy] = useState(false);

  async function open() {
    setPlan(planImportUndo(undo, await ensureStudies()));
  }

  async function run() {
    if (!plan || busy) return;
    setBusy(true);
    try {
      // 消した記録は id が同じものだけに効かせる（ほかの端末に前からある同じ手順は、同期しても消さない）
      await removeStudies(
        plan.remove.map((s) => s.id),
        { onlyId: true },
      );
      onDone(`取り込みを取り消しました（研究手順 ${plan.remove.length} 本${await dropTemplate(plan.dropTemplate)}）`);
    } catch (e) {
      setPlan(null);
      setBusy(false);
      onDone(`取り消せませんでした（${e instanceof Error ? e.message : String(e)}）`);
    }
  }

  /** 一緒に作った戦型を消して、一言の後ろの部分を返す。研究手順はもう消えているので、失敗しても「取り消せませんでした」にはしない */
  async function dropTemplate(drop: boolean): Promise<string> {
    if (!drop) return 'を消しました';
    try {
      await deleteMyTemplate(undo.templateId!);
      await refreshMyTemplates();
      return `と戦型「${undo.templateName}」を消しました`;
    } catch {
      return `を消しました。戦型「${undo.templateName}」は消せませんでした。「戦型から選ぶ」の ⋯ から消せます`;
    }
  }

  return (
    <>
      <div class="btn-row">
        <button type="button" class="btn" data-testid="import-undo" onClick={() => void open()}>
          取り消す（取り込んだ {undo.studyIds.length} 本を消す）
        </button>
      </div>
      {plan && (
        <Dialog title="取り込みを取り消しますか？" onClose={() => setPlan(null)} testId="import-undo-dialog">
          <p>
            取り込んだ {plan.remove.length} 本を消します。
            {plan.dropTemplate && `一緒に作った戦型「${undo.templateName}」も消します。`}
            元に戻せません。
          </p>
          <div class="dialog-actions">
            <button type="button" class="btn btn-danger" data-testid="import-undo-ok" disabled={busy || plan.remove.length === 0} onClick={() => void run()}>
              消す
            </button>
            <button type="button" class="btn" onClick={() => setPlan(null)}>
              やめる
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}
