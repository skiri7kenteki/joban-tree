// アプリ本体の入口。段階0では「土台が公開できること」の確認用に、最小限の画面だけを出す。
import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import './styles/base.css';
import { Footer } from './components/Footer';
import { ensureCrossOriginIsolated, type IsolationState } from './isolation';

function App() {
  const [isolation, setIsolation] = useState<IsolationState | 'checking'>('checking');

  useEffect(() => {
    ensureCrossOriginIsolated().then(setIsolation);
  }, []);

  return (
    <div class="app">
      <main class="main">
        <h1>序盤ツリー</h1>
        <div class="card">
          <p>いまは準備中です（段階0：土台づくりとエンジンの速度測定）。</p>
          <p class="muted" data-testid="isolation">
            エンジンを使う準備：{isolationText(isolation)}
          </p>
          <div class="btn-row">
            <a class="btn btn-primary" href={`${import.meta.env.BASE_URL}bench.html`}>
              エンジンの速度測定へ
            </a>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}

function isolationText(state: IsolationState | 'checking'): string {
  switch (state) {
    case 'checking':
      return '確認中…';
    case 'isolated':
      return 'OK';
    case 'reloading':
      return '再読み込みします…';
    case 'no-service-worker':
      return 'この端末のブラウザは service worker に対応していません';
    case 'failed':
      return 'できませんでした（もう一度開き直してください）';
  }
}

render(<App />, document.getElementById('root')!);
