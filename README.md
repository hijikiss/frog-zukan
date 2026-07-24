# カエル図鑑

日本と世界のカエル **330種** の図鑑に、自分で撮った写真を登録して育てていく個人用の PWA。
ビルド不要（HTML / CSS / 素の JavaScript のみ）。写真はブラウザ内（IndexedDB）にだけ保存され、外部には一切送信されません。

## できること

- **図鑑** — 330種を検索・タグ絞り込み。観察したカエルは自分の写真がカードのサムネになる
- **写真登録** — 種ごとに複数枚。**野外 / 飼育展示** を必須で記録
  - 飼育展示 → 施設名（過去に入力した施設名が候補に出る）
  - 野外 → EXIF から GPS を自動読み取り＋地名を自由入力
  - 撮影日時は EXIF から自動、手で修正も可。写真ごとにメモ
- **観察ステータス** — 未観察 / 展示で観察 / 野生で観察 を写真から自動判定。野生の写真が1枚でもあれば「野生」に昇格
- **進捗** — 「330種中◯種観察済み（うち野生◯種）」
- **施設別ページ** — 施設ごとに「ここで観察した種」の一覧
- **種データの編集** — 同梱データの誤りをアプリ内で直せる。種の追加も可能
- **バックアップ** — 写真込みの JSON エクスポート / インポート（端末間の手動同期用）
- **オフライン動作** — Service Worker でアプリ全体をキャッシュ。ホーム画面に追加可能

## 使い方（ローカル）

`file://` では ES モジュールと Service Worker が動かないので、簡易サーバー経由で開きます。

```bash
python -m http.server 8765
# → http://localhost:8765/
```

## 公開（GitHub + Netlify）

```bash
git init
git add -A
git commit -m "カエル図鑑"
git remote add origin git@github.com:<自分のユーザー名>/frog-zukan.git
git push -u origin main
```

Netlify で **Add new site → Import an existing project** から上のリポジトリを選ぶだけ。
`netlify.toml` に設定済みなので、**ビルドコマンドは空、公開ディレクトリはルート** のままで動きます。

公開後、スマホの Chrome / Safari でサイトを開き、「ホーム画面に追加」でアプリとして使えます。

> 写真は端末のブラウザ内にしか無いので、**サイトを公開しても写真が他人に見えることはありません。**
> 逆に言えば、端末を変えると引き継がれません。設定画面からエクスポートしたJSONを新しい端末でインポートしてください。

## ファイル構成

```
index.html            アプリシェル（ハッシュルーティングの単一ページ）
manifest.json         PWA マニフェスト
sw.js                 Service Worker（更新時は CACHE のバージョンを上げる）
netlify.toml          Netlify 設定（ビルドなし）
css/style.css         モバイルファーストのスタイル
data/frogs.json       種データベース（330種）
data/parts/*.json     frogs.json の元になる分割データ（科ごと）
icons/                アイコン（SVG + 生成済み PNG）
js/
  app.js              起動・ルーティング・進捗表示
  db.js               IndexedDB（photos / speciesOverrides / meta）
  species.js          種データの読み込み・マージ・検索・絞り込み
  photos.js           写真の取り込み・リサイズ・施設集計
  exif.js             EXIF パーサ（撮影日時・GPS）※外部ライブラリ不使用
  backup.js           JSON エクスポート / インポート
  cropper.js          正方形トリミングUI（ドラッグ移動・ピンチ/スライダー拡大）
  ui.js               DOM ヘルパー・モーダル・トースト
  views/              list / detail / photo-editor / species-editor / facilities / settings
scripts/
  build-frogs.mjs     data/parts/*.json → data/frogs.json（検証つき）
  make-icons.mjs      アイコン PNG の生成
  test.mjs            EXIF・種データ・検索ロジックのテスト
  smoke.mjs           ヘッドレスブラウザでの起動確認
  crop-test.mjs       トリミング結果をピクセル単位で検証＋ピンチ/ドラッグ操作の確認
  check-modal.mjs     モーダル下部のボタン到達性の確認
  e2e.mjs             写真登録〜施設別〜バックアップ往復の通し確認
```

## 設計のポイント

**種データは二層構造。**
`data/frogs.json`（同梱・読み取り専用）に、IndexedDB の `speciesOverrides`（自分が直した差分）を重ねて表示しています。
おかげで、アプリを更新して `frogs.json` に種が増えても、**自分が直した記述は上書きされずに残ります。**

**EXIF パーサは自前。**
exif-js などを CDN から読むと、オフライン（＝PWA として使う本来の場面）で壊れます。
必要なのは撮影日時と GPS だけなので、JPEG の APP1/TIFF を辿る 150行ほどのパーサを同梱しています。

**写真はリサイズ＋トリミングして保存。**
元ファイル（数MB）をそのまま入れると端末容量をすぐ食い潰すので、長辺 1600px に縮小した元画像を保存します。
さらに登録時に正方形トリミング画面でカエルを枠の中心に合わせられ、その正方形（640px）をサムネとして
カード・ギャラリー・詳細のヒーローに使います。縦長・横長の写真でもカードでカエルが切れません。
元画像は残るので、写真をタップすれば全体を見られ、あとから枠を切り直すこともできます（枠の位置は `crop` として保存）。

トリミング中のピンチは**画像だけ**を拡大し、ページは拡大しません。
iOS Safari は `touch-action: none` ではページのピンチズームを止められず、ピンチが始まると pointer イベントも打ち切られるので、
WebKit の `gesturestart` / `gesturechange` を `preventDefault` して自前のズームに繋いでいます（`js/cropper.js`）。
枠の外に指が乗った場合に備えて、トリミング画面が開いている間だけ document 全体の 2本指操作も止めています（1本指のスクロールは素通し）。

**観察ステータスは保存しない。**
写真から都度導出しています。だから写真を消せばステータスも自動で戻り、不整合が起きません。

## メンテナンス

```bash
node scripts/test.mjs           # ロジックのテスト
node scripts/build-frogs.mjs    # 種データを直したら再生成
node scripts/make-icons.mjs     # アイコンを作り直す

# ブラウザでの通し確認（別ターミナルで python -m http.server 8765 を起動しておく）
node scripts/smoke.mjs
node scripts/e2e.mjs
```

**種データを直すとき**は `data/parts/*.json` を編集して `build-frogs.mjs` を実行してください。
`build-frogs.mjs` はスキーマ検証・重複排除・サイズ帯の再計算を行います（スキーマは `data/parts/SCHEMA.md`）。
1件だけ直したいなら、アプリの詳細画面から編集する方が早いです。

**アプリのファイルを増減したとき**は `sw.js` の `ASSETS` と `CACHE`（バージョン文字列）を更新してください。

## 種データについて

330種の内訳は、日本の在来種 42・日本に定着した外来種 5・国外種 283。
日本の動物園・水族館で展示されやすい種（ヤドクガエル類、ツノガエル類、イエアメガエル、ベトナムゴケガエル、アメフクラガエルなど）を優先して 121種に「展示個体が多い」フラグを立てています。

分類・体長・レッドリスト区分は一般的な文献に基づく概算値で、**誤りが含まれている可能性があります**。
気づいたら詳細画面の「情報を編集」から直してください（編集内容は端末に残ります）。
