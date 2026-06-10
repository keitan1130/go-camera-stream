# go-camera-stream

iPhoneなどのブラウザでカメラ映像を取得し、WebSocket経由でGoサーバーへ送り、MJPEGストリームとして配信するローカル向けアプリです。

## 仕組み

- カメラ入力: `https://<PUBLIC_HOST>:<APP_PORT>/?id=<ID>`
- ストリーム出力: `http://<PUBLIC_HOST>:<STREAM_PORT>/stream?id=<ID>`
- `id` が同じカメラ入力とストリーム出力が接続されます。
- ブラウザのカメラAPIはHTTPSが必要なため、カメラ入力側はHTTPSで起動します。

## 環境変数

`.env.example` を例として `.env` を作成し、自分のLAN環境に合わせて編集してください。

```bash
cp .env.example .env
```

設定値:

- `APP_PORT`: HTTPSのカメラ入力画面を配信するポート
- `STREAM_PORT`: HTTPのMJPEGストリームを配信するポート
- `PUBLIC_HOST`: iPhoneやOBSからアクセスするPCのLAN内IPアドレスまたはホスト名

Docker Composeはプロジェクト直下の `.env` を自動で読み込み、`docker-compose.yml` のポート公開とコンテナ環境変数に反映します。

## 開発方法

### フロントエンド

```bash
cd frontend
npm install
npm run dev
```

フロントエンドだけをViteで開発する場合は、Goサーバー側のWebSocketエンドポイントとは別ポートになります。本番に近い確認は、次の「ローカル起動」を使ってください。

### ローカル起動

```bash
cd frontend
npm install
npm run build

cd ..
set -a
. ./.env
set +a
go run main.go
```

## ビルド方法

### ローカルバイナリ

```bash
cd frontend
npm install
npm run build

cd ..
go build -o camera-stream main.go
```

起動:

```bash
set -a
. ./.env
set +a
./camera-stream
```

### Docker

```bash
cp .env.example .env
# .env を編集
docker compose up --build
```

## アクセス方法

`.env.example` の値をそのまま使う場合、`id=3` のアクセス先は次の通りです。

1. iPhoneまたはカメラ端末で `https://192.168.1.100:8080/?id=3` を開きます。
2. 自己署名証明書の警告を許可します。
3. カメラ使用を許可します。
4. OBSまたは確認用ブラウザで `http://192.168.1.100:8081/stream?id=3` を開きます。

実際には `.env` の `PUBLIC_HOST`、`APP_PORT`、`STREAM_PORT` に置き換えてアクセスしてください。

`APP_PORT` と `STREAM_PORT` は通常は別ポートにしてください。同じポートにした場合、HTTPとHTTPSを同じポートで同時に待ち受けることはできないため、`/stream` もHTTPS側で配信されます。

```text
APP_PORT と STREAM_PORT が同じ場合:
https://<PUBLIC_HOST>:<APP_PORT>/?id=3
https://<PUBLIC_HOST>:<APP_PORT>/stream?id=3
```

この場合、`http://<PUBLIC_HOST>:<APP_PORT>/stream?id=3` は使えません。`APP_PORT` はHTTPS用ポートなので、HTTPでアクセスすると接続が成立せず、ブラウザ上では読み込み中のままに見えることがあります。

## サーバー側の確認方法

ストリームURLへ接続しても映像が出ない場合は、まずサーバーがフレームを受信しているか確認してください。

```bash
curl -s http://127.0.0.1:<STREAM_PORT>/status?id=1
```

例:

```bash
curl -s http://127.0.0.1:61001/status?id=1
```

見るべき項目:

- `camera_clients`: `1` 以上ならカメラページのWebSocketが接続されています。
- `frame_count`: 増えていればカメラからJPEGフレームを受信できています。
- `last_frame_at`: 最後にフレームを受信した時刻です。
- `obs_clients`: `/stream` を開いている視聴クライアント数です。

`camera_clients` が `0` の場合は、カメラ端末で `https://<PUBLIC_HOST>:<APP_PORT>/?id=1` を開き、証明書警告とカメラ権限を許可してください。

`camera_clients` が `1` 以上で `frame_count` が `0` の場合は、WebSocket接続はできていますが、ブラウザ側でカメラ取得またはフレーム送信に失敗しています。カメラ画面のステータスが `ストリーミング中 [ID: 1] 送信フレーム: ...` に変わるか確認してください。

`frame_count` が増えているのに映像が出ない場合は、視聴側URLの `id` がカメラ側と一致しているか確認してください。

ログでも次を確認できます。

```text
[カメラ接続] ID: 1 が配信を開始しました
[フレーム受信] ID: 1 count=1 size=... bytes
[OBS接続] ID: 1 の映像の視聴が開始されました camera_clients=1 frame_count=...
```

`curl -v -N http://127.0.0.1:<STREAM_PORT>/stream?id=1` は、フレーム未受信でもHTTPヘッダーまでは返ります。本文が出ない場合は `frame_count` を確認してください。
