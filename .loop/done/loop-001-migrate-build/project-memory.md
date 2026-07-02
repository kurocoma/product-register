# project-memory.md — 再利用可能な知見（このタスクで学んだこと）

## 確定した土台（実コード+メモリ由来。verify 推奨）
- 単品「楽天→Yahoo」: `POST /api/import/[mall]{code}` → `getRakutenItem`/`parseRakutenItem` → `buildImportedProduct`(ne_code重複排除) → `/api/register/yahoo/[id]`(GET=dry-run/POST=commit, 既定 display:0) → `/api/upload/yahoo-sync/[id]`(画像, 無いと it-14091)。
- 一括の前例: `webui/app/api/csv/bulk/route.ts`（results[]+summary, supabase認証, recordHistory）。
- カテゴリ: `webui/lib/product/category-mapping.ts fetchYahooCategoryMapping`（楽天→Yahoo。null=手動）。
- Yahoo editItem は未送信項目を既定上書き → ラウンドトリップ必須。新規ページは submitItem 不可(it-07004)。

## 環境/運用
- ベースライン4ゲート(lint/tsc/vitest139/next build)はクリーン状態で全緑。
- Windows: Python 3.13 + PyYAML 6.0.2 あり / jsonschema 無し。node v22/npm10。
- hook/スクリプトは UTF-8 強制出力しないと cp932 で日本語出力時にクラッシュする（恒久対策済み）。

## turn-001 で確定した知見
- Yahoo `editItem` には在庫数の列が無い → 「在庫0」は editItem では表現できない。安全機構は実質 `display=0`（非表示）。在庫0を担保するなら別経路 or display=0 を単一安全機構と明文化する。
- 集計関数 `result.ts aggregate()` は `status="migrate"` を加算しない設計だが、executor の dry-run は `status="migrate"` を返す → **dry-run の summary.migrated が常に0**。プレビュー集計が壊れるので "migrate"(=移行可)を計数するバケットが要る。
- route は薄く・判断と副作用順序を `executor.ts`(依存注入) に集約する形が型チェック・テスト容易性ともに良好（live API 無しで AC を網羅検証できた）。
- 既存 import route の重複排除 `findExistingProduct`(extra->>rakuten_manage_number→ne_code) は migrate 側に複製（既存ルート無改変で後方互換維持）。

## 再発防止（同じ誤りが2回起きたらここへ昇格）
- 「status の取りうる値」と「集計関数の case」は対で確認する（dry-run の "migrate" 漏れの再発防止）。
