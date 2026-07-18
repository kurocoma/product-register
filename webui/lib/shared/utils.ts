// 共有ユーティリティ（正本は lib/utils.ts、現状 cn() のみ）。
// 「とりあえず共通化」でここを肥大させない。追加条件は docs/architecture-audit/07 §8.4:
// (1) 2機能以上で実使用 (2) 業務的に同一概念 (3) 副作用なし or 明確な境界。
export * from "../utils";
