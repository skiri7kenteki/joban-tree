// 「ほかの端末のバックアップを合わせる」の確認の中身（段階22-2）：この端末で何が変わるか（種類ごとの 足す・新しくする・消す）と、消える研究手順の名前。
// 合わせる計算は src/tree/merge.ts、窓と書き込みは DataSection

import type { BackupFile } from '../tree/backupFile';
import { KIND_LABELS } from '../tree/backupFile';
import type { MergeKind, MergeResult } from '../tree/merge';

/** 画面に並べる順と名前 */
const ROWS: [MergeKind, string][] = [
  ['studies', '研究手順'],
  ['positions', '局面メモ・候補の表'],
  ['practice', '稽古の記録'],
  ['games', '実戦の棋譜'],
  ['templates', '自分で登録した戦型'],
  ['trees', 'ツリー'],
  ['reviews', '復習の記録'],
];

export function MergeSummary({ file, unknownKinds, result, when }: { file: BackupFile; unknownKinds: string[]; result: MergeResult; when: string }) {
  const rows = ROWS.filter(([k]) => result.summary[k].added + result.summary[k].updated + result.summary[k].removed > 0);
  return (
    <div data-testid="backup-merge-summary">
      <p class="muted">
        {when} に作ったバックアップ（アプリ v{file.appVersion}）
      </p>
      {rows.length === 0 ? (
        <p data-testid="merge-same">この端末に足りないものはありません。合わせても中身は変わりません。</p>
      ) : (
        <table class="merge-table">
          <thead>
            <tr>
              <th scope="col">
                <span class="merge-table-hidden">種類</span>
              </th>
              <th scope="col">足す</th>
              <th scope="col">新しくする</th>
              <th scope="col">消す</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([k, label]) => (
              <tr key={k} data-testid={`merge-row-${k}`}>
                <th scope="row">{label}</th>
                <td class="num">{result.summary[k].added}</td>
                <td class="num">{result.summary[k].updated}</td>
                <td class="num">{result.summary[k].removed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {result.removedStudies.length > 0 && (
        <div data-testid="merge-removed">
          <p>消える研究手順（ほかの端末で消したもの）：</p>
          <ul class="merge-removed">
            {result.removedStudies.map((name, i) => (
              <li key={i}>
                <strong>{name}</strong>
              </li>
            ))}
          </ul>
        </div>
      )}
      {result.shortened.length > 0 && (
        <div data-testid="merge-shortened">
          <p>手順が短くなる研究手順（ほかの端末で手を消したもの）：</p>
          <ul class="merge-removed">
            {result.shortened.map((s, i) => (
              <li key={i}>
                <strong>{s.name}</strong>（{s.from}手 → {s.to}手）
              </li>
            ))}
          </ul>
        </div>
      )}
      {result.split > 0 && (
        <p data-testid="merge-split">2 つの端末で別々の手を足した研究手順が {result.split} 本あります。どちらも残します。</p>
      )}
      {unknownKinds.length > 0 && (
        <p class="notice" data-testid="backup-unknown">
          このファイルには、この版のアプリが知らないデータ（{unknownKinds.map((k) => KIND_LABELS[k] ?? k).join('・')}）があります。それは入りません。
        </p>
      )}
      <p class="muted">設定は変えません。合わせる前のデータは端末の中に取っておき、［戻す前のデータに戻す］で元に戻せます。</p>
    </div>
  );
}
