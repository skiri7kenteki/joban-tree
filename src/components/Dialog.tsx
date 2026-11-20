// 画面の上に重ねて出す小さな窓（確認・メニュー用）。ブラウザの <dialog> を使う。
// 表示するときだけ描く（{open && <Dialog …/>} の形で使う）。

import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';

export function Dialog({
  title,
  onClose,
  children,
  testId,
  sheet,
}: {
  title: string;
  /** 閉じるとき（外側を押す・Esc・閉じるボタン） */
  onClose: () => void;
  children: ComponentChildren;
  testId?: string;
  /** 画面の下から出す形（段階11-5 の棋譜欄など） */
  sheet?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  /** 画面から外すとき（自分で閉じる）。そのときの close では onClose を呼ばない */
  const leaving = useRef(false);

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    return () => {
      leaving.current = true;
      d?.close();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      class={sheet ? 'dialog dialog-sheet' : 'dialog'}
      data-testid={testId}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        // 窓の外側（背景）を押したら閉じる
        if (e.target === ref.current) onClose();
      }}
      // ブラウザが cancel を出さずに閉じたとき（Esc を続けて押したときなど）も、画面の状態を閉じたことにする
      // （閉じたのに開いているつもりのままだと、同じ窓をもう一度開けなくなる）
      onClose={() => {
        if (!leaving.current) onClose();
      }}
    >
      <div class="dialog-body">
        <div class="dialog-head">
          <h2>{title}</h2>
          <button type="button" class="btn btn-ghost" aria-label="閉じる" onClick={onClose}>
            ×
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
