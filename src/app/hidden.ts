// 画面に出すかどうかを、ここ 1 か所で決める（「機能の整理」の整理-2、持ち主の判断 2026-11-28）。
// false は画面から隠しているだけで、データとデータを扱うコードは残っている。true にすれば、また画面に出る。
// 隠していても、データはバックアップ・Google ドライブの同期に入り、KIF の書き出しのコメントにも今まで通り入る

export const SHOW: Readonly<Record<'comments' | 'mergeFile' | 'basicStudies' | 'studyJson', boolean>> = {
  /** 手のコメントの類：研究手順のメモ（名前は直せる）・局面メモ・候補の理由の、書く欄と表示 */
  comments: false,
  /** 設定の「データ管理」の［ほかの端末のバックアップを合わせる］（合わせる計算は Google ドライブの同期が使う） */
  mergeFile: false,
  /** 「＋ 研究手順を登録」の［基本の研究を入れる］ */
  basicStudies: false,
  /** 研究手順の JSON：「＋ 研究手順を登録」の［JSONを取り込む］と、書き出しの窓の［JSONで渡す］ */
  studyJson: false,
};
