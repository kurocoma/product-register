# WebUI 実装計画書 一覧 (Plan 1〜5)

| Plan | タイトル | 規模目安 | 完了時の成果 |
|---|---|---|---|
| [Plan 1](2026-05-24-webui-plan-1-foundation.md) | Foundation (Next.js + Supabase 骨格) | 11 task | ログイン → ダッシュボード骨格 + サイドナビ + 9 placeholder ページ |
| [Plan 2](2026-05-24-webui-plan-2-converter.md) | TypeScript CSV Converter | 11 task | Phase 1 Python ロジック (4 モール) を TypeScript 移植、 Phase 1 期待値 CSV と統合テスト一致 |
| [Plan 3](2026-05-24-webui-plan-3-product-crud.md) | Product CRUD | 8 task | 商品一覧・新規・編集 (アコーディオン + 自動/手動保存) |
| [Plan 4](2026-05-24-webui-plan-4-mall-previews.md) | Mall Previews | 6 task | 楽天/Yahoo/Shopify 風 UI プレビュー + 単一商品 CSV ダウンロード |
| [Plan 5](2026-05-24-webui-plan-5-auxiliary.md) | Auxiliary Screens | 8 task | ダッシュボード実データ + CSV 一括 + テンプレート + 履歴 + 設定 + ヘルプ |

**合計目安:** 44 task / 約 2-3 週間 (フルタイム想定、TDD 並行)

## 依存関係

```
Plan 1 (Foundation)
   ↓
Plan 2 (Converter) ← Phase 1 Python ロジック参照
   ↓
Plan 3 (Product CRUD) — Plan 2 の Converter は Plan 4 で使うが、CRUD だけなら独立
   ↓
Plan 4 (Mall Previews) ← Plan 2 + 3 必須
   ↓
Plan 5 (Auxiliary Screens) ← Plan 1-4 全て使用
```

## 設計書

- [docs/superpowers/specs/2026-05-20-webui-mockup-design.md](../specs/2026-05-20-webui-mockup-design.md) — 全 9 画面 + データモデル

## 関連リソース

- モック画像: `docs/Create_a_high-fidelity_desktop_web_application_UI_-*.png` (3 枚)
- Phase 1 実装 (参照): `src/product_register/` 配下
- マニュアル: [docs/superpowers/manual/](../manual/)

## 実行方法

各 Plan ファイル冒頭に従い:
- **subagent-driven-development** (推奨): 各 Task ごとに新しい subagent を dispatch
- **executing-plans** (代替): 同一セッションでバッチ実行

## 注意

- Plan 1 Task 1 で Supabase の新規プロジェクト作成が必要 (手動操作)
- Plan 1 Task 4 で `.env.local` に Supabase URL/anon key を手動で書く必要あり
- Plan 5 Task 8 の Playwright E2E は手動認証フロー (Magic Link) のため簡易スモークのみ
- 各 Plan 完了時に `git tag webui-plan-N-complete` を打つ
