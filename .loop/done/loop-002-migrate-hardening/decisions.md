# decisions.md — 設計判断と理由（loop-002 本番ハードニング）

## DEC-201 loop-001 をアーカイブし loop-002 を新規初期化
ユーザー選択 (A)「繰越1〜3を新しい eval-loop で対応」。loop-001 は completed(score92→91/2連続PASS)。完了判定が旧 passing reports に惑わされないよう `.loop/current` を `.loop/done/loop-001-migrate-build` へ退避し、ハードニング用の新契約(task/acceptance)で `.loop/current` を作り直した。criteria(6軸)/eval-schema は契約固定のため再利用。

## DEC-202 本セッションもライブ出品はしない（堅牢化まで）
実バルク移行(ライブAPI書込・公開)の準備が目的。submitItem 非実行・dry-run 既定・新規 display=0 を維持。実出品は本ループ完了後にユーザー明示操作で別途。

## DEC-203 既存公開商品の display は「保持」を既定にする（AC-H02）
loop-001 の forceDisplay='0' は新規には安全だが、既存(forUpdate)の公開中商品まで非表示化する副作用。バルク移行で公開中商品を不用意に落とさないため、既存は display 保持を既定、新規のみ display=0。これは既存単品 register/yahoo の挙動(常に'0')とは意図的に分岐する（バルクは公開中資産を守る方を優先）。

## DEC-204 findExistingProduct の共有 lib 抽出は任意（必須ACにしない）
import route を触る回帰リスクが高く、loop-001 evaluator も optional 評価。AC-H04 等の必須要件には含めず、安全に行える場合のみ。

## DEC-205 turn-000 PASS(92) 後は機能追加せず再検証で収束。深掘りは次セッション繰越
turn-000 で独立 evaluator が score 92(≥90) で PASS。AC-H01〜H06 充足。protocol C に従い turn-001 は機能変更せず再検証で2回目PASS→完了。evaluator の recommended_next_changes（AC ではない）は本ループのハードニング範囲を超える**より深いアーキテクチャ課題**＝次セッション繰越:
- 大量入力のチャンク/バッチ化＋再開可能進捗（cap200は緩和のみ。200×300ms≈60s で timeout/部分commit リスク）。
- commit の冪等性/チェックポイント（途中失敗の安全再試行）。
- item 内 getItem フォールバック連鎖のレート制御。
- MigratePanel への delayMs/preserveExistingDisplay 露出。
- bulk(既存保持) vs 単品 register/yahoo(更新時'0') の display 既定差異の明文化。
※ いずれも acceptance の AC-H ではなく、本ループ完了条件に含めない（評価係の合格を司令塔が上書きしない＝役割境界）。
