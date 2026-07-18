import { NextResponse } from "next/server";
import { dbRowToProductInput } from "@/lib/product";
import { detectRuleViolation } from "@/lib/rule-audit";
import { fetchAllProductRows } from "@/lib/rule-audit";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ ok: false, error: "未ログインです" }, { status: 401 });
  }

  try {
    const rows = await fetchAllProductRows(supabase);
    const products = rows.flatMap((row) => {
      const product = dbRowToProductInput(row);
      const violation = detectRuleViolation(product);
      if (!violation.violated) return [];

      return [{
        id: row.id,
        ne_code: product.ne_code,
        product_name: product.product_name,
        reasons: violation.reasons,
      }];
    });

    return NextResponse.json({ ok: true, products });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "ルール監査に失敗しました",
      },
      { status: 500 },
    );
  }
}
