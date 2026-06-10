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
