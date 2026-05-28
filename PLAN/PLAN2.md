# CodeStock Cloud-First Plan

## Summary

`CodeStock` をローカル専用から外す第一段階は、`Web先行 + Supabase` で進める。  
目的は `自分専用で、別端末から同じスニペットと画像を見られること`。  
既存の React UI はできるだけ維持し、保存境界である `SnippetRepository` を `localStorage / Tauri` 依存から `Supabase-backed repository` へ差し替える。  
Tauri は第一段階では必須対象にせず、後で同じ API/DB に接続できるように設計だけ合わせる。

## Implementation Changes

- データ保存先を `Supabase Postgres + Storage` に移す。
  - `snippets` テーブル: `id`, `user_id`, `title`, `note`, `created_at`, `updated_at`
  - `snippet_code_blocks` テーブル: `id`, `snippet_id`, `position`, `language`, `code`
  - `tags` テーブル: `id`, `user_id`, `name`, `normalized_name`
  - `snippet_tags` テーブル: `snippet_id`, `tag_id`
  - `attachments` テーブル: `id`, `snippet_id`, `user_id`, `storage_path`, `mime_type`, `width`, `height`, `created_at`
- 画像は DB に base64 で持たず、Supabase Storage に保存する。
  - `attachments.storage_path` に保存先を持つ
  - 画像プレビューは Storage URL から取得する
  - `Note` 内の `[image:<attachmentId>]` 参照仕様はそのまま維持する
- 認証は `自分専用` 前提で最小構成にする。
  - Supabase Auth のメールリンク認証を採用
  - すべてのデータは `user_id` で分離
  - Row Level Security を有効化し、自分のデータのみ読める/書けるようにする
- フロントの repository 層を 3 分割に整理する。
  - `LocalSnippetRepository`: 既存 `localStorage` 用
  - `SupabaseSnippetRepository`: 新規クラウド用
  - `createSnippetRepository()` は実行環境ではなく設定で切り替える
- Web アプリとして配備する。
  - Vite build を静的配信
  - 配備先は Vercel 想定
  - `VITE_SUPABASE_URL` と `VITE_SUPABASE_ANON_KEY` を環境変数で注入
- 初回移行は `import-once` 方式にする。
  - 既存 `localStorage` データを読み取り
  - 初回サインイン後に一括アップロード
  - 添付画像も Storage へ移送
  - 成功後にローカル削除はしない
- 検索は v1 ではクライアント側フィルタで維持する。
  - サーバ検索最適化は後回し
  - 初回は `snippets + code_blocks + tags + attachments` をユーザー単位で取得して、今の検索ロジックを流用する
  - データ量が増えたら第2段階で全文検索を検討する

## Public Interfaces / Types

- `Snippet`, `SnippetCodeBlock`, `Attachment`, `Tag` の UI 型は基本維持する
- `Attachment.filePath` はクラウド化後は実ファイルパスではなく `storagePath` 相当の意味に変更する
- `readAttachmentPreviewSrc()` は
  - local mode: `localStorage` / Tauri path
  - cloud mode: signed URL or public URL
  - の両対応にする
- `SnippetRepository` の公開インターフェースは極力維持する
  - `createSnippet`
  - `updateSnippet`
  - `searchSnippets`
  - `listTags`
  - `attachImageFromClipboard`
  - `getSnippetById`
- 新規追加インターフェース
  - `importLocalData(): Promise<{ importedSnippets: number; importedAttachments: number }>`
  - `signInWithMagicLink(email: string): Promise<void>`
  - `signOut(): Promise<void>`
  - `getCurrentUser(): Promise<User | null>`

## Test Plan

- 認証なしではデータ取得・保存ができないこと
- サインイン後、自分のスニペット一覧が取得できること
- 新規スニペット作成で `snippet_code_blocks` と `snippet_tags` まで保存されること
- `Note` に画像貼り付けした時、Storage へ画像保存され、`attachments` 行が作られ、`[image:id]` が本文に残ること
- 別端末で同一アカウントにログインした時、スニペット本文・コードブロック・タグ・画像が同じ見え方になること
- 既存ローカルデータの import が重複せずに完了すること
- 検索、タグ絞り込み、コピー、プレビューがクラウドモードでも既存どおり動くこと

## Assumptions

- 最速優先なので `Web先行` とし、Tauri のクラウド接続対応は第2段階に回す
- 利用者は当面 1 人なので、招待機能や共有機能は入れない
- バックエンドは `Supabase` を使い、自前 API サーバは立てない
- 画像は Storage 保存、DB にはメタデータのみ保存する
- 検索性能より実装速度を優先し、v1 はクライアント側検索で進める
