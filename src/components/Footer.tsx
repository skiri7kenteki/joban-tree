// 画面のいちばん下。左にバージョン（スマホに更新が届いたかを確かめるため）、右に「気づきを送る」。
//
// 気づきを送る：GitHub の Issue 作成画面を開く（「かんたん予定」と同じ仕組み）。
// アプリからは送信しない。開いた GitHub の画面で、利用者が自分で送る。
// リポジトリは公開なので、自動で入れるのは画面名・バージョン・日付だけ（ツリーや棋譜は入れない）。

import { useState } from 'preact/hooks';
import { route, type Route } from '../app/router';
import { Dialog } from './Dialog';

export const APP_VERSION = import.meta.env.VITE_APP_VERSION;
const ISSUE_NEW_URL = 'https://github.com/skiri7kenteki/joban-tree/issues/new';

const SCREEN_NAME: Record<Route['name'], string> = { home: '一覧', new: '新しいツリー', tree: 'ツリー', study: '研究手順', book: '定跡帳', 'study-import': 'KIF から取り込む', settings: '設定', review: '復習', 'study-review': '研究手順の復習' };

/** Issue 作成画面の URL（タイトルと本文の下書き入り） */
export function buildIssueUrl(text: string, screen: string, today: Date = new Date()): string {
  const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const title = `【気づき】${text}`;
  const body = [`画面：${screen}`, `アプリのバージョン：${APP_VERSION}`, `日付：${date}`, '', 'どうなってほしいか：', ''].join('\n');
  return `${ISSUE_NEW_URL}?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
}

export function Footer() {
  const [open, setOpen] = useState(false);
  return (
    <footer class="footer">
      <span class="num" data-testid="app-version">
        v{APP_VERSION}
      </span>
      <button type="button" class="btn btn-ghost footer-feedback" data-testid="feedback-open" onClick={() => setOpen(true)}>
        気づきを送る
      </button>
      {open && <FeedbackDialog onClose={() => setOpen(false)} />}
    </footer>
  );
}

function FeedbackDialog({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState('');
  const [hint, setHint] = useState('');
  // ホーム画面アプリ（iPad）から普通のリンクを開くと、Safari 本体ではなくアプリに重なる画面で開く。
  // 先頭を x-safari-https:// にすると Safari 本体で開く（ホーム画面アプリのときだけ）
  const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const url = buildIssueUrl(text.trim(), SCREEN_NAME[route.value.name]);

  return (
    <Dialog title="気づきを送る" onClose={onClose} testId="feedback-dialog">
      <input
        type="text"
        maxLength={100}
        placeholder="気づいたことを一行で"
        aria-label="気づいたこと"
        value={text}
        data-testid="feedback-text"
        onInput={(e) => setText((e.target as HTMLInputElement).value)}
      />
      <p class="muted">GitHub の Issue（公開の掲示板）に送ります。個人的な内容は書かないでください。ツリーや棋譜は送られません。</p>
      {hint && (
        <p class="status-ng" role="status">
          {hint}
        </p>
      )}
      <div class="dialog-actions">
        <button type="button" class="btn" onClick={onClose}>
          やめる
        </button>
        <a
          class="btn btn-primary"
          data-testid="feedback-send"
          href={standalone ? url.replace('https://', 'x-safari-https://') : url}
          target={standalone ? '_self' : '_blank'}
          rel="noopener"
          onClick={(e) => {
            if (!text.trim()) {
              e.preventDefault();
              setHint('気づいたことを入力してください');
              return;
            }
            // オフラインだと Safari がエラーになるので開かない（書いた文は残す）
            if (!navigator.onLine) {
              e.preventDefault();
              setHint('ネットにつながっていません。つながってからもう一度押してください');
              return;
            }
            setTimeout(onClose, 0);
          }}
        >
          GitHub で送る
        </a>
      </div>
    </Dialog>
  );
}
