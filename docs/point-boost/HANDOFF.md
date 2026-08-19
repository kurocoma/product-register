# ポイント変倍最適化（point-boost）— セッション引き継ぎ書

> 最終更新: 2026-08-19 ／ ブランチ: `claude/konbanwa-tg677w`（実装・テスト済み、プッシュ済み）
> 要件定義・設計の正本: `docs/point-boost/requirements.md`（決定事項・機能要件・ガード・運用手順・リスクすべてここ）

## 1. 何を作ったか（1行）

楽天掲載済み商品を1日2回、楽天市場で最安値順に検索して競合店のポイント倍率をチェックし、
自店の商品別ポイント変倍を「競合最大+1倍・上限3倍」で自動設定して出面を良くする機能。

## 2. 現在の状態

- **実装・レビュー・テストは完了**（コミット `a7de0c3` 実装 → `8f938d4` レビュー20件修正 → `b4d4925` 結合テスト）
  - 26体の敵対的レビューで確定した20件（tsx起動不能・手動キャンペーン上書き等）は修正済み
  - vitest 1140件 / tsc / eslint / next build 全緑
  - マイグレーションは実PostgreSQL 16で2回適用検証済み（冪等・RLS有効）
- **ユーザーが `RAKUTEN_APPLICATION_ID` を設定済みと申告**（2026-08-19。楽天ウェブサービスで発行）
  - 設定先は PC の `webui/.env.local` のはず。次セッションで最初に実在を確認すること
- **未実施（次のタスク）**: 下記 §4 の初回セットアップの続き

## 3. 主要ファイル

| 場所 | 内容 |
|---|---|
| `webui/lib/point-boost/` | 機能本体（barrel）。matcher/rate-rule/planner/point-campaign=純関数、service=実行、repository=DB |
| `webui/lib/rakuten/ichiba-search-client.ts` | 楽天市場商品検索APIクライアント（applicationId・価格昇順・pointRate取得） |
| `webui/app/api/rakuten/point-boost/{run,settings,runs}/route.ts` | API 3本（dry-run既定・上限25件・多重実行409） |
| `webui/components/point-boost/PointBoostPanel.tsx` + `/point-boost` 画面 | 設定・手動実行・実行履歴（ナビ「品質・監査」内） |
| `webui/supabase/migrations/20260817000001_create_point_boost.sql` | 新規3テーブル（settings/runs/results、RLS） |
| `webui/scripts/point_boost_run.mjs` | 定期実行スクリプト（`npx tsx`。--manual は既定dry-run、実反映は --manual --live） |
| `scripts/register-point-boost-task.bat` | タスクスケジューラ登録（9:00/21:00、bat内 TIME1/TIME2 で変更） |

## 4. 次にやること（初回セットアップの残り、順番どおり）

1. `webui/.env.local` に `RAKUTEN_APPLICATION_ID=...` があるか確認（ユーザー設定済み申告あり）
2. マイグレーション適用: `cd webui && node scripts/apply_sql.mjs supabase/migrations/20260817000001_create_point_boost.sql`
3. アプリ起動（`open-local.bat`）→ 画面「品質・監査 > ポイント変倍」で **dry-run** 実行
   - 競合検出（JAN検索が実際にヒットするか）と目標倍率が妥当か確認
4. **1商品だけ本実行**し、RMS管理画面で商品別ポイント変倍の反映を確認
   - ⚠ ここが唯一の要実機確認: Item API 2.0 の `pointCampaign` フィールド実在（requirements.md §8 R1）。
     PATCHが拒否されたら `webui/lib/point-boost/point-campaign.ts` のペイロード形だけ直せば済む構造
5. OKなら画面で「自動実行を有効にする」ON → `scripts\register-point-boost-task.bat` でタスク登録
6. 翌日以降、実行履歴画面と `logs/point_boost_task.log` で自動実行を確認

## 5. 制約・注意（ハマりどころ）

- **クラウドセッションからは楽天APIに届かない**: 環境のネットワークポリシーが `app.rakuten.co.jp` を遮断
  （実測: CONNECT 403）。ライブ疎通テストをクラウドでやるには claude.ai の環境設定で同ドメインの許可が必要。
  PC のローカル Claude Code なら制約なし
- `.env.local` は git 管理外。キー類をコミットしない。RMS の serviceSecret/licenseKey はチャットにも貼らない
  （applicationId は低感度なので可）
- 規約は `webui/AGENTS.md` が正本（barrel経由import・API12系統・dry-run必須・完了報告5点セット）。
  vitest はリポジトリ直下ではなく **`webui/` から実行**（直下だと alias 解決に失敗する）
- 安全設計（勝手に変えないこと）: dry-run既定 / scheduled は設定ONのみ / 降格しない / 予約キャンペーンに触らない /
  自動の解除PATCHはしない（自然失効のみ）— 根拠は requirements.md §4 FR3 とレビュー結果
- テスト実行時に「開発用DBに触るテストは無い」＝すべてモック。実DBを使う検証はユーザーPC上でのみ行う

## 6. 検証コマンド（webui/ で）

`pnpm lint` / `npx tsc --noEmit` / `pnpm test` / `pnpm build`
