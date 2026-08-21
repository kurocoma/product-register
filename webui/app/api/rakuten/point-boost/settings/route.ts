import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import {
  getRakutenApplicationIdFromEnv,
  getRakutenCredentialsFromEnv,
  getRakutenWebServiceAccessKeyFromEnv,
} from "@/lib/rakuten";
import { getPointBoostSettings, upsertPointBoostSettings } from "@/lib/point-boost";

export const runtime = "nodejs";

const SettingsSchema = z.object({
  enabled: z.boolean(),
  plus_rate: z.number().int().min(1).max(5),
  max_rate: z.number().int().min(1).max(20),
  compare_top_n: z.number().int().min(1).max(10),
  campaign_days: z.number().int().min(1).max(60),
});

/** GET = 設定と資格情報の設定状況（applicationId / RMS ESA の有無）。 */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "未ログインです" }, { status: 401 });

  try {
    const settings = await getPointBoostSettings(supabase, user.id);
    return NextResponse.json({
      ok: true,
      settings,
      hasApplicationId: !!getRakutenApplicationIdFromEnv(),
      hasAccessKey: !!getRakutenWebServiceAccessKeyFromEnv(),
      hasRmsCred: !!getRakutenCredentialsFromEnv(),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

/** POST = 設定の保存。body は SettingsSchema（全項目必須）。 */
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "未ログインです" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = SettingsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "設定値が不正です: " + parsed.error.issues.map((i) => i.path.join(".")).join(", ") },
      { status: 400 },
    );
  }

  try {
    await upsertPointBoostSettings(supabase, user.id, parsed.data);
    return NextResponse.json({ ok: true, settings: parsed.data });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
