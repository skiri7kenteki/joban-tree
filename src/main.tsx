// アプリ本体の入口。画面の切り替え（router.ts）に合わせて、トップ・入力・閲覧・設定・復習の画面を出す。
// 段階11-1：一覧の画面（定跡帳・ツリー・復習・設定のタブ）だけ、画面の下にタブを出す。バージョンと「気づきを送る」は設定のタブへ。
import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import './styles/base.css';
import './app/app.css';
import { TabBar } from './components/TabBar';
import { ensureCrossOriginIsolated, type IsolationState } from './isolation';
import { pruneOldBigFiles } from './engine/config';
import { route, tabOf } from './app/router';
import { HomeScreen } from './app/HomeScreen';
import { InputScreen } from './app/InputScreen';
import { TreeScreen } from './app/TreeScreen';
import { SettingsScreen } from './app/SettingsScreen';
import { PracticeScreen } from './app/PracticeScreen';
import { PracticePlayScreen } from './app/PracticePlayScreen';
import { ReviewScreen } from './app/ReviewScreen';
import { BookScreen } from './app/BookScreen';
import { RegisterRedirect, StudyRedirect } from './app/LegacyRedirect';
import { StudyReviewScreen } from './app/StudyReviewScreen';
import { StudyKifImportScreen } from './app/StudyKifImportScreen';
import { fixStudiesOnStart } from './app/studyFix';
import { askPersistIfData } from './storage/persist';
import { GamesScreen } from './app/GamesScreen';
import { GameScreen } from './app/GameScreen';
import { SyncOverlay, syncing } from './app/syncing';

function App() {
  const [isolation, setIsolation] = useState<IsolationState | 'checking'>('checking');

  useEffect(() => {
    ensureCrossOriginIsolated().then((state) => {
      setIsolation(state);
      // 古い版のエンジン・評価関数を端末から消す
      if (state === 'isolated') pruneOldBigFiles().catch(() => undefined);
    });
  }, []);

  const r = route.value;
  const tab = tabOf(r);
  return (
    <div class={tab ? 'app has-tabs' : 'app'} data-testid="isolation" data-state={isolation}>
      {/* 同期している間は、キーボードでも操作できないようにする */}
      <main class="main" inert={syncing.value}>
        {r.name === 'home' && <HomeScreen key="studies" list="studies" isolationMessage={isolationMessage(isolation)} />}
        {r.name === 'trees' && <HomeScreen key="trees" list="trees" isolationMessage={isolationMessage(isolation)} />}
        {r.name === 'practice' && <PracticeScreen />}
        {r.name === 'practice-play' && (
          <PracticePlayScreen
            key={`${r.study ?? ''}/${r.group ?? ''}`}
            target={r.group !== undefined ? { kind: 'group', key: r.group } : r.study ? { kind: 'one', studyId: r.study } : { kind: 'today' }}
          />
        )}
        {r.name === 'games' && <GamesScreen />}
        {r.name === 'game' && <GameScreen key={r.id} id={r.id} />}
        {r.name === 'new' && (r.study ? <RegisterRedirect /> : <InputScreen />)}
        {r.name === 'tree' && <TreeScreen id={r.id} studyId={r.study} ply={r.ply} />}
        {r.name === 'study' && <StudyRedirect key={r.id} id={r.id} ply={r.ply} />}
        {r.name === 'book' && (
          <BookScreen key={`book:${r.key}:${r.line?.join('.') ?? ''}`} bookKey={r.key} id={r.study} ply={r.ply} template={r.template} line={r.line} />
        )}
        {r.name === 'study-import' && <StudyKifImportScreen />}
        {r.name === 'settings' && <SettingsScreen />}
        {r.name === 'review' && !r.studies && <ReviewScreen key={r.id} id={r.id} />}
        {r.name === 'review' && r.studies && <StudyReviewScreen key={`tree/${r.id}`} target={{ kind: 'tree', treeId: r.id }} />}
      </main>
      {tab && <TabBar current={tab} />}
      <SyncOverlay />
    </div>
  );
}

/** エンジンが使えないときの説明（使えるなら null） */
function isolationMessage(state: IsolationState | 'checking'): string | null {
  switch (state) {
    case 'checking':
    case 'isolated':
      return null;
    case 'reloading':
      return '準備のため、ページを読み込み直しています…';
    case 'no-service-worker':
      return 'このブラウザでは、エンジン（将棋 AI）を動かす準備ができません。Safari か Chrome の新しい版で開いてください。';
    case 'failed':
      return 'エンジン（将棋 AI）を動かす準備ができませんでした。アプリを開き直してください。';
  }
}

// ずれてしまった研究手順（戦型の側・名前）を直す（段階10 の直し。直すものが無ければ何もしない）
fixStudiesOnStart();
// 段階17：研究手順かツリーが 1 つでもあれば、ブラウザにデータを消さないよう頼む（守られていれば何もしない）
void askPersistIfData();

render(<App />, document.getElementById('root')!);
