import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { upsertProduct } from "@/lib/product/repository";
import { recordHistory } from "@/lib/history/recorder";
import { getRakutenCredentialsFromEnv } from "@/lib/rakuten/credentials";
import { getItem as getRakutenItem, searchManageNumberBySku } from "@/lib/rakuten/item-client";
import { parseRakutenItem, parseRakutenVariants } from "@/lib/converters/rakuten-item-parser";
import { buildImportedProduct } from "@/lib/converters/mall-import";
import { fetchYahooCategoryMapping } from "@/lib/product/category-mapping";
import { fetchYahooPostageSet, fetchYahooLeadTime } from "@/lib/product/shipping-mapping";
import { getYahooConfig, getYahooAccessToken } from "@/lib/yahoo/auth";
import { buildYahooEditItemParams, validateEditItemParams } from "@/lib/yahoo/item-mapper";
import { editItem, setStock, submitItem } from "@/lib/yahoo/item-client";
import { buildYahooItemImageUrls } from "@/lib/converters/image-url";
import { buildYahooLibFileName, validateYahooFileName } from "@/lib/yahoo/lib-path";
import { processForCabinet } from "@/lib/image/process";
import { uploadLibImage } from "@/lib/yahoo/lib-image-client";
import type { ProductInput } from "@/lib/product/schema";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseManageNumbers, runItems, aggregate } from "@/lib/migrate";
import { makePerItemExecutor, type ExecutorDeps } from "@/lib/migrate/executor";

// 楽天 items.get / 画像 fetch(sharp 整形) のため Node ランタイム必須
export const runtime = "nodejs";

/** POST = 楽天 商品管理番号リストを Yahoo!ショッピングへ一括移行する。
 *
 * body: {
 *   manageNumbers: string | string[]  // 改行/カンマ/CSV1列・配列いずれも可
 *   dryRun?: boolean    // 既定 true（DB/モールへ書き込まないプレビュー）
 *   publish?: boolean   // 既定 false（安全既定: Yahoo display:0・非公開）。true=公開で登録
 *   stockQuantity?: number // publish=true 時に設定する在庫数（>0 で setStock）。既定 0
 *   continueOnError?: boolean // 既定 true（1件失敗で全体を止めない）
 *   delayMs?: number    // 既定 300（item 間のレート制御待機ms。0で無効化可。AC-H01）
 *   preserveExistingDisplay?: boolean // 既定 true（既存公開商品を非表示化しない。AC-H02）
 * }
 * 返り値: { ok, dryRun, publish, stockQuantity, delayMs, results[], summary, invalid[], duplicatesRemoved }
 *
 * カテゴリ未解決(null)・多SKU・高度設定は登録せず requires_manual に分類する。
 * 既定(publish=false)は display:0・submitItem 非実行（安全側）。
 * publish=true のときのみ display:1 + setStock(在庫) + submitItem(公開反映) を実行する。
 * 1リクエストの対象上限は MAX_ITEMS 件（超過は 400 で明示分割を促す。AC-H04）。
 */
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "未ログインです" }, { status: 401 });

  let body: {
    manageNumbers?: unknown;
    dryRun?: unknown;
    publish?: unknown;
    stockQuantity?: unknown;
    continueOnError?: unknown;
    delayMs?: unknown;
    preserveExistingDisplay?: unknown;
  } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    /* 空ボディは下の検証で弾く */
  }

  const rawManage = body.manageNumbers;
  if (typeof rawManage !== "string" && !Array.isArray(rawManage)) {
    return NextResponse.json(
      { ok: false, error: "manageNumbers（管理番号の配列／改行テキスト／CSV1列）を指定してください" },
      { status: 400 },
    );
  }

  const dryRun = body.dryRun !== false; // 既定 true（安全）
  const publish = body.publish === true; // 既定 false（安全既定）
  // publish=true のとき設定する在庫数（>0 のみ setStock）。負値・非数は 0（在庫設定なし）。
  const stockQuantity =
    typeof body.stockQuantity === "number" && body.stockQuantity >= 0 ? Math.floor(body.stockQuantity) : 0;
  const continueOnError = body.continueOnError !== false; // 既定 true（失敗継続）
  // レート制御の待機ms。安全な既定 300ms（過負荷防止 / AC-H01）。0以上の数値のみ採用。
  const delayMs =
    typeof body.delayMs === "number" && body.delayMs >= 0 ? body.delayMs : 300;
  // 既存(forUpdate)の公開中 Yahoo 商品を非表示化しない既定（AC-H02）。
  const preserveExistingDisplay = body.preserveExistingDisplay !== false;

  const { valid, invalid, duplicatesRemoved } = parseManageNumbers(rawManage as string | string[]);

  // 大量入力ガード（AC-H04）: 単一同期リクエストでのタイムアウト・部分commit を避けるため
  // 推奨上限を超えたら処理せず明示的に分割を促す（しまのや規模 ~103件は通過）。
  const MAX_ITEMS = 200;
  if (valid.length > MAX_ITEMS) {
    return NextResponse.json(
      {
        ok: false,
        error: `対象が多すぎます(${valid.length}件)。${MAX_ITEMS}件以下に分割してください`,
        count: valid.length,
      },
      { status: 400 },
    );
  }

  // モール資格情報（楽天取込は dry-run でも必要。Yahoo は params 生成に sellerId が要る）
  const cred = getRakutenCredentialsFromEnv();
  if (!cred) {
    return NextResponse.json({ ok: false, error: "楽天 ESA 認証情報が未設定です" }, { status: 500 });
  }
  const cfg = getYahooConfig();
  if (!cfg) {
    return NextResponse.json({ ok: false, error: "Yahoo 認証情報が未設定です" }, { status: 500 });
  }

  // Yahoo アクセストークンは commit（editItem/画像同期）でのみ必要。dry-run では取得しない。
  let token = "";
  if (!dryRun) {
    try {
      token = await getYahooAccessToken(cfg);
    } catch (e) {
      return NextResponse.json(
        {
          ok: false,
          error: (e instanceof Error ? e.message : String(e)) + "（リフレッシュトークン失効時は再認証）",
        },
        { status: 502 },
      );
    }
  }

  // 実依存を組み立てて executor に注入（route は薄く・判断/順序は executor に集約）
  const deps: ExecutorDeps = {
    resolveRakutenItem: async (manageNumber) => {
      let got = await getRakutenItem(cred, manageNumber);
      let resolvedCode = manageNumber;
      if (!got.exists || !got.json) {
        // 入力がシステム連携用SKU番号(=NEコード)の場合、検索で実管理番号を引き当てる
        const mn = await searchManageNumberBySku(cred, manageNumber);
        if (mn) {
          got = await getRakutenItem(cred, mn);
          resolvedCode = mn;
        }
      }
      if (!got.exists || !got.json) return null;
      return { json: got.json, resolvedCode };
    },
    parseItem: (json) => parseRakutenItem(json),
    parseVariants: (json) => parseRakutenVariants(json),
    buildImported: (code, parsed) => buildImportedProduct("rakuten", code, parsed),
    resolveCategory: (genreId) => fetchYahooCategoryMapping(supabase, genreId),
    // 配送方法セット番号→Yahoo postage_set、納期管理番号→発送日数 を解決（未投入なら null→現状維持）。
    resolveShipping: async (group, deliveryDateId) => {
      const [ps, lt] = await Promise.all([
        fetchYahooPostageSet(supabase, group),
        fetchYahooLeadTime(supabase, deliveryDateId),
      ]);
      const n = ps != null ? parseInt(ps, 10) : NaN;
      return {
        postageSet: Number.isFinite(n) ? n : undefined,
        leadTime: lt != null ? lt : undefined,
      };
    },
    findExisting: (manageNumber, neCode) =>
      findExistingProduct(supabase, user.id, manageNumber, neCode),
    upsert: async (product) => {
      const r = await upsertProduct(supabase, product);
      return { id: r.id };
    },
    buildYahooParams: (product, o) =>
      buildYahooEditItemParams(product, {
        sellerId: cfg.sellerId,
        forUpdate: o.forUpdate,
        forceDisplay: o.forceDisplay,
      }),
    validateYahoo: (params) => validateEditItemParams(params),
    editYahoo: (params) => editItem(token, params),
    // 公開フロー（publish 時のみ executor が呼ぶ）: 在庫設定→公開反映。
    setStock: (itemCode, quantity) => setStock(token, cfg.sellerId, itemCode, quantity),
    submitYahoo: (itemCode) => submitItem(token, cfg.sellerId, itemCode),
    syncImage: (_productId, product) => syncYahooImages(token, cfg.sellerId, product),
    // item_image_urls を実 sellerId 基底(lib/{sellerId})＋アップロード成功 index のみで再構築（A3）。
    buildImageUrls: (neCode, indices) => buildYahooItemImageUrls(neCode, indices, cfg.sellerId),
    recordHistory: (action, productId, detail) => recordHistory(supabase, action, productId, detail),
  };

  const executor = makePerItemExecutor(deps, {
    dryRun,
    publish,
    preserveExistingDisplay,
    stockQuantity,
  });
  const results = await runItems(
    valid.map((m) => ({ manageNumber: m })),
    executor,
    { continueOnError, delayMs },
  );
  const summary = aggregate(results);

  return NextResponse.json({
    ok: true,
    dryRun,
    publish,
    stockQuantity: publish ? stockQuantity : undefined,
    delayMs,
    results,
    summary,
    invalid,
    duplicatesRemoved,
  });
}

/** 既存アプリ商品の照合。楽天は商品管理番号(extra->>rakuten_manage_number)優先→NEコード。
 *  import route の findExistingProduct と同等ロジック（多SKU同ページの二重作成を防ぐ）。
 *  既存ルートを変更しないため migrate 側で同等実装する。 */
async function findExistingProduct(
  supabase: SupabaseClient,
  userId: string,
  manageNumber: string,
  neCode: string,
): Promise<{ id: string } | null> {
  if (manageNumber) {
    const { data } = await supabase
      .from("products")
      .select("id")
      .eq("user_id", userId)
      .eq("extra->>rakuten_manage_number", manageNumber)
      .limit(1);
    if (data && data.length) return data[0] as { id: string };
  }
  const { data } = await supabase
    .from("products")
    .select("id")
    .eq("user_id", userId)
    .eq("ne_code", neCode)
    .limit(1);
  return data && data.length ? (data[0] as { id: string }) : null;
}

const MAX_IMAGE_BYTES = 30 * 1024 * 1024;

/** 取込んだ実画像URL(image_url_1..image_count)を Yahoo 追加画像(lib)へ転送する。
 *  upload/yahoo-sync ルートと同等（it-14091 対策の画像準備）。ベストエフォート（失敗は理由を返す）。
 *  戻り値 `uploaded` = アップロードに成功した画像 index 群。executor がこれだけで item_image_urls を
 *  再構築する（成功画像のみ参照し、壊れURLでの it-14091 再発を防ぐ）。 */
async function syncYahooImages(
  token: string,
  sellerId: string,
  product: ProductInput,
): Promise<{ ok: boolean; error?: string; uploaded: number[] }> {
  const count = Math.max(1, Math.min(20, product.image_count || 1));
  const sources: { index: number; url: string }[] = [];
  for (let i = 1; i <= count; i++) {
    const u = (product as unknown as Record<string, unknown>)[`image_url_${i}`];
    if (typeof u === "string" && u.trim()) sources.push({ index: i, url: u.trim() });
  }
  if (sources.length === 0) {
    return { ok: false, error: "転送元の画像URL(image_url_N)がありません", uploaded: [] };
  }

  const failed: string[] = [];
  const uploaded: number[] = [];
  for (const s of sources) {
    try {
      const target = buildYahooLibFileName(product, s.index);
      const fnValid = validateYahooFileName(target.fileName);
      if (!fnValid.ok) {
        failed.push(`#${s.index}: ${fnValid.reason}`);
        continue;
      }
      const resp = await fetch(s.url);
      if (!resp.ok) {
        failed.push(`#${s.index}: 画像取得失敗 (HTTP ${resp.status})`);
        continue;
      }
      const buf = Buffer.from(await resp.arrayBuffer());
      if (buf.byteLength > MAX_IMAGE_BYTES) {
        failed.push(`#${s.index}: 画像が大きすぎます`);
        continue;
      }
      const jpeg = await processForCabinet(buf, { kind: "main" });
      const up = await uploadLibImage(token, sellerId, { fileName: target.fileName, jpeg });
      if (!up.ok) failed.push(`#${s.index}: ${up.message}`);
      else uploaded.push(s.index);
    } catch (e) {
      failed.push(`#${s.index}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return failed.length
    ? { ok: false, error: failed.join(" / "), uploaded }
    : { ok: true, uploaded };
}
