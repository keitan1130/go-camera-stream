# Go Camera Stream 開発ガイド

Toyboxの開発ガイドを参考に、このリポジトリのGo / React / WebRTC構成に合わせたルールです。

## 作業範囲と判断

- リポジトリルートがGoバックエンド、`frontend/`がReactフロントエンドです。依頼に応じて両方を変更できます。
- 依頼に関係しないファイルや既存の変更には触れません。公開URL、query parameter、WebSocketメッセージ、propsを理由なく壊しません。
- 仕様とコマンドは現行コード、`go.mod`、`frontend/package.json`、設定ファイルで確認します。文書との不一致も必要に応じて直します。
- 不明点はまず既存コード・型・設定から判断し、結果を大きく左右する情報だけを質問します。
- npmのみを使用します。npmコマンドは`frontend/`、GoとGitコマンドはリポジトリルートで実行します。
- Gitコミットは明示的な依頼がある場合だけ実行します。許可済みの作業について確認を重ねません。

## 技術と配置

- Go / Echo / Gorilla WebSocket。`main.go`がHTTP配信、`signaling.go`が接続仲介、`tls.go`がTLS設定です。
- React / TypeScript / Vite。Node.jsは`frontend/.nvmrc`の26系、npmはNode.jsに同梱されたものを使用します。
- モード単位の画面は`frontend/src/components/`、カメラモード固有の表示部品とProps型は`components/camera/`、配信処理と状態管理は`hooks/`に置きます。
- 画面コンポーネントは表示部品の組み合わせを中心に保ち、通信・非同期処理を重複させません。単一画面の状態を安易にグローバル化しません。
- コンポーネントと型はPascalCase、hookは`use`で始め、callback propsは`on`で始めます。既存の配置・命名を優先します。
- 色は`src/index.css`の既存CSS custom propertyを使います。配信画面の表示・操作は最小限に保ちます。
- TypeScriptの型を活用し、`any`、不要な型アサーション、未使用コードを避けます。整形・import順序は`biome.json`を正本とします。
- `frontend/dist/`は生成物です。手動編集せず、Goのビルド前にフロントエンドをビルドします。

## カメラ・画面共有・通信

- `id` / `mode`のURL契約と、送信側`camera`・受信側`viewer`のシグナリング契約を維持します。画面共有も送信側として扱います。
- 映像はWebRTC、接続仲介と統計情報はWebSocketという役割を保ちます。
- 画面共有とPiPは実行時にAPI対応を判定します。ユーザー操作が必要なAPIを自動実行しません。
- ストリーム切り替え時は、キャンセル・失敗で元の配信を失わないようにします。不要なトラック・接続・イベント・タイマーを解放します。
- 非同期処理はunmountや新しい取得要求の後に古い完了結果を反映しないよう、キャンセルフラグや世代IDで保護します。
- WebのPiPを、ネイティブのバックグラウンドカメラ機能と同一視しません。タスクキルまでの継続を実機検証なしに保証しません。
- URL・token・秘密情報を直書きせず、`.env`やTLS秘密鍵をコミット・ログ出力しません。

## コマンドと検証

`frontend/`で実行します。

```bash
nvm use
npm ci
npm run dev
npm run lint     # ソースのBiome lint
npm run check    # ソース・設定のlint、整形、import順序
npm run format   # ソース・設定の自動修正と整形
npm run build    # TypeScript型検査とViteビルド
npm run ci       # check + build
```

リポジトリルートで実行します。

```bash
go test ./...
go vet ./...
go build -o /tmp/go-camera-stream-server .
git diff --check
```

- フロントエンドの変更は`npm run ci`、Goの変更はフロントエンドのビルド後にGoの検証を実行します。新たな変更・失敗がなければ同じ検証を繰り返しません。
- 依存更新時はlockfileとmanifest、Node / Goの指定、Dockerfile、READMEを揃え、`npm ci`で再現性を確認します。検証のために不要な依存を追加しません。
- UI・配信処理の変更では、影響に応じて切り替え、許可拒否、共有停止、ミュート、再開、PiP、モバイル幅をブラウザで確認します。
- テストは具体的な回帰を検出する必要最小限に絞ります。既存の検証を再利用し、単純な文言・スタイル変更だけでテスト基盤を増やしません。
- 静的検証、模擬ストリーム、実WebRTC接続、スマホ実機、Docker、本番環境の確認を区別します。未実施や失敗を成功扱いしません。
- 文書のみの変更ではリンク・コマンド・差分を確認し、無関係なビルドは省略できます。
- 完了時は変更内容、検証結果、未検証範囲を簡潔に報告します。
- ファイルを変更した場合は、完了報告に日本語のコミットメッセージ例を必ず含めます。`feat:`、`fix:`、`refactor:`、`chore:`、`docs:`など変更内容に合った接頭辞を付け、実際の変更を具体的に表します。例の提示だけではコミットを実行しません。
