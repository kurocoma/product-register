# reference — AI判別17項目・信憑性ポリシー・制約・マッピング・事前質問テンプレ

対象アプリ: `C:\Users\hppym\dev\product-register`（以下、パスはこのリポジトリからの相対）。

## 1. AI判別17項目の定義

各項目は「入力ソース → 判定手順 → 出力先」で運用する。出力先は統一入力フォーマット
（`docs/spec.md` §3）/ WebUI スキーマ（`webui/lib/product/schema.ts`）のフィールド名。

| # | 項目 | 入力ソース | 判定手順 | 出力先 |
|---|---|---|---|---|
| 1 | 消費税率 (10 or 8) | 商品名・確定したモールカテゴリ・R1調査のスペック | 酒類（アルコール分1度以上）または飲食料品以外 → **10**。飲食料品（酒類・外食を除く）→ **8**（軽減税率）。判定例の対: 泡盛 GIANTSボトル＝酒類→**10**（[example.md](example.md)）/ 黒毛和牛洋風リゾット＝加工食品（惣菜・持ち帰り）→**8**（[example-risotto.md](example-risotto.md)）。判定が割れる商品（みりん風調味料・ノンアルコール等）は 10 で仮置きして要確認リストへ | `tax_rate`（SKU別は `variants[].tax_rate`） |
| 2 | 作成する画像の枚数と内容の提案 | 調査で確証が取れた訴求点（受賞・製法・容量・ブランド）+ ユーザー提供画像 | 既定 **5枚** で構成案を作る: ①商品全体（サムネイル）②特徴・訴求コピー ③スペック表（容量・度数等）④利用シーン・飲み方 ⑤ブランド/製造者紹介。訴求点の量に応じて枚数を増減して提案。**画像は作らない**（提案のみ。枚数は確認ステップでユーザーが確定） | `image_count`（画像URLは空欄なら画像数+商品コードから自動生成: `docs/spec.md` §3.5・§6） |
| 3 | モール基本カテゴリ | JAN・商品名（R3調査） | ①楽天市場で同一JAN/類似商品を検索し、売れ筋商品のジャンルを候補化 ②候補ジャンルIDが `docs/ichiba_attribute_list_20260421.csv`（cp932）に実在することを確認 ③候補2〜3件を確信度つきで確認ステップに提示し、最有力を採用 | `mall_category_id`（楽天ジャンルID 6桁: `docs/楽天/02-商品登録更新-upsert-patch.md` genreId）。YahooカテゴリID/パスはグリッド保存時に自動補完される（`webui/lib/product/grid-rows.ts` の autoHint。対応表は `docs/rakuten_yahoo_category_mapping.csv`） |
| 4 | 店舗内カテゴリ | 既存商品の実績（WebUI products テーブル・楽天取込データの `store_category`） | 同ジャンルの既存商品が使う店舗内カテゴリを検索して候補提示（例: 泡盛 → 「沖縄のお酒」`docs/spec.md` §3.2）。実績が見つからなければ空欄+要確認 | `store_category` |
| 5 | キャッチコピーPC | 確証の取れた訴求点（R1/R2/R4） | 実績・限定性・用途を優先語に生成 → **全角87文字以内**（§3の上限表参照）をコードで実測 → 超過なら削って再実測 | `catch_copy_pc` |
| 6 | キャッチコピー(Yahoo) | 同上 | **全角30文字以内・HTML不可**（§3参照）。検索対象のため主要キーワード（商品種別・産地・容量等）を先頭側に置く | `catch_copy_yahoo` |
| 7 | 説明文1（PC） | ユーザー提供資料（最優先）+ メーカー公式 + R1/R4調査 | `docs/spec.md` §7 のテンプレートに流し込む: `<!--text-->` 6段落（魅力/特徴/おすすめ/製法/FAQ/ブランド）+ `<!--itemtable-->`（品目/原材料名/内容量/製造者/注意事項/キーワード）。使用可能タグは a,b,br,font,hr,img,p,table,td,th,tr のみ・style/CSS禁止・1行約47文字で `<br>` 改行（同§7）。**信憑性ポリシー（§2）を満たさない事実は書かない**（不明セルは「−」にして要確認リストへ） | `description_pc` |
| 8 | 説明文（スマホ） | — | **説明文(PC)と同一内容をそのまま設定する**（新たに生成しない） | `description_sp` |
| 9 | free1 | 説明文(PC)の確定内容 + R4のSEOキーワード候補 | 説明文(PC)のコピー**ではなく**、**HTMLタグなしテキストへSEOを意識してリライト**した簡単な商品情報のまとめ（検索されやすい語: 商品種別・産地・容量・度数などを自然に含める）。Yahooでは explanation（商品情報・検索対象）として送信される（`webui/lib/converters/yahoo.ts` buildExplanation は free1 優先）ため **全角500文字以内・HTML不可**（§3参照）。信憑性の低い情報は書かない | `free1` |
| 10 | free2 | — | **説明文(PC)と同一内容をそのまま設定する** | `free2` |
| 11 | メーカー名 | JAN（GS1事業者コード）・商品名検索・ユーザー提供資料（R1/R2） | JANコード検索・GS1事業者情報・パッケージ表記からメーカーを特定し、公式サイトで表記を確認。**特定できなければ空欄+要確認**（推測で書かない） | `maker_name` |
| 12 | ブランド名 | メーカー公式のブランド/シリーズ表記（R1） | 公式表記が確認できれば採用。なければ空欄+要確認 | `brand_name` |
| 13 | 項目選択肢項目名 | ユーザー入力の入数一覧 + 商品の単位 | 単位を商品から推察（720ml瓶→「本」、袋物→「袋」、箱物→「箱」…）→ 入数×単位のラベル（`1本` `3本` `6本`）を作る | `option_item_name`（単位そのものは Yahoo 用 `unit` にも設定） |
| 14 | バリエーションキー | 商品の同一性（同一JANの入数違いか） | 同一商品の入数違いの行には**同じキー**を設定（例: 商品名の短縮ラベル）。一括登録グリッドでは同じバリエーションキーの行が保存時に1商品へ統合され、楽天では同一商品管理番号（メーカーコード-JAN下4桁）配下のSKUになる（`webui/lib/product/grid-rows.ts`） | `variation_key`（グリッド「バリエーションキー」列） |
| 15 | バリエーション項目名定義 | 商品の単位（#13で推察済み） | 単位に対応する軸名を商品から推察（本→「本数」、個→「個数」、セット→「セット数」） | `variation_name`（Yahoo 軸名 `yahoo_variation_title` にも同値） |
| 16 | バリエーション1選択肢定義 | 項目選択肢項目名（#13） | #13 のラベルをパイプ区切りで連結する（`1本\|3本\|6本`） | `variation_choices`（SKU別ラベルは `variants[].variation_value`） |
| 17 | 商品属性値 1〜 | 確定したジャンルID + `docs/ichiba_attribute_list_20260421.csv`（cp932。ジャンルIDでフィルタ）+ R1/R2/R4 のスペック | ①ジャンルの「必須」属性を列挙（例: 泡盛 302916 の必須は シリーズ名・ブランド名・総本数・単品容量）②入力できる分を確認し、必須 → ナビゲーション用任意 の順に、確証の取れた値だけ埋める。**属性1〜3は必ず埋まる状態にする** ③確証できない必須項目の値は要確認リストへ（でっち上げない） | `attributes[]`（旧固定枠は `attribute_item_1〜5` / `attribute_value_1〜5` / `attribute_unit_1〜5`） |

補助フィールド（17項目の副産物として埋める）:

- `maker_code` — メーカーコードマスタ（`docs/spec.md` §8）を `maker_name` で照合。マスタに無い新規メーカーは確認ステップで質問（ne_code 生成に必須のため）。
- `display_name` — 商品名ベースの掲載商品名（グリッド保存時に自動補完。SEO向けに手を入れる場合は確認ステップで提示）。
- `keyword` — free1 生成時の主要キーワードから抽出（任意）。
- `product_type` — 入数1=「単品」、2以上=「セット商品」（同一商品の複数本セット。`docs/spec.md` §3.1）。

## 2. 信憑性ポリシー（必須遵守）

task の「信憑性の低い情報は掲載しない」を、次の実行可能な規則で運用する:

1. **出典の記録**: 事実項目（度数・容量・原材料・製造者・受賞歴・年号等）は、値ごとに出典URLと取得日を記録する。調査サブエージェントの出力JSONで `source_url` を必須にする（research-pipeline.md のテンプレ参照）。
2. **採用基準**: 次のいずれかを満たす情報のみ掲載できる —
   (a) ユーザー提供資料（URL・画像・添付ファイル）
   (b) メーカー公式・公的機関（業界団体・行政）のページ
   (c) 独立した2つ以上のソースで値が一致
3. 単一の非公式ソース（まとめサイト・個人ブログ・ECモールのレビュー）にしか無い情報は**掲載しない**。
4. 基準を満たさない項目は**空欄にし、確認ステップの「要確認リスト」に出典状況と共に載せる**（それらしく埋めない）。
5. **逃げの全空欄は禁止**: 各項目は §1 の判定手順を実行し尽くしてから空欄と判断する（空欄には理由を付す）。
6. 調査サブエージェントには毎回「不明な項目は unknown と書く。推測で埋めない」を明示する。

## 3. 文字数・サイズ上限（repo内出典つき）

| 項目 | 上限 | 出典（repo内） |
|---|---|---|
| 楽天 キャッチコピー（tagline ← `catch_copy_pc`） | **最大174バイト = 全角87文字以内** | `docs/楽天/02-商品登録更新-upsert-patch.md`「基本情報」表 #3 tagline（最大バイト174）/ `docs/spec.md` §3.3 #17（全角87文字以内） |
| 楽天 商品名（title ← `display_name`） | 最大255バイト | `docs/楽天/02-商品登録更新-upsert-patch.md` 同表 #2 |
| 楽天 PC/SP商品説明文（productDescription.pc/sp ← `description_pc`/`description_sp`） | 各 最大10,240バイト | `docs/楽天/02-商品登録更新-upsert-patch.md`「商品説明文」表 |
| 楽天 PC用販売説明文（salesDescription） | 最大10,240バイト | 同上 |
| Yahoo キャッチコピー（headline ← `catch_copy_yahoo`） | **全角30文字以内・HTML不可** | `docs/Yahoo/02-商品登録更新-editItem.md`「基本情報」表 headline / `docs/Yahoo/07-エラーコード逆引き.md` it-01030（キャッチコピー文字数超過=全角30文字以内）/ `webui/lib/yahoo/item-mapper.ts` `headline: { max: 30, ... }` |
| Yahoo 商品名（name ← `display_name`） | 全角75文字以内 | `docs/Yahoo/02-商品登録更新-editItem.md` 同表 name |
| Yahoo 商品説明（caption ← `description_pc`） | 全角5,000文字・HTML可 | `docs/Yahoo/02-商品登録更新-editItem.md`「商品説明」表 |
| Yahoo 商品情報（explanation ← `free1`） | **全角500文字・HTML不可** | `docs/Yahoo/02-商品登録更新-editItem.md` 同表 / `webui/lib/converters/yahoo.ts` buildExplanation（free1 を優先して explanation に送る） |
| Yahoo フリースペース（additional1/2） | 全角5,000文字・HTML可 | `docs/Yahoo/02-商品登録更新-editItem.md` 同表 |

運用ルール:
- 生成後に**必ずコードで実測**してから確定する（目視で数えない）。
- 楽天のバイト計上規則: **全角=2バイト・半角（ASCII/半角カナ）=1バイト**。上限表の楽天項目は
  `docs/楽天/02-商品登録更新-upsert-patch.md` の各表が「最大バイト」列で定義するとおり**バイト単位**の制限で、
  「174バイト=全角87文字」は**全角のみの場合の等式**。半角混在時は文字数でなく**バイト実測**で判定する。
- 楽天バイトの実測コマンド例: `python -c "s='<キャッチコピー>'; print(len(s.encode('cp932')))"`
  （cp932 エンコードで全角=2・半角=1 と計上される。例: `GIANTSボトル` = 半角6字+全角3字 = **12バイト**）。
- Yahoo の全角換算は 全角=1・半角=0.5（`webui/lib/yahoo/item-mapper.ts` 冒頭コメントの換算規則）。
- 超過時はタグ・語尾から削って再実測（Yahoo系のHTML可項目はタグ境界を保って切る — 同ファイルの切詰め方針に合わせる）。

## 4. 統一入力フォーマット（68列）マッピング

`docs/spec.md` §3 のフィールド名に対する値の由来。表の「AI#n」は §1 の項目番号。

| spec.md フィールド | 由来 | 備考 |
|---|---|---|
| ne_code | 自動生成 | `{maker_code}-{JAN下4桁}-{数量}`（`docs/spec.md` §4。グリッド貼付時は空欄で自動補完） |
| jan_code | ユーザー入力④ | 13桁 |
| maker_code | 補助判別 | メーカーコードマスタ（spec §8）を照合。無ければ質問 |
| product_type | 補助判別 | 入数1=単品 / 2以上=セット商品 |
| quantity | ユーザー入力① | 入数（SKUごと） |
| product_name | ユーザー入力⑤ | そのまま |
| display_name | 補助判別 | 商品名から自動補完（手修正可） |
| tax_rate | AI#1 | 10 or 8 |
| cost_price | 既定0 | ユーザーが原価を渡した場合のみ設定 |
| selling_price | ユーザー入力② | 税抜→税込換算値を確認ステップで承認してから設定 |
| shipping_type | ユーザー入力⑥ | SKU別可（`variants[].shipping_type`。個別送料は `variants[].individual_shipping_fee`） |
| image_count | AI#2 | 提案→確認で確定 |
| delivery_method | ユーザー入力③ | 語彙→配送方法セット番号（spec §8）。SKU別は `variants[].shipping_method_group` |
| lead_time | ユーザー入力⑦ | 番号そのまま（マスタ: spec §8） |
| mall_category_id | AI#3 | 楽天ジャンルID（6桁） |
| store_category | AI#4 | |
| catch_copy_pc | AI#5 | 全角87文字以内 |
| catch_copy_yahoo | AI#6 | 全角30文字以内 |
| description_pc | AI#7 | spec §7 テンプレHTML |
| description_sp | AI#8 | **description_pc と同一** |
| description_4 | 空欄 | webui では `sale_description_pc`。空欄なら画像枚数から imgList 自動生成（`webui/lib/product/grid-rows.ts` autoHint） |
| free1 | AI#9 | HTML不可・SEOリライト・全角500以内 |
| free2 | AI#10 | **description_pc と同一** |
| keyword | 補助判別 | 任意 |
| maker_name | AI#11 | 不明なら空欄+要確認 |
| brand_name | AI#12 | 不明なら空欄+要確認 |
| option_item_name | AI#13 | 入数×単位ラベル |
| option_horizontal | 空欄 | 使用しない |
| variation_key | AI#14 | 同一商品で共通 |
| variation_name | AI#15 | 例: 本数 |
| variation_choices | AI#16 | パイプ区切り（例: `1本\|3本\|6本`） |
| choice_numbers | 空欄 | 使用しない |
| image_url_1〜20 | 自動生成 | 空欄なら画像数+商品コードから自動生成（spec §3.5・§6） |
| attribute_item_1〜5 / attribute_value_1〜5 / attribute_unit_1〜5 | AI#17 | 1〜3は必須枠。可変個数版は `attributes[]`（schema.ts） |

## 5. アプリへの反映経路（repoに実在する経路のみ）

### 経路A（推奨）: WebUI 一括登録グリッド → 一括モール登録

1. 生成結果を一括登録グリッドの列順 TSV にする。列順は `webui/lib/product/grid-rows.ts` の
   **BULK_GRID_ALL_COLUMNS（基本18列 + 拡張9列 + バリエーションキー + 商品属性15列 = 43列）**。
   先頭からの部分列（基本18列だけ等）でも貼り付け可・見出し行は自動スキップ（同ファイル `parseTsv`）。
   1入数 = 1行、同一商品の入数違いはバリエーションキーを共通にする（保存時に1商品へ統合され楽天SKUになる）。
2. WebUI `/bulk-register`（`webui/app/(main)/bulk-register/page.tsx`）に貼り付け → 保存。
   保存時に ne_code・掲載商品名・YahooカテゴリID/パス・商品属性（項目・単位）が自動補完され、
   products テーブルへ upsert される（`webui/lib/product/repository.ts` upsertProduct）。
3. グリッドに無い列のうち、画像URL個別指定・SKU別個別送料は保存後に商品編集画面
   `/products/[id]` で設定する。**free1 / free2 は編集画面に入力欄が無い**
   （`webui/components/product/ProductForm.tsx` に該当フィールドが存在しない）ため、
   下の「free1 / free2 の直接反映」の手順で設定する（画面での手貼りは不可）。
4. モール登録は `POST /api/register/bulk/[mall]`（`webui/app/api/register/bulk/[mall]/route.ts`）。
   body は `{ ids: string[], dryRun?: boolean(既定true), publish?, submit?, overwrite? }`（同ファイル冒頭コメント）。
   **dryRun が既定 true（安全側）** — まず dryRun 結果をユーザーに見せ、承認後に `dryRun: false` を明示して実登録する
   （Yahoo の反映予約は `submit: true`）。
   個別登録は `/api/register/rakuten/[id]`・`/api/register/yahoo/[id]`。

### free1 / free2 の直接反映（グリッド保存後・画面を経由しない実在経路）

- **保存先の実体**: free1 / free2 は products テーブルの主要25列（`webui/lib/product/repository.ts` の
  `MAIN_COLUMNS`。ne_code〜catch_copy_yahoo の25要素）に含まれず、同ファイルの `productInputToDbRow` によって **`extra` JSONB**
  （`extra.free1` / `extra.free2`）に保存される。
- **出力への流れ**: `dbRowToProductInput`（同ファイル）が extra から復元し、NE 用 CSV
  （`webui/lib/converters/ne.ts` の free1 / free2 列）と Yahoo の explanation
  （`webui/lib/converters/yahoo.ts` buildExplanation は free1 優先）に使われる。
- **手順**: e2e テスト（`webui/tests/e2e_update_yahoo.mjs` 冒頭）と同じ admin クライアントパターンで
  `products.extra` をマージ更新する。接続情報は `webui/.env.local` の
  `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` を使う。

```bash
cd C:\Users\hppym\dev\product-register\webui
node --input-type=module -e "
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
for (const l of readFileSync('.env.local','utf8').split('\n')) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].trim(); }
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const ne = 'n019-1148-1';                    // 対象商品の NEコード
const free1 = '（§1 #9 で生成したタグなしSEOテキスト）';
const free2 = '（説明文PCと同一のHTML）';     // §1 #10
const { data: row, error } = await db.from('products').select('id, extra').eq('ne_code', ne).single();
if (error) throw error;
await db.from('products').update({ extra: { ...row.extra, free1, free2 }, updated_at: new Date().toISOString() }).eq('id', row.id);
console.log('updated:', row.id);
"
```

- extra は**必ず select してからマージ**する（`{ extra: { free1, free2 } }` の丸ごと上書きは
  attributes / variants 等の他の extra 項目を消してしまう）。
- ne_code は (user_id, ne_code) 単位で一意（service role は RLS を通らないため、複数ユーザー環境で
  同じ ne_code が複数ヒットする場合は id で絞る）。
- **反映確認**: `/products/[id]` を再読込（`dbRowToProductInput` が extra から復元して表示に乗る）、
  または CSV ダウンロードで free1 / free2 列を確認する。
- 補足: 編集画面の自動保存は ProductInput 全体を `upsertProduct`（repository.ts）に渡して往復させるため、
  この方法で設定した free1 / free2 は以後の画面保存でも保持される（入力欄が無いだけで消えない）。

### 経路B: 統一入力CSV → Phase 1 CLI

1. `docs/spec.md` §3 の68列ヘッダーで input.csv を作る。
2. `python -m product_register convert input.csv --mall all -o ./output`（`src/product_register/cli.py`）
   → 楽天（normal-item）/ NE（単品・セット）/ Yahoo / Shopify 用CSVが出力される。モールへはCSVを手動アップロード。

補足: 画像アップロードAPI（`/api/upload/rcabinet` 等）は本スキルの対象外（画像は内容提案のみ）。

## 6. 必須項目の充足チェック — 不足時の質問テンプレ（SKILL.md 手順2）

### 区分と質問の規則

- **必須** = ①作成する入数 ②売価（税抜）③配送方法 ④JANコード ⑤商品名 ⑥送料区分 ⑦納期管理番号。
  この7つが無いと登録データ（SKU行・価格・配送・納期）を構成できない。
  **必須項目がすべて埋まるまで調査（R1〜R4）を開始しない**（充足ゲート）。
  値はあるが対応が曖昧な項目（例: 配送方法→セット番号）は調査を止めない — 確認ステップで解消（SKILL.md 手順2）。
- **任意** = ⑧参考URL・画像・添付ファイル。無くても調査は可能（あれば一次情報として精度向上）。
  **⑧の欠落を理由に質問でブロックしない**（下表のとおり文末の一言に留める）。
- ④JAN は JAN の無い商品が実在するため、「JANなし」の**明示申告**で充足扱いにする
  （申告なしの空欄のまま黙って進めるのは不可）。
- 質問は**不足している項目だけ**を、**1回のやり取りにまとめて**行う
  （埋まっている項目を聞き直さない。項目ごとの小出しもしない）。
- 手段: 選択肢を事前に列挙できる項目（③⑥⑦）は **AskUserQuestion ツール（選択肢提示）を第一手段**にする。
  自由記述が必要な項目（①②④⑤）は**番号つき質問リスト**を同じメッセージで提示する。
  AskUserQuestion が使えない環境では、全不足項目を番号つき質問リストに畳む（フォールバック）。
- ②売価・③配送方法・⑥送料区分は入数ごとに異なりうるため、質問には
  「入数ごとにお答えください（例: 1本=500円、3本=1300円）」のような**形式例を添える**。

### 項目→質問文・選択肢の対応表（8項目）

| # | 項目 | 区分 | 欠けたときの質問文 | 手段・選択肢 | 期待する回答形式 |
|---|---|---|---|---|---|
| ① | 作成する入数 | 必須 | 「作成する入数を教えてください（複数指定可。1入数=1SKUになります）」 | 質問リスト（自由記述） | `1本、3本、6本` のような列挙 |
| ② | 売価（税抜） | 必須 | 「売価（税抜）を入数ごとに教えてください」 | 質問リスト（自由記述） | 入数ごと: `1本=500円、3本=1300円` |
| ③ | 配送方法 | 必須 | 「配送方法を選んでください。入数ごとに異なる場合は『入数ごとに指定』を選び内訳をご記入ください」 | AskUserQuestion: `宅急便` / `ネコポス` / `レターパック` / `入数ごとに指定（内訳を記入）` | 全入数共通なら選択肢1つ。入数別なら `1本=ネコポス、3本以上=宅急便` |
| ④ | JANコード | 必須（「JANなし」申告可） | 「JANコード（13桁）を教えてください。JANの無い商品の場合は『JANなし』とお答えください」 | 質問リスト（自由記述） | 13桁の数字 または `JANなし` |
| ⑤ | 商品名 | 必須 | 「商品名を正式表記で教えてください（容量・度数などの規格が分かればそれも）」 | 質問リスト（自由記述） | 例: `GIANTSボトル 10年貯蔵古酒 720ml 25度` |
| ⑥ | 送料区分 | 必須 | 「送料の扱いを入数ごとに教えてください（送料別の入数は個別送料額も）」 | AskUserQuestion: `全入数 送料無料` / `全入数 送料別（金額を記入）` / `入数ごとに指定（内訳を記入）` | 例: `1本は送料1050円、3本・6本は送料無料` |
| ⑦ | 納期管理番号 | 必須 | 「納期管理番号（発送リードタイム）を選んでください」 | AskUserQuestion: `docs/spec.md` §8 納期管理番号マスタの番号＋意味を選択肢に列挙（例: `1 = 2〜4日以内で発送`） | 番号1つ（例: `1`） |
| ⑧ | 参考URL・画像・添付 | 任意 | **質問しない**。不足質問を送るとき文末に「参考URL・画像・添付があれば一次情報として優先採用するのでご提供ください（任意）」と一言添えるのみ | —（軽い確認に留める） | URL・ファイルパス（無回答でも進行可） |

### 実例: 売価と配送方法が欠けた入力 → 質問 → 回答のマージ

入力（②売価・③配送方法 が不足）:

```
作成する入数：1本、3本
JANコード：4955028002542
商品名 : GIANTSボトル 10年貯蔵古酒 720ml 25度
送料区分: 1本は送料1050円、3本は送料無料
納期管理番号:1
```

不足検出: 必須7項目のうち **②売価（税抜）と③配送方法の2項目だけが不足** → この2項目のみを1回で質問する
（①④⑤⑥⑦は充足済みなので聞き直さない。⑧は任意なので文末の一言のみ）。

実際の質問（1メッセージにまとめる）:

> 調査を始める前に、不足している2点を教えてください。
>
> 1. **売価（税抜）** — 入数ごとにお答えください（例: 1本=500円、3本=1300円）。
> 2. **配送方法** —（AskUserQuestion 選択肢）`宅急便` / `ネコポス` / `レターパック` / `入数ごとに指定（内訳を記入）`
>
> 参考URL・画像・添付があれば一次情報として優先採用するのでご提供ください（任意）。

回答例: 「1本500円、3本1300円。配送はどちらも宅急便で」

回答のマージ結果 — 回答を既提供分と合わせて正規化表を再構成し、再チェック。必須7項目すべて充足したので
**SKILL.md 手順3（調査）へ進む**（まだ欠けが残る場合は不足分のみをもう一度まとめて質問する）:

| 入数 | 売価(税抜) | 配送方法 | 送料区分 | 納期管理番号 | 値の由来 |
|---|---|---|---|---|---|
| 1本 | 500円 | 宅急便 | 送料別（個別送料1050円） | 1 | 売価・配送方法=回答 / 他=初回入力 |
| 3本 | 1,300円 | 宅急便 | 送料無料 | 1 | 同上 |
