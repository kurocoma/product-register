import type { ProductInput } from "@/lib/product";
import { EDITABLE_FIELDS, diffProduct, yahooItemsForProduct } from "@/lib/product";
import {
  buildRakutenManageNumber,
  buildRakutenPatchBody,
  detectVariantStructuralChange,
  diffVariants,
  parseRakutenItem,
  parseRakutenVariants,
  parseYahooItem,
  buildYahooUpdateParams,
  validateSubscription as validateRakutenSubscription,
} from "@/lib/converters";
import { explainRakutenError } from "@/lib/rakuten";
import { fitYahooFieldLimits, validateYahooSubscription } from "@/lib/yahoo";
import type { MallPushOutcome } from "./types";

/** DB更新後の「モール反映」共通実装（機能1〜3で共用）。
 *
 * 既存の単品反映 API（app/api/update/[mall]/[id]/route.ts の buildPlan → 送信）と同じ
 * 内部関数（diffProduct / buildRakutenPatchBody / buildYahooUpdateParams / fitYahooFieldLimits）を
 * 使った read-before-write の差分反映。HTTP の自己呼び出しはしない。
 * クライアントは deps 注入（route が per-call タイムアウト＋QPSペーシング付きの実クライアントを、
 * テストが fake を注入する。sale-support の service/rms-deps と同じ方式）。
 */

export type RakutenClientDeps = {
  getItem: (manageNumber: string) => Promise<{ exists: boolean; status: number; json: Record<string, unknown> | null }>;
  patchItem: (manageNumber: string, body: Record<string, unknown>) => Promise<{ ok: boolean; status: number; message?: string }>;
};

export type YahooClientDeps = {
  sellerId: string;
  getItem: (itemCode: string) => Promise<{ exists: boolean; raw: string }>;
  editItem: (params: Record<string, string>) => Promise<{ ok: boolean; message?: string; warnings?: string[] }>;
  reservePublish: () => Promise<{ ok: boolean; message: string }>;
};

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export type RakutenPushOptions = {
  /** 楽天PC販売説明文（salesDescription）の変更を patch に含める（機能2専用）。
   * 既存 buildRakutenPatchBody は salesDescription 非対応のため、ここで最小追加する。
   * 空値は送らない（空 = 自動imgList運用のため上書きしない）。 */
  includeSalesDescription?: boolean;
};

/** 楽天へ差分反映（既存 patch 経路と同一ロジック）。 */
export async function pushProductToRakuten(
  client: RakutenClientDeps,
  product: ProductInput,
  opts: RakutenPushOptions = {},
): Promise<MallPushOutcome> {
  const base = { attempted: true, updated: 0, skipped: [] as string[] };
  try {
    const manageNumber = buildRakutenManageNumber(product);
    const got = await client.getItem(manageNumber);
    if (!got.exists || !got.json) {
      return {
        ...base,
        ok: false,
        message:
          got.status === 404
            ? `楽天に商品「${manageNumber}」が見つかりません`
            : `楽天 items.get が HTTP ${got.status} を返しました。時間をおいて再実行してください`,
      };
    }
    const mallParsed = parseRakutenItem(got.json);
    delete (mallParsed as { _variantId?: string })._variantId;
    mallParsed.variants = parseRakutenVariants(got.json);
    // 多SKU商品は価格/JAN/送料をフラットでなく variants[] で扱うため除外（update route と同一）。
    const rakutenExclude =
      product.variants.length > 0
        ? ["selling_price", "jan_code", "shipping_type", "display_price"]
        : ["display_price"];
    const flatFields = EDITABLE_FIELDS.filter((f) => !rakutenExclude.includes(f as string));
    const changed = [
      ...diffProduct(mallParsed, product, flatFields),
      ...diffVariants(mallParsed.variants, product.variants),
    ];
    // SKU構成変更（追加/削除/キー未入力）は patch で表現できない → この商品は失敗扱いで継続。
    const sc = detectVariantStructuralChange(mallParsed.variants, product.variants);
    const structural: string[] = [];
    if (sc.added.length) structural.push(`SKU追加(${sc.added.join(", ")})`);
    if (sc.removed.length) structural.push(`SKU削除(${sc.removed.join(", ")})`);
    if (sc.emptyKey) structural.push("SKU管理番号/NEコード未入力のSKU");
    if (structural.length > 0) {
      return {
        ...base,
        ok: false,
        message: `SKU構成の変更（${structural.join(" / ")}）は一括反映（patch）では送れません。商品編集画面の「楽天へ登録」で反映してください`,
      };
    }
    // 定期購入の事前検証（定期関連の変更があるときだけ。update route と同一）。
    const subChanged = changed.some(
      (c) => c.field.startsWith("subscription_") || c.field.endsWith("定期価格"),
    );
    if (subChanged) {
      const rsub = validateRakutenSubscription(product);
      if (!rsub.ok) {
        return { ...base, ok: false, message: `定期購入設定が不正: ${rsub.errors.join(" / ")}` };
      }
    }
    const built = buildRakutenPatchBody(changed, product, mallParsed);
    const body = built.body;
    const bodyWithAttributes = buildRakutenPatchBody(changed, product, mallParsed, {
      includeAttributes: true,
    }).body;
    base.skipped = built.skipped;
    if (opts.includeSalesDescription) {
      const before = (mallParsed as Partial<ProductInput>).sale_description_pc ?? "";
      if (product.sale_description_pc.trim() && product.sale_description_pc !== before) {
        body.salesDescription = product.sale_description_pc;
        bodyWithAttributes.salesDescription = product.sale_description_pc;
      }
    }
    if (Object.keys(body).length === 0) {
      // 空ボディを送ると GE0011 で拒否されるため送信しない（update route と同じ扱い）。
      return {
        ...base,
        ok: true,
        message:
          changed.length === 0
            ? "変更なし（楽天は現状どおり）"
            : "楽天へ patch で送れる変更がありません（未対応の変更は skipped 参照）",
      };
    }
    let result = await client.patchItem(manageNumber, body);
    // IE0418(ジャンル必須属性不足)なら、商品側の属性を同梱して1回だけ再試行（update route と同一）。
    if (!result.ok && /IE0418|mandatory attribute/i.test(result.message ?? "")) {
      result = await client.patchItem(manageNumber, bodyWithAttributes);
    }
    if (!result.ok) {
      const raw = result.message ?? `HTTP ${result.status}`;
      return { ...base, ok: false, message: `items.patch 失敗: ${raw}${explainRakutenError(raw)}` };
    }
    return { ...base, ok: true, updated: 1, message: "楽天へ反映しました" };
  } catch (e) {
    return { ...base, ok: false, message: errMessage(e) };
  }
}

/** Yahoo へ差分反映（既存 editItem 更新経路と同一ロジック）。
 * 多SKU商品は yahooItemsForProduct で SKUごとの擬似商品（item_code=各SKUのNEコード）へ展開して
 * それぞれ更新する（CSV/登録と同じ「Yahoo は SKU ごとに別商品」の単一実装を利用。
 * unified モードは親1商品のまま）。Yahoo に存在しない item_code はスキップして継続する。 */
export async function pushProductToYahoo(
  client: YahooClientDeps,
  product: ProductInput,
): Promise<MallPushOutcome> {
  const base = { attempted: true, updated: 0, skipped: [] as string[] };
  const notes: string[] = [];
  let failures = 0;
  try {
    const items = yahooItemsForProduct(product);
    for (const item of items) {
      const code = String(item.ne_code ?? "").trim();
      if (!code) {
        notes.push("NEコード未設定のSKUはスキップ");
        continue;
      }
      const got = await client.getItem(code);
      if (!got.exists) {
        notes.push(`${code}: Yahoo に存在しません（スキップ）`);
        continue;
      }
      const mallParsed = parseYahooItem(got.raw, { fallbackTaxRate: item.tax_rate });
      const changed = diffProduct(mallParsed, item);
      if (changed.length === 0) {
        notes.push(`${code}: 変更なし`);
        continue;
      }
      const { params: rawParams, advanced, skipped } = buildYahooUpdateParams(got.raw, changed, item, {
        sellerId: client.sellerId,
      });
      base.skipped.push(...skipped.map((s) => `${code}: ${s}`));
      if (advanced.length > 0) {
        failures++;
        notes.push(
          `${code}: API更新で保持できない設定（${advanced.join(", ")}）を含むため中止（ストア管理画面で更新してください）`,
        );
        continue;
      }
      const params = fitYahooFieldLimits(rawParams);
      const sub = validateYahooSubscription(params);
      if (!sub.ok) {
        failures++;
        notes.push(`${code}: 定期購入設定が不正: ${sub.errors.join(" / ")}`);
        continue;
      }
      const res = await client.editItem(params);
      if (!res.ok) {
        failures++;
        notes.push(`${code}: editItem 失敗: ${res.message ?? "不明なエラー"}`);
        continue;
      }
      base.updated++;
      if (res.warnings?.length) notes.push(`${code}: 警告 ${res.warnings.join(" / ")}`);
    }
    const detail = notes.join(" / ");
    if (failures > 0) {
      return { ...base, ok: false, message: detail || "一部失敗しました" };
    }
    if (base.updated === 0) {
      return { ...base, ok: true, message: detail || "変更なし（Yahoo は現状どおり）" };
    }
    return { ...base, ok: true, message: `Yahoo へ反映しました（${base.updated}件）${detail ? ` / ${detail}` : ""}` };
  } catch (e) {
    return { ...base, ok: false, message: [...notes, errMessage(e)].join(" / ") };
  }
}
