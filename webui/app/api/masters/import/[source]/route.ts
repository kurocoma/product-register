import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { decodeCsvBytes } from "@/lib/ne-master/decode";
import { parseNeSyohin, parseNeSet, parseHimoduke, parseExcelMaster, parseExcelDiscon, parseExcelMall } from "@/lib/ne-master/parse";
import { buildItemFromNeSyohin, buildItemFromNeSet, buildItemFromExcelMaster, buildItemFromExcelDiscon, buildItemFromHimoduke, buildMallCodes } from "@/lib/ne-master/build";
import { mergeItemMaster, replaceSetComposition, upsertMallCodes, loadNeResolver } from "@/lib/ne-master/repository";
import type { Mall } from "@/lib/ne-master/types";

export const runtime = "nodejs";

const MAX_BYTES = 30 * 1024 * 1024;
const SOURCES = new Set(["ne-syohin", "ne-set", "ne-himoduke", "excel-master", "excel-discon", "excel-mall"]);
const MALLS = new Set(["rakuten", "yahoo", "amazon", "shimanoya"]);

/** POST /api/masters/import/[source]  (excel-mall は ?mall=...)  FormData: file(CSV) */
export async function POST(req: Request, { params }: { params: Promise<{ source: string }> }) {
  const { source } = await params;
  if (!SOURCES.has(source)) return NextResponse.json({ ok: false, error: "不正なソース指定です" }, { status: 400 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "未ログインです" }, { status: 401 });

  const mall = new URL(req.url).searchParams.get("mall") as Mall | null;
  if (source === "excel-mall" && (!mall || !MALLS.has(mall))) {
    return NextResponse.json({ ok: false, error: "excel-mall は ?mall=rakuten|yahoo|amazon|shimanoya が必要です" }, { status: 400 });
  }

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ ok: false, error: "CSVファイルがありません" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ ok: false, error: "ファイルが大きすぎます（30MB以内）" }, { status: 413 });

  const text = decodeCsvBytes(await file.arrayBuffer());

  try {
    if (source === "ne-syohin") {
      const r = await mergeItemMaster(supabase, buildItemFromNeSyohin(parseNeSyohin(text)));
      return NextResponse.json({ ok: true, source, ...r });
    }
    if (source === "ne-set") {
      const { items, comps } = buildItemFromNeSet(parseNeSet(text));
      const ir = await mergeItemMaster(supabase, items);
      const cr = await replaceSetComposition(supabase, comps);
      return NextResponse.json({ ok: true, source, items: ir, composition: cr.inserted });
    }
    if (source === "ne-himoduke") {
      const r = await mergeItemMaster(supabase, buildItemFromHimoduke(parseHimoduke(text)));
      return NextResponse.json({ ok: true, source, ...r });
    }
    if (source === "excel-master") {
      const r = await mergeItemMaster(supabase, buildItemFromExcelMaster(parseExcelMaster(text)));
      return NextResponse.json({ ok: true, source, ...r });
    }
    if (source === "excel-discon") {
      const r = await mergeItemMaster(supabase, buildItemFromExcelDiscon(parseExcelDiscon(text)));
      return NextResponse.json({ ok: true, source, ...r });
    }

    // excel-mall: ne_code 解決（管理番号=既知ne_code、または JAN一意）→ unmatched は報告
    const rows = parseExcelMall(text, mall!);
    const { knownNeCodes, janToNe } = await loadNeResolver(supabase);
    for (const row of rows) {
      if (!row.ne_code && knownNeCodes.has(row.manage_no)) row.ne_code = row.manage_no;
    }
    const resolveNeByJanQty = (jan: string) => {
      const arr = janToNe.get(jan);
      return arr && arr.length === 1 ? arr[0] : null; // 一意のときだけ採用（数量曖昧回避）
    };
    const { records, unmatched } = buildMallCodes(rows, mall!, resolveNeByJanQty);
    const r = await upsertMallCodes(supabase, records);
    return NextResponse.json({ ok: true, source, mall, upserted: r.count, unmatched });
  } catch (e) {
    return NextResponse.json({ ok: false, error: "取込に失敗しました: " + (e instanceof Error ? e.message : String(e)) }, { status: 500 });
  }
}
