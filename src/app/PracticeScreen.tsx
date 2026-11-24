// 稽古のタブ（段階19、#/practice。前の「復習」のタブを置きかえた。持ち主の判断 2026-11-24「おすすめの通りで」）。
// - 集計：今日の稽古・身についた（1 週以上空くところまで進んだ / 稽古できる研究手順）・前回まちがい
// - ［今日の稽古を始める（n本）］→ 今日の稽古を 1 本ずつ続けて（#/practice/play）
// - 今日：実戦で違う手 → 前回まちがい → 日が来た → はじめて（1 日 5 本まで）。行を押すとその 1 本だけ稽古
// - これから：次の稽古の日の近い順。行を押すと前倒しで稽古できる
// 計算は src/practice/practice.ts、記録は IndexedDB の practice

import { useEffect, useState } from 'preact/hooks';
import { Words } from '../components/Words';
import { REASON_TEXT, dueText, summarizePractice, type PracticeReason } from '../practice/practice';
import { otherStudyKey, studyGroupKey } from '../tree/organize';
import type { Study } from '../tree/types';
import type { OpeningTemplate } from '../tree/templates';
import { ensureGames, gameList } from './games';
import { gameDate } from './GamesScreen';
import { ensurePractice, planNow, practiceRecords } from './practice';
import { go } from './router';
import { ensureStudies, library } from './studies';
import { allTemplates, myTemplates, refreshMyTemplates } from './TemplateDialogs';

const REASON_CLASS: Record<PracticeReason, string> = {
  game: 'kind-tag kind-mine',
  wrong: 'kind-tag kind-opp',
  due: 'kind-tag',
  new: 'kind-tag',
};

/** 研究手順のグループの名前（「横歩取り・☖後手」） */
export function studyGroupText(study: Study, templates: readonly OpeningTemplate[]): string {
  const key = studyGroupKey(study, templates);
  const side = study.mySide === 'black' ? '☗先手' : '☖後手';
  if (key === otherStudyKey(study.mySide)) return side;
  return `${key.slice(key.indexOf(':') + 1, key.lastIndexOf('|'))}・${side}`;
}

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
        <h1>稽古</h1>
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
              <h2 class="list-section-title">今日</h2>
              <ul class="tree-list" data-testid="practice-today">
                {plan.today.map((item) => (
                  <li class="tree-row" key={item.study.id}>
                    <button type="button" class="tree-item practice-item" data-testid="practice-item" data-reason={item.reason} onClick={() => go(`/practice/play/${item.study.id}`)}>
                      <span class="tree-item-name">
                        <span class="study-star" aria-hidden="true">
                          ★
                        </span>
                        <Words text={item.study.name} />
                      </span>
                      <span class="tree-item-meta">{studyGroupText(item.study, templates)}</span>
                      <span class="game-item-marks">
                        <span class={REASON_CLASS[item.reason]}>
                          {REASON_TEXT[item.reason]}
                          {item.reason === 'game' && item.gameAt !== undefined && `（${gameDate(item.gameAt)}）`}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}

          {plan.later.length > 0 && (
            <>
              <h2 class="list-section-title">これから</h2>
              <ul class="tree-list" data-testid="practice-later">
                {plan.later.map(({ study, record }) => (
                  <li class="tree-row" key={study.id}>
                    <button type="button" class="tree-item practice-item" data-testid="practice-later-item" onClick={() => go(`/practice/play/${study.id}`)}>
                      <span class="tree-item-name">
                        <span class="study-star" aria-hidden="true">
                          ★
                        </span>
                        <Words text={study.name} />
                      </span>
                      <span class="tree-item-meta num">
                        {studyGroupText(study, templates)}・次は {gameDate(record.dueAt)}（{dueText(record, now)}）
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </>
  );
}
