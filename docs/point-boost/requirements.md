# ポイント変倍最適化（point-boost）— 要件定義・実装プラン

> 作成日: 2026-08-17 ／ 対象ブランチ: `claude/konbanwa-tg677w`
> 依頼: 「登録済みSKUについて1日2回、楽天市場で同一商品を最安値順に検索して他店のポイント倍率をチェックし、
> 自店のポイント変倍を競合より高く設定して検索結果での出面（露出）を良くしたい」

## 1. 背景・目的

楽天市場の検索結果では価格とポイント倍率が表示され、同一商品を扱う他店よりポイント倍率が
高いと露出・転換率が上がる。例: ランドリン 3倍8個セットを最安値順で検索したとき、
他店が全て1倍なら自店を2倍にすれば出面が良くなる。
本機能はこの「競合のポイント倍率チェック → 自店の商品別ポイント変倍の追随設定」を自動化する。

## 2. 決定事項（ユーザー確認済み 2026-08-17）

| 項目 | 決定 |
|---|---|
| 倍率決定ルール | **競合最安値上位の最大倍率 +1倍、上限3倍**（上限・比較店舗数などは設定画面で変更可） |
| 反映方式 | **自動反映**（ガード付き。全件を実行履歴に記録し画面で確認できる） |
| 実行環境 | **Windows タスクスケジューラ**で1日2回（実行スクリプト＋タスク登録batを提供） |
| 競合検索の認証 | 楽天ウェブサービス applicationId は**未取得 → 後から `.env.local` に設定**。未設定時はエラーではなく案内を表示 |

## 3. 用語

- **商品別ポイント変倍**: 楽天RMSで商品単位にポイント倍率（2〜20倍）と適用期間を設定する機能。上乗せ分のポイント原資は**店舗負担**。
- **楽天ウェブサービス（Ichiba Item Search API）**: 楽天市場の公開検索API。`applicationId`（無料発行）で認証し、
  キーワード検索・価格昇順ソート・各商品の `pointRate`（ポイント倍率）/`itemPrice`/`shopCode` が取れる。RMSのESA認証とは別系統。
- **登録済みSKU**: 本アプリの products のうち楽天に掲載済みのもの（`mallPresence().rakuten` = `mall_listed.rakuten` または `rakuten_manage_number` あり）。

## 4. 機能要件

- **FR1 競合検出**: 対象商品ごとに、SKUのJANコード（13桁）をキーワードに楽天市場を価格昇順で検索し、
  自店（`ichiban-okinawa`）を除く競合の `価格 / ポイント倍率 / 店舗 / URL` を取得する。
  - JANで有効な競合が見つからない場合は掲載商品名で1回だけ再検索し、商品名の一致度（有意トークンの0.6以上）で検証する。
    自店価格が不明（0円）の商品は価格帯ガードが効かないため商品名検索は行わない（安全側）。
  - JAN検索のヒットにも緩い商品名検証（一致度0.3以上）を掛ける（説明文だけにJANが載る姉妹品・別商品の追随を防ぐ）。
  - 同一商品判定のガード: 自店の**税込換算**販売価格（`rakutenTaxInclusive`。selling_price は税抜統一のため）の
    0.5〜2.0 倍の価格帯のみ有効（入数違い・別商品の混入を防ぐ）。
  - 一致度の計算では販促常套句（送料無料・あす楽等）と数量語（8個セット等）を除外する
    （汎用語だけの一致で別ブランド品を競合と誤認しない）。
- **FR2 倍率決定**: 最安値上位N**店**（既定3店。同一店の複数出品は1店と数える）の最大ポイント倍率 +1倍。
  上限（既定3倍）で打ち止め（capped として記録）。競合に勝てる倍率が1倍以下なら変倍しない。
- **FR3 自動反映**: 決定した倍率を RMS Item API 2.0 の `pointCampaign`（倍率＋適用期間、既定7日間）で自店商品へ PATCH する。
  - 既に目標倍率で適用中かつ残り期間が36時間超なら何もしない（unchanged）。
  - **降格ガード**: 現在の倍率が目標より高いときは下げない（手動設定の可能性。期間満了で自然失効）。
  - **予約保護**: 開始前の予約キャンペーン（applicablePeriod.start が未来）には一切触らない。
  - **自動の解除PATCHは行わない**（誤発動で手動キャンペーンを消すリスクを避ける）。変倍を止めたいときは
    上限倍率を1にする/無効化する → 適用中の変倍は期間満了（最長 campaign_days）で自然失効する。
- **FR4 定期実行**: 1日2回（既定 9:00 / 21:00、タスク登録batで変更可）。アプリ（next dev）の起動有無に依存しない単体スクリプト。
- **FR5 手動実行**: 画面から dry-run（照会のみ）と本実行をいつでも実行できる（1回の上限25件・多重実行は409で拒否）。
- **FR6 記録**: 実行（run）と商品別結果（検索キーワード・競合スナップショット・現在→目標倍率・アクション・詳細）を全件DBに記録し、画面で閲覧できる。
- **FR7 設定**: 有効/無効・+n倍・上限倍率・比較店舗数・適用日数を画面で変更できる（既定: 無効 / +1 / 3倍 / 3店 / 7日）。
  **自動実行（scheduled）は設定が有効のときだけ反映する**（コスト事故防止の安全弁）。手動実行は無効中でも可（動作確認用）。
- **FR8 未設定時の案内**: `RAKUTEN_APPLICATION_ID` 未設定時は検出を実行せず、設定手順の案内を返す。

## 5. 非機能・ガード

- 楽天API負荷: 検索・RMSともに直列実行＋既存 `createQpsPacer`（最低1100ms間隔、429/503は逓増リトライ）。並列リクエスト禁止（既存慣例踏襲）。
- 同一キーワードの検索は run 内でキャッシュし再利用（同一JANのSKU・商品で重複検索しない）。
- 1商品の失敗で全体を止めない（件別 try/catch、結果に error 記録）。検索APIのエラーが5回連続したら run を中断する
  （エラー応答はキャッシュしない＝一過性の429/503が run 全体に固定化されない）。
- HTTP ルートは `maxDuration=300` と件数上限25（1商品最悪約9秒×25 ≒ 4分弱）で Next.js のタイムアウト内に収める。
  全件処理はスケジューラ用スクリプトで行う。実行中の二重起動は 409 で拒否する。
- コストガード: 上限倍率（既定3倍）、変倍は倍率2以上のみ、期間は最長60日。設定変更はすべて記録画面で追跡可能。
- RMS 商品照会は 404（商品なし）のみ対象外（skipped）とし、その他の失敗は error として区別する。

## 6. 設計

### 6.1 データ（Supabase・新規3テーブル、既存RLS慣例 = 本人のみ全操作）

`webui/supabase/migrations/20260817000001_create_point_boost.sql`

- `point_boost_settings` (user_id PK): enabled / plus_rate / max_rate / compare_top_n / campaign_days / updated_at
- `point_boost_runs` (id PK): trigger(manual|scheduled) / dry_run / status(running|done|error) / started_at / finished_at / 各件数 / error
- `point_boost_results` (id PK, run_id FK cascade): product_id / ne_code / product_name / rakuten_manage_number /
  search_keyword / keyword_type(jan|name) / matched_count / competitors(jsonb 上位5件) / competitor_max_rate /
  current_rate / target_rate / capped / action(boosted|cleared|unchanged|no_competitor|skipped|error) / detail / created_at

適用: `cd webui && node scripts/apply_sql.mjs supabase/migrations/20260817000001_create_point_boost.sql`

### 6.2 モジュール（規約: モールAPI呼び出しはクライアント層のみ、機能は lib/<feature>+barrel）

- `webui/lib/rakuten/ichiba-search-client.ts` … 楽天市場商品検索APIクライアント（新規・barrel公開）。
  `searchIchibaItems(applicationId, {keyword, hits, sort:"+itemPrice"})` → `pointRate/itemPrice/shopCode/...`（formatVersion=2）
- `webui/lib/rakuten/credentials.ts` … `getRakutenApplicationIdFromEnv()` を追加（env: `RAKUTEN_APPLICATION_ID`）
- `webui/lib/point-boost/`（新規featureフォルダ＋barrel）
  - `types.ts` 設定・結果型と既定値
  - `matcher.ts` 競合抽出（自店除外・価格帯ガード・商品名一致度）【純関数・テスト】
  - `rate-rule.ts` 目標倍率決定（+1・上限・2〜20クランプ）と更新要否【純関数・テスト】
  - `point-campaign.ts` RMS `pointCampaign` の解析/パッチ生成・JST日時整形【純関数・テスト】
  - `planner.ts` 商品1件の実行計画（SKU別競合→アクション決定）【純関数・テスト】
  - `repository.ts` settings/runs/results のCRUD＋対象商品の取得（1000件ページング、`dbRowToProductInput`）
  - `service.ts` 実行本体 `runPointBoost(deps, {dryRun, trigger, limit})`（IOのみ薄く。supabase/資格情報は注入式でHTTPルートとスクリプト双方から使う）

### 6.3 API（既存12系統の `rakuten` 系統下・レスポンス `{ok, ...}` 慣例）

- `POST /api/rakuten/point-boost/run` … body `{dryRun?: true, limit?: 40}`。dry-run既定・上限50・maxDuration300
- `GET/POST /api/rakuten/point-boost/settings` … 設定の取得（applicationId/RMS資格の設定有無フラグ付き）と保存
- `GET /api/rakuten/point-boost/runs` … 実行履歴一覧／`?runId=` で商品別結果

### 6.4 画面・ナビ

- `app/(main)/point-boost/page.tsx` ＋ `components/point-boost/PointBoostPanel.tsx`（設定・手動実行・実行履歴/結果テーブル）
- `components/nav/SideNav.tsx`「品質・監査」グループに「ポイント変倍」を追加、`help/page.tsx` の SCREEN_TOC＋説明節を追加

### 6.5 定期実行（Windows タスクスケジューラ）

- `webui/scripts/point_boost_run.mjs` … 単体実行スクリプト（`npx tsx`。`.env.local` を読み service role で対象ユーザーを解決、
  `runPointBoost` を trigger=scheduled で実行。設定が無効なら何もせず正常終了）。
  動作確認は `--manual`（既定 dry-run）、実反映の確認は `--manual --live` を明示する
- `scripts/point-boost-run.bat` … webui で上記を実行し `logs/point_boost_task.log` に追記
- `scripts/register-point-boost-task.bat` … `schtasks /Create` で 9:00 / 21:00 の2タスクを登録（時刻は bat 内変数で変更可）

## 7. 運用手順（初回セットアップ）

1. https://webservice.rakuten.co.jp/ でアプリ登録し applicationId を発行（無料）
2. `webui/.env.local` に `RAKUTEN_APPLICATION_ID=xxxxxxxxxxxxxxxxxxx` を追記
3. マイグレーション適用: `cd webui && node scripts/apply_sql.mjs supabase/migrations/20260817000001_create_point_boost.sql`
4. アプリの「ポイント変倍」画面で dry-run を実行し、競合検出と目標倍率を確認
5. 問題なければ設定を「有効」にして保存
6. `scripts\register-point-boost-task.bat` を実行してタスク登録（PCが起動している時間帯に合わせて時刻調整）

## 8. リスク・要実機確認

- **R1 `pointCampaign` フィールド**: RMS Item API 2.0 の item リソースに `pointCampaign`（applicablePeriod/benefits.pointRate）が
  存在する前提（RMSの「商品別ポイント変倍」に対応）。リポジトリ内の楽天API仕様書（docs/楽天/…）は git 管理外で本環境から確認できないため、
  **初回 dry-run 後の実機 PATCH 1件で要確認**。フィールド名が異なる場合も `point-campaign.ts` の修正のみで済む構造にした。
  自動の解除PATCHは行わない設計のため、解除セマンティクスの実機依存は無い（自然失効のみ）。
- **R2 JAN検索の網羅性**: 検索APIにJAN専用パラメータがなく、JANを記載していない店舗はヒットしない。
  商品名フォールバック＋一致度ガードで補うが、「競合なし」誤判定の可能性は残る（その場合は変倍しない=安全側）。
- **R3 検索APIのポイント表示**: `pointRate` が SPU 等を除く店舗設定倍率を返す前提。実データで妥当性を確認する。
- **R4 PC稼働前提**: タスクスケジューラ方式は実行時刻にPCが起動している必要がある。運用が合わなければ
  クラウド実行（Supabase Edge Functions 等）へ移行可能な構造（service は注入式）。
- **R5 検索インデックス遅延**: 楽天市場の検索に反映されるまで新規商品は競合側から見えない場合がある（自店露出には影響なし）。

## 9. テスト計画

- vitest（対象の隣に配置・既存改変なし）: `rate-rule` 倍率マトリクス／`matcher` 自店除外・価格帯・一致度／
  `point-campaign` 解析・パッチ生成・JST整形／`planner` アクション分岐／`ichiba-search-client` パラメータ組立とレスポンス解析（fetchスタブ）
- 検証コマンド: `pnpm lint` / `npx tsc --noEmit` / `pnpm test` / `pnpm build`
- 実機検証（ユーザー環境）: applicationId 設定後に dry-run → 1商品だけ本実行 → RMS管理画面で変倍反映を確認
