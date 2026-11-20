// 復習のタブ（段階11-1）：ツリーと研究手順の復習を始める入口をまとめる。
//   - 定跡帳：研究手順のグループ（戦型 × 自分の側）ごと。押すとそのグループの研究手順の復習（#/study-review/group/<key>）
//   - ツリー：ツリーごと。押すとそのツリーの復習（#/review/<id>）
//   - それぞれに「前回まちがえた n 問・最後に復習 11/19」（今の記録から数える。src/review/overview.ts）
// 1 回の問題の数（段階11-4）は設定のタブで変える。

import { useEffect, useState } from 'preact/hooks';
import { loadAllReviews } from '../storage/review';
import { listTrees, type TreeSummary } from '../storage/trees';
import { recordOverview, overviewText, studyRecordKeys } from '../review/overview';
import { STUDY_RECORD_ID, reviewStart } from '../review/studyReview';
import type { ReviewRecord } from '../review/review';
import { groupStudies } from '../tree/organize';
import { studyStartIndex } from '../tree/studies';
import { go, groupReviewPath } from './router';
import { settings } from './settings';
import { ensureStudies, library } from './studies';
import { allTemplates, myTemplates, refreshMyTemplates } from './TemplateDialogs';

export function ReviewsScreen() {
  const [trees, setTrees] = useState<TreeSummary[] | null>(null);
  const [records, setRecords] = useState<ReviewRecord[] | null>(null);
  const [error, setError] = useState('');
  const studies = library.value;
  // 自分で登録した戦型も、グループ分けに使う（読み込んだら描き直す）
  void myTemplates.value;

  useEffect(() => {
    const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e));
    if (!myTemplates.value) void refreshMyTemplates().catch(() => undefined);
    ensureStudies().catch(fail);
    listTrees().then(setTrees, fail);
    loadAllReviews().then(setRecords, fail);
  }, []);

  const loading = !trees || !records || !studies;
  const templates = allTemplates();
  const studyRecord = records?.find((r) => r.treeId === STUDY_RECORD_ID);
  const groups = studies ? groupStudies(studies, templates, '') : [];

  return (
    <>
      <div class="screen-header">
        <h1>復習</h1>
        <span class="muted num" data-testid="reviews-batch">
          1 回 {settings.value.reviewBatch} 問
        </span>
      </div>
      {error && <p class="status-ng">{error}</p>}
      {loading && !error && <p class="muted">読み込み中…</p>}

      {!loading && (
        <>
          <h2 class="reviews-heading">定跡帳</h2>
          {groups.length === 0 && (
            <p class="muted" data-testid="reviews-studies-empty">
              研究手順はまだありません。
            </p>
          )}
          <ul class="tree-list">
            {groups.map((g) => {
              const keys = studyRecordKeys(g.items, (s) => reviewStart(s, studyStartIndex(s, templates)));
              return (
                <ReviewEntry
                  key={g.key}
                  testId="reviews-group"
                  title={g.label}
                  count={`${g.items.length} 本`}
                  meta={overviewText(recordOverview(studyRecord, keys))}
                  onStart={() => go(groupReviewPath(g.key))}
                />
              );
            })}
          </ul>

          <h2 class="reviews-heading">ツリー</h2>
          {trees.length === 0 && (
            <p class="muted" data-testid="reviews-trees-empty">
              ツリーはまだありません。
            </p>
          )}
          <ul class="tree-list">
            {trees.map((t) => (
              <ReviewEntry
                key={t.id}
                testId="reviews-tree"
                title={t.name}
                meta={overviewText(recordOverview(records.find((r) => r.treeId === t.id)))}
                onStart={() => go(`/review/${t.id}`)}
              />
            ))}
          </ul>
        </>
      )}
    </>
  );
}

/** 1 行：名前（と本数）・前回まちがえた数と最後に復習した日・右に「始める」。行のどこを押しても始まる */
function ReviewEntry({ title, count, meta, testId, onStart }: { title: string; count?: string; meta: string; testId: string; onStart: () => void }) {
  return (
    <li>
      <button type="button" class="tree-item review-entry" data-testid={testId} onClick={onStart}>
        <span class="review-entry-text">
          <span class="tree-item-title">
            <span class="tree-item-name">{title}</span>
            {count && <span class="tree-item-meta num">{count}</span>}
          </span>
          <span class="tree-item-meta" data-testid="reviews-overview">
            {meta}
          </span>
        </span>
        <span class="review-entry-start" aria-hidden="true">
          始める ›
        </span>
      </button>
    </li>
  );
}
