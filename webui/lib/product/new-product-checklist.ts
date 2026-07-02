/** 新規商品登録の「必須項目チェック / 登録ステップ」の判定ロジック（純関数・テスト対象）。
 * 必須の定義は二重管理しない:
 * - 保存の必須 = validateForSave（NEコード）を単一の源泉として再利用
 * - モール登録の必須 = 楽天 validateUpsertBody(title/genreId/price) と
 *   Yahoo validateEditItemParams(name/path/product_category/price) が最終判定。
 *   ここでは入力段階でその代表項目を非エンジニア向けの日本語で案内する。 */

import type { ProductInput } from "@/lib/product/schema";
import { mallPresence } from "@/lib/product/schema";
import { validateForSave } from "@/lib/product/repository";

/** 新規ページの JAN 初期値（未入力扱いにするプレースホルダ）。 */
export const JAN_PLACEHOLDER = "0000000000000";

export type ChecklistItem = {
  key: string;
  /** 登録ステップ番号: 1=基本情報 / 2=価格 / 3=カテゴリ・属性 / 4=画像 */
  step: 1 | 2 | 3 | 4;
  label: string;
  done: boolean;
  /** モール登録に進むために必須か（false は推奨・任意）。 */
  required: boolean;
  hint?: string;
};

/** 新規商品の入力チェックリスト。フォーム入力値から各項目の充足を判定する。 */
export function newProductChecklist(p: ProductInput): ChecklistItem[] {
  return [
    {
      key: "ne_code",
      step: 1,
      label: "NEコード",
      done: p.ne_code.trim() !== "",
      required: true,
      hint: "商品ごとに一意の管理コード。入力すると自動保存が始まります",
    },
    {
      key: "product_name",
      step: 1,
      label: "商品名（NE用）",
      done: p.product_name.trim() !== "",
      required: true,
    },
    {
      key: "display_name",
      step: 1,
      label: "掲載商品名（モール用）",
      done: p.display_name.trim() !== "",
      required: true,
      hint: "楽天・Yahooの商品ページに表示される名前です",
    },
    {
      key: "jan_code",
      step: 1,
      label: "JANコード（13桁）",
      done: /^\d{13}$/.test(p.jan_code) && p.jan_code !== JAN_PLACEHOLDER,
      required: true,
      hint: "13桁の数字。仮の 0000000000000 のままでは登録できません",
    },
    {
      key: "selling_price",
      step: 2,
      label: "販売価格",
      done: p.selling_price > 0,
      required: true,
    },
    {
      key: "mall_category_id",
      step: 3,
      label: "楽天ジャンルID（6桁）",
      done: /^\d{6}$/.test(p.mall_category_id.trim()),
      required: true,
      hint: "楽天登録に必須。ジャンルによっては「商品属性」の必須項目も補完してください",
    },
    {
      key: "yahoo_path",
      step: 3,
      label: "Yahooカテゴリ（パス）",
      done: p.yahoo_path.trim() !== "",
      required: false,
      hint: "Yahooに登録する場合は必須（楽天のみなら後回しでも可）",
    },
    {
      key: "image_url_1",
      step: 4,
      label: "商品画像（1枚目）",
      done: p.image_url_1.trim() !== "",
      required: false,
      hint: "任意（推奨）。保存後は画像アップロードパネルも使えます",
    },
  ];
}

/** モール登録に進むために不足している必須項目。 */
export function missingRequiredItems(p: ProductInput): ChecklistItem[] {
  return newProductChecklist(p).filter((i) => i.required && !i.done);
}

/** 新規商品の自動保存を開始してよいか。
 * 保存の必須要件（validateForSave = NEコード）を単一の源泉として使う。
 * NEコードが空のまま自動保存してエラーを出し続ける挙動を防ぐ（既存商品の編集には影響しない）。 */
/** 登録ステップ6「モール登録」の達成判定。掲載状況の単一源泉 mallPresence
 * （mall_listed 優先・楽天は rakuten_manage_number フォールバック）に揃える。
 * どちらかのモールに掲載済みなら達成とする。 */
export function mallRegistrationDone(p: ProductInput): boolean {
  const m = mallPresence(p);
  return m.rakuten || m.yahoo;
}

export function canAutoSaveNewProduct(p: ProductInput): boolean {
  return validateForSave(p).ok;
}
