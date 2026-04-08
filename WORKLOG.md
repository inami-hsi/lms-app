# WORKLOG

## 2026-04-08
- admin-logs API改善: sort=asc|desc対応、cursor仕様明文化、totalCount追加、Cache-Control: no-store、Base64変換の安定化
- フロントUX改善（AdminUsersPage）:
  - ログ読み込み表示、フィルタリセット、検索強調、空状態UI
  - 並び順UI、入力クリア、フィルタサマリ、反映中表示
  - 詳細ビュー整理、右ペイン表示、前/次ナビ
  - キーボード操作（↑↓/J K/Shift+J K）
  - 自動スクロール、選択ハイライト、行クリック選択
  - コピー機能＋トースト統一（再読み込みボタン付き）
  - スケルトン表示、ページング終端メッセージ
  - コンテキストメニュー追加
  - フィルタ状態を localStorage に保存
- CSVエクスポートに条件ヘッダー追加
- README に admin-logs 仕様（sort / cursor / totalCount）追記
- npm run build 実行（成功）
- 実環境テストはサブドメイン反映待ち
  - 反映後に dist/ をアップロード → 管理者ログイン → token取得 → API検証
