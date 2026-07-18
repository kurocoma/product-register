import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getRakutenCredentialsFromEnv } from "@/lib/rakuten";
import { listCabinetFolders } from "@/lib/rakuten";
import { RCABINET_FOLDER } from "@/lib/rakuten";

export const runtime = "nodejs";

/** GET = R-Cabinet のフォルダ一覧（画像一括アップロードのアップロード先選択UI用）。
 * folders/get はページング上限で全件を取り切れないことがあるため、既知フォルダ(thum02/wb01)は
 * API結果に無くても必ず含める。 */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "未ログインです" }, { status: 401 });

  const cred = getRakutenCredentialsFromEnv();
  if (!cred) return NextResponse.json({ ok: false, error: "楽天認証情報が未設定です" }, { status: 500 });

  let folders: { folderId: number; folderName: string; folderPath: string }[] = [];
  let partial = false;
  try {
    folders = await listCabinetFolders(cred);
  } catch {
    partial = true;
  }
  for (const known of Object.values(RCABINET_FOLDER)) {
    if (!folders.some((f) => f.folderId === known.folderId)) {
      folders.unshift({ folderId: known.folderId, folderName: known.path, folderPath: known.path });
    }
  }
  return NextResponse.json({ ok: true, folders, partial });
}
