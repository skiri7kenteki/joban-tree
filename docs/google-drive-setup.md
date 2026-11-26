# Google ドライブで同期するための準備（PC で一度だけ）

アプリが Google ドライブを使えるように、Google 側で「このアプリ」を登録します。お金はかかりません（15 分ほど）。

- 作った結果として手に入るのは **クライアント ID**（このアプリを Google に知らせる番号。`…apps.googleusercontent.com` で終わる文字）です。**秘密ではありません**
- 一緒に出る **クライアント シークレット（秘密の鍵）は使いません**。どこにも貼らず、送らないでください
- Google の画面の言葉は変わることがあり、日本語の表示名は確認できていないので、**英語の名前**も書いています。見つからない・違う画面が出たら、そこで止めて、画面の文字を教えてください

## 1. プロジェクトを作る
1. PC のブラウザで https://console.cloud.google.com を開き、**同期に使う自分の Google アカウント**でログインする（初めてなら利用規約に同意する）
2. 画面の上のプロジェクトの切り替え → 「新しいプロジェクト」（New Project）→ 名前は例えば `joban-sync` → 作成
3. 画面の上で、いま作ったプロジェクトが選ばれていることを確かめる

## 2. Google Drive API を有効にする
1. https://console.cloud.google.com/flows/enableapi?apiid=drive.googleapis.com を開く
2. 作ったプロジェクトを選んで、**有効にする（Enable）**

## 3. アプリの情報と、使える人を決める
1. https://console.cloud.google.com/auth/overview を開く（**Google Auth Platform**）→ **開始（Get started）**
2. アプリ名は `将棋定跡帳`、サポートのメール・連絡先は自分のメール。**ロゴは入れない**（入れると Google の審査が必要になる）
3. **対象（Audience）の User type** を選ぶ。どちらか：

| | 内容 |
|---|---|
| **Personal（個人用）— 出ていればおすすめ** | 登録した自分の Google アカウントだけが使える。審査は不要で、7 日で許可が切れる制限も無い。**一度選ぶと、あとで変えられない**（変えたいときはプロジェクトを作り直す）。ほかの人には使わせられない |
| **External（外部）** | どの Google アカウントでも使える形。選んだら、次の 4 をする |

「Personal」の選択肢が出ないときは、https://console.cloud.google.com/auth/overview/personal を開くと案内が出ることがあります。出なければ External にします。

## 4. （External を選んだときだけ）公開する
1. https://console.cloud.google.com/auth/audience を開く
2. **アプリを公開（Publish app）** を押して、公開の状態を **本番環境（In production）** にする
   - 「テスト（Testing）」のままだと、許可が 7 日で切れます
3. **審査（Verification）を求められたら、そこで止めて、画面の文字を教えてください**

## 5. クライアント ID を作る
1. https://console.cloud.google.com/auth/clients を開く → **クライアントを作成（Create client）**
2. アプリケーションの種類は **ウェブ アプリケーション（Web application）**。名前は例えば `joban-web`
3. 次の 2 つを、**一字も違えずに**入れる：
   - 承認済みの JavaScript 生成元（Authorized JavaScript origins）：
     ```
     https://skiri7kenteki.github.io
     ```
   - 承認済みのリダイレクト URI（Authorized redirect URIs）。**最後の `/` まで必要**：
     ```
     https://skiri7kenteki.github.io/joban-tree/
     ```
4. **作成（Create）** → 出てきた **クライアント ID** をコピーする
   - 反映まで 5 分〜数時間かかることがあります
   - 6 か月使わないクライアントは、Google が自動で消します

## 6. クライアント ID を伝える
クライアント ID（`…apps.googleusercontent.com`）を、開発の会話に貼ってください。アプリに入れて公開します。

## 7. ログインを確かめる（公開の後）
スマホ・iPad の**ホーム画面に追加したアプリ**と、ふつうのブラウザの両方で確かめます。

1. 画面の下の版が新しくなったことを確かめる
2. 設定 → データ → **［Google にログインして確かめる］**
3. Google の画面でアカウントを選んで許可する
   - 「このアプリは Google で確認されていません」と出たら、画面の文字を教えてください（自分で作ったアプリなので、「詳細」から進めます）
4. アプリに戻って、**「ドライブに届きました（このアプリのファイル 0 個）。」**と出れば成功

うまくいかないときは、次を教えてください：どの端末で、ホーム画面のアプリかブラウザか／どこで止まったか（Google の画面の文字、戻った後の赤い文字）／アプリに戻らず別のブラウザが開いたか。

- `redirect_uri_mismatch` と出たら、5 の「承認済みのリダイレクト URI」の文字（`https`・最後の `/`）を確かめます

## 許可を取り消したいとき
https://myaccount.google.com/permissions で「将棋定跡帳」を選んで削除します。
