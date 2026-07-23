---
name: bulk-product-update
description: 監査・修正候補から商品登録アプリDBへの一括反映を「バックアップ→dry-run manifest→payloadHash承認→反映→検証」の5段で安全に実行する。「監査結果を反映して」「一括更新して」「dry-runを反映して」「しまのやの商品を一括改定して」のような依頼で使用。モールへの書き込みは行わない（DB反映のみ。モール反映は /api/update・/api/register 経路を別途使う）。
---

# bulk-product-update — 承認付き商品一括反映

商品データの一括改定を、毎回同じ5段パイプラインで実行する。実績: しまのや楽天64親・115SKU（2026-07-22 反映済み・実不一致0）。

## 毎回読む正本

1. リポジトリの `webui/AGENTS.md`（データアクセス・禁止パターン）
2. `C:/Users/hppym/dev/obsidian-vault/40-dev-notes/商品登録アプリ/商品登録アプリ-AI操作マニュアル.md` §5（直接実行の安全ルール）・§8（価格丸め）・§9（検証）
3. 案件固有の恒久ルール（しまのや: auto-memory `shimanoya-update-rules` — 楽天取込後に作業・CSVバックアップ必須・原材料等の保留裁定）

## 5段パイプライン（順序固定・段を飛ばさない）

すべてのスクリプトは `cd webui && npx tsx tests/<script>.mjs` で実行し、`../.env.local` を自前パースして
`SUPABASE_SERVICE_ROLE_KEY` の admin クライアントを使う（§5 経路①）。手本ファイルを逐語コピーせず、対象案件に合わせて作り直してよいが**構造（ゲート・出力）は維持する**。

### 1. 取込 + 変更前バックアップ（read-before-write）

手本: `webui/tests/shimanoya_readonly_snapshot.mjs`

- モール現在値は読み取りAPIのみ（楽天= getItem）。DB は SELECT のみ。
- 出力: `.codex-work/<案件>/backup/` に (a) モール現在値CSV (b) アプリDB主要列CSV (c) `app-db-current-rows.jsonl`（全行ロスレス・**復元の正本**） (d) `RESTORE.md`（復元手順）。
- backup フォルダには `.gitignore`（`*`）を必ず置く（機密・コミット禁止）。

### 2. dry-run manifest 生成

手本: `.codex-work/shimanoya-app-update/build_update_plan.mjs`

manifest（`app-dry-run.json`）の必須構造:

```
{ mode: "dry-run", mallWrite: false, sourceFiles: {…sha256付き}, summary, validation: {ok, errors},
  payloadHash,            // 反映内容の指紋。承認・反映ゲートの根拠
  holdDecisions: [...],   // 自動採用しなかった値（adopted:false）と理由
  warnings: [...], futureMallActions: [...],  // モール操作候補は planned_not_executed で記録のみ
  operations: [{ action: "update"|"create", targetId, id, expectedUpdatedAt, product }] }
```

- `product` は ProductInput 全体（`webui/lib/product/schema.ts` が正本）。
- 曖昧値・裁定待ちの値は **hold（採用保留）にして manifest に入れない**。勝手に採用しない。
- `validation.ok !== true` なら承認に進まない。

### 3. 承認（ユーザーの明示承認なしに反映しない）

- `approval-summary.md` を manifest と同時に再生成する（対象件数・価格式・保留内訳・入力SHA-256・**payloadHash**）。
- ユーザーへの確認は completion-dashboard の「9. 確認事項」A/B形式で最大5件に集約する（未決の値・保留裁定の継続・最終承認）。
- **dry-run を作り直したら hash が変わる → サマリーも必ず更新**（旧hashのまま承認させない）。

### 4. 反映（DB のみ）

手本: `webui/tests/shimanoya_apply_update.mjs`

順序固定のゲート:
1. **承認ゲート**: `manifest.payloadHash === 承認済みhash`・`mallWrite === false` を検証。不一致は即中止。
2. **preflight SELECT**（書き込みなしの既定動作）: 更新対象の消失0・`updated_at !== expectedUpdatedAt` の競合0・新規の ne_code 重複0・所有者 user_id が一意、を確認。NG が1件でもあれば dry-run 再生成へ戻る。
3. **`EXECUTE=1` を付けたときだけ書き込み**。必ず `upsertProduct`（repository 経由 = zod検証＋履歴記録）で、
   `{ expectedUpdatedAt, authenticatedUserId: 既存所有者のuser_id }` を渡す。service role でも生 UPDATE/INSERT を書かない。
4. 結果を `.codex-work/<案件>/apply-result.json` に保存（targetId・ok/ng・新id）。

### 5. 検証（読み取り専用）

手本: `webui/tests/shimanoya_verify_apply.mjs`

- 反映後の全行を SELECT し、`productInputToDbRow(product)` の期待行と**順序不問の深い比較**で突き合わせ、実不一致0を確認する。
- **注意**: PostgreSQL の jsonb はキー順を正規化するため、`JSON.stringify` 同士の比較は `extra` で必ず偽陽性になる。順序不問比較を使うこと。

## 絶対ルール

- この skill の範囲は**アプリDBのみ**。モールへの書き込み（upsert/patch/在庫/倉庫格納）は別承認・別経路（§6）。manifest の `futureMallActions` は記録するだけで実行しない。
- バックアップ（段1）なしで反映しない。復元は `RESTORE.md` の手順（`app-db-current-rows.jsonl` を upsertProduct で書き戻す）。
- 保留（hold）値は人の裁定なしに採用しない。裁定結果は approval-summary に承認記録として残す。
- `.env.local` の値・商品データ全文をログ・チャットに出さない。backup/ と apply-result はコミット禁止。
- 反映後のコミットはユーザーの指示を待つ。

## 完了報告

completion-dashboard で報告する。必須記載: 反映件数（OK/NG）・検証の実不一致数・payloadHash・バックアップと復元手順の場所・未実施のモール操作（futureMallActions）。
