# CodeStock

`PLAN/PLAN.md` をベースにした v1 の初期実装です。現時点では以下を含みます。

- `Vite + React + TypeScript` のフロントエンド土台
- `SnippetRepository` / `AttachmentStore` 相当の永続化境界
- ローカルブラウザ用 `localStorage` フォールバック
- タグ付き登録、横断検索、詳細プレビュー
- `Ctrl+V` による画像貼り付けと添付表示
- 将来の Tauri コマンド接続ポイント

## セットアップ

```bash
npm install
npm run dev
```

Rust / Tauri を使ってデスクトップ化する場合は、別途 Rust ツールチェーンと Tauri CLI の導入が必要です。現ワークスペースでは `cargo` / `rustc` が未導入のため、Tauri 実行までは未検証です。
