// 画面のいちばん下。左にバージョン（スマホに更新が届いたかを確かめるため）
export const APP_VERSION = import.meta.env.VITE_APP_VERSION;

export function Footer() {
  return (
    <footer class="footer">
      <span class="num" data-testid="app-version">
        v{APP_VERSION}
      </span>
    </footer>
  );
}
