# turn-000 plan（loop-004 Yahoo name 整形）

## Goal
ライブ再テストで残った name(it-01017) を、**name の HTML除去（`<br>`→空白）＋安全マージン切詰（キーワード保持）**で解消する。AC-N01〜N03 を核に実データ風テストで固め、AC-N04(互換)/N05(テスト) を維持。loop-003 の path/explanation 整形は不変。新規テストは Bash 作成。

## Analysis
- 直前 eval: なし（初周）。ベースライン: lint0/tsc0/unit226/build0。
- ライブ診断: 整形後 name=74.5〜75全角(自前カウント)・chars=87〜89 でも Yahoo は >75。原因 = (1) name の `<br>` 未除去、(2) 自前カウントが Yahoo 実カウントより約1全角小さい(境界で負け)。`<br>`前の本来商品名は 19〜35全角と短い。
- 実コード: `item-mapper.ts` の `YAHOO_FIELD_LIMITS.name={max:75}`(html対象外)、`fitYahooField(value,limit)` は `limit.html` 時 stripHtml 後 `fitFullWidth(base, limit.max)`。`text-fit.ts` に `fullWidthLen/fitFullWidth/stripHtml`。
- 方針(キーワード保持・DEC-402): name に「`<br>`→空白変換＋他タグ除去」＋「安全マージンを引いた実効上限(<75)」を適用。Yahoo 実カウント差を吸収。本来の商品名(先頭)は保持。

## Changes
### AC-N01 name の HTML 除去（<br>→空白）
- `webui/lib/product/text-fit.ts`: `htmlToPlainText(s: string): string` を追加 — `<br>`/`<br/>`/`<br />`(大小文字・空白許容) を**半角空白に変換**し、その他タグを除去、連続空白を1つに畳む・trim。（既存 `stripHtml` は維持/内部利用可）。
  なぜ: AC-N01。name は plain text。キーワード区切りは空白で保持。

### AC-N02/N03 文字数＋幅の二重上限で整形（name）— margin ではなく char-count
- `webui/lib/product/text-fit.ts`: `fitFullWidthAndChars(s, maxFull, maxChars): string` を追加 — コードポイント走査で「累積 fullWidth が maxFull を超える」または「文字数が maxChars を超える」**手前で停止**（全角/サロゲート非破壊）。`fitFullWidth` は維持。
- `webui/lib/yahoo/item-mapper.ts`:
  - `FieldLimit` 型に `html?: boolean | "br-to-space"` と `maxChars?: number` を許容（後方互換・既定なし）。
  - `YAHOO_FIELD_LIMITS.name` を `{ max: 75, html: "br-to-space", maxChars: 75 }` に変更。他フィールドは現状維持。
  - `fitYahooField(value, limit)`: `limit.html==="br-to-space"`→`htmlToPlainText` / `limit.html===true`→`stripHtml` 適用後、`limit.maxChars` があれば `fitFullWidthAndChars(base, limit.max, limit.maxChars)`、無ければ従来 `fitFullWidth(base, limit.max)`。
  なぜ: 各文字は最大1全角 → 「文字数<=75」なら Yahoo 全角換算<=75 を**構造的に保証**（自前カウントの差に依存しない）。キーワード保持しつつ確実に通る。本来商品名(先頭・短い)は必ず残る。

### 後方互換（AC-N04/N05）— 既存テストを壊さない
- **重要**: 既存 `item-mapper-fit.test.ts`(loop-003 作成・編集不可) は `'あ'×100 → fullWidthLen(name)===75` を厳密検証。**全角のみは 文字数=幅** なので二重上限でも `'あ'×100→'あ'×75`（75文字・全角75）で **fullWidthLen===75 のまま緑**（char-count 方式が margin より優れる点）。**実装前にこの整合を Read で確認**すること。
- 変更は `text-fit.ts`(fitFullWidthAndChars/htmlToPlainText 追加)・`item-mapper.ts`(name の html/maxChars) のみ。`YahooConverter` 不変。path/explanation 等は maxChars 未指定で従来不変。短い name(HTML無・<=75文字) は不変。

## 新規テスト（Bash 作成・既存 *.test.* 不可）
- `webui/lib/product/text-fit-html.test.ts`: `htmlToPlainText`（`<br>`/`<br/>`/`<BR>` →空白 / `<b>`等タグ除去 / 連続空白畳み / HTML文字を含まない）。
- `webui/lib/yahoo/item-mapper-name.test.ts`: **実データ風** name「琉球 もろみ酢 430mg×93球（約1ヵ月分）<br>しまのや クエン酸 アミノ酸 元気 健康 美容 …(多数, 全角半角記号数字混在)」→ 整形後 name に `<` `>` 無し / `[...name].length <= 75` かつ `fullWidthLen(name) <= 75` / 先頭が「琉球 もろみ酢…」で始まる(本来商品名保持) / 短い name(HTML無・<=75文字) は不変 / 全角のみ('あ'×100)→文字数75・幅75。

## Pre-submission checks
- `cd webui && npx tsc --noEmit` → 0 / `npm run lint` → 0 / `npm run test` → 既存226+新規 全緑 / `npm run build` → 0

## 優先
AC-N01→N02/N03。既存 item-mapper-fit.test との衝突可能性を**最初に確認**（margin で name 上限が 72 になる影響）。衝突回避を最優先しつつ実データ名で it-01017 解消。
