// 研究手順の一覧（段階22-4）。定跡帳の ⋯「研究手順の一覧（n本）」で出す（前は定跡帳のタブに 1 本ずつ並べていた）。
// 1 行は ★名前・メモの最初の 1 行・手数・日付、右に次の稽古の日。押すとその研究手順の終わりの局面。行の ⋯：稽古・名前・メモ・消す（確認あり）。
// 段階25-2：「選んで消す」で何本もまとめて消せる（確認あり。保存は 1 回）。
// 定跡帳のタブの「定跡帳ごとに 1 行」で使う、次の稽古の日の言葉もここ

import { useEffect, useState } from 'preact/hooks';
import { Dialog } from '../components/Dialog';
import { SHOW } from './hidden';
import { Words } from '../components/Words';
import { dueText } from '../practice/practice';
import { firstLine, studyMovesText } from '../tree/studies';
import type { Study } from '../tree/types';
import { ensureGames, gameList } from './games';
import { ensurePractice, planNow, practiceRecords } from './practice';
import { go } from './router';
import { library, removeStudies, removeStudy, updateStudyFields } from './studies';
import { StudyEditDialog } from './StudyDialogs';
import { allTemplates } from './TemplateDialogs';

/** 次の稽古の日を言葉にする道具（稽古の記録と実戦の棋譜を読むだけ） */
export function useStudyDue(studies: readonly Study[]) {
  const records = practiceRecords.value;
  const games = gameList.value;
  useEffect(() => {
    ensurePractice().catch(() => undefined);
    ensureGames().catch(() => undefined);
  }, []);
  const plan = records && games ? planNow(studies, records, games, allTemplates()) : null;
  const todayIds = new Set(plan?.today.map((i) => i.study.id) ?? []);
  /** 研究手順 1 本の次の稽古の日（今日の稽古に入っていれば「今日」。分からなければ null） */
  const dueOf = (s: Study): string | null => (!records ? null : todayIds.has(s.id) ? '今日' : records.has(s.id) ? dueText(records.get(s.id), Date.now()) : null);
  /** 何本かのまとまりの次の稽古の日：今日のものがあれば「今日」、無ければいちばん早い日。どれも稽古していなければ「はじめて」 */
  const dueOfAll = (list: readonly Study[]): string | null => {
    if (!records) return null;
    if (list.some((s) => todayIds.has(s.id))) return '今日';
    const next = list.flatMap((s) => records.get(s.id) ?? []).sort((a, b) => a.dueAt - b.dueAt)[0];
    return next ? dueText(next, Date.now()) : 'はじめて';
  };
  return { records, plan, dueOf, dueOfAll };
}

export function DueText({ due }: { due: string | null }) {
  if (!due) return null;
  return (
    <span class={due === '今日' ? 'study-due today' : 'study-due'} data-testid="study-due">
      {due === 'はじめて' ? '稽古はまだ' : `稽古 ${due}`}
    </span>
  );
}

/** 研究手順の一覧の窓。onOpen：行を押した。onChanged：⋯ で直した・消した */
export function StudyListDialog({
  studies,
  onOpen,
  onChanged,
  onClose,
}: {
  studies: readonly Study[];
  onOpen: (study: Study) => void;
  onChanged: () => void;
  onClose: () => void;
}) {
  const [menu, setMenu] = useState<Study | null>(null);
  /** ⋯ で直した・消した一言（窓の後ろの知らせは見えないので、窓の中に出す） */
  const [message, setMessage] = useState('');
  // 今日の稽古は、研究手順すべてから決まる（一覧の分だけで数えると、稽古のタブと食い違う）
  const { dueOf } = useStudyDue(library.value ?? studies);
  // 段階25-2：選んで消す（null は選んでいないふだんの一覧）
  const [selected, setSelected] = useState<ReadonlySet<string> | null>(null);
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [busy, setBusy] = useState(false);
  /** 選んだうち、今も一覧にあるもの */
  const picked = studies.filter((s) => selected?.has(s.id));

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  }

  async function removePicked() {
    if (busy || picked.length === 0) return;
    setBusy(true);
    try {
      await removeStudies(picked.map((s) => s.id));
      setSelected(null);
      setMessage(`研究手順 ${picked.length} 本を消しました`);
      onChanged();
    } catch (e) {
      setMessage(`消せませんでした（${e instanceof Error ? e.message : String(e)}）`);
    }
    setConfirmBulk(false);
    setBusy(false);
  }

  return (
    <>
      <Dialog title={`研究手順の一覧（${studies.length}本）`} onClose={onClose} testId="study-list-dialog" sheet>
        {message && (
          <p class="muted" role="status" data-testid="study-list-message">
            {message}
          </p>
        )}
        {studies.length === 0 && <p class="muted">研究手順はまだありません。盤で指すと研究手順ができます。</p>}
        {studies.length > 0 && !selected && (
          <div class="btn-row">
            <button
              type="button"
              class="btn"
              data-testid="study-select"
              onClick={() => {
                setMessage('');
                setSelected(new Set());
              }}
            >
              選んで消す
            </button>
          </div>
        )}
        {selected && (
          <div class="btn-row">
            <button type="button" class="btn" data-testid="study-select-all" onClick={() => setSelected(new Set(studies.map((s) => s.id)))}>
              全部選ぶ
            </button>
            <button type="button" class="btn" data-testid="study-select-none" onClick={() => setSelected(new Set())}>
              全部外す
            </button>
            <button type="button" class="btn btn-ghost" data-testid="study-select-cancel" onClick={() => setSelected(null)}>
              やめる
            </button>
          </div>
        )}
        <div class="tree-group">
          <ul class="tree-list">
            {studies.map((s) =>
              selected ? (
                <li class="tree-row" key={s.id}>
                  <label class="tree-item study-row-item study-select-row" data-testid="study-select-item">
                    <input type="checkbox" checked={selected.has(s.id)} onChange={() => toggle(s.id)} />
                    <StudyRowText study={s} />
                    <DueText due={dueOf(s)} />
                  </label>
                </li>
              ) : (
                <StudyRow key={s.id} study={s} due={dueOf(s)} onOpen={() => onOpen(s)} onMenu={() => setMenu(s)} />
              ),
            )}
          </ul>
        </div>
        {selected && studies.length > 0 && (
          <div class="study-delete-bar">
            <button type="button" class="btn btn-danger btn-wide" data-testid="study-select-delete" disabled={picked.length === 0} onClick={() => setConfirmBulk(true)}>
              {picked.length} 本を消す
            </button>
          </div>
        )}
      </Dialog>
      {confirmBulk && (
        <Dialog title={`研究手順 ${picked.length} 本を消しますか？`} onClose={() => setConfirmBulk(false)} testId="study-bulk-dialog">
          <p>元に戻せません。</p>
          <div class="dialog-actions">
            <button type="button" class="btn btn-danger" data-testid="study-bulk-ok" disabled={busy} onClick={() => void removePicked()}>
              {picked.length} 本を消す
            </button>
            <button type="button" class="btn" onClick={() => setConfirmBulk(false)}>
              やめる
            </button>
          </div>
        </Dialog>
      )}
      {menu && (
        <StudyMenu
          study={menu}
          onClose={() => setMenu(null)}
          onDone={(text) => {
            setMenu(null);
            setMessage(text);
            onChanged();
          }}
        />
      )}
    </>
  );
}

/** 研究手順の行の中身（★名前・メモの最初の 1 行・手数・日付） */
function StudyRowText({ study }: { study: Study }) {
  const note = SHOW.comments ? firstLine(study.note) : '';
  return (
    <span class="study-row-text">
      <span class="tree-item-title">
        {/* ★ は名前の中に入れる（長い名前が折り返しても、★ だけの行にならないように） */}
        <span class="tree-item-name">
          <span class="study-star" aria-hidden="true">
            ★
          </span>
          <Words text={study.name} />
        </span>
      </span>
      {note && (
        <span class="tree-item-meta study-item-note" data-testid="study-item-note">
          {note}
        </span>
      )}
      <span class="tree-item-meta num">
        {study.moves.length} 手・{formatShortDate(study.updatedAt)}
      </span>
    </span>
  );
}

/** 研究手順の 1 行（右に次の稽古の日と ⋯） */
function StudyRow({ study, due, onOpen, onMenu }: { study: Study; due: string | null; onOpen: () => void; onMenu: () => void }) {
  return (
    <li class="tree-row">
      <button type="button" class="tree-item study-row-item" data-testid="study-item" onClick={onOpen}>
        <StudyRowText study={study} />
        <DueText due={due} />
      </button>
      <button type="button" class="btn tree-menu-btn" aria-label={`「${study.name}」の操作`} data-testid="study-menu" onClick={onMenu}>
        ⋯
      </button>
    </li>
  );
}

/** 研究手順の行の ⋯ のメニュー：稽古・名前・メモを直す・消す（確認あり） */
function StudyMenu({ study, onClose, onDone }: { study: Study; onClose: () => void; onDone: (message: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState(false);

  async function save(f: { name: string; note: string; mySide: Study['mySide'] }) {
    await updateStudyFields(study, f);
    onDone(`研究手順「${f.name.trim()}」を直しました`);
  }

  async function remove() {
    await removeStudy(study.id);
    onDone(`研究手順「${study.name}」を消しました`);
  }

  if (editing) {
    return (
      <StudyEditDialog
        study={study}
        defaultName={study.name}
        movesText={studyMovesText(study, allTemplates())}
        side={study.mySide}
        onSave={(f) => void save(f)}
        onClose={onClose}
      />
    );
  }
  return (
    <Dialog title={`★ ${study.name}`} onClose={onClose} testId="study-menu-dialog" sheet>
      <div class="dialog-actions dialog-actions-column">
        <button type="button" class="btn btn-primary" data-testid="study-menu-review" onClick={() => go(`/practice/play/${study.id}`)}>
          稽古
        </button>
        <button type="button" class="btn" data-testid="study-menu-edit" onClick={() => setEditing(true)}>
          {SHOW.comments ? '名前・メモ' : '名前を直す'}
        </button>
      </div>
      <div class="dialog-actions">
        {!confirm ? (
          <button type="button" class="btn btn-danger" data-testid="study-menu-delete" onClick={() => setConfirm(true)}>
            消す…
          </button>
        ) : (
          <>
            <span>この研究手順を消しますか？元に戻せません。</span>
            <button type="button" class="btn btn-danger" data-testid="study-menu-delete-ok" onClick={() => void remove()}>
              消す
            </button>
            <button type="button" class="btn" onClick={() => setConfirm(false)}>
              やめる
            </button>
          </>
        )}
      </div>
    </Dialog>
  );
}

/** 「今日 14:05」「昨日」「11/17」「2025/11/17」のような短い日付 */
export function formatShortDate(ms: number, now: number = Date.now()): string {
  const d = new Date(ms);
  const today = new Date(now);
  const pad = (n: number) => String(n).padStart(2, '0');
  const dayStart = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((dayStart(today) - dayStart(d)) / 86_400_000);
  if (days === 0) return `今日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (days === 1) return '昨日';
  if (d.getFullYear() === today.getFullYear()) return `${d.getMonth() + 1}/${d.getDate()}`;
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}
