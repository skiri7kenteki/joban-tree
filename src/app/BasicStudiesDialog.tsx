// 「基本の研究を入れる」の窓（段階20-3、v0.46.0〜。計算は src/tree/basicStudies.ts）。
// 「＋ 研究手順を登録」から開く。組（戦型 × 自分の側）ごとに手順を並べ、チェックしたものを研究手順として入れる。
// 同じ手順がすでにあるものは「入れてあります」で選べない。入れたら、その戦型の出発点で定跡帳を開く

import { useMemo, useState } from 'preact/hooks';
import { Dialog } from '../components/Dialog';
import { BASIC_SETS, basicRows, basicToAdd, lineEnd, type BasicRow, type BasicSet } from '../tree/basicStudies';
import { newStudyId } from '../tree/studies';
import { allTemplates } from './TemplateDialogs';
import { bookTemplatePath, go } from './router';
import { applyStudyChange, studiesNow } from './studies';

export function BasicStudiesDialog({ onClose }: { onClose: () => void }) {
  const templates = allTemplates();
  // 開いたときに 1 回だけ作る（id と作った日時を固定する）
  const sets = useMemo(() => {
    const now = Date.now();
    return BASIC_SETS.map((set) => ({ set, rows: basicRows(set, templates, studiesNow(), now, newStudyId) })).filter(
      (x): x is { set: BasicSet; rows: BasicRow[] } => x.rows !== null,
    );
  }, []);
  /** チェックした行（初めは、まだ無いものを全部） */
  const [picked, setPicked] = useState<Set<string>>(() => new Set(sets.flatMap((x) => x.rows.filter((r) => !r.have).map((r) => r.study.id))));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const adding = sets.flatMap((x) => basicToAdd(x.rows, picked));

  function toggle(id: string) {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  }

  async function add() {
    if (adding.length === 0 || busy) return;
    setBusy(true);
    try {
      await applyStudyChange({ put: adding, remove: [] });
      // 入れた組（最初の 1 つ）の戦型の出発点で定跡帳を開く
      const first = sets.find((x) => x.rows.some((r) => adding.includes(r.study)));
      const template = first && templates.find((t) => t.id === first.set.templateId);
      onClose();
      if (first && template) go(bookTemplatePath(`study:${template.group}|${first.set.mySide}`, template.id));
    } catch (e) {
      setError(`入れられませんでした（${e instanceof Error ? e.message : String(e)}）`);
      setBusy(false);
    }
  }

  return (
    <Dialog title="基本の研究を入れる" onClose={onClose} testId="basic-dialog" sheet>
      {sets.length === 0 && <p class="muted">入れられる基本の研究はありません。</p>}
      {sets.map(({ set, rows }) => (
        <section key={set.id} class="basic-set" data-testid="basic-set">
          <p class="basic-set-head">
            <strong>{set.name}</strong>
            <span class="muted num">・{rows.length} 本</span>
            {!set.reviewed && (
              <span class="chip chip-small chip-unverified" data-testid="basic-unreviewed">
                未確認
              </span>
            )}
          </p>
          <p class="muted memo-sub">定跡の解説などに載っている手順です。入れた後は、自分の研究手順と同じように直せます。</p>
          <ul class="basic-list">
            {rows.map((r) => (
              <li key={r.study.id}>
                <label class={r.have ? 'basic-row basic-have' : 'basic-row'} data-testid="basic-row">
                  <input
                    type="checkbox"
                    data-testid="basic-check"
                    checked={!r.have && picked.has(r.study.id)}
                    disabled={!!r.have || busy}
                    onChange={() => toggle(r.study.id)}
                  />
                  <span class="basic-text">
                    <span class="basic-name">★ {r.study.name}</span>
                    <small class="muted">{r.have ? `入れてあります（★ ${r.have.name}）` : lineEnd(r)}</small>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {error && (
        <p class="status-ng" role="alert">
          {error}
        </p>
      )}
      <div class="dialog-actions">
        <button type="button" class="btn btn-primary" data-testid="basic-add" disabled={adding.length === 0 || busy} onClick={() => void add()}>
          {adding.length > 0 ? `${adding.length} 本を定跡帳に入れる` : '入れるものがありません'}
        </button>
        <button type="button" class="btn dialog-action-end" onClick={onClose}>
          やめる
        </button>
      </div>
    </Dialog>
  );
}
