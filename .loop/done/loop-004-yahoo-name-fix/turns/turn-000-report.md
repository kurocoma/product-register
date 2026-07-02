# turn-000 report（loop-004 Yahoo name 整形・report は司令塔が要約保存）

> generator が maxTurns 制約で report 未記載のまま終了したため、protocol に従い司令塔が要約保存。実装は generator が実施。

## 実行したコマンドと結果（4ゲート・cd webui）
- `npx tsc --noEmit` → exit 0
- `npm run test` → **33 files / 243 tests passed**（既存226 + 新規17）。**既存 item-mapper-fit.test.ts は 10/10 緑のまま**（'あ'×100→fullWidthLen 75 維持）。
- lint / build は hard gate 機械検証で確認。

## 変更/追加ファイル（何を・なぜ）
- `webui/lib/product/text-fit.ts`（変更）: **AC-N01** `htmlToPlainText`（`<br>`系→半角空白・他タグ除去・連続空白畳み）追加。**AC-N02** `fitFullWidthAndChars(s, maxFull, maxChars)`（幅と文字数の二重上限・境界非破壊）追加。既存 fullWidthLen/fitFullWidth/stripHtml は維持。
- `webui/lib/yahoo/item-mapper.ts`（変更）: `FieldLimit` に `html:"br-to-space"` と `maxChars` を許容。`name = {max:75, html:"br-to-space", maxChars:75}`。`fitYahooField` が br-to-space→htmlToPlainText、maxChars 指定時 fitFullWidthAndChars を適用。他フィールドは現状維持。
  - なぜ: 各文字は最大1全角 → **文字数≤75 で Yahoo 全角換算≤75 を構造保証**（自前カウントと Yahoo 実カウントの差を吸収）。キーワード保持・本来商品名(先頭)は残る。it-01017 を実データ名で解消。
- `webui/lib/product/text-fit-html.test.ts`（新規・Bash）: htmlToPlainText / fitFullWidthAndChars の単体テスト。
- `webui/lib/yahoo/item-mapper-name.test.ts`（新規・Bash）: **実データ風** name（本来商品名＋`<br>`＋キーワード多数・混在幅）→ HTML無し・文字数≤75かつ幅≤75・本来商品名先頭保持・`<br>`→空白・短い名不変・'あ'×100→75。

## 未解決 / 既知リスク
- Yahoo 実カウントの最終確認は完了後のライブ `e2e_migrate --commit` 再実行（ループ外）。文字数≤75 は安全側保証だが、万一 Yahoo が char>full でカウントする特殊ケースは実機で確認。

## 触っていない範囲
既存テスト(*.test.*)無改変・新規は Bash 作成。`YahooConverter`・loop-003 の path/explanation/他フィールド整形・既存ルート・設定/依存/ハーネス: 未変更。
