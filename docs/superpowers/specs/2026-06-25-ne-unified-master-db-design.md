# 統合商品マスタDB（Phase 1）設計書

作成日: 2026-06-25
対象リポジトリ: `dev/product-register/webui`（Next.js 16 + Supabase）

## 1. 背景・目的

特定の単品が値上げになったとき、その単品を含む**セット商品**も同時に値上げする必要がある。
そのために「ある単品に関連する全商品コード（含むセット＋紐づけ）を一覧でダウンロードする機能」（Phase 2）を作る。

その土台として、現状バラバラな商品データ（NEの3マスタ＋Excel商品管理シートの各シート）を、
**`ne_code`（NEコード＝商品コード）をスパインに統合した参照用DB**を作る（本設計書＝Phase 1）。

Phase 1 が提供できれば、JAN入力解決・モール別コード出力・紐づけ漏れ検知がすべて解ける。
将来は「NE/Excel からのマスタ自動ダウンロードツール」が、本Phaseの取込口（CSV取込）をそのまま叩く。

### スコープ
- **本設計書(Phase 1)**: 統合マスタの3テーブル定義＋CSV取込＋リンク解決＋取込結果レポート。UIは「マスタ取込」管理ページ（アップロード＋件数表示）まで。
- **対象外(Phase 2で扱う)**: 関連商品の抽出・検索・CSVダウンロード・紐づけ漏れUI。本Phaseはそのための**データ基盤のみ**。

## 2. データソースと正本

| データ | ファイル/シート | 件数 | 本DBで使う情報（正本） |
|---|---|---:|---|
| NE 商品マスタ | `syohin_basic*.csv` | 773 | 単品の **売価(baika_tnk)**・税率・在庫 |
| NE セット商品マスタ | `set_syohin*.csv` | 9,902セット/99,855行 | **セット構成(set↔component↔数量)**・セット**売価(set_baika_tnk)**・税率 |
| NE 紐づけ表 | `himoduke*.csv` | 1,193 | **在庫連携フラグ(する/しない, 全件)・代表商品コード(37件)**。※モール列は楽天=全空/Yahoo118・Amazon81はJAN様の値で**管理番号ではない**→モールコード源には使わない |
| Excel 商品マスタ | `商品管理シート.xlsm[商品マスタ]` | 816 | **JANコード**(NEコードで結合)・仕入価・カテゴリ・仕入先 |
| Excel 終売品マスタ | `[終売品マスタ]` | 380 | **終売フラグ**(is_discontinued) |
| Excel 商品コード一覧楽天 | `[商品コード一覧楽天]` | 3,043 | **楽天 商品管理番号**(商品番号=ne_code で結合, セットも網羅) |
| Excel 商品コード一覧Yahoo | `[商品コード一覧Yahoo]` | 1,037 | Yahoo 管理番号(JAN/数量で結合) |
| Excel 商品コード一覧amazon | `[商品コード一覧amazon]` | 499 | Amazon 管理番号(JANで結合) |
| Excel しまのや商品コード一覧 | `[しまのや商品コード一覧]` | 235 | しまのやコード(商品コード=ne_code) |

**正本の割り当て（合意済み）**:
- JAN = Excel商品マスタ（NE商品マスタにJAN列なし）
- 売価(selling) = NEマスタ（単品=baika_tnk / セット=set_baika_tnk）。※Excelの「仕入れ価格」は**原価**であり売価ではない
- モール別コード = **Excelモール一覧（正本・セットも網羅）**。himodukeはモールコード源に**使わない**（楽天列は全空、Yahoo/Amazonは管理番号でなくJAN様）
- 在庫連携(する/しない)・代表商品コード = himoduke（商品属性として `ne_item_master` に保持）
- セット構成 = NEセットマスタ

**取込形式**: すべて**CSV**で取込む。NE3マスタは既にCSV。Excelシートは「xlsx→CSV変換ヘルパ（openpyxlスクリプト）」または将来の自動DLツールがCSV化する。Node側に xlsx パーサ依存を持ち込まない。

## 3. データモデル（3テーブル + RLS）

すべて `user_id` を持ち RLS で本人のみ（既存 products と同パターン）。`ne_code` をスパインにする。

### 3.1 `ne_item_master`（単品＋セットの全商品の基本属性）
| 列 | 型 | 由来 |
|---|---|---|
| user_id | uuid (FK auth.users) | - |
| ne_code | text | NEコード（=商品コード/syohin_code/商品番号）。スパイン |
| jan_code | text default '' | Excel商品マスタ |
| name | text default '' | NE/Excel（NE優先、無ければExcel） |
| selling_price | integer null | NE商品マスタ(単品) / NEセットマスタ(セット) |
| tax_rate | integer null | NE |
| cost_price | integer null | Excel商品マスタ(仕入れ価格) |
| category | text default '' | Excel商品マスタ |
| supplier | text default '' | Excel商品マスタ(仕入先) |
| is_set | boolean default false | NEセットマスタに set_syohin_code として存在するか |
| is_discontinued | boolean default false | Excel終売品マスタに存在するか |
| zaiko_renkei | text default '' | himoduke 在庫連携（する/しない） |
| daihyo_code | text default '' | himoduke 代表商品コード（37件のみ。Phase2の兄弟解決用） |
| sources | text[] default '{}' | 由来（ne_single/ne_set/excel_master/excel_discon/himoduke 等。デバッグ・カバレッジ用） |
| updated_at | timestamptz default now() | - |

PK: `(user_id, ne_code)`。

### 3.2 `ne_set_composition`（セット構成。逆引きの中核）
| 列 | 型 | 由来(NEセットマスタ) |
|---|---|---|
| user_id | uuid | - |
| set_ne_code | text | set_syohin_code |
| component_ne_code | text | syohin_code（構成単品） |
| suryo | integer default 1 | suryo |
| set_name | text default '' | set_syohin_name |
| set_price | integer null | set_baika_tnk |
| tax_rate | integer null | tax_rate |

PK: `(user_id, set_ne_code, component_ne_code)`。
**index**: `(user_id, component_ne_code)` … 「単品→含むセット」逆引き高速化（Phase 2の本命クエリ）。
同一(set,component)が複数行（数量分割）で来た場合は suryo を合算してupsert。

### 3.3 `ne_mall_code`（モール別コード。正本=Excelモール一覧のみ）
| 列 | 型 | 由来 |
|---|---|---|
| user_id | uuid | - |
| ne_code | text | 紐づく商品コード |
| mall | text | rakuten/yahoo/amazon/shimanoya |
| manage_no | text default '' | 商品管理番号(URL)＝モール側の商品キー |
| jan_code | text default '' | - |

PK: `(user_id, ne_code, mall)`。index: `(user_id, ne_code)`。
※在庫連携・代表商品コードは商品属性として `ne_item_master` 側に持つ（himoduke由来）。本テーブルはExcelモール一覧のみを源とする。

## 4. 取込フロー

### 4.1 UI（マスタ取込 管理ページ）
- `/(main)/masters` 等に「マスタ取込」ページ。ソースごとにファイル選択→アップロード。
- 各取込の結果（取込件数・スキップ件数・未マッチ件数）を表示。
- 取込は**ソース単位で独立**（NE商品マスタだけ更新、等が可能）。

### 4.2 取込API（ソース別 POST、CSVをFormDataで受ける）
- `POST /api/masters/import/ne-syohin` … `ne_item_master` の単品行を upsert（売価/税率/在庫）
- `POST /api/masters/import/ne-set` … `ne_set_composition` を再構築＋`ne_item_master`にセット行を upsert（is_set=true, 売価=set_baika_tnk）
- `POST /api/masters/import/ne-himoduke` … `ne_item_master` の `zaiko_renkei`(在庫連携) と `daihyo_code`(代表商品コード) をマージ更新（モールコードは扱わない）
- `POST /api/masters/import/excel-master` … `ne_item_master` に JAN/原価/カテゴリ/仕入先を**マージ更新**（ne_codeで結合）
- `POST /api/masters/import/excel-discon` … is_discontinued=true をマージ
- `POST /api/masters/import/excel-mall?mall=rakuten|yahoo|amazon|shimanoya` … `ne_mall_code` に管理番号を upsert

runtime=nodejs。各APIは `{ ok, inserted, updated, skipped, unmatched, messages[] }` を返す。

### 4.3 冪等性
- ソース単位で「該当user_id分を洗替え or upsert」。NEセットは set_ne_code 単位で削除→再投入（構成変更に追従）。
- ne_item_master は**マージ**（複数ソースが別々の列を埋めるため、列単位で更新。例: excel-master取込はjan/原価/カテゴリのみ更新し、売価は触らない）。

### 4.4 パース・正規化
- 共通CSVパーサ（クォート有無・CP932/UTF-8・BOM・空行に耐性）。
- **NEセットマスタは未クォート（130+列）で商品名(col3)にカンマが入りうる**ため、汎用CSV分割に頼らず**列位置＋フィールド数許容**でパースする：先頭の `set_syohin_code`(col1)・`daihyo_syohin_code`(col2) は名より前で安全、`set_baika_tnk`(col4)以降は末尾からの相対位置で取得。さらに `set_syohin_code`(col1)/`syohin_code`(col6) がコード書式（`/^[A-Za-z0-9_-]+$/`）に合致するか検証し、外れる行はスキップしてカウント報告。（商品マスタ・himodukeはクォート済みで安全。）
- 文字コード：取込時に UTF-8 へ正規化（CP932入力を許容）。
- 全角コード/前後空白の trim。

## 5. リンク解決ルール（ne_code スパイン）

- **単品/セットの存在**: NE商品マスタ→単品行、NEセットマスタの distinct set_syohin_code→セット行。
- **JAN・原価・カテゴリ・仕入先**: Excel商品マスタを ne_code(=NEコード) で結合してマージ。**NEコードが空/備品フラグ行は除外**（Excel商品マスタの備品はNEコード空・JAN列に仕入先コードが入るため）。
- **楽天 管理番号**: Excel商品コード一覧楽天の `商品番号(=ne_code)` で結合 → `manage_no`。セットも網羅。
- **Yahoo/Amazon 管理番号**: Excel各一覧。ne_code列が無いため (a) 管理番号がne_codeに一致すればそれ、(b) JAN＋数量で ne_item_master/楽天一覧と突合、の順で best-effort 解決。解決不可は `unmatched` として件数報告（Phase 2の紐づけ漏れ材料）。
- **しまのや**: Excelしまのや一覧の商品コード=ne_code。
- **在庫連携・代表商品コード**: himoduke から `ne_item_master`（該当ne_code行）の `zaiko_renkei`/`daihyo_code` に付与（モールコードではない）。

## 6. データ品質・エッジ

- Excel商品マスタの**備品**（NEコード空・JANに非JAN文字）→ 取込対象外（skippedにカウント）。
- 終売品：is_discontinued=true。Phase 2で関連抽出時に「終売」表示。
- 重複JAN：同一JANが複数ne_code（1本/3本等）に存在するのは正常。JAN→ne_code解決は**1対多**になりうるため、Yahoo/Amazonの JAN結合は「数量一致」を併用し、曖昧なものは unmatched 扱い。
- セット構成の同一(set,component)重複行 → suryo合算。
- 取込順序の独立性：どの順でも壊れない（ne_item_master はマージ、mall_code/composition は own-key upsert）。
- **テーブル間にFKは張らない**（取込順非依存のため）。`ne_mall_code`/`ne_set_composition` が `ne_item_master` に未登録の `ne_code` を参照することは**正常**（例: Excel楽天一覧にあるがNEマスタ未登録のセット）。これはPhase 2で「カバレッジ欠落／紐づけ漏れ」として可視化する。

## 7. エラー処理

- 未ログイン401／不正mall値400／CSV不正（ヘッダ不一致）422＋期待ヘッダ提示／大容量上限（セットは8MB級）超過413。
- 取込失敗時も**部分成功件数**を返す（どこまで入ったか分かる）。

## 8. テスト方針

- **ユニット**（API不要・固定CSV断片）:
  - 各パーサ：列ズレ耐性（NEセットの未クォート＋名カンマ）、CP932、件数。
  - リンク解決：ne_code結合、備品除外、楽天 商品番号→管理番号、JAN1対多のYahoo解決(数量併用)、suryo合算。
  - 既知データの固定検証：`a008-4032-1`→含むセット5件（a008-4032-3/-6-out/-8/-11-out/-12）、楽天管理番号 `aogiri-sh2`(a008-4032-3) 等。
- **取込E2E**（dev server + magic-link、テストuser）: 小さな3+Excel代替CSVを取込→3テーブルの件数・代表行を検証→後始末（user_id分削除）。
- 既存の検証ハーネス（tests/*.mjs, magic-link）に倣う。zzz-接頭辞・後始末必須。

## 9. 非機能

- **RLS**: 全テーブル user_id 一致のみ（既存migrations/rls_policiesに追加）。
- **パフォーマンス**: ne_set_composition `(user_id, component_ne_code)` index で逆引きO(log n)。99,855行でも問題なし。
- **マイグレーション**: `webui/supabase/migrations/` に新規SQL（3テーブル＋index＋RLS）。
- **将来の自動DL**: 取込APIはCSV受けなので、NE/Excel自動DLツールが同じエンドポイントへPOSTするだけで連携可能（本Phaseでツール自体は作らない）。
- **Excel→CSV変換**: 一時的に openpyxl スクリプト（`tools/excel_to_csv.py`）で対象シートをCSV化。将来は自動DLツールに内包。

## 10. Phase 2 概要（本設計の利用側・参考）

- 入力：値上げ対象の単品コード/JANを複数貼り付け。
- 処理：JAN→ne_code解決→`ne_set_composition`逆引きで含むセット＋himoduke代表兄弟→`ne_mall_code`でモールコード付与→重複排除。
- 出力：関連商品コード一覧CSV（元単品・関連コード・種別・数量・現売価・税率・モール別コード・**紐づけ漏れフラグ**）。
- 別途設計書を起こす。

## 11. 未解決事項・リスク

1. **Yahoo/Amazon の ne_code 解決**：両一覧にne_code列が無く、JAN1対多のため曖昧。管理番号=ne_code一致→JAN＋数量突合の順で解決し、残る未解決は unmatched 報告で運用補正（Phase 2の紐づけ漏れと統合）。himodukeのYahoo/Amazon列はJAN様で管理番号でないため使わない。
2. **Excelの取込運用**：当面は手動でシートをCSV化。自動DLツール完成で解消。
3. **売価の鮮度**：NEマスタの売価が最新か（モール実価格との差異）は本Phase対象外。Phase 2/価格改定で別途突合余地。
4. **マルチ店舗前提**：現状単一店舗運用。user_id分離で将来マルチ対応可。
