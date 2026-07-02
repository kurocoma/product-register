# decisions.md — 設計判断と理由（loop-005 Bundle A+B）

## DEC-501 監査で残12件→ユーザー選択「Bundle A+B をまとめて」→ loop-005
ライブ commit③で name 解消・it-14091 が現アクティブブロッカー。一括監査(Workflow 5エージェント, docs/しまのや/migrate-audit-2026-06-30.md)で残12件を4束化。ユーザー選択により loop-004 をアーカイブし Bundle A(it-14091 本解消)＋Bundle B(値域ゲート)を loop-005 で実装。

## DEC-502 it-14091 は順序入替"だけ"では不十分→A1〜A5 を一括
監査一致: reorder(A1)に加え、画像ハード前提化＋warnings 可視化(A2)、lib 基底URL の sellerId 動的化(A3)、レート/伝播リトライ(A4)、誤順序を固定する executor.test の是正(A5)を同時に手当てしないとライブ再発・無検知。A3 により **SELLER_ID 値の手動確認は不要**（upload 先と参照先が必ず一致）。

## DEC-503 executor.test.ts の順序期待値是正(A5)は報酬ハッキングでない
executor.test.ts:131-138 は editYahoo→syncImage の誤順序(=it-14091 を生む)を spec として固定していた。実装是正に伴い期待値を syncImage→editYahoo の正しい順へ修正する。これは「合格のためのテスト緩和」ではなく「誤った spec の是正」。Bash で編集（guard 回避はユーザー既承認の新規/是正用途）。evaluator が新順序の正当性を判定。

## DEC-504 Bundle B は dry-run 値域ゲート（103件スケール対策）
price/item_code/product_category の値域を validateEditItemParams で検証し、ライブ途中の editItem 失敗(it-01023/01004/01089系)を dry-run の requires_manual へ前倒し。現3商品は非該当だが103件で顕在化。

## DEC-505 Bundle C/D は本ループ外（次セッション）
C(path/postage/lead_time の店舗設定マッピング)・D(brand_code/forUpdate)は本ループ外。spec1-10 未送はブロッカーでない(監査確認済)。

## DEC-506 loop-005 完了(91→91)＋ライブ commit④で 3/3 登録成功＝it-14091 実機解消
2回連続 PASS で完了。ライブ `e2e_migrate --commit` 第4回で r0101-1/r1101-1/r113-1 が **Yahoo display=0(非公開)で登録成功（3/3 ok, step=image）**。全ライブブロッカー(it-01002 path/it-01033 explanation/it-01017 name/it-14091 画像)を踏破。取込→カテゴリ→登録→画像同期の全パイプライン疎通確認。
残課題(本ループ外・品質 follow-up): r0101-1 に editItem **警告** it-00002(caption タグ閉じ)/it-00004(sp_additional タグ閉じ)＝登録成功・警告のみ。description系 HTML の安全切詰(タグ途中割れ防止/タグ閉じ補完)が次の品質改善。監査 Bundle C(path/postage/lead_time)・D(brand/forUpdate) も次セッション。
