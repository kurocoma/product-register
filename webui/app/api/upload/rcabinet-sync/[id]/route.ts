import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getProduct, dbRowToProductInput, upsertProduct } from "@/lib/product";
import { buildCabinetFileName, validateCabinetFileName } from "@/lib/converters";
import { buildRakutenManageNumber, buildImageLocations } from "@/lib/converters";
import { processForCabinet } from "@/lib/image";
import { insertCabinetFile } from "@/lib/rakuten";
import { createQpsPacer, isQpsLimit } from "@/lib/rakuten";
import { patchItem } from "@/lib/rakuten";
import { getRakutenCredentialsFromEnv } from "@/lib/rakuten";
import { DEFAULT_RAKUTEN_STORE, rakutenCabinetBase } from "@/lib/rakuten";

// sharp(native) と URL fetch のため Node ランタイム必須
export const runtime = "nodejs";

const MAX_BYTES = 30 * 1024 * 1024;

/** POST = 画像URL(image_url_1..image_count)の保存済みの並び順で画像を取得し、
 *  規約名（1枚目={ne_code}, 以降={base}_{n}）で R-Cabinet(thum02) へ上書き再アップロードする。
 *  全枚成功時は楽天商品の images[] も items.patch で規約URLの並びへ更新し、
 *  ローカルの image_url_N も新しい公開URLへ書き換える（260711修正依頼-6: 並べ替えてアップロードし直す）。 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "未ログインです" }, { status: 401 });

  const cred = getRakutenCredentialsFromEnv();
  if (!cred) {
    return NextResponse.json(
      { ok: false, error: "R-Cabinet 資格情報が未設定です（.env.local の RAKUTEN_SERVICE_SECRET / RAKUTEN_LICENSE_KEY）" },
      { status: 500 },
    );
  }

  const row = await getProduct(supabase, id);
  if (!row) return NextResponse.json({ ok: false, error: "商品が見つかりません" }, { status: 404 });
  const product = dbRowToProductInput(row);

  // 転送元: image_url_1..image_count（保存済みの並び順）。空は詰めずにスキップせず、
  // 「並び＝規約名の連番」を成立させるため index 連番で扱う（欠番があればエラー）。
  const count = Math.max(1, Math.min(20, product.image_count || 1));
  const sources: { index: number; url: string }[] = [];
  const gaps: number[] = [];
  for (let i = 1; i <= count; i++) {
    const u = (product as unknown as Record<string, unknown>)[`image_url_${i}`];
    if (typeof u === "string" && u.trim()) sources.push({ index: i, url: u.trim() });
    else gaps.push(i);
  }
  if (sources.length === 0) {
    return NextResponse.json(
      { ok: false, error: "画像URL(image_url_N)がありません。先にモールから取込むか、画像URLを設定してください。" },
      { status: 400 },
    );
  }
  if (gaps.length > 0) {
    return NextResponse.json(
      { ok: false, error: `画像URLに欠番があります（${gaps.join(", ")}番目）。並び替えで詰めてから実行してください。` },
      { status: 400 },
    );
  }

  const uploaded: { index: number; fileName: string; publicUrl: string }[] = [];
  const failed: { index: number; error: string }[] = [];
  // R-Cabinet は秒間リクエスト制限があり、無ウェイト連続だと数枚目から QPSLimit で落ちる。
  // アップロード間隔を空け、QPSLimit 時は待って再試行する（260712修正依頼-3）。
  const pace = createQpsPacer();
  for (const s of sources) {
    try {
      const target = buildCabinetFileName(product, { kind: "main", index: s.index });
      const valid = validateCabinetFileName(target.name);
      if (!valid.ok) {
        failed.push({ index: s.index, error: valid.reason });
        continue;
      }
      const resp = await fetch(s.url);
      if (!resp.ok) {
        failed.push({ index: s.index, error: `画像取得失敗 (HTTP ${resp.status}): ${s.url}` });
        continue;
      }
      const buf = Buffer.from(await resp.arrayBuffer());
      if (buf.byteLength > MAX_BYTES) {
        failed.push({ index: s.index, error: "画像が大きすぎます" });
        continue;
      }
      const jpeg = await processForCabinet(buf, { kind: "main" });
      const up = await pace(
        () =>
          insertCabinetFile(cred, {
            folderId: target.folderId,
            filePath: target.filePath,
            fileName: target.name,
            jpeg,
            overWrite: true,
          }),
        (r) => !r.ok && isQpsLimit(r.message),
      );
      if (up.ok) {
        const publicUrl = `${rakutenCabinetBase(DEFAULT_RAKUTEN_STORE, target.folder)}/${target.filePath}`;
        uploaded.push({ index: s.index, fileName: target.filePath, publicUrl });
      } else {
        failed.push({ index: s.index, error: up.message });
      }
    } catch (e) {
      failed.push({ index: s.index, error: e instanceof Error ? e.message : String(e) });
    }
  }

  // 1枚でも失敗したら images[] の更新はしない（欠けた並びで商品画像を置き換えないため）。
  if (failed.length > 0) {
    return NextResponse.json({ ok: false, uploaded, failed, patched: false, total: sources.length });
  }

  // 楽天商品の画像リストを規約URLの並びへ部分更新（送った images のみ反映・他項目は維持）。
  const manageNumber = buildRakutenManageNumber(product);
  const imagesProduct = { ...product, image_count: sources.length };
  const patch = await patchItem(cred, manageNumber, { images: buildImageLocations(imagesProduct) });
  let patched = false;
  let patchError: string | undefined;
  if (patch.ok) patched = true;
  else if (patch.status === 404) patchError = "楽天に該当商品が未登録のため、商品画像リストの更新はスキップしました（Cabinet へのアップロードは完了）";
  else patchError = `楽天商品の画像リスト更新に失敗しました: ${patch.message}`;

  // ローカルの image_url_N を新しい公開URL（規約URL）へ書き換え、モール現状と整合させる。
  if (patched) {
    const next = { ...product } as Record<string, unknown>;
    uploaded.forEach((u) => {
      next[`image_url_${u.index}`] = u.publicUrl;
    });
    await upsertProduct(supabase, next as typeof product, id);
  }

  return NextResponse.json({
    ok: patched || patch.status === 404,
    uploaded,
    failed,
    patched,
    ...(patchError ? { patchError } : {}),
    total: sources.length,
  });
}
