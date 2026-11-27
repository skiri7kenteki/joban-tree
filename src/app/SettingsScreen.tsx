// 設定のタブ：グループの小見出し＋行の目次（設定の整理）。行を押すと下の画面（#/settings/<名前>。中身は SettingsPages.tsx）へ進む。
// 「気づきを送る」と「設定を初期値に戻す」は窓を開く。バージョン情報は版を出すだけ。

import { useEffect, useState } from 'preact/hooks';
import { APP_VERSION, FeedbackDialog, screenBeforeSettings } from '../components/Footer';
import { Dialog } from '../components/Dialog';
import { TABS } from '../components/TabBar';
import { lastSyncAt } from '../drive/state';
import { lastBackupAt } from '../storage/backup';
import { warsName } from './games';
import { backTo, go, type SettingsPage } from './router';
import { resetSettings, settings } from './settings';
import { driveChanged } from './syncing';
import { PAGES } from './SettingsPages';
import { evalSummary, lastBackupSummary, lastSyncSummary, skipSameSummary, warsNameSummary } from './settingsSummary';

export function SettingsScreen({ page }: { page?: SettingsPage }) {
  // 下の画面は、いつもいちばん上から見せる
  useEffect(() => window.scrollTo(0, 0), [page]);
  return page ? <SettingsSubScreen key={page} page={page} /> : <SettingsTop />;
}

/** 下の画面：上は「‹ 設定」と画面の名前 */
function SettingsSubScreen({ page }: { page: SettingsPage }) {
  const { title, Body } = PAGES[page];
  return (
    <>
      <div class="screen-header list-header settings-sub-header">
        <button
          type="button"
          class="btn btn-ghost btn-back btn-back-labeled"
          aria-label="‹ 設定"
          data-testid="settings-back"
          onClick={() => backTo('/settings')}
        >
          ‹<span class="back-text"> 設定</span>
        </button>
        <h1>{title}</h1>
      </div>
      <Body />
    </>
  );
}

/** 行のアイコン（手書きの SVG。稽古と実戦は下のタブと同じ絵） */
const tabIcon = (name: 'practice' | 'games') => TABS.find((t) => t.name === name)!.icon;
const ICONS = {
  practice: tabIcon('practice'),
  games: tabIcon('games'),
  // 円柱
  data: (
    <>
      <ellipse cx="12" cy="5.5" rx="7.5" ry="2.8" />
      <path d="M4.5 5.5v13c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8v-13M4.5 12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8" />
    </>
  ),
  // 雲
  sync: <path d="M7 18.5a4.5 4.5 0 01-.6-9 6 6 0 0111.5 1.2 3.9 3.9 0 01-.6 7.8z" />,
  // チップ
  engine: (
    <>
      <rect x="6" y="6" width="12" height="12" rx="2" />
      <rect x="9.5" y="9.5" width="5" height="5" />
      <path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3" />
    </>
  ),
  // 枝分かれ
  trees: (
    <>
      <circle cx="6" cy="12" r="2.2" />
      <circle cx="18" cy="6" r="2.2" />
      <circle cx="18" cy="18" r="2.2" />
      <path d="M8.2 12H12V6h3.8M12 12v6h3.8" />
    </>
  ),
  // 封筒
  feedback: (
    <>
      <rect x="3.5" y="5.5" width="17" height="13" rx="2" />
      <path d="M4 7l8 6 8-6" />
    </>
  ),
  // i
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5.5M12 7.8v.2" />
    </>
  ),
  // 丸い矢印
  reset: (
    <>
      <path d="M5 12a7 7 0 107-7H8" />
      <path d="M10.5 2L7.5 5l3 3" />
    </>
  ),
};

/** 1 行の中身：左にアイコンと名前、右に今の値と › */
function RowContent({ icon, name, value, valueTestId, arrow }: { icon: keyof typeof ICONS; name: string; value?: string; valueTestId?: string; arrow: boolean }) {
  return (
    <>
      <svg class="settings-row-icon" viewBox="0 0 24 24" aria-hidden="true">
        {ICONS[icon]}
      </svg>
      <span class="settings-row-name">{name}</span>
      <span class="settings-row-value num" data-testid={valueTestId}>
        {value}
      </span>
      {arrow && (
        <span class="settings-row-arrow" aria-hidden="true">
          ›
        </span>
      )}
    </>
  );
}

/** 下の画面へ進む行 */
function PageRow({ page, name, value }: { page: SettingsPage; name: string; value?: string }) {
  return (
    <button type="button" class="settings-row" data-testid={`settings-row-${page}`} onClick={() => go(`/settings/${page}`)}>
      <RowContent icon={page} name={name} value={value} valueTestId={`settings-value-${page}`} arrow />
    </button>
  );
}

function Group({ title, children }: { title: string; children: preact.ComponentChildren }) {
  return (
    <section>
      <h2 class="settings-group-title">{title}</h2>
      <div class="settings-list">{children}</div>
    </section>
  );
}

function SettingsTop() {
  // 同期中に目次へ戻った場合も、終わったら「最後の同期」の表示を新しくする
  void driveChanged.value;
  const s = settings.value;
  const [feedback, setFeedback] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  return (
    <>
      <div class="screen-header">
        <h1 class="page-title">設定</h1>
      </div>
      <Group title="学習">
        <PageRow page="practice" name="稽古" value={skipSameSummary(s.skipSameStart)} />
        <PageRow page="games" name="実戦" value={warsNameSummary(warsName.value)} />
      </Group>
      <Group title="データ">
        <PageRow page="data" name="データ管理" value={lastBackupSummary(lastBackupAt())} />
        <PageRow page="sync" name="Google ドライブで同期" value={lastSyncSummary(lastSyncAt())} />
      </Group>
      <Group title="くわしい設定">
        <PageRow page="engine" name="エンジン" value={evalSummary(s.evalId)} />
        <PageRow page="trees" name="ツリー（以前の機能）" />
      </Group>
      <Group title="サポート">
        <button type="button" class="settings-row" data-testid="feedback-open" onClick={() => setFeedback(true)}>
          <RowContent icon="feedback" name="気づきを送る" arrow />
        </button>
      </Group>
      <Group title="その他">
        <div class="settings-row">
          <RowContent icon="info" name="バージョン情報" value={`v${APP_VERSION}`} valueTestId="app-version" arrow={false} />
        </div>
        <button type="button" class="settings-row danger" data-testid="reset-settings" onClick={() => setConfirmReset(true)}>
          <RowContent icon="reset" name="設定を初期値に戻す" arrow={false} />
        </button>
      </Group>

      {feedback && <FeedbackDialog screen={screenBeforeSettings()} onClose={() => setFeedback(false)} />}
      {confirmReset && (
        <Dialog title="設定を初期値に戻す" onClose={() => setConfirmReset(false)} testId="reset-dialog">
          <p>すべての設定を初期値に戻しますか？（ツリーとウォーズの名前は消えません）</p>
          <div class="btn-row">
            <button
              type="button"
              class="btn btn-danger"
              data-testid="reset-confirm"
              onClick={() => {
                resetSettings();
                setConfirmReset(false);
              }}
            >
              戻す
            </button>
            <button type="button" class="btn" data-testid="reset-cancel" onClick={() => setConfirmReset(false)}>
              やめる
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
}
