// 一括ツール（機能2・3）の設計判断プローブ（zzz 商品のみ・後始末込み）。
// 確認事項:
//  P1: productDescription.pc / .sp に HTML コメント（<!--PR_NOTICE_START:xxx-->）を含めて
//      patch できるか・items.get 読み戻しでコメントが保持されるか（機能2のマーカー方式の採否）。
//  P2: title（商品名）の上限カウント基準。仕様表は Max Byte 255（docs/楽天/items.upsert.txt L32）。
//      全角127字（2バイト計上なら254バイト=OK / UTF-8計上なら381バイト=NG）と全角128字（256バイト=NG）を
//      送信して、どちらの基準かを実測で確定する（機能3の楽天レギュレーションチェック用）。
// 実行: cd webui && npx tsx tests/bulk_tools_probe_sp_comment.mjs
import { readFileSync } from "node:fs";
import { getRakutenCredentialsFromEnv } from "../lib/rakuten/credentials.ts";
import { getItem, upsertItem, patchItem, deleteItem } from "../lib/rakuten/item-client.ts";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
for (const l of env.split("\n")) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) process.env[m[1]] = m[2].trim(); }
const cred = getRakutenCredentialsFromEnv();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const MN = "zzz-bulk-9993";

// 前回の残骸を後始末
{
  const d = await deleteItem(cred, MN);
  console.log(`cleanup(before) ${MN}: ${d.status}`);
  await sleep(600);
}

const up = await upsertItem(cred, MN, {
  title: "一括ツール調査", itemType: "NORMAL", genreId: "553575", hideItem: true,
  payment: { taxIncluded: false, taxRate: "0.08" },
  productDescription: { pc: "PC説明ベース", sp: "SP説明ベース" },
  variants: { v1: { standardPrice: "1000", articleNumber: { exemptionReason: 3 }, shipping: { postageIncluded: true },
    attributes: [{ name: "メーカー型番", values: ["X"] }, { name: "タイトル", values: ["Y"] }, { name: "発売元", values: ["Z"] }] } },
});
console.log(`upsert: ${up.status} ${up.ok ? "" : up.message}`);
await sleep(600);

// P1: HTML コメント入り説明文の patch
const MARK = "<!--PR_NOTICE_START:a1b2c3-->お知らせ本文<br>2行目<!--PR_NOTICE_END:a1b2c3-->";
const p1 = await patchItem(cred, MN, {
  productDescription: { pc: `${MARK}\nPC説明ベース`, sp: `SP説明ベース\n${MARK}` },
});
console.log(`P1 patch(comment in pc/sp): ${p1.status} ${p1.ok ? "OK" : p1.message}`);
await sleep(1200);
{
  const g = await getItem(cred, MN);
  const pc = g.json?.productDescription?.pc ?? "";
  const sp = g.json?.productDescription?.sp ?? "";
  console.log(`P1 readback pc has START comment: ${pc.includes("<!--PR_NOTICE_START:a1b2c3-->")}`);
  console.log(`P1 readback sp has START comment: ${sp.includes("<!--PR_NOTICE_START:a1b2c3-->")}`);
  console.log(`P1 pc=${JSON.stringify(pc)}`);
  console.log(`P1 sp=${JSON.stringify(sp)}`);
}
await sleep(600);

// P2: 商品名の上限カウント基準（全角127字 → 2バイト計上なら254バイトでOK）
const t127 = "あ".repeat(127);
const p2a = await patchItem(cred, MN, { title: t127 });
console.log(`P2 title 全角127字: ${p2a.status} ${p2a.ok ? "OK" : p2a.message}`);
await sleep(600);
const t128 = "あ".repeat(128);
const p2b = await patchItem(cred, MN, { title: t128 });
console.log(`P2 title 全角128字: ${p2b.status} ${p2b.ok ? "OK(想定外)" : "NG: " + p2b.message}`);
await sleep(600);
// 半角255字（1バイト計上なら255バイト=OK）
const t255h = "a".repeat(255);
const p2c = await patchItem(cred, MN, { title: t255h });
console.log(`P2 title 半角255字: ${p2c.status} ${p2c.ok ? "OK" : "NG: " + p2c.message}`);
await sleep(600);
const t256h = "a".repeat(256);
const p2d = await patchItem(cred, MN, { title: t256h });
console.log(`P2 title 半角256字: ${p2d.status} ${p2d.ok ? "OK(想定外)" : "NG: " + p2d.message}`);
await sleep(600);

const d = await deleteItem(cred, MN);
console.log(`cleanup(after): ${d.status}`);
