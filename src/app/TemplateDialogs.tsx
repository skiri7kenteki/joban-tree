// 戦型の小窓（段階5）。
// - TemplatePicker：「戦型から選ぶ」。グループ → 戦型 → 選ぶ。自分で登録した戦型は「自分で登録」の印と ⋯（直す・消す）。
//   グループの一覧の下に、登録した戦型の書き出し・取り込み（段階5-2）。
// - RegisterTemplateDialog：「この局面を戦型として登録」（入力画面・閲覧画面から）。名前・グループ・メモを入れて保存する。
//   同じ手順の戦型（同梱・自分で登録）が既にあれば、そのことを示して登録できないようにする（段階5の手直し）。
// 一覧の名前は、グループ名で始まるならそこを省いて出す（listName。データの name はそのまま）。
// 登録した戦型は端末の中（IndexedDB）にだけ保存する。

import { signal } from '@preact/signals';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Dialog } from '../components/Dialog';
import type { Side } from '../shogi/position';
import { deleteMyTemplate, listMyTemplates, putMyTemplates, type StoredTemplate } from '../storage/templates';
import { fileNameOf } from '../tree/backup';
import {
  BUNDLED_TEMPLATES,
  checkTemplateFields,
  findSameMoves,
  groupTemplates,
  listName,
  newTemplateId,
  parseTemplatesJson,
  planImport,
  resolveImport,
  templatesToJson,
  type ConflictChoice,
  type ImportPlan,
  type OpeningTemplate,
} from '../tree/templates';
import { OUTCOME_TEXT, shareFile } from './share';

/** 自分で登録した戦型（読み込む前は null） */
export const myTemplates = signal<StoredTemplate[] | null>(null);

export async function refreshMyTemplates(): Promise<StoredTemplate[]> {
  const list = await listMyTemplates();
  myTemplates.value = list;
  return list;
}

/** 同梱と自分で登録したものを合わせた一覧（同梱が先） */
export function allTemplates(): OpeningTemplate[] {
  return [...BUNDLED_TEMPLATES, ...(myTemplates.value ?? [])];
}

/** 保存する（同じ id があれば、登録した日はそのまま） */
async function saveMine(list: readonly OpeningTemplate[]): Promise<void> {
  const now = Date.now();
  const current = myTemplates.value ?? (await refreshMyTemplates());
  await putMyTemplates(
    list.map((t, i) => ({ ...t, createdAt: current.find((c) => c.id === t.id)?.createdAt ?? now + i, updatedAt: now })),
  );
  await refreshMyTemplates();
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

type Mode =
  | { kind: 'list' }
  | { kind: 'edit'; t: StoredTemplate }
  | { kind: 'delete'; t: StoredTemplate }
  | { kind: 'conflict'; plan: ImportPlan };

/** 「戦型から選ぶ」：グループの一覧 → 戦型の一覧 → 選ぶ */
export function TemplatePicker({ onPick, onClose }: { onPick: (t: OpeningTemplate) => void; onClose: () => void }) {
  const [group, setGroup] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>({ kind: 'list' });
  const [message, setMessage] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    refreshMyTemplates().catch((e: unknown) => setMessage(`登録した戦型を読めませんでした（${errorText(e)}）`));
  }, []);

  const mine = myTemplates.value ?? [];
  const mineIds = new Set(mine.map((t) => t.id));
  const groups = groupTemplates(allTemplates());
  const chosen = group === null ? null : groups.find((g) => g.group === group) ?? null;

  function backToList(msg: string) {
    setMode({ kind: 'list' });
    setMessage(msg);
  }

  async function exportMine() {
    setMessage('');
    if (mine.length === 0) return;
    // 共有ボタンを押した直後に共有メニューを出す（iPad の Safari 対策で、ここより前に await を挟まない）
    const outcome = await shareFile(fileNameOf('序盤ツリーの戦型', 'json'), templatesToJson(mine), 'application/json');
    setMessage(OUTCOME_TEXT[outcome]);
  }

  async function onFile(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    setMessage('');
    const result = parseTemplatesJson(await file.text());
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    const current = myTemplates.value ?? (await refreshMyTemplates());
    const plan = planImport(result.templates, current, BUNDLED_TEMPLATES);
    if (plan.conflicts.length > 0) setMode({ kind: 'conflict', plan });
    else await applyImport(plan, 'skip');
  }

  async function applyImport(plan: ImportPlan, choice: ConflictChoice) {
    const { put, skipped } = resolveImport(plan, choice);
    try {
      if (put.length > 0) await saveMine(put);
    } catch (e) {
      backToList(`取り込めませんでした（${errorText(e)}）`);
      return;
    }
    const notes = [`${put.length} 件の戦型を取り込みました。`];
    if (plan.same > 0) notes.push(`${plan.same} 件は同じものがあるので取り込みませんでした。`);
    if (skipped > 0) notes.push(`${skipped} 件は id が重なるので取り込みませんでした。`);
    backToList(notes.join(''));
  }

  async function remove(t: StoredTemplate) {
    try {
      await deleteMyTemplate(t.id);
      await refreshMyTemplates();
    } catch (e) {
      backToList(`消せませんでした（${errorText(e)}）`);
      return;
    }
    backToList(`「${t.name}」を消しました。`);
  }

  if (mode.kind === 'edit') {
    const t = mode.t;
    return (
      <Dialog title="戦型を直す" onClose={onClose} testId="template-picker">
        <TemplateForm
          initial={t}
          saveLabel="保存"
          onSave={async (f) => {
            await saveMine([{ ...t, ...f }]);
            if (group === t.group && f.group !== t.group) setGroup(f.group);
            backToList(`「${f.name}」を保存しました。`);
          }}
          onCancel={() => backToList('')}
        />
        <div class="dialog-actions template-danger">
          <button type="button" class="btn btn-danger" data-testid="template-delete" onClick={() => setMode({ kind: 'delete', t })}>
            この戦型を消す…
          </button>
        </div>
      </Dialog>
    );
  }

  if (mode.kind === 'delete') {
    const t = mode.t;
    return (
      <Dialog title={`「${t.name}」を消しますか？`} onClose={onClose} testId="template-picker">
        <p>自分で登録したこの戦型を一覧から消します。元に戻せません。この戦型から作ったツリーは消えません。</p>
        <div class="dialog-actions">
          <button type="button" class="btn btn-danger" data-testid="template-delete-ok" onClick={() => void remove(t)}>
            消す
          </button>
          <button type="button" class="btn" data-testid="template-delete-cancel" onClick={() => setMode({ kind: 'edit', t })}>
            やめる
          </button>
        </div>
      </Dialog>
    );
  }

  if (mode.kind === 'conflict') {
    const { plan } = mode;
    const ownCount = plan.conflicts.filter((c) => !c.bundled).length;
    const bundledCount = plan.conflicts.length - ownCount;
    return (
      <Dialog title="同じ id の戦型があります" onClose={onClose} testId="template-conflict">
        <p>
          取り込む {plan.fresh.length + plan.same + plan.conflicts.length} 件のうち、{plan.conflicts.length} 件は同じ id で中身の違う戦型が既にあります。
          {bundledCount > 0 && `（${bundledCount} 件はアプリに入っている戦型と重なっています。アプリの戦型は置き換えません）`}
        </p>
        <ul class="template-conflict-list">
          {plan.conflicts.map((c) => (
            <li key={c.incoming.id}>{c.incoming.name}</li>
          ))}
        </ul>
        <div class="dialog-actions dialog-actions-column">
          {ownCount > 0 && (
            <button type="button" class="btn btn-danger" data-testid="import-replace" onClick={() => void applyImport(plan, 'replace')}>
              置き換える（登録してある方は消える）
            </button>
          )}
          <button type="button" class="btn btn-primary" data-testid="import-both" onClick={() => void applyImport(plan, 'both')}>
            両方残す（別の戦型として足す）
          </button>
          <button type="button" class="btn" data-testid="import-skip" onClick={() => void applyImport(plan, 'skip')}>
            重なるものは取り込まない
          </button>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog title={chosen ? chosen.group : '戦型から選ぶ'} onClose={onClose} testId="template-picker">
      {!chosen ? (
        <>
          <p class="muted">戦型の出発点の局面から始めます。選んだ後に、手順を前後したり盤上で指したりもできます。</p>
          <ul class="template-list">
            {groups.map((g) => (
              <li key={g.group}>
                <button type="button" class="template-item" data-testid="template-group" onClick={() => setGroup(g.group)}>
                  <span class="template-item-main">
                    <span class="template-item-name">{g.group}</span>
                  </span>
                  <span class="muted num">{g.templates.length}</span>
                  <span aria-hidden="true">›</span>
                </button>
              </li>
            ))}
          </ul>
          <div class="template-io">
            <p class="muted">自分で登録した戦型：{mine.length} 件</p>
            <div class="btn-row">
              <button type="button" class="btn" data-testid="template-export" disabled={mine.length === 0} onClick={() => void exportMine()}>
                書き出す（JSON）
              </button>
              <button type="button" class="btn" data-testid="template-import" onClick={() => fileRef.current?.click()}>
                取り込む
              </button>
              <input ref={fileRef} type="file" accept=".json,application/json" hidden data-testid="template-import-file" onChange={(e) => void onFile(e)} />
            </div>
          </div>
        </>
      ) : (
        <>
          <button type="button" class="btn btn-ghost" data-testid="template-back" onClick={() => setGroup(null)}>
            ‹ グループ
          </button>
          <ul class="template-list">
            {chosen.templates.map((t) => {
              const own = mineIds.has(t.id) ? mine.find((m) => m.id === t.id)! : null;
              return (
                <li key={t.id} class="template-row">
                  <button type="button" class="template-item" data-testid="template-item" onClick={() => onPick(t)}>
                    <span class="template-item-main">
                      <span class="template-item-name">
                        {listName(t)}
                        {own && (
                          <span class="chip chip-small chip-mine" data-testid="template-mine">
                            自分で登録
                          </span>
                        )}
                        {!t.reviewed && (
                          <span class="chip chip-small chip-unverified" data-testid="template-unreviewed">
                            未確認
                          </span>
                        )}
                      </span>
                      {t.note && <span class="template-item-note muted">{t.note}</span>}
                    </span>
                  </button>
                  {own && (
                    <button
                      type="button"
                      class="btn btn-ghost template-menu"
                      aria-label={`「${t.name}」を直す・消す`}
                      data-testid="template-menu"
                      onClick={() => {
                        setMessage('');
                        setMode({ kind: 'edit', t: own });
                      }}
                    >
                      ⋯
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
      {message && (
        <p class="muted" role="status" data-testid="template-message">
          {message}
        </p>
      )}
    </Dialog>
  );
}

type Fields = { name: string; group: string; note: string };

/** 名前・グループ・メモの入力欄 */
function TemplateForm({
  initial,
  saveLabel,
  blocked = false,
  onSave,
  onCancel,
}: {
  initial: Fields;
  saveLabel: string;
  /** 保存できない（理由は呼ぶ側が上に出す） */
  blocked?: boolean;
  /** 保存する（失敗したら例外） */
  onSave: (f: Fields) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial.name);
  const [group, setGroup] = useState(initial.group);
  const [note, setNote] = useState(initial.note);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const groups = groupTemplates(allTemplates()).map((g) => g.group);

  useEffect(() => {
    if (!myTemplates.value) void refreshMyTemplates().catch(() => undefined);
  }, []);

  async function save() {
    const f = { name: name.trim(), group: group.trim(), note: note.trim() };
    const problem = checkTemplateFields(f);
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    try {
      await onSave(f);
    } catch (e) {
      setError(`保存できませんでした（${errorText(e)}）`);
      setSaving(false);
    }
  }

  return (
    <>
      <label class="form-field">
        <span>名前</span>
        <input type="text" value={name} maxLength={100} data-testid="template-name" onInput={(e) => setName((e.target as HTMLInputElement).value)} />
      </label>
      <label class="form-field">
        <span>グループ</span>
        <input
          type="text"
          value={group}
          maxLength={50}
          placeholder="例）横歩取り"
          data-testid="template-group-input"
          onInput={(e) => setGroup((e.target as HTMLInputElement).value)}
        />
      </label>
      {/* 今あるグループは押すだけで選べる（新しいグループは上の欄に入れる）。「登録する」と紛らわしくないよう、枠線だけのチップ */}
      {groups.length > 0 && (
        <div class="template-group-choices" role="group" aria-label="今あるグループ">
          {groups.map((g) => (
            <button
              type="button"
              key={g}
              class={g === group.trim() ? 'group-choice on' : 'group-choice'}
              aria-pressed={g === group.trim()}
              data-testid="group-choice"
              onClick={() => setGroup(g)}
            >
              {g}
            </button>
          ))}
        </div>
      )}
      <label class="form-field">
        <span>メモ（なくてもよい）</span>
        <textarea class="template-note-input" rows={3} maxLength={1000} value={note} data-testid="template-note-input" onInput={(e) => setNote((e.target as HTMLTextAreaElement).value)} />
      </label>
      {error && (
        <p class="notice notice-danger" role="alert" data-testid="template-error">
          {error}
        </p>
      )}
      <div class="dialog-actions">
        <button type="button" class="btn btn-primary" data-testid="template-save" disabled={saving || blocked} onClick={() => void save()}>
          {saveLabel}
        </button>
        <button type="button" class="btn" onClick={onCancel}>
          やめる
        </button>
      </div>
    </>
  );
}

/** 「この局面を戦型として登録」 */
export function RegisterTemplateDialog({
  moves,
  mySide,
  defaultName,
  defaultGroup,
  onSaved,
  onClose,
}: {
  /** 平手の初期局面からの手順 */
  moves: readonly string[];
  mySide: Side;
  defaultName: string;
  defaultGroup: string;
  onSaved: (t: OpeningTemplate) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    void refreshMyTemplates().catch(() => undefined);
  }, []);
  // 同じ手順の戦型が既にあるか（同梱を先に見る）
  const same = findSameMoves(allTemplates(), moves);
  const sameIsMine = same !== null && (myTemplates.value ?? []).some((t) => t.id === same.id);

  return (
    <Dialog title="この局面を戦型として登録" onClose={onClose} testId="template-register">
      <p class="muted">
        平手の初期局面から {moves.length} 手の局面を、自分は{mySide === 'black' ? '☗先手' : '☖後手'}の戦型として登録します。「戦型から選ぶ」に出ます。
      </p>
      {same && (
        <p class="notice" role="status" data-testid="template-same">
          この局面は「{same.name}」として、すでにあります
          {sameIsMine
            ? '（自分で登録した戦型）。名前やメモを直すなら、「戦型から選ぶ」の一覧の ⋯ から直してください。'
            : '（アプリに入っている戦型）。同じ局面は登録できません。'}
        </p>
      )}
      <TemplateForm
        initial={{ name: defaultName, group: defaultGroup, note: '' }}
        saveLabel="登録する"
        blocked={same !== null}
        onSave={async (f) => {
          const t: OpeningTemplate = { id: newTemplateId(), ...f, mySide, moves: [...moves], reviewed: true };
          await saveMine([t]);
          onSaved(t);
        }}
        onCancel={onClose}
      />
    </Dialog>
  );
}
