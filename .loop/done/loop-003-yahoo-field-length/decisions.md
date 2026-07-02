# decisions.md — 設計判断と理由（loop-003 Yahoo フィールド文字数整形）

## DEC-301 ライブ3件テストで文字数ブロッカーを発見 → loop-003 新規初期化
loop-002 完了後、`node tests/e2e_migrate.mjs --commit` で r0101-1/r1101-1/r113-1 を実登録試行 → 3件とも it-01002(path)/it-01017(name)/it-01033(explanation) で editItem 失敗。dry-run は必須有無のみ検証で文字数を見ず migrate と誤判定。ユーザー選択(文字数整形を新eval-loop)に従い loop-002 をアーカイブし loop-003 を初期化。criteria/eval-schema は契約固定で再利用。

## DEC-302 整形は共有マッパー(YahooConverter/buildYahooEditItemParams)で行う
name/path/explanation 等は YahooConverter 生成で単品 register/yahoo と共有。整形を共有層に入れることで bulk・単品の両方に効く。既存 yahoo.test/register の挙動は短いフィールドで不変に保つ（後方互換）。

## DEC-303 全角カウント = 全角1・半角0.5
docs/Yahoo/02「全角75文字(半角150文字)」より。切詰は全角文字/サロゲートペアを割らない境界で行う。

## DEC-304 path は editItem 適合を優先（ストアカテゴリ設計の最適化は別途）
path はストアカテゴリパス（コロン区切り・各名 全角20・8階層）。本ループは「各セグメントを全角20・コロン区切り・8階層に整形」で editItem 拒否を解消する。yahoo_path(=Yahoo商品カテゴリ表示) を path に流用している点の意味整合（store category 設計）は深い論点で本ループ外。

## DEC-305 本セッションもライブ出品はしない（コード修正まで）
修正完了後の実地検証（e2e_migrate --commit 再実行）はループ外で別途。submitItem 非実行・新規 display=0 維持。

## DEC-306 turn-000 PASS(91) 後は機能追加せず再検証で収束。follow-up は次セッション
turn-000 で独立 evaluator が score 91(≥90) で PASS。AC-F01〜F06 充足（整形の実適用で it-01002/01017/01033 解消・既存無改変）。protocol C に従い turn-001 は機能変更せず再検証で2回目PASS→完了。evaluator の recommended_next_changes（AC外）は次セッション繰越:
- executor/migrate dry-run を end-to-end で driving する AC-F04 テスト追加。
- caption(HTML可) の tag-aware 切詰（タグ途中割れ防止）。
- 半角判定（accented Latin 等の全角扱い）のコメント明記/語境界切詰。
- validateEditItemParams violations の構造化 {field,reason}。
※ いずれも本ループ完了条件外（評価係の合格を司令塔が上書きしない）。
