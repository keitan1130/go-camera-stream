# フロントエンド

React 19 / TypeScript 7 / Vite 8を使用します。Lint・整形はBiome 2で行います。

## 開発環境

Node.js 26が必要です。npmはNode.jsに同梱されたものを使用します。
`.nvmrc`はNode.jsの26系を指定しています。

```bash
nvm use
npm ci
```

## コマンド

```bash
npm run dev       # 開発サーバー
npm run build     # TypeScriptの型検査と本番ビルド
npm run lint      # ソースのBiome lint
npm run check     # ソース・設定のlint・整形・import順序を確認
npm run format    # 自動修正と整形
npm run test      # 画面共有の画質・縦横比制御の回帰テスト
npm run ci        # check + test + build
npm run preview   # 本番ビルドのプレビュー
```

`dist/`の出力はGoサーバーに埋め込まれます。
カメラ・画面共有の利用にはHTTPS（またはlocalhost）が必要です。
