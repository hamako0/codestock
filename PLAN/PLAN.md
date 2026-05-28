# CodeStock 実装計画

## Summary
Notion の代替として、起動と検索が速いローカルファーストのコードストック用デスクトップアプリを v1 として設計する。主目的は `爆速登録` `タグ中心の検索性` `画像/スクショ貼り付け` の 3 点。将来の同期追加を見据えて、保存層とアプリ層は分離する。v1 では Notion 移行は後回しにする。

## Implementation Changes
- 技術スタックは `Tauri + React + TypeScript + SQLite` を第一候補にする。
  - 理由: デスクトップ起動が軽く、ローカルファイル連携と貼り付け処理に強く、将来も配布しやすい。
- データモデルは最小で `Snippet` `Tag` `SnippetTag` `Attachment` を持つ。
  - `Snippet`: title, code, language, note, createdAt, updatedAt
  - `Tag`: name, normalizedName
  - `SnippetTag`: snippetId, tagId
  - `Attachment`: snippetId, filePath, mimeType, width, height
- 検索は SQLite ベースで高速化する。
  - タイトル、コード本文、メモ、タグ名を横断検索対象にする。
  - 部分一致とタグ絞り込みを両立する。
  - 将来同期を見据え、ローカル DB への保存 API は UI から直接触らせず repository 層で吸収する。
- 登録体験は入力速度優先で設計する。
  - 1 画面で `タイトル / コード / タグ / 添付` を完結させる。
  - `Ctrl+V` で画像貼り付け保存、タグはインクリメンタル補完、言語は候補選択にする。
  - コード登録はテンプレ入力を避け、最短で保存できる導線にする。
- 一覧/検索画面は閲覧より再発見性を優先する。
  - 検索バー常設、タグチップ絞り込み、最近更新順/作成順の切替を入れる。
  - 一覧から詳細を即プレビューできる構成にする。
- 添付画像はアプリ管理ディレクトリへ保存する。
  - DB にはバイナリ直保存せず、v1 はファイルパス参照にする。
  - 将来のクラウド同期時にアセット同期へ差し替えやすくする。

## Public APIs / Interfaces
- UI 層から使うアプリ内部インターフェースを先に固定する。
  - `createSnippet(input)`
  - `updateSnippet(id, input)`
  - `searchSnippets(query, tags, sort)`
  - `attachImageFromClipboard(snippetId | draftId)`
  - `listTags(keyword)`
- 将来同期用に永続化境界を抽象化する。
  - `SnippetRepository`
  - `AttachmentStore`
  - 後から `LocalOnly` 実装に加えて `SyncEnabled` 実装を足せる形にする。

## Test Plan
- 新規登録: コードのみ、タグ付き、画像貼り付け付きで保存できること。
- 検索: タイトル、本文、タグの各条件でヒットし、複合条件でも期待どおり絞り込めること。
- 更新: タグ追加/削除、コード編集、画像再添付後に一覧と詳細へ即時反映されること。
- パフォーマンス: アプリ起動、1000 件規模の検索、一覧表示で体感遅延がないこと。
- 例外系: 不正画像、巨大画像、空コード、重複タグ、添付ファイル欠損時の挙動を確認する。

## Assumptions
- 初期対象は単一ユーザーのデスクトップアプリ。
- 保存はローカル完結だが、将来同期を追加できる構造を前提にする。
- v1 では Notion API 連携や移行機能は実装しない。
