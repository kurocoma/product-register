// [追加作業E] 数量違いの商品を Yahoo グルーピングIDで相互表示する（ユーザー指示 2026-07-26）。
//
// Yahoo 仕様（docs/Yahoo/04 §グルーピング）:
//   - grouping_id: 半角英数字・ハイフン 99文字以内。1グループ最大100商品。
//   - **grouping_id と variation は同時に設定する必要がある**。
//     variation1_spec_id はカテゴリのスペックIDが必要だが、フリータイトル
//     （variation1_free_title + variation1_name）でも成立する。本作業はフリータイトル方式を使う
//     （アプリの YahooConverter も同方式）。
//
// バリエーション表示名は「3袋セット」等の**商品名の実記載**から導出し、
//   - ファミリー全員の名前が導出でき、かつ全員が別名になる場合のみ適用する
//   - 1件でも導出できない/重複するファミリーは丸ごと見送り、報告に回す
// （名前が重複・不正だと商品ページの選択肢が壊れるため。判断がつかないものは実行しない方針）
//
// reservePublish は呼ばない。既に grouping_id が入っている商品は上書きしない。
// 実行: cd webui && npx tsx tests/shimanoya_yahoo_grouping.mjs   （DRY=1 で導出結果の確認のみ）
import path from "node:path";
import { getItem as getYahooItem, editItem } from "../lib/yahoo/item-client.ts";
import { xmlToEditItemParams } from "../lib/converters/yahoo-patch.ts";
import { fitYahooFieldLimits } from "../lib/yahoo/item-mapper.ts";
import {
  WORK_DIR, API_TIMEOUT_MS,
  ensureWorkDir, loadEnv, withTimeout, getAdmin, loadTargets,
  yahooAuth, writeAuthBlocked, writeJson, xmlTag, sleep, nowIso,
} from "./shimanoya_yahoo_sync_common.mjs";

loadEnv();
ensureWorkDir();

const DRY = process.env.DRY === "1";
const RESULTS_FILE = path.join(WORK_DIR, DRY ? "grouping.dryrun.json" : "grouping-results.json");
const VARIATION_TITLE = process.env.VARIATION_TITLE || "数量";

/** ユーザー指定のファミリー（数量違い）。単品商品は対象外。 */
const FAMILIES = {
  r0101: ["r0101-1", "r0101-13", "r0101-15"],
  r1101: ["r1101-1", "r1101-3", "r1101-5"],
  r113: ["r113-1", "r113-3", "r113-5"],
  r117: ["r117-1", "r117-3", "r117-5"],
  r3001: ["r3001-1", "r3001-3", "r3001-5"],
  r6190: ["r6190-1", "r6190-3", "r6190-5"],
  r6410: ["r6410-1", "r6410-2", "r6410-3", "r6410-5"],
  r6801: ["r6801-1", "r6801-3", "r6801-5"],
  r7111: ["r7111-1", "r7111-3", "r7111-5"],
  r7201: ["r7201-1", "r7201-2", "r7201-3", "r7201-5"],
  r7501: ["r7501-1", "r7501-3", "r7501-5"],
  r7801: ["r7801-1", "r7801-2", "r7801-3", "r7801-5"],
  r8389: ["r8389-1", "r8389-2", "r8389-3"],
  r8401: ["r8401-1", "r8401-3", "r8401-5"],
  r8601: ["r8601-1", "r8601-3", "r8601-5"],
  r8801: ["r8801-0", "r8801-2", "r8801-3"],
};

const ZEN2HAN = (s) => s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));

/** 商品名から「N袋セット」等の入数表記を取り出す。見つからなければ null（=単品扱いの候補）。 */
function parseSetLabel(displayName) {
  const s = ZEN2HAN(String(displayName ?? ""));
  const m = s.match(/(\d+)\s*(袋|箱|本|足|枚|個|包|缶|セット)\s*セット/)
    ?? s.match(/【\s*(\d+)\s*(袋|箱|本|足|枚|個|包|缶)\s*セット\s*】/)
    // 「30粒×3袋」形式（セットと書かずに入数を示す商品名。r6801系の実例）
    ?? s.match(/×\s*(\d+)\s*(袋|箱|本|足|枚|個|包|缶)/);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2] === "セット" ? "個" : m[2];
  if (!Number.isFinite(n) || n <= 0) return null;
  return { count: n, unit, label: `${n}${unit}セット` };
}

const admin = getAdmin();
const { found } = await loadTargets(admin);

let cfg, token;
try {
  ({ cfg, token } = await yahooAuth());
} catch (e) {
  const msg = String(e?.message ?? e);
  writeAuthBlocked("grouping", msg);
  console.error(`Yahoo認証に失敗しました。中止します。\n  ${msg}`);
  process.exit(2);
}

const families = [];
for (const [groupingId, members] of Object.entries(FAMILIES)) {
  const fam = { groupingId, members: [], status: "pending", timestamp: nowIso() };
  for (const manage of members) {
    const t = found.get(manage);
    if (!t) {
      fam.members.push({ manage, exists: false, reason: "アプリDBに該当商品がありません" });
      continue;
    }
    const itemCode = t.input.ne_code;
    let got;
    try {
      got = await withTimeout(getYahooItem(token, cfg.sellerId, itemCode), API_TIMEOUT_MS, `getItem ${itemCode}`);
    } catch (e) {
      fam.members.push({ manage, itemCode, exists: false, reason: `getItem 失敗: ${String(e?.message ?? e)}` });
      continue;
    }
    if (!got.exists) {
      fam.members.push({ manage, itemCode, exists: false, reason: "Yahooに未出品" });
      continue;
    }
    const mallName = xmlTag(got.raw, "Name");
    const existingGroupingId = xmlTag(got.raw, "GroupingId");
    const parsed = parseSetLabel(mallName) ?? parseSetLabel(t.input.display_name);
    fam.members.push({
      manage, itemCode, exists: true, mallName: mallName.slice(0, 60),
      existingGroupingId: existingGroupingId || null,
      parsed, raw: got.raw,
    });
    await sleep(150);
  }

  const live = fam.members.filter((m) => m.exists);
  if (live.length < 2) {
    fam.status = "skip";
    fam.reason = `Yahoo に出品済みの商品が ${live.length}件しかないためグルーピング不要`;
    families.push(fam);
    continue;
  }
  const alreadyGrouped = live.filter((m) => m.existingGroupingId);
  if (alreadyGrouped.length) {
    fam.status = "skip";
    fam.reason = `既に grouping_id が設定されている商品があるため上書きしません: ${alreadyGrouped.map((m) => `${m.manage}=${m.existingGroupingId}`).join(", ")}`;
    families.push(fam);
    continue;
  }

  // 入数の導出: セット表記が無い1件だけを「単品」とみなす（他メンバーの単位を借りる）。
  const withSet = live.filter((m) => m.parsed);
  const withoutSet = live.filter((m) => !m.parsed);
  const unit = withSet[0]?.parsed.unit;
  if (withoutSet.length > 1 || !unit) {
    fam.status = "skip";
    fam.reason = withoutSet.length > 1
      ? `入数表記を導出できない商品が ${withoutSet.length}件あります（${withoutSet.map((m) => m.manage).join(", ")}）。表示名が壊れるため見送り`
      : "入数の単位を導出できませんでした";
    families.push(fam);
    continue;
  }
  for (const m of withoutSet) m.parsed = { count: 1, unit, label: `1${unit}` };

  const labels = live.map((m) => m.parsed.label);
  if (new Set(labels).size !== labels.length) {
    fam.status = "skip";
    fam.reason = `バリエーション表示名が重複します（${labels.join(", ")}）。選択肢が壊れるため見送り`;
    families.push(fam);
    continue;
  }
  fam.status = "ready";
  fam.plan = live.map((m) => ({ manage: m.manage, itemCode: m.itemCode, groupingId, variationName: m.parsed.label }));
  families.push(fam);
}

console.log("=== ファミリーごとの導出結果 ===");
for (const f of families) {
  if (f.status === "ready") console.log(`  ${f.groupingId}: ${f.plan.map((p) => `${p.itemCode}="${p.variationName}"`).join(" / ")}`);
  else console.log(`  ${f.groupingId}: 見送り — ${f.reason}`);
}

const results = [];
if (!DRY) {
  for (const f of families.filter((x) => x.status === "ready")) {
    for (const p of f.plan) {
      const member = f.members.find((m) => m.manage === p.manage);
      const rec = { manage: p.manage, itemCode: p.itemCode, groupingId: p.groupingId, variationName: p.variationName, status: "ng", timestamp: nowIso() };
      try {
        const { params } = xmlToEditItemParams(member.raw, cfg.sellerId);
        params.grouping_id = p.groupingId;
        params.variation1_free_title = VARIATION_TITLE;
        params.variation1_name = p.variationName;
        const body = fitYahooFieldLimits(params);
        const r = await withTimeout(editItem(token, body), API_TIMEOUT_MS, `editItem ${p.itemCode}`);
        if (!r.ok) {
          rec.error = r.message;
          results.push(rec);
          console.log(`  ${p.itemCode} 送信NG: ${String(r.message).slice(0, 140)}`);
          continue;
        }
        await sleep(600);
        const back = await withTimeout(getYahooItem(token, cfg.sellerId, p.itemCode), API_TIMEOUT_MS, `getItem ${p.itemCode}`);
        const gid = xmlTag(back.raw, "GroupingId");
        const vname = (back.raw.match(/<Variation1>([\s\S]*?)<\/Variation1>/i) || [])[1] ?? "";
        rec.verify = { groupingId: gid, variation1: vname.replace(/\s+/g, " ").slice(0, 120) };
        rec.status = gid === p.groupingId ? "ok" : "ng";
        if (rec.status === "ng") rec.error = `読み戻しで grouping_id が一致しません（期待 ${p.groupingId} / 実際 ${gid || "(空)"}）`;
        console.log(`  ${p.itemCode} ${rec.status === "ok" ? `設定OK（${p.groupingId} / ${p.variationName}）` : rec.error}`);
      } catch (e) {
        rec.error = String(e?.message ?? e);
        console.log(`  ${p.itemCode} 例外: ${String(e?.message ?? e).slice(0, 140)}`);
      }
      results.push(rec);
      await sleep(250);
    }
  }
}

// raw XML は成果物に含めない（巨大なため）
for (const f of families) for (const m of f.members) delete m.raw;

writeJson(RESULTS_FILE, {
  ranAt: nowIso(),
  dryRun: DRY,
  reservePublish: "未実行（公開保留）",
  variationTitle: VARIATION_TITLE,
  spec: "grouping_id と variation は同時設定が必要（フリータイトル方式）。1グループ最大100商品",
  familiesReady: families.filter((f) => f.status === "ready").length,
  familiesSkipped: families.filter((f) => f.status !== "ready").length,
  applied: results.filter((r) => r.status === "ok").length,
  failed: results.filter((r) => r.status === "ng").length,
  families,
  results,
});
console.log(`\nグルーピング ${DRY ? "(DRY-RUN) " : ""}完了: 対象ファミリー ${families.filter((f) => f.status === "ready").length} / 見送り ${families.filter((f) => f.status !== "ready").length} / 設定OK ${results.filter((r) => r.status === "ok").length} / NG ${results.filter((r) => r.status === "ng").length}`);
console.log(`→ ${RESULTS_FILE}`);
