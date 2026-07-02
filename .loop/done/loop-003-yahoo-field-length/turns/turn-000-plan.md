# turn-000 plan（loop-003 Yahoo フィールド文字数整形）

## Goal
ライブテストで判明したブロッカー（楽天の長い name/path/explanation が Yahoo 文字数上限超過で editItem 拒否）を、**共有マッパー層での文字数整形＋検証**で解消する。AC-F01〜F04 を一括投入し、AC-F05(後方互換)/F06(テスト) を維持。整形は `buildYahooEditItemParams`（editItem 専用層）に入れ、bulk・単品双方に効かせる。`YahooConverter` 出力は変えない（既存 yahoo.test 保護）。新規テストは Bash 作成（既存 *.test.* 無改変）。

## Analysis
- 直前 eval: なし（初周）。ベースライン: lint0/tsc0/unit201/build0。
- 実コード接地: `lib/yahoo/item-mapper.ts buildYahooEditItemParams` が `YahooConverter().convert([p])[0]` の row を params 化。`validateEditItemParams` は必須有無のみ。フィールド対応: name=display_name / path=yahoo_path / explanation=buildExplanation / headline=catch_copy_yahoo / caption / abstract。
- Yahoo 上限(docs/Yahoo/02): name 全角75 / path カテゴリ名 全角20(コロン区切り8階層) / headline 全角30(HTML不可) / explanation 全角500(HTML不可) / abstract 全角500 / caption 全角5000 / additional1-3 全角5000 / meta_desc 全角80 / variation*_name 全角28。全角=1・半角=0.5。
- 整形を `buildYahooEditItemParams` の後処理に置く理由: editItem 専用・共有（単品/bulk 双方）・`YahooConverter` を変えないので既存 yahoo.test.ts が不変。register/yahoo 既存テストは短いテストデータ＝整形で出力不変。

## Changes
### AC-F01 全角切詰ヘルパ（新規）
- `webui/lib/product/text-fit.ts`（新規）:
  - `fullWidthLen(s: string): number` — 全角=1, 半角=0.5（半角は ASCII/半角カナ等。サロゲートペア=1コードポイント全角扱い）。
  - `fitFullWidth(s: string, maxFullWidth: number): string` — 上限全角数に収まるよう末尾を切る。**全角文字/サロゲートペアを割らない**（Array.from でコードポイント単位）。
  - `stripHtml(s: string): string` — HTML 不可フィールド用にタグ除去（簡易・既存に同等があれば再利用）。
  なぜ: AC-F01。全フィールド整形の土台。

### AC-F02/F03 各フィールド上限整形（共有マッパー）
- `webui/lib/yahoo/item-mapper.ts`:
  - フィールド→上限の表 `YAHOO_FIELD_LIMITS`（name:75, headline:30(html除去), explanation:500(html除去), abstract:500, meta_desc:80, caption:5000, additional1:5000, additional2:5000, additional3:5000, variation1_name..variation5_name:28 等）を定義。
  - `fitYahooFieldLimits(params): params` — 各フィールドに `fitFullWidth`（HTML不可フィールドは `stripHtml` 後に）を適用。**上限内は無変更**。`path` は専用処理: 既存 separator(" > "/"›"/":" 等)を検出して分割→各セグメント `fitFullWidth(_,20)`→`:` 連結→先頭8階層に制限。
  - `buildYahooEditItemParams` の最後で `fitYahooFieldLimits(params)` を適用してから返す。
  なぜ: AC-F02/F03。it-01002(path)/it-01017(name)/it-01033(explanation) を解消。長い楽天データでも editItem 適合。

### AC-F04 文字数検証・dry-run 事前検知
- `item-mapper.ts`: `validateYahooFieldLimits(params): {ok:true}|{ok:false; violations:string[]}` — 整形後も上限超過 or 必須空（特に path/name/product_category）を検知。
- migrate 連携: dry-run/preview で **整形後の params** に対し検証し、超過/必須欠落があれば `requires_manual`（commit で初めて editItem 拒否されない）。`buildItemPlan` への `missingRequiredYahooFields`/新フラグに反映（executor が preview 時に検証）。
  なぜ: AC-F04。dry-run が honest になる（今回のブロッカーは dry-run で migrate と誤判定された）。

### 後方互換（AC-F05/F06）
- 変更は `lib/product/text-fit.ts`(新規)・`lib/yahoo/item-mapper.ts`(整形/検証追加)・必要なら `lib/migrate/executor.ts`(検証連携) のみ。`YahooConverter`(yahoo.ts) は変えない。短いフィールドは出力不変＝既存 register/yahoo・yahoo.test・201 緑を維持。

## 新規テスト（すべて Bash 作成・既存 *.test.* 不可）
- `webui/lib/product/text-fit.test.ts`: fullWidthLen(全角/半角/混在/絵文字)・fitFullWidth(上限ちょうど/超過1/全角境界で割らない/サロゲート)・stripHtml。
- `webui/lib/yahoo/item-mapper-fit.test.ts`: 長い name→75全角内 / explanation(HTML込)→タグ除去後500内 / headline→30内 / path(長セグメント, " > "区切り)→各20全角・":"区切り・8階層 / 短いフィールドは不変 / validateYahooFieldLimits が超過/空を検知 / seller_id・display 制御は従来どおり。

## Pre-submission checks（generator が提出前に実行）
- `cd webui && npx tsc --noEmit` → 0
- `cd webui && npm run lint` → 0
- `cd webui && npm run test` → 既存201 + 新規が全緑
- `cd webui && npm run build` → 0

## 優先（generator 向け）
AC-F01→F02/F03→F04。尽きそうなら最低 F01+F02+F03（name/explanation/path 整形＋テスト）を完了し4ゲート緑を確保、F04 連携は未完なら report に明記。既存テストは編集・緩和しない。
