// insertCabinetFile の実機往復検証: テスト画像をthum02へアップ→公開URL確認→削除(後始末)。
// 店舗を汚さないよう専用ファイル名を使い、必ず deleteCabinetFile する。
// 実行: npx tsx tests/verify_upload_roundtrip.mjs
import { readFileSync } from "node:fs";
import sharp from "sharp";
import { processForCabinet } from "../lib/image/process.ts";
import { insertCabinetFile, deleteCabinetFile, searchFile } from "../lib/rakuten/cabinet-client.ts";
import { RCABINET_FOLDER } from "../lib/rakuten/store.ts";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const get = (k) => (env.match(new RegExp("^" + k + "=(.*)$", "m")) || [])[1]?.trim();
const cred = { serviceSecret: get("RAKUTEN_SERVICE_SECRET"), licenseKey: get("RAKUTEN_LICENSE_KEY") };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TEST_NAME = "zzz-e2e-test"; // 商品コードと衝突しない専用名(12byte+.jpg=16byte, 20以内)
const filePath = `${TEST_NAME}.jpg`;
let fail = 0;
const check = (l, c, d) => { if (!c) fail++; console.log(`${c ? "✅" : "❌"} ${l}${d ? "  " + d : ""}`); };

// 赤い200x200のテスト画像をJPEGへ整形
const png = await sharp({ create: { width: 200, height: 200, channels: 3, background: { r: 220, g: 40, b: 40 } } }).png().toBuffer();
const jpeg = await processForCabinet(png, { kind: "main" });
check("テスト画像整形(JPEG/2MB内)", jpeg.length > 0 && jpeg.length <= 2 * 1024 * 1024, `${jpeg.length}B`);

// 1) thum02 へアップロード
const ins = await insertCabinetFile(cred, {
  folderId: RCABINET_FOLDER.thum02.folderId,
  filePath,
  fileName: "E2E自動テスト画像(削除予定)",
  jpeg,
  overWrite: true,
});
check("insertCabinetFile OK", ins.ok, ins.ok ? `fileId=${ins.fileId}` : `msg=${ins.message}`);

const fileId = ins.ok ? ins.fileId : "";

// 2) 公開URLで実在確認（files/search はインデックス反映が遅延するため HEAD を使う）
await sleep(1500);
const publicUrl = `https://image.rakuten.co.jp/ichiban-okinawa/cabinet/thum02/${filePath}`;
const head = await fetch(publicUrl, { method: "HEAD" });
check("公開URLにアップ反映", head.status === 200, `HEAD ${head.status}`);
void searchFile; // 参考用に残置(検索は遅延)

// 3) 後始末: insert が返した fileId で確実に削除
await sleep(1500);
check("fileId 取得済み", !!fileId, fileId);
if (fileId) {
  const del = await deleteCabinetFile(cred, fileId);
  check("deleteCabinetFile 後始末", del.ok, del.message);
} else {
  check("deleteCabinetFile 後始末", false, "⚠ FileId無し。手動でthum02/zzz-e2e-test.jpgを削除してください");
}

console.log(fail === 0 ? "\n🎉 アップロード往復(insert→確認→delete) 成功" : `\n⚠ ${fail}件失敗`);
process.exit(fail === 0 ? 0 : 1);
