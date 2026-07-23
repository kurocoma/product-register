/** 楽天 Item API（items.patch / items.upsert）のエラー文を日本語で説明する。
 *
 * 楽天のエラーは「IE0004: Max length of variants.1177.specs[1].value must be within 140 bytes.」
 * のような英文＋内部パスで返り、原因が読み取りにくい（260723 実件）。既知コードの原因・対処と、
 * フィールドパスの和訳を付与する。コードの意味は実件・RMS仕様で確認できたものだけを載せる
 * （推測の説明を並べない）。 */

/** 既知エラーコード → 原因と対処（1行・です/ます調）。 */
const ERROR_GUIDE: Record<string, string> = {
  IE0004:
    "文字数の上限超過です。楽天は全角1文字を3バイト（UTF-8）で数えるため、見た目の文字数より早く上限に達します（例: 自由入力行の値は140バイト＝全角約46文字まで）。該当欄の文言を短くしてください",
  IE0177:
    "改行が含まれています。この欄（自由入力行の値など）に改行は入れられません。改行を削除するか「／」「、」などの区切りに置き換えてください",
  IE0418:
    "楽天のジャンル必須属性が不足しています。商品編集の「商品属性」でカテゴリIDから属性を読み込み、不足項目を入力して再度反映してください",
  IE0416:
    "既存SKUの選択肢（バリエーションの値）は楽天側で変更できません。バリエーション構成を変える場合は反映ではなく再登録を使ってください",
  IE0269:
    "バリエーション軸と各SKUの選択肢の組み合わせが楽天側の登録と合っていません。SKU構成を変えた場合は反映ではなく再登録を使ってください",
  IE0156:
    "反映（patch）ではSKUの追加を送れません。SKUを増やした場合は再登録を使ってください",
  IE0215:
    "スマートフォン用説明文に楽天が許可しないHTMLタグが含まれています（アプリの自動変換対象。最新版で再反映してください）",
  IE0218: "画像の代替テキスト（alt）にHTMLタグは使えません。タグ・山括弧を除去してください",
  IE0179: "定期購入では「お届け日付指定」「お届け間隔指定」の少なくとも一方を有効にする必要があります",
  IE0430: "定期購入価格は通常販売価格から5%以上の割引が必要です",
  IE0431: "通常販売価格が0円のSKUには定期購入を設定できません",
  IE0432: "定期購入ボタンを有効にする場合は通常購入ボタンも有効にする必要があります",
  IE0433: "定期購入を有効にする場合は全SKUに定期購入価格の設定が必要です",
  IE0434: "初回価格だけの設定はできません。定期購入価格もあわせて設定してください",
  IE0153: "送料込み設定と個別送料の組み合わせが不正です（個別送料付きSKUに送料込みは送れません）",
  GE0011: "更新内容が空のリクエストです（差分がすべてAPI反映（patch）非対応の項目だった場合に起きます。アプリ側で送信前に防止しています）",
};

/** 楽天の内部フィールドパスを画面の言葉に直す（例: variants.1177.specs[1].value → SKU 1177 の自由入力行2の値）。 */
export function translateRakutenFieldPath(path: string): string {
  let out = path;
  out = out.replace(
    /variants\.([^.\s]+)\.specs\[(\d+)\]\.(value|label)/g,
    (_m, sku, idx, field) =>
      `SKU ${sku} の自由入力行${Number(idx) + 1}の${field === "value" ? "値" : "項目名"}`,
  );
  out = out.replace(
    /variants\.([^.\s]+)\.images\[(\d+)\]\.alt/g,
    (_m, sku, idx) => `SKU ${sku} の画像${Number(idx) + 1}の代替テキスト(alt)`,
  );
  out = out.replace(/variants\.([^.\s]+)\./g, (_m, sku) => `SKU ${sku} の `);
  return out;
}

/** エラー文から既知コード・パスを拾い、日本語の説明ブロックを作る。未知のみなら空文字。 */
export function explainRakutenError(rawMessage: string): string {
  const notes: string[] = [];

  // コード別の説明（重複除去・出現順）
  const seen = new Set<string>();
  for (const m of rawMessage.matchAll(/[A-Z]E\d{4}/g)) {
    const code = m[0];
    if (seen.has(code)) continue;
    seen.add(code);
    if (ERROR_GUIDE[code]) notes.push(`${code}: ${ERROR_GUIDE[code]}`);
  }

  // 対象フィールドの和訳（specs / images alt 等を含むときだけ）
  const paths = [...new Set([...rawMessage.matchAll(/variants\.[^\s,:]+/g)].map((m) => m[0]))];
  const translated = paths
    .map((p) => ({ raw: p, ja: translateRakutenFieldPath(p) }))
    .filter((x) => x.ja !== x.raw);
  if (translated.length > 0) {
    notes.push(`対象: ${translated.map((x) => x.ja).join(" / ")}`);
  }

  if (notes.length === 0) return "";
  return "\n【原因の説明】\n" + notes.map((n) => `・${n}`).join("\n");
}
