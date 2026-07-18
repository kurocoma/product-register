# 02. 機能台帳・分類・重複・不要コード（ステップ2・3 ／ 最終出力2・3・4）

事実は根拠パス付き。断定を避けるべき箇所は「推測 / 要追加確認」と明記。パスは `webui/` 相対（Python のみ repo ルート相対）。

## 2.1 機能台帳（ステップ2）

列: 機能名 / ユーザー目的 / 入口(UI/API) / 主な実装ファイル / 依存先 / 類似・重複 / 保守上の問題 / 推奨処置 / 根拠(確認状況)

| 機能 | ユーザー目的 | 入口 | 主な実装 | 依存先 | 類似・重複 | 保守上の問題 | 推奨処置 | 根拠 |
|---|---|---|---|---|---|---|---|---|
| ダッシュボード | 全体把握・アラート | `/` | `app/(main)/page.tsx` | Supabase(products/history) | — | 集計クエリが page 直書き | 現状維持(軽微) | 確認済 |
| 商品一覧・価格編集・反映 | 探す/直す/出す | `/products` | `ProductList.tsx`, `MallImportByCode.tsx`, `api/products/[id]/price` | repository, register, converters | 反映=編集/一括と重複 | 一覧に反映・取込・CSV導線が集中 | Core維持。反映ロジックは`lib/register`正本化 | 確認済 |
| 商品編集(新規/既存) | 1商品を作り込む | `/products/new`, `/products/[id]` | `ProductEditView.tsx`, `ProductForm.tsx`(1223行) | schema, autosave, 全パネル | — | フォーム巨大・責務混在 | Core維持。section分割(04) | 確認済 |
| 自動保存 | 保存忘れ防止 | 編集/一覧 | `hooks/useAutoSave.ts`, `lib/autosave/machine.ts` | — | — | 良設計(分離) | 維持・手本化 | 確認済 |
| モール登録/反映(楽天/Yahoo/Shopify) | 実ストアへ反映 | `RegisterPanel`, `api/register/*`, `api/update/[mall]/[id]` | `lib/register/*`, `lib/converters/*-api\|-patch`, `lib/rakuten\|yahoo\|shopify` | schema, converters | 単品↔一括で二重 | dry-run/commit状態が各所 | Merge(内部統合U4) | 確認済 |
| 価格のみ反映 | 素早い価格改定 | 一覧行, `api/products/[id]/price` | `api/products/[id]/price/route.ts` | register/converters | 登録/反映の一部 | 反映系の亜種 | 反映サービスに内包 | 確認済 |
| 画像アップロード | 画像を各モールへ | `ImageUploadPanel`, `api/upload/{rcabinet,yahoo,*-sync}` | `lib/image/*`, `lib/rakuten/cabinet-client`, `lib/yahoo/*-image-client` | image, mall clients | `/bulk-images`と二重 | 経路がモール別に散在 | Merge(内部統合U3) | 確認済 |
| モール現物取込 | 既存商品を取り込み編集 | `MallImportByCode`, `api/fetch/[mall]/[id]`, `api/import/[mall]` | `lib/converters/*-item-parser`, `mall-import.ts` | schema | fetch↔import・migrate と近い | fetch/import の役割境界が曖昧 | 重複調査D3で整理 | 確認済 |
| CSV出力(5形式ZIP) | CSV運用 | `/csv`, `CsvDownloadPanel`, `api/csv/{[mall]/[id],bulk}` | `lib/csv/writer`, `lib/converters/*` | converters | 単品↔一括で二重 | 単品/一括 route 2系統 | Merge(内部統合U1/U2) | 確認済 |
| プレビュー(楽天/Yahoo/Shopify) | 反映前の見た目確認 | 編集画面 `PreviewTabs` | `components/preview/*`, `lib/preview/sku-entries` | schema | — | — | Core維持 | 確認済 |
| 一括登録(グリッド) | 大量を一度に | `/bulk-register`, `BulkGridEditor`(725), `BulkRegisterPanel` | `lib/register/bulk-*`, `lib/product/grid-rows`(732), `bulk-save` | register, converters | 単品登録と目的重複 | グリッドが巨大・貼付ロジック複雑 | Advanced維持。ロジック共有(U4) | 確認済 |
| 画像一括アップロード | 画像を量産アップ | `/bulk-images`, `BulkImageUploader`(615) | `api/upload/bulk-image`, `lib/image` | mall clients | 単品版と二重 | 楽天現物読込も内包し肥大 | Merge(U3) | 確認済 |
| 楽天→Yahoo一括移行 | 横展開 | `/migrate`, `MigratePanel`(445) | `lib/migrate/*`, `api/migrate/rakuten-to-yahoo`(334) | converters, yahoo, mapping表 | register/取込と重なる | executor 432行・巨大 | Advanced維持。移行ユースケース正本 | 確認済 |
| 関連商品(セット)取込・多SKU | 単品+セットをSKU化 | `/related-import`, `RelatedImportSearch` | `lib/product/variants`, `yahoo-split`, schema `variants[]` | schema | migrate と一部重複 | フラット↔variants 後方互換 | Advanced維持 | 確認済 |
| マスタ取込(統合台帳) | NE/Excel統合 | `/masters`, `MasterImportPanel`, `api/masters/import/[source]` | `lib/ne-master/*`, `pg`直結 | Supabase | — | pg直結の別経路 | Supporting維持。`/masters/related`とタブ統合(U7) | 確認済 |
| 関連商品抽出 | 値上げ下調べ | `/masters/related`, `RelatedSearchPanel`, `api/masters/related` | `lib/ne-master/related` | ne-master | masters の一部 | 単独画面で低頻度 | masters にタブ統合(U7) | 確認済 |
| テンプレート管理 | ひな型再利用 | `/templates`, `TemplateList`, `TemplateSaveButton` | `lib/template/template-data`, `product_templates` | Supabase | — | — | Supporting維持 | 確認済 |
| 作業履歴 | 変更追跡 | `/history`, `HistoryView`(262) | `lib/history/{filter,recorder}`, `history`表 | Supabase | — | — | Supporting維持 | 確認済 |
| カテゴリ自動補完 | カテゴリ/属性を自動 | 編集/グリッド | `lib/product/category-assist`(291)/`category-autofill`/`category-mapping`, `rakuten_genre_attributes`, `rakuten_yahoo_category_mapping` | Supabase | **3ファイルに分散** | 命名近く責務不明確 | Merge(重複D1) | 確認済 |
| 定期購入(楽天/Yahoo) | 定期商品対応 | 編集 subscription節 | `schema.ts` subscription_*, `lib/yahoo/subscription` | schema | 楽天/Yahooで別意味 | schema 肥大の一因 | Supporting維持(別意味なので統合しない) | 確認済 |
| ルール監査 | 出品前点検 | `/rule-audit`, `api/rule-audit` | `lib/rule-audit/{detect,rule-audit-query}` | Supabase | codex-normalize と近縁 | **未コミット**・ヘルプ未掲載 | Advanced。codexと連結(U6) | 確認済(未コミット) |
| Codex正規化 | AIで規則違反を修正 | 編集 `MallEditPanel`→`CodexProposalDiff`, `api/products/[id]/codex-normalize` | `lib/rule-audit/codex-client`(550) | Codex CLI | rule-audit と近縁 | **未コミット**・外部CLI依存 | Advanced/実験。要確認 | 確認済(未コミット) |
| 商品リサーチ取込 | JAN等から自動リサーチ登録 | `api/products/research-import`(**UI非経由**) | `lib/product/research-import`(183) | Supabase, 外部skill | — | UI無・外部skill専用 | 外部連携として維持。**UI未接続を明記** | 確認済(外部skill起動) |
| 認証 | ログイン/権限 | `/login`, `app/auth/*`, `proxy.ts` | `lib/supabase/*`, `components/auth/*` | Supabase | — | proxy未コミット | 維持(01の注記) | 確認済 |
| 設定 | 店舗ID等の設定 | `/settings` | `settings/page.tsx`(**空**), `SettingsForm.tsx`(**未使用**), `settings`表 | Supabase | — | 画面未実装・部品孤児 | 実装 or 明示的に保留(2.5) | 確認済 |
| (旧)CSV CLI | Phase1のCSV生成 | CLI `product-register` | `src/product_register/**`(Python) | click/openpyxl | webui converters と二重 | 別言語・別実装が併存 | Deprecated候補(2.4/2.5) | 確認済(最終更新2026-05-17) |

## 2.2 機能分類（ステップ3）

| 分類 | 機能 |
|---|---|
| **Core**（日常の中核・維持） | 商品一覧/価格編集/反映、商品編集、自動保存、モール登録/反映、CSV出力、プレビュー、現物取込 |
| **Supporting**（補助・維持） | ダッシュボード、作業履歴、テンプレート管理、マスタ取込、カテゴリ自動補完、定期購入、認証 |
| **Advanced**（高度・低頻度、維持） | 一括登録、画像一括アップロード、楽天→Yahoo一括移行、関連商品(セット)取込・多SKU、関連商品抽出、ルール監査、Codex正規化 |
| **Merge**（内部ロジック統合対象。UIは残す） | 画像アップロード(単品↔一括)、モール登録/反映(単品↔一括)、CSV(単品↔一括)、カテゴリ支援3ファイル、fetch↔import、rule-audit↔codex |
| **Deprecated候補**（要確認後に廃止/隔離） | 旧Python CLI `src/product_register/`、孤児 `components/settings/SettingsForm.tsx` |
| **Unknown / 要追加確認** | Codex正規化・research-import の運用位置づけ（実験か本番か）、`/settings` の実装予定、`proxy.ts` の有効性 |

## 2.3 統合候補（最終出力3）

内部ロジックを正本1つへ寄せ、UI（単品/一括の見た目）は維持する。詳細手順は「2.6 重複実装調査」。

1. **反映/登録**: `lib/register/` を正本に、`RegisterPanel`・`/bulk-register`・一覧行反映・`price` route が共通サービスを呼ぶ。
2. **画像アップロード**: 共通アップロード層（`lib/image` ＋ 各モール client）を正本に、`ImageUploadPanel`・`/bulk-images` が再利用。
3. **CSV**: `lib/csv` ＋ `lib/converters` を正本に、単品(`api/csv/[mall]/[id]`)＝1件の一括として扱い実装共有。
4. **カテゴリ支援**: `category-assist`/`category-autofill`/`category-mapping` を1モジュール（`lib/product/category/`）へ集約（正本判定は2.6-D1）。
5. **rule-audit ↔ codex-normalize**: 検出→修正の1フロー化（`lib/rule-audit/` 内で責務分離のまま連結。統合しすぎない）。
6. **masters ↔ masters/related**: 同一台帳操作を1画面タブへ（03-U7）。

## 2.4 廃止候補（最終出力4）

| 候補 | 状態 | 根拠 | 処置 |
|---|---|---|---|
| 旧 Python CLI `src/product_register/**`, `tools/`, ルート`tests/*.py`, `config/`, `validation/` | Phase1 実装。最終更新 2026-05-17（`git log`）。webui が Phase2 で同ロジック再実装 | `pyproject.toml`, `docs/spec.md`§2, 変換ファイルの1:1対応 | **要追加確認**（バッチ/検証で現用か）。使用が無ければ `legacy/` 隔離→段階廃止。**即削除しない** |
| `components/settings/SettingsForm.tsx` | import 元 0（`grep` 実測）。`/settings` は空実装 | importer 検索で参照なし | 追加確認後に削除 or `/settings` 実装で復活 |
| ルート散在生成物（`eval-loop-report.html` `loop-progress.html` `question-dashboard.html` `outputs/` `.tmp/`） | ハーネス生成物・アプリ外 | git 未追跡 | アプリ対象外。`.gitignore`整理は任意 |
| `docs/` の巨大バイナリ（64MB/3.9MB CSV, PNG, zip） | 参照データ・モック | サイズ実測 | 対象外。LFS/別管理は任意 |

> **注意**: 上記いずれも「機能削除」ではない。Python CLI は互換確認（呼び出し元 grep・運用ヒアリング）を経てから隔離する。

## 2.5 機能分類の補足（保留・判断待ち）

- **`/settings`**: DB `settings` テーブル・`SettingsForm.tsx` は存在するが画面は「Plan 5 で実装予定」。→ 実装するか、ナビから外して「準備中」を明示するか **要判断**（機能自体は削除しない）。
- **Codex系（rule-audit / codex-normalize / research-import）**: いずれも直近追加・一部未コミット。**本番運用の位置づけが不明**（実験的か常用か）→ 要ヒアリング。research-import は外部skill専用でUI未接続（削除不可）。

## 2.6 重複実装調査（補助）

列: 候補 / 実装箇所 / 類似点 / 相違点 / 正規実装候補 / 統合リスク / 推奨手順

| 候補 | 実装箇所 | 類似点 | 相違点 | 正規実装候補 | 統合リスク | 推奨手順 |
|---|---|---|---|---|---|---|
| D1 カテゴリ支援 | `lib/product/category-assist.ts`(291) / `category-autofill.ts` / `category-mapping.ts` | いずれもカテゴリID→属性/Yahooカテゴリ補完 | assist=グリッド一括ロード、autofill=属性マージ、mapping=対応表fetch。**役割は分業** | 3つを `lib/product/category/` に集約し barrel 公開（機能は分けたまま） | 中（グリッド/編集の双方が使用） | 呼び出し元 grep→characterizationテスト→フォルダ集約→barrel 差替 |
| D2 単品↔一括（画像/登録/CSV） | `ImageUploadPanel`↔`/bulk-images`、`RegisterPanel`↔`/bulk-register`、`CsvDownloadPanel`↔`/csv` | 同一ドメイン操作(反映/画像/CSV) | 対象件数とUIが違うだけ | `lib/register` / `lib/image` / `lib/csv` を各正本にしUIが呼ぶ | 中〜高（状態管理・dry-run） | ロジックをlibへ抽出→単品UIから先に差替→一括UI→UI重複除去 |
| D3 取込 fetch↔import | `api/fetch/[mall]/[id]` ↔ `api/import/[mall]`、`lib/converters/*-item-parser`, `mall-import.ts` | モール現物→ProductInput 変換 | fetch=ID指定1件取得、import=コード指定取込。**要精査** | `lib/converters/mall-import` を正本にパーサ共通化 | 中（外部API仕様差） | 両route の入出力を突き合わせ→共通パーサ→route は薄いラッパへ（**要追加確認**: 実挙動差） |
| D4 rule-audit↔codex-normalize | `lib/rule-audit/detect.ts` ↔ `codex-client.ts`(550) | 「商品ルール」ドメイン | detect=規則違反検出(静的)、codex=AI修正提案 | 同フォルダ維持・責務分離のまま連結 | 低（別責務） | **統合しない**。UI導線のみ連結(U6) |
| D5 税計算 | `lib/converters/rakuten-tax.ts`, `lib/yahoo/yahoo-tax.ts`(=`lib/converters/yahoo-tax.ts`), 商品レベル税(`schema`) | 税率変換 | モールで規則が違う（楽天0.1変換 / Yahoo税込 / product-level） | **統合しない**（業務的に別） | 高（誤統合で価格事故） | モール別に留置。共通は「税抜→税込」等の無害関数のみ shared 候補 |
| D6 Python↔webui 変換 | `src/product_register/converters/{rakuten,yahoo,ne,shopify}.py` ↔ `webui/lib/converters/{...}.ts` | 同じCSV変換仕様 | 言語・実行環境・Phase が違う | **webui を正本**（Phase2 現行） | 中 | Python は 2.4 の廃止候補として隔離。webui へ一元化 |
| D7 item-parser系の命名 | `rakuten-item-parser.ts` / `yahoo-item-parser.ts` / `shopify-item-parser.ts` | 各モール現物→ProductInput | モール別ロジック（正当な差） | 共通4動詞 `parse()` へ改名しmall配下(04) | 低 | re-export で両名維持→順次改名 |

> 原則: **類似だけで即共通化しない**。D5(税)・D4(監査/AI) は業務的に別概念のため統合対象外。呼び出し元・外部参照を確認し、正本を1つ決め、旧実装は互換アダプタ経由で段階廃止する。

## 2.7 不要コード候補調査（補助・4分類）

動的import・文字列参照・外部API/CLI/バッチ/設定経由・テスト専用・保存データ後方互換を考慮し、根拠不十分なものは「未使用」と断定しない。

### (A) 安全に削除できる可能性が高い
- **該当なし（断定できるものなし）**。webui 内で完全に孤立し外部参照も無いファイルは、確認範囲では `SettingsForm.tsx` のみだが、これは実装予定機能の部品のため (B) に回す。ルート散在HTML/`outputs/`はアプリ外生成物で「アプリのコード」ではない。

### (B) 追加確認後に削除可能
- `components/settings/SettingsForm.tsx` — importer 0（実測）。ただし `/settings`(Plan 5) 実装で使う想定の可能性 → **実装予定の有無を確認**してから。
- 旧 Python CLI 一式（`src/product_register/`, `tools/excel_to_csv.py`, `config/`, `validation/`, ルート`tests/*.py`）— webui へ移行済みだが **バッチ/検証運用が無いこと**を確認後に隔離/削除。
- `webui/middleware.ts`（git上 D）— `proxy.ts` へ改称済み。**`proxy.ts` が実機で有効**を確認後、旧 `middleware.ts` は完全削除（コミット）してよい。

### (C) 削除しないほうがよい（誤削除リスク）
- `api/products/research-import/route.ts`・`lib/product/research-import.ts` — UI 非経由だが **外部skill `.agents/skills/product-research-autofill/` が叩く**（確認済）。文字列参照の典型。**削除禁止**。
- `schema.ts` の旧固定枠（`attribute_*_1..5`）・フラット単一SKU・`display_price`/`image_url`等の optional 後方互換 — 既存 `products.extra` レコードの読取互換。`resolveAttributes`/`productVariants` のフォールボック。**保存データ互換のため残す**。
- 参照マスタ投入 `scripts/*.mjs` — 手動運用のバッチ。UIから呼ばれないが必要。
- `lib/converters/*-tax.ts` 各モール税 — 誤統合が価格事故に直結。維持。

### (D) 削除前テスト（消す前に固定すべき挙動）
- Python CLI 隔離前: 現行の webui CSV 出力が Phase1 と同等であることを、既存 verify スクリプト（`tests/verify_*.mjs`）＋ Phase1 の63商品照合（`docs/spec.md`§9）で確認。
- `middleware.ts` 完全削除前: 未ログインリダイレクト・`/login`→`/` を E2E で確認（`proxy.ts` 経由で成立すること）。
- `SettingsForm.tsx` 削除前: `/settings` を今後実装しない意思決定を記録（削除=機能放棄の明示）。
- カテゴリ支援統合(D1)前: グリッド一括ロード・編集画面の属性自動補完の入出力を characterization テストで固定。

### 未確認事項（要追加確認）
- 旧 Python CLI の現用有無（定常バッチ・手作業）。
- `codex-normalize` / `research-import` の本番運用ステータス。
- `api/fetch` と `api/import` の実挙動差（D3 の統合可否判断に必要）。
- `proxy.ts` が Next16 デプロイで有効化されているか。
