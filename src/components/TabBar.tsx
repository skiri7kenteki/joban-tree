// 画面の下のタブ（段階11-1。段階19 から 定跡帳／稽古／実戦／設定）。一覧の画面にだけ出す（盤のある画面では出さない）。
// タブを押すと URL が変わる（履歴に積まれるので、戻るボタンで前のタブに戻れる）。アイコンは手書きの簡単な図形（SVG）。

import { go, route, TAB_PATHS, type TabName } from '../app/router';

interface TabDef {
  name: TabName;
  label: string;
  testId: string;
  icon: preact.JSX.Element;
}

/** 下のタブ。設定の行のアイコンにも同じ絵を使う */
export const TABS: TabDef[] = [
  {
    name: 'home',
    label: '定跡帳',
    testId: 'tab-studies',
    // 開いた本
    icon: (
      <>
        <path d="M3 5.5c3-1.2 6-1 9 1 3-2 6-2.2 9-1V19c-3-1-6-.8-9 1-3-1.8-6-2-9-1z" />
        <path d="M12 6.5V20" />
      </>
    ),
  },
  {
    name: 'practice',
    label: '稽古',
    testId: 'tab-practice',
    // チェックの付いたカード
    icon: (
      <>
        <rect x="3.5" y="4" width="17" height="16" rx="2.5" />
        <path d="M8 12.5l3 3 5-6" />
      </>
    ),
  },
  {
    name: 'games',
    label: '実戦',
    testId: 'tab-games',
    // 駒の形（段階18）
    icon: <path d="M12 3l6 3 1.5 14h-15L6 6z" />,
  },
  {
    name: 'settings',
    label: '設定',
    testId: 'tab-settings',
    // 歯車
    icon: (
      <>
        <circle cx="12" cy="12" r="3" />
        <circle cx="12" cy="12" r="6.5" />
        <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" />
      </>
    ),
  },
];

export function TabBar({ current }: { current: TabName }) {
  return (
    <nav class="tabbar" aria-label="画面の切り替え" data-testid="tabbar">
      <div class="tabbar-inner">
        {TABS.map((t) => (
          <button
            type="button"
            key={t.name}
            class={t.name === current ? 'tabbar-tab on' : 'tabbar-tab'}
            aria-current={t.name === current ? 'page' : undefined}
            data-testid={t.testId}
            onClick={() => {
              // 今のタブをもう一度押しても何もしない（設定の下の画面で設定を押したときは設定の目次へ）
              const r = route.value;
              if (t.name !== current || r.name !== t.name || (r.name === 'settings' && r.page)) go(TAB_PATHS[t.name]);
            }}
          >
            <svg class="tabbar-icon" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
              {t.icon}
            </svg>
            <span class="tabbar-label">{t.label}</span>
          </button>
        ))}
      </div>
    </nav>
  );
}
