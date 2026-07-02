# decisions.md — 設計判断と理由（loop-004 Yahoo name 整形）

## DEC-401 ライブ再テストで name 残存ブロッカー → loop-004 新規初期化
loop-003 完了後の `e2e_migrate --commit` で path(it-01002)/explanation(it-01033) は解消、**name(it-01017) のみ失敗**。診断: 楽天 display_name「本来商品名 `<br>` SEOキーワード群」の HTML 未除去＋カウント差で整形後も >75。loop-003 のテストは合成データ("あ"×100)で実データ形を見逃した。ユーザー選択(キーワード保持＋新loop)に従い loop-003 をアーカイブし loop-004 を初期化。

## DEC-402 name はキーワード保持（`<br>`→空白＋HTML除去＋安全マージン切詰）
ユーザー選択。Yahoo name は検索対象なのでキーワードを残す。`<br>` は空白に変換して区切り保持、他タグは除去。Yahoo の実カウント差を吸収するため自前カウントで安全マージンを引いた実効上限(<全角75)に整形。本来の商品名(先頭)は欠落させない。

## DEC-403 実データ風テストを必須化（合成データのみの見逃し再発防止）
loop-003 の見逃しを踏まえ、acceptance に「楽天風キーワード詰め込み name」の整形テストを必須化。Yahoo 実カウントの最終確認は完了後のライブ再テスト（ループ外）。

## DEC-404 本セッションもライブ出品はしない（コード修正まで）
修正後の `e2e_migrate --commit` 再実行はループ外。submitItem 非実行・新規 display=0 維持。

## DEC-405 turn-000/001 PASS(93→92) で loop-004 完了。ライブ③で name(it-01017) 実機解消を確認
2回連続 PASS(同一 hash 0d3ee29a)で完了。ライブ `e2e_migrate --commit` 第3回で **name(it-01017) は解消**（エラーが it-14091=追加画像紐づけ に変化）。path/explanation/name の文字数系ブロッカーは全て実機で解消した。
次ブロッカー(本ループ外): **it-14091** — executor の commit は 9b)editItem → 9c)syncImage の順で、画像を Yahoo lib にアップロードする前に editItem が追加画像を紐づけようとして失敗。修正案 = syncImage(画像 lib アップロード)を editItem の前に並べ替え。次セッション/別ループで対応。
