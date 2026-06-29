import type { ItemPlanInput, MigrationItemPlan } from "./types";

/** per-item の移行可否を判定する純関数。
 *
 * 取込・カテゴリ解決・SKU/設定検出の結果を注入し、誤登録を防ぐ安全側の判定だけを行う。
 * I/O は一切しない（呼び出し側で解決済みの値を渡す）。
 *
 * requires_manual（自動移行せず手動対応）になる条件（複合可・全理由を列挙）:
 *  - Yahoo カテゴリが未解決（マッピング無し）: 誤カテゴリ登録を防ぐ
 *  - 多SKU(variants)を持つ: SKU 別設定の自動移行は危険
 *  - 高度な Yahoo 設定がある: 自動移行で誤反映しうる
 *  - Yahoo 必須項目が不足
 * いずれにも該当しなければ action="migrate"。 */
export function buildItemPlan(input: ItemPlanInput): MigrationItemPlan {
  const {
    manageNumber,
    existed,
    yahooCategoryResolved,
    hasMultipleSku,
    hasAdvancedYahooSettings,
    missingRequiredYahooFields,
  } = input;

  // null（マッピング行が無い）も false（紐付け空）も「未解決」として扱う
  const categoryResolved = yahooCategoryResolved === true;
  const missing = missingRequiredYahooFields ?? [];

  const reasons: string[] = [];
  if (!categoryResolved) {
    reasons.push("Yahooカテゴリのマッピングが無いため自動移行できません");
  }
  if (hasMultipleSku) {
    reasons.push("多SKU(variants)のため自動移行できません");
  }
  if (hasAdvancedYahooSettings) {
    reasons.push("高度なYahoo設定があるため自動移行できません");
  }
  if (missing.length > 0) {
    reasons.push(`Yahoo必須項目が不足: ${missing.join(", ")}`);
  }

  return {
    manageNumber,
    action: reasons.length > 0 ? "requires_manual" : "migrate",
    reasons,
    existed,
    categoryResolved,
    hasMultipleSku,
    hasAdvancedYahooSettings,
    missingRequiredYahooFields: missing,
  };
}
