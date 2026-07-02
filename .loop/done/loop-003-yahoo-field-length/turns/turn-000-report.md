# turn-000 generator report

## 実行したコマンドと結果（4ゲート・cwd=webui）
- `npx tsc --noEmit` → exit 0（型エラーなし）
- `npm run lint` → exit 0（0 errors / 既存の warning 8 件のみ・新規ファイル指摘なし）
- `npm run test` → exit 0（31 files / 226 passed = 既存201 + 新規25）
- `npm run build` → exit 0（Next.js 本番ビルド成功）

## 変更ファイル
- `webui/lib/product/text-fit.ts`（新規）: 全角ベースの文字数ユーティリティ。
  - `fullWidthLen(s)` 全角=1/半角=0.5（ASCII・半角カナを0.5、サロゲートペアは1コードポイント=全角1）。
  - `fitFullWidth(s,max)` コードポイント単位で末尾切詰。上限内は不変・全角/サロゲートを割らない。
  - `stripHtml(s)` HTML不可フィールド用のタグ除去（既存 converter と同等）。
  - なぜ: AC-F01。全フィールド整形の土台。
- `webui/lib/yahoo/item-mapper.ts`（変更）:
  - `YAHOO_FIELD_LIMITS` 表（name75 / headline30(html) / explanation500(html) / abstract500 / caption5000 / additional1-3 5000 / meta_desc80 / variation1-5_name28）と path 制約（各セグメント全角20・8階層・出力は":"区切り）を追加。
  - `fitYahooPath` / `fitYahooFieldLimits`: 各フィールドを上限へ適合整形（HTML不可は stripHtml 後、path は区切り検出→各20全角→8階層→":"連結）。上限内は無変更。
  - `validateYahooFieldLimits`: 整形後も残る上限超過・必須空（path/name/product_category）を検知。
  - `buildYahooEditItemParams` の末尾を `return fitYahooFieldLimits(params)` に変更（**本ループの核**。長い name/path/explanation の editItem 拒否を解消）。
  - `validateEditItemParams` を拡張: 既存の必須有無チェックに加え `validateYahooFieldLimits` の違反も `missing` に載せる。**戻り値 shape は従来どおり `{ok:true}|{ok:false; missing:string[]}` を維持**（後方互換）。
  - なぜ: AC-F02/F03/F04。it-01002(path)/it-01017(name)/it-01033(explanation) を解消し、dry-run 事前検知を効かせる。

## 新規テスト（Bash heredoc で作成・既存 *.test.* は無改変）
- `webui/lib/product/text-fit.test.ts`: fullWidthLen(全角/半角/半角カナ/混在/絵文字/空)・fitFullWidth(上限内不変/ちょうど/超過切詰/半角0.5/全角境界で割らない/サロゲート保護/上限0)・stripHtml。
- `webui/lib/yahoo/item-mapper-fit.test.ts`: 長 display_name→name全角75 / HTML込 explanation→除去後500 / HTML込 headline→除去後30 / 長 yahoo_path(" > ")→各セグメント全角20・":"区切り・8階層 / 短い値は不変(name/path/headline) / validateEditItemParams が超過・必須空を検知（shape 維持）。

## AC-F04（dry-run 事前検知）の配線方針
- `route.ts`（app/api 配下＝今回の触れる範囲外）を触らず、migrate executor が注入する `validateYahoo = validateEditItemParams` を拡張する形で実現。
- executor は preview で `deps.validateYahoo(previewParams)` を呼び、その結果を `missingRequiredYahooFields` 経由で `buildItemPlan` に渡し requires_manual へ倒す既存経路がある。`validateEditItemParams` 拡張により dry-run で文字数超過・必須空も surface される（commit で初めて editItem 拒否されない）。
- そのため `lib/migrate/executor.ts` は**変更不要**（直接編集せず、既存 DI 経路を活かした最小差分）。

## 未解決事項 / 既知リスク
- caption / additional1-3（HTML可・全角5000）は極端に長い場合 `fitFullWidth` がタグ途中で切れて HTML が壊れる可能性がある。今回のブロッカー対象（name/path/explanation）ではなく、5000全角超は稀。tag-aware 切詰は別途検討（report に明記し本ループでは未対応）。
- path の区切り検出は `:` `>` `›` `＞`（前後空白可）に限定。`/` や `|` を区切りに使うデータがあれば1セグメント扱いになる（カテゴリ名内の `/` を誤分割しない安全側）。
- ストアカテゴリパスの意味的最適化（product_category との整合）は task の仮定どおりスコープ外。editItem 適合（各20全角・8階層）の担保のみ。

## 触っていない範囲（plan外・意図的に保留）
- `lib/converters/yahoo.ts`（YahooConverter）: 既存 yahoo.test.ts 保護のため不変。整形は editItem 専用層に限定。
- `lib/migrate/executor.ts` / `route.ts`: 既存 DI 経路で AC-F04 を満たせるため未変更。
- `package.json`/lockfile・tsconfig・eslint・vitest・.env/secrets: 変更禁止のとおり未変更。依存追加なし。ライブ API 未使用。
