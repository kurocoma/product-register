/** 楽天→Yahoo 一括移行の per-item オーケストレータ（I/O 境界）。
 *
 * 純ロジック層（plan/defaults/result）と実 I/O（楽天/Yahoo/DB）を結ぶ層。
 * すべての副作用を「依存注入(deps)」で受け取り、判断と副作用順序をここ1箇所に集約する。
 * これにより live API を呼ばずに（vitest の fake で）安全既定・dry-run 非書込・
 * カテゴリ/多SKU スキップ・既存重複排除・失敗継続を網羅検証できる。
 *
 * route 側は実依存を組み立ててこのファクトリへ渡すだけ（薄く保つ）。
 */
import type { ProductInput, Variant } from "@/lib/product/schema";
import type { BuildImportedResult } from "@/lib/converters/mall-import";
import type { YahooCategoryMapping } from "@/lib/product/category-mapping";
import type { EditItemResult } from "@/lib/yahoo/item-client";
import { buildItemPlan } from "./plan";
import { safeStateDefaults } from "./defaults";
import type { MigrationItemResult } from "./types";

/** 楽天取込の解決結果。resolvedCode は SKU 検索で引き当てた実管理番号（入力と異なることがある）。 */
export type ResolvedRakutenItem = { json: Record<string, unknown>; resolvedCode: string };

/** Yahoo 必須項目チェックの結果（validateEditItemParams 互換）。 */
export type YahooValidation = { ok: true } | { ok: false; missing: string[] };

/** per-item 実行に必要な全副作用。route 側で実装を注入する（テストは fake を注入）。
 *  読み取り（resolve系/find）と書き込み（upsert/edit/image/history）を明確に分け、
 *  dry-run では書き込み系を一切呼ばない。 */
export type ExecutorDeps = {
  /** 楽天 items.get（無ければ SKU 検索フォールバック）。見つからなければ null。 */
  resolveRakutenItem: (manageNumber: string) => Promise<ResolvedRakutenItem | null>;
  /** items.get JSON → 編集対象 ProductInput 部分（parseRakutenItem 相当）。 */
  parseItem: (json: Record<string, unknown>) => Partial<ProductInput>;
  /** items.get JSON → 全 variant（多SKU 検出に使う。parseRakutenVariants 相当）。 */
  parseVariants: (json: Record<string, unknown>) => Variant[];
  /** 完全な ProductInput を構築（buildImportedProduct("rakuten", ...) 相当）。 */
  buildImported: (code: string, parsed: Partial<ProductInput>) => BuildImportedResult;
  /** 楽天ジャンルID → Yahoo カテゴリ（null=未解決。fetchYahooCategoryMapping 相当）。 */
  resolveCategory: (genreId: string) => Promise<YahooCategoryMapping | null>;
  /** 既存アプリ商品の照合（管理番号→ne_code）。あれば二重作成しない（AC-007）。 */
  findExisting: (manageNumber: string, neCode: string) => Promise<{ id: string } | null>;
  /** 新規作成（upsertProduct 相当）。dry-run では呼ばない。 */
  upsert: (product: ProductInput) => Promise<{ id: string }>;
  /** Yahoo editItem パラメータ生成（buildYahooEditItemParams 相当・純粋）。 */
  buildYahooParams: (
    product: ProductInput,
    opts: { forUpdate: boolean; forceDisplay?: string },
  ) => Record<string, string>;
  /** Yahoo 必須項目検証（validateEditItemParams 相当・純粋）。 */
  validateYahoo: (params: Record<string, string>) => YahooValidation;
  /** Yahoo editItem 実行（editItem 相当）。dry-run では呼ばない。 */
  editYahoo: (params: Record<string, string>) => Promise<EditItemResult>;
  /** 画像同期（任意・ベストエフォート）。display=0 のため失敗しても移行自体は成功扱い。 */
  syncImage?: (productId: string, product: ProductInput) => Promise<{ ok: boolean; error?: string }>;
  /** 操作履歴の記録（任意）。 */
  recordHistory?: (
    action: "create" | "edit",
    productId: string,
    detail: Record<string, unknown>,
  ) => Promise<void>;
};

/** 実行オプション。既定は最も安全な状態（dry-run・非公開）。 */
export type ExecutorOptions = {
  /** true=書き込みなしのプレビュー（既定）。false=実際に登録(commit)。 */
  dryRun?: boolean;
  /** true=公開相当（本セッションでは使わない）。false=安全既定(display:0)。 */
  publish?: boolean;
  /** true(既定)=既存(forUpdate)商品は display を送らず Yahoo 側の現在の表示状態を保持する
   *  （公開中商品を一括移行で勝手に非表示化しない / AC-H02）。
   *  false=従来どおり既存にも安全既定 display="0" を明示送信する。新規商品は常に "0"。 */
  preserveExistingDisplay?: boolean;
};

/** per-item 実行関数を生成するファクトリ。
 *  返した関数を runItems に渡すと、失敗継続・順序保持で一括実行できる。 */
export function makePerItemExecutor(
  deps: ExecutorDeps,
  opts: ExecutorOptions = {},
): (item: { manageNumber: string }) => Promise<MigrationItemResult> {
  const dryRun = opts.dryRun !== false; // 既定 true（安全側）
  const publish = opts.publish === true; // 既定 false
  // 既定 true: 既存(forUpdate)の公開中商品を一括移行で非表示化しない（AC-H02）。
  const preserveExistingDisplay = opts.preserveExistingDisplay !== false;
  const safe = safeStateDefaults(publish);

  return async function perItem(item: { manageNumber: string }): Promise<MigrationItemResult> {
    const manageNumber = item.manageNumber;

    // 1) 楽天取込解決（getItem → SKU 検索フォールバック）
    const resolved = await deps.resolveRakutenItem(manageNumber);
    if (!resolved) {
      return {
        manageNumber,
        step: "import",
        ok: false,
        status: "failed",
        error: `楽天に管理番号「${manageNumber}」の商品が見つかりません（管理番号・システム連携用SKU番号いずれも該当なし）`,
      };
    }
    const { json, resolvedCode } = resolved;

    // 2) パース + 多SKU検出
    const parsed = deps.parseItem(json);
    const variants = deps.parseVariants(json);
    const hasMultipleSku = variants.length > 1; // 1商品ページに複数SKU → 安全のため手動(AC-008)

    // 3) 完全な ProductInput を構築
    const built = deps.buildImported(resolvedCode, parsed);
    if (!built.ok) {
      return { manageNumber, step: "import", ok: false, status: "failed", error: built.error };
    }
    const product = built.product;
    const neCode = built.neCode;
    // Yahoo グルーピング(バリエーション)等の高度設定は自動移行で誤反映しうる → 手動(AC-008)
    const hasAdvancedYahooSettings = product.yahoo_grouping_enabled === true;

    // 4) カテゴリ解決（読み取り。null=未解決 → 誤カテゴリ登録を防ぐため手動 AC-004）
    const genreId = product.mall_category_id ?? "";
    const category = await deps.resolveCategory(genreId);
    const categoryResolved = category != null;
    if (category) {
      // 解決済み Yahoo カテゴリを商品へ反映（登録に必須）
      product.yahoo_category_id = category.yahoo_category_id;
      product.yahoo_path = category.yahoo_path;
    }

    // 5) 既存照合（読み取り。dry-run でも安全）。既存があれば作成せず尊重(AC-007)。
    const existing = await deps.findExisting(resolvedCode, neCode);
    const existed = existing != null;

    // 5b) 表示状態の決定（per-item。existed 確定後に算出）。
    // - 既存(forUpdate) かつ preserveExistingDisplay(既定): forceDisplay 不送 → Yahoo 側の
    //   現在の表示状態を保持（公開中商品を一括移行で勝手に非表示化しない / AC-H02）。
    // - 新規 or preserve=false: 安全既定 display="0"（非表示）を明示送信（AC-002）。
    // - publish 相当: display を CSV 値(=1)へ委ねるため不送（従来通り・本セッションでは未使用）。
    const forceDisplay =
      existed && preserveExistingDisplay
        ? undefined
        : safe.registerPublish
          ? undefined
          : String(safe.yahooDisplay);

    // 6) Yahoo 必須項目チェック（安全既定で params を生成して検証）
    const previewParams = deps.buildYahooParams(product, { forUpdate: existed, forceDisplay });
    const previewValid = deps.validateYahoo(previewParams);
    const missingRequiredYahooFields = previewValid.ok ? [] : previewValid.missing;

    // 7) plan 判定（純関数）。requires_manual はここで確定し登録しない。
    const plan = buildItemPlan({
      manageNumber,
      existed,
      yahooCategoryResolved: categoryResolved,
      hasMultipleSku,
      hasAdvancedYahooSettings,
      missingRequiredYahooFields,
    });

    if (plan.action === "requires_manual") {
      return {
        manageNumber,
        productId: existing?.id,
        step: categoryResolved ? "register" : "category",
        ok: false,
        status: "requires_manual",
        error: plan.reasons.join(" / "),
      };
    }

    // 8) dry-run: 書き込みを一切行わず「移行可」として返す(AC-005)
    if (dryRun) {
      return { manageNumber, productId: existing?.id, step: "register", ok: true, status: "migrate" };
    }

    // 9) commit
    // 9a) 取込: 既存があれば作成せず既存IDを採用(AC-007)。無ければ upsert。
    let productId: string;
    if (existed) {
      productId = existing!.id;
    } else {
      const saved = await deps.upsert(product);
      productId = saved.id;
    }

    // 9b) Yahoo 登録パラメータ（安全既定 forceDisplay="0" AC-002）→ 検証 → editItem
    const editParams = deps.buildYahooParams(product, { forUpdate: existed, forceDisplay });
    const valid = deps.validateYahoo(editParams);
    if (!valid.ok) {
      return {
        manageNumber,
        productId,
        step: "register",
        ok: false,
        status: "failed",
        error: "Yahoo必須項目が不足: " + valid.missing.join(", "),
      };
    }
    const edit = await deps.editYahoo(editParams);
    if (!edit.ok) {
      return {
        manageNumber,
        productId,
        step: "register",
        ok: false,
        status: "failed",
        error: "Yahoo登録(editItem)失敗: " + edit.message,
      };
    }

    // 9c) 画像同期（ベストエフォート。display=0 で非公開のため失敗しても移行は成功扱い）
    let imageNote: string | undefined;
    if (deps.syncImage) {
      try {
        const img = await deps.syncImage(productId, product);
        if (!img.ok) imageNote = img.error;
      } catch (e) {
        imageNote = e instanceof Error ? e.message : String(e);
      }
    }

    // 9d) 履歴記録（公開(submitItem)は呼ばない＝安全側）
    if (deps.recordHistory) {
      await deps.recordHistory(existed ? "edit" : "create", productId, {
        mall: "yahoo",
        manageNumber,
        neCode,
      });
    }

    return {
      manageNumber,
      productId,
      step: deps.syncImage ? "image" : "register",
      ok: true,
      status: "ok",
      error: imageNote ? "登録成功（画像同期に注意: " + imageNote + "）" : undefined,
    };
  };
}
