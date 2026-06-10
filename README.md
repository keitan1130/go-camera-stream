# go-camera-stream

iPhoneなどのブラウザでカメラ映像を取得し、WebSocket経由でGoサーバーへ送り、MJPEGストリームとして配信するローカル向けアプリです。

## 仕組み

- カメラ入力: `https://<PUBLIC_HOST>:<APP_PORT>/?id=<ID>`
- ストリーム出力: `http://<PUBLIC_HOST>:<STREAM_PORT>/stream?id=<ID>`
- `id` が同じカメラ入力とストリーム出力が接続されます。
- ブラウザのカメラAPIはHTTPSが必要なため、カメラ入力側はHTTPSで起動します。

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
go run main.go
```

環境変数で待ち受けポートと外部アクセス用ホストを指定できます。

```bash
PUBLIC_HOST=192.168.0.0 APP_PORT=61001 STREAM_PORT=61002 go run main.go
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
PUBLIC_HOST=192.168.0.0 APP_PORT=61001 STREAM_PORT=61002 ./camera-stream
```

### Docker

```bash
PUBLIC_HOST=192.168.0.0 APP_PORT=61001 STREAM_PORT=61002 docker compose up --build
```

## アクセス方法

例として `PUBLIC_HOST=192.168.0.0`、`APP_PORT=61001`、`STREAM_PORT=61002`、`id=3` の場合:

1. iPhoneまたはカメラ端末で `https://192.168.0.0:61001/?id=3` を開きます。
2. 自己署名証明書の警告を許可します。
3. カメラ使用を許可します。
4. OBSまたは確認用ブラウザで `http://192.168.0.0:61002/stream?id=3` を開きます。

`APP_PORT` と `STREAM_PORT` は通常は別ポートにしてください。同じポートにした場合、HTTPとHTTPSを同じポートで同時に待ち受けることはできないため、`/stream` もHTTPS側で配信されます。

```text
APP_PORT=61001 STREAM_PORT=61001 の場合:
https://192.168.0.0:61001/?id=3
https://192.168.0.0:61001/stream?id=3
```

この場合、`http://192.168.0.0:61001/stream?id=3` は使えません。`61001` はHTTPS用ポートなので、HTTPでアクセスすると接続が成立せず、ブラウザ上では読み込み中のままに見えることがあります。
