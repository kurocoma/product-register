/** 編集画面ヘッダ用の補足コード表示（純関数）。
 * 多SKU統合商品で「代表 NEコード以外のコード（楽天管理番号・各SKU）」が
 * この商品に含まれることを明示し、「検索したコードと違う商品が開いた」誤解を防ぐ。
 * 例: 代表 rs74-5・楽天管理番号 r74-1・SKU 3種 → "楽天管理番号 r74-1 ・ SKU 3種: 5個(rs74-5) / 3個(rs74-3) / 1個(r74-1)" */

type SummaryVariant = { ne_code?: string; sku_manage_number?: string; variation_value?: string };
type SummaryInput = {
  ne_code: string;
  rakuten_manage_number?: string;
  variants?: SummaryVariant[];
};

/** 補足が不要（フラット商品かつ楽天管理番号が代表と同じ/未設定）なら null。 */
export function productCodeSummary(p: SummaryInput): string | null {
  const parts: string[] = [];

  const manage = String(p.rakuten_manage_number ?? "").trim();
  if (manage && manage !== p.ne_code) {
    parts.push(`楽天管理番号 ${manage}`);
  }

  const variants = p.variants ?? [];
  if (variants.length >= 2) {
    const items = variants.map((v) => {
      const code = String(v.ne_code || v.sku_manage_number || "").trim() || "(コード未設定)";
      const label = String(v.variation_value ?? "").trim();
      return label ? `${label}(${code})` : code;
    });
    parts.push(`SKU ${variants.length}種: ${items.join(" / ")}`);
  }

  return parts.length > 0 ? parts.join(" ・ ") : null;
}
