// 片付けた画面の URL を、新しい画面の該当する場所へ移す（段階10-2。ブックマークや、ほかの画面からの移動が壊れないように）。
//   #/study/<id>       → その研究手順の定跡帳（終わりの局面）
//   #/study/<id>/<手数> → その研究手順の定跡帳（その局面）
//   #/study/<id>/edit  → その研究手順の定跡帳（終わりの局面。定跡帳ではそのまま指して足せる）
//   #/new/study        → トップ画面の研究手順のタブで「研究手順を登録」の窓を開く
// 移るときは location.replace（履歴に古い URL を残さない。戻るボタンで行ったり来たりしないように）

import { useEffect, useState } from 'preact/hooks';
import { setHomeTab } from './recent';
import { go } from './router';
import { ensureStudies, library } from './studies';
import { myTemplates, refreshMyTemplates } from './TemplateDialogs';
import { studyBookUrl } from './addToBook';
import { registerRequest } from './HomeScreen';

/** 研究手順の画面の URL → その研究手順の定跡帳 */
export function StudyRedirect({ id, ply }: { id: string; ply?: number }) {
  const [error, setError] = useState('');
  const studies = library.value;
  // 定跡帳はグループ分けに自分で登録した戦型も使うので、読み終わるまで待つ
  const [templatesReady, setTemplatesReady] = useState(myTemplates.value !== null);
  useEffect(() => {
    ensureStudies().catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    if (!myTemplates.value)
      void refreshMyTemplates()
        .catch(() => undefined)
        .finally(() => setTemplatesReady(true));
  }, []);
  const study = studies?.find((s) => s.id === id);
  useEffect(() => {
    if (study && templatesReady) location.replace(`#${studyBookUrl(study, ply)}`);
  }, [study, templatesReady]);

  if (error) return <p class="status-ng">{error}</p>;
  if (!studies || !templatesReady || study) return <p class="muted">読み込み中…</p>;
  return (
    <>
      <div class="screen-header">
        <button type="button" class="btn btn-ghost" onClick={() => go('/')}>
          ‹ 一覧
        </button>
        <h1>研究手順</h1>
      </div>
      <p class="muted" data-testid="study-missing">
        この研究手順は見つかりませんでした（消されたかもしれません）。
      </p>
    </>
  );
}

/** 研究手順の登録の画面の URL → トップ画面で「研究手順を登録」の窓 */
export function RegisterRedirect() {
  useEffect(() => {
    registerRequest.value = true;
    setHomeTab('studies');
    location.replace('#/');
  }, []);
  return <p class="muted">読み込み中…</p>;
}
