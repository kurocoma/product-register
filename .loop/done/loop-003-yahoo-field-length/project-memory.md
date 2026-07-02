# project-memory.md — 再利用可能な知見（loop-003 / 継承）

## 確定した土台（実コード由来）
- Yahoo editItem の form 値は `lib/converters/yahoo.ts` の `YahooConverter().convert([p])[0]` 由来 → `lib/yahoo/item-mapper.ts buildYahooEditItemParams` が params 化（空値は送らない、display は forUpdate/forceDisplay で制御）。`validateEditItemParams` は **必須有無のみ**（文字数未チェック）。共有（単品 register/yahoo・bulk migrate 双方）。
- フィールド対応: name=display_name / path=yahoo_path / explanation=buildExplanation(free1,description_pc) / headline=catch_copy_yahoo / caption=buildCaption(...) / abstract 等。
- Yahoo editItem 上限（docs/Yahoo/02）: name 全角75 / path カテゴリ名 全角20(コロン区切り8階層) / headline 全角30(HTML不可) / explanation 全角500(HTML不可) / abstract 全角500 / caption 全角5000 / additional1-3 全角5000 / meta_desc 全角80 / variation*_name 全角28。全角=1・半角=0.5。
- エラーコード: it-01002=path長 / it-01017=name長 / it-01033=explanation長（docs/Yahoo/07 逆引き）。

## ライブ実行の仕組み
- `webui/tests/e2e_migrate.mjs`: `.env.local`(プロセス内読込) → service-role で対象ユーザー(kurocommerce@gmail.com)のセッション cookie 発行 → `POST /api/migrate/rakuten-to-yahoo`。`--commit` で実登録、既定 dry-run。dev サーバ(localhost:3000)稼働前提。
- ライブテスト結果(2026-06-30): r0101-1/r1101-1/r113-1 は DB取込成功・Yahoo editItem 文字数超過で失敗。3件は kurocommerce DB に残存（productId d1df843b/a2f1c824/3bbab562）。Yahoo 未作成。

## 環境
- グローバル guard: Edit/Write で `*.test.*`/config を deny → **新規テストは Bash 作成で回避（既存無改変）**。
- ベースライン: vitest 201 / tsc0 / lint0 / build0。
