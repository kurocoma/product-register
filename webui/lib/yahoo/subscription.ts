/** Yahoo!ショッピング 定期購入（editItem subscription_* 5項目）の送信前検証。
 *
 * 資料: obsidian 50-api-manual/yahoo-subscription-product-registration.md §5〜7
 * （it-14093〜14180 系エラーを実送信前に日本語で検出する）。
 *
 * 検証対象は「送信パラメータ」（税込変換・型変換の済んだ最終形）。ProductInput でなく
 * パラメータを見ることで、単一/分割(split)/統合(unified)/migrate の全経路を同じ一箇所で
 * 検証できる（validateEditItemParams から呼ばれるため dry-run と commit の両方で走る）。
 *
 * 検証しない項目（パラメータに現れない・書式が実機未確認のもの）:
 * - LINE出品(it-14096)・店頭在庫(it-14098/14112)・発売日が未来(it-14097) — editItem パラメータ
 *   からは判定できない/日付書式が実機未確認のため、Yahoo 側エラーに委ねる（安全側=送信は止めない
 *   がアプリからこれらを設定する経路自体が無い）。
 * - group 番号の実在(it-14114) — ストアクリエイタPro の登録状況は API から取れないため値域のみ検証。 */

/** editItem の定期購入関連パラメータ（type 以外の4項目）。type=0 では送ってはならない。 */
export const YAHOO_SUBSCRIPTION_RELATED_PARAMS = [
  "subscription_price",
  "subscription_group_index",
  "subscription_recommended_cycle",
  "subscription_point_code",
] as const;

export type YahooSubscriptionValidation = { ok: true } | { ok: false; errors: string[] };

export function validateYahooSubscription(params: Record<string, string>): YahooSubscriptionValidation {
  const errors: string[] = [];
  const type = params.subscription_type;

  // --- type=0（設定なし/無効化）または未設定: 関連4項目を送ってはならない ---
  // getItem の現在値をそのままラウンドトリップして type だけ 0 にすると group/cycle/point が
  // 残り it-14107/14110/14123 になる（資料§5「定期購入を無効化するとき」）。
  if (type == null || type === "" || type === "0") {
    for (const k of YAHOO_SUBSCRIPTION_RELATED_PARAMS) {
      const v = params[k];
      if (v != null && v !== "") {
        errors.push(
          `定期購入なし（subscription_type=0）では ${k} を送信できません（it-14107/14110/14123 対策: 無効化時は関連項目を削除してください）`,
        );
      }
    }
    return errors.length === 0 ? { ok: true } : { ok: false, errors };
  }

  if (type !== "1" && type !== "2") {
    return {
      ok: false,
      errors: [`定期購入区分（subscription_type）は 0/1/2 のいずれかで指定してください: 「${type}」（it-14093）`],
    };
  }

  // --- 定期購入価格: type1/2 で必須・整数 1〜99,999,999 円（it-14099〜14101） ---
  const priceRaw = params.subscription_price;
  const price = Number(priceRaw);
  const priceValid = priceRaw != null && priceRaw !== "" && /^\d+$/.test(priceRaw) && price >= 1 && price <= 99_999_999;
  if (priceRaw == null || priceRaw === "") {
    errors.push("定期購入価格（subscription_price）が未設定です。定期購入（type 1/2）では必須です（it-14100）");
  } else if (!priceValid) {
    errors.push(`定期購入価格は 1〜99,999,999 円の整数で指定してください: 「${priceRaw}」（it-14099/14101）`);
  }

  // --- 通常販売価格との関係（it-14104/14105） ---
  // price / subscription_price はともに税込変換済みの送信値 = 同一の税基準で比較できる。
  const normal = Number(params.price);
  if (priceValid && params.price != null && params.price !== "" && Number.isFinite(normal)) {
    if (type === "1" && price > normal) {
      errors.push(`定期購入価格（${price}円）は通常販売価格（${normal}円）以下にしてください（it-14104）`);
    }
    if (type === "2" && price !== normal) {
      errors.push(
        `「定期購入のみ」（type=2）では定期購入価格（${price}円）と通常販売価格（${normal}円）を同額にしてください（it-14105）`,
      );
    }
  }

  // --- LYPプレミアム会員価格との関係 ---
  // type=1: 会員価格があれば定期価格はそれ以下（資料§5）。type=2: 会員価格との併用自体が不可（it-14103）。
  const member = Number(params.member_price);
  if (params.member_price != null && params.member_price !== "" && Number.isFinite(member)) {
    if (type === "1" && priceValid && price > member) {
      errors.push(`定期購入価格（${price}円）はLYPプレミアム会員価格（${member}円）以下にしてください`);
    }
    if (type === "2") {
      errors.push("「定期購入のみ」（type=2）はLYPプレミアム会員価格（member_price）と併用できません（it-14103）");
    }
  }

  // --- セール価格: type=2 では併用不可（it-14102） ---
  if (type === "2" && params.sale_price != null && params.sale_price !== "") {
    errors.push("「定期購入のみ」（type=2）はセール価格（sale_price）と併用できません（it-14102）");
  }

  // --- グループ管理番号: type1/2 で必須・1〜20（it-14106〜14109） ---
  const groupRaw = params.subscription_group_index;
  const group = Number(groupRaw);
  if (groupRaw == null || groupRaw === "") {
    errors.push(
      "定期購入グループ管理番号（subscription_group_index）が未設定です。定期購入（type 1/2）では必須です（it-14106）",
    );
  } else if (!/^\d+$/.test(groupRaw) || group < 1 || group > 20) {
    errors.push(
      `定期購入グループ管理番号は 1〜20（ストアクリエイタProで作成済みの番号）で指定してください: 「${groupRaw}」（it-14108/14109）`,
    );
  }

  // --- おすすめサイクル: 任意。"0"（設定なし）/ "1:日数(10〜90)" / "2:月数(1〜6)"（it-14111） ---
  const cycle = params.subscription_recommended_cycle;
  if (cycle != null && cycle !== "" && cycle !== "0") {
    const m = cycle.match(/^([12]):(\d+)$/);
    if (!m) {
      errors.push(
        `おすすめサイクルの書式が不正です: 「${cycle}」（0=設定なし / 1:日数 / 2:月数。例 1:30=30日ごと・2:1=1か月ごと。it-14111）`,
      );
    } else if (m[1] === "1" && (Number(m[2]) < 10 || Number(m[2]) > 90)) {
      errors.push(`おすすめサイクル（日ごと）は 10〜90 日で指定してください: 「${cycle}」（it-14111）`);
    } else if (m[1] === "2" && (Number(m[2]) < 1 || Number(m[2]) > 6)) {
      errors.push(`おすすめサイクル（月ごと）は 1〜6 か月で指定してください: 「${cycle}」（it-14111）`);
    }
  }

  // --- ポイント倍率: 任意。送る場合のみ 1〜15（0=未設定はパラメータ自体を省略。it-14126） ---
  const pointRaw = params.subscription_point_code;
  if (pointRaw != null && pointRaw !== "") {
    const point = Number(pointRaw);
    if (!/^\d+$/.test(pointRaw) || point < 1 || point > 15) {
      errors.push(
        `定期購入ポイント倍率は 1〜15 で指定してください（0=未設定の場合はパラメータを送らない）: 「${pointRaw}」（it-14123/14126）`,
      );
    }
  }

  // --- 併用不可: サブコード別の個別商品価格（it-14180） ---
  // unified バリエーションで SKU 間の価格が異なると subcode_param に "price:" が載る
  // （lib/yahoo/variation-params.ts）。個別商品価格を利用中の商品は定期購入不可（資料§6）。
  // split 分割商品は subcode_param を持たない（商品ごとに別 item_code）ため対象外 = 分割商品ごとに設定可能なまま。
  if (params.subcode_param && /(^|\|)[^=|]+=price:/.test(params.subcode_param)) {
    errors.push(
      "サブコード別の個別商品価格と定期購入は併用できません（it-14180）。統合(unified)バリエーションで定期購入する場合は全SKUを同一価格にするか、分割(split)方式にしてください",
    );
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
