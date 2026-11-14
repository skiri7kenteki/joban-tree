// アプリ本体の入口。画面の切り替え（router.ts）に合わせて、トップ・入力・閲覧・設定・復習の画面を出す。
import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import './styles/base.css';
import './app/app.css';
import { Footer } from './components/Footer';
import { ensureCrossOriginIsolated, type IsolationState } from './isolation';
import { pruneOldBigFiles } from './engine/config';
import { route } from './app/router';
import { HomeScreen } from './app/HomeScreen';
import { InputScreen } from './app/InputScreen';
import { TreeScreen } from './app/TreeScreen';
import { SettingsScreen } from './app/SettingsScreen';
import { ReviewScreen } from './app/ReviewScreen';

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
  return (
    <div class="app" data-testid="isolation" data-state={isolation}>
      <main class="main">
        {r.name === 'home' && <HomeScreen isolationMessage={isolationMessage(isolation)} />}
        {r.name === 'new' && <InputScreen />}
        {r.name === 'tree' && <TreeScreen id={r.id} />}
        {r.name === 'settings' && <SettingsScreen />}
        {r.name === 'review' && <ReviewScreen id={r.id} />}
      </main>
      <Footer />
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

render(<App />, document.getElementById('root')!);
