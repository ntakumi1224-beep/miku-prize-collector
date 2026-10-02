# mainを変更しない一時プレビュー

`feature/camera-identification` の静的ファイルを、別の公開リポジトリ
`ntakumi1224-beep/miku-prize-collector-preview` に配置します。
公開先の予定URL:

https://ntakumi1224-beep.github.io/miku-prize-collector-preview/

このURLはPagesのデプロイが完了してから利用できます。
本番リポジトリのmainとPages設定は変更しません。
WorkerとTurnstileが許可するホスト名は既存の `ntakumi1224-beep.github.io` のままです。
APIキーやSecretをこのプレビューに含める必要はありません。

## 準備済みZIPを公開する

1. GitHubでログインし、New repositoryから `miku-prize-collector-preview` をPublicで作成。
   オーナーは必ず `ntakumi1224-beep` にします。既存の同名リポジトリがある場合は
   内容を確認し、無関係なファイルを上書きしないでください。
2. プレビュー用ZIPを解凍し、Add file → Upload filesからファイルと `icons/` をアップロード。
   `index.html` がリポジトリ直下にあることを確認します。
   この別リポジトリのmainへコミットします。本番リポジトリのmainとは別です。
3. そのプレビューリポジトリのSettings → Pagesで、Deploy from a branch、main、
   / (root)を選択してSave。デプロイ完了後、予定URLを実機で開きます。

ZIPにはフロントエンドのみ含め、Worker、node_modules、秘密情報は含めません。
`config.js` にあるTurnstile Site keyは公開情報です。

## 実機テスト

本番と同じホストのため、localStorageに保存する所持・履歴・表示設定を共有します。
既存データへの影響を避けるため、プライベートブラウズで試すか、まず所持データを
書き出してください。画像検索自体は所持状態を変更しませんが、詳細を開くと履歴が増えます。

1. カメラ画面で撮影またはカメラロールから写真を選択。
2. プレビューとTurnstileの利用確認を待ち、AI検索を押す。
3. 参考候補3〜5件と常時表示の注意書きを確認。
4. 候補をタップし、商品詳細が開くことを確認。

APIは本番Workerを呼ぶため、OpenAIの利用料と日次制限が適用されます。
候補を出せない画像では撮り直し案内が表示されます。
失敗時は画面のエラー文を共有してください。APIキーやSecretは共有しないでください。
テスト完了後のプレビュー削除は別途行います。

## 作業ブランチからZIPを再生成

```sh
python3 scripts/build-preview.py --output /tmp/MPC_Camera_Preview.zip
```
