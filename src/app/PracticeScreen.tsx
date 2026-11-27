// 稽古のタブ（段階19、#/practice。前の「復習」のタブを置きかえた。持ち主の判断 2026-11-24「おすすめの通りで」）。
// - 集計：今日の稽古・身についた（1 週以上空くところまで進んだ / 稽古できる研究手順）・前回まちがい
// - ［今日の稽古を始める（n本）］→ 今日の稽古を 1 本ずつ続けて（#/practice/play）
// - 段階26-1：今日・これからとも定跡帳ごとの見出しで畳む（今日は初めは開き、これからは閉じる）。中は手順の近い順の 1 行 44px
// - 今日の定跡帳の順は稽古する順（実戦で違う手 → 前回まちがい → 日が来た → はじめて〔1 日 5 本まで〕）、これからは次の稽古の日の近い順
// - 行を押すとその 1 本だけ稽古（前倒しもできる）。見出しの［まとめて稽古］はその定跡帳の全部
// 計算は src/practice/practice.ts・groups.ts、記録は IndexedDB の practice

import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { groupPractice, practiceRowLabel, type PracticeGroup } from '../practice/groups';
import { REASON_TEXT, dueText, summarizePractice, type PracticeReason } from '../practice/practice';
import type { Study } from '../tree/types';
import { ensureGames, gameList } from './games';
import { gameDate } from './GamesScreen';
import { ensurePractice, planNow, practiceRecords } from './practice';
import { collapsedGroups, toggleGroup } from './recent';
import { go } from './router';
import { ensureStudies, library } from './studies';
import { allTemplates, myTemplates, refreshMyTemplates } from './TemplateDialogs';

const REASON_CLASS: Record<PracticeReason, string> = {
  game: 'kind-tag kind-mine',
  wrong: 'kind-tag kind-opp',
  due: 'kind-tag',
  new: 'kind-tag',
};

export function PracticeScreen() {
  const studies = library.value;
  const records = practiceRecords.value;
  const games = gameList.value;
  const [error, setError] = useState('');
  void myTemplates.value;

  useEffect(() => {
    const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e));
    ensureStudies().catch(fail);
    ensurePractice().catch(fail);
    ensureGames().catch(fail);
    if (!myTemplates.value) void refreshMyTemplates().catch(() => undefined);
  }, []);

  const templates = allTemplates();
  if (error) return <p class="status-ng">{error}</p>;
  if (!studies || !records || !games) return <p class="muted">読み込み中…</p>;
  const now = Date.now();
  const plan = planNow(studies, records, games, templates, now);
  const summary = summarizePractice(studies, records, plan.today.length, templates);

  return (
    <>
      <div class="screen-header list-header">
        <h1 class="page-title">稽古</h1>
        <span class="muted num" data-testid="practice-today-count">
          今日 {plan.today.length}本
        </span>
        <span class="spacer" />
      </div>

      <div class="card book-summary practice-summary" data-testid="practice-summary">
        <div class="book-summary-cell">
          <span class="book-summary-label">今日の稽古</span>
          <span class="book-summary-value num" data-testid="practice-summary-today">
            {summary.today}
            <small>本</small>
          </span>
        </div>
        <div class="book-summary-cell">
          <span class="book-summary-label">身についた</span>
          <span class="book-summary-value num" data-testid="practice-summary-learned">
            {summary.learned}
            <small>/ {summary.total}本</small>
          </span>
        </div>
        <div class="book-summary-cell">
          <span class="book-summary-label">前回まちがい</span>
          <span class="book-summary-value num" data-testid="practice-summary-wrong">
            {summary.wrong}
            <small>本</small>
          </span>
        </div>
      </div>

      {studies.length === 0 ? (
        <p class="muted" data-testid="practice-empty">
          研究手順がまだありません。定跡帳で研究手順を作ると、ここで 1 本ずつ通して稽古できます。
        </p>
      ) : (
        <>
          <div class="btn-row">
            <button type="button" class="btn btn-primary btn-wide" data-testid="practice-start" disabled={plan.today.length === 0} onClick={() => go('/practice/play')}>
              {plan.today.length > 0 ? `今日の稽古を始める（${plan.today.length}本）` : '今日の稽古は終わりました'}
            </button>
          </div>

          {plan.today.length > 0 && (
            <>
              <SectionTitle title="今日" count={plan.today.length} />
              <div data-testid="practice-today">
                {groupPractice(plan.today, studies, records, templates).map((g) => (
                  // 「今日」は初めは開いている（閉じたら覚える）
                  <GroupBlock key={g.key} group={g} openKey={`practice-today:${g.key}`} openAtFirst meta={`今日 ${g.items.length}本`}>
                    {g.items.map((item) => (
                      <PracticeRow key={item.study.id} testId="practice-item" reason={item.reason} study={item.study} label={practiceRowLabel(item.study, g.pool, templates)}>
                        <span class={REASON_CLASS[item.reason]}>{REASON_TEXT[item.reason]}</span>
                      </PracticeRow>
                    ))}
                  </GroupBlock>
                ))}
              </div>
            </>
          )}

          {plan.later.length > 0 && (
            <>
              <SectionTitle title="これから" count={plan.later.length} />
              <div data-testid="practice-later">
                {groupPractice(plan.later, studies, records, templates).map((g) => (
                  // 「これから」は初めは閉じている（開いたら覚える）
                  <GroupBlock key={g.key} group={g} openKey={`practice-later:${g.key}`} meta={g.nextDue === undefined ? '' : `次は ${gameDate(g.nextDue)}`}>
                    {g.items.map(({ study, record }) => (
                      <PracticeRow key={study.id} testId="practice-later-item" study={study} label={practiceRowLabel(study, g.pool, templates)}>
                        <span class="practice-row-due num">{dueText(record, now)}</span>
                      </PracticeRow>
                    ))}
                  </GroupBlock>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </>
  );
}

function SectionTitle({ title, count }: { title: string; count: number }) {
  return (
    <div class="practice-section">
      <h2>{title}</h2>
      <span class="muted num">{count}本</span>
    </div>
  );
}

/** 定跡帳 1 つ分：見出し（押すと開閉。右に［まとめて稽古］）と、開いていれば細い行の一覧 */
function GroupBlock<T>({ group: g, openKey, openAtFirst = false, meta, children }: { group: PracticeGroup<T>; openKey: string; openAtFirst?: boolean; meta: string; children: ComponentChildren }) {
  // 覚えるのは「初めの形から変えた」見出しの key（定跡帳のタブ・ツリーの一覧と同じ置き場所）
  const open = collapsedGroups.value.includes(openKey) !== openAtFirst;
  return (
    <section class="practice-group" data-testid="practice-group" data-key={g.key}>
      <div class="practice-group-row">
        <button type="button" class="practice-group-head" aria-expanded={open} data-testid="practice-group-head" onClick={() => toggleGroup(openKey)}>
          <span class="tree-group-caret" aria-hidden="true">
            {open ? '▼' : '▶'}
          </span>
          <span class="practice-group-names">
            <span class="practice-group-name">{g.name}</span>
            <span class="practice-group-meta num" data-testid="practice-group-meta">
              身についた {g.learned}／{g.total}
              {meta && `・${meta}`}
            </span>
          </span>
        </button>
        <button type="button" class="btn practice-group-all" data-testid="practice-group-all" onClick={() => go(`/practice/group/${encodeURIComponent(g.key)}`)}>
          まとめて稽古
        </button>
      </div>
      {open && <ul class="practice-rows">{children}</ul>}
    </section>
  );
}

/** 1 行 44px。押すとその 1 本だけ稽古（日が来ていなくても前倒しでできる） */
function PracticeRow({ testId, reason, study, label, children }: { testId: string; reason?: PracticeReason; study: Study; label: string; children: ComponentChildren }) {
  return (
    <li>
      <button type="button" class="practice-row" data-testid={testId} data-reason={reason} data-study={study.id} onClick={() => go(`/practice/play/${study.id}`)}>
        <span class="practice-row-text">{label}</span>
        {children}
      </button>
    </li>
  );
}
