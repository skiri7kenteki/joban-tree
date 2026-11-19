// 変化付き KIF から研究手順をまとめて取り込む画面（段階8-2、#/study-import。ロジックは src/tree/kifImport.ts）。
// 1. KIF を貼り付けるか、ファイルを選ぶ（.kif は Shift_JIS でも読める）
// 2. 確認の画面：何本の研究手順になるか、それぞれの名前の初期値と手数、メモの有無、自分の側（まとめて切り替え）、取り込むかどうかのチェック。
//    同じ手順がすでにあるものには「すでにあり」の印を付けて、初期値は取り込まない
// 3. 取り込む → トップ画面の研究手順のタブへ（「研究手順 n 本を取り込みました」）
// 本数が多くても画面が固まらないよう、候補は少しずつ作って進み具合を出す。

import { useRef, useState } from 'preact/hooks';
import type { Side } from '../shogi/position';
import { buildCandidates, candidateName, candidatesToStudies, decodeKifFile, kifSide, readKif, type KifCandidate } from '../tree/kifImport';
import { setHomeTab } from './recent';
import { back, go } from './router';
import { ensureStudies, homeNotice, saveStudies } from './studies';
import { allTemplates, myTemplates, refreshMyTemplates } from './TemplateDialogs';

const SIDE_TEXT: Record<Side, string> = { black: '☗先手', white: '☖後手' };

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

  async function read(source: string) {
    setError('');
    setCandidates(null);
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
    const chosen = candidates.filter((c) => checked.has(c.index));
    if (chosen.length === 0) return;
    setSaving(true);
    try {
      await saveStudies(candidatesToStudies(chosen, side, allTemplates(), Date.now()));
      const skipped = candidates.length - chosen.length;
      homeNotice.value = `研究手順 ${chosen.length} 本を KIF から取り込みました${skipped > 0 ? `（${skipped} 本は取り込みませんでした）` : ''}`;
      setHomeTab('studies');
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
        <button type="button" class="btn btn-ghost" onClick={back}>
          ‹ 戻る
        </button>
        <h1 class="tree-title">KIF から取り込む</h1>
      </div>

      {!candidates && (
        <div class="card kifu-box">
          <p class="muted">
            ShogiHome などで作った研究用の KIF（変化付き）を貼り付けるか、ファイルを選んでください。本譜とそれぞれの変化が、1 本ずつの研究手順になります。
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
                    <span class="kif-bulk-name">{candidateName(c, side, allTemplates())}</span>
                    <span class="muted kif-bulk-meta">
                      {c.moves.length} 手{c.note ? '・メモあり' : ''}
                      {c.noteCut ? '（長いので途中まで）' : ''}
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
