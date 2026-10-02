# カメラ検索の設定手順

フロントエンドはGitHub Pages、画像認識の中継はCloudflare Workers、
認識はOpenAI APIを使用します。CloudflareとOpenAIは別のアカウントが必要です。
ChatGPTの有料契約にAPI利用料は含まれません。

## 1. OpenAI APIを準備する

1. https://platform.openai.com/ にログインします。
2. API用のプロジェクトを作り、BillingでAPI利用の支払い設定を行います。
3. 使用量と通知の予算を設定します。予算通知だけで利用が停止するとは限りません。
4. プロジェクトのAPI keysでキーを作成します。使うモデルは `gpt-4.1-mini` です。
   モデルが利用できない場合は、画像入力とStructured Outputsに対応する利用可能モデルを
   `worker/wrangler.jsonc` の `OPENAI_MODEL` に指定します。
5. キーはCloudflareのSecretに登録します。チャット・GitHub・`config.js`には貼らないでください。

## 2. CloudflareとTurnstileを準備する

1. https://dash.cloudflare.com/ でアカウントを作成します。独自ドメインの購入は不要です。
2. Turnstileでウィジェットを追加し、Managed方式を選びます。
3. 許可ホスト名に `ntakumi1224-beep.github.io` を追加します。
4. 発行された **Site key** は公開設定用、**Secret key** はWorkersのSecret用です。
5. Workersの利用プラン・無料枠・上限を確認します。このAPIはSQLite Durable Objectsを
   利用します。アカウントで利用可能であることを確認してください。

## 3. 実装を確認してWorkersを公開する

この実装は作業ブランチにあります。`main`へはまだ反映していません。
レビュー済みの作業ブランチのファイルを使って、PCのターミナルで実行します。
Node.js 22以上とnpmが必要です（GitHub Pagesの閲覧には不要です）。

```sh
cd miku-prize-collector/worker
npm ci
npm test
npm run check
npx wrangler login
npm run deploy
```

`wrangler login` はブラウザでCloudflareへのログインを求めます。
`deploy` は外部への公開操作です。自動テストには含めていません。
表示された `https://miku-prize-collector-identify.<account>.workers.dev` を控えます。
Secret未登録の状態では認識APIは503を返し、OpenAIを呼び出しません。

同じ `worker/` ディレクトリで、次を実行して各キーを入力します。
入力された値はリポジトリには保存されません。

```sh
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put TURNSTILE_SECRET_KEY
```

Cloudflare管理画面のWorkers → 対象Worker → Settings → Variables and Secretsから
Secret型として登録する方法もあります。通常の公開変数型にはしないでください。

## 4. 公開用設定を入れる

リポジトリ直下の `config.js` の空欄に、次の **公開情報だけ** を設定します。

```js
window.MPC_CONFIG = Object.freeze({
  identifyApiUrl: 'https://miku-prize-collector-identify.<account>.workers.dev/api/identify',
  turnstileSiteKey: 'TurnstileのSite key'
});
```

設定を変更する際は `service-worker.js` のキャッシュバージョンも更新します。
Pages側の認識API URLはHTTPSの絶対URLです。これは別ホストへのAPI通信のためです。
静的ファイルの参照、PWAの開始URLとスコープは相対パスのままです。
CORSとTurnstileはオリジン／ホスト名単位であり、Pagesのサブパス単位の認証ではありません。

## 5. 公開前に動作確認する

まず作業ブランチで確認し、`main`への反映は別途承認後に行います。
自分のPCでローカル確認するには、次の一時設定が必要です。

- Turnstileに `127.0.0.1` を許可ホストとして追加。
- テスト用Workerの `ALLOWED_ORIGIN` を `http://127.0.0.1:8000`、
  `TURNSTILE_HOSTNAME` を `127.0.0.1` に変更してデプロイ。
- `config.js` にはそのテスト用WorkerとTurnstileの公開キーを指定。
- 親ディレクトリで `python3 -m http.server 8000 --bind 127.0.0.1` を実行し、
  ブラウザで `http://127.0.0.1:8000/miku-prize-collector/` を開く。

テスト用Workerは名前を `miku-prize-collector-identify-test` などに変え、
本番と別に作成してください。Secretもテスト用Workerに個別登録します。
ローカル用の変更を本番設定に混ぜないでください。

写真を選び、プレビューを確認し、AI検索を押して候補を選択します。
実際のフィギュア写真を複数用いて、色違い・別版・不鮮明画像も確認してください。
この実装には参照商品画像がないため、画像と商品説明文の照合で候補を提案します。
上位候補が正解であることは保証しません。

確認後は本番用のホスト設定に戻し、本番WorkerとPagesの公開設定を使用します。
APIキーなどの秘密情報は設定確認の際にも共有しないでください。

## API契約と制限

`POST /api/identify` に multipart/form-data で送信します。

- `image`: JPEGまたはPNG、最大4MiB。画面側は最長辺1600pxに縮小したJPEGを送信。
- `turnstileToken`: Turnstileの一回限りのトークン。
- 成功例: `{"candidateIds":["SEGA-001","SEGA-002","SEGA-003"],"databaseUpdated":"2026-10-01"}`
  （IDは形式例であり、実際の順位はAPIが返します。）
- 候補は1〜5件、または判別困難を示す空配列。候補を架空のIDで水増ししません。
- 400: 不正入力、403: 利用確認失敗、413: サイズ超過、429: 回数上限、
  502: 認識サービス失敗、503: 設定不足／確認サービス利用不可。

回数制限はIPごとに1分3回、IPごとに日本時間0時リセットです。開発中は日次30回、本番公開前に `MAX_REQUESTS_PER_DAY` を5へ戻して再デプロイします。
`MAX_REQUESTS_PER_DAY` で日次上限を変更できます（最大1000回）。
日次回数は検証済み候補を画面に表示し、確定通知をWorkerが受理したときだけ加算します。候補0件や認識失敗は日次回数に含めません。分間制限は試行に適用します。共有IPでは制限を共有します（ログインによる個人識別ではありません）。
IPはハッシュ化して短期間の回数集計だけに使用し、画像・認識結果は保存しません。
CORSだけではAPIの不正利用は防げません。Turnstileと回数制限も使用します。
OpenAI/Cloudflareのログ・保持方針は各サービスの規約と設定を確認してください。

更新時は `products.json` からWorkers用カタログを再生成してWorkerも再デプロイします。
`npm run deploy` は生成を自動実行します。版が不一致なら画面に再読み込みを案内します。
AI検索はオフラインで利用できません。既存の商品一覧・所持管理のキャッシュは維持します。

## 開発者向け検証

```sh
cd worker
npm ci
npm test
npm run check
```

PythonのPlaywrightとChromiumがある環境では、リポジトリ直下で
`python tests/browser.py` を実行します。Chromiumパスは `CHROMIUM_PATH` で変更できます。
ブラウザテストは外部APIとTurnstileをモックします。認識精度や本番認証は検証しません。

## プレビューでTurnstile成功後にAPIが失敗する場合

プレビューと本番PagesのOriginは、どちらも
`https://ntakumi1224-beep.github.io` です。`ALLOWED_ORIGIN` には
`/miku-prize-collector-preview/` を付けないでください。
`TURNSTILE_HOSTNAME` は `ntakumi1224-beep.github.io`（スキーム・パスなし）です。
Site keyとWorkerの `TURNSTILE_SECRET_KEY` は同じTurnstileウィジェットの組である必要があります。

ブラウザ上の「成功しました」はトークン取得の成功です。
WorkerによるSiteverify検証の成功とは別です。
以前のWorkerはSiteverifyのHTTPエラーをすべて「接続できませんでした」と表示していました。
修正版はJSONで検証を送信し、非2xxでも安全な `error-codes` を解析します。

Workerを更新後、ブラウザの開発者ツール → Network → `identify` → Responseで
次の `code` を確認できます。秘密の値やトークンを共有する必要はありません。

| code | 確認すること |
|---|---|
| `TURNSTILE_SECRET_INVALID` | WorkerのSecretが同じウィジェットのSecret keyか。Site keyを誤登録していないか。前後の空白や引用符がないか。 |
| `TURNSTILE_VERIFICATION_FAILED` | 新しく発行されたトークンで再試行。`verificationErrors` が `timeout-or-duplicate` なら期限切れ・再使用。 |
| `TURNSTILE_CONTEXT_MISMATCH` | 許可ホスト名、Workerの `TURNSTILE_HOSTNAME`、画面側の `action: identify` が一致しているか。 |
| `TURNSTILE_SERVICE_ERROR` | `verificationStatus` を確認。Turnstileの障害や非JSON応答を受けている可能性。 |
| `TURNSTILE_NETWORK_ERROR` | WorkerからSiteverifyへの通信が失敗またはタイムアウト。 |

このコード変更はフロントエンドの再公開では適用されません。
作業ブランチの `worker/` ディレクトリで `npm ci` → `npm run deploy` を実行して
Workerを更新します。登録済みのSecretは再デプロイで保持されます。
`main`へのマージは不要です。APIエラーの修正後に実写真で接続を再確認してください。


日次制限の変更は既存のBinding `RATE_LIMITER`、クラス `RateLimiter`、
Worker `miku-prize-collector-identify`、migration `v1` を維持します。
Durable Objectの名前 `identify` と既存の分間カウンターも維持します。
旧仕様の全体合計カウンターをIP別に分配することはできないため、変更後の初回は
新しいIP別日次カウンターから開始します。既存ストレージを削除・作り直す変更はありません。
日次制限は候補表示の確定通知が成功した検索に適用します。Turnstile失敗、OpenAI失敗、解析・検証失敗では日次回数を消費しません。

## OpenAI呼び出しの安全な診断

`identify` がHTTP 502になった場合、Responseの `code` で失敗した段階を確認します。
HTTPエラー時に限り `upstreamStatus`（数値）を追加します。
APIキー・Secret・トークン・OpenAIの応答本文・例外メッセージは返しません。

| code | 失敗した段階 |
|---|---|
| `OPENAI_NETWORK_ERROR` | OpenAIへのfetchが失敗、またはタイムアウト |
| `OPENAI_HTTP_ERROR` | OpenAIが非2xxを返した。`upstreamStatus`だけを確認可能 |
| `OPENAI_RESPONSE_PARSE_ERROR` | OpenAIのHTTP応答をJSONとして解析できない |
| `CANDIDATE_PARSE_ERROR` | `message.content`が文字列でない／欠落／JSONとして解析できない |
| `CANDIDATE_VALIDATION_ERROR` | JSONは解析できたが候補ID・件数・重複などの検証に失敗 |
| `IDENTIFY_INTERNAL_ERROR` | 上記以外のWorker内部処理で例外が発生 |

この診断は原因の切り分け用であり、実際のOpenAI接続成功を意味しません。
更新したWorkerをデプロイ後、新しい写真検索のResponseを確認してください。
フロントエンドの再公開やmainへのマージは不要です。


## 成功時だけ日次回数を加算する更新

この版は **Workerとフロントエンドの両方を更新** してください。
以前の画面は表示確定を通知しないため、Workerだけ更新しても日次カウントは確定しません。

1. 更新済み `worker/` で `npm ci` → `npm run deploy`。
2. プレビュー用の静的ZIPをアップロードし、画面を再読み込み。
3. 開発用 `MAX_REQUESTS_PER_DAY: "30"` で実機確認。
4. 本番公開前に変数を `"5"` へ戻してWorkerを再デプロイ。本番公開自体は別途承認後。

`POST /api/identify` は認識前に2分間の一時予約を取得します。
OpenAIや解析・候補検証に失敗すると予約を解放します。検証済みの候補が1〜5件なら
成功レスポンスに一回限りの `receipt` を追加します。
画面が候補を描画後、`POST /api/identify/confirm` にJSON `{receipt}` を送信します。
Workerは発行元IP・期限・候補検証済み状態を確認し、1回だけ加算します。
同じ確定通知を再送しても二重加算しません。確認には新しいTurnstileトークンは不要です。
未表示・画面解析失敗・通信切断などで通知されない予約は期限切れで解放されます。
期限は日本時間0時も上限とするため、日付をまたぐ検索では再試行が必要な場合があります。

進行中の予約も残枠から一時的に差し引き、同時検索による上限超過を防ぎます。
予約の期限切れは確定回数を増やしません。新方式の成功回数は新しいカウンターから開始し、
以前の失敗を含むカウントを引き継ぎません。Binding・migration・分間カウンターは維持します。

表示の成否はブラウザからの通知を前提にします。サーバーだけでは実際の画面表示や
改変クライアントの通知省略を証明できません。分間制限・Turnstileは独立して維持します。
日次回数に含まれない失敗でも、OpenAI側で処理された場合はAPI料金が発生することがあります。

### 候補検証エラーの診断項目

`CANDIDATE_VALIDATION_ERROR` の場合のみ、次の `diagnostics` を追加します。

```json
{
  "count": 3,
  "hasDuplicates": true,
  "hasUnknownIds": true,
  "invalidIds": ["SEGA-9999"]
}
```

`candidateIds` が配列でない場合は、件数と判定値が `null`、IDリストは空です。
不正IDはASCII英数字・`._:-`からなる最大64文字のID形式の文字列だけを最大5件返します。
任意の長文・オブジェクト・キー／Secret／トークンと一致する文字列は返しません。
そのため `hasUnknownIds: true` でも、安全に返せるIDがなければ `invalidIds` は空です。
生レスポンスや商品情報の全文は診断に含めません。
