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
  /** Yahoo 在庫設定（setStock 相当・任意）。publish 時のみ・stockQuantity>0 のとき editItem 後に呼ぶ。 */
  setStock?: (itemCode: string, quantity: number) => Promise<{ ok: boolean; message: string }>;
  /** Yahoo 公開反映（submitItem 相当・任意）。publish 時のみ editItem(+setStock) 後に呼ぶ。 */
  submitYahoo?: (itemCode: string) => Promise<{ ok: boolean; message: string }>;
  /** 画像同期（任意・ベストエフォート）。editItem の前に実行し、lib アップロード成功画像のみで
   *  item_image_urls を再構築する（it-14091 本解消）。
   *  後方互換: 戻り値 `uploaded`(アップロード成功した画像 index 群) は任意。未指定なら従来挙動
   *  （item_image_urls を上書きせず、!ok を画像注意としてのみ surface）。 */
  syncImage?: (
    productId: string,
    product: ProductInput,
  ) => Promise<{ ok: boolean; error?: string; uploaded?: number[] }>;
  /** item_image_urls の再構築（任意・A3）。アップロード成功 index 群から実 sellerId 基底の
   *  画像URL列(";"区切り)を生成する。注入時のみ editParams.item_image_urls を上書きする。 */
  buildImageUrls?: (neCode: string, indices: number[]) => string;
  /** 待機（任意・A4）。it-14091/im-02005 検知時のリトライ前待機に使う。
   *  既定は実 setTimeout。テストは no-op を注入して実時間を消費しない。 */
  sleep?: (ms: number) => Promise<void>;
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
  /** publish=true のとき設定する在庫数（setStock）。>0 のときのみ送信する。既定 0（在庫設定しない）。 */
  stockQuantity?: number;
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
  // publish 時に設定する在庫数（>0 のときのみ setStock 送信）。
  const stockQuantity =
    typeof opts.stockQuantity === "number" && opts.stockQuantity >= 0 ? Math.floor(opts.stockQuantity) : 0;
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

    // 9b) 画像同期を editItem の前に実行（A1 順序是正＝it-14091 本解消）。
    //     lib アップロード(成功 index)を先に確定し、参照先 URL(item_image_urls)を実体と一致させる。
    //     ベストエフォート（display=0 で非公開のため部分失敗は注意として surface）。
    let imageNote: string | undefined;
    let uploadedIndices: number[] | undefined; // 新 syncImage 契約のみ defined（後方互換）
    if (deps.syncImage) {
      try {
        const img = await deps.syncImage(productId, product);
        if (!img.ok) imageNote = img.error;
        uploadedIndices = img.uploaded;
      } catch (e) {
        imageNote = e instanceof Error ? e.message : String(e);
        uploadedIndices = []; // 例外時は成功0扱い（壊れURLで登録しない）
      }
    }

    // 期待画像枚数（>=1 なら転送対象あり）。全失敗判定の基準に使う。
    const expectedImages = Math.max(0, Math.floor(product.image_count || 0));

    // 9c) Yahoo 登録パラメータ生成（安全既定 forceDisplay="0" AC-002）。
    const editParams = deps.buildYahooParams(product, { forUpdate: existed, forceDisplay });

    // 9c-0) publish(公開で登録): display="1" を明示送信する。
    //   forceDisplay は既存テスト(publish時 undefined)を尊重して触らず、最終 params 側で表示=表示にする。
    if (publish) editParams.display = "1";

    // 9c-1) アップロード結果駆動で item_image_urls を再構築（A2/A3）。
    //   - 対象画像があったのに uploaded が空 → 壊れURLで登録せず failed（it-14091 再発防止）。
    //   - buildImageUrls 注入時のみ、成功 index のみで item_image_urls を上書き（未注入=後方互換）。
    if (deps.syncImage && uploadedIndices !== undefined) {
      if (expectedImages >= 1 && uploadedIndices.length === 0) {
        return {
          manageNumber,
          productId,
          step: "image",
          ok: false,
          status: "failed",
          error:
            "画像アップロードに全て失敗（it-14091 再発防止のため登録中止）" +
            (imageNote ? ": " + imageNote : ""),
        };
      }
      if (deps.buildImageUrls) {
        if (uploadedIndices.length > 0) {
          editParams.item_image_urls = deps.buildImageUrls(product.ne_code, uploadedIndices);
        } else {
          delete editParams.item_image_urls; // 画像0枚（対象なし）は送らない
        }
      }
    }

    // 9c-2) 検証 → editItem（it-14091/im-02005 は伝播遅延の可能性 → 短い待機後1回だけリトライ A4）
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
    let edit = await deps.editYahoo(editParams);
    if (!edit.ok && isImagePropagationError(edit)) {
      const sleep = deps.sleep ?? defaultSleep;
      await sleep(EDIT_RETRY_DELAY_MS);
      edit = await deps.editYahoo(editParams);
    }
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

    // editItem 成功時の警告(it-14091 等)を結果へ surface（無検知防止 A2）。
    const editWarnNote =
      edit.warnings && edit.warnings.length ? "editItem警告: " + edit.warnings.join(" / ") : undefined;

    // 9c-3) publish(公開で登録): 在庫設定(setStock) → 公開反映(submitItem)。
    //   どちらもベストエフォート。失敗は登録自体を失敗扱いにせず注意として surface し、
    //   利用者がその商品だけ対処できるようにする（display=1/editItem 自体は成功している）。
    const publishNotes: string[] = [];
    if (publish) {
      const itemCode = editParams.item_code;
      if (deps.setStock && stockQuantity > 0) {
        const st = await deps.setStock(itemCode, stockQuantity);
        if (!st.ok) publishNotes.push("在庫設定(setStock)失敗: " + st.message);
      }
      if (deps.submitYahoo) {
        const sub = await deps.submitYahoo(itemCode);
        if (!sub.ok) publishNotes.push("公開反映(submitItem)失敗: " + sub.message);
      }
    }

    // 9d) 履歴記録（publish 時は公開反映まで実施した旨を記録）
    if (deps.recordHistory) {
      await deps.recordHistory(existed ? "edit" : "create", productId, {
        mall: "yahoo",
        manageNumber,
        neCode,
        published: publish,
        stockQuantity: publish ? stockQuantity : undefined,
      });
    }

    const notes = [
      imageNote ? "画像同期に注意: " + imageNote : undefined,
      editWarnNote,
      ...publishNotes,
    ].filter((n): n is string => Boolean(n));

    return {
      manageNumber,
      productId,
      step: deps.syncImage ? "image" : "register",
      ok: true,
      status: "ok",
      error: notes.length ? "登録成功（" + notes.join(" / ") + "）" : undefined,
    };
  };
}

/** editItem の失敗が画像紐づけ未伝播(it-14091)・画像未存在(im-02005)に該当するか。
 *  lib アップロード直後の伝播ラグで一過性に出ることがあるため、短い待機後の1回リトライ対象にする。 */
function isImagePropagationError(edit: EditItemResult): boolean {
  if (edit.ok) return false;
  const hay = [edit.message, ...(edit.errors ?? [])].join(" ").toLowerCase();
  return hay.includes("it-14091") || hay.includes("im-02005");
}

/** A4 リトライ前の既定待機(ms)。テストは deps.sleep を no-op 注入して実時間を消費しない。 */
const EDIT_RETRY_DELAY_MS = 1500;
const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
