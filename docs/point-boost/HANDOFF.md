# ポイント変倍最適化（point-boost）— セッション引き継ぎ書

> 最終更新: 2026-08-20 ／ ブランチ: `claude/konbanwa-tg677w`（実装・テスト済み、プッシュ済み）
> 要件定義・設計の正本: `docs/point-boost/requirements.md`（決定事項・機能要件・ガード・運用手順・リスクすべてここ）

## 0-c. 2026-08-21 追記2: 3区切り運用へ変更（窓方式・ユーザー指示）

- 適用帯を**窓方式**に変更: 昼帯 9:00〜17:59:59 / 夜帯 20:00〜23:59:59 / **深夜 0:00〜8:59 は変倍を置かない＝必ず1倍**
  （売れない時間帯。設定しないことで構造的に1倍を保証 — 「戻す処理」は不要のため深夜タスクは作らない）。
- タスク実行時刻を **6:45 / 17:45** に変更・再登録済み（各窓の開始2時間15分前。IE0173=開始2時間以内NGのため、
  bat の TIME1/TIME2 と `point-campaign.ts` の CAMPAIGN_WINDOWS_JST は**必ずセットで変更**する）。
- 実装: `pickWindow()` — earliest（now+2h01mの次の正時）以降に入れる最初の窓を選ぶ。窓の途中なら残り区間のみ、
  窓外（深夜）なら翌昼帯へ回す。テスト58件全緑。
- 既存7日キャンペーン2件は RMS 管理画面からも手動削除不可だった（ユーザー確認）→ 8/27 10時台の自然失効待ちで確定。

## 0-b. 2026-08-21 追記: 適用期間を短期化（8:00/20:00 区切り）・解除不可を実機確認

- **適用期間中は更新だけでなく解除（pointCampaign: null）も IE0154 で不可**と実機確認
  （適用中の bir-shiku24 への解除PATCHが拒否された）。長期間の設定は「戻せない」リスクそのもの。
- ユーザー指示により適用期間を「次の定期実行の直前まで」に短期化: 終了を JST 8:00/20:00 の区切り
  （定期実行 9:00/21:00 の1時間前。RMSが xx:59:59 へ変換）に置き、実行時点では必ず失効済み →
  毎回再評価・再設定でき、止めたいときも最長十数時間で1倍に自然復帰する。
  実装: `point-campaign.ts` の `END_BOUNDARY_HOURS_JST`（**bat の実行時刻を変えるときはここも合わせる**）。
- **既存の長期キャンペーン2件は 8/27 10時台の自然失効まで残る**（bir-shiku24=2倍・a009-8512-48=3倍。
  APIでは解除不可。RMS管理画面から手動削除できれば前倒し可能）。失効後は自動的に短期サイクルへ移行する。

## 0. 2026-08-20 セッション: 初回セットアップ完了（§4 全手順クリア）

**運用開始済み。** dry-run → 1商品本実行 → RMS反映確認 → 自動実行ON → タスク登録（9:00/21:00）まで完了。
初回の自動実行は 2026-08-20 9:00。以降は実行履歴画面と `logs/point_boost_task.log` で確認する。

このセッションで判明・対応した実機知見（詳細は requirements.md §8 追記分）:

1. **楽天ウェブサービス2026年刷新への対応**（移行期間 2026-02-10〜05-13 で旧APIは廃止済み）:
   - 新エンドポイント `openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260701`
   - 認証は applicationId（UUID形式）＋ accessKey（ヘッダ渡し）の両方必須。formatVersion=2 のキーは `items`（小文字）
   - **アプリタイプは「Backend Service」必須**（Web Application はブラウザ用で、サーバーからは
     REQUEST_CONTEXT_BODY_HTTP_REFERRER_MISSING / HTTP_REFERRER_NOT_ALLOWED の403になる）。
     Backend Service は送信元IP検証 — 登録IP: 60.145.9.91（2026-08-20時点の自宅回線）。
     **回線のIPが変わると403になる** → 実行履歴にエラーが並んだら楽天 /app/list の Edit でIPを更新する
2. **pointCampaign の実機制約**（`docs/楽天/items.patch.txt` と実PATCHで確認。R1解消）:
   - フィールド実在・PATCH反映OK（bir-shiku24 に 2倍・2026-08-20 10:00〜08-27 10:59:59 で適用済みを GET で確認）
   - start は「時」単位（00分00秒へ自動切り捨て）・現在から2時間以内は IE0173・過去は IE0121
     → `buildBoostPatch` は「now+2時間超の次の正時」を送る実装に修正済み
   - end は 59分59秒へ自動変換される（送信値+約1時間になるのは仕様）
   - **IE0154: 適用期間中の pointCampaign は更新不可** → 適用中に競合がさらに上がった場合の追随PATCHは
     エラー記録になる（実害小: 期間満了の自然失効後、次の定期実行で再設定される。頻発したら planner で
     「適用中は skip」に変える選択肢あり）
3. `.env.local` 設定済み: RAKUTEN_APPLICATION_ID（UUID）/ RAKUTEN_WEBSERVICE_ACCESS_KEY / POINT_BOOST_USER_EMAIL
4. テスト3ファイル（ichiba-search-client / service / point-campaign）はユーザー承認のうえ新仕様に更新（git rm→再作成）。
   vitest 全緑・変更分の tsc / eslint クリーン。**変更は未コミット**（コミットはユーザー判断待ち）

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
