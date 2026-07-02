# decisions.md — 設計判断と理由

## DEC-001 作業リポジトリは dev\product-register（正本）
旧 `開発案件\商品登録アプリ作成` は de4e121 で停止したコピーで移行部品が無い。正本は最新(a90029f)・remote あり・全API部品あり。ユーザー確認済み。

## DEC-002 hook/スクリプトは Python 実装（spec の .sh から逸脱）
理由: Windows での bash 実行の不確実性回避。Python は既にプロジェクト依存(pyproject/pytest)。spec の機能要件(state だけで判定する Stop hook 等)は満たす。`snapshot_eval_loop.sh` は薄いラッパとして併存。
副作用対策: hook/スクリプトは起動時に stdout/stderr を UTF-8 化（cp932 で日本語出力時の UnicodeEncodeError を防止。smoke で実証）。

## DEC-003 settings.json は自動編集不可 → サイドカー方式
`.claude/settings.json` は報酬ハッキング防止ガード(グローバル規約)で deny。`.claude/eval-loop.hooks.json` に hooks ブロックを用意し、ユーザーが settings.json へマージ→`/hooks` で信頼する手順にした。

## DEC-004 hard gate はオフライン4種（lint/typecheck/unit/build）+ optional pytest
ライブAPI必須の e2e_*.mjs(23本)・実機 verify_* は OAuth/ESA 認証と本番リスティング生成を伴うため自動 hard gate から除外。dry-run/テスト商品で別途確認する。

## DEC-005 2回連続PASSは「同一 implementation_hash かつ同一契約」で計数
record_eval が判定。実装/契約が変わると streak リセット。1度 passed 後は機能変更せず再検証で2回目を取る。

## DEC-006 turn-000 は追加のみの pure lib 層を第一スライス
既存ルートの関数抽出は回帰リスクがあるため後続周回へ。turn-000 は新規 `webui/lib/migrate/*` + 単体テストに限定し、hard gate 緑を維持しつつ実装の核（リスト/CSVパース・per-item plan・集計・安全既定・カテゴリ/SKU判定）を入れる。

## DEC-008 snapshot は一時 index で作業ツリー全体を退避（未追跡含む）
`git stash create` は未追跡ファイルを含まず新規 `migrate/` を保存できなかった。`GIT_INDEX_FILE`=一時パス(空ファイルは壊れindex扱い→事前削除)に `git add -A`→`write-tree`→`commit-tree -p HEAD` で full-tree commit を作り隠し ref 化。本物の index/作業ツリーは無汚染（検証済: ref=full-tree, migrate 10ファイル含む, staged=0）。
注: この修正で `snapshot_eval_loop.py`(VALIDATOR_FILES) が変わり validator_hash が更新されるが、turn-000 時点 consecutive=0 のため影響なし（次周 record_eval が新 hash を採る）。

## DEC-007 実行係/採点係の本セッションでの代替
本セッションは旧フォルダ起点で正本の custom skill/agent が未ロードのため、turn-000 は
generator=Agent(general-purpose)・evaluator=Agent(Explore: read-only+Bash=評価係のツール構成と一致)で fork 実行して忠実に再現する。自走運転は dev\product-register で開き直して /run-dev-loop。

## DEC-009 しまのや商品リスト(CSV)受領 → docs/しまのや に保存・解析
ユーザーから「しまのや」全商品の楽天RMS dl-normal-item CSV（Shift-JIS, 238行）を受領。`docs/しまのや/dl-normal-item_20260629.csv`（バイト同一）＋ `README.md`（来歴・解析）として保存。
解析: RMS新SKU形式（1商品=ヘッダ行+SKU行×N）。**ユニーク商品103**（col0 商品管理番号）= **単一SKU 88（一括移行の主対象）+ 多SKU 15（要手動）**。これは移行機能の入力（管理番号リスト）兼 将来の統合テスト fixture になる。

## DEC-010 スコープ確定（ユーザー回答）→ task.md/acceptance は再スコープ不要
ユーザー追加依頼「商品編集の機能として追加したい」を受け3点確認。回答はすべて現行設計と一致:
- UI 統合先 = **一覧の一括移行パネル**（task.md 現設計どおり。"商品編集機能として"=商品管理機能への追加として解釈一致。※商品編集画面 products/[id] には既に単品 `RegisterPanel`(楽天/Yahoo) が存在）。
- 今回のゴール = **機能構築＋安全検証まで**（dry-run/テスト商品 display:0・在庫0。本番公開しない）。
- 多SKU 15件 = **安全スキップ→要手動**（単一SKU 88件を自動対象）。
→ 固定契約（task_hash/acceptance_hash 等）を変更せず継続。2回連続PASS判定の整合を維持。

## DEC-011 turn-002 PASS(92) 後は機能追加せず再検証で収束。残課題は live移行セッションへ繰越
turn-002 で独立 evaluator が score 92(≥90) で PASS 判定。protocol C に従い turn-003 は**機能変更せず再検証**して2回目の独立PASSを取り完了させる（評価係の合格判定を司令塔が上書き・gold-plating しない＝役割境界の遵守）。
evaluator が挙げた残課題は本セッションのスコープ（機能構築＋安全検証）外＝**ライブ全移行セッションで対応**とし繰越:
- **レート制御の実配線**: `result.ts runItems` に delayMs/sleep は実装・単体テスト済みだが、`route.ts` の runItems 呼び出しが delayMs を渡していない（過負荷防止が production で未発火）。しまのや88件の実バルク移行前に route 側で件数連動 delay を配線すること。
- **forceDisplay="0" の副作用**: commit 時、既存(forUpdate)の公開中 Yahoo 商品も display=0 へ落とす。本セッションの安全方針上は妥当だが、運用で既存公開商品を混ぜると意図せず非表示化。live移行時は「既存は display 変更しない」オプションを検討。
- route の commit 経路 e2e テスト追加、route 直下 helper(syncYahooImages/findExistingProduct) の lib 抽出。
※ いずれも acceptance の AC ではなく recommended_next_changes。本セッション完了条件には含めない。
