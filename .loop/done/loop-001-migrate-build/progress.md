# progress.md — eval-loop 進捗ログ

| turn | iteration | goal(要約) | score | hard_gates | passed | consecutive | 次の一手 |
|---|---|---|---|---|---|---|---|
| (構築) | - | harness 構築 + smoke ok(17/17) + ベースライン4ゲート緑 | - | baseline=PASS | - | - | turn-000 を実行 |
| turn-000 | 0 | 追加のみ pure lib層(parse/plan/defaults/result)+単体テスト29 | 82 | PASS(lint/tsc/unit168/build) | false | 0 | turn-001: API route + I/O統合(import再利用/カテゴリ解決/safe登録/画像) |
| turn-001 | 1 | executor(依存注入I/O統合)+route(/api/migrate/rakuten-to-yahoo, dry-run既定)+executor.test(12) | 83 | PASS(lint/tsc/unit180/build) | false | 0 | turn-002: ①dry-run summary修正(migrate加算) ②UIパネル(一覧) ③在庫0適用/明文化 ④route統合テスト(mock) ⑤レート制御 ⑥デッドコード除去 |
| turn-002 | 2 | ①集計修正 ②MigratePanel(一覧マウント) ③在庫=display:0明文化 ④route.test ⑤レート制御(delayMs/sleep) ⑥submit除去 | **92** | PASS(lint/tsc/unit189/build) | **true** | **1** | turn-003: 機能変更せず**再検証**(2回目の独立PASS取得→完了)。残課題(レート制御の実配線/forceDisplay非表示化)は live移行セッションへ繰越 |
| turn-003 | 3 | 再検証のみ(機能変更なし・同一 implementation_hash 28f26f71) | **91** | PASS(lint/tsc/unit189/build) | **true** | **2/2** | ✅ **COMPLETE**: check_goal_completion exit 0(全チェックOK)。status=completed/active=false |

## 完了
- **2回連続 PASS（92→91, 同一 implementation_hash・同一契約）** で `check_goal_completion` exit 0。機能構築＋安全検証スコープを充足。
- 繰越（live移行セッション・DEC-011）: レート制御の route 実配線 / forceDisplay非表示化の明記・オプション / ItemStatus 'skipped' の扱い / 大量リストのバッチ分割 / findExistingProduct の lib 抽出。

## メモ
- ベースライン(クリーン a90029f): lint=0 / tsc=0 / vitest 139 passed / next build=0。
- turn-000 は「追加のみの pure lib 層 + 単体テスト」を第一スライスにする（既存無改変で hard gate 緑を維持しつつ実装の核を入れる）。
