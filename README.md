# Miku Prize Collector — PWA Version 1.0

Web公開用のPWA一式です。

## 内容
- `index.html` — 画面
- `styles.css` — UI / ホワイト・ダーク / 4種メインカラー
- `app.js` — 所持管理、検索、履歴、表示設定など
- `products.json` — 商品マスター（339件）
- `manifest.webmanifest` — PWA設定
- `service-worker.js` — オフラインキャッシュと更新処理
- `icons/` — PWA用MPC仮アイコン

## 公開条件
PWAとして動作させるには原則HTTPSで配信してください。
GitHub Pages / Cloudflare Pages / Netlify等の静的Webホスティングで利用できます。

## iPhone
1. 公開URLをSafariで開く
2. 共有ボタン
3. 「ホーム画面に追加」
4. ホーム画面のMPCアイコンから起動

## データ保存
Version 1.0では以下は端末のブラウザ内（localStorage）に保存されます。
- 所持 / 未所持
- 所持個数
- ほしい
- 閲覧履歴
- テーマ
- メインカラー
- 言語

同じURLでも別端末には自動同期されません。

## 商品データ更新
商品マスターは `products.json` に分離しています。
将来、新商品を追加するときはこのファイルを更新して公開先へ反映する構成です。
PWAは起動時に `products.json` の最新版をネットワークから取得し、取得できない場合はキャッシュ済みデータを利用します。

## 注意
外部の画像検索・フリマ検索・価格検索は外部サイトへ遷移します。
Miku Prize Collector自身が販売や価格算出を行う設計ではありません。

## GitHub Pagesで公開

ビルドやNode.js、APIキー、バックエンドは不要です。上記のファイルと
`icons/` をリポジトリ直下に配置しています。

1. GitHubのリポジトリ **Settings → Pages** を開きます。
2. **Build and deployment → Source** を **Deploy from a branch** にします。
3. ブランチを **main**、フォルダーを **/ (root)** にして **Save** します。
4. デプロイ完了後、以下を開きます。
   https://ntakumi1224-beep.github.io/miku-prize-collector/

HTML、商品JSON、マニフェスト、アイコン、Service Workerの参照はすべて相対パスです。
PWAの開始URL・スコープも `./` のため、`/miku-prize-collector/` 配下で動作します。
外部検索へのリンクのみ、外部サイトのHTTPS URLを使用します。

## ローカルで確認

親ディレクトリ `/workspace` で次を実行します（Python 3が必要です）。

```sh
python3 -m http.server 8000 --bind 127.0.0.1 --directory /workspace
```

ブラウザで `http://127.0.0.1:8000/miku-prize-collector/` を開くと、
GitHub Pagesと同じサブパスで確認できます。`file://` で直接開く方法では
JSONの取得やService Workerが動作しません。

初回はオンラインで開き、Service Workerのキャッシュ完了後はオフラインでも
商品一覧と所持管理を利用できます。外部検索はネット接続が必要です。
HTMLと商品JSONはネットワーク優先、CSS・JS・アイコンはキャッシュ優先です。
CSS・JS・アイコンを更新するときは `service-worker.js` の `CACHE_NAME` に使う
バージョンも更新してください。他のPagesプロジェクトのキャッシュは削除しません。

カメラ検索の利用には、以下の外部API設定が必要です。

## AIカメラ検索（作業ブランチ）

撮影／カメラロール選択 → 共通プレビュー → AI検索 → 参考候補3〜5件 → 商品詳細、
の流れを実装しています。候補を絞れない画像では撮り直しを案内します。
所持状態を自動変更せず、最終確認はユーザーが行います。

Cloudflare Workers、OpenAI API、Turnstileの設定が必要です。
初期状態の `config.js` は未設定のため、画像プレビューのみ利用できます。
**APIキーやSecretをフロントエンドに記入しないでください。**

初心者向けの設定手順とAPI契約は [カメラ検索の設定手順](docs/camera-setup.md) を参照してください。
`identify.js` が画面側の画像処理・API通信、`config.js` が公開設定、
`worker/` がAPIの実装です。Workerの依存関係はPagesの配信には不要です。

静的ファイルを取得するための相対パスは維持しています。画像認識APIとTurnstileのみ
外部HTTPS URLを使用します。画像・APIレスポンスはService Workerでキャッシュしません。
