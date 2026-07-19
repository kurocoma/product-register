import type { ProductInput, Variant } from "@/lib/product/schema";
import { resolveAttributes, productVariants, variantDisplayPrice } from "@/lib/product/schema";
import type { Converter } from "./base";
import { ENCODING } from "./base";
import { buildRakutenImgList } from "./image-url";

function leadTimeLabel(deliveryMethod: number): string {
  return `${deliveryMethod}営業日出荷`;
}

function soryo(shippingType: string): number {
  return shippingType === "送料無料" ? 1 : 0;
}

export function baseCodeOf(p: ProductInput): string {
  const maker = p.maker_code?.trim();
  const jan4 = p.jan_code.slice(-4);
  if (maker) return `${maker}-${jan4}`;
  // maker_code 空のフォールバック（r2201-1 実件）: "-1149" のような先頭ハイフン名が
  // 画像ファイル名・管理番号に使われるのを防ぐ。ne_code → item-{JAN下4桁} の順で代用。
  const ne = p.ne_code?.trim();
  return ne || `item-${jan4}`;
}

/** CSV の商品管理番号 = ページのグループキー。取込商品は実際の管理番号(rakuten_manage_number)を
 * 最優先で使い、未保存（新規登録・既存商品）は従来どおり base_code。
 * rakuten-api.ts の buildRakutenManageNumber と同じ規則（import 方向の都合でローカル実装）。
 * CSVルートの peers 絞り込みもこのキーを使う（取込商品同士の base_code 衝突「-0000」対策）。 */
export function manageNumberOf(p: ProductInput): string {
  const stored = p.rakuten_manage_number?.trim();
  return stored || baseCodeOf(p);
}

/** 全行のキーを和集合で揃え、 欠損は空文字で埋める。 行 0 のキー順を保持。 */
function normalizeRows(rows: Record<string, string>[]): Record<string, string>[] {
  if (rows.length === 0) return rows;
  const allKeys: string[] = [...Object.keys(rows[0])];
  const seen = new Set(allKeys);
  for (let i = 1; i < rows.length; i++) {
    for (const k of Object.keys(rows[i])) {
      if (!seen.has(k)) {
        allKeys.push(k);
        seen.add(k);
      }
    }
  }
  return rows.map((row) => {
    const out: Record<string, string> = {};
    for (const k of allKeys) out[k] = row[k] ?? "";
    return out;
  });
}

export class RakutenConverter implements Converter {
  mallName = "rakuten" as const;
  encoding = ENCODING.rakuten;

  convert(products: ProductInput[]): Record<string, string>[] {
    // 商品管理番号でグループ化 (挿入順保持)。取込商品は実管理番号、それ以外は base_code。
    const groups = new Map<string, ProductInput[]>();
    for (const p of products) {
      const b = manageNumberOf(p);
      if (!groups.has(b)) groups.set(b, []);
      groups.get(b)!.push(p);
    }

    const rows: Record<string, string>[] = [];
    for (const base of Array.from(groups.keys()).sort()) {
      const members = groups.get(base)!;
      // 単品を代表とする (なければ先頭)
      const rep = members.find((p) => p.is_single) ?? members[0];

      rows.push(this.buildParentRow(base, rep));
      for (const p of members) {
        // 多SKU商品は variants[] を子行に展開。フラット商品は1件合成（後方互換）。
        for (const v of productVariants(p)) {
          rows.push(this.buildChildRow(base, p, v));
        }
      }
    }
    return normalizeRows(rows);
  }

  private buildParentRow(base: string, rep: ProductInput): Record<string, string> {
    const row: Record<string, string> = {};

    row["商品管理番号（商品URL）"] = base;
    row["商品番号"] = base;
    row["商品名"] = rep.display_name;

    row["倉庫指定"] = "0";
    row["サーチ表示"] = "1";
    row["消費税"] = "0";
    row["消費税率"] = String(rep.tax_rate / 100);

    row["注文ボタン"] = "1";
    row["商品問い合わせボタン"] = "1";
    row["在庫表示"] = "-1";
    row["代引料"] = "0";

    row["ジャンルID"] = rep.mall_category_id;

    const imgList = buildRakutenImgList(base, rep.image_count);
    // PC用販売説明文: 任意入力(sale_description_pc)があればそれを、空なら画像から自動生成した imgList。
    const saleBlock = rep.sale_description_pc.trim() ? rep.sale_description_pc : imgList;
    row["キャッチコピー"] = rep.catch_copy_pc;
    row["PC用商品説明文"] = rep.description_pc;
    row["スマートフォン用商品説明文"] = saleBlock + rep.description_sp;
    row["PC用販売説明文"] = saleBlock;

    // 画像 (CABINET): 1枚目は rep.ne_code、 2枚目以降は base_code
    row["商品画像タイプ1"] = "CABINET";
    row["商品画像パス1"] = `/thum02/${rep.ne_code}.jpg`;
    for (let i = 2; i <= rep.image_count; i++) {
      row[`商品画像タイプ${i}`] = "CABINET";
      row[`商品画像パス${i}`] = `/thum02/${base}_${i}.jpg`;
    }
    for (let i = Math.max(2, rep.image_count + 1); i <= 20; i++) {
      row[`商品画像タイプ${i}`] = "";
      row[`商品画像パス${i}`] = "";
    }
    if (rep.image_count === 1) {
      for (let i = 2; i <= 20; i++) {
        row[`商品画像タイプ${i}`] = "";
        row[`商品画像パス${i}`] = "";
      }
    }

    row["白背景画像タイプ"] = "CABINET";
    row["白背景画像パス"] = `/wb01/wb-${base}.jpg`;

    row["商品情報レイアウト"] = "1";
    row["ヘッダー・フッター・レフトナビ"] = "自動選択";
    row["表示項目の並び順"] = "自動選択";
    row["共通説明文（小）"] = "自動選択";
    row["目玉商品"] = "自動選択";
    row["共通説明文（大）"] = "自動選択";
    row["レビュー本文表示"] = "2";
    row["メーカー提供情報表示"] = "1";
    row["定期購入ボタン"] = "0";

    row["バリエーション項目キー定義"] = rep.variation_key;
    row["バリエーション項目名定義"] = rep.variation_name;
    row["バリエーション1選択肢定義"] = rep.variation_choices;

    return row;
  }

  private buildChildRow(base: string, p: ProductInput, v: Variant): Record<string, string> {
    const row: Record<string, string> = {};
    const multiSku = p.variants.length > 1;

    row["商品管理番号（商品URL）"] = base;
    row["SKU管理番号"] = v.sku_manage_number;
    row["システム連携用SKU番号"] = v.ne_code;

    row["バリエーション項目キー1"] = p.variation_key;
    row["バリエーション項目選択肢1"] = v.variation_value || p.option_item_name;

    row["販売価格"] = String(v.selling_price);
    row["表示価格"] = String(variantDisplayPrice(p, v));
    row["二重価格文言管理番号"] = "1";

    row["再入荷お知らせボタン"] = "0";
    row["のし対応"] = "0";
    row["在庫数"] = "10";
    row["在庫戻しフラグ"] = "1";
    row["在庫切れ時の注文受付"] = "0";

    const label = leadTimeLabel(p.delivery_method);
    row["在庫あり時納期管理番号"] = "1";
    row["在庫切れ時納期管理番号"] = "1";
    row["在庫あり時出荷リードタイム"] = label;
    row["在庫切れ時出荷リードタイム"] = label;
    row["配送リードタイム"] = "自社倉庫";
    row["SKU倉庫指定"] = "0";
    row["送料"] = String(soryo(v.shipping_type));
    row["単品配送設定使用"] = "0";

    row["カタログID"] = v.jan_code;
    // バリエーション（SKU軸）が定義されている場合のみ SKU画像を設定する。
    // 単一SKU（バリエーションなし）に SKU画像を入れると楽天側でエラーになるため空にする。
    // 多SKU(variants 2件以上)は definition が無くてもバリエーションありとして扱う。
    const hasVariation = p.variation_key.trim() !== "" || multiSku;
    row["SKU画像タイプ"] = hasVariation ? "CABINET" : "";
    row["SKU画像パス"] = hasVariation ? `/thum02/${v.ne_code}.jpg` : "";

    // 商品属性: 値が入っている項目だけを連番で出力する（空項目は CSV に出さない）。
    // variant 側に属性があればそれを、無ければ product 側（後方互換）。
    const vAttrs = v.attributes.filter((a) => a.item.trim() !== "" && a.value.trim() !== "");
    const attrs = vAttrs.length > 0 ? vAttrs : resolveAttributes(p, { onlyWithValue: true });
    attrs.forEach((a, idx) => {
      const i = idx + 1;
      row[`商品属性（項目）${i}`] = a.item;
      row[`商品属性（値）${i}`] = a.value;
      row[`商品属性（単位）${i}`] = a.unit === "0" ? "" : a.unit;
    });
    return row;
  }
}
