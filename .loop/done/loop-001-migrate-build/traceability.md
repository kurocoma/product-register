# traceability.md — 要件↔変更↔検証 逆引き

| 要件 | 小目標 | 変更箇所 | 検証方法 | 実行結果 | 証拠 | 判断 |
|---|---|---|---|---|---|---|
| REQ-001 楽天→Yahoo一括移行(管理番号駆動) | turn-001: API route + I/O統合 | webui/lib/migrate/*, webui/app/api/migrate/rakuten-to-yahoo/route.ts | webui_unit+evaluator | route実装・180tests緑・build登録 | turns/turn-001-* | 機能成立(UI/精緻化は継続) |
| AC-001 per-item結果+summary | route+型 | route.ts, migrate result/plan/types | unit + evaluator | ○ 形一致(manageNumber/productId/step/ok/status/error+summary+invalid) | turn-001-eval evidence | 満たす |
| AC-002 安全既定(display:0/在庫0) | 安全既定 | executor.ts defaults | unit | △ display:0は○(forceDisplay="0")／**在庫0は未適用**(safe.stock dead) | turn-001-eval | 部分(turn-002で在庫0) |
| AC-003 失敗継続 | runItems | result.ts, executor | unit | ○ 1件throwで継続・summary.failed計上・順序保持 | executor.test:267-285 | 満たす |
| AC-004 カテゴリnull安全化 | 判定 | executor+plan | unit | ○ null→requires_manual,登録系未呼出 | executor.test:169-179 | 満たす |
| AC-005 dry-run非書込 | ルート分岐 | route.ts, executor | unit/evaluator | ○ dry-runでトークン取得もupsert/editItemもしない | route.ts:80-94, executor.ts:153-155 | 満たす |
| AC-006 後方互換 | 既存無破壊 | (既存無改変) | webui_unit緑+git diff | ○ tracked変更0・既存139+新規=180緑 | turn-001-hard-gates, git status | 満たす |
| AC-007 ne_code重複排除 | import同等照合 | route findExistingProduct | unit/evaluator | ○ existed→upsert回避・既存id採用 | executor.test:210-222 | 満たす |
| AC-008 多SKU/高度設定スキップ | 検出 | executor+plan | unit | ○ variants>1/grouping→requires_manual | executor.test:181-207 | 満たす |
| AC-009 純粋ロジック単体テスト | テスト追加 | lib/migrate/*.test.ts | webui_unit | ○ 180緑(executor 12含む)／**route統合テスト無し** | turn-001-hard-gates | 部分(turn-002でroute test) |
| (新)dry-run summary正当性 | 集計 | result.ts aggregate | unit | ✗ "migrate"非加算でmigrated=0 | turn-001-eval evidence | **turn-002で修正(最優先)** |
| (新)UIパネル(一覧一括移行) | UI | webui/components/product | 目視/evaluator | ✗ 未実装 | grep components=0 | turn-002 |
| (新)レート制御 | 並列/間隔 | executor/route | evaluator | ✗ 逐次のみ・間隔無し | turn-001-eval | turn-002 |
| HG-001..004 lint/tsc/unit/build | - | - | run_hard_gates | turn-001=全PASS(unit180) | turn-001-hard-gates.json | 緑 |
| DEC-001..010 | 設計判断 | decisions.md | - | - | decisions.md | 採用 |

要件ID: REQ=ユーザー依頼 / AC=acceptance / Q=criteria軸 / HG=hard gate / RUN=検証実行 / DEC=設計判断
