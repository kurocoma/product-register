import type { ProductInput } from "@/lib/product/schema";
import { YahooConverter } from "@/lib/converters/yahoo";
import {
  fullWidthLen,
  fitFullWidth,
  fitFullWidthAndChars,
  stripHtml,
  htmlToPlainText,
} from "@/lib/product/text-fit";
import { sanitizeYahooHtml } from "@/lib/product/html-sanitize";

/** editItem に存在せず CSV 専用の列（送らない）。docs/Yahoo/02 で確認済み。 */
const CSV_ONLY = new Set(["pr-rate", "sort_priority"]);

/** editItem の必須 form パラメータ（seller_id を除く）。 */
export const YAHOO_REQUIRED = ["item_code", "path", "name", "product_category", "price"] as const;

/** editItem フィールド→全角上限の表（docs/Yahoo/02 が authoritative）。
 * 全角=1・半角=0.5。
 * - `html: true` … HTML 不可フィールド（タグを除去してから文字数を数える）。
 * - `html: "br-to-space"` … `<br>` を空白へ変換しつつ他タグを除去（区切りを空白で保持）。name 用。
 * - `html: "sanitize"` … HTML 可フィールド（書式保持サニタイズ＝危険タグ除去・タグ閉じ補完・
 *   タグ境界保持で全角 max へ切詰）。caption/abstract/additional1-3/sp_additional 用。
 * - `maxChars` … コードポイント数の上限（指定時は全角換算上限 max と二重で適用）。
 *   各文字は最大でも全角1幅なので「文字数<=maxChars」を満たせば、Yahoo 側が全角=1で数えても
 *   換算長<=maxChars を構造的に保証できる（自前カウントと Yahoo 実カウントの差を吸収）。
 * キーは editItem パラメータ名（toParamKey 後＝ハイフン→アンダースコア）。
 * path は階層構造のため別表（YAHOO_PATH_*）で扱う。 */
type FieldLimit = { max: number; html?: boolean | "br-to-space" | "sanitize"; maxChars?: number };
export const YAHOO_FIELD_LIMITS: Record<string, FieldLimit> = {
  name: { max: 75, html: "br-to-space", maxChars: 75 },
  headline: { max: 30, html: true },
  explanation: { max: 500, html: true },
  abstract: { max: 500, html: "sanitize" },
  caption: { max: 5000, html: "sanitize" },
  additional1: { max: 5000, html: "sanitize" },
  additional2: { max: 5000, html: "sanitize" },
  additional3: { max: 5000, html: "sanitize" },
  sp_additional: { max: 5000, html: "sanitize" },
  meta_desc: { max: 80 },
  variation1_name: { max: 28 },
  variation2_name: { max: 28 },
  variation3_name: { max: 28 },
  variation4_name: { max: 28 },
  variation5_name: { max: 28 },
};

/** path（ストアカテゴリパス）の制約: コロン区切り・各カテゴリ名 全角20・8階層以内。 */
const YAHOO_PATH_SEGMENT_MAX = 20;
const YAHOO_PATH_MAX_DEPTH = 8;
/** path の入力で許容する区切り（":" / ">" / "›" / "＞"・前後空白可）。出力は ":" 区切りへ正規化する。 */
const YAHOO_PATH_SEPARATOR = /\s*[:>›＞]\s*/;
/** 文字数検証で「空は不可」とする必須テキスト項目。 */
const YAHOO_NONEMPTY_REQUIRED = ["path", "name", "product_category"] as const;

function fitYahooField(value: string, limit: FieldLimit): string {
  // HTML 可フィールドは書式保持サニタイズ（危険タグ除去＋タグ閉じ補完＋タグ境界保持切詰）。
  if (limit.html === "sanitize") return sanitizeYahooHtml(value, limit.max);
  let base = value;
  if (limit.html === "br-to-space") base = htmlToPlainText(value);
  else if (limit.html) base = stripHtml(value);
  if (limit.maxChars != null) return fitFullWidthAndChars(base, limit.max, limit.maxChars);
  return fitFullWidth(base, limit.max);
}

/** path を editItem 適合形へ整形する。
 * 区切りを検出して分割→各カテゴリ名を全角20へ切詰→先頭8階層→":" で連結。 */
export function fitYahooPath(path: string): string {
  return path
    .split(YAHOO_PATH_SEPARATOR)
    .map((seg) => seg.trim())
    .filter((seg) => seg !== "")
    .slice(0, YAHOO_PATH_MAX_DEPTH)
    .map((seg) => fitFullWidth(seg, YAHOO_PATH_SEGMENT_MAX))
    .join(":");
}

/** 各フィールドを Yahoo editItem の上限へ適合整形する（上限内の値は無変更）。
 * HTML 不可フィールドはタグ除去後に切詰。path は専用整形。 */
export function fitYahooFieldLimits(params: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = { ...params };
  for (const [key, limit] of Object.entries(YAHOO_FIELD_LIMITS)) {
    const v = out[key];
    if (v == null || v === "") continue;
    out[key] = fitYahooField(v, limit);
  }
  if (out.path != null && out.path !== "") {
    out.path = fitYahooPath(out.path);
  }
  return out;
}

/** 文字数オーバーで切り詰められる項目（警告モーダル用）。
 *  original=HTML処理後の元テキスト（利用者がリライトする対象）、fitted=切詰後プレビュー。
 *  charLen/maxChars: name は全角換算(max)に加えコードポイント数(maxChars)でも切るため、
 *  「全角換算はOKなのに文字数超過で切られる」ケースを UI が正しく示せるよう両方を露出する。 */
export type YahooTruncation = {
  field: "name" | "headline" | "explanation";
  label: string;
  limit: number;
  fullWidthLen: number;
  charLen: number;
  maxChars?: number;
  original: string;
  fitted: string;
};

const TRUNCATION_TARGETS: { field: YahooTruncation["field"]; label: string }[] = [
  { field: "name", label: "商品名" },
  { field: "headline", label: "キャッチコピー" },
  { field: "explanation", label: "商品情報(説明)" },
];

/** 商品が Yahoo 登録時に文字数上限で切り詰められる項目を検出する（dry-run の警告用）。
 *  YahooConverter の整形前出力を上限と比較し、超過項目を元テキスト/切詰後つきで返す。 */
export function detectYahooTruncations(p: ProductInput): YahooTruncation[] {
  const row = new YahooConverter().convert([p])[0];
  const out: YahooTruncation[] = [];
  for (const { field, label } of TRUNCATION_TARGETS) {
    const limit = YAHOO_FIELD_LIMITS[field];
    const raw = row[field];
    if (!limit || raw == null || raw === "") continue;
    const base =
      limit.html === "br-to-space" ? htmlToPlainText(raw) : limit.html ? stripHtml(raw) : raw;
    const len = fullWidthLen(base);
    const charLen = [...base].length;
    const overByLen = len > limit.max;
    const overByChars = limit.maxChars != null && charLen > limit.maxChars;
    if (overByLen || overByChars) {
      out.push({
        field,
        label,
        limit: limit.max,
        fullWidthLen: len,
        charLen,
        maxChars: limit.maxChars,
        original: base,
        fitted: fitYahooField(raw, limit),
      });
    }
  }
  return out;
}

/** リライトUIのライブカウンタ用: 値を送信時と同じ前処理（<br>→空白/タグ除去）で数え、
 *  全角換算(max)・文字数(maxChars)の両上限に対する超過を判定する純関数。
 *  UI がここを使う限り「表示上OKなのに送信時に切られる」不一致は起きない。 */
export function countYahooField(
  field: string,
  value: string,
): {
  fullWidth: number;
  chars: number;
  limit: number;
  maxChars?: number;
  overWidth: boolean;
  overChars: boolean;
  over: boolean;
} {
  const limit = YAHOO_FIELD_LIMITS[field];
  if (!limit) {
    // 未知フィールドは判定不能 → 超過なし扱い（UI を壊さない安全側）。
    return {
      fullWidth: fullWidthLen(value),
      chars: [...value].length,
      limit: Infinity,
      maxChars: undefined,
      overWidth: false,
      overChars: false,
      over: false,
    };
  }
  const base =
    limit.html === "br-to-space" ? htmlToPlainText(value) : limit.html ? stripHtml(value) : value;
  const fullWidth = fullWidthLen(base);
  const chars = [...base].length;
  const overWidth = fullWidth > limit.max;
  const overChars = limit.maxChars != null && chars > limit.maxChars;
  return {
    fullWidth,
    chars,
    limit: limit.max,
    maxChars: limit.maxChars,
    overWidth,
    overChars,
    over: overWidth || overChars,
  };
}

/** 整形後でも上限超過・必須空が残っていないか検証する（dry-run 事前検知用）。
 * 通常は fitYahooFieldLimits 適用後に呼ぶため違反は出ないが、必須が空のままなど
 * 整形では適合できないケースを surface するための honest なチェック。 */
export function validateYahooFieldLimits(
  params: Record<string, string>,
): { ok: true } | { ok: false; violations: string[] } {
  const violations: string[] = [];

  for (const k of YAHOO_NONEMPTY_REQUIRED) {
    const v = params[k];
    if (v == null || v.trim() === "") violations.push(`${k} が空です`);
  }

  for (const [key, limit] of Object.entries(YAHOO_FIELD_LIMITS)) {
    const v = params[key];
    if (v == null || v === "") continue;
    const base = limit.html ? stripHtml(v) : v;
    if (fullWidthLen(base) > limit.max) {
      violations.push(`${key} が全角${limit.max}を超過`);
    }
  }

  const path = params.path;
  if (path != null && path !== "") {
    const segs = path.split(":");
    if (segs.length > YAHOO_PATH_MAX_DEPTH) {
      violations.push(`path の階層が${YAHOO_PATH_MAX_DEPTH}を超過`);
    }
    for (const seg of segs) {
      if (fullWidthLen(seg) > YAHOO_PATH_SEGMENT_MAX) {
        violations.push(`path カテゴリ名「${seg}」が全角${YAHOO_PATH_SEGMENT_MAX}を超過`);
        break;
      }
    }
  }

  return violations.length === 0 ? { ok: true } : { ok: false, violations };
}

/** CSV 列キー → editItem パラメータ名へ変換（ハイフン→アンダースコア、code→item_code）。 */
function toParamKey(csvKey: string): string {
  if (csvKey === "code") return "item_code";
  return csvKey.replace(/-/g, "_");
}

export type BuildEditItemOptions = {
  sellerId: string;
  /** 更新時 true。display を送らず既存の公開/非公開状態を保持する（誤公開防止）。 */
  forUpdate?: boolean;
  /** テスト用に display を明示指定（"0"=非公開）。forUpdate より優先。 */
  forceDisplay?: string;
};

/** ProductInput → editItem の form パラメータ。
 * フィールド値は既存 YahooConverter（CSVと同一ロジック・検証済み）を再利用して算出する。 */
export function buildYahooEditItemParams(
  p: ProductInput,
  opts: BuildEditItemOptions,
): Record<string, string> {
  const row = new YahooConverter().convert([p])[0];
  const params: Record<string, string> = { seller_id: opts.sellerId };

  for (const [csvKey, value] of Object.entries(row)) {
    if (CSV_ONLY.has(csvKey)) continue;
    if (value === "" || value == null) continue; // 空は送らない（既定値での意図しない上書きを避ける）
    params[toParamKey(csvKey)] = value;
  }

  // display の扱い: テスト指定 > 更新時は送らない > それ以外は CSV 値(公開=1)
  if (opts.forceDisplay !== undefined) {
    params.display = opts.forceDisplay;
  } else if (opts.forUpdate) {
    delete params.display;
  }

  // Yahoo editItem の各フィールド上限へ適合整形してから返す（長い name/path/explanation の拒否を防ぐ）。
  // 上限内の値は無変更（短いフィールドは出力不変）。
  return fitYahooFieldLimits(params);
}

/** 必須パラメータが揃っているか + 文字数上限に適合しているかを検証する。
 * 後方互換: 戻り値 shape は従来どおり `{ok:true} | {ok:false; missing:string[]}`。
 * 必須欠落に加え、整形後も残る文字数違反（必須空・上限超過）も missing に載せて surface する。
 * migrate は injected validateYahoo=validateEditItemParams を preview で呼ぶため、ここで
 * 文字数違反を検知すれば dry-run で requires_manual に倒せる（commit で初めて editItem 拒否されない）。 */
export function validateEditItemParams(
  params: Record<string, string>,
): { ok: true } | { ok: false; missing: string[] } {
  const missing: string[] = YAHOO_REQUIRED.filter((k) => !params[k]);
  if (!params.seller_id) missing.unshift("seller_id");

  // 文字数違反（必須空・上限超過・path 構造）も不足扱いで列挙する（重複は除く）。
  const limit = validateYahooFieldLimits(params);
  if (!limit.ok) {
    for (const v of limit.violations) {
      if (!missing.includes(v)) missing.push(v);
    }
  }

  // 値域ゲート（B1-B4）: 103件一括移行で editItem に拒否される前に、dry-run の preview
  // (executor が injected validateYahoo として本関数を呼ぶ)で requires_manual に前倒し検知する。
  // いずれも「存在するが値域外」を不足扱いで surface（空欄は上の必須チェックが拾う）。
  const add = (msg: string) => {
    if (!missing.includes(msg)) missing.push(msg);
  };

  // B1 price: 整数 1〜99,999,999（0/非数値/小数/範囲外は不可。it-01023 前倒し）。
  const price = params.price;
  if (price != null && price !== "") {
    const n = Number(price);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1 || n > 99_999_999) {
      add("price が範囲外（整数 1〜99,999,999）");
    }
  }

  // B2 item_code: 半角英数とハイフンのみ・99文字以内（"_"等は不可。it-01004 前倒し）。
  const itemCode = params.item_code;
  if (itemCode != null && itemCode !== "") {
    if (!/^[A-Za-z0-9-]+$/.test(itemCode) || itemCode.length > 99) {
      add("item_code の書式不正（半角英数とハイフン・99文字以内）");
    }
  }

  // B3 product_category: 数字 1〜10 桁（カテゴリID。it-01089 系 前倒し）。
  const productCategory = params.product_category;
  if (productCategory != null && productCategory !== "") {
    if (!/^[0-9]{1,10}$/.test(productCategory)) {
      add("product_category の書式不正（数字 1〜10 桁）");
    }
  }

  return missing.length === 0 ? { ok: true } : { ok: false, missing };
}
