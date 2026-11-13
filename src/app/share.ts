// ファイルの共有・ダウンロードと、クリップボードへのコピー。
// - 共有：Web Share API（スマホの「共有」メニュー。iPad ではここから「"ファイル"に保存」や AirDrop・LINE に渡せる）
// - 共有できない端末（Android の Chrome は .json・.kifu のファイル共有に対応していない、PC など）ではダウンロード
// iPhone/iPad の Safari は「ボタンを押した直後」でないと共有を断るので、呼ぶ前に await を挟まないこと。

export type ShareOutcome = 'shared' | 'downloaded' | 'cancelled';

/** ファイルを共有する（できなければダウンロード） */
export async function shareFile(fileName: string, text: string, mime: string): Promise<ShareOutcome> {
  const file = new File([text], fileName, { type: mime });
  if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: fileName });
      return 'shared';
    } catch (error) {
      // 利用者が共有メニューを閉じた
      if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled';
      // それ以外（許可されなかったなど）はダウンロードに切り替える
    }
  }
  download(file);
  return 'downloaded';
}

function download(file: File): void {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** 文字をクリップボードにコピーする。できたら true */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // 古い方法（クリップボード API が使えないとき）
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.append(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  }
}

export const OUTCOME_TEXT: Record<ShareOutcome, string> = {
  shared: '共有しました',
  downloaded: 'ファイルをダウンロードしました',
  cancelled: '',
};
