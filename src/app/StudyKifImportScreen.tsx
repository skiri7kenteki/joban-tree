// 変化付き KIF から研究手順をまとめて取り込む画面（段階8-2、#/study-import。ロジックは src/tree/kifImport.ts）。
// 1. KIF を貼り付けるか、ファイルを選ぶ（.kif は Shift_JIS でも読める）
// 2. 確認の画面：何本の研究手順になるか、それぞれの名前の初期値と手数、メモの有無、自分の側（まとめて切り替え）、取り込むかどうかのチェック。
//    同じ手順がすでにあるものには「すでにあり」の印を付けて、初期値は取り込まない
// 3. 取り込む → トップ画面の研究手順のタブへ（「研究手順 n 本を取り込みました」）
// 本数が多くても画面が固まらないよう、候補は少しずつ作って進み具合を出す。

import { useRef, useState } from 'preact/hooks';
import type { Side } from '../shogi/position';
import { deleteMyTemplate } from '../storage/templates';
import { autoTemplate, destinations, lacksOwnAfter, passesAll } from '../tree/importTemplate';
import { buildCandidates, candidateName, candidatesToStudies, decodeKifFile, kifSide, readKif, type KifCandidate } from '../tree/kifImport';
import type { OpeningTemplate } from '../tree/templates';
import { SHOW } from './hidden';
import { CreateTemplateDialog, NO_OWN_TEXT, PickTemplateDialog } from './ImportTemplate';
import { back, go } from './router';
import { ensureStudies, homeNotice, importUndo, saveStudies, studiesNow } from './studies';
import { allTemplates, myTemplates, refreshMyTemplates, saveMine } from './TemplateDialogs';

const SIDE_TEXT: Record<Side, string> = { black: '☗先手', white: '☖後手' };

/** 画面で選んだ・作った戦型（null は自動）。created：まだ保存していない新しい戦型 */
type Chosen = { template: OpeningTemplate; created: boolean } | null;

export function StudyKifImportScreen() {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [candidates, setCandidates] = useState<KifCandidate[] | null>(null);
  /** 取り込む候補（index） */
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [side, setSide] = useState<Side>('white');
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [chosen, setChosen] = useState<Chosen>(null);
  const [dialog, setDialog] = useState<'pick' | 'create' | null>(null);

  // 段階25-1：戦型の行。取り込む（チェックの付いた）手順から、使う戦型と行き先のグループを決める
  const picked = candidates?.filter((c) => checked.has(c.index)) ?? [];
  const lines = picked.map((c) => c.moves);
  /** 新しい戦型の側は、取り込みの自分の側 */
  const wanted = chosen ? (chosen.created ? { ...chosen.template, mySide: side } : chosen.template) : null;
  const used = wanted && lines.length > 0 && passesAll(wanted, lines) ? wanted : null;
  const usedNew = used !== null && chosen!.created;
  const templates = usedNew ? [...allTemplates(), used] : allTemplates();
  // 行き先を見せるための仮の研究手順（保存しない）
  let previewCount = 0;
  const preview = candidatesToStudies(picked, side, templates, 0, () => `preview-${previewCount++}`, used ?? undefined);
  const into = destinations(preview, templates);
  const auto = autoTemplate(lines, side, allTemplates());
  // 自動で決まる戦型が無いときの行の言葉
  const noAuto = into.length > 1 ? '戦型ごとに分かれます' : into.every((d) => d.label.startsWith('その他')) ? 'その他' : '手順から決まります';
  const rowName = used ? `${used.name}${usedNew ? '（新しい戦型）' : ''}` : (auto?.name ?? noAuto);
  const rowDetail =
    into.length === 0
      ? '取り込む手順にチェックを付けてください'
      : into.length === 1
        ? `「${into[0].label}」に入ります`
        : into.map((d) => `${d.label} ${d.count}本`).join('・');

  function choose(next: Chosen) {
    setChosen(next);
    setDialog(null);
  }

  async function read(source: string) {
    setError('');
    setCandidates(null);
    setChosen(null);
    const r = readKif(source);
    if (!r.ok) {
      setError(r.message);
      return;
    }
    try {
      if (!myTemplates.value) await refreshMyTemplates().catch(() => undefined);
      const templates = allTemplates();
      const existing = await ensureStudies();
      setProgress({ done: 0, total: r.ends.length });
      const list = await buildCandidates(r, templates, existing, (done, total) => setProgress({ done, total }));
      setSide(kifSide(r, templates, list.map((c) => c.moves)));
      setCandidates(list);
      setChecked(new Set(list.filter((c) => !c.existing).map((c) => c.index)));
    } catch (e) {
      setError(`読み取れませんでした（${e instanceof Error ? e.message : String(e)}）`);
    } finally {
      setProgress(null);
    }
  }

  async function onFile(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const body = decodeKifFile(await file.arrayBuffer());
    setText(body);
    await read(body);
  }

  function toggle(index: number) {
    const next = new Set(checked);
    if (next.has(index)) next.delete(index);
    else next.add(index);
    setChecked(next);
  }

  async function doImport() {
    if (!candidates || saving) return;
    if (picked.length === 0) return;
    setSaving(true);
    try {
      const list = candidatesToStudies(picked, side, templates, Date.now(), undefined, used ?? undefined);
      // 新しい戦型は、ここで初めて登録する（取り込まずにやめたら登録しない）
      if (usedNew) await saveMine([used]);
      try {
        await saveStudies(list);
      } catch (e) {
        // 研究手順を保存できなければ、今作った戦型も残さない
        if (usedNew) await deleteMyTemplate(used.id).then(refreshMyTemplates).catch(() => undefined);
        throw e;
      }
      const skipped = candidates.length - picked.length;
      const added = usedNew ? `戦型「${used.name}」を登録しました。` : '';
      const message = `研究手順 ${picked.length} 本を KIF から取り込みました${skipped > 0 ? `（${skipped} 本は取り込みませんでした）` : ''}${added ? `。${added}` : ''}`;
      homeNotice.value = message;
      importUndo.value = { message, studyIds: list.map((s) => s.id), ...(usedNew ? { templateId: used.id, templateName: used.name } : {}) };
      go('/');
    } catch (e) {
      setError(`保存できませんでした（${e instanceof Error ? e.message : String(e)}）`);
      setSaving(false);
    }
  }

  const existingCount = candidates?.filter((c) => c.existing).length ?? 0;

  return (
    <>
      <div class="screen-header">
        <button type="button" class="btn btn-ghost" onClick={() => back()}>
          ‹ 戻る
        </button>
        <h1 class="tree-title">KIF から取り込む</h1>
      </div>

      {!candidates && (
        <div class="card kifu-box">
          <p class="muted">
            変化付きの KIF を貼り付けるか、ファイルを選んでください。本譜と変化が 1 本ずつの研究手順になります。
          </p>
          <textarea
            class="kifu-input"
            rows={6}
            placeholder={'手合割：平手\n手数----指手---------消費時間--\n   1 ７六歩(77)\n…'}
            value={text}
            data-testid="kif-bulk-input"
            onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
          />
          <div class="btn-row">
            <button type="button" class="btn btn-primary" data-testid="kif-bulk-read" disabled={progress !== null} onClick={() => void read(text)}>
              読み取る
            </button>
            <button type="button" class="btn" data-testid="kif-bulk-file-open" disabled={progress !== null} onClick={() => fileRef.current?.click()}>
              ファイルを選ぶ
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".kif,.kifu,.ki2,.ki2u,.txt,text/plain"
              hidden
              data-testid="kif-bulk-file"
              onChange={(e) => void onFile(e)}
            />
          </div>
        </div>
      )}

      {progress && (
        <p class="muted" role="status" data-testid="kif-bulk-progress">
          読み取り中 {progress.done}／{progress.total}
        </p>
      )}
      {error && (
        <p class="status-ng" role="alert" data-testid="kif-bulk-error">
          {error}
        </p>
      )}

      {candidates && (
        <>
          <p data-testid="kif-bulk-summary">
            <strong>{candidates.length} 本</strong>の研究手順になります
            {existingCount > 0 ? `（同じ手順がすでにある ${existingCount} 本は外してあります）` : ''}。
          </p>
          <div class="side-choice side-choice-strong" role="radiogroup" aria-label="自分は">
            <span>自分は</span>
            {(['black', 'white'] as Side[]).map((s) => (
              <button
                type="button"
                key={s}
                role="radio"
                aria-checked={side === s}
                data-testid={`kif-bulk-side-${s}`}
                class={side === s ? 'btn btn-toggle on' : 'btn btn-toggle'}
                onClick={() => setSide(s)}
              >
                {SIDE_TEXT[s]}
              </button>
            ))}
          </div>
          <ul class="template-list">
            <li>
              <button type="button" class="template-item" data-testid="kif-bulk-template" disabled={lines.length === 0} onClick={() => setDialog('pick')}>
                <span class="muted">戦型</span>
                <span class="template-item-main">
                  <span class="template-item-name" data-testid="kif-bulk-template-name">
                    {rowName}
                  </span>
                  <span class="muted kif-bulk-template-detail" data-testid="kif-bulk-template-into">
                    {rowDetail}
                  </span>
                </span>
                <span aria-hidden="true">›</span>
              </button>
            </li>
          </ul>
          {wanted && !used && lines.length > 0 && (
            <p class="notice" role="status" data-testid="kif-bulk-template-off">
              選んだ戦型「{wanted.name}」は、チェックした手順の一部が通らないので使いません。
            </p>
          )}
          {usedNew && lacksOwnAfter(lines, side, used.moves.length) && (
            <p class="notice" role="status" data-testid="kif-bulk-template-warn">
              {NO_OWN_TEXT}
            </p>
          )}
          {dialog === 'pick' && (
            <PickTemplateDialog
              lines={lines}
              side={side}
              autoName={auto?.name ?? '手順から決める'}
              onAuto={() => choose(null)}
              onPick={(t) => choose({ template: t, created: false })}
              onCreate={() => setDialog('create')}
              onClose={() => setDialog(null)}
            />
          )}
          {dialog === 'create' && (
            <CreateTemplateDialog
              lines={lines}
              mainLine={lines[0]}
              side={side}
              studies={studiesNow()}
              onDone={(t, created) => choose({ template: t, created })}
              onClose={() => setDialog(null)}
            />
          )}
          <div class="btn-row">
            <button type="button" class="btn" data-testid="kif-bulk-all" onClick={() => setChecked(new Set(candidates.map((c) => c.index)))}>
              全部選ぶ
            </button>
            <button type="button" class="btn" data-testid="kif-bulk-none" onClick={() => setChecked(new Set())}>
              全部外す
            </button>
            <button
              type="button"
              class="btn btn-ghost"
              data-testid="kif-bulk-again"
              onClick={() => {
                setCandidates(null);
                setError('');
              }}
            >
              読み直す
            </button>
          </div>
          <ul class="kif-bulk-list">
            {candidates.map((c) => (
              <li key={c.index}>
                <label class="study-pick-item kif-bulk-row" data-testid="kif-bulk-row">
                  <input type="checkbox" checked={checked.has(c.index)} data-testid="kif-bulk-check" onChange={() => toggle(c.index)} />
                  <span class="kif-bulk-text">
                    <span class="kif-bulk-name">{candidateName(c, side, templates)}</span>
                    <span class="muted kif-bulk-meta">
                      {c.moves.length} 手{SHOW.comments && c.note ? '・メモあり' : ''}
                      {SHOW.comments && c.noteCut ? '（長いので途中まで）' : ''}
                      {c.existing && (
                        <span class="chip chip-small chip-unverified" data-testid="kif-bulk-exists">
                          すでにあり
                        </span>
                      )}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <div class="start-bar">
            <p class="start-bar-caption muted">自分は{SIDE_TEXT[side]}として取り込みます</p>
            <button type="button" class="btn btn-primary btn-wide" data-testid="kif-bulk-import" disabled={checked.size === 0 || saving} onClick={() => void doImport()}>
              {saving ? '取り込み中…' : `${checked.size} 本を取り込む`}
            </button>
          </div>
        </>
      )}
    </>
  );
}
